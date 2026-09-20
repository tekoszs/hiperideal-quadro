-- 0004 — Conferência diária --------------------------------------------------

create table if not exists public.quadro_daily_conferences (
  id             uuid primary key default gen_random_uuid(),
  store_id       text not null references public.quadro_stores (id) on delete cascade,
  reference_date date not null,
  status         public.quadro_conference_status not null default 'DRAFT',
  -- Identidade confiável: preenchido pela RPC a partir de auth.uid().
  created_by     uuid not null references public.quadro_profiles (id) on delete restrict,
  submitted_by   uuid references public.quadro_profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  -- Uma única conferência por loja/data.
  constraint quadro_daily_conferences_store_date_key unique (store_id, reference_date),
  -- SUBMITTED exige carimbo e autor; qualquer outro status não pode ter carimbo.
  constraint quadro_daily_conferences_submitted_ck check (
    (status = 'SUBMITTED' and submitted_at is not null and submitted_by is not null)
    or (status <> 'SUBMITTED' and submitted_at is null and submitted_by is null)
  )
);

create index if not exists quadro_daily_conferences_store_date_idx
  on public.quadro_daily_conferences (store_id, reference_date desc);
create index if not exists quadro_daily_conferences_created_by_idx
  on public.quadro_daily_conferences (created_by);

create table if not exists public.quadro_daily_items (
  id               uuid primary key default gen_random_uuid(),
  conference_id    uuid not null references public.quadro_daily_conferences (id) on delete cascade,
  position_id      text not null references public.quadro_positions (id) on delete restrict,
  absence_quantity integer not null default 0 check (absence_quantity >= 0),
  day_off_quantity integer not null default 0 check (day_off_quantity >= 0),
  observation      text,
  constraint quadro_daily_items_conference_position_key unique (conference_id, position_id)
);

create index if not exists quadro_daily_items_conference_idx on public.quadro_daily_items (conference_id);
create index if not exists quadro_daily_items_position_idx on public.quadro_daily_items (position_id);

create table if not exists public.quadro_daily_item_reasons (
  id            uuid primary key default gen_random_uuid(),
  daily_item_id uuid not null references public.quadro_daily_items (id) on delete cascade,
  reason_id     text not null references public.quadro_absence_reasons (id) on delete restrict,
  quantity      integer not null default 0 check (quantity >= 0),
  observation   text,
  constraint quadro_daily_item_reasons_item_reason_key unique (daily_item_id, reason_id)
);

create index if not exists quadro_daily_item_reasons_item_idx on public.quadro_daily_item_reasons (daily_item_id);
create index if not exists quadro_daily_item_reasons_reason_idx on public.quadro_daily_item_reasons (reason_id);
