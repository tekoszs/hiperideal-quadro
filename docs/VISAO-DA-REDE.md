# Visão da Rede — fórmulas e decisões

Painel analítico do supervisor (fase 3B). **Somente leitura**: nenhuma tela
desta área escreve no banco, e nenhuma migration foi criada nesta fase.

Este documento existe para você poder **conferir qualquer número na mão**.

---

## Períodos — tudo ancorado em D-1

O sistema é de conferência do dia anterior: a de hoje ainda não existe. Então o
dia mais recente analisável é sempre **D-1**, e é nele que todo período termina.
Incluir hoje criaria uma pendência falsa todos os dias.

| Botão | Intervalo | Exemplo com hoje = 06/09/2026 |
| ----- | --------- | ----------------------------- |
| Dia | D-1 | 05/09 |
| 7 dias | D-1 menos 6 até D-1 | 30/08 a 05/09 |
| 30 dias | D-1 menos 29 até D-1 | 07/08 a 05/09 |
| Mês | dia 1 do mês de D-1 até D-1 | 01/09 a 05/09 |
| Personalizado | o que você escolher, com o fim cortado em D-1 | — |

A data em destaque é escrita pelo próprio sistema em **DD/MM/AAAA**. O formato
não pode depender do idioma do navegador: num Chrome em inglês, 05/09 viraria
09/05 e o mês seria lido como dia.

### Período anterior (a comparação)

**Mesmo número de dias, imediatamente antes.** Vale para todos os tipos,
inclusive MÊS — e ali é deliberado: comparar 1 a 5 de setembro (5 dias) com
agosto inteiro (31 dias) diria que as faltas despencaram. A comparação justa é
contra 27 a 31 de agosto.

Sem faltas no período anterior, a tela escreve **"Sem base para comparação"**.
Nunca 0%, nunca 100%, nunca ∞.

---

## As fórmulas

| Métrica | Fórmula | Fonte |
| ------- | ------- | ----- |
| Faltas | `soma(absence_quantity)` **de conferências enviadas** | view de **itens** |
| Folgas | `soma(day_off_quantity)` **de conferências enviadas** | view de **itens** |
| Média por dia | `faltas ÷ dias do período` | — |
| Lojas com falta | lojas distintas com falta > 0 | view de itens |
| Conferências esperadas | `lojas ativas × dias do período` | `quadro_stores` |
| Conferências enviadas | conferências com status `SUBMITTED` | `quadro_daily_conferences` |
| **Cobertura** | `enviadas ÷ esperadas` | — |
| Pendentes | `esperadas − enviadas` (nunca negativo) | — |
| Variação | `(atual − anterior) ÷ anterior × 100` | view de itens |
| Faltas por loja | `soma(absence_quantity)` agrupado por loja | view de itens |
| Média por dia com falta | `faltas da loja ÷ dias em que ela teve falta` | view de itens |
| Faltas por função | agrupado por `position_id` (nome completo) | view de itens |
| Faltas por grupo | agrupado por `function_group` | view de itens |
| Faltas por setor | agrupado por `sector`, só onde `sector` não é nulo | view de itens |
| Faltas por motivo | `soma(reason_quantity)` | view de **motivos** |

### A primeira regra: só conferência ENVIADA vira número

**Nada que não esteja `SUBMITTED` entra no consolidado.**

Isso vale para faltas, folgas, lojas com falta, média, ranking de lojas, de
funções e de grupos, setores, motivos, evolução diária, dia da semana,
comparação com o período anterior e as regras de atenção por falta.

DRAFT e REOPENED continuam contando para **cobertura**, **pendências** e para a
tela Conferências, que é operacional. Só não são número oficial.

> **Defeito corrigido.** As views `quadro_v_conference_items` e
> `quadro_v_conference_item_reasons` **não filtram status** — devolvem também
> as linhas de conferências em rascunho. Reproduzido no PostgreSQL: uma
> conferência enviada com 3 faltas mais uma em rascunho com 10 faziam o painel
> dizer **13**. Pior: o mesmo dia contava como pendente na cobertura e como
> falta no total, ao mesmo tempo.

A correção tem **duas camadas independentes**:

| Camada | Onde | O que faz |
| ------ | ---- | --------- |
| **A** | `SupabaseAdapter` e `LocalStorageAdapter` | filtram `status = SUBMITTED` na própria consulta às views — menos dado trafegado |
| **B** | `domain/analytics.ts` | `submittedConferenceIds()` deriva os ids enviados de `RangeConferenceRow[]` e `selectItems`/`selectReasons` exigem que a linha pertença a um deles |

