# Auditoria de Usabilidade e Responsividade — Clareza Financeira

Data: 15/11/2026

## 1. Resumo executivo

**Veredito: pronto para uso, com o teste final no Supabase real pendente. Nota de prontidão: 8,5/10.**

Duas rodadas de correção. Na primeira: responsividade, exclusão com senha, metas e orçamentos editáveis. Na segunda: tudo o que estava listado como bloqueador, alto e a maior parte do médio. Hoje o usuário consegue criar, corrigir, cancelar, arquivar e excluir tudo o que cadastra. Também recupera a senha sozinho, protege o app com PIN e conta com "Desfazer" depois das ações principais.

**O que ainda falta antes de liberar:**
1. Testar contra o Supabase real (senha nas exclusões, recuperação de senha por e-mail, edição na agenda). Neste ambiente só deu para testar com servidor simulado.
2. Cadastrar `https://seu-dominio/redefinir-senha` nas Redirect URLs do Supabase (passo descrito em `docs/DEPLOY_E_RECUPERACAO.md`).
3. Itens restantes de backlog: M5, M7 e L1–L4.

## 2. Visão geral do sistema

- **Tecnologias:** React 19, Vite 8, Tailwind 4, Express (`server.ts`), Supabase (Auth, Postgres com RLS), PWA.
- **Módulos:** Visão geral, Lançamentos, Contas, Cartões, Importações CSV/OFX, Agenda, Orçamentos e metas, Insights, Relatórios, Configurações.
- **Perfil:** usuário titular, uso pessoal com um único perfil.
- **Como foi avaliado:** leitura do código e execução real do front-end com dados simulados. As 10 telas foram fotografadas em celular (375px), tablet (820px), notebook (1100px) e desktop (1440px), e cada página foi verificada automaticamente quanto a rolagem horizontal. Os fluxos de exclusão com senha foram testados com cliques automatizados.
- **O que não deu para verificar:** o comportamento com o Supabase real, porque não há credenciais neste ambiente. A conferência de senha no servidor (`requirePasswordConfirmation`) foi checada pela tipagem e pela interface simulada, mas não contra o Supabase.

## 3. Pontos fortes

- Valores em centavos inteiros, separação entre caixa e competência, e testes de domínio (14 testes passando).
- RLS por `owner_id` em todas as tabelas, auditoria (`audit_logs`), controle de versão nas edições de lançamentos.
- Modo privacidade, tema escuro, banner de sem conexão, PWA instalável.
- No celular: navegação inferior com botão "Adicionar" central, lançamentos em cartões e folhas que sobem de baixo.
- A importação CSV/OFX tem etapas, deduplicação e opção de desfazer.

## 4. Achados por severidade

### ✅ Corrigido nesta rodada

