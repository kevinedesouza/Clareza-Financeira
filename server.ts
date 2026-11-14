import express, { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  Account,
  AccountMovement,
  AuditLog,
  Budget,
  Card,
  Category,
  CategoryRule,
  FinancialEvent,
  Goal,
  ImportBatch,
  ImportDecision,
  InstallmentPlan,
  Obligation,
  Reconciliation,
  Recurrence,
  TransferGroup,
  WorkspaceData,
} from './src/lib/domain/types';
import { computeAccountBalance, generateRecurrenceDates } from './src/lib/domain/ledger';
import { computeDeterministicInsights } from './src/lib/domain/insights';
import { daysInMonth, splitInstallments, todayCivilSaoPaulo } from './src/lib/domain/money';
import { processImportPayload } from './workers/importWorker';
import {
  createSupabaseAdminClient,
  createSupabaseAnonClient,
  createSupabaseUserClient,
  getSupabaseDiagnostics,
  getSupabaseEnv,
  loadWorkspaceFromSupabase,
  sbAppendAudit,
  sbCheckIdempotency,
  sbCommitImportBatch,
  sbContributeGoal,
  sbCreateAccount,
  sbCreateCard,
  sbCreateCardInstallments,
  sbCreateCategory,
  sbCreateCategoryRule,
  sbCreateEventAndMovement,
  sbCreateGoal,
  sbCreateObligation,
  sbCreateRecurrence,
  sbCreateReconciliation,
  sbCreateTransfer,
  sbDismissInsight,
  sbPrepareImport,
  sbRecordIdempotency,
  sbRestorePackage,
  sbSettleObligation,
  sbSoftDeleteMovement,
  sbSoftDeleteMovementsBulk,
  sbUpdateCard,
  sbUndoImportBatch,
  sbDeleteImportBatch,
  sbUpdateAccount,
  sbUpdateImportDecisions,
  sbUpdateMovement,
  sbUpdateProfile,
  sbUpsertBudget,
} from './src/lib/supabase/serverAdapter';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_NOT_CONFIGURED_MSG = 'Serviço de acesso indisponível no momento. Tente novamente em instantes.';
interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  sessionToken?: string;
  sbUser?: SupabaseClient;
  sbAdmin?: SupabaseClient | null;
  useSupabase?: boolean;
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) result[k] = decodeURIComponent(v.join('='));
  }
  return result;
}

function setCookieHeader(res: Response, cookies: string[]) {
  res.setHeader('Set-Cookie', cookies);
}

function buildCookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function clearAuthCookies(res: Response) {
  setCookieHeader(res, [
    buildCookie('clareza_session', '', 0),
    buildCookie('clareza_sb_access', '', 0),
    buildCookie('clareza_sb_refresh', '', 0),
  ]);
}

async function resolveSupabaseSession(
  req: Request,
  res: Response
): Promise<{
  userId: string;
  email: string;
  displayName?: string;
  accessToken: string;
  sbUser: SupabaseClient;
} | null> {
  const env = getSupabaseEnv();
  if (!env.configured) return null;

  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  let accessToken = bearer || cookies['clareza_sb_access'];
  const refreshToken = cookies['clareza_sb_refresh'];

  const sbAnon = createSupabaseAnonClient();
  if (!sbAnon) return null;

  if (accessToken) {
    const { data, error } = await sbAnon.auth.getUser(accessToken);
    if (!error && data.user) {
      const sbUser = createSupabaseUserClient(accessToken);
      if (!sbUser) return null;
      return {
        userId: data.user.id,
        email: data.user.email || 'titular@clareza.local',
        displayName: (data.user.user_metadata?.display_name as string | undefined) || undefined,
        accessToken,
        sbUser,
      };
    }
  }

  if (refreshToken) {
    const { data, error } = await sbAnon.auth.refreshSession({ refresh_token: refreshToken });
    if (!error && data.session && data.user) {
      accessToken = data.session.access_token;
      setCookieHeader(res, [
        buildCookie('clareza_sb_access', data.session.access_token, 60 * 60 * 24 * 7),
        buildCookie('clareza_sb_refresh', data.session.refresh_token, 60 * 60 * 24 * 30),
      ]);
      const sbUser = createSupabaseUserClient(accessToken);
      if (!sbUser) return null;
      return {
        userId: data.user.id,
        email: data.user.email || 'titular@clareza.local',
        displayName: (data.user.user_metadata?.display_name as string | undefined) || undefined,
        accessToken,
        sbUser,
      };
    }
  }

  return null;
}