A camada B não é redundância decorativa: ela vale para o Supabase, para o modo
demonstração, para os testes e para qualquer adaptador futuro — inclusive um
que esqueça o filtro. Há teste que remove a camada A e confirma que os números
continuam certos.

### A segunda regra: falta e folga só saem da view de itens

**Falta e folga só saem da view de itens.** A view de motivos repete a função
uma vez por motivo: 3 faltas divididas em 2 motivos viram 2 linhas, e somar
faltas ali daria 6.

Hoje isso é **impossível** por três caminhos independentes:

1. no banco, `quadro_v_conference_item_reasons` **não tem** as colunas
   `absence_quantity` e `day_off_quantity` — somar dá erro de SQL;
2. no adaptador, o SELECT dessa view nem pede as colunas;
3. no TypeScript, o tipo `RangeReasonRow` não tem o campo — a soma errada não
   compila.

### Métrica de entrega muda com o período (decisão)

Era o ponto ambíguo do pedido. A saída foi **trocar a métrica junto com o
período**, em vez de forçar um número que serve mal para os dois:

- **DIA** → "Enviaram 1 / 1 lojas". Um dia, uma conferência por loja.
- **PERÍODOS** → "Conferências 5 / 7 esperadas". Em 7 dias, dizer "1 de 1 loja"
  esconderia 6 dias sem conferência.

### Limites conhecidos, ditos na cara

- `quadro_stores` não guarda data de cadastro, então uma **loja nova é cobrada
  desde o primeiro dia do período**. Com histórico curto, isso derruba a
  cobertura sem que ninguém tenha errado.
- A **média por dia** divide pelos dias do calendário, não pelos dias com dados.
  A fórmula não mudou nesta correção, de propósito: trocá-la em silêncio faria
  o número saltar sem explicação. O que mudou é que, com cobertura abaixo de
  90%, o próprio card passa a dizer *"diluída pela cobertura de X%"* — antes
  isso estava só nesta documentação.
- Só `SUBMITTED` conta como entregue. Rascunho e reaberta são conferências que
  ainda não chegaram, mesmo critério da tela Conferências.

---

## Zero de verdade × ausência de informação

Um dia sem conferência **não é um dia sem faltas**. Antes desta correção os
dois apareciam igual: uma barra de altura zero.

    "não recebemos informação"   ≠   "apuramos e deu zero"

Cada ponto da evolução carrega agora `expected`, `coverage` e um `state`:

| Estado | Quando | Como aparece |
| ------ | ------ | ------------ |
| `NO_DATA` | nenhuma conferência enviada no dia | traço tracejado no lugar da barra; tooltip "Sem conferência enviada — nada apurado" |
| `PARTIAL` | parte das lojas enviou | barra listrada; tooltip com "Conferências: 12 de 28 (42,9%) · Dados parciais" |
| `COMPLETE` | todas as lojas esperadas enviaram | barra sólida. Aqui um **0 é um zero apurado** |

O gráfico ganha legenda quando há dias sem dado ou parciais. A distinção usa
**textura + legenda + tooltip**, nunca só cor.

`expected` respeita o filtro de loja: com **uma loja selecionada é 1**, não o
total da rede. Assim, para essa loja, o dia é "completo" ou "sem dado" — nunca
"parcial", que não faria sentido.

---

## Setores: nada é inventado

Só entram no ranking funções que **têm** setor. Função sem setor (OPERADOR DE
CAIXA, PADEIRO, ...) não ganha um setor genérico.

Mas as faltas dela também não somem: aparecem em uma linha própria abaixo do
ranking ("N falta(s) vieram de funções sem setor definido"). Os percentuais usam
como denominador **apenas as faltas de funções com setor**, senão as fatias
nunca somariam 100%.

---

## Regras de atenção — determinísticas, sem score

Quatro regras fixas. Cada alerta traz o número que o disparou, para você poder
conferir. **Não existe pontuação combinada nem peso escondido.**

| Regra | Dispara quando |
| ----- | -------------- |
| `PENDING_CONFERENCES` | a loja tem conferência ENVIADA faltando no período (rascunho conta como faltando) |
| `CONSECUTIVE_DAYS` | faltas em **3 ou mais dias seguidos**, contando só dias enviados |
| `SHARP_INCREASE` | alta de **30% ou mais** contra o período anterior, exigindo **pelo menos 3 faltas** de base — os dois lados só com dado enviado |
| `HIGHEST_VOLUME` | maior número de faltas ENVIADAS da rede (só com mais de uma loja) |