| # | Problema | Onde | Correção |
|---|---|---|---|
| C1 | Excluir um lançamento pelo detalhe apagava **na hora, sem nenhuma confirmação** | `TransactionsView.tsx` | Diálogo de confirmação com **senha da conta** |
| C2 | Exclusão em lote, de meta e de orçamento sem pedir senha | `server.ts`, telas | O servidor exige e confere a senha (`requirePasswordConfirmation`), com bloqueio de 15 min após 5 erros |
| C3 | Metas não podiam ser editadas nem excluídas | `PlanningView.tsx`, `server.ts` | Novos `PATCH /api/goals/:id` e `DELETE /api/goals/:id`, com botões de editar e excluir |
| C4 | Limites de orçamento não podiam ser removidos e editar não era claro | idem | Novo `DELETE /api/budgets/:id`, lápis que preenche o formulário, botão muda para "Atualizar limite" |
| C5 | Para retirar valor de uma meta era preciso digitar um número negativo | `PlanningView.tsx` | Escolha entre "Guardar" e "Retirar" |
| C6 | Paginação de metas e de regras não funcionava: listava tudo e a barra de páginas não fazia nada | `PlanningView.tsx`, `SettingsView.tsx` | Passou a usar os itens da página atual |
| C7 | Fim do mês fixo no dia 30 no cálculo de "Livre após metas" (errado em fevereiro e em meses de 31 dias) | `PlanningView.tsx` | Usa `daysInMonth` |
| C8 | Formulários de meta e orçamento sem rótulo visível ("mm/dd/yyyy" sem dizer o que era) | `PlanningView.tsx` | Rótulos "Nome da meta", "Valor-alvo", "Prazo (opcional)" etc. |
| C9 | Entre 1024 e 1279px (notebooks) aparecia a barra inferior do celular em vez do menu lateral | `AppShell.tsx` | Menu lateral a partir de 1024px |
| C10 | Tabela de lançamentos com 9 colunas espremida no tablet e no notebook (texto quebrado em 4 linhas) | `TransactionsView.tsx` | Cartões até 1280px e tabela só em telas largas |
| C11 | Etiquetas ("Pendente de revisão") vazando para fora da tela no celular, com rolagem horizontal | `TransactionsView.tsx` | As etiquetas passam para a linha de baixo |
| C12 | Passo-a-passo da importação com "Confirmação" e "Resultado" sobrepostos no celular | `ImportsView.tsx` | Números 1–5 e o texto "Passo X de 5: nome" |
| C13 | Valores em reais quebrando no meio ("−R$ / 2.390,29") | `Primitives.tsx` | Valores nunca quebram linha |
| C14 | Painel com 3 colunas apertadas no notebook | `DashboardView.tsx` | 2 colunas no tablet e no notebook, 3 só no desktop |
| C15 | "Cartão · Cartão Nubank…" repetido | `TransactionsView.tsx` | Prefixo só quando o nome não tem "cartão" |
| C16 | Folhas inferiores (Adicionar/Mais) não fechavam ao tocar fora nem com Esc, e "Mais" não ficava destacado quando a tela aberta estava dentro dele | `AppShell.tsx` | Corrigido, com área segura do iPhone respeitada |
| C17 | No celular não havia "selecionar todos" para exclusão em lote | `TransactionsView.tsx` | Caixa "Selecionar todos desta página" |
| C18 | Botões de paginação com 32px, pequenos para o dedo | `Pagination.tsx` | 40px no celular |
| C19 | Botões duplicados no topo do tablet (o "Adicionar" da barra inferior já existe) | `AppShell.tsx` | Atalhos do topo só a partir de 1024px |

### ✅ Corrigido na segunda rodada

| # | Item | O que foi feito |
|---|---|---|
| B1 | Agenda sem editar/cancelar/excluir | Editar valor, data, conta e categoria. "Cancelar" (ou "cancelar saldo restante" quando já houve pagamento), com Desfazer, e "Reabrir". Excluir com senha quando não há pagamento. Nova seção **Recorrências** com editar (vale para as próximas em aberto), pausar, retomar, data de término e excluir com senha. A paginação da agenda não funcionava e foi corrigida. Endpoints: `PATCH/DELETE /api/obligations/:id`, `PATCH/DELETE /api/recurrences/:id` |
| B2 | Sem recuperação de senha | "Esqueci minha senha" envia o link por e-mail (a resposta não revela se o e-mail existe). A tela `/redefinir-senha` cria a nova senha e já entra na conta, e trata link expirado. "Mostrar senha" nos campos. No celular, o formulário aparece antes do texto de apresentação |
| A1 | Categorias e regras só criáveis | Categoria: renomear, arquivar/reativar (com Desfazer) e excluir com senha, com opção de **mover os lançamentos para outra categoria**. Arquivadas somem dos seletores. Regra: ativar/desativar e excluir (com Desfazer) |
| A2 | Contas e cartões sem arquivar | "Arquivar" na edição, lista "arquivadas" com Reativar e Desfazer. O cartão arquiva também a conta de fatura. As paginações de contas e cartões tinham o mesmo bug e foram corrigidas |
| A3 | Lançamento sem corrigir valor/conta | Lançamentos manuais permitem trocar valor e conta. Importados e transferências mostram o motivo do bloqueio. Lançamento conciliado pede motivo. O servidor recusa a troca de sinal (despesa ↔ receita) |
| A4 | Desfazer/excluir lote sem senha | Os dois pedem senha, no app e no servidor |
| A5 | Sessão sem bloqueio | **PIN de 4–6 dígitos por aparelho** (hash PBKDF2 local), bloqueio após 1/5/15/30 min sem uso, saída da conta após 5 erros, "Esqueci o PIN" volta para a senha. Cookies de sessão com `Secure` em HTTPS e cabeçalhos `nosniff`, `X-Frame-Options` e `Referrer-Policy` |
| M1 | Títulos repetidos | Removidos. Ficou uma frase explicativa simples |
| M2 | Jargão técnico | "Caixa realizado" virou "Já na conta". "Por competência" virou "Pela data da compra" (com explicação ao passar o mouse). Abas de relatório renomeadas. "Moeda/Fuso" saiu da tela. Títulos de menu ficaram mais curtos |
| M3 | Sem desfazer | Aviso com **Desfazer** por 8s após excluir lançamento (um ou vários), cancelar conta, pausar recorrência e arquivar. Novo `POST /api/movements/restore` |
| M4 | Mensagens de sucesso inconsistentes | Aviso único (toast) em todas as telas alteradas |
| M6 | Sem guia de primeiro uso | Cartão **Primeiros passos** no painel: 6 etapas que se marcam sozinhas, com atalho para cada tela. Pode ser fechado |