const asyncRoute =
  (fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void> | void) =>
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error('Erro na rota da API:', err);
      const message = err instanceof Error ? err.message : 'Erro interno ao processar requisição.';
      const unreachable =
        message.toLowerCase().includes('fetch failed') ||
        message.toLowerCase().includes('self-signed') ||
        message.includes('503');
      const schemaMissing =
        !unreachable &&
        (message.includes('profiles') || message.includes('PGRST205') || message.includes('does not exist'));
      res.status(unreachable || schemaMissing ? 503 : 500).json({
        code: unreachable
          ? 'SUPABASE_UNREACHABLE'
          : schemaMissing
            ? 'SUPABASE_SCHEMA_PENDING'
            : 'INTERNAL_ERROR',
        message: unreachable
          ? 'Servidor Supabase indisponível ou com certificado TLS inválido no endereço configurado. Verifique a instância no Coolify.'
          : schemaMissing
            ? 'As tabelas do Clareza Financeira ainda não foram aplicadas no projeto Supabase. Execute supabase/migrations/0001_initial_schema.sql no SQL Editor do Supabase.'
            : message,
      });
    });
  };

const requireAuth = asyncRoute(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const env = getSupabaseEnv();
  if (!env.configured) {
    res.status(503).json({ code: 'SUPABASE_NOT_CONFIGURED', message: SUPABASE_NOT_CONFIGURED_MSG });
    return;
  }
  const sbSess = await resolveSupabaseSession(req, res);
  if (!sbSess) {
    res.status(401).json({ code: 'SESSION_REQUIRED', message: 'Entre novamente para continuar.' });
    return;
  }
  req.userId = sbSess.userId;
  req.userEmail = sbSess.email;
  req.userDisplayName = sbSess.displayName;
  req.sbUser = sbSess.sbUser;
  req.sbAdmin = createSupabaseAdminClient();
  req.useSupabase = true;
  next();
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      const diagnostics = await getSupabaseDiagnostics();
      const missingConfig: string[] = [];
      if (!diagnostics.keys.url) missingConfig.push('SUPABASE_URL');
      if (!diagnostics.keys.anonKey) missingConfig.push('SUPABASE_PUBLISHABLE_KEY');
      if (!diagnostics.keys.serviceRoleKey) missingConfig.push('SUPABASE_SERVICE_ROLE_KEY');

      res.json({
        ok: true,
        mode: 'supabase',
        supabaseConfigured: diagnostics.configured,
        supabase: diagnostics,
        missingConfig,
        serverTimeUtc: new Date().toISOString(),
      });
    })
  );

  app.get(
    '/api/supabase/migration-sql',
    asyncRoute(async (_req, res) => {
      const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/0001_initial_schema.sql');
      const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf-8') : '';
      res.json({ sql });
    })
  );

  // Autenticação exclusiva via Supabase Auth (cookies HttpOnly)
  app.get(
    '/api/auth/session',
    asyncRoute(async (req: AuthedRequest, res) => {
      const env = getSupabaseEnv();
      const diagnostics = env.configured ? await getSupabaseDiagnostics() : null;
      if (!env.configured) {
        res.json({ authenticated: false, supabaseConfigured: false, supabase: diagnostics });
        return;
      }
      const sbSess = await resolveSupabaseSession(req, res);
      if (!sbSess) {
        res.json({ authenticated: false, supabaseConfigured: true, supabase: diagnostics });
        return;
      }
      const ws = await loadWorkspaceFromSupabase(sbSess.sbUser, sbSess.userId, sbSess.email, sbSess.displayName);
      res.json({ authenticated: true, supabaseConfigured: true, supabase: diagnostics, profile: ws.profile });
    })
  );

  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!getSupabaseEnv().configured) {
        res.status(503).json({ code: 'SUPABASE_NOT_CONFIGURED', message: SUPABASE_NOT_CONFIGURED_MSG });
        return;
      }

      const sbAnon = createSupabaseAnonClient()!;
      const { data, error } = await sbAnon.auth.signInWithPassword({ email, password });

      if (error || !data.session || !data.user) {
        const isUnreachable =
          error?.name === 'AuthRetryableFetchError' ||
          error?.status === 0 ||
          (typeof error?.status === 'number' && error.status >= 500) ||
          error?.message?.toLowerCase().includes('fetch failed');
        if (isUnreachable) {
          res.status(503).json({
            code: 'SUPABASE_UNREACHABLE',
            message:
              'Serviço de acesso indisponível no momento. Tente novamente em instantes.',
          });
          return;
        }
        res.status(401).json({
          code: 'INVALID_LOGIN',
          message:
            error?.message === 'Email not confirmed'
              ? 'Confirme seu e-mail antes de entrar na conta.'
              : 'E-mail ou senha inválidos.',
        });
        return;
      }

      const sbUser = createSupabaseUserClient(data.session.access_token)!;
      const ws = await loadWorkspaceFromSupabase(
        sbUser,
        data.user.id,
        data.user.email || email,
        data.user.user_metadata?.display_name as string | undefined
      );

      setCookieHeader(res, [
        buildCookie('clareza_sb_access', data.session.access_token, 60 * 60 * 24 * 7),
        buildCookie('clareza_sb_refresh', data.session.refresh_token, 60 * 60 * 24 * 30),
      ]);

      res.json({ authenticated: true, profile: ws.profile });
    })
  );

  app.post('/api/auth/logout', (_req: AuthedRequest, res) => {
    clearAuthCookies(res);
    res.json({ ok: true });
  });

  // Workspace completo + insights determinísticos calculados no servidor
  app.get(
    '/api/workspace',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const today = todayCivilSaoPaulo();
      const [tYear, tMonth] = today.split('-').map(Number);
      const monthStart = `${today.slice(0, 7)}-01`;
      const defaultMonthEnd = `${today.slice(0, 7)}-${String(daysInMonth(tYear, tMonth)).padStart(2, '0')}`;
      const periodStart = String(req.query.periodStart || monthStart);
      const periodEnd = String(req.query.periodEnd || defaultMonthEnd);

      const ws = await loadWorkspaceFromSupabase(req.sbUser!, req.userId!, req.userEmail!, req.userDisplayName);

      const insights = computeDeterministicInsights(ws, {
        periodStart,
        periodEnd,
        todayDate: today,
      });

      res.json({
        workspace: ws,
        insights,
        storageMode: 'supabase',
        fetchedAt: new Date().toISOString(),
      });
    })
  );

  app.patch(
    '/api/profile',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const profile = await sbUpdateProfile(req.sbUser!, req.userId!, req.userEmail!, req.body || {});
      res.json({ profile });
    })
  );

  // Contas
  app.post(
    '/api/accounts',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nome da conta é obrigatório.' });
        return;
      }

      const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
      const hit = await sbCheckIdempotency(req.sbUser!, req.userId!, opKey);
      if (hit) {
        res.status(200).json(hit);
        return;
      }
      const account = await sbCreateAccount(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
      const payload = { account };
      await sbRecordIdempotency(req.sbUser!, req.userId!, opKey, '/api/accounts', payload);
      res.status(201).json(payload);
    })
  );

  app.patch(
    '/api/accounts/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const result = await sbUpdateAccount(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
      if (result.status !== 200) {
        res.status(result.status).json({ code: result.code, message: result.message });
        return;
      }
      res.json({ account: result.account });
    })
  );

  // Lançamentos manuais (Receita, Despesa, Estorno, com suporte a Rateio)
  app.post(
    '/api/events',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const {
        nature,
        description,
        competenceDate,
        effectiveDate,
        magnitudeCents,
        accountId,
        categoryId,
        projectId,
        tags,
        allocations,
        notes,
      } = req.body || {};

      if (!description || !String(description).trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Informe uma descrição para o lançamento.' });
        return;
      }
      if (!Number.isInteger(magnitudeCents) || magnitudeCents <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Informe um valor positivo válido em centavos.' });
        return;
      }

      const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
      const hit = await sbCheckIdempotency(req.sbUser!, req.userId!, opKey);
      if (hit) {
        res.status(200).json(hit);
        return;
      }
      const out = await sbCreateEventAndMovement(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
      if (out.status !== 201 || !out.payload) {
        res.status(out.status).json({ code: out.code, message: out.message });
        return;
      }
      await sbRecordIdempotency(req.sbUser!, req.userId!, opKey, '/api/events', out.payload);
      res.status(201).json(out.payload);
    })
  );

  app.patch(
    '/api/movements/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const out = await sbUpdateMovement(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
      if (out.status !== 200 || !out.payload) {
        res.status(out.status).json({ code: out.code, message: out.message });
        return;
      }
      res.json(out.payload);
    })
  );

  // Exclusão em lote de lançamentos (seleção múltipla na tela de Lançamentos)
  app.post(
    '/api/movements/bulk-delete',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((x) => typeof x === 'string')) {
        res.status(400).json({ code: 'INVALID_IDS', message: 'Informe de 1 a 1000 lançamentos para excluir.' });
        return;
      }
      const out = await sbSoftDeleteMovementsBulk(
        req.sbUser!,
        req.sbAdmin || null,
        req.userId!,
        ids,
        typeof req.body?.reason === 'string' ? req.body.reason : 'Exclusão em lote pelo usuário'
      );
      res.json({ ok: true, ...out });
    })
  );

  app.delete(
    '/api/movements/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const ok = await sbSoftDeleteMovement(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body?.reason);
      if (!ok) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Lançamento não encontrado.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  // Transferências atômicas de duas pernas (via RPC rpc_create_transfer no Supabase)
  app.post(
    '/api/transfers',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { fromAccountId, toAccountId, amountCents, effectiveDate, description, nature } = req.body || {};
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        res.status(400).json({ code: 'INVALID_TRANSFER', message: 'Selecione contas de origem e destino diferentes.' });
        return;
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        res.status(400).json({ code: 'INVALID_AMOUNT', message: 'Valor da transferência deve ser maior que zero.' });
        return;
      }

      const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
      const out = await sbCreateTransfer(req.sbUser!, req.userId!, opKey, req.body || {});
      if (out.status !== 201 || !out.payload) {
        res.status(out.status).json({ code: out.code, message: out.message });
        return;
      }
      res.status(201).json(out.payload);
    })
  );

  // Conciliação por data de corte
  app.post(
    '/api/reconciliations',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { accountId, cutoffDate, reportedBalanceCents } = req.body || {};
      if (!Number.isInteger(reportedBalanceCents)) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Informe o saldo do extrato em centavos.' });
        return;
      }

      const out = await sbCreateReconciliation(
        req.sbUser!,
        req.sbAdmin || null,
        req.userId!,
        accountId,
        cutoffDate,
        reportedBalanceCents
      );
      if (out.status !== 201 || !out.reconciliation) {
        res.status(out.status).json({ code: out.code, message: out.message });
        return;
      }
      res.status(201).json({ reconciliation: out.reconciliation });
    })
  );

  // Cartões e Parcelas
  app.post(
    '/api/cards',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { name, maskedLast4, creditLimitCents, limitVerified, closingDay, dueDay, payingAccountId } = req.body || {};
      if (!name || !String(name).trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nome do cartão é obrigatório.' });
        return;
      }

      const out = await sbCreateCard(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
      res.status(201).json(out);
    })
  );

  app.patch(
    '/api/cards/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const result = await sbUpdateCard(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
      if (result.status !== 200) {
        res.status(result.status).json({ code: result.code, message: result.message });
        return;
      }
      res.json({ card: result.card });
    })
  );

  app.post(
    '/api/cards/:id/installments',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { description, totalCents, installmentCount, purchaseDate, categoryId } = req.body || {};
      if (!description || !Number.isInteger(totalCents) || totalCents <= 0 || !Number.isInteger(installmentCount) || installmentCount < 1) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Dados da compra parcelada inválidos.' });
        return;
      }

      const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
      const hit = await sbCheckIdempotency(req.sbUser!, req.userId!, opKey);
      if (hit) {
        res.status(200).json(hit);
        return;
      }
      const out = await sbCreateCardInstallments(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
      if (out.status !== 201 || !out.payload) {
        res.status(out.status).json({ code: out.code, message: out.message });
        return;
      }
      await sbRecordIdempotency(req.sbUser!, req.userId!, opKey, `/api/cards/${req.params.id}/installments`, out.payload);
      res.status(201).json(out.payload);
    })
  );

  // Importação CSV / OFX — Preparação (Staging)
  app.post(
    '/api/imports/prepare',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { accountId, fileName, format, contentBase64, csvOptions } = req.body || {};
      if (!contentBase64 || !fileName || (format !== 'csv' && format !== 'ofx')) {
        res.status(400).json({ code: 'INVALID_FILE', message: 'Arquivo CSV ou OFX inválido.' });
        return;
      }

      try {
        const out = await sbPrepareImport(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
        res.status(out.status).json(out.payload);
      } catch (err) {
        res.status(400).json({
          code: 'PARSE_ERROR',
          message: err instanceof Error ? err.message : 'Falha ao analisar arquivo.',
        });
      }
    })
  );

  app.post(
    '/api/imports/:id/decisions',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const updates = req.body?.decisions as Array<{ rowId: string; decision: ImportDecision; categoryId?: string }> | undefined;
      const batch = await sbUpdateImportDecisions(req.sbUser!, req.userId!, req.params.id, updates);
      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Lote de importação não encontrado.' });
        return;
      }
      res.json({ batch });
    })
  );

  app.post(
    '/api/imports/:id/commit',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
      const hit = await sbCheckIdempotency(req.sbUser!, req.userId!, opKey);
      if (hit) {
        res.status(200).json(hit);
        return;
      }
      const out = await sbCommitImportBatch(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id);
      if (out.status === 200) {
        await sbRecordIdempotency(req.sbUser!, req.userId!, opKey, `/api/imports/${req.params.id}/commit`, out.payload);
      }
      res.status(out.status).json(out.payload);
    })
  );

  app.post(
    '/api/imports/:id/undo',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const out = await sbUndoImportBatch(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id);
      res.status(out.status).json(out.payload);
    })
  );

  // Exclusão de lote do histórico (somente lotes não confirmados; confirmados precisam ser revertidos)
  app.delete(
    '/api/imports/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const out = await sbDeleteImportBatch(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id);
      res.status(out.status).json(out.payload);
    })
  );

  // Agenda (Obrigações, Recorrências e Liquidação Parcial/Total)
  app.post(
    '/api/obligations',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { direction, description, dueDate, competenceDate, originalCents, accountId, categoryId } = req.body || {};
      if (!description || !Number.isInteger(originalCents) || originalCents <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Descrição e valor positivo são obrigatórios.' });
        return;
      }

      const obligation = await sbCreateObligation(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
      res.status(201).json({ obligation });
    })
  );

  app.post(
    '/api/recurrences',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { direction, description, amountCents, frequency, anchorDay, startDate, endDate, accountId, categoryId } = req.body || {};
      if (!description || !Number.isInteger(amountCents) || amountCents <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Dados da recorrência inválidos.' });
        return;
      }

      const recurrence = await sbCreateRecurrence(req.sbUser!, req.userId!, req.body || {});
      res.status(201).json({ recurrence });
    })
  );

  app.post(
    '/api/obligations/:id/settlements',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { accountId, amountCents, effectiveDate, existingMovementId } = req.body || {};
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Valor de liquidação inválido.' });
        return;
      }

      const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
      const hit = await sbCheckIdempotency(req.sbUser!, req.userId!, opKey);
      if (hit) {
        res.status(200).json(hit);
        return;
      }
      const out = await sbSettleObligation(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
      if (out.status === 201) {
        await sbRecordIdempotency(req.sbUser!, req.userId!, opKey, `/api/obligations/${req.params.id}/settlements`, out.payload);
      }
      res.status(out.status).json(out.payload);
    })
  );

  // Orçamentos, Metas, Categorias, Regras e Insights
  app.post(
    '/api/budgets',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { monthKey, categoryId, limitCents, alertThresholdPct } = req.body || {};
      if (!monthKey || !categoryId || !Number.isInteger(limitCents) || limitCents <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Informe mês, categoria e limite positivo.' });
        return;
      }

      const out = await sbUpsertBudget(req.sbUser!, req.userId!, req.body || {});
      res.status(out.status).json({ budget: out.budget });
    })
  );

  app.post(
    '/api/goals',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { name, targetCents, reservedCents, deadlineDate } = req.body || {};
      if (!name || !Number.isInteger(targetCents) || targetCents <= 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nome e valor-alvo positivo são obrigatórios.' });
        return;
      }

      const goal = await sbCreateGoal(req.sbUser!, req.userId!, req.body || {});
      res.status(201).json({ goal });
    })
  );

  app.post(
    '/api/goals/:id/contribute',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { amountCents, note } = req.body || {};
      if (!Number.isInteger(amountCents) || amountCents === 0) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Valor de contribuição inválido.' });
        return;
      }

      const out = await sbContributeGoal(req.sbUser!, req.userId!, req.params.id, amountCents, note);
      res.status(out.status).json(out.payload);
    })
  );

  app.post(
    '/api/categories',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { name, kind, essentiality, parentId } = req.body || {};
      if (!name || !String(name).trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Nome da categoria é obrigatório.' });
        return;
      }

      const category = await sbCreateCategory(req.sbUser!, req.userId!, req.body || {});
      res.status(201).json({ category });
    })
  );

  app.post(
    '/api/category-rules',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { matchText, targetCategoryId, priority } = req.body || {};
      if (!matchText || !targetCategoryId) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Informe texto de correspondência e categoria.' });
        return;
      }

      const rule = await sbCreateCategoryRule(req.sbUser!, req.userId!, req.body || {});
      res.status(201).json({ rule });
    })
  );

  app.post(
    '/api/insights/:id/dismiss',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      await sbDismissInsight(req.sbAdmin || null, req.userId!, req.params.id);
      res.json({ ok: true });
    })
  );

  // Exportação pessoal (pacote versionado sem credenciais Auth) e Restauração em espaço próprio
  app.get(
    '/api/exports/package',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const ws = await loadWorkspaceFromSupabase(req.sbUser!, req.userId!, req.userEmail!, req.userDisplayName);
      const pkg = {
        schemaVersion: '2.0',
        exportedAt: new Date().toISOString(),
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        data: {
          accounts: ws.accounts,
          cards: ws.cards,
          categories: ws.categories,
          projects: ws.projects,
          events: ws.events,
          movements: ws.movements,
          transferGroups: ws.transferGroups,
          recurrences: ws.recurrences,
          installmentPlans: ws.installmentPlans,
          obligations: ws.obligations,
          settlements: ws.settlements,
          budgets: ws.budgets,
          goals: ws.goals,
          goalContributions: ws.goalContributions,
          categoryRules: ws.categoryRules,
        },
      };
      res.json(pkg);
    })
  );

  app.post(
    '/api/data-imports/restore',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const pkg = req.body;
      if (!pkg || pkg.schemaVersion !== '2.0' || !pkg.data || !Array.isArray(pkg.data.accounts)) {
        res.status(400).json({
          code: 'INVALID_BACKUP_PACKAGE',
          message: 'Pacote de restauração inválido ou corrompido. Nenhuma alteração aplicada.',
        });
        return;
      }

      const out = await sbRestorePackage(req.sbUser!, req.sbAdmin || null, req.userId!, pkg);
      res.status(out.status).json(out.payload);
    })
  );

  // Vite middleware (desenvolvimento) ou estáticos (produção)
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    const env = getSupabaseEnv();
    console.log(
      `Clareza Financeira rodando em http://0.0.0.0:${PORT} (modo: Supabase)`
    );
  });
}

startServer().catch((err) => {
  console.error('Erro ao iniciar servidor Clareza Financeira:', err);
  process.exit(1);
});