Um detalhe da sequência: se o dia do meio for rascunho, a sequência **quebra**.
Três dias seguidos com falta só valem se os três foram enviados.

A base mínima da terceira regra existe para 1 → 2 faltas não virar "alerta de
100% de aumento".

**Funções em atenção** são simplesmente as 3 com mais faltas, com quantas lojas
atingiram. Nada de percentual sobre o quadro: `authorized_quantity` ainda pode
ser NULL, e sem denominador real o número seria inventado.

---

## Consultas e desempenho

**Quatro consultas por período, em paralelo.** Nenhuma por loja, nenhuma por
dia — não há N+1, independentemente do tamanho da rede.

| # | Fonte | Intervalo | Para quê |
| - | ----- | --------- | -------- |
| 1 | `quadro_stores` | — | denominador da cobertura |
| 2 | `quadro_daily_conferences` | anterior → fim | cobertura e pendências |
| 3 | `quadro_v_conference_items` | anterior → fim | faltas, folgas e o comparativo — **filtrada por `status = SUBMITTED`** |
| 4 | `quadro_v_conference_item_reasons` | período | motivos — **filtrada por `status = SUBMITTED`** |

A consulta 2 **não** filtra status de propósito: a cobertura precisa enxergar
as conferências que existem mas ainda não chegaram.

Os itens vão até o início do período anterior para o comparativo sair da mesma
leitura, sem uma quinta consulta.

### O que NÃO refaz a busca

Trocar **loja**, **grupo de função** ou abrir a análise de uma loja acontece em
memória, sobre os dados já carregados. Só trocar de **período** vai ao banco.

### Índice recomendado (não criado)

```sql
create index on public.quadro_daily_conferences (reference_date);
```

O índice existente é `(store_id, reference_date desc)`, ótimo para a tela do
gerente; o filtro daqui é só por data. Com a rede pequena o PostgreSQL varre a
tabela sem custo perceptível. **Não criei nada no seu banco** — é decisão sua.

### Quando a rede crescer

Hoje o período inteiro é carregado para todas as lojas acessíveis e filtrado em
memória, o que é ótimo com poucas lojas (resposta instantânea ao trocar filtro).
Passando de ~30 lojas × 30 dias, a primeira otimização é empurrar o filtro de
loja para dentro da consulta.

---

## Gráficos sem biblioteca

Medi o Recharts **neste projeto**, com um gráfico de barras real importado e
alcançável pelo bundler:

```
sem Recharts : 431,83 kB  (120,93 kB gzip)
com Recharts : 792,59 kB  (227,07 kB gzip)
custo        : +360 kB    (+106 kB gzip)  — quase o dobro
```

Para três gráficos de barra, não compensa. As barras são CSS puro: custam zero,
redimensionam sozinhas e não distorcem texto ao encolher. A Visão da Rede
inteira somou **+31 kB** ao pacote.

### Uma série por gráfico, sempre

Faltas e folgas trocam pelo alternador, nunca dividem o mesmo eixo. Dois eixos Y
no mesmo gráfico fazem duas grandezas diferentes parecerem comparáveis.

Há também um motivo de acessibilidade medido: o vermelho (`#C62828`) e o laranja
(`#A85B00`) da identidade ficam a **ΔE 1,7** sob deuteranopia — seriam a mesma
cor para boa parte das pessoas. Por isso os dois nunca aparecem como séries
distintas no mesmo gráfico; são cores de status, sempre acompanhadas de texto.

---

## Estados de tela

| Situação | O que aparece |
| -------- | ------------- |
| Carregando | "Carregando o período..." |
| Erro | a mensagem real do banco, em alerta vermelho |
| Sem conferência ENVIADA | "Nenhuma conferência enviada no período selecionado." + a cobertura que explica o vazio |
| Há rascunho no período | faixa avisando quantas conferências estão em preenchimento e não entram |
| Divisão por zero | `—`, nunca `NaN` ou `Infinity` |

No estado vazio **não** são mostrados cards de faltas zerados: "0 faltas" ao
lado de rankings vazios pareceria um resultado apurado. São mostradas apenas
esperadas, enviadas e pendentes — que é justamente o que explica o vazio.

Todo percentual e toda média passam por `safeDivide`, que devolve `null` em vez
de estourar. Há teste varrendo o resultado inteiro atrás de número não-finito.
