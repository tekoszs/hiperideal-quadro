-- ============================================================================
-- EXEMPLO — como liberar acesso a um usuário
--
-- NÃO é um seed automático: cada linha depende de um usuário que VOCÊ criou
-- no Supabase Auth. Rode no SQL Editor do Supabase, ajustando os e-mails.
--
-- Por que é manual: `quadro_profiles` é o que define quem é gerente de qual loja.
-- Criar perfil sozinho, no cadastro, deixaria qualquer pessoa que se
-- registrasse virar gerente de uma loja. A liberação é ato administrativo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Passo 1 — crie o usuário no Supabase
--   Authentication > Users > Add user
--   Marque "Auto Confirm User" para não depender de e-mail de confirmação.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Passo 2 — confira qual loja existe (o catálogo vem da planilha)
-- ---------------------------------------------------------------------------
select id, code, name from public.quadro_stores order by code;

-- ---------------------------------------------------------------------------
-- Passo 3 — vincule o usuário a um perfil
--
-- MANAGER    -> store_id OBRIGATÓRIO (só enxerga e lança na própria loja)
-- SUPERVISOR -> store_id NULL (lê a rede inteira, não lança)
-- ADMIN      -> store_id NULL (lê a rede inteira, administra perfis)
-- ---------------------------------------------------------------------------

-- Gerente da loja 124 - PARQUE SHOPPING
insert into public.quadro_profiles (id, name, role, store_id, active)
select u.id, 'Nome do Gerente', 'MANAGER', 'store-124', true
  from auth.users u
 where u.email = 'gerente.parqueshopping@hiperideal.com'
on conflict (id) do update
  set name = excluded.name,
      role = excluded.role,
      store_id = excluded.store_id,
      active = excluded.active;

-- Supervisor da rede
insert into public.quadro_profiles (id, name, role, store_id, active)
select u.id, 'Nome do Supervisor', 'SUPERVISOR', null, true
  from auth.users u
 where u.email = 'supervisor@hiperideal.com'
on conflict (id) do update
  set name = excluded.name,
      role = excluded.role,
      store_id = excluded.store_id,
      active = excluded.active;

-- Administrador
insert into public.quadro_profiles (id, name, role, store_id, active)
select u.id, 'Nome do Administrador', 'ADMIN', null, true
  from auth.users u
 where u.email = 'admin@hiperideal.com'
on conflict (id) do update
  set name = excluded.name,
      role = excluded.role,
      store_id = excluded.store_id,
      active = excluded.active;

-- ---------------------------------------------------------------------------
-- Passo 4 — confira o resultado
-- ---------------------------------------------------------------------------
select p.name, p.role, p.store_id, p.active, u.email
  from public.quadro_profiles p
  join auth.users u on u.id = p.id
 order by p.role, p.name;

-- ---------------------------------------------------------------------------
-- Desligar um acesso (sem apagar histórico nem auditoria):
--   update public.quadro_profiles set active = false where id = '<uuid>';
--
-- Observação: só um ADMIN consegue rodar isso pela aplicação. Aqui, no SQL
-- Editor, você está como service_role, que ignora RLS de propósito.
-- ---------------------------------------------------------------------------
