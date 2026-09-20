-- 0002 — Cadastros -----------------------------------------------------------
-- ids de catálogo são TEXT (slugs vindos da planilha: 'store-124').
-- ids transacionais são UUID (gerados pelo banco).

create table if not exists public.quadro_stores (
  id          text primary key,
  code        text not null unique,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Cada linha da planilha vira UMA função. Funções do mesmo grupo em setores
-- diferentes (REPOSITOR - HORTI vs REPOSITOR - FRIOS) são registros distintos.
-- function_group e sector servem ao consolidado analítico, NUNCA para fundir linhas.
create table if not exists public.quadro_positions (
  id             text primary key,
  name           text not null unique,
  function_group text not null,
  sector         text,
  active         boolean not null default true,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists quadro_positions_function_group_idx on public.quadro_positions (function_group);
create index if not exists quadro_positions_sector_idx on public.quadro_positions (sector);

-- authorized_quantity NULL = quadro não informado na planilha (não inventar).
create table if not exists public.quadro_store_staffing (
  id                  text primary key,
  store_id            text not null references public.quadro_stores (id) on delete cascade,
  position_id         text not null references public.quadro_positions (id) on delete cascade,
  authorized_quantity integer check (authorized_quantity is null or authorized_quantity >= 0),
  effective_from      date not null default current_date,
  effective_to        date,
  constraint quadro_store_staffing_period_ck check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists quadro_store_staffing_active_unique_idx
  on public.quadro_store_staffing (store_id, position_id)
  where effective_to is null;

create index if not exists quadro_store_staffing_position_idx on public.quadro_store_staffing (position_id);

-- FOLGA NÃO É MOTIVO DE FALTA: folga vive em quadro_daily_items.day_off_quantity.
create table if not exists public.quadro_absence_reasons (
  id                   text primary key,
  name                 text not null unique,
  active               boolean not null default true,
  display_order        integer not null default 0,
  requires_observation boolean not null default false
);
