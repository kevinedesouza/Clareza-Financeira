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
import {
  buildDemoWorkspace,
  computeAccountBalance,
  createEmptyWorkspace,
  generateRecurrenceDates,
} from './src/lib/domain/ledger';
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
  sbUndoImportBatch,
  sbUpdateAccount,
  sbUpdateImportDecisions,
  sbUpdateMovement,
  sbUpdateProfile,
  sbUpsertBudget,
} from './src/lib/supabase/serverAdapter';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'clareza-store.json');

interface LocalUserAccount {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
}

interface PersistedStore {
  users: Record<string, LocalUserAccount>;
  sessions: Record<string, { userId: string; isDemo: boolean; createdAt: string }>;
  workspaces: Record<string, WorkspaceData>;
  idempotency: Record<string, Record<string, unknown>>;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

function loadStore(): PersistedStore {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    const initial: PersistedStore = {
      users: {},
      sessions: {},
      workspaces: {
        'demo-user': buildDemoWorkspace(),
      },
      idempotency: {},
    };
    saveStore(initial);
    return initial;
  }
  const raw = fs.readFileSync(STORE_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as PersistedStore;
  if (!parsed.workspaces['demo-user']) {
    parsed.workspaces['demo-user'] = buildDemoWorkspace();
  }
  return parsed;
}

function saveStore(store: PersistedStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpFile, STORE_FILE);
}

let store: PersistedStore = loadStore();

function appendAudit(
  ws: WorkspaceData,
  entityType: string,
  entityId: string,
  action: string,
  reason?: string,
  metadata?: Record<string, string | number | boolean>
) {
  const entry: AuditLog = {
    id: crypto.randomUUID(),
    ownerId: ws.profile.id,
    entityType,
    entityId,
    action,
    reason,
    metadata,
    createdAt: new Date().toISOString(),
  };
  ws.auditLogs.unshift(entry);
  if (ws.auditLogs.length > 500) {
    ws.auditLogs.length = 500;
  }
}

interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
  userDisplayName?: string;
  isDemo?: boolean;
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
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const localToken = bearer || cookies['clareza_session'];

  // 1. Ambiente demonstrativo explícito (sempre isolado da base real do Supabase)
  if (localToken && store.sessions[localToken]?.isDemo) {
    const sess = store.sessions[localToken];
    req.userId = sess.userId;
    req.isDemo = true;
    req.sessionToken = localToken;
    req.useSupabase = false;
    next();
    return;
  }

  // 2. Autenticação real no Supabase quando configurado
  const env = getSupabaseEnv();
  if (env.configured) {
    const sbSess = await resolveSupabaseSession(req, res);
    if (!sbSess) {
      res.status(401).json({
        code: 'SESSION_REQUIRED',
        message: 'Entre novamente para continuar.',
      });
      return;
    }
    req.userId = sbSess.userId;
    req.userEmail = sbSess.email;
    req.userDisplayName = sbSess.displayName;
    req.isDemo = false;
    req.sbUser = sbSess.sbUser;
    req.sbAdmin = createSupabaseAdminClient();
    req.useSupabase = true;
    next();
    return;
  }

  // 3. Fallback local-dev-store apenas quando Supabase não está configurado
  if (!localToken || !store.sessions[localToken]) {
    res.status(401).json({
      code: 'SESSION_REQUIRED',
      message: 'Entre novamente para continuar.',
    });
    return;
  }

  const sess = store.sessions[localToken];
  req.userId = sess.userId;
  req.isDemo = sess.isDemo;
  req.sessionToken = localToken;
  req.useSupabase = false;
  next();
});

function checkLocalIdempotency(req: AuthedRequest, res: Response): string | null {
  const key = req.headers['x-idempotency-key'];
  if (typeof key !== 'string' || !key.trim()) return null;
  const ownerId = req.userId!;
  const existing = store.idempotency[ownerId]?.[key];
  if (existing) {
    res.status(200).json(existing);
    return '__HIT__';
  }
  return key.trim();
}

function recordLocalIdempotency(ownerId: string, key: string | null, payload: unknown) {
  if (!key || key === '__HIT__') return;
  if (!store.idempotency[ownerId]) store.idempotency[ownerId] = {};
  store.idempotency[ownerId][key] = payload;
}

