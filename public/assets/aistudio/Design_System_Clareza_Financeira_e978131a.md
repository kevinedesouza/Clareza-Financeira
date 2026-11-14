# CLAREZA FINANCEIRA — DESIGN SYSTEM

**Versão 1.0 · Gestão financeira pessoal · Desktop + Mobile/PWA**

Documento visual complementar ao PRD Mobile + Supabase versão 2.0. “Clareza Financeira” é o nome provisório. Esta especificação detalha a seção visual do PRD; mantém suas regras financeiras e seu escopo funcional.

## 1. Direção visual

Criar uma identidade premium, moderna e acolhedora para organizar contas, entender gastos e planejar o dinheiro. A interface deve transmitir confiança, clareza, tranquilidade e controle, sem pressionar ou julgar o usuário.

**Conceito: clareza para decidir.** Um painel financeiro pessoal com precisão nos dados, hierarquia evidente e ações simples.

A base estrutural do SHOP25 é adaptada: navegação consistente, tabelas legíveis, formulários claros e componentes reutilizáveis. Aqui, os protagonistas são saldo, movimentações, compromissos, metas e insights.

**Assinatura visual:** azul profundo na navegação, azul vivo nas ações, superfícies claras, valores bem alinhados e um card de saldo com destaque discreto. Separar sempre a situação do dinheiro da qualidade dos dados.

Evitar gradientes decorativos, glassmorphism, sombras pesadas, ilustrações genéricas de moedas, dashboards congestionados e aparência de banco que permita movimentar dinheiro. O produto registra e analisa; botões devem dizer “Registrar pagamento”, não “Pagar agora”.

## 2. Paleta semântica

### Tema claro

| Token | HEX | Aplicação |
|---|---|---|
| Brand / Navigation | #172554 | Sidebar e destaque institucional |
| Primary | #2955D9 | Ação principal, links e seleção |
| Primary Hover | #2348B8 | Hover da ação principal |
| Primary Pressed | #1E3A8A | Ação pressionada |
| Primary Soft | #EEF2FF | Fundo de seleção |
| Background | #F5F7FB | Fundo geral |
| Surface | #FFFFFF | Cards, tabelas e formulários |
| Surface Muted | #F1F5F9 | Áreas secundárias e cabeçalhos |
| Text Primary | #162033 | Conteúdo principal |
| Text Secondary | #526078 | Descrições e metadados |
| Border Subtle | #E2E8F0 | Divisórias decorativas |
| Border Control | #7B8798 | Limites de controles quando necessários para identificá-los |
| Success / Income | #087F5B | Receitas e confirmação |
| Success Soft | #ECFDF5 | Fundo de receita/confirmado |
| Danger / Expense | #B42318 | Saídas, erros e ação destrutiva |
| Danger Soft | #FEF3F2 | Fundo de erro/saída |
| Warning | #946200 | Revisões e atenção |
| Warning Soft | #FFFBEB | Fundo de pendência |
| Info / Transfer | #2955D9 | Transferência e informação |
| Goal | #6D28D9 | Metas e reservas |
| Goal Soft | #F5F3FF | Fundo de metas |

Não usar o amarelo comercial do SHOP25 como destaque geral. Neste produto, âmbar fica reservado a situações que pedem atenção; roxo diferencia metas sem competir com alertas.

### Tema escuro

| Token | HEX |
|---|---|
| Background | #0B1220 |
| Surface | #131D2F |
| Surface Muted | #1C2940 |
| Navigation | #0F172A |
| Text Primary | #E7EDF7 |
| Text Secondary | #A8B5C9 |
| Border Subtle | #30415B |
| Border Control | #73849D |
| Primary | #8BABFF |
| Primary Hover | #A8BFFF |
| Primary Pressed | #7295EF |
| Primary Soft | #1A2D50 |
| Text On Primary | #0B1220 |
| Success / Income | #6EE7B7 |
| Danger / Expense | #FDA29B |
| Warning | #FCD34D |
| Goal | #C4B5FD |

Usar fundos semânticos escuros próprios: sucesso #102F2A, erro #351F29, aviso #322B18 e meta #2A2142. Tema claro/escuro/sistema disponível em Configurações. Não inverter cores automaticamente.

### Significado financeiro

