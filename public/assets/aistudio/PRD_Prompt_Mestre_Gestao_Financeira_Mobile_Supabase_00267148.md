# PRD + Prompt Mestre — Gestão Financeira • Mobile + Supabase

**Versão 2.0 · 14/11/2026 · Português do Brasil**

Especificação completa para construir um sistema pessoal de gestão financeira profissional, acessível por computador e celular, com Supabase/PostgreSQL como fonte única dos dados. Desenvolvimento em localhost e aplicação publicada em HTTPS para acesso remoto independente do computador.

**Estado da entrega:** PRD e prompt de implementação. O aplicativo ainda deverá ser desenvolvido. A análise e a homologação dos CSV e OFX reais continuam pendentes nesta revisão; não presumir cabeçalhos, sinais ou compatibilidade já validada.

**Como usar:** anexe este arquivo inteiro à ferramenta de desenvolvimento e peça: “Execute o Prompt Mestre da seção 18, utilizando todo este PRD como contrato de produto”. Para uma ferramenta apenas de design, use as seções 3, 10 e 11. Telas desenhadas não equivalem a um aplicativo funcional.

---

## 1. Visão e objetivo

Nome provisório: **Clareza Financeira**. Nome e identidade são editáveis.

O produto deve responder com números rastreáveis:

1. Quanto dinheiro tenho, em quais contas e até qual data os saldos estão atualizados?
2. Quanto recebi, quanto paguei e em que estou gastando?
3. Quanto já comprometi com contas, parcelas e faturas?
4. Como ficará meu caixa nos próximos 30, 60 e 90 dias?
5. Quais despesas cresceram, quais cobranças se repetem e o que posso revisar?
6. Quanto falta para minhas metas e quais limites estou ultrapassando?
7. Quais dados faltam para confiar nos resultados?

Indicadores devem abrir os lançamentos que explicam seus valores. Insights precisam de evidências, período, cálculo e ação possível. A prioridade é confiabilidade financeira acompanhada de facilidade de uso.

### Decisões da versão 2.0

- Supabase substitui SQLite como banco principal. Não manter dois bancos de produção nem implementar sincronização SQLite–Supabase nesta versão.
- Uma mesma conta de acesso consulta os mesmos dados no computador, Android e iPhone.
- Aplicativo web responsivo e PWA instalável quando o navegador permitir; aplicativo nativo de loja fica fora do escopo.
- Desenvolvimento continua em localhost. Uso remoto exige publicação da aplicação e backend; Supabase não substitui a hospedagem da interface.
- Gravações financeiras dependem de internet. Não há fila de alterações offline nesta versão.

### Premissas

- Uso pessoal inicialmente, autenticação pelo Supabase Auth e isolamento por proprietário desde o início; moeda BRL e fuso America/Sao_Paulo.
- Gestão pessoal como padrão; tags e projetos permitem acompanhar atividades profissionais sem construir um ERP.
- Três entradas: CSV, OFX e cadastro manual. Todas alimentam o mesmo modelo financeiro depois de confirmadas.
- Consultas atualizadas, importações e gravações usam internet. Sem conexão, mostrar estado offline, bloquear operações financeiras e não afirmar que algo foi salvo.
- Recursos estáticos podem ser armazenados pelo service worker. Não persistir extratos, respostas autenticadas ou tokens no cache do service worker.
- Base real começa vazia. Demonstração opcional usa projeto/ambiente separado e indicação visual persistente.
- “Retorno” significa receitas recebidas e resultado de caixa. Rentabilidade de investimento exige dados e metodologia adicionais; não será inferida apenas pelo extrato.

## 2. Escopo e prioridades

| Prioridade | Entregas |
|---|---|
| P0 — base utilizável | Contas, categorias, lançamentos, CSV/OFX com revisão, deduplicação, transferências, conciliação, dashboard, filtros, exportação, Supabase Auth/RLS, persistência, acesso mobile, publicação HTTPS e backup/restauração |
| P1 — versão completa | Cartões/faturas, parcelas, recorrências, contas a pagar/receber, orçamentos, metas, projeção, insights determinísticos, PWA instalável, relatórios, regras de categorização e auditoria |
| P2 — evolução opcional | Assistente de linguagem natural, escrita offline com sincronização, Open Finance, anexos, compartilhamento familiar/equipes, múltiplas moedas, investimentos com posições/cotações |

**P0 e P1 compõem a entrega completa.** Caso o desenvolvimento seja dividido em sessões, manter um checklist de conclusão. Não apresentar a primeira etapa como se todo o projeto estivesse pronto.

Fora desta versão: movimentar dinheiro, pagar boletos, acessar bancos com credenciais, emitir notas fiscais, calcular impostos, fazer escrituração contábil ou recomendar investimentos.

## 3. Navegação e jornadas

Menu: **Visão geral, Lançamentos, Contas, Cartões, Importações, Agenda financeira, Orçamentos, Metas, Insights, Relatórios e Configurações**. Categorias, regras, backups e diagnóstico ficam em Configurações. “Novo lançamento” e “Importar extrato” são ações globais.

### Primeiro acesso

1. Entrar com e-mail e senha pelo Supabase Auth; primeiro acesso autorizado configura perfil, moeda e fuso.
2. Explicar que os dados são salvos no Supabase e ficam disponíveis nos dispositivos autenticados; oferecer instalação da PWA quando compatível.
3. Cadastrar primeira conta e informar saldo inicial/data, ou marcar saldo desconhecido.
4. Escolher CSV, OFX ou lançamento manual.
5. Revisar categorias, possíveis duplicatas e transferências.
6. Confirmar e conferir quantidades/totais.
7. Abrir dashboard com pendências de qualidade visíveis.

### Rotina

Importar → revisar pendências → conciliar → consultar gastos e compromissos → ajustar orçamento → acompanhar metas. A revisão pode ser interrompida e retomada.

### Registro rápido

Tipo, valor, conta, descrição, data e categoria. Campos avançados recolhidos. Ação “Salvar e adicionar outro”; duplo clique não cria duas operações. Transferências usam formulário próprio com origem e destino.

## 4. Modelo financeiro e invariantes

### 4.1 Dinheiro, datas e abertura

- Valores monetários em centavos inteiros. R$ 1.234,56 = 123456. Não usar ponto flutuante para somas, divisões de parcelas ou comparações.
- Movimento de conta guarda valor assinado: positivo entra, negativo sai. Cadastro manual recebe magnitude positiva e tipo; o domínio deriva o sinal.
- Cartão é passivo: compra reduz seu saldo contábil assinado; pagamento aumenta. Interface mostra dívida positiva e eventual crédito a favor separadamente.
- Datas financeiras sem horário: YYYY-MM-DD, como data civil. Instantes de auditoria: UTC. Não converter data civil para UTC alterando o dia.
- Preservar data e texto originais. Quando o arquivo tiver horário/fuso, normalizar pela regra documentada do adaptador e mostrar no preview.
- Saldo inicial é posição de abertura, não receita; representa o saldo imediatamente antes dos movimentos da data inicial escolhida.
- Saldo calculado = abertura + movimentos efetivados desde a referência até o corte. Previsto/cancelado não muda saldo realizado.
- Histórico anterior à abertura exige revisão da referência e do saldo inicial; não somar silenciosamente movimentos anteriores.
- Saldo desconhecido é “não validado”, não zero.
- Saldo final de extrato não pode virar abertura sem reconstrução e explicação do período.

