-- ============================================================================
-- SIMULAÇÃO DO SISTEMA "ORGANICO" — SOMENTE PARA POSTGRESQL LOCAL
--
-- ⚠ NUNCA rode este arquivo no Supabase real. Ele cria tabelas de mentira
--   com nomes genéricos (stores, profiles, positions...) apenas para testar
--   se o nosso install.sql convive sem danificar um sistema vizinho.
-- Cria de propósito objetos com os MESMOS nomes que o sistema de quadro usava
-- antes do prefixo, para detectar qualquer colisão ou dano.
-- ============================================================================

-- Tipo com nome idêntico ao que usávamos
create type public.profile_role as enum ('OWNER', 'BUYER');
create type public.conference_status as enum ('OPEN', 'CLOSED');

-- Tabelas homônimas
create table public.stores (
  id serial primary key,
  nome text not null,
  cnpj text
);

create table public.profiles (
  id uuid primary key,
  apelido text not null,
  role public.profile_role not null default 'BUYER'
);

create table public.positions (
  id serial primary key,
  descricao text
);

create table public.daily_items (
  id serial primary key,
  descricao text
);

create table public.audit_logs (
  id serial primary key,
  quem text
);

-- View homônima
create view public.v_conference_items as select id, nome from public.stores;
create view public.v_daily_occurrences as select id, nome from public.stores;

-- Função homônima
create function public.can_access_store(p_store_id text) returns boolean
language sql immutable as $$ select true $$;

create function public.touch_updated_at() returns trigger
language plpgsql as $$ begin return new; end $$;

-- Índice e constraint homônimos
create index positions_sector_idx on public.positions (descricao);

-- Dados que NÃO podem sumir
insert into public.stores (nome, cnpj) values
  ('ORGANICO LOJA CENTRO', '11.111.111/0001-11'),
  ('ORGANICO LOJA NORTE',  '22.222.222/0001-22');
insert into public.positions (descricao) values ('COMPRADOR'), ('VENDEDOR');
insert into public.daily_items (descricao) values ('item organico 1');
insert into public.audit_logs (quem) values ('log organico');

-- RLS: uma tabela COM rls e política, outra SEM rls (estado misto real)
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());

-- Privilégios concedidos ao anon que NÃO podem ser revogados por nós
grant select on public.stores to anon;
grant select on public.positions to anon;
grant select, insert on public.daily_items to anon;
grant execute on function public.can_access_store(text) to anon;

-- Trigger homônimo em tabela do Organico
create trigger daily_conferences_touch
  before update on public.daily_items
  for each row execute function public.touch_updated_at();
