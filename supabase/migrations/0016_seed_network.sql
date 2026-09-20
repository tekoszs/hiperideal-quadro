-- 0016 -- Rede oficial: 2 distritos e 34 lojas ---------------------------
--
-- ARQUIVO GERADO. Regerar: python3 scripts/build_network.py
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Usa `on conflict do update`,
-- entao rodar de novo apenas reafirma os valores.
--
-- PRESERVA A LOJA 124
-- -------------------
-- `store-124` JA EXISTE no banco, com perfil de gerente e conferencias
-- vinculadas. Este seed NAO a apaga nem a recria: ela entra pelo mesmo id no
-- `on conflict (id) do update`, que so atualiza nome, nome longo e distrito.
-- A chave primaria, as FKs, o historico e o login do gerente continuam
-- exatamente como estavam.
--
-- O nome operacional passa de "PARQUE SHOPPING" para "PQSHOP" (padrao da
-- rede), e "PARQUE SHOPPING" e guardado em `full_name`, entao nada se perde.

-- ---------------------------------------------------------------------------
-- Distritos
-- ---------------------------------------------------------------------------
insert into public.quadro_districts (id, code, name, manager_name) values
    ('district-1', '1', 'Distrito 1', 'Paulo Sergio'),
    ('district-2', '2', 'Distrito 2', 'Ericson Silva')
on conflict (id) do update
  set code         = excluded.code,
      name         = excluded.name,
      manager_name = excluded.manager_name,
      active       = true;

-- ---------------------------------------------------------------------------
-- Lojas
-- ---------------------------------------------------------------------------
insert into public.quadro_stores (id, code, name, full_name, district_id) values
    ('store-119'   , '119' , 'ITAIGARA'    , null                , 'district-1'),
    ('store-108'   , '108' , 'PITUBA'      , null                , 'district-1'),
    ('store-127'   , '127' , 'PATAMARES'   , null                , 'district-1'),
    ('store-104'   , '104' , 'LNORTE'      , null                , 'district-1'),
    ('store-122'   , '122' , 'OGOMES'      , null                , 'district-1'),
    ('store-126'   , '126' , 'GUARAJUBA'   , null                , 'district-1'),
    ('store-110'   , '110' , 'PFORTE'      , null                , 'district-1'),
    ('store-118'   , '118' , 'ICARDIM'     , null                , 'district-1'),
    ('store-128'   , '128' , 'CARVORES'    , null                , 'district-1'),
    ('store-125'   , '125' , 'ORLA'        , null                , 'district-1'),
    ('store-102'   , '102' , 'STELLA'      , null                , 'district-1'),
    ('store-132'   , '132' , 'ALPHAVILLE'  , null                , 'district-1'),
    ('store-133'   , '133' , 'AQUARIUS'    , null                , 'district-1'),
    ('store-131'   , '131' , 'FSANTANA'    , null                , 'district-1'),
    ('store-124'   , '124' , 'PQSHOP'      , 'PARQUE SHOPPING'   , 'district-1'),
    ('store-113'   , '113' , 'ECOSTELLA'   , null                , 'district-1'),
    ('store-307'   , '307' , 'LEPARC'      , 'LE PARC'           , 'district-1'),
    ('store-310'   , '310' , 'HEMISPHE'    , 'HEMISFERIO'        , 'district-1'),
    ('store-308'   , '308' , 'SAUIPE'      , 'SAUIPE'            , 'district-1'),
    ('store-309'   , '309' , 'IBERO'       , 'IBEROSTAR'         , 'district-1'),
    ('store-115'   , '115' , 'CANELA'      , null                , 'district-2'),
    ('store-129'   , '129' , 'HORTO'       , null                , 'district-2'),
    ('store-114'   , '114' , 'ARMACAO'     , null                , 'district-2'),
    ('store-120'   , '120' , 'MDIAS'       , null                , 'district-2'),
    ('store-107'   , '107' , 'BARRA'       , null                , 'district-2'),
    ('store-130'   , '130' , 'AMAZONAS'    , null                , 'district-2'),
    ('store-105'   , '105' , 'LAPA'        , null                , 'district-2'),
    ('store-117'   , '117' , 'VLAURA'      , null                , 'district-2'),
    ('store-123'   , '123' , 'VITORIA'     , null                , 'district-2'),
    ('store-109'   , '109' , 'PARALELA'    , null                , 'district-2'),
    ('store-106'   , '106' , 'GRACA'       , null                , 'district-2'),
    ('store-121'   , '121' , 'APIPEMA'     , null                , 'district-2'),
    ('store-306'   , '306' , 'CESPANA'     , 'COSTA ESPANHA'     , 'district-2'),
    ('store-311'   , '311' , 'PANAMBY'     , 'PANAMBY'           , 'district-2')
on conflict (id) do update
  set code        = excluded.code,
      name        = excluded.name,
      -- Nao apaga um nome longo que ja exista no banco se o seed nao trouxer um.
      full_name   = coalesce(excluded.full_name, public.quadro_stores.full_name),
      district_id = excluded.district_id,
      active      = true;

-- ---------------------------------------------------------------------------
-- Conferencia do resultado
-- ---------------------------------------------------------------------------
do $$
declare
  v_total int;
  v_d1    int;
  v_d2    int;
begin
  select count(*) into v_total from public.quadro_stores where active;
  select count(*) into v_d1    from public.quadro_stores where active and district_id = 'district-1';
  select count(*) into v_d2    from public.quadro_stores where active and district_id = 'district-2';

  if v_total <> 34 then
    raise exception 'Esperado 34 lojas ativas, encontrado %', v_total;
  end if;
  if v_d1 <> 20 then
    raise exception 'Esperado 20 lojas no Distrito 1, encontrado %', v_d1;
  end if;
  if v_d2 <> 14 then
    raise exception 'Esperado 14 lojas no Distrito 2, encontrado %', v_d2;
  end if;

  raise notice 'Rede oficial: % lojas ativas (D1=%, D2=%)', v_total, v_d1, v_d2;
end
$$;