### 4.2 Três bases explícitas

| Visão | Base | Cartões |
|---|---|---|
| Caixa realizado | Movimentos efetivados nas contas de liquidez | Pagamento da fatura sai do caixa; compra ainda não paga não sai |
| Gastos por competência | Eventos econômicos na competência definida | Compra gera gasto; pagar fatura não gera gasto novamente |
| Caixa projetado | Saldo atual + recebimentos futuros − pagamentos futuros | Fatura gera obrigação; não somar novamente as compras que a compõem |

Caixa realizado é a base dos cards de liquidez. Gráficos de consumo devem dizer “Gastos por competência”. Todo relatório mostra período, filtros e base. Resultado de caixa não é lucro contábil.

Despesas diretas normalmente têm evento econômico e movimento no mesmo dia. Obrigações podem ter competência e liquidação distintas. Para consumo parcelado, adotar competências por parcela, documentadas na interface. O total contratado é informação da compra, não um gasto adicional que duplique as parcelas.

### 4.3 Naturezas especiais

- Transferência interna: duas pernas vinculadas, mesmo valor/sinais opostos, gravadas atomicamente. No consolidado completo, não altera receita, despesa ou patrimônio líquido.
- Filtro de uma conta mostra a transferência como tal, separada do resultado operacional.
- Aporte para investimento e resgate de principal alteram composição patrimonial; não são gasto ou receita. Rendimento identificado é receita.
- Empréstimo recebido é financiamento, não receita. Principal amortizado é saída de financiamento; juros/tarifas são despesas. Sem decomposição, pedir classificação.
- Pix não determina a natureza: pode ser receita, despesa ou transferência.
- Estorno vinculado reduz a despesa na data do estorno, preservando o passado. Estorno parcial permitido até o valor elegível; excesso exige revisão.
- Transferências sugeridas exigem confirmação. Contraparte manual deve aceitar vínculo posterior à linha importada sem duplicação.

### 4.4 Estados e edição

- Obrigações: prevista, parcialmente liquidada, liquidada ou cancelada. “Vencida” deriva da data e do saldo aberto.
- Revisão/categorização é estado separado de efetivação financeira.
- Pagamento parcial mantém saldo restante; não alterar valor original para esconder parcialidade.
- Rateios por categoria/projeto devem somar exatamente o valor do evento.
- Exclusão lógica e auditada; reativação verifica identidades externas.
- Alterar valor/data de registro conciliado exige motivo e invalida a conferência afetada.
- Arquivar conta/categoria com histórico, sem apagar relações.

## 5. Contas, categorias e organização

Conta: nome, instituição opcional, tipo, moeda, cor, ícone, identificação mascarada, abertura/data, inclusão na liquidez e situação ativa/arquivada.

Tipos: corrente, poupança, dinheiro, carteira digital e investimento com saldo manual. Cartões possuem cadastro próprio. Não solicitar senha bancária, token ou número completo do cartão.

Mostrar saldo calculado, última movimentação, período importado, saldo do extrato quando disponível e última conciliação por data de corte.

Categorias iniciais editáveis: Moradia, Alimentação, Mercado, Transporte, Saúde, Educação, Filhos/Família, Lazer, Assinaturas, Compras, Serviços, Tarifas/Juros e Outros. Receitas: Salário, Serviços, Vendas e Rendimentos. Abertura, transferência e financiamento são naturezas próprias.

Permitir subcategorias, tags e projetos. “Essencial” e “discricionário” são marcações do usuário, não julgamento automático. Regras de categorização usam condições por descrição/contraparte/conta, prioridade e preview de aplicação; alterações retroativas exigem revisão.

## 6. Importações e deduplicação

### 6.1 Pipeline comum

Upload → formato → vínculo de conta → leitura → normalização → validação → candidatos a duplicidade → sugestões → revisão → confirmação transacional → resumo → conciliação.

- Preview não altera saldo.
- Lote guarda hash, estado, parser/versão, perfil, contagens, totais e origem.
- Rastrear original e linhas normalizadas. Política pode excluir arquivo bruto posteriormente, preservando evidências normalizadas e auditoria necessárias.
- Toda linha termina importada, vinculada, ignorada explicitamente ou rejeitada com motivo. Nenhuma desaparece silenciosamente.
- Erros indicam linha, campo e correção; não expõem stack trace ao usuário.
- Mostrar total de entradas/saídas, válidas, rejeitadas, duplicadas e impacto estimado no saldo.
- Linhas inválidas bloqueiam confirmação integral. Usuário pode excluí-las explicitamente e confirmar as válidas; resumo registra exclusões.
- Limites iniciais configuráveis: 20 MB e 50 mil linhas; rejeitar acima do limite com explicação.
- Falha de gravação reverte o lote inteiro. Confirmação repetida é idempotente.

### 6.2 CSV

- Detectar e permitir corrigir separador (vírgula, ponto e vírgula ou tabulação), cabeçalho e encoding.
- Suportar UTF-8/BOM, Windows-1252, aspas escapadas, campos multilinha, introduções e rodapés.
- Mapeamento mínimo: data, descrição e valor; alternativa: colunas crédito/débito.
- Opcionais: ID, saldo, categoria, documento, contraparte, tipo e competência.
- Datas: DD/MM/AAAA, AAAA-MM-DD e formato explicitamente escolhido. Ambiguidade exige confirmação.
- Decimais/milhares conforme perfil: 1.234,56, 1234.56, negativos entre parênteses. Convenções conflitantes exigem revisão.
- Crédito/débito: propor crédito − débito e mostrar interpretação; conflito entre colunas é erro de revisão.
- Linhas de saldo anterior/final e totais são metadados, não transações automáticas.
- Coluna de saldo pode ajudar conciliação por linha quando ordem/semântica forem verificadas.
- Perfil salvo por banco/layout, assinatura dos cabeçalhos e versão. Mudança de layout reabre mapeamento.
- Exportação neutraliza fórmulas em campos textuais iniciados por =, +, -, @ e controles; valores monetários continuam numéricos conforme formato exportado.

### 6.3 OFX