### 🔴 Bloqueador (resolvido, ver acima)

**B1. Agenda: contas a pagar/receber e recorrências não podem ser editadas, canceladas nem excluídas**
- Eixo: Fluxos principais
- Onde: `AgendaView.tsx` (só "Liquidar"), `server.ts` (só existe `POST /api/obligations` e `POST /api/recurrences`)
- Problema: se o usuário erra o valor ou a data de uma conta, ou cancela uma assinatura, o item fica para sempre na agenda e nas projeções de saldo. As recorrências nem aparecem listadas para gerenciar.
- Sugestão: endpoints PATCH e DELETE (com senha) para obrigações; lista de recorrências com "Pausar", "Encerrar a partir de" e "Editar valor"; "Cancelar esta parcela" (o campo `canceledCents` já existe).
- Esforço: G

**B2. Sem recuperação de senha**
- Eixo: Segurança
- Onde: `AuthScreen.tsx`, `server.ts`
- Problema: quem esquece a senha fica sem acesso aos próprios dados.
- Sugestão: link "Esqueci minha senha" usando `supabase.auth.resetPasswordForEmail` e uma tela para definir a nova senha. Aproveitar para incluir "Mostrar senha" no campo.
- Esforço: M

### 🟠 Alto (resolvido, ver acima)

**A1. Categorias e regras não podem ser renomeadas, arquivadas ou excluídas**
- Onde: `SettingsView.tsx`, `server.ts` (só POST)
- Problema: um erro de digitação numa categoria fica para sempre em todos os seletores. Uma regra errada continua categorizando errado em toda importação.
- Sugestão: editar o nome e arquivar a categoria (com opção de mover os lançamentos para outra); ativar, desativar e excluir regras (o campo `isActive` já existe).
- Esforço: M

**A2. Contas e cartões não podem ser arquivados**
- Onde: `AccountsView.tsx`, `CardsView.tsx` (o PATCH não envia `isArchived`)
- Problema: uma conta encerrada ou um cartão cancelado continua aparecendo nos filtros e totais.
- Sugestão: botão "Arquivar" com senha. O campo `isArchived` já existe e as telas já filtram por ele.
- Esforço: P

**A3. Lançamento não permite corrigir valor nem conta**
- Onde: drawer de `TransactionsView.tsx`
- Problema: dá para editar descrição, data e categoria, mas um valor digitado errado obriga a excluir e lançar de novo.
- Sugestão: editar valor e conta em lançamentos manuais (no CSV/OFX, bloquear e explicar o motivo).
- Esforço: M

**A4. Desfazer ou excluir lote de importação sem senha**
- Onde: `ImportsView.tsx`, `/api/imports/:id/undo` e `DELETE /api/imports/:id`
- Problema: "Desfazer lote" remove dezenas de lançamentos de uma vez com uma confirmação simples.
- Sugestão: usar `requirePassword` no `ConfirmDialog` (o componente já suporta) e `requirePasswordConfirmation` no servidor.
- Esforço: P

