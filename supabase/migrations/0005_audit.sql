-- 0005 — Auditoria append-only -----------------------------------------------
--
-- user_id é UUID vindo de auth.uid() (gravado dentro das RPCs), nunca texto
-- livre enviado pelo navegador.

create table if not exists public.quadro_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.quadro_profiles (id) on delete restrict,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  store_id   text references public.quadro_stores (id) on delete set null,
  created_at timestamptz not null default now(),
  metadata   jsonb not null default '{}'::jsonb
);

create index if not exists quadro_audit_logs_entity_idx on public.quadro_audit_logs (entity, entity_id);
create index if not exists quadro_audit_logs_user_idx on public.quadro_audit_logs (user_id);
create index if not exists quadro_audit_logs_store_created_idx on public.quadro_audit_logs (store_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only de verdade.
--
-- A RLS já não concede UPDATE/DELETE, mas gatilho é mais forte: ele vale
-- também para papéis que ignoram RLS (service_role, superusuário).
-- ---------------------------------------------------------------------------
create or replace function public.quadro_audit_logs_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quadro_audit_logs é append-only: % não é permitido.', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists quadro_audit_logs_no_update on public.quadro_audit_logs;
create trigger quadro_audit_logs_no_update
  before update or delete on public.quadro_audit_logs
  for each row execute function public.quadro_audit_logs_append_only();