- OFX 1.x/SGML e 2.x/XML com parser apropriado; SGML pode ter tags simples sem fechamento.
- Não ler o arquivo inteiro com uma única expressão regular. XML não resolve entidades externas nem acessa rede/arquivos.
- Campos quando presentes: instituição, BANKID, ACCTID, ACCTTYPE, CURDEF, STMTTRN, TRNTYPE, DTPOSTED, TRNAMT, FITID, NAME, MEMO, LEDGERBAL e DTASOF.
- Distinguir conta bancária e cartão. Múltiplas contas no arquivo exigem vínculo individual.
- Preservar NAME/MEMO; descrição normalizada pode combinar ambos.
- Identidade externa: instituição + conta + FITID. FITID não é global.
- Mesmo FITID com valor/data divergentes gera conflito; nunca sobrescrever silenciosamente.
- CORRECTFITID/CORRECTACTION: apresentar correção/cancelamento vinculado para revisão; se não suportado, bloquear as linhas afetadas com motivo.
- Moeda diferente de BRL bloqueada nesta versão; não converter sem taxa/método.
- Distinguir saldo disponível e contábil. Avisar campos ausentes, conta divergente e período incompleto.
- Não presumir que extensão FX/QFX equivale a OFX suportado; identificar conteúdo e informar limites reais.

### 6.4 Duplicatas e vínculos

1. Hash + escopo de conta identifica reenvio e mostra o resultado anterior.
2. Identidade externa confiável detecta duplicata exata. Nova origem não cria outro movimento.
3. Sem ID, comparar conta, moeda, valor, data, texto e referências para gerar candidatos, não exclusões definitivas.
4. Permitir vincular CSV e OFX sobrepostos e cadastro manual ao mesmo registro canônico, preservando origens.
5. Dois gastos legítimos iguais devem coexistir. Fingerprint simples não é restrição única universal.
6. Similaridade de texto/datas só sugere. Preservar multiplicidade de linhas iguais em um lote.
7. Revisão lado a lado: “Já existe”, “É outro lançamento”, “Vincular ao manual” e “Revisar depois”. Pendências não entram silenciosamente no realizado.
8. Desfazer lote reverte apenas mudanças atribuídas a ele. Edições posteriores, outras origens e dependências exigem revisão, sem exclusão destrutiva em cascata.

## 7. Cartões, faturas e agenda

### Cartões

Cadastro: nome, limite, fechamento, vencimento, conta pagadora opcional e final mascarado. Ciclo calculado é estimativa; fatura confirmada prevalece. Compra no fechamento pode mudar de ciclo manualmente.

Tela: limite informado, utilizado estimado, fatura aberta, anteriores, compras, parcelas futuras, juros e pagamentos. Informar quando o limite não foi conferido com a instituição.

R$ 1.000 em três parcelas deve somar exatamente R$ 1.000: por exemplo, 333,34 + 333,33 + 333,33. Compromisso futuro não vira saída de caixa antes de pagar a fatura.

Pagamento vincula conta pagadora e passivo do cartão: reduz liquidez/dívida e não gera outro gasto de consumo. Pagamento parcial mantém dívida; juros/multas são próprios, sem inventar taxas contratuais. Estorno reduz gasto/dívida segundo vínculo/data.

Quando houver só débito bancário da fatura, aceitar “Pagamento de cartão sem detalhamento”: saída de caixa e pendência de classificação. Não inventar compras ou saldo anterior do cartão; solicitar abertura/fatura para conciliar.

### Agenda

- Calendário/lista de contas a pagar/receber, faturas, parcelas e vencidos.
- Liquidar total/parcial com um ou mais pagamentos. Vincular importado em vez de duplicar baixa manual.
- Recorrências semanais, mensais e anuais; início/fim; dia inexistente usa último dia do mês.
- Editar ocorrência, esta e futuras ou todas ainda não liquidadas.
- Uma ocorrência por série/data; reiniciar não duplica obrigações.
- Não deslocar fim de semana sem regra configurada.
- Alertas internos com app em execução; não prometer lembrete com computador desligado.

## 8. Dashboard, fórmulas e planejamento

Filtros comuns: período, contas, categorias, projetos, situação e base. Todo indicador abre sua composição.

| Indicador | Definição |
|---|---|
| Saldo líquido | Soma dos saldos das contas de liquidez no corte; conta com abertura desconhecida torna total parcial |
| Receitas recebidas | Entradas classificadas como receita; exclui abertura, transferências, empréstimos e resgate de principal |
| Despesas pagas | Saídas operacionais realizadas; inclui fatura paga uma vez; exclui transferências entre contas líquidas, aportes e principal de dívidas |
| Resultado operacional de caixa | Receitas recebidas − despesas pagas; não é lucro contábil |
| Variação da liquidez | Saldo líquido final − inicial; ponte inclui financiamento, aportes/resgates e ajustes além do resultado operacional |
| Gastos por categoria | Eventos por competência líquidos de estornos; sem duplicar pagamentos de fatura |
| Contas em aberto | Valor original − liquidações − cancelamentos; pagar e receber separados |
| Saldo projetado | Saldo atual + recebimentos futuros − pagamentos futuros, sem repetir compras/faturas/obrigações liquidadas |
| Comprometimento previsto | Obrigações a pagar ÷ receitas previstas no mesmo período; sem denominador, não calculável |
| Taxa de sobra | Resultado operacional de caixa ÷ receitas recebidas × 100, se receitas > 0; não equivale a valor investido |
| Orçamento consumido | Gasto por competência ÷ limite; sem limite, “sem orçamento” |
| Variação de gasto | (Atual − referência) ÷ referência; referência zero mostra diferença em reais, sem percentual |
| Patrimônio acompanhado | Ativos conhecidos − passivos conhecidos; marcar parcial quando faltarem posições |
| Cobertura dos dados | Contas/períodos revisados, pendências, sem categoria e conciliações; ausência de movimento não comprova ausência de gasto |

Mês parcial compara com intervalo equivalente ou avisa extensões diferentes. Rateio não duplica total. Arredondar apresentação, preservando centavos.

### Projeção

Base usa somente obrigações e recebimentos cadastrados, com premissas explícitas. Cenário variável opcional usa média de até três meses completos, exigindo ao menos dois meses completos confirmados. Excluir categorias já representadas por obrigações para não duplicar. Rotular como estimativa, não previsão garantida.

### Orçamentos e metas

Orçamento mensal por categoria/subcategoria, com regra que não soma pai e filhos duas vezes. Alertas editáveis em 80% e 100%.

Meta: nome, valor-alvo, prazo opcional, reservas e contribuições. Reserva virtual não cria despesa ou muda saldo bancário. Transferência real segue regra de transferência. Mostrar saldo líquido e livre após reservas separadamente; impedir atribuição do mesmo dinheiro disponível a várias reservas além do total.

## 9. Insights verificáveis

