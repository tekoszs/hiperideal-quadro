-- ===========================================================================
-- PERFIS GERENCIAIS -- Paulo, Ericson, Roberval e Jackson
-- ===========================================================================
--
-- NAO CONTEM SENHA. Nao contem, nao vai conter, e nao deve conter.
-- As senhas sao cadastradas por voce direto no Supabase Auth e nunca passam
-- por SQL, por arquivo versionado, por documentacao ou pelo bundle.
--
-- Este arquivo tambem NAO cria usuario no Auth. Inserir em `auth.users` por
-- SQL gera conta sem senha valida, sem identity e sem confirmacao -- fica
-- quebrada de um jeito dificil de perceber. Quem cria conta e o Supabase.
--
-- ---------------------------------------------------------------------------
-- COMO USAR -- 3 passos
-- ---------------------------------------------------------------------------
--
-- 1. Supabase > Authentication > Users > Add user > Create new user
--    Crie os QUATRO, marcando "Auto Confirm User" em todos:
--
--       paulo.sergio@hiperideal.com.br
--       ericson.silva@hiperideal.com.br
--       roberval.anias@hiperideal.com.br
--       jackson.costa@hiperideal.com.br
--
--    A senha voce define na hora, na tela. Nao me mande nem escreva aqui.
--
-- 2. Copie o UUID de cada um (coluna "UID" da lista de usuarios).
--
-- 3. Troque os quatro placeholders abaixo pelos UUIDs e rode no SQL Editor.
--
--    Se preferir nao copiar UUID na mao, use a versao por e-mail no fim do
--    arquivo -- ela resolve o UUID sozinha a partir de auth.users.
--
-- ---------------------------------------------------------------------------
-- ESCOPO DE CADA UM
-- ---------------------------------------------------------------------------
--
--   Paulo    SUPERVISOR  DISTRICT  district-1   -> 20 lojas
--   Ericson  SUPERVISOR  DISTRICT  district-2   -> 14 lojas
--   Roberval SUPERVISOR  ALL                    -> 34 lojas
--   Jackson  ADMIN       ALL                    -> 34 lojas + administracao
--
-- `job_title` e so exibicao. Quem autoriza e role + access_scope + district_id.
-- ===========================================================================

insert into public.quadro_profiles
  (id, name, role, access_scope, store_id, district_id, job_title, active)
values
  ('PAULO_AUTH_UID',    'Paulo Sergio',   'SUPERVISOR', 'DISTRICT', null, 'district-1', 'Gerente Distrital', true),
  ('ERICSON_AUTH_UID',  'Ericson Silva',  'SUPERVISOR', 'DISTRICT', null, 'district-2', 'Gerente Distrital', true),
  ('ROBERVAL_AUTH_UID', 'Roberval Anias', 'SUPERVISOR', 'ALL',      null, null,         'Gerente Geral',     true),
  ('JACKSON_AUTH_UID',  'Jackson Costa',  'ADMIN',      'ALL',      null, null,         'Administrador',     true)
on conflict (id) do update
  set name         = excluded.name,
      role         = excluded.role,
      access_scope = excluded.access_scope,
      store_id     = excluded.store_id,
      district_id  = excluded.district_id,
      job_title    = excluded.job_title,
      active       = true;

-- ---------------------------------------------------------------------------
-- Conferencia
-- ---------------------------------------------------------------------------
select p.name,
       p.role,
       p.access_scope,
       coalesce(d.name, 'rede inteira') as escopo,
       p.job_title,
       p.active
  from public.quadro_profiles p
  left join public.quadro_districts d on d.id = p.district_id
 where p.role in ('SUPERVISOR', 'ADMIN')
 order by p.access_scope, p.name;


-- ===========================================================================
-- ALTERNATIVA -- sem copiar UUID na mao
-- ===========================================================================
--
-- Faz o mesmo, resolvendo o UUID a partir do e-mail em auth.users. So funciona
-- DEPOIS que voce criou os quatro usuarios no passo 1.
--
-- Descomente o bloco inteiro para usar.
--
-- insert into public.quadro_profiles
--   (id, name, role, access_scope, store_id, district_id, job_title, active)
-- select u.id, v.name, v.role::public.quadro_profile_role,
--        v.scope::public.quadro_access_scope, null, v.district_id, v.job_title, true
--   from (values
--     ('paulo.sergio@hiperideal.com.br',    'Paulo Sergio',   'SUPERVISOR', 'DISTRICT', 'district-1', 'Gerente Distrital'),
--     ('ericson.silva@hiperideal.com.br',   'Ericson Silva',  'SUPERVISOR', 'DISTRICT', 'district-2', 'Gerente Distrital'),
--     ('roberval.anias@hiperideal.com.br',  'Roberval Anias', 'SUPERVISOR', 'ALL',      null,         'Gerente Geral'),
--     ('jackson.costa@hiperideal.com.br',   'Jackson Costa',  'ADMIN',      'ALL',      null,         'Administrador')
--   ) as v(email, name, role, scope, district_id, job_title)
--   join auth.users u on lower(u.email) = v.email
-- on conflict (id) do update
--   set name         = excluded.name,
--       role         = excluded.role,
--       access_scope = excluded.access_scope,
--       store_id     = excluded.store_id,
--       district_id  = excluded.district_id,
--       job_title    = excluded.job_title,
--       active       = true;
