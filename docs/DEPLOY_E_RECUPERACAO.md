# Clareza Financeira — Guia de Implantação Supabase, Publicação HTTPS e Recuperação

## 1. Arquitetura e Estado Atual
- **Domínio financeiro, parsers CSV/OFX, deduplicação e motor determinístico de insights**: Implementados e testados com `npm test` (`tsx --test`).
- **Migração SQL e RLS**: `supabase/migrations/0001_initial_schema.sql` contém todas as tabelas com `BIGINT` em centavos, `DATE`, `TIMESTAMPTZ`, `owner_id`, chaves estrangeiras compostas `(owner_id, id)`, políticas RLS (`auth.uid() = owner_id`) e RPCs `SECURITY DEFINER` com idempotência.
- **Testes de isolamento RLS**: `supabase/tests/rls_isolation.test.sql`.
- **Integração Supabase ativa**: Quando `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`VITE_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` estão configurados, `server.ts` + `src/lib/supabase/serverAdapter.ts` autenticam via Supabase Auth (cookies `HttpOnly`), executam leituras e gravações sob RLS (`auth.uid() = owner_id`) e `rpc_create_transfer`, registram trilha em `audit_logs` e armazenam extratos originais no bucket privado do Storage. O Ambiente Demonstrativo permanece isolado sem gravar no PostgreSQL real.

## 2. Configuração do Projeto Supabase (Produção)
1. Crie um projeto no Supabase (região recomendada próxima ao Brasil, ex.: `sa-east-1`).
2. Em **Authentication → Providers**, mantenha **Email** habilitado e desative cadastro público aberto (*Disable signups*) após provisionar sua conta pessoal.
3. Em **Authentication → URL Configuration**, cadastre sua URL HTTPS de produção e callbacks (`/auth/callback`).
4. Aplique a migração SQL:
   ```bash
   supabase db push --file supabase/migrations/0001_initial_schema.sql
   ```
5. Crie o bucket privado `clareza-extratos` no **Storage** (sem acesso público; policies restritas a `auth.uid() = owner_id`).
6. Configure as variáveis de ambiente no servidor de hospedagem (nunca exponha `SUPABASE_SERVICE_ROLE_KEY` em variáveis `VITE_*`):
   - `APP_URL=https://seu-dominio.com`
   - `VITE_SUPABASE_URL=...`
   - `VITE_SUPABASE_ANON_KEY=...`
   - `SUPABASE_URL=...`
   - `SUPABASE_SERVICE_ROLE_KEY=...`
   - `SUPABASE_STORAGE_BUCKET=clareza-extratos`

## 3. Publicação HTTPS e Worker
- Build de produção: `npm run build`
- Inicialização do servidor: `NODE_ENV=production npx tsx server.ts` (ou `npm start` com Node compatível com TypeScript/build transpilado).
- Worker de importações: `workers/importWorker.ts` preparado para execução em processo Node independente para lotes grandes.

## 4. Backup Operacional vs. Exportação Pessoal
1. **Exportação pessoal do usuário** (Configurações → Exportar pacote JSON): gera pacote estruturado v2.0 sem credenciais Auth e permite restauração validada em espaço vazio do próprio usuário.
2. **Backup operacional do banco PostgreSQL**: realizado pelo plano Supabase (PITR / snapshots diários conforme plano contratado). Não substitui cópia dos objetos do **Storage**, que devem ter rotina de replicação separada.
3. **Procedimento de recuperação**: restaurar o dump em instância isolada, validar integridade de saldos, ownership, RLS e login antes de qualquer troca em produção.

## 5. Checklist de Conclusão P0 e P1
- [x] Contas, saldo inicial/desconhecido, transferências atômicas, conciliação e edição auditada
- [x] Lançamentos manuais, busca, filtros, exportação CSV segura contra fórmulas
- [x] Importação CSV (UTF-8/BOM, Windows-1252, `;`/`,`/`\t`) e OFX (1.x SGML / 2.x XML com proteção XXE)
- [x] Deduplicação por hash, identidade externa (instituição+conta+FITID) e revisão lado a lado + desfazer lote
- [x] Cartões, limite estimado, parcelas exatas em centavos e pagamento de fatura sem duplicar consumo
- [x] Agenda financeira, vencidos, recorrências (dia 31 ajustado) e liquidação parcial/total
- [x] Orçamentos mensais, metas com reservas virtuais e proteção contra superalocação
- [x] Motor determinístico de insights com cálculo, período, evidências e dispensa
- [x] PWA instalável (manifest, ícones PNG 192/512/maskable/apple-touch-icon, service worker estrito)
- [ ] Pendente para produção externa: provisionamento do projeto Supabase real, execução dos testes SQL `rls_isolation.test.sql` contra instância real e teste em dispositivo móvel via rede 4G/5G após deploy HTTPS.
