-- ===========================================================================
-- PERFIS DAS 34 LOJAS
-- ===========================================================================
--
-- NAO CONTEM SENHA, e nao deve conter. As senhas das contas de loja sao
-- cadastradas no Supabase Auth e nunca passam por SQL, arquivo versionado,
-- documentacao ou bundle.
--
-- Este arquivo tambem NAO cria usuario no Auth. Ele so liga uma conta que JA
-- EXISTE ao perfil de gerente da loja correspondente.
--
-- ---------------------------------------------------------------------------
-- POR QUE NAO HA 34 LINHAS ESCRITAS AQUI
-- ---------------------------------------------------------------------------
--
-- O e-mail tecnico de cada loja segue a convencao que a tela de login usa:
--
--     store-307  ->  loja307@hiperideal.com.br
--
-- Entao o SQL abaixo CRUZA `quadro_stores` com `auth.users` por essa mesma
-- convencao. Vantagens de fazer assim, em vez de 34 linhas fixas:
--
--   * abrir uma loja nova nao pede alteracao deste arquivo;
--   * so cria perfil para conta que EXISTE -- loja sem conta criada
--     simplesmente nao aparece, em vez de gerar um perfil orfao;
--   * nao ha UUID para copiar na mao 34 vezes, e portanto nao ha como
--     trocar dois deles por engano e dar a um gerente a loja do outro.
--
-- Se o dominio das contas mudar, troque no lugar unico marcado abaixo -- e
-- lembre de trocar tambem em `src/lib/storeLogin.ts` (STORE_LOGIN_DOMAIN),
-- senao o login procura um endereco e o perfil aponta para outro.
--
-- ---------------------------------------------------------------------------
-- ORDEM DOS PASSOS
-- ---------------------------------------------------------------------------
--
--   1. criar as contas no Supabase Auth  (ver docs/FASE-4-IMPLANTACAO.md)
--   2. rodar ESTE arquivo no SQL Editor
--   3. conferir com a consulta do fim do arquivo
--
-- Rodar na ordem trocada nao quebra nada: sem conta, o insert nao encontra
-- par e nao insere linha nenhuma. Basta rodar de novo depois.
-- ===========================================================================

insert into public.quadro_profiles
  (id, name, role, access_scope, store_id, district_id, job_title, active)
select u.id,
       'Gerente ' || s.code || ' - ' || s.name,
       'MANAGER'::public.quadro_profile_role,
       'STORE'::public.quadro_access_scope,
       s.id,
       null,
       'Gerente de Loja',
       true
  from public.quadro_stores s
  -- AQUI esta o dominio, no lugar unico.
  join auth.users u on lower(u.email) = 'loja' || s.code || '@hiperideal.com.br'
 where s.active
on conflict (id) do update
  set name         = excluded.name,
      role         = excluded.role,
      access_scope = excluded.access_scope,
      store_id     = excluded.store_id,
      district_id  = excluded.district_id,
      job_title    = excluded.job_title,
      active       = true;

-- ---------------------------------------------------------------------------
-- Conferencia 1 -- quantas lojas ficaram COM e SEM gerente
-- ---------------------------------------------------------------------------
select count(*) filter (where p.id is not null) as lojas_com_gerente,
       count(*) filter (where p.id is null)     as lojas_sem_gerente,
       count(*)                                  as lojas_ativas
  from public.quadro_stores s
  left join public.quadro_profiles p
         on p.store_id = s.id and p.role = 'MANAGER' and p.active
 where s.active;

-- ---------------------------------------------------------------------------
-- Conferencia 2 -- QUAIS lojas ficaram sem gerente
--
-- Rode depois da primeira. Lista vazia = todas as lojas tem gerente.
-- Cada linha aqui e uma conta que faltou criar no Auth.
-- ---------------------------------------------------------------------------
select s.code,
       s.name,
       d.name as distrito,
       'loja' || s.code || '@hiperideal.com.br' as conta_esperada
  from public.quadro_stores s
  left join public.quadro_districts d on d.id = s.district_id
  left join public.quadro_profiles p
         on p.store_id = s.id and p.role = 'MANAGER' and p.active
 where s.active
   and p.id is null
 order by s.code;

-- ---------------------------------------------------------------------------
-- Conferencia 3 -- nenhuma conta ficou apontando para a loja errada
--
-- Compara o codigo dentro do e-mail com o codigo da loja do perfil.
-- Lista vazia = tudo certo. Qualquer linha aqui e um erro grave: significa
-- que alguem entraria numa loja que nao e a dele.
-- ---------------------------------------------------------------------------
select u.email,
       s.code as loja_do_perfil,
       substring(u.email from 'loja([0-9]+)@') as loja_do_email
  from public.quadro_profiles p
  join auth.users u on u.id = p.id
  join public.quadro_stores s on s.id = p.store_id
 where p.role = 'MANAGER'
   and u.email like 'loja%@%'
   and substring(u.email from 'loja([0-9]+)@') is distinct from s.code;