- Receita: sinal “+”, texto “Receita”, ícone de entrada e verde.
- Despesa: sinal “−”, texto “Despesa”, ícone de saída e vermelho discreto. Uma despesa normal não recebe alerta de erro.
- Transferência: ícone de setas e azul; nunca representar como ganho.
- Previsto: badge “Previsto”, estilo neutro e projeções tracejadas; não usar verde de confirmação.
- Divergência: aviso textual com diferença em reais e ação de conferir.
- Saldo desconhecido: “Não validado”; nunca R$ 0,00 fictício.
- Tendência: aumento de despesa não é positivo só porque a seta aponta para cima. Interpretar a métrica e exibir comparação.

## 3. Tipografia

**Fonte principal:** Inter, servida com o aplicativo, com fallback de sistema. **Fonte monoespaçada:** Geist Mono opcional apenas para identificadores/referências técnicas. Valores financeiros usam Inter com números tabulares.

| Elemento | Desktop | Mobile | Peso |
|---|---|---|---|
| Título de página | 28 px / 36 px | 24 px / 32 px | 700 |
| Título de seção | 20 px / 28 px | 18 px / 26 px | 600 |
| Título de card | 16 px / 24 px | 16 px / 24 px | 600 |
| Texto principal | 14 px / 22 px | 16 px / 24 px | 400 |
| Texto secundário | 13 px / 20 px | 14 px / 20 px | 400 |
| Label | 12 px / 18 px | 13 px / 20 px | 500 |
| KPI | 32–36 px / 40 px | 28–32 px / 36 px | 700 |
| Saldo em destaque | 40 px / 48 px | 32 px / 40 px | 700 |
| Campo de formulário | 14 px / 22 px | 16 px / 24 px | 400 |

Valores alinhados à direita em tabelas; títulos e descrições à esquerda. BRL como R$ 1.234,56. Evitar abreviações em telas de conferência. Se o valor não couber, adaptar o layout; não esconder centavos relevantes nem cortar valores.

## 4. Espaçamento, dimensões e elevação

Escala: 4, 8, 12, 16, 20, 24, 32, 40 e 48 px.

| Elemento | Desktop | Mobile |
|---|---|---|
| Margem da página | 24–32 px | 16 px |
| Padding de card | 24 px | 16–20 px |
| Gap entre cards | 16–24 px | 12–16 px |
| Gap entre seções | 32 px | 24 px |
| Input/botão padrão | 40 px | 48 px |
| Botão principal grande | 48 px | 48–52 px |
| Linha/lista de lançamento | 52–56 px | 72 px mínimo, cresce com conteúdo |
| Sidebar expandida/recolhida | 256 / 72 px | Não se aplica |
| Header | 64 px | 56–64 px |
| Navegação inferior | Não se aplica | 64 px + safe area |

Alvos de toque de pelo menos 44 × 44 px, inclusive ícones. Inputs/botões: radius 8 px; cards: 12 px; modal: 16 px; bottom sheet: 20 px nos cantos superiores; badges: pill.

Cards usam borda sutil de 1 px. Campos usam borda que permita identificá-los. Sombra leve: 0 2px 8px rgba(15,23,42,.04); menus: 0 8px 24px rgba(15,23,42,.10). Elevação reservada a sobreposição.

## 5. Layout responsivo

| Faixa proposta | Comportamento |
|---|---|
| 360–767 px | Mobile, uma coluna principal, navegação inferior, cards/listas e formulários de largura total |
| 768–1199 px | Tablet, duas colunas quando úteis, navegação inferior; adaptação conforme conteúdo |
| A partir de 1200 px | Desktop, sidebar, tabelas completas e grid de 12 colunas |

Conteúdo analítico com largura confortável próxima de 1440 px; tabelas podem aproveitar área maior. Não vincular funcionalidade a um breakpoint: todas as ações essenciais existem em todas as faixas.

Mobile: **Início · Lançamentos · Adicionar · Agenda · Mais**. “Adicionar” abre escolhas Receita, Despesa e Transferência. Importar fica disponível em Mais e nos atalhos das telas pertinentes. Não duplicar um FAB sobre o botão central.

Mais: Contas, Cartões, Importações, Orçamentos, Metas, Insights, Relatórios e Configurações. Desktop usa menu completo, agrupado em visão financeira, planejamento e administração pessoal.

## 6. Componentes fundamentais

