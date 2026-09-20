# Coexistência com o sistema Organico

Este sistema divide o **mesmo projeto Supabase** com o sistema Organico.
Tudo aqui existe para garantir que um nunca encoste no outro.

---

## Regra única

**Todo objeto criado por este sistema começa com `quadro_`.**
Sem exceção: tabelas, tipos, funções, RPCs, views, índices, constraints,
triggers e políticas de RLS.

O que é compartilhado: apenas `auth.users` e `auth.uid()` do Supabase —
lidos, nunca escritos.

---

## Objetos criados

### 9 tabelas

| Tabela | O que guarda |
| ------ | ------------ |
| `quadro_stores` | lojas (vindas da planilha) |
| `quadro_positions` | funções/setores |
| `quadro_store_staffing` | quadro autorizado por loja |
| `quadro_profiles` | **perfil e loja do usuário deste sistema** |
| `quadro_absence_reasons` | motivos de falta |
| `quadro_daily_conferences` | conferência do dia por loja |
| `quadro_daily_items` | uma linha por função na conferência |
| `quadro_daily_item_reasons` | quantidade por motivo |
| `quadro_audit_logs` | auditoria append-only |

`quadro_profiles` é a **única** fonte de `role` deste aplicativo. A tabela
`public.profiles` do Organico não é lida nem referenciada em lugar nenhum.

### 2 tipos

`quadro_conference_status` · `quadro_profile_role`

### 2 RPCs

`quadro_rpc_save_daily_conference_draft(p_store_id, p_reference_date, p_items)`
`quadro_rpc_submit_daily_conference(p_conference_id)`

### 2 views

`quadro_v_conference_items` · `quadro_v_conference_item_reasons`
(ambas com `security_invoker = true`)

### 12 funções auxiliares

`quadro_current_profile_role` · `quadro_current_profile_store_id` ·
`quadro_can_access_store` · `quadro_can_write_store` ·
`quadro_status_change_is_authorized` · `quadro_touch_updated_at` ·
`quadro_guard_conference_transition` · `quadro_block_submitted_conference` ·
`quadro_block_submitted_conference_reason` · `quadro_guard_profile_privileges` ·
`quadro_audit_logs_append_only` · `quadro_assert_conference_is_consistent`

### 6 triggers · 21 policies · 15 índices · 6 constraints

Todos prefixados. A lista completa sai de:

```sql
select tablename from pg_tables  where schemaname='public' and tablename ~ '^quadro_';
select policyname from pg_policies where schemaname='public' and tablename ~ '^quadro_';
```

### 1 GUC

`quadro.status_change` — sinal transacional que autoriza a troca de status.
Antes era `hiperideal.status_change`; foi renomeado para não colidir com
outro sistema da mesma empresa.

---

## O que foi removido do install.sql por causa da coexistência

Três comandos da versão anterior teriam **danificado o Organico**:

| Comando removido | O que teria feito |
| ---------------- | ----------------- |
| `revoke all on all tables in schema public from anon` | tirava os privilégios de TODAS as tabelas do Organico |
| `revoke all on all sequences in schema public from anon` | idem, nas sequences |
| `revoke all on all functions in schema public from anon` | idem, nas funções |
| `drop view if exists public.v_daily_occurrences` | derrubaria uma view homônima de outro sistema |
| `create extension if not exists "pgcrypto"` | exige privilégio elevado e instala extensão no banco inteiro; `gen_random_uuid()` é nativo do PostgreSQL 13+ |
| `grant usage on schema public to authenticated` | mexe no privilégio do schema, que é de TODOS os sistemas |

No lugar das revogações globais, o `install.sql` cita **uma a uma** as nove
tabelas e as duas views deste sistema.

Também foram renomeados os `alter table ... enable row level security`: sem o
prefixo, eles ligariam RLS nas tabelas `stores`, `profiles`, `positions`,
`daily_items` e `audit_logs` do Organico — o que quebraria aquele sistema na hora.

---

## Garantias automatizadas

### Testes de arquivo (`src/tests/coexistence.test.ts`, 36 testes)

Rodam sempre, sem banco. Falham se alguém:

- reintroduzir `on all tables/functions/sequences/routines in schema`;
- adicionar `create extension`;
- adicionar `grant`/`revoke ... on schema public`;
- adicionar `alter default privileges`;
- conceder ou revogar privilégio sobre objeto que não seja `quadro_*`;
- adicionar `drop database/schema/table` ou `truncate`;
- criar qualquer objeto sem o prefixo `quadro_`;
- escrever um `DROP` ou `ALTER TABLE` fora do namespace;
- referenciar `public.profiles`, `public.stores`, `public.positions`,
  `public.daily_items` ou `public.audit_logs`;
- tocar no schema `auth` além de ler `auth.users` e `auth.uid()`;
- apontar um `.from()` ou `.rpc()` do frontend para nome sem prefixo;
- pedir um relacionamento aninhado `quadro_x (` no `.select()` **sem alias**
  (`nome:quadro_x (`) — sem o alias o PostgREST devolve a propriedade com o
  nome da tabela e o mapeamento do TypeScript recebe `undefined`;
- trocar o hint de FK do responsável pelo envio: `quadro_daily_conferences`
  tem DUAS chaves para `quadro_profiles` (`created_by` e `submitted_by`), e sem
  `!quadro_daily_conferences_submitted_by_fkey` o PostgREST recusa a consulta.

### Teste de banco real

Um "Organico simulado" é instalado com objetos **de propósito homônimos** —
tipos `profile_role` e `conference_status`, tabelas `stores`, `profiles`,
`positions`, `daily_items`, `audit_logs`, views `v_conference_items` e
`v_daily_occurrences`, função `can_access_store(text)`, índice
`positions_sector_idx`, trigger `daily_conferences_touch`, além de dados e
`grant select ... to anon`.

Depois o `install.sql` é aplicado por cima e o catálogo é comparado linha a
linha, antes e depois.

Resultado obtido em PostgreSQL 16:

```
Etapa 0 antes de instalar        -> NADA ENCONTRADO, pode instalar
objetos do Organico fotografados -> 25
install.sql aplicado             -> ORGANICO INTACTO (25 linhas idênticas)
install.sql aplicado 2x          -> ORGANICO segue intacto
extensões instaladas pelo install -> nenhuma
schema_checks.sql                -> 42 verificações OK, 0 falhas
suíte completa                   -> 505 testes passando no mesmo banco
```

Os guardas foram verificados de forma NEGATIVA: reintroduzi de propósito
`create extension`, `grant ... on schema public`, `alter default privileges` e
um `grant select on public.stores`, e os testes falharam em cada caso.

A comparação cobre tabelas e seu estado de RLS, views, funções, tipos,
policies, triggers, índices, grants para `anon`/`authenticated`, privilégio
de execução e **contagem de linhas** de cada tabela do Organico.

---

## Reproduzir a prova

```bash
# 1. instale o "Organico" simulado num banco de teste
psql -d meubanco -f supabase/local/00_auth_shim.sql
psql -d meubanco -f supabase/local/organico_simulado.sql

# 2. fotografe o estado
psql -d meubanco -t -A -f supabase/tests/foreign_snapshot.sql > antes.txt

# 3. aplique o nosso install
psql -d meubanco -f supabase/install.sql

# 4. compare
psql -d meubanco -t -A -f supabase/tests/foreign_snapshot.sql > depois.txt
diff antes.txt depois.txt   # precisa vir vazio
```

---

## Limite honesto

Tudo acima foi verificado em **PostgreSQL 16 local**, o mesmo motor do
Supabase, contra um Organico *simulado* — não contra o Organico real.

O que só o seu Supabase pode confirmar:

- se o Organico real tem algum objeto cujo nome comece com `quadro_` — a
  **Etapa 0** de `docs/VALIDACAO-SUPABASE.md` responde isso em 5 segundos,
  cobrindo tabelas, views, materialized views, índices, sequences, funções,
  procedures, tipos, enums, domínios e policies/triggers mal ligados;
- se o Organico depende de `alter default privileges` no schema `public` que
  possa afetar as tabelas novas;
- o comportamento do PostgREST ao expor as duas RPCs.