function getWorkspace(userId: string): WorkspaceData {
  if (!store.workspaces[userId]) {
    const u = Object.values(store.users).find((usr) => usr.id === userId);
    store.workspaces[userId] = createEmptyWorkspace(
      userId,
      u?.email || 'titular@clareza.local',
      u?.displayName || 'Titular'
    );
  }
  return store.workspaces[userId];
}

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
      if (!diagnostics.keys.anonKey) missingConfig.push('SUPABASE_PUBLISHABLE_KEY (ou VITE_SUPABASE_PUBLISHABLE_KEY)');
      if (!diagnostics.keys.serviceRoleKey) missingConfig.push('SUPABASE_SERVICE_ROLE_KEY');

      res.json({
        ok: true,
        mode: diagnostics.configured ? 'supabase' : 'local-dev-store',
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

  // Autenticação e seleção de ambiente (Supabase Auth vs Ambiente Demonstrativo isolado)
  app.get(
    '/api/auth/session',
    asyncRoute(async (req: AuthedRequest, res) => {
      const cookies = parseCookies(req.headers.cookie);
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined;
      const localToken = bearer || cookies['clareza_session'];
      const env = getSupabaseEnv();
      const diagnostics = env.configured ? await getSupabaseDiagnostics() : null;

      if (localToken && store.sessions[localToken]?.isDemo) {
        const sess = store.sessions[localToken];
        const ws = getWorkspace(sess.userId);
        res.json({
          authenticated: true,
          isDemo: true,
          supabaseConfigured: env.configured,
          supabase: diagnostics,
          profile: ws.profile,
        });
        return;
      }

      if (env.configured) {
        const sbSess = await resolveSupabaseSession(req, res);
        if (!sbSess) {
          res.json({
            authenticated: false,
            supabaseConfigured: true,
            supabase: diagnostics,
          });
          return;
        }
        const ws = await loadWorkspaceFromSupabase(
          sbSess.sbUser,
          sbSess.userId,
          sbSess.email,
          sbSess.displayName
        );
        res.json({
          authenticated: true,
          isDemo: false,
          supabaseConfigured: true,
          supabase: diagnostics,
          profile: ws.profile,
        });
        return;
      }

      if (!localToken || !store.sessions[localToken]) {
        res.json({ authenticated: false, supabaseConfigured: false, supabase: diagnostics });
        return;
      }
      const sess = store.sessions[localToken];
      const ws = getWorkspace(sess.userId);
      res.json({
        authenticated: true,
        isDemo: sess.isDemo,
        supabaseConfigured: false,
        supabase: diagnostics,
        profile: ws.profile,
      });
    })
  );

  app.post(
    '/api/auth/register',
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const displayName = String(req.body?.displayName || '').trim() || 'Titular';

      if (!email || !email.includes('@') || password.length < 6) {
        res.status(400).json({
          code: 'INVALID_CREDENTIALS',
          message: 'Informe um e-mail válido e senha com pelo menos 6 caracteres.',
        });
        return;
      }

      const env = getSupabaseEnv();
      if (env.configured) {
        const sbAnon = createSupabaseAnonClient()!;
        const { data, error } = await sbAnon.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
          },
        });

        if (error) {
          const isUnreachable =
            error.name === 'AuthRetryableFetchError' ||
            error.status === 0 ||
            (typeof error.status === 'number' && error.status >= 500) ||
            error.message.toLowerCase().includes('fetch failed');
          if (isUnreachable) {
            res.status(503).json({
              code: 'SUPABASE_UNREACHABLE',
              message:
                'Não foi possível conectar ao servidor Supabase configurado. Verifique se o serviço está ativo e com HTTPS válido.',
            });
            return;
          }
          const isDup = error.message.toLowerCase().includes('already') || error.status === 422;
          res.status(isDup ? 409 : 400).json({
            code: isDup ? 'EMAIL_EXISTS' : 'SUPABASE_AUTH_ERROR',
            message: isDup
              ? 'Já existe uma conta cadastrada com este e-mail.'
              : error.message,
          });
          return;
        }

        if (!data.session || !data.user) {
          res.status(202).json({
            authenticated: false,
            needsEmailConfirmation: true,
            message:
              'Conta criada no Supabase. Confirme o link enviado para o seu e-mail antes de acessar.',
          });
          return;
        }

        const sbUser = createSupabaseUserClient(data.session.access_token)!;
        const ws = await loadWorkspaceFromSupabase(sbUser, data.user.id, email, displayName);

        setCookieHeader(res, [
          buildCookie('clareza_session', '', 0),
          buildCookie('clareza_sb_access', data.session.access_token, 60 * 60 * 24 * 7),
          buildCookie('clareza_sb_refresh', data.session.refresh_token, 60 * 60 * 24 * 30),
        ]);

        res.status(201).json({
          authenticated: true,
          isDemo: false,
          profile: ws.profile,
        });
        return;
      }

      if (store.users[email]) {
        res.status(409).json({
          code: 'EMAIL_EXISTS',
          message: 'Já existe uma conta cadastrada com este e-mail.',
        });
        return;
      }

      const userId = crypto.randomUUID();
      store.users[email] = {
        id: userId,
        email,
        displayName,
        passwordHash: hashPassword(password),
      };
      store.workspaces[userId] = createEmptyWorkspace(userId, email, displayName);

      const token = crypto.randomBytes(24).toString('hex');
      store.sessions[token] = { userId, isDemo: false, createdAt: new Date().toISOString() };
      saveStore(store);

      setCookieHeader(res, [buildCookie('clareza_session', token, 60 * 60 * 24 * 7)]);
      res.status(201).json({
        authenticated: true,
        isDemo: false,
        token,
        profile: store.workspaces[userId].profile,
      });
    })
  );

  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      const env = getSupabaseEnv();
      if (env.configured) {
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
                'Não foi possível conectar ao servidor Supabase configurado. Verifique se o serviço está ativo e com HTTPS válido.',
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
          buildCookie('clareza_session', '', 0),
          buildCookie('clareza_sb_access', data.session.access_token, 60 * 60 * 24 * 7),
          buildCookie('clareza_sb_refresh', data.session.refresh_token, 60 * 60 * 24 * 30),
        ]);

        res.json({
          authenticated: true,
          isDemo: false,
          profile: ws.profile,
        });
        return;
      }

      const user = store.users[email];
      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({
          code: 'INVALID_LOGIN',
          message: 'E-mail ou senha inválidos.',
        });
        return;
      }

      const token = crypto.randomBytes(24).toString('hex');
      store.sessions[token] = { userId: user.id, isDemo: false, createdAt: new Date().toISOString() };
      saveStore(store);

      setCookieHeader(res, [buildCookie('clareza_session', token, 60 * 60 * 24 * 7)]);
      res.json({
        authenticated: true,
        isDemo: false,
        token,
        profile: getWorkspace(user.id).profile,
      });
    })
  );

  app.post('/api/auth/demo', (req, res) => {
    if (req.body?.resetDemo) {
      store.workspaces['demo-user'] = buildDemoWorkspace();
    } else if (!store.workspaces['demo-user']) {
      store.workspaces['demo-user'] = buildDemoWorkspace();
    }
    const token = crypto.randomBytes(24).toString('hex');
    store.sessions[token] = { userId: 'demo-user', isDemo: true, createdAt: new Date().toISOString() };
    saveStore(store);

    setCookieHeader(res, [
      buildCookie('clareza_session', token, 60 * 60 * 24),
      buildCookie('clareza_sb_access', '', 0),
      buildCookie('clareza_sb_refresh', '', 0),
    ]);
    res.json({
      authenticated: true,
      isDemo: true,
      token,
      profile: store.workspaces['demo-user'].profile,
    });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['clareza_session'];
    if (token && store.sessions[token]) {
      delete store.sessions[token];
      saveStore(store);
    }
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

      const ws = req.useSupabase
        ? await loadWorkspaceFromSupabase(req.sbUser!, req.userId!, req.userEmail!, req.userDisplayName)
        : getWorkspace(req.userId!);

      const insights = computeDeterministicInsights(ws, {
        periodStart,
        periodEnd,
        todayDate: req.isDemo ? '2026-11-14' : today,
      });

      res.json({
        workspace: ws,
        insights,
        isDemo: req.isDemo,
        storageMode: req.useSupabase ? 'supabase' : 'local',
        fetchedAt: new Date().toISOString(),
      });
    })
  );

  app.patch(
    '/api/profile',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
        const profile = await sbUpdateProfile(req.sbUser!, req.userId!, req.userEmail!, req.body || {});
        res.json({ profile });
        return;
      }
      const ws = getWorkspace(req.userId!);
      const { displayName, theme, privacyMode } = req.body || {};
      if (typeof displayName === 'string' && displayName.trim()) {
        ws.profile.displayName = displayName.trim();
      }
      if (theme === 'light' || theme === 'dark' || theme === 'system') {
        ws.profile.theme = theme;
      }
      if (typeof privacyMode === 'boolean') {
        ws.profile.privacyMode = privacyMode;
      }
      saveStore(store);
      res.json({ profile: ws.profile });
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

      if (req.useSupabase) {
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
        return;
      }

      const idem = checkLocalIdempotency(req, res);
      if (idem === '__HIT__') return;

      const ws = getWorkspace(req.userId!);
      const {
        institution,
        type,
        maskedIdentifier,
        color,
        openingBalanceCents,
        openingDate,
        openingBalanceKnown,
        includeInLiquidity,
      } = req.body || {};

      const acc: Account = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        name: name.trim(),
        institution: institution?.trim() || undefined,
        type: type || 'checking',
        currency: 'BRL',
        maskedIdentifier: maskedIdentifier?.trim() || undefined,
        color: color || '#2955D9',
        openingBalanceCents: Number.isInteger(openingBalanceCents) ? openingBalanceCents : 0,
        openingDate: openingDate || todayCivilSaoPaulo(),
        openingBalanceKnown: openingBalanceKnown !== false,
        includeInLiquidity: type === 'credit_card' || type === 'investment_manual' ? false : includeInLiquidity !== false,
        isArchived: false,
        version: 1,
      };

      ws.accounts.push(acc);
      appendAudit(ws, 'account', acc.id, 'create', undefined, { name: acc.name });
      const payload = { account: acc };
      recordLocalIdempotency(req.userId!, idem, payload);
      saveStore(store);
      res.status(201).json(payload);
    })
  );

  app.patch(
    '/api/accounts/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
        const result = await sbUpdateAccount(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
        if (result.status !== 200) {
          res.status(result.status).json({ code: result.code, message: result.message });
          return;
        }
        res.json({ account: result.account });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const acc = ws.accounts.find((a) => a.id === req.params.id && a.ownerId === req.userId);
      if (!acc) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Conta não encontrada.' });
        return;
      }
      if (typeof req.body?.expectedVersion === 'number' && req.body.expectedVersion !== acc.version) {
        res.status(409).json({
          code: 'VERSION_CONFLICT',
          message: 'Esta conta foi alterada em outro dispositivo. Recarregue para revisar.',
        });
        return;
      }
      if (typeof req.body?.name === 'string' && req.body.name.trim()) acc.name = req.body.name.trim();
      if (typeof req.body?.isArchived === 'boolean') acc.isArchived = req.body.isArchived;
      if (typeof req.body?.openingBalanceKnown === 'boolean') acc.openingBalanceKnown = req.body.openingBalanceKnown;
      if (Number.isInteger(req.body?.openingBalanceCents)) acc.openingBalanceCents = req.body.openingBalanceCents;
      if (typeof req.body?.openingDate === 'string') acc.openingDate = req.body.openingDate;
      acc.version += 1;
      appendAudit(ws, 'account', acc.id, 'update');
      saveStore(store);
      res.json({ account: acc });
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

      if (req.useSupabase) {
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
        return;
      }

      const idem = checkLocalIdempotency(req, res);
      if (idem === '__HIT__') return;

      const ws = getWorkspace(req.userId!);
      const acc = ws.accounts.find((a) => a.id === accountId && a.ownerId === req.userId && !a.isArchived);
      if (!acc) {
        res.status(400).json({ code: 'INVALID_ACCOUNT', message: 'Conta selecionada é inválida.' });
        return;
      }

      if (Array.isArray(allocations) && allocations.length > 0) {
        const sum = allocations.reduce((s: number, a: { amountCents: number }) => s + (a.amountCents || 0), 0);
        if (sum !== magnitudeCents) {
          res.status(400).json({
            code: 'ALLOCATION_MISMATCH',
            message: 'Os rateios devem somar exatamente o valor total do lançamento.',
          });
          return;
        }
      }

      const eventId = crypto.randomUUID();
      const movId = crypto.randomUUID();
      const resolvedNature = nature === 'income' || nature === 'refund' ? nature : 'expense';
      const signedCents = resolvedNature === 'income' || resolvedNature === 'refund' ? magnitudeCents : -magnitudeCents;
      const compDate = competenceDate || effectiveDate || todayCivilSaoPaulo();
      const effDate = effectiveDate || compDate;

      const ev: FinancialEvent = {
        id: eventId,
        ownerId: req.userId!,
        nature: resolvedNature,
        description: String(description).trim(),
        competenceDate: compDate,
        magnitudeCents,
        currency: 'BRL',
        categoryId: categoryId || undefined,
        projectId: projectId || undefined,
        tags: Array.isArray(tags) ? tags : [],
        allocations: Array.isArray(allocations)
          ? allocations.map((a: { categoryId?: string; projectId?: string; amountCents: number }) => ({
              id: crypto.randomUUID(),
              eventId,
              categoryId: a.categoryId,
              projectId: a.projectId,
              amountCents: a.amountCents,
            }))
          : undefined,
        notes: notes || undefined,
        isDeleted: false,
        version: 1,
      };

      const mov: AccountMovement = {
        id: movId,
        ownerId: req.userId!,
        accountId: acc.id,
        eventId,
        signedCents,
        effectiveDate: effDate,
        description: ev.description,
        origin: 'manual',
        reviewStatus: categoryId || (allocations && allocations.length > 0) ? 'reviewed' : 'pending_category',
        reconciliationStatus: 'unreconciled',
        isDeleted: false,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      ws.events.push(ev);
      ws.movements.push(mov);
      ws.sourceLinks.push({
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        movementId: movId,
        sourceKind: 'manual',
        createdAt: new Date().toISOString(),
      });
      appendAudit(ws, 'movement', movId, 'create_manual', undefined, { signedCents });

      const payload = { event: ev, movement: mov };
      recordLocalIdempotency(req.userId!, idem, payload);
      saveStore(store);
      res.status(201).json(payload);
    })
  );

  app.patch(
    '/api/movements/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
        const out = await sbUpdateMovement(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body || {});
        if (out.status !== 200 || !out.payload) {
          res.status(out.status).json({ code: out.code, message: out.message });
          return;
        }
        res.json(out.payload);
        return;
      }

      const ws = getWorkspace(req.userId!);
      const mov = ws.movements.find((m) => m.id === req.params.id && m.ownerId === req.userId && !m.isDeleted);
      if (!mov) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Lançamento não encontrado.' });
        return;
      }
      if (typeof req.body?.expectedVersion === 'number' && req.body.expectedVersion !== mov.version) {
        res.status(409).json({
          code: 'VERSION_CONFLICT',
          message: 'Este lançamento foi alterado em outro dispositivo. Recarregue para revisar.',
        });
        return;
      }

      const changingValueOrDate =
        (Number.isInteger(req.body?.signedCents) && req.body.signedCents !== mov.signedCents) ||
        (typeof req.body?.effectiveDate === 'string' && req.body.effectiveDate !== mov.effectiveDate);

      if (mov.reconciliationStatus === 'reconciled' && changingValueOrDate) {
        if (!req.body?.reason || !String(req.body.reason).trim()) {
          res.status(400).json({
            code: 'RECONCILED_REASON_REQUIRED',
            message: 'Alterar valor ou data de registro conciliado exige informar o motivo e invalida a conferência.',
          });
          return;
        }
        mov.reconciliationStatus = 'unreconciled';
        for (const r of ws.reconciliations) {
          if (r.accountId === mov.accountId && r.cutoffDate >= mov.effectiveDate && r.status !== 'invalidated') {
            r.status = 'invalidated';
            r.invalidationReason = String(req.body.reason).trim();
          }
        }
      }

      if (typeof req.body?.description === 'string' && req.body.description.trim()) {
        mov.description = req.body.description.trim();
      }
      if (typeof req.body?.effectiveDate === 'string') {
        mov.effectiveDate = req.body.effectiveDate;
      }
      if (Number.isInteger(req.body?.signedCents) && req.body.signedCents !== 0) {
        mov.signedCents = req.body.signedCents;
      }

      const ev = mov.eventId ? ws.events.find((e) => e.id === mov.eventId) : undefined;
      if (ev) {
        if (typeof req.body?.description === 'string' && req.body.description.trim()) {
          ev.description = req.body.description.trim();
        }
        if ('categoryId' in (req.body || {})) {
          ev.categoryId = req.body.categoryId || undefined;
          mov.reviewStatus = ev.categoryId ? 'reviewed' : 'pending_category';
        }
        if ('projectId' in (req.body || {})) {
          ev.projectId = req.body.projectId || undefined;
        }
        if (typeof req.body?.competenceDate === 'string') {
          ev.competenceDate = req.body.competenceDate;
        }
        if (Number.isInteger(req.body?.signedCents) && req.body.signedCents !== 0) {
          ev.magnitudeCents = Math.abs(req.body.signedCents);
        }
        ev.version += 1;
      } else if ('categoryId' in (req.body || {})) {
        const newEvId = crypto.randomUUID();
        ws.events.push({
          id: newEvId,
          ownerId: req.userId!,
          nature: mov.signedCents >= 0 ? 'income' : 'expense',
          description: mov.description,
          competenceDate: mov.effectiveDate,
          magnitudeCents: Math.abs(mov.signedCents),
          currency: 'BRL',
          categoryId: req.body.categoryId || undefined,
          tags: [],
          isDeleted: false,
          version: 1,
        });
        mov.eventId = newEvId;
        mov.reviewStatus = req.body.categoryId ? 'reviewed' : 'pending_category';
      }

      mov.version += 1;
      appendAudit(ws, 'movement', mov.id, 'update', req.body?.reason);
      saveStore(store);
      res.json({ movement: mov, event: ev });
    })
  );

  app.delete(
    '/api/movements/:id',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
        const ok = await sbSoftDeleteMovement(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id, req.body?.reason);
        if (!ok) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Lançamento não encontrado.' });
          return;
        }
        res.json({ ok: true });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const mov = ws.movements.find((m) => m.id === req.params.id && m.ownerId === req.userId && !m.isDeleted);
      if (!mov) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Lançamento não encontrado.' });
        return;
      }
      mov.isDeleted = true;
      mov.version += 1;
      if (mov.eventId) {
        const ev = ws.events.find((e) => e.id === mov.eventId);
        if (ev) {
          ev.isDeleted = true;
          ev.deletedReason = String(req.body?.reason || 'Exclusão pelo usuário');
        }
      }
      appendAudit(ws, 'movement', mov.id, 'soft_delete', req.body?.reason);
      saveStore(store);
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

      if (req.useSupabase) {
        const opKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null;
        const out = await sbCreateTransfer(req.sbUser!, req.userId!, opKey, req.body || {});
        if (out.status !== 201 || !out.payload) {
          res.status(out.status).json({ code: out.code, message: out.message });
          return;
        }
        res.status(201).json(out.payload);
        return;
      }

      const idem = checkLocalIdempotency(req, res);
      if (idem === '__HIT__') return;

      const ws = getWorkspace(req.userId!);
      const fromAcc = ws.accounts.find((a) => a.id === fromAccountId && a.ownerId === req.userId);
      const toAcc = ws.accounts.find((a) => a.id === toAccountId && a.ownerId === req.userId);
      if (!fromAcc || !toAcc) {
        res.status(404).json({ code: 'ACCOUNT_NOT_FOUND', message: 'Conta de origem ou destino não encontrada.' });
        return;
      }

      const groupId = crypto.randomUUID();
      const date = effectiveDate || todayCivilSaoPaulo();
      const desc = String(description || `Transferência ${fromAcc.name} → ${toAcc.name}`).trim();
      const resolvedNature = nature || (toAcc.type === 'credit_card' ? 'card_payment' : 'internal_transfer');

      const group: TransferGroup = {
        id: groupId,
        ownerId: req.userId!,
        nature: resolvedNature,
        fromAccountId,
        toAccountId,
        amountCents,
        effectiveDate: date,
        description: desc,
      };

      const outMov: AccountMovement = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        accountId: fromAccountId,
        transferGroupId: groupId,
        signedCents: -amountCents,
        effectiveDate: date,
        description: `${desc} (Saída)`,
        origin: 'system_transfer',
        reviewStatus: 'reviewed',
        reconciliationStatus: 'unreconciled',
        isDeleted: false,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const inMov: AccountMovement = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        accountId: toAccountId,
        transferGroupId: groupId,
        signedCents: amountCents,
        effectiveDate: date,
        description: `${desc} (Entrada)`,
        origin: 'system_transfer',
        reviewStatus: 'reviewed',
        reconciliationStatus: 'unreconciled',
        isDeleted: false,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      ws.transferGroups.push(group);
      ws.movements.push(outMov, inMov);
      appendAudit(ws, 'transfer_group', groupId, 'create_transfer', undefined, { amountCents });

      const payload = { transferGroup: group, movements: [outMov, inMov] };
      recordLocalIdempotency(req.userId!, idem, payload);
      saveStore(store);
      res.status(201).json(payload);
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

      if (req.useSupabase) {
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
        return;
      }

      const ws = getWorkspace(req.userId!);
      const acc = ws.accounts.find((a) => a.id === accountId && a.ownerId === req.userId);
      if (!acc) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Conta não encontrada.' });
        return;
      }

      const summary = computeAccountBalance(acc, ws.movements, ws.reconciliations, cutoffDate);
      const calculated = summary.rawComputedCents;
      const diff = reportedBalanceCents - calculated;
      const status: Reconciliation['status'] = diff === 0 ? 'matched' : 'divergent';

      const rec: Reconciliation = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        accountId: acc.id,
        cutoffDate: cutoffDate || todayCivilSaoPaulo(),
        reportedBalanceCents,
        calculatedBalanceCents: calculated,
        differenceCents: diff,
        status,
        createdAt: new Date().toISOString(),
      };

      if (status === 'matched') {
        for (const m of ws.movements) {
          if (!m.isDeleted && m.accountId === acc.id && m.effectiveDate <= rec.cutoffDate) {
            m.reconciliationStatus = 'reconciled';
            m.reconciliationId = rec.id;
          }
        }
      }

      ws.reconciliations.push(rec);
      appendAudit(ws, 'reconciliation', rec.id, 'reconcile', undefined, { status, diff });
      saveStore(store);
      res.status(201).json({ reconciliation: rec });
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

      if (req.useSupabase) {
        const out = await sbCreateCard(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
        res.status(201).json(out);
        return;
      }

      const ws = getWorkspace(req.userId!);
      const accountId = crypto.randomUUID();
      const cardId = crypto.randomUUID();

      const cardAcc: Account = {
        id: accountId,
        ownerId: req.userId!,
        name: String(name).trim(),
        type: 'credit_card',
        currency: 'BRL',
        maskedIdentifier: maskedLast4 ? `•••• ${maskedLast4}` : undefined,
        color: '#172554',
        openingBalanceCents: 0,
        openingDate: todayCivilSaoPaulo(),
        openingBalanceKnown: true,
        includeInLiquidity: false,
        isArchived: false,
        version: 1,
      };

      const card: Card = {
        id: cardId,
        ownerId: req.userId!,
        accountId,
        name: String(name).trim(),
        maskedLast4: maskedLast4 || undefined,
        creditLimitCents: Number.isInteger(creditLimitCents) ? creditLimitCents : 0,
        limitVerified: Boolean(limitVerified),
        closingDay: Number(closingDay) || 10,
        dueDay: Number(dueDay) || 18,
        payingAccountId: payingAccountId || undefined,
        isArchived: false,
        version: 1,
      };

      ws.accounts.push(cardAcc);
      ws.cards.push(card);
      appendAudit(ws, 'card', cardId, 'create');
      saveStore(store);
      res.status(201).json({ card, account: cardAcc });
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

      if (req.useSupabase) {
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
        return;
      }

      const idem = checkLocalIdempotency(req, res);
      if (idem === '__HIT__') return;

      const ws = getWorkspace(req.userId!);
      const card = ws.cards.find((c) => c.id === req.params.id && c.ownerId === req.userId);
      if (!card) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Cartão não encontrado.' });
        return;
      }

      const parts = splitInstallments(totalCents, installmentCount);
      const planId = crypto.randomUUID();
      const pDate = purchaseDate || todayCivilSaoPaulo();

      const plan: InstallmentPlan = {
        id: planId,
        ownerId: req.userId!,
        cardId: card.id,
        description: String(description).trim(),
        totalContractedCents: totalCents,
        installmentCount,
        purchaseDate: pDate,
        categoryId: categoryId || undefined,
      };

      const cardMovId = crypto.randomUUID();
      ws.movements.push({
        id: cardMovId,
        ownerId: req.userId!,
        accountId: card.accountId,
        signedCents: -totalCents,
        effectiveDate: pDate,
        description: `${plan.description} (${installmentCount}x)`,
        origin: 'manual',
        reviewStatus: categoryId ? 'reviewed' : 'pending_category',
        reconciliationStatus: 'unreconciled',
        isDeleted: false,
        version: 1,
        createdAt: new Date().toISOString(),
      });

      const createdObligations: Obligation[] = [];
      parts.forEach((cents, idx) => {
        const [y, m] = pDate.split('-').map(Number);
        const totalM = y * 12 + (m - 1) + idx;
        const tY = Math.floor(totalM / 12);
        const tM = (totalM % 12) + 1;
        const compDate = `${String(tY).padStart(4, '0')}-${String(tM).padStart(2, '0')}-${String(Math.min(card.closingDay, 28)).padStart(2, '0')}`;
        const dueDate = `${String(tY).padStart(4, '0')}-${String(tM).padStart(2, '0')}-${String(Math.min(card.dueDay, 28)).padStart(2, '0')}`;

        ws.events.push({
          id: crypto.randomUUID(),
          ownerId: req.userId!,
          nature: 'expense',
          description: `${plan.description} (${idx + 1}/${installmentCount})`,
          competenceDate: compDate,
          magnitudeCents: cents,
          currency: 'BRL',
          categoryId: categoryId || undefined,
          tags: ['parcelado'],
          isDeleted: false,
          version: 1,
        });

        const ob: Obligation = {
          id: crypto.randomUUID(),
          ownerId: req.userId!,
          direction: 'payable',
          description: `${plan.description} (${idx + 1}/${installmentCount})`,
          dueDate,
          competenceDate: compDate,
          originalCents: cents,
          canceledCents: 0,
          status: 'expected',
          cardId: card.id,
          categoryId: categoryId || undefined,
          installmentPlanId: planId,
          installmentIndex: idx + 1,
          version: 1,
        };
        ws.obligations.push(ob);
        createdObligations.push(ob);
      });

      ws.installmentPlans.push(plan);
      appendAudit(ws, 'installment_plan', planId, 'create', undefined, { totalCents, installmentCount });
      const payload = { plan, obligations: createdObligations };
      recordLocalIdempotency(req.userId!, idem, payload);
      saveStore(store);
      res.status(201).json(payload);
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

      if (req.useSupabase) {
        try {
          const out = await sbPrepareImport(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
          res.status(out.status).json(out.payload);
        } catch (err) {
          res.status(400).json({
            code: 'PARSE_ERROR',
            message: err instanceof Error ? err.message : 'Falha ao analisar arquivo.',
          });
        }
        return;
      }

      const ws = getWorkspace(req.userId!);
      const acc = ws.accounts.find((a) => a.id === accountId && a.ownerId === req.userId);
      if (!acc) {
        res.status(400).json({ code: 'INVALID_ACCOUNT', message: 'Selecione uma conta válida para a importação.' });
        return;
      }

      const fileBytes = Uint8Array.from(Buffer.from(contentBase64, 'base64'));
      const fileHash = crypto.createHash('sha256').update(fileBytes).digest('hex');

      const previousBatch = ws.importBatches.find(
        (b) => b.accountId === accountId && b.fileHash === fileHash && b.status === 'committed'
      );
      if (previousBatch) {
        res.status(200).json({
          duplicateBatch: true,
          existingBatch: previousBatch,
          warnings: ['Este mesmo arquivo já foi confirmado nesta conta anteriormente.'],
        });
        return;
      }

      try {
        const batchId = crypto.randomUUID();
        const result = processImportPayload({
          batchId,
          ownerId: req.userId!,
          accountId,
          fileName: String(fileName),
          format,
          fileBytes,
          existingMovements: ws.movements,
          externalIdentities: ws.externalIdentities,
          rules: ws.categoryRules,
          csvOptions,
        });

        ws.importBatches.unshift(result.batch);
        appendAudit(ws, 'import_batch', batchId, 'prepare', undefined, { totalRows: result.batch.totalRows });
        saveStore(store);
        res.status(201).json({ batch: result.batch, warnings: result.warnings });
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
      if (req.useSupabase) {
        const batch = await sbUpdateImportDecisions(req.sbUser!, req.userId!, req.params.id, updates);
        if (!batch) {
          res.status(404).json({ code: 'NOT_FOUND', message: 'Lote de importação não encontrado.' });
          return;
        }
        res.json({ batch });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const batch = ws.importBatches.find((b) => b.id === req.params.id && b.ownerId === req.userId);
      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Lote de importação não encontrado.' });
        return;
      }
      if (Array.isArray(updates)) {
        for (const u of updates) {
          const row = batch.rows.find((r) => r.id === u.rowId);
          if (row) {
            row.decision = u.decision;
            if (u.categoryId !== undefined) row.suggestedCategoryId = u.categoryId || undefined;
          }
        }
      }
      batch.linkedRows = batch.rows.filter((r) => r.decision === 'link_manual').length;
      batch.ignoredRows = batch.rows.filter((r) => r.decision === 'already_exists' || r.decision === 'excluded_invalid').length;
      saveStore(store);
      res.json({ batch });
    })
  );

  app.post(
    '/api/imports/:id/commit',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
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
        return;
      }

      const idem = checkLocalIdempotency(req, res);
      if (idem === '__HIT__') return;

      const ws = getWorkspace(req.userId!);
      const batch = ws.importBatches.find((b) => b.id === req.params.id && b.ownerId === req.userId);
      if (!batch) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Lote não encontrado.' });
        return;
      }
      if (batch.status === 'committed') {
        res.json({ batch, idempotent: true });
        return;
      }

      const blockingInvalid = batch.rows.filter(
        (r) => r.validationErrors.length > 0 && r.decision !== 'excluded_invalid' && r.decision !== 'review_later'
      );
      if (blockingInvalid.length > 0) {
        res.status(400).json({
          code: 'INVALID_ROWS_BLOCKING',
          message: 'Existem linhas inválidas não excluídas. Exclua-as explicitamente antes de confirmar.',
        });
        return;
      }

      const snapshotBackup = JSON.stringify({
        movements: ws.movements,
        events: ws.events,
        externalIdentities: ws.externalIdentities,
        sourceLinks: ws.sourceLinks,
      });

      try {
        let importedCount = 0;
        let linkedCount = 0;
        let ignoredCount = 0;

        for (const row of batch.rows) {
          if (row.decision === 'already_exists' || row.decision === 'excluded_invalid' || row.decision === 'review_later') {
            ignoredCount += 1;
            continue;
          }

          if (row.decision === 'link_manual' && row.candidateMovementId) {
            ws.sourceLinks.push({
              id: crypto.randomUUID(),
              ownerId: req.userId!,
              movementId: row.candidateMovementId,
              batchId: batch.id,
              importRowId: row.id,
              sourceKind: batch.format,
              createdAt: new Date().toISOString(),
            });
            if (row.externalFitid) {
              ws.externalIdentities.push({
                id: crypto.randomUUID(),
                ownerId: req.userId!,
                accountId: batch.accountId,
                institutionKey: row.externalInstitution || 'generic',
                accountKey: row.externalAccount || batch.accountId,
                fitid: row.externalFitid,
                movementId: row.candidateMovementId,
                effectiveDate: row.normalizedDate!,
                signedCents: row.normalizedCents!,
              });
            }
            linkedCount += 1;
            continue;
          }

          if ((row.decision === 'import_new' || row.decision === 'is_distinct' || row.decision === 'pending') && row.normalizedDate && row.normalizedCents) {
            const evId = crypto.randomUUID();
            const movId = crypto.randomUUID();
            const ev: FinancialEvent = {
              id: evId,
              ownerId: req.userId!,
              nature: row.normalizedCents > 0 ? 'income' : 'expense',
              description: row.normalizedDescription || 'Lançamento importado',
              competenceDate: row.normalizedDate,
              magnitudeCents: Math.abs(row.normalizedCents),
              currency: 'BRL',
              categoryId: row.suggestedCategoryId,
              tags: [],
              isDeleted: false,
              version: 1,
            };
            const mov: AccountMovement = {
              id: movId,
              ownerId: req.userId!,
              accountId: batch.accountId,
              eventId: evId,
              signedCents: row.normalizedCents,
              effectiveDate: row.normalizedDate,
              description: ev.description,
              origin: batch.format,
              reviewStatus: row.suggestedCategoryId ? 'reviewed' : 'pending_category',
              reconciliationStatus: 'unreconciled',
              isDeleted: false,
              version: 1,
              createdAt: new Date().toISOString(),
            };

            ws.events.push(ev);
            ws.movements.push(mov);
            row.createdMovementId = movId;
            ws.sourceLinks.push({
              id: crypto.randomUUID(),
              ownerId: req.userId!,
              movementId: movId,
              batchId: batch.id,
              importRowId: row.id,
              sourceKind: batch.format,
              createdAt: new Date().toISOString(),
            });
            if (row.externalFitid) {
              ws.externalIdentities.push({
                id: crypto.randomUUID(),
                ownerId: req.userId!,
                accountId: batch.accountId,
                institutionKey: row.externalInstitution || 'generic',
                accountKey: row.externalAccount || batch.accountId,
                fitid: row.externalFitid,
                movementId: movId,
                effectiveDate: row.normalizedDate,
                signedCents: row.normalizedCents,
              });
            }
            importedCount += 1;
          }
        }

        batch.status = 'committed';
        batch.committedAt = new Date().toISOString();
        batch.validRows = importedCount;
        batch.linkedRows = linkedCount;
        batch.ignoredRows = ignoredCount;

        appendAudit(ws, 'import_batch', batch.id, 'commit', undefined, { importedCount, linkedCount, ignoredCount });
        const payload = { batch, importedCount, linkedCount, ignoredCount };
        recordLocalIdempotency(req.userId!, idem, payload);
        saveStore(store);
        res.json(payload);
      } catch (err) {
        const restored = JSON.parse(snapshotBackup);
        ws.movements = restored.movements;
        ws.events = restored.events;
        ws.externalIdentities = restored.externalIdentities;
        ws.sourceLinks = restored.sourceLinks;
        res.status(500).json({
          code: 'COMMIT_FAILED',
          message: err instanceof Error ? err.message : 'Falha na gravação; lote revertido integralmente.',
        });
      }
    })
  );

  app.post(
    '/api/imports/:id/undo',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
        const out = await sbUndoImportBatch(req.sbUser!, req.sbAdmin || null, req.userId!, req.params.id);
        res.status(out.status).json(out.payload);
        return;
      }

      const ws = getWorkspace(req.userId!);
      const batch = ws.importBatches.find((b) => b.id === req.params.id && b.ownerId === req.userId);
      if (!batch || batch.status !== 'committed') {
        res.status(400).json({ code: 'CANNOT_UNDO', message: 'Apenas lotes confirmados podem ser revertidos.' });
        return;
      }

      let revertedCount = 0;
      let preservedShared = 0;

      for (const row of batch.rows) {
        if (row.createdMovementId) {
          const linksToMov = ws.sourceLinks.filter((l) => l.movementId === row.createdMovementId);
          const otherSources = linksToMov.filter((l) => l.batchId !== batch.id);
          if (otherSources.length > 0) {
            preservedShared += 1;
          } else {
            const mov = ws.movements.find((m) => m.id === row.createdMovementId);
            if (mov) {
              mov.isDeleted = true;
              if (mov.eventId) {
                const ev = ws.events.find((e) => e.id === mov.eventId);
                if (ev) ev.isDeleted = true;
              }
              revertedCount += 1;
            }
          }
        }
      }

      ws.sourceLinks = ws.sourceLinks.filter((l) => l.batchId !== batch.id);
      ws.externalIdentities = ws.externalIdentities.filter(
        (ei) => !batch.rows.some((r) => r.createdMovementId === ei.movementId && !ws.sourceLinks.some((l) => l.movementId === ei.movementId))
      );
      batch.status = 'reverted';
      appendAudit(ws, 'import_batch', batch.id, 'undo', undefined, { revertedCount, preservedShared });
      saveStore(store);
      res.json({ batch, revertedCount, preservedShared });
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

      if (req.useSupabase) {
        const obligation = await sbCreateObligation(req.sbUser!, req.sbAdmin || null, req.userId!, req.body || {});
        res.status(201).json({ obligation });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const ob: Obligation = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        direction: direction === 'receivable' ? 'receivable' : 'payable',
        description: String(description).trim(),
        dueDate: dueDate || todayCivilSaoPaulo(),
        competenceDate: competenceDate || dueDate || todayCivilSaoPaulo(),
        originalCents,
        canceledCents: 0,
        status: 'expected',
        accountId: accountId || undefined,
        categoryId: categoryId || undefined,
        version: 1,
      };
      ws.obligations.push(ob);
      appendAudit(ws, 'obligation', ob.id, 'create');
      saveStore(store);
      res.status(201).json({ obligation: ob });
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

      if (req.useSupabase) {
        const recurrence = await sbCreateRecurrence(req.sbUser!, req.userId!, req.body || {});
        res.status(201).json({ recurrence });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const rec: Recurrence = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        direction: direction === 'receivable' ? 'receivable' : 'payable',
        description: String(description).trim(),
        amountCents,
        frequency: frequency === 'weekly' || frequency === 'yearly' ? frequency : 'monthly',
        anchorDay: Number(anchorDay) || Number((startDate || todayCivilSaoPaulo()).split('-')[2]) || 1,
        startDate: startDate || todayCivilSaoPaulo(),
        endDate: endDate || undefined,
        accountId: accountId || undefined,
        categoryId: categoryId || undefined,
        isActive: true,
      };
      ws.recurrences.push(rec);

      const horizon = '2027-12-31';
      const dates = generateRecurrenceDates(rec, horizon).slice(0, 6);
      for (const dt of dates) {
        const exists = ws.obligations.some((o) => o.recurrenceId === rec.id && o.dueDate === dt);
        if (!exists) {
          ws.obligations.push({
            id: crypto.randomUUID(),
            ownerId: req.userId!,
            direction: rec.direction,
            description: rec.description,
            dueDate: dt,
            competenceDate: dt,
            originalCents: rec.amountCents,
            canceledCents: 0,
            status: 'expected',
            accountId: rec.accountId,
            categoryId: rec.categoryId,
            recurrenceId: rec.id,
            version: 1,
          });
        }
      }
      saveStore(store);
      res.status(201).json({ recurrence: rec });
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

      if (req.useSupabase) {
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
        return;
      }

      const idem = checkLocalIdempotency(req, res);
      if (idem === '__HIT__') return;

      const ws = getWorkspace(req.userId!);
      const ob = ws.obligations.find((o) => o.id === req.params.id && o.ownerId === req.userId);
      if (!ob) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Obrigação não encontrada.' });
        return;
      }

      const alreadyPaid = ws.settlements
        .filter((s) => s.obligationId === ob.id)
        .reduce((acc, s) => acc + s.allocatedCents, 0);
      const open = Math.max(0, ob.originalCents - ob.canceledCents - alreadyPaid);
      if (amountCents > open) {
        res.status(400).json({ code: 'EXCEEDS_OPEN', message: 'Valor supera o saldo em aberto desta obrigação.' });
        return;
      }

      let movementId = existingMovementId;
      if (!movementId) {
        const acc = ws.accounts.find((a) => a.id === accountId && a.ownerId === req.userId);
        if (!acc) {
          res.status(400).json({ code: 'INVALID_ACCOUNT', message: 'Conta pagadora/recebedora inválida.' });
          return;
        }
        const evId = crypto.randomUUID();
        movementId = crypto.randomUUID();
        const effDate = effectiveDate || todayCivilSaoPaulo();
        ws.events.push({
          id: evId,
          ownerId: req.userId!,
          nature: ob.direction === 'receivable' ? 'income' : 'expense',
          description: `Liquidação: ${ob.description}`,
          competenceDate: ob.competenceDate,
          magnitudeCents: amountCents,
          currency: 'BRL',
          categoryId: ob.categoryId,
          tags: [],
          isDeleted: false,
          version: 1,
        });
        ws.movements.push({
          id: movementId,
          ownerId: req.userId!,
          accountId: acc.id,
          eventId: evId,
          signedCents: ob.direction === 'receivable' ? amountCents : -amountCents,
          effectiveDate: effDate,
          description: `Liquidação: ${ob.description}`,
          origin: 'manual',
          reviewStatus: ob.categoryId ? 'reviewed' : 'pending_category',
          reconciliationStatus: 'unreconciled',
          isDeleted: false,
          version: 1,
          createdAt: new Date().toISOString(),
        });
      }

      const settlement = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        obligationId: ob.id,
        movementId,
        allocatedCents: amountCents,
        createdAt: new Date().toISOString(),
      };
      ws.settlements.push(settlement);

      const newPaid = alreadyPaid + amountCents;
      ob.status = newPaid >= ob.originalCents - ob.canceledCents ? 'settled' : 'partially_settled';
      ob.version += 1;

      appendAudit(ws, 'obligation', ob.id, 'settle', undefined, { amountCents });
      const payload = { obligation: ob, settlement };
      recordLocalIdempotency(req.userId!, idem, payload);
      saveStore(store);
      res.status(201).json(payload);
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

      if (req.useSupabase) {
        const out = await sbUpsertBudget(req.sbUser!, req.userId!, req.body || {});
        res.status(out.status).json({ budget: out.budget });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const existing = ws.budgets.find((b) => b.monthKey === monthKey && b.categoryId === categoryId);
      if (existing) {
        existing.limitCents = limitCents;
        existing.alertThresholdPct = Number(alertThresholdPct) || 80;
        existing.version += 1;
        saveStore(store);
        res.json({ budget: existing });
        return;
      }
      const budget: Budget = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        monthKey,
        categoryId,
        limitCents,
        alertThresholdPct: Number(alertThresholdPct) || 80,
        version: 1,
      };
      ws.budgets.push(budget);
      saveStore(store);
      res.status(201).json({ budget });
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

      if (req.useSupabase) {
        const goal = await sbCreateGoal(req.sbUser!, req.userId!, req.body || {});
        res.status(201).json({ goal });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const goal: Goal = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        name: String(name).trim(),
        targetCents,
        reservedCents: Number.isInteger(reservedCents) && reservedCents >= 0 ? reservedCents : 0,
        deadlineDate: deadlineDate || undefined,
        version: 1,
      };
      ws.goals.push(goal);
      saveStore(store);
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

      if (req.useSupabase) {
        const out = await sbContributeGoal(req.sbUser!, req.userId!, req.params.id, amountCents, note);
        res.status(out.status).json(out.payload);
        return;
      }

      const ws = getWorkspace(req.userId!);
      const goal = ws.goals.find((g) => g.id === req.params.id && g.ownerId === req.userId);
      if (!goal) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Meta não encontrada.' });
        return;
      }
      const nextReserved = goal.reservedCents + amountCents;
      if (nextReserved < 0) {
        res.status(400).json({ code: 'NEGATIVE_RESERVE', message: 'Reserva da meta não pode ficar negativa.' });
        return;
      }
      if (amountCents > 0) {
        const totalLiquidity = ws.accounts
          .filter((a) => !a.isArchived && a.includeInLiquidity && a.type !== 'credit_card' && a.openingBalanceKnown)
          .reduce((acc, a) => acc + (computeAccountBalance(a, ws.movements, ws.reconciliations).balanceCents ?? 0), 0);
        const totalReservedAfter = ws.goals.reduce((acc, g) => acc + g.reservedCents, 0) + amountCents;
        if (totalReservedAfter > totalLiquidity) {
          res.status(400).json({
            code: 'EXCEEDS_LIQUIDITY',
            message: 'Não é possível reservar em metas um valor superior ao saldo líquido disponível.',
          });
          return;
        }
      }

      goal.reservedCents = nextReserved;
      goal.version += 1;
      ws.goalContributions.push({
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        goalId: goal.id,
        amountCents,
        contributionDate: todayCivilSaoPaulo(),
        note: note || undefined,
      });
      saveStore(store);
      res.json({ goal });
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

      if (req.useSupabase) {
        const category = await sbCreateCategory(req.sbUser!, req.userId!, req.body || {});
        res.status(201).json({ category });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const cat: Category = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        parentId: parentId || undefined,
        name: String(name).trim(),
        kind: kind === 'income' ? 'income' : 'expense',
        essentiality: essentiality || 'unassigned',
        isArchived: false,
      };
      ws.categories.push(cat);
      saveStore(store);
      res.status(201).json({ category: cat });
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

      if (req.useSupabase) {
        const rule = await sbCreateCategoryRule(req.sbUser!, req.userId!, req.body || {});
        res.status(201).json({ rule });
        return;
      }

      const ws = getWorkspace(req.userId!);
      const rule: CategoryRule = {
        id: crypto.randomUUID(),
        ownerId: req.userId!,
        priority: Number(priority) || 50,
        matchText: String(matchText).trim(),
        targetCategoryId,
        isActive: true,
      };
      ws.categoryRules.push(rule);
      saveStore(store);
      res.status(201).json({ rule });
    })
  );

  app.post(
    '/api/insights/:id/dismiss',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      if (req.useSupabase) {
        await sbDismissInsight(req.sbAdmin || null, req.userId!, req.params.id);
        res.json({ ok: true });
        return;
      }

      const ws = getWorkspace(req.userId!);
      if (!ws.dismissedInsightIds.includes(req.params.id)) {
        ws.dismissedInsightIds.push(req.params.id);
        saveStore(store);
      }
      res.json({ ok: true });
    })
  );

  // Exportação pessoal (pacote versionado sem credenciais Auth) e Restauração em espaço próprio
  app.get(
    '/api/exports/package',
    requireAuth,
    asyncRoute(async (req: AuthedRequest, res) => {
      const ws = req.useSupabase
        ? await loadWorkspaceFromSupabase(req.sbUser!, req.userId!, req.userEmail!, req.userDisplayName)
        : getWorkspace(req.userId!);
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

      if (req.useSupabase) {
        const out = await sbRestorePackage(req.sbUser!, req.sbAdmin || null, req.userId!, pkg);
        res.status(out.status).json(out.payload);
        return;
      }

      const ws = getWorkspace(req.userId!);
      if (ws.accounts.length > 0 || ws.movements.length > 0) {
        res.status(409).json({
          code: 'WORKSPACE_NOT_EMPTY',
          message: 'Na versão atual, a restauração pessoal exige uma conta/espaço vazio para evitar sobrescrita acidental.',
        });
        return;
      }

      const ownerId = req.userId!;
      ws.accounts = (pkg.data.accounts || []).map((a: Account) => ({ ...a, ownerId }));
      ws.cards = (pkg.data.cards || []).map((c: Card) => ({ ...c, ownerId }));
      ws.categories = (pkg.data.categories || []).map((c: Category) => ({ ...c, ownerId }));
      ws.events = (pkg.data.events || []).map((e: FinancialEvent) => ({ ...e, ownerId }));
      ws.movements = (pkg.data.movements || []).map((m: AccountMovement) => ({ ...m, ownerId }));
      ws.transferGroups = (pkg.data.transferGroups || []).map((t: TransferGroup) => ({ ...t, ownerId }));
      ws.obligations = (pkg.data.obligations || []).map((o: Obligation) => ({ ...o, ownerId }));
      ws.budgets = (pkg.data.budgets || []).map((b: Budget) => ({ ...b, ownerId }));
      ws.goals = (pkg.data.goals || []).map((g: Goal) => ({ ...g, ownerId }));
      appendAudit(ws, 'backup', ownerId, 'personal_restore');
      saveStore(store);
      res.json({ ok: true, restoredAccounts: ws.accounts.length, restoredMovements: ws.movements.length });
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
      `Clareza Financeira rodando em http://0.0.0.0:${PORT} (modo: ${env.configured ? 'Supabase' : 'Local Dev Store'})`
    );
  });
}

startServer().catch((err) => {
  console.error('Erro ao iniciar servidor Clareza Financeira:', err);
  process.exit(1);
});