| Grupo | Componentes |
|---|---|
| Navegação | Sidebar, topbar, navegação inferior, menu Mais, breadcrumb no desktop, busca e perfil |
| Contexto | Seletor de período, filtro de contas, seletor de base Caixa/Competência, chips de filtro, atualização e qualidade |
| Indicadores | Card de saldo, KPI, tendência, cobertura dos dados e pendências |
| Operação | Tabela/lista de lançamentos, painel de detalhe, rateio, transferência e registro de liquidação |
| Planejamento | Card de orçamento, barra de meta, calendário, lista de vencimentos, compromisso de parcelas |
| Importação | Seletor de arquivo, stepper, mapeador CSV, preview, comparação de duplicatas, progresso e relatório de lote |
| Formulários | Input monetário, descrição, conta, categoria, combobox, data, switch, checkbox, textarea, validação e upload |
| Feedback | Alert, toast, dialog, drawer, bottom sheet, skeleton, vazio, erro e confirmação |
| Confiança | Badge de origem Manual/CSV/OFX, conciliação, evidências de insight, histórico e status de conexão |

Componentes devem compartilhar tokens, variantes e estados. Se a implementação adotar shadcn/ui/Radix UI, customizar conforme este sistema; usar a aparência padrão da biblioteca não conclui o design.

## 7. Hierarquia de botões e estados

| Variante | Aparência | Uso |
|---|---|---|
| Primary | Fundo Primary + texto branco no claro; texto escuro no tema escuro | Salvar lançamento, confirmar importação |
| Secondary | Superfície + borda + texto principal | Importar extrato, exportar, editar |
| Ghost | Sem fundo persistente | Voltar, detalhes, ações auxiliares |
| Destructive | Fundo Danger + texto branco no claro; contraste adequado no escuro | Confirmar exclusão/reversão depois da revisão |
| Icon | Ícone com nome acessível e tooltip no desktop | Ocultar valores, abrir filtros, mais opções |

Uma ação principal por região de decisão. Evitar dois botões primários competindo no mesmo formulário. Ações destrutivas ficam separadas e explicam o impacto.

Estados obrigatórios: padrão, hover, pressed, focus-visible, disabled, loading, erro e sucesso quando aplicável. Foco com anel de 2 px e offset; disabled não depende só de opacidade. Carregamento mantém largura e texto, com indicador de progresso. Toast complementa, sem substituir erro no campo.

## 8. Dashboard e hierarquia da informação

**Topo:** título “Visão geral”, período, filtro de contas, estado de atualização e ação “Novo lançamento”. “Importar extrato” é secundária.

**Primeira linha:** Saldo disponível, Receitas recebidas, Despesas pagas e Resultado de caixa. Cada card apresenta base/período, valor, comparação e acesso à composição.

**Segunda linha:** Evolução de caixa com destaque maior; Gastos por categoria com etiqueta “Por competência”. Não sugerir que ambos usam a mesma base.

**Terceira linha:** Próximos vencimentos, orçamentos prioritários e metas. **Insights:** até três sugestões relevantes. **Qualidade:** pendências de conciliação/importação visíveis, com acesso à revisão.

Mobile: saldo primeiro, receitas/despesas em dois cards quando couberem sem corte, resultado em seguida; gráfico, vencimentos e insights. Relatórios detalhados ficam a um toque.

Card de saldo pode usar fundo azul profundo e texto branco. Demais cards permanecem neutros. Não colorir superfícies inteiras de vermelho para despesas comuns.

## 9. Padrões de operação financeira

### Lançamentos

Desktop: Data, Descrição, Conta, Categoria, Valor, Situação, Origem e ações. Valor e saldo alinhados à direita. Header e ações de seleção mantêm contexto.

Mobile: primeira linha descrição/valor; segunda linha conta/categoria; data e situação complementares. Toque abre detalhe; gestos não são o único meio de editar/excluir.

Separar chips de três dimensões: natureza (Receita/Despesa/Transferência), situação (Previsto/Liquidado/Parcial/Vencido/Cancelado) e qualidade (Conciliado/Pendente/Divergência). Evitar um badge “OK” que esconda diferenças.

### Formulário

Ordem: tipo → valor → descrição → conta → data → categoria → opções avançadas. Transferência mostra origem/destino; liquidação distingue valor total e valor pago. Erros junto ao campo, sem apagar os dados digitados.

### Contas e cartões