Motor determinístico executado no backend, sem API externa de IA no núcleo. Assistente externo é P2, desativado por padrão, com consentimento explícito para dados enviados e sem mutação financeira automática.

Cada insight: título, severidade, período/filtros, cálculo, evidências, confiança/limitações e ação. Abrir registros, dispensar, adiar ou resolver. Recalcular com dados novos; evitar alertas repetidos sem mudança relevante.

| Regra | Condição inicial proposta | Ação |
|---|---|---|
| Categoria cresceu | ≥20% e ≥R$ 100 contra período equivalente | Revisar operações e orçamento |
| Orçamento próximo/excedido | ≥80%/100% do limite | Rever planejamento |
| Caixa insuficiente | Projeção negativa em até 30 dias | Abrir pior dia e obrigações |
| Possível assinatura | 3 cobranças do mesmo favorecido, intervalos 25–35 dias, valor na tolerância configurada | Confirmar recorrência |
| Possível cobrança repetida | Conta/valor iguais e descrição semelhante em janela curta | Conferir, sem apagar |
| Tarifas/juros | Lançamentos classificados nesses grupos | Exibir total e origem |
| Gasto fora do padrão | >3× mediana, pelo menos 10 eventos da categoria nos últimos 90 dias | Conferir contexto, sem chamar de fraude |
| Dados pendentes | Importação, classificação ou conciliação incompleta | Abrir revisão filtrada |
| Meta atrasada | Progresso abaixo do plano com prazo/dados conhecidos | Simular contribuição necessária |

Limiares são padrões editáveis de produto, não diagnóstico universal. Sem amostra suficiente, orientar preenchimento de dados. Não inventar tendência.

Exemplo fictício, a ser reproduzido em fixture: “Mercado aumentou R$ 180 (+24%) frente ao intervalo anterior. Três compras explicam R$ 140 do aumento”. Nunca mostrar exemplo como dado real.

Resultado por projeto exige receitas/despesas atribuídas. ROI fica desativado até haver capital aplicado e metodologia explícitos.

## 10. Telas e conteúdo

| Tela | Obrigatório |
|---|---|
| Acesso/onboarding | Login Supabase, recuperação de senha, confirmação de e-mail quando habilitada, perfil/moeda/fuso, primeira conta/importação e instalação PWA |
| Visão geral | Filtros, atualização, saldo/receita/despesa/resultado, compromissos, evolução de caixa, categorias, até três insights prioritários, qualidade |
| Lançamentos | Tabela com data, descrição, conta, categoria, valor, tipo, situação, origem, conciliação; busca, filtros, edição lateral, rateio, lote, exportação |
| Contas | Cards, cadastro/arquivo, saldo, extrato, transferência e conciliação |
| Cartões | Limites estimados, compras, parcelas, faturas, pagamentos e pendências |
| Importações | Upload, histórico, progresso, mapeamento, preview, conflitos, confirmação, relatório e reversão |
| Agenda | Calendário/lista, vencidos, recorrência, pagamento parcial/total e vínculo a importado |
| Orçamentos | Limite, realizado, compromisso, comparação e edição; base explícita |
| Metas | Progresso, prazo, reservas, contribuições e simulação |
| Insights | Priorização, evidências, fórmula, filtros e ações |
| Relatórios | Caixa, competência, categorias, contas, evolução, obrigações, projetos; CSV e impressão/PDF do navegador |
| Configurações | Perfil, aparência, categorias, regras, perfis CSV, backup, restauração, auditoria, segurança e diagnóstico |

Todas as telas têm estados vazio, carregando, sucesso, erro e dados parciais. Gráficos com tabela alternativa e tooltip exato. Ações indisponíveis explicam o motivo.

Desktop: sidebar próxima de 248 px; cabeçalho com contexto; quatro cards prioritários; evolução de caixa e categorias; compromissos, insights e qualidade abaixo. Não dar o mesmo destaque a todos os indicadores.

### Experiência mobile completa

- Mesma URL HTTPS e mesma conta de acesso em Android, iPhone, tablet e desktop; nenhum backend depende do computador pessoal na produção.
- Navegação inferior com Início, Lançamentos, Adicionar, Agenda e Mais. Demais módulos em Mais; no desktop, sidebar completa.
- Layout a partir de 360 px, áreas de toque de pelo menos 44 × 44 px, safe areas e campos legíveis com teclado aberto.
- Tabela de lançamentos vira lista de cards no celular; detalhe abre página/painel adequado. Comparações extensas podem ter rolagem horizontal localizada, sem fazer toda a página transbordar.
- Novo lançamento acessível com poucos toques, teclado numérico decimal, BRL, conta recente e confirmação explícita do servidor.
- Upload CSV/OFX pelo seletor de arquivos do dispositivo, inclusive Downloads/Arquivos quando disponível. Não depender de arrastar e soltar. Revisão, vínculo de conta e conflitos funcionam no celular.
- Download de relatórios e exportações com alternativas compatíveis; compartilhamento nativo apenas quando a API estiver disponível.
- PWA: manifest com nome, ícones 192/512 e maskable, start_url, scope, cores e display standalone; service worker com versão e atualização controlada.
- Android: oferecer instalação quando suportada. iPhone: orientar Adicionar à Tela de Início quando disponível; não prometer o mesmo diálogo de instalação em todos os navegadores.
- Service worker armazena somente shell público e recursos estáticos. Rotas autenticadas, APIs, Auth, extratos e downloads privados são network-only/no-store.
- Offline: shell e mensagem de indisponibilidade; não exibir dados antigos como atuais, não manter escrita pendente invisível e não simular salvamento.
- Após reconexão, refazer consultas autenticadas. Requisição cuja resposta se perdeu reutiliza a mesma chave de idempotência para descobrir se foi confirmada.
- Ao sair/trocar usuário, limpar estado e caches de consultas. A tela Voltar não pode revelar dados do usuário anterior.
- Revalidar dados ao recuperar foco e após mutações; atualização entre dispositivos por refetch/polling controlado. Realtime é otimização opcional, não fonte de verdade.
- Notificações push e biometria nativa não fazem parte desta versão. PWA instalada não garante execução contínua em segundo plano.

## 11. Design system premium

Direção: sóbrio, moderno, confortável para uso diário, foco em números e decisões, sem decoração excessiva.

| Token | Valor sugerido |
|---|---|
| Fundo | #F5F7FB |
| Superfície | #FFFFFF |
| Texto principal | #162033 |
| Texto secundário | #526078 |
| Bordas | #E2E8F0 |
| Primária | #2955D9 |
| Positivo | #087F5B |
| Negativo | #B42318 |
| Aviso | #946200 |
| Comparação neutra | #64748B |

Tema escuro: fundo #0B1220, superfície #131D2F e texto #E7EDF7; validar contrastes, não apenas inverter cores.

