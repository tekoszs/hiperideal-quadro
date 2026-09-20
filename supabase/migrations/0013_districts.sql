-- 0013 -- Distritos --------------------------------------------------------
--
-- COEXISTENCIA: cria SOMENTE objetos com prefixo quadro_. Nao faz DROP nem
-- ALTER em nada do sistema Organico, nao mexe em privilegio de schema e nao
-- instala extensao.
--
-- POR QUE UMA TABELA, E NAO UM TEXTO EM CADA LOJA
-- ----------------------------------------------
-- O responsavel pelo distrito muda. Se o nome estivesse repetido nas 20 lojas
-- do Distrito 1, trocar o gerente distrital viraria um UPDATE em 20 linhas --
-- e qualquer uma esquecida vira inconsistencia silenciosa. Aqui a troca e uma
-- linha so.
--
-- ATENCAO: `manager_name` e INFORMATIVO. Nao autoriza nada. Quem decide acesso
-- e `quadro_profiles.access_scope` + `district_id`, lidos de auth.uid().

create table if not exists public.quadro_districts (
  id           text primary key,
  code         text not null,
  name         text not null,
  -- Responsavel atual do distrito. Somente exibicao.
  manager_name text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint quadro_districts_code_key unique (code)
);

comment on table public.quadro_districts is
  'Distritos da rede. manager_name e informativo: a autorizacao vem de '
  'quadro_profiles.access_scope e district_id, nunca deste campo.';

-- ---------------------------------------------------------------------------
-- Lojas ganham distrito e nome por extenso
-- ---------------------------------------------------------------------------
--
-- `district_id` e NULLABLE de proposito:
--   1. a coluna entra sem quebrar as linhas que ja existem;
--   2. uma loja sem distrito fica INVISIVEL para supervisor distrital, que e
--      o padrao seguro -- ninguem ganha acesso por descuido de cadastro.
alter table public.quadro_stores
  add column if not exists district_id text
    references public.quadro_districts (id) on delete restrict;

-- Nome por extenso. A loja 124 ja esta gravada como "PARQUE SHOPPING"; o nome
-- operacional passa a ser "PQSHOP" e o longo e preservado aqui.
alter table public.quadro_stores
  add column if not exists full_name text;

create index if not exists quadro_stores_district_idx
  on public.quadro_stores (district_id);

comment on column public.quadro_stores.district_id is
  'Distrito da loja. NULL = sem distrito: nao aparece para supervisor '
  'distrital (padrao seguro).';