Conta: nome, tipo, saldo e data de atualização; identificação mascarada. Cartão: fatura, vencimento, parcelas e limite estimado identificado como estimativa. Cor escolhida para conta não redefine semântica de receita/despesa.

### Orçamentos e metas

Orçamento mostra valor gasto/limite e percentual; marcas em 80% e 100%. Acima de 100%, barra pode limitar desenho, mas texto mostra percentual real e excesso em reais.

Meta usa roxo, objetivo, reservado, prazo e contribuição. Reserva virtual não aparece como despesa. Evitar termômetros que escondam valores exatos.

## 10. Importação CSV e OFX

Stepper: **Arquivo → Conta e formato → Revisão → Confirmação → Resultado**. OFX pula mapeamento manual quando identificado corretamente, mantendo revisão.

Upload com área de arrastar no desktop e botão “Escolher arquivo” em todos os dispositivos. Exibir nome, tamanho, progresso e possibilidade de retomar consulta a lote já aceito.

Preview mostra data, descrição, valor, conta, categoria sugerida e status. Resumo informa quantidade e totais de válidos, vinculados, ignorados e rejeitados; categorias mutuamente exclusivas por linha.

Duplicatas: comparação lado a lado no desktop e cards empilhados no mobile; escolhas “Já existe”, “É outro lançamento” e “Vincular ao manual”. Nunca resolver conflito apenas por cor.

Antes de confirmar: texto “Os lançamentos só afetarão seus saldos após a confirmação”. Resultado mostra números reais e links “Ver lançamentos” e “Conferir saldo”. Sem sucesso fictício durante processamento.

## 11. Gráficos e insights

- Linha contínua: realizado; tracejada: projetado; legenda textual e data divisória.
- Barras horizontais: categorias; ordenação clara, valores exatos e acesso às transações.
- Eixo zero em comparações por barras. Não exagerar visualmente variações pequenas.
- Não depender de hover: toque/foco e tabela alternativa devem revelar valores.
- Histórico neutro e período atual destacado. Categorias usam paleta própria, sem reutilizar todas as cores como severidades.
- Valores negativos preservam sinal. Percentual sem base válida vira “Sem base de comparação”.

Insight: título → observação → evidência/período → ação. Badge “Estimativa” quando pertinente. Ações: “Ver lançamentos”, “Revisar orçamento”, “Dispensar”.

Exemplo demonstrativo: “Mercado aumentou R$ 180 em relação ao mesmo intervalo anterior”. Evitar linguagem acusatória como “Você está gastando errado”. Sem dados suficientes: “Importe mais períodos para comparar seus gastos”.

## 12. Conexão, salvamento e privacidade

| Estado | Mensagem/ação |
|---|---|
| Consultando | “Atualizando dados…” |
| Atualizado | “Atualizado às 14:32” com horário real da consulta |
| Gravando | “Salvando…”; bloquear submissão repetida |
| Confirmado | “Lançamento salvo” após confirmação do servidor |
| Resposta incerta | “Não foi possível confirmar. Verifique o status antes de tentar novamente” |
| Offline | “Sem conexão. Conecte-se para consultar e salvar” |
| Conflito | “Este lançamento foi alterado em outro dispositivo. Recarregue para revisar” |
| Sessão expirada | “Entre novamente para continuar” |

Modo privacidade oculta valores em cards, listas, gráficos e tooltips com placeholders consistentes; anúncio acessível “Valor oculto”. Não é criptografia. Dados atualizados dependem de conexão; PWA não promete edição offline.

Supabase é infraestrutura: telas comuns não mostram SQL, RLS, jobs ou chaves. Mostrar consequências compreensíveis, como “Processando arquivo” e “Dados salvos”.

## 13. Acessibilidade e movimento

Meta de design: texto comum com contraste de pelo menos 4,5:1; texto grande, limites relevantes e indicadores de foco com pelo menos 3:1 no contexto aplicável. Validar combinações reais, incluindo charts e estados. Bordas meramente decorativas podem ser sutis.

Labels persistentes, erros associados aos campos, ordem de foco lógica, modal com foco controlado e retorno ao acionador. Compatibilidade com ampliação de texto; não bloquear zoom. Não usar só ícone/cor para transmitir informação.

Transições de 150–220 ms; drawers de até 240 ms, sem bouncing. Respeitar redução de movimento. Não fazer animação contínua de moedas, números ou saldos. Skeleton deve corresponder ao conteúdo que vai aparecer.