**A5. Sessão de 30 dias sem bloqueio**
- Eixo: Segurança e privacidade
- Problema: em um app financeiro aberto no celular, qualquer pessoa com o aparelho na mão vê tudo.
- Sugestão: bloqueio por inatividade com PIN de 4–6 dígitos ou biometria (WebAuthn), além do modo privacidade.
- Esforço: G

### 🟡 Médio (M1–M4 e M6 resolvidos; M5 e M7 continuam)

- **M1. Título repetido:** o cabeçalho diz "Contas e conciliação" e logo abaixo há outro título igual (Contas, Cartões, Importações, Insights, Relatórios). Deixar um só, ou usar o de baixo como subtítulo explicativo. (P)
- **M2. Jargão técnico na tela:** "competência", "caixa realizado", "liquidez", "Moeda: BRL · Fuso: America/Sao_Paulo", "Insights verificáveis", "Fórmula". Trocar por frases simples ("Quando a compra foi feita" / "Quando o dinheiro saiu") e mostrar o termo técnico em uma dica (tooltip). (M)
- **M3. Sem "desfazer" depois de excluir:** a exclusão já é lógica (`is_deleted`), então um aviso "Lançamento excluído · Desfazer" por 8 segundos reduziria muito o medo de errar. (M)
- **M4. Mensagens de sucesso inconsistentes:** algumas telas confirmam ("Meta criada"), outras só fecham o formulário. Criar um componente único de aviso temporário (toast). (M)
- **M5. Atualização a cada 20s recarrega o workspace inteiro:** com muitos lançamentos isso pesa no celular e no plano de dados. Usar Supabase Realtime ou um endpoint "mudou desde X". (M)
- **M6. Primeiro uso:** não há um guia inicial ("1. Crie sua conta bancária → 2. Importe o extrato → 3. Revise categorias"). O estado vazio do painel ajuda, mas não conduz. (M)
- **M7. Histórico de reservas da meta:** `goal_contributions` é gravado, mas não aparece em lugar nenhum. (P)

### 🟢 Baixo

- **L1.** Na barra superior, o botão de privacidade tem só ícone. Vale mostrar o estado ("Valores ocultos") com mais clareza. (P)
- **L2.** A ação "Adicionar" no celular não oferece "Importar extrato", que hoje fica escondido em "Mais". (P)
- **L3.** Os gráficos não têm alternativa em texto para leitores de tela além da "Tabela alternativa" (que é boa); faltam `aria-label` nos SVGs. (P)
- **L4.** As caixas de seleção da tabela no desktop têm 16px. Aumentar a área clicável da célula. (P)

## 5. Plano de ação

**Antes da entrega:** testar no Supabase real com o checklist abaixo.

**Primeira semana:** M7 (histórico de reservas da meta).

**Backlog:** M5 (atualização incremental em vez de recarregar tudo a cada 20s), L1–L4.

## 6. Checklist de go-live

- [ ] Rodar `0001`–`0003` no Supabase de produção e o teste `supabase/tests/rls_isolation.test.sql`
- [ ] Testar a exclusão com senha contra o Supabase real (senha certa, errada e bloqueio após 5 tentativas)
- [ ] Cadastrar `/redefinir-senha` nas Redirect URLs do Supabase e testar a recuperação de senha com e-mail real
- [ ] Testar na agenda: editar, cancelar, reabrir, excluir; pausar/retomar/encerrar recorrência
- [ ] Testar arquivar/reativar conta, cartão e categoria; excluir categoria movendo lançamentos
- [ ] Testar em iPhone real (Safari, PWA instalado), Android real (Chrome) e tablet
- [ ] Conferir HTTPS, domínio e que os cookies de sessão chegam com `Secure` (DevTools → Application → Cookies)
- [ ] Ativar o PIN num celular real e conferir o bloqueio após o tempo escolhido
- [ ] Backup automático do Supabase ativado e restauração testada (`docs/DEPLOY_E_RECUPERACAO.md`)
- [ ] Remover dados de teste da base de produção
- [ ] Guia rápido de uso para o usuário final