- Inter local ou fonte de sistema, números tabulares.
- Corpo 14–16 px; títulos 24–32 px; valores principais 28–36 px.
- Espaços 4/8/12/16/24/32. Radius 12–16 em cards, 8–10 em controles.
- Bordas discretas, sombra leve, ícones consistentes; sem emoji como navegação.
- Transições 150–220 ms e respeito à redução de movimento. Não animar valores como se mudassem sem mudança real.
- Cor acompanhada de texto/sinal/ícone. Foco visível, teclado, labels e acessibilidade.
- Linhas para evolução; barras para categorias/comparação; evitar muitas fatias.
- Modo privacidade oculta valores visuais, sem prometer criptografia.
- Pt-BR e BRL: R$ 1.234,56.

## 12. Arquitetura técnica — Supabase e publicação

**Stack proposta:** Next.js com React/TypeScript para interface e backend da aplicação; Supabase PostgreSQL, Auth e Storage; validação tipada; biblioteca de gráficos; PWA. Fixar versões compatíveis no início da implementação e manter lockfile. Não implementar SQLite em produção.

Camadas: interface responsiva → rotas/serviços autenticados → domínio financeiro → funções transacionais PostgreSQL. Leitura, agregações e mutações devem respeitar o proprietário. Parsers e regras de negócio são módulos independentes da interface.

| Componente | Responsabilidade |
|---|---|
| Aplicação Next.js publicada | Interface HTTPS, sessão, APIs autenticadas, relatórios e coordenação das operações |
| Supabase Auth | Identidade, login, recuperação e sessão; não criar tabela própria de senhas |
| Supabase PostgreSQL | Fonte única de contas, movimentos, parcelas, regras e histórico |
| Supabase Storage privado | Arquivos originais e exportações temporárias, com controle por usuário |
| Worker Node.js hospedado | Processamento de arquivos grandes e tarefas duráveis, independente da aba e do computador pessoal |
| Navegador/PWA | Interface, preferências e cache de recursos estáticos, sem banco financeiro paralelo |

### Desenvolvimento e produção

- Desenvolvimento: localhost conectado a projeto Supabase de desenvolvimento, com dados sintéticos. Supabase CLI local é alternativa de teste, não segundo banco de produção.
- Produção: hospedagem compatível com Next.js/Node e worker persistente ou serviço de jobs duráveis; domínio ou subdomínio com HTTPS. Pode usar o mesmo servidor para web e worker, com processos independentes.
- Se escolher hospedagem serverless, configurar worker/filas próprios para importações; não depender de função longa após a resposta HTTP.
- Supabase guarda os dados, mas a interface e o backend precisam ser publicados. Testar produção pelo 4G/5G com o computador de desenvolvimento desligado.
- Publicação do sistema não torna os dados públicos: todas as páginas financeiras exigem sessão válida.
- Separar projetos/segredos e callbacks de desenvolvimento e produção. Sem reset, seed ou migração destrutiva automática no banco real.
- Supabase, hospedagem, Storage, e-mails transacionais e jobs podem ter limites/custos. Conferir o plano contratado antes do deploy, sem prometer operação gratuita ou disponibilidade ilimitada.

### Persistência e transações

- Dinheiro em PostgreSQL BIGINT de centavos, com limites de domínio. API usa strings de inteiros para BIGINT; frontend converte apenas de forma segura para exibição e operações controladas.
- Datas civis em DATE; instantes em TIMESTAMPTZ; valores brutos do banco preservados.
- Migrações SQL versionadas em supabase/migrations; tipos gerados; constraints, índices, RLS e permissões incluídos nas migrações.
- Transferências, liquidações, parcelas, confirmação/reversão de lote e mudanças críticas são transacionais no banco. Várias requisições HTTP sucessivas não equivalem a transação.
- Operações críticas por funções SQL/RPC com validação completa. Revogar escrita direta que permita contornar invariantes. Usar funções com privilégios mínimos; quando SECURITY DEFINER for necessário, fixar search_path, qualificar objetos, restringir EXECUTE e validar auth.uid() e a propriedade de cada referência.
- Chave de idempotência única por proprietário/operação; bloqueios apropriados e constraints contra corrida. Edição usa versão esperada: conflito pede recarregar, sem sobrescrever silenciosamente outro dispositivo.
- Dados financeiros não são salvos em localStorage, IndexedDB ou cache de service worker. Preferências de tema podem ser locais.

### Upload e processamento durável

- Servidor valida usuário e cria lote próprio antes de autorizar upload para bucket privado. Caminho usa proprietário + lote + nome interno aleatório, sem nome bancário sensível.
- Upload direto autorizado ao Storage evita atravessar limites do corpo da hospedagem; URLs assinadas curtas e vinculadas ao objeto permitido. Validar tamanho/conteúdo no processamento, além das restrições do bucket.
- Worker busca jobs com lease/bloqueio, registra tentativas, progresso e erros; retoma após falha sem duplicar. Credenciais privilegiadas ficam apenas no servidor, com autorização explícita por job.
- Parsing e normalização ficam em staging invisível ao realizado. Confirmação usa uma transação atômica ou mecanismo equivalente de publicação integral. Não liberar saldo parcial de lote em processamento.
- Limite inicial desejado continua 20 MB/50 mil linhas; validar capacidade/timeout na infraestrutura escolhida. Se necessário, reduzir e informar antes de aceitar arquivo, sem prometer capacidade não testada.
- Ao fechar a aba, job já aceito continua no servidor; ao retornar, consultar seu estado. Queda durante upload permite tentar de novo com identificação do lote.

```text
app/                     páginas, layouts, autenticação e rotas de API
components/              componentes desktop/mobile
lib/domain/              cálculos e invariantes
lib/importers/           CSV, OFX e normalização
lib/supabase/            clientes e integração Auth
workers/                 processamento e tarefas duráveis
supabase/migrations/     schema, constraints, RLS e RPCs
supabase/tests/          testes SQL e isolamento
public/                  manifest, ícones e recursos estáticos
tests/                   domínio, integração e jornadas
docs/                    implantação, recuperação e decisões
```

## 13. Modelo de dados

IDs UUID, timestamps, revisão/versionamento e chaves estrangeiras. Todas as entidades financeiras incluem owner_id ligado a auth.users; relações entre entidades devem impedir vínculos entre proprietários, inclusive por chaves compostas (owner_id, id) quando apropriado. Índices e unicidades de importação incluem owner_id. Exclusão lógica onde houver histórico. Compartilhamento familiar fica fora desta versão.

