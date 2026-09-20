# Análise da planilha `Quadrodia.xlsx`

Arquivo original preservado em `docs/Quadrodia.xlsx` (nada foi apagado ou alterado).

## Estrutura encontrada

- **1 aba:** `Planilha1`
- **Intervalo:** `A1:E27`
- **Linha 1 = cabeçalho** (não é função): `LOJA | SETOR | QUANTIDADE | OBSERVAÇÃO | PENDÊNCIAS`
- **Linhas 2 a 26 = dados** (25 linhas de função)
- **Linha 27 = vazia**
- **Sem células mescladas, sem linhas de subtotal, sem totalizadores.**

## Colunas

| Coluna | Cabeçalho    | Situação                                                             |
| ------ | ------------ | -------------------------------------------------------------------- |
| A      | `LOJA`       | Preenchida em todas as 25 linhas com o mesmo valor                     |
| B      | `SETOR`      | Preenchida — na prática contém a **função** (com o setor no sufixo)    |
| C      | `QUANTIDADE` | **100% vazia** — não há quadro autorizado na planilha                  |
| D      | `OBSERVAÇÃO` | **100% vazia**                                                        |
| E      | `PENDÊNCIAS` | **100% vazia**                                                        |

> Como as colunas C, D e E estão vazias, **nenhuma quantidade de quadro foi inventada**.
> `store_staffing.authorized_quantity` é gravado como `NULL`.

## Lojas encontradas: 1

| Código | Nome            | Rótulo na planilha       |
| ------ | --------------- | ------------------------ |
| 124    | PARQUE SHOPPING | `124 - PARQUE SHOPPING`  |

> ⚠️ A planilha **não contém** a loja `LE PARC` citada no exemplo do briefing.
> Para não inventar cadastro, o sistema foi carregado apenas com `124 - PARQUE SHOPPING`.

## Funções encontradas: 25

Nenhuma função foi agrupada, renomeada ou fundida. A regra de derivação é:

- Se o nome contém ` - `, a **primeira parte** vira `function_group` e a **segunda** vira `sector`.
- Se não contém, `function_group` = nome completo e `sector` = `NULL`.

| #  | `name` (planilha)               | `function_group`               | `sector`   |
| -- | ------------------------------- | ------------------------------ | ---------- |
| 1  | ACOUGUEIRO                      | ACOUGUEIRO                     | —          |
| 2  | ATENDENTE ALIMENTOS - PADARIA   | ATENDENTE ALIMENTOS            | PADARIA    |
| 3  | ATENDENTE ALIMENTOS - FATIADOS  | ATENDENTE ALIMENTOS            | FATIADOS   |
| 4  | ATENDENTE ALIMENTOS - FRUTAS    | ATENDENTE ALIMENTOS            | FRUTAS     |
| 5  | AUX DE VALIDADE                 | AUX DE VALIDADE                | —          |
| 6  | AUX. DE COZINHA - REFEITÓRIO    | AUX. DE COZINHA                | REFEITÓRIO |
| 7  | AUX. DE COZINHA - GALETERIA     | AUX. DE COZINHA                | GALETERIA  |
| 8  | AUX. DE PESSOAL                 | AUX. DE PESSOAL                | —          |
| 9  | AUX. SERVICO GERAIS             | AUX. SERVICO GERAIS            | —          |
| 10 | CAIXA GERAL                     | CAIXA GERAL                    | —          |
| 11 | CONFERENTE                      | CONFERENTE                     | —          |
| 12 | COZINHEIRO                      | COZINHEIRO                     | —          |
| 13 | EMPACOTADOR                     | EMPACOTADOR                    | —          |
| 14 | ENCARREGADO                     | ENCARREGADO                    | —          |
| 15 | FISCAL DE PATRIMONIO            | FISCAL DE PATRIMONIO           | —          |
| 16 | GERENTE DE LOJA                 | GERENTE DE LOJA                | —          |
| 17 | LIDER DE ATENDIMENTO            | LIDER DE ATENDIMENTO           | —          |
| 18 | OPERADOR DE CAIXA               | OPERADOR DE CAIXA              | —          |
| 19 | OPERADOR DE SUPORTE             | OPERADOR DE SUPORTE            | —          |
| 20 | PADEIRO                         | PADEIRO                        | —          |
| 21 | PROMOTOR VENDAS ESPECIALIZADO   | PROMOTOR VENDAS ESPECIALIZADO  | —          |
| 22 | REPOSITOR - HORTI               | REPOSITOR                      | HORTI      |
| 23 | REPOSITOR - MERCEARIA           | REPOSITOR                      | MERCEARIA  |
| 24 | REPOSITOR - FRIOS               | REPOSITOR                      | FRIOS      |
| 25 | REPOSITOR - BAZAR               | REPOSITOR                      | BAZAR      |

### Grupos com mais de um setor (permanecem SEPARADOS como linhas próprias)

- `ATENDENTE ALIMENTOS` → PADARIA, FATIADOS, FRUTAS (3 funções distintas)
- `AUX. DE COZINHA` → REFEITÓRIO, GALETERIA (2 funções distintas)
- `REPOSITOR` → HORTI, MERCEARIA, FRIOS, BAZAR (4 funções distintas)

Os outros 16 registros não possuem setor e ficam como função simples.

### Totais

- Funções com setor: **9**
- Funções sem setor: **16**
- Grupos de função distintos: **19**
- Setores distintos: **9**

## Regeneração

```bash
python3 scripts/import_quadro.py docs/Quadrodia.xlsx
```

Regera `src/data/catalog.ts` e `supabase/seed.sql` a partir da planilha, sem alterar o arquivo original.