## 14. Tokens CSS iniciais

```css
:root {
  --color-brand: #172554;
  --color-primary: #2955D9;
  --color-primary-hover: #2348B8;
  --color-primary-pressed: #1E3A8A;
  --color-primary-soft: #EEF2FF;
  --color-on-primary: #FFFFFF;
  --color-bg: #F5F7FB;
  --color-surface: #FFFFFF;
  --color-surface-muted: #F1F5F9;
  --color-text: #162033;
  --color-text-secondary: #526078;
  --color-border: #E2E8F0;
  --color-control-border: #7B8798;
  --color-income: #087F5B;
  --color-expense: #B42318;
  --color-warning: #946200;
  --color-transfer: #2955D9;
  --color-goal: #6D28D9;
  --color-income-soft: #ECFDF5;
  --color-expense-soft: #FEF3F2;
  --color-warning-soft: #FFFBEB;
  --color-goal-soft: #F5F3FF;
  --radius-control: 8px;
  --radius-card: 12px;
  --radius-dialog: 16px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --motion-fast: 150ms;
  --motion-base: 220ms;
}
[data-theme="dark"] {
  --color-brand: #0F172A;
  --color-primary: #8BABFF;
  --color-primary-hover: #A8BFFF;
  --color-primary-pressed: #7295EF;
  --color-primary-soft: #1A2D50;
  --color-on-primary: #0B1220;
  --color-bg: #0B1220;
  --color-surface: #131D2F;
  --color-surface-muted: #1C2940;
  --color-text: #E7EDF7;
  --color-text-secondary: #A8B5C9;
  --color-border: #30415B;
  --color-control-border: #73849D;
  --color-income: #6EE7B7;
  --color-expense: #FDA29B;
  --color-warning: #FCD34D;
  --color-transfer: #8BABFF;
  --color-goal: #C4B5FD;
  --color-income-soft: #102F2A;
  --color-expense-soft: #351F29;
  --color-warning-soft: #322B18;
  --color-goal-soft: #2A2142;
}
.financial-value {
  font-variant-numeric: tabular-nums lining-nums;
}
@media (prefers-reduced-motion: reduce) {
  :root { --motion-fast: 0ms; --motion-base: 0ms; }
}
```

Tokens são a fonte de verdade visual. Componentes não devem repetir cores arbitrárias. O anel de foco deve ter contraste no fundo real, com offset que o distinga do próprio botão.

## 15. Prompt de aplicação visual

> Crie todas as telas do Clareza Financeira seguindo este Design System e o PRD Mobile + Supabase versão 2.0. Preserve identidade azul profundo/azul vivo, superfícies claras, tema escuro próprio, tipografia Inter e valores tabulares. Implemente o mesmo produto em desktop e mobile/PWA, com sidebar no desktop e navegação inferior Início, Lançamentos, Adicionar, Agenda e Mais. Construa componentes reutilizáveis e todos os seus estados. Inclua contas, cartões, importações CSV/OFX, lançamentos manuais, orçamento, metas, agenda, relatórios e insights explicáveis. Separe caixa, competência e projeção nos rótulos; não confunda transferência com receita nem despesa normal com erro. Priorize clareza dos números, revisão de importações, salvamento confirmado e acessibilidade. Use exemplos apenas em ambiente demonstrativo identificado. O design deve ser funcional, consistente e pronto para implementação, sem alterar regras financeiras do PRD.

## 16. Checklist de aprovação visual

- Desktop e mobile cobrem os mesmos fluxos essenciais.
- Todos os números, estados e períodos são legíveis e explícitos.
- Sem transbordamento de página a 360 px; sem corte de valores monetários.
- Teclado aberto e safe areas não escondem ações no mobile.
- Tema escuro tem tokens próprios e contraste verificado.
- Foco, erro, carregamento, offline e conflito têm comportamento definido.
- Gráficos têm alternativa textual/tabular e não dependem de hover.
- Importações podem ser revisadas e confirmadas pelo celular.
- Valores ocultos permanecem ocultos em tooltip/listas/gráficos.
- Nenhum detalhe de infraestrutura aparece no fluxo comum sem utilidade ao usuário.

Este documento é uma especificação de design; não afirma que as telas já foram implementadas ou testadas em dispositivos.