| Entidade | Campos/relações essenciais |
|---|---|
| auth.users / Profile / Settings | identidade gerida pelo Supabase Auth; perfil ligado ao usuário, preferências e moeda/fuso; credenciais geridas pelo Auth |
| Account | instituição, tipo ativo/passivo, moeda, identificação, abertura/data, liquidez, arquivo |
| Category / Tag / Project | hierarquia, natureza e organização |
| FinancialEvent | natureza, descrição, competência, magnitude, moeda, categoria/projeto, estorno |
| Allocation | evento, categoria/projeto, centavos; soma igual ao evento |
| AccountMovement | conta, evento opcional, centavos assinados, data efetiva, transferência/conciliação |
| Obligation | evento/série, pagar/receber, vencimento, valor original, cancelamento, fatura/parcela |
| Settlement | obrigação, movimento, valor alocado; suporta liquidação parcial e múltipla |
| TransferGroup | natureza, origem/destino e pernas vinculadas |
| ImportBatch / ImportRow | hash, estado, parser/perfil, arquivo, bruto/normalizado, erros/decisões |
| ExternalIdentity / SourceLink | instituição/conta/FITID; linhas de origem vinculadas ao registro canônico |
| ImportProfile / CategoryRule | mapeamento, encoding, convenções, condições, prioridade, versão |
| Reconciliation | conta, corte, saldo informado/calculado, diferença e composição |
| Recurrence / InstallmentPlan | frequência, início/fim, ocorrências, total/parcelas |
| Card / Invoice | conta passivo, ciclo, fechamento/vencimento, total derivado, pagamentos |
| Budget | mês, categoria, limite e regra hierárquica |
| Goal / GoalContribution | alvo/prazo, reservas/contribuições e movimentos vinculados |
| Insight / AuditLog / BackupRecord | regra/evidências/estado; alterações; versão/checksum/resultado |

Compra total contratada é metadado; não duplicar total e parcelas como gastos. Saldos são derivados; cache exige invalidação. Índices por conta/data, competência/natureza, categoria, vencimento, hash/escopo e identidade externa.

API representa BIGINT de centavos como strings inteiras documentadas; impedir conversão silenciosa que perca precisão. Adicionar ImportJob, IdempotencyRecord e versão de edição para processamento durável e concorrência entre dispositivos.

## 14. Contratos de API

| Rotas conceituais | Função |
|---|---|
| /auth/login; /auth/callback; /auth/recovery; POST /api/setup | Fluxos Supabase Auth, sessão validada e perfil inicial |
| GET/POST/PATCH /api/accounts | Contas, abertura e arquivo |
| GET/POST/PATCH /api/events | Lançamentos, rateios e estornos |
| POST /api/transfers | Operação atômica de duas pernas |
| POST /api/imports; GET /api/imports/:id | Preparação e progresso/linhas |
| POST /api/imports/:id/mapping; /decisions | Mapeamento e revisão |
| POST /api/imports/:id/commit; /undo | Confirmação idempotente e reversão analisada |
| POST /api/reconciliations | Conferência por conta/corte |
| GET/POST /api/obligations; POST /api/settlements | Agenda e liquidações |
| GET /api/dashboard; /api/reports/* | Agregações com base/filtros |
| GET/POST/PATCH /api/budgets; /api/goals | Planejamento |
| GET /api/insights | Regra, evidência e ações |
| POST /api/exports; /api/data-imports/preview; /api/data-imports/commit | Exportação/reimportação dos dados do próprio usuário; backup global é administrativo |

Todas as rotas verificam sessão e propriedade; owner_id nunca é aceito como autoridade vindo do cliente. Paginação, filtros e ordenação no servidor. Respostas incluem cobertura. Erros: código estável, mensagem pt-BR, campos e ID diagnóstico, sem extratos nos logs. Detectar edição concorrente por versão.

## 15. Autenticação, isolamento e recuperação

### Supabase Auth e autorização

- Login com e-mail/senha e recuperação usando Supabase Auth. Inicialmente, conta do proprietário provisionada e cadastro público desabilitado; não inventar credenciais padrão.
- Configurar URLs de aplicação e redirecionamentos por ambiente. Testar recuperação/confirmacão de e-mail e configurar entrega transacional adequada na produção.
- Integração SSR oficial; verificar identidade no servidor e tratar expiração/renovação. Não confiar em dados de sessão manipuláveis recebidos do navegador.
- Cookies e sessão conforme integração escolhida; HTTPS/Secure em produção, SameSite apropriado, validação de origem e proteção CSRF em mutações.
- Habilitar Row Level Security em todas as tabelas expostas com dados privados. Policies por auth.uid() = owner_id para leitura e operações permitidas; WITH CHECK impede atribuir registro a outro usuário. Sem acesso financeiro para anon.
- Tabelas auxiliares, views, agregações, RPCs, downloads, Storage e jobs também verificam identidade e propriedade. Filtrar só no frontend não é autorização.
- Chave publicável pode integrar a configuração do cliente; secret/service_role e credenciais do banco nunca entram no bundle, repositório, logs ou variáveis públicas.
- Tráfego rotineiro usa cliente com contexto do usuário/RLS. Jobs administrativos com privilégio elevado fazem autorização explícita, pois não podem depender das mesmas proteções implícitas.
- Usuário A não pode consultar, alterar, vincular ou apagar dados/arquivos de B, mesmo conhecendo UUID/caminho. Cobrir SQL, API, RPC e Storage em testes.
- Auditoria escrita no servidor/banco, sem edição pelo usuário. Logs sem extratos, senhas, tokens ou números bancários completos.

### Arquivos e aplicação

- Buckets privados; policies por proprietário. URLs assinadas com curta validade; não logar URLs assinadas nem armazená-las como links permanentes.
- Validar tamanho, conteúdo, caminhos e permissão; texto importado não executa HTML; XML sem entidades externas.
- Páginas e respostas privadas no-store; sem cache compartilhado que misture usuários. Limpar caches locais ao sair.
- Telemetria não recebe dados financeiros por padrão. Não prometer criptografia ponta a ponta: o processamento ocorre no backend/Supabase.

### Backup e restauração

Distinguir exportação pessoal e recuperação operacional:

1. **Exportação do usuário:** CSV para consulta e pacote estruturado versionado com registros, relações e metadados próprios. Sem credenciais Auth. Reimportação com preview, validação, mapa de IDs e idempotência, sem sobrescrever outros usuários. A primeira versão restaura em espaço vazio do próprio proprietário ou exige procedimento administrativo para substituição.
2. **Backup operacional:** banco PostgreSQL, esquema, funções, policies, migrações e informações necessárias à recuperação; procedimento administrativo fora da interface comum. Conferir backup gerenciado/PITR e retenção efetivamente disponíveis no plano.
3. **Storage:** os arquivos precisam de estratégia de cópia separada. Backup do banco não contém os bytes dos objetos do Storage.
4. **Recuperação testada:** restaurar em ambiente isolado; verificar saldos, relações, identidades/ownership, RLS, login e arquivos; só depois planejar substituição de produção com backup prévio e janela controlada.
5. **Operação:** definir meta de cópia diária e retenção conforme recursos contratados. Monitorar sucesso/erro; não afirmar que backup existe porque há um botão ou porque Supabase está contratado.
6. **Migração:** testar antes em desenvolvimento/homologação, preservar backup e plano de recuperação; nunca apagar banco real para resolver erro.

## 16. Critérios de aceitação

### Cenário de referência

Abertura: conta A R$ 1.000; B R$ 200. Receita R$ 3.000 em A; mercado R$ 200 pago por A; transferência R$ 500 A→B; compra no cartão R$ 300; pagamento da fatura R$ 300 por A.

Após pagamento: A = R$ 3.000; B = R$ 700; liquidez = R$ 3.700; receitas = R$ 3.000; despesas pagas = R$ 500; resultado operacional = R$ 2.500; consumo por competência = R$ 500; cartão sem dívida. Transferência não vira receita/despesa; pagamento não duplica compra.

Antes de pagar fatura: liquidez R$ 4.000; consumo R$ 500; despesas pagas R$ 200; dívida R$ 300; patrimônio acompanhado R$ 3.700.

### Testes obrigatórios

1. Reiniciar servidor/navegador preserva dados.
2. Reimportar arquivo gera zero movimentos adicionais.
3. CSV/OFX sobrepostos e manual versus importado permitem vínculo sem apagar operações legítimas iguais.
4. FITID em contas diferentes coexiste; divergência na mesma conta gera conflito.
5. Formatos monetários/datas/acentos/aspas/BOM normalizam corretamente ou têm erro explícito.
6. Falha no meio de importação não deixa gravação parcial.
7. Confirmação repetida e duas abas não duplicam lote.
8. Transferência e contraparte importada mantêm consolidado correto.
9. Compra/fatura/pagamento parcial/estorno não duplicam consumo e atualizam dívida.
10. Parcelas de R$ 1.000 somam exatamente R$ 1.000.
11. Obrigação R$ 500 com baixa R$ 200 deixa R$ 300; importação da baixa não liquida de novo.
12. Divergência de saldo é visível; edição de conciliado invalida conferência.
13. Reversão de lote preserva origens compartilhadas e exige revisão de dependências.
14. Receita zero, saldo desconhecido, mês vazio e parcial não geram NaN ou conclusões falsas.
15. Recorrência do dia 31 usa último dia e não duplica no reinício.
16. Drill-down reproduz exatamente os totais dos cards.
17. Recuperação em ambiente isolado mantém saldos, vínculos, ownership, perfis, RLS e arquivos; pacote corrompido não altera a produção.
18. XML externo, caminho malicioso, HTML importado e fórmula em CSV são tratados com segurança.
19. Teclado, tema claro/escuro e largura pequena mantêm uso funcional.
20. Arquivos reais têm fixtures anonimizadas e testes antes de declarar banco validado.
21. Login pelo computador e celular acessa os mesmos dados; criação no celular aparece no desktop após revalidação e vice-versa.
22. Acesso por rede móvel com computador pessoal desligado comprova independência de localhost.
23. Usuário A não acessa dados/arquivos/RPCs de B; usuário anônimo não acessa dados financeiros; tentar trocar owner_id é bloqueado.
24. Secret/service_role e credenciais não estão no bundle; cache compartilhado não expõe dados privados.
25. Instalação e navegação PWA verificadas em Android e iOS compatíveis; fallback web funciona. Sem dispositivo real disponível, declarar teste simulado e pendência real.
26. Offline não mostra gravação bem-sucedida; reconexão refaz consulta; resposta perdida/retry não duplica operação.
27. Logout limpa estado; troca de usuário e botão Voltar não revelam dados anteriores.
28. Dois dispositivos editando a mesma versão recebem conflito explícito, sem perda silenciosa.
29. CSV/OFX pode ser selecionado, enviado, revisado e confirmado no celular; reabertura recupera estado de job aceito.
30. Expiração de sessão e recuperação de senha preservam segurança sem enviar operação em nome de outro usuário.
31. Tela de 360 px, teclado aberto, safe areas e navegação inferior não ocultam ações essenciais.
32. Backup de banco e cópia de Storage são restaurados e verificados separadamente antes de declarar recuperação concluída.

Meta de desempenho a medir/documentar: dashboard com 50 mil movimentos em até 2 segundos após aquecimento; importação em segundo plano com progresso e UI responsiva. Meta não é resultado já verificado.

**Pronto significa:** P0/P1 implementados; critérios críticos testados; botões reais; demo separada; fórmulas rastreáveis; restauração testada; instalação documentada e limitações declaradas. Mock ou screenshot não substitui validação funcional.

## 17. Plano de execução e implantação

1. Fundação: Next.js/TypeScript, Supabase de desenvolvimento, migrações, Auth, ownership, RLS, funções transacionais e tema responsivo.
2. Operação financeira: contas, categorias, eventos, movimentos, transferências e auditoria.
3. Importação: Storage privado, jobs, CSV/OFX, preview, deduplicação e conciliação.
4. Dashboard: fórmulas, filtros, cobertura, relatórios e atualização entre dispositivos.
5. Planejamento: cartão, fatura, obrigação, recorrência, parcela, orçamento e meta.
6. Insights/projeção determinísticos e verificáveis no backend.
7. PWA: manifest, ícones, shell, instalação e tratamento de conexão; revisão mobile completa.
8. Produção: publicar app/backend/worker em HTTPS, configurar Supabase de produção, callbacks Auth, entrega de e-mails, variáveis e monitoramento.
9. Homologação: acesso móvel externo, isolamento, importação concorrente, recuperação, documentação e checklist P0/P1.

### Configuração a entregar

- .env.example apenas com placeholders: URL Supabase, chave publicável, URL da aplicação e variáveis privadas estritamente necessárias ao servidor/worker.
- Guia para criar projeto Supabase, aplicar migrações/policies, criar buckets privados, provisionar usuário e configurar Auth.
- Guia de deploy independente do computador local; comandos reais testados de desenvolvimento, build, migração, worker e testes.
- Descrever onde os dados estão, como exportar, restaurar e trocar credenciais. Não colocar senha de banco em instrução pública ou frontend.
- Registrar recursos/limites contratados; hospedar a aplicação e conectar o Supabase são etapas diferentes.

### Extratos reais

Analisar banco, conta/cartão, encoding, separador, cabeçalhos, data, sinais, crédito/débito, IDs, saldos, linhas não transacionais, período e sobreposição. Produzir mapa de campos e reconciliar quantidades/totais antes de declarar suporte.

Não sobrescrever originais. Fixtures anonimizadas preservam estrutura e consistência matemática. Se CSV/OFX representarem as mesmas operações, ambos chegam ao mesmo conjunto canônico.

Pendências para implementação: projeto/chaves apropriadas do Supabase, hospedagem/domínio, homologação das amostras, cartões/parcelas e posições de abertura. Não é necessário fornecer segredos para usar este PRD; configurar credenciais apenas no ambiente de desenvolvimento/servidor apropriado.

## 18. Prompt Mestre — Mobile + Supabase

Copie o bloco junto com o PRD completo ou anexe este arquivo:

```text
Atue como uma equipe integrada de engenharia, produto, UX/UI e qualidade. Construa o Clareza Financeira versão 2 conforme o PRD anexo, para gestão pessoal por computador, tablet, Android e iPhone. Use Supabase como fonte única dos dados e aplicativo web premium em português do Brasil, responsivo e instalável como PWA quando suportado.

Esta versão substitui a arquitetura anterior de SQLite/local. Desenvolvimento pode continuar em localhost, mas a entrega deve estar preparada para publicação HTTPS de interface, backend e worker, acessível de qualquer lugar com o computador pessoal desligado. Não criar dois bancos de produção nem sincronização SQLite–Supabase.

Trate todas as seções como contrato de produto. Entregue P0 e P1 completos, não apenas layouts/mocks. Inspecione o projeto e instruções existentes, preserve trabalho, fixe versões compatíveis e mantenha checklist de implementação/aceite. Não declare publicado, testado ou concluído sem evidência.

Stack: Next.js/React/TypeScript, Supabase PostgreSQL/Auth/Storage e worker Node.js hospedado para tarefas duráveis. Migrações SQL versionadas incluem schema, constraints, índices, RLS e RPCs. Valores monetários em BIGINT de centavos; transporte JSON como strings inteiras; DATE para data civil e TIMESTAMPTZ para instantes.

Configure login, recuperação e sessão pelo Supabase Auth. Uso pessoal inicialmente, sem cadastro público aberto. Cada registro tem owner_id; relações não podem cruzar proprietários. Verifique identidade no servidor. RLS em toda tabela privada e políticas também para arquivos/rotas/funções. Não confiar em owner_id enviado pelo cliente. Chaves secret/service_role e credenciais nunca entram no frontend.

Mutações financeiras críticas ocorrem em transação no PostgreSQL via funções/RPCs autorizadas; não simular atomicidade com chamadas HTTP independentes. Revogar escrita direta que contorne invariantes. Proteger funções privilegiadas, validar todas as referências, usar idempotência por proprietário/operação e detectar versões concorrentes.

Implemente todas as telas e o design do PRD, com sidebar no desktop e navegação inferior no mobile. Layout a partir de 360 px, áreas de toque adequadas, teclado numérico, safe areas, lista de lançamentos em cards, formulários rápidos e ações reais. Permitir importação CSV/OFX pelo seletor de arquivos do celular, com revisão completa de conflitos. PWA com manifest/ícones/service worker e fallback web; não prometer app nativo de loja.

A versão exige internet para ler dados atualizados e gravar. Service worker cacheia apenas shell público/estáticos. Não guardar extratos, APIs autenticadas ou tokens no cache. Sem internet, mostrar estado offline e não simular salvamento; sem fila offline nesta versão. Revalidar ao voltar ao app/reconectar; limpar estado ao sair. Usar a mesma chave de idempotência quando a resposta de uma gravação se perder. Detectar conflitos entre dispositivos.

Preserve CSV, OFX SGML/XML e cadastro manual como entradas equivalentes. Use Storage privado e jobs duráveis com limites validados. Pipeline de preparação, normalização, deduplicação, preview, decisões e confirmação transacional. Sem saldo parcial antes da confirmação; sem exclusão silenciosa de compras legítimas. Não inventar layout ou homologação de arquivos ainda não analisados. Originais e vínculos são rastreáveis.

Preserve invariantes: abertura não é receita; transferência não é resultado; empréstimo não é receita; aporte/resgate de principal não é rendimento; pagamento de fatura não duplica compra; previsto não altera realizado; parcelas somam total; liquidações parciais mantêm saldo. Preserve auditoria, estornos e rateios.

Implemente contas, cartões, faturas, parcelas, agenda, recorrências, orçamento, metas, categorias/tags/projetos, regras, relatórios e conciliação. Separe caixa realizado, competência e projeção. Exiba base, período, filtros e cobertura; todo total abre sua composição. Não confundir caixa com lucro contábil ou inferir ROI apenas por extrato.

Insights são determinísticos, calculados no backend, com fórmula/evidência/limitação/ação. Sem dados suficientes, informar. Nenhuma API externa de IA é necessária ao núcleo.

Implemente exportação pessoal e documentação de backup operacional. Backups de banco e arquivos Storage são distintos. Restaurar/testar em ambiente isolado; não expor restauração global a usuário comum nem apagar banco para contornar erro. Configurar infraestrutura real e verificar recursos disponíveis no plano, sem prometer gratuidade/backup não contratado.

Execute testes financeiros e todos os testes mobile/Supabase da seção 16: cenário de referência, reimportação, sobreposição CSV/OFX/manual, cartão, parcelas, falha transacional, RLS entre usuários, Storage privado, offline, concorrência, PWA e acesso via rede móvel com computador desligado. Se faltar dispositivo ou infraestrutura, registrar pendência em vez de simular prova de conclusão.

Entregue código, migrações, políticas, funções, worker, manifest/ícones, .env.example sem segredos, lockfile, comandos testados, guia Supabase e deploy, recuperação e checklist P0/P1. Se faltarem credenciais/hospedagem, complete o código e testes locais possíveis, informe exatamente o que falta para publicar e não substitua banco por mocks em silêncio.

Comece pela fundação, siga o plano até concluir e preserve as decisões financeiras deste PRD.
```

## 19. Referências técnicas

Consultadas em 14/11/2026. Fontes sustentam detalhes técnicos; UX, escopo e limiares são decisões propostas.

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): isolamento e políticas por usuário.
- [Supabase — API keys](https://supabase.com/docs/guides/getting-started/api-keys): distinção entre chaves publicáveis e segredos de servidor.
- [Supabase — integração Auth no servidor](https://supabase.com/docs/guides/auth/server-side/creating-a-client): integração de autenticação.
- [Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups): recursos de recuperação e separação entre banco e arquivos Storage.
- [MDN — PWA instalável](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): manifest, HTTPS e instalação conforme navegador.
- [Financial Data Exchange — OFX](https://financialdataexchange.org/about-fdx/ofx-work-group/): especificações SGML/XML.
- [Financial Data Exchange — OFX 2.2](https://www.financialdataexchange.org/common/Uploaded%20files/OFX%20files/OFX%202.2.pdf): identidade de transações por instituição/conta.

**Versão 2.0 consolidada:** substitui a 1.0; preserva as funcionalidades financeiras e redefine persistência, autenticação, acesso mobile, conectividade, backup e implantação. Esta entrega é o PRD/prompt, não a aplicação já implementada ou publicada.
