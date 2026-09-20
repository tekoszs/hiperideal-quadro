"""
FONTE ÚNICA da rede oficial: 34 lojas e 2 distritos.

Gera, a partir da lista abaixo:
  - src/data/network.ts                          (módulo TypeScript)
  - supabase/migrations/0016_seed_network.sql    (seed idempotente)

Por que um gerador: a lista precisa existir em DOIS lugares — no frontend (o
seletor de loja do login roda ANTES de haver sessão, então não pode consultar
o banco) e no banco. Escrever à mão nos dois é garantia de divergência. Há
teste comparando o TS com o SQL: se um sair do outro, a suíte quebra.

Rodar:  python3 scripts/build_network.py
"""
import os
import unicodedata

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

# ---------------------------------------------------------------------------
# A REDE. Editar SÓ aqui.
# ---------------------------------------------------------------------------

DISTRICTS = [
    # (id, code, name, manager_name)
    ('district-1', '1', 'Distrito 1', 'Paulo Sergio'),
    ('district-2', '2', 'Distrito 2', 'Ericson Silva'),
]

# (código, nome operacional, distrito)
STORES = [
    # ---- DISTRITO 1 — 20 lojas ----
    ('119', 'ITAIGARA', 'district-1'),
    ('108', 'PITUBA', 'district-1'),
    ('127', 'PATAMARES', 'district-1'),
    ('104', 'LNORTE', 'district-1'),
    ('122', 'OGOMES', 'district-1'),
    ('126', 'GUARAJUBA', 'district-1'),
    ('110', 'PFORTE', 'district-1'),
    ('118', 'ICARDIM', 'district-1'),
    ('128', 'CARVORES', 'district-1'),
    ('125', 'ORLA', 'district-1'),
    ('102', 'STELLA', 'district-1'),
    ('132', 'ALPHAVILLE', 'district-1'),
    ('133', 'AQUARIUS', 'district-1'),
    ('131', 'FSANTANA', 'district-1'),
    ('124', 'PQSHOP', 'district-1'),
    ('113', 'ECOSTELLA', 'district-1'),
    ('307', 'LEPARC', 'district-1'),
    ('310', 'HEMISPHE', 'district-1'),
    ('308', 'SAUIPE', 'district-1'),
    ('309', 'IBERO', 'district-1'),
    # ---- DISTRITO 2 — 14 lojas ----
    ('115', 'CANELA', 'district-2'),
    ('129', 'HORTO', 'district-2'),
    ('114', 'ARMACAO', 'district-2'),
    ('120', 'MDIAS', 'district-2'),
    ('107', 'BARRA', 'district-2'),
    ('130', 'AMAZONAS', 'district-2'),
    ('105', 'LAPA', 'district-2'),
    ('117', 'VLAURA', 'district-2'),
    ('123', 'VITORIA', 'district-2'),
    ('109', 'PARALELA', 'district-2'),
    ('106', 'GRACA', 'district-2'),
    ('121', 'APIPEMA', 'district-2'),
    ('306', 'CESPANA', 'district-2'),
    ('311', 'PANAMBY', 'district-2'),
]

# Nome por extenso, quando conhecido. Serve para busca e para não perder o
# nome que já estava gravado no banco.
FULL_NAMES = {
    # A 124 já existia como "PARQUE SHOPPING": o nome longo é preservado.
    '124': 'PARQUE SHOPPING',
    '307': 'LE PARC',
    '306': 'COSTA ESPANHA',
    '311': 'PANAMBY',
    '310': 'HEMISFERIO',
    '308': 'SAUIPE',
    '309': 'IBEROSTAR',
}

# ---------------------------------------------------------------------------


def store_id(code: str) -> str:
    """Id determinístico. `store-124` já existe no banco e é preservado."""
    return f'store-{code}'


def sql_text(value):
    """Literal SQL. Todo caractere não-ASCII vira escape Unicode."""
    if value is None:
        return 'null'
    escaped = ''.join(
        ch if ord(ch) < 128 else '\\u%04x' % ord(ch) for ch in value
    ).replace("'", "''")
    plain = value.replace("'", "''")
    return "E'%s'" % escaped if escaped != plain else "'%s'" % plain


def check_counts():
    codes = [code for code, _, _ in STORES]
    assert len(codes) == len(set(codes)), 'código de loja duplicado'
    assert len(STORES) == 34, f'esperado 34 lojas, encontrado {len(STORES)}'
    d1 = [s for s in STORES if s[2] == 'district-1']
    d2 = [s for s in STORES if s[2] == 'district-2']
    assert len(d1) == 20, f'Distrito 1 deveria ter 20 lojas, tem {len(d1)}'
    assert len(d2) == 14, f'Distrito 2 deveria ter 14 lojas, tem {len(d2)}'
    assert any(code == '124' for code, _, _ in STORES), 'a loja 124 sumiu'


# --------------------------------------------------------------- TypeScript

def build_ts() -> str:
    linhas_dist = ',\n'.join(
        "  { id: '%s', code: '%s', name: '%s', managerName: '%s', active: true }"
        % (did, code, name, manager)
        for did, code, name, manager in DISTRICTS
    )

    linhas_lojas = ',\n'.join(
        "  { id: '%s', code: '%s', name: '%s', fullName: %s, districtId: '%s', active: true }"
        % (
            store_id(code),
            code,
            name,
            ("'%s'" % FULL_NAMES[code]) if code in FULL_NAMES else 'null',
            district,
        )
        for code, name, district in STORES
    )

    return f'''/**
 * ARQUIVO GERADO AUTOMATICAMENTE — não editar à mão.
 * Regerar: python3 scripts/build_network.py
 *
 * A REDE OFICIAL: {len(STORES)} lojas em {len(DISTRICTS)} distritos.
 *
 * POR QUE ESTA LISTA VIVE NO FRONTEND
 * -----------------------------------
 * O seletor de loja da tela de login roda ANTES de existir sessão. Como
 * `quadro_stores` está sob RLS e exige perfil ativo, um visitante anônimo não
 * consegue lê-la — e afrouxar isso só para popular um `<select>` seria
 * enfraquecer a segurança por conveniência.
 *
 * Código e nome de loja não são segredo: estão na fachada. O que continua
 * fechado é tudo que importa — perfis, conferências, faltas.
 *
 * O MESMO gerador produz `supabase/migrations/0016_seed_network.sql`, e há
 * teste comparando os dois. Se um sair do outro, a suíte quebra.
 *
 * ATENÇÃO: esta lista NÃO autoriza nada. Selecionar uma loja no login apenas
 * localiza a conta técnica; quem manda depois é `quadro_profiles.store_id`,
 * lido do banco a partir de `auth.uid()`.
 */

export interface DistrictRef {{
  id: string;
  code: string;
  name: string;
  /** Responsável atual — informativo. NUNCA usado como regra de acesso. */
  managerName: string;
  active: boolean;
}}

export interface NetworkStore {{
  id: string;
  code: string;
  /** Nome operacional curto, como a rede chama a loja. */
  name: string;
  /** Nome por extenso, quando existe. Entra na busca. */
  fullName: string | null;
  districtId: string;
  active: boolean;
}}

export const DISTRICTS: DistrictRef[] = [
{linhas_dist},
];

export const NETWORK_STORES: NetworkStore[] = [
{linhas_lojas},
];

/** `307 - LEPARC` — o rótulo que aparece no seletor e nos painéis. */
export function storeLabel(store: {{ code: string; name: string }}): string {{
  return `${{store.code}} - ${{store.name}}`;
}}

export function getDistrict(districtId: string | null): DistrictRef | undefined {{
  if (!districtId) return undefined;
  return DISTRICTS.find((district) => district.id === districtId);
}}

/** Lojas de um distrito, ou todas quando `districtId` é null. */
export function storesOfDistrict(districtId: string | null): NetworkStore[] {{
  if (!districtId) return NETWORK_STORES.filter((store) => store.active);
  return NETWORK_STORES.filter((store) => store.active && store.districtId === districtId);
}}
'''


# ---------------------------------------------------------------------- SQL

def build_sql() -> str:
    valores_dist = ',\n'.join(
        "    ('%s', '%s', %s, %s)" % (did, code, sql_text(name), sql_text(manager))
        for did, code, name, manager in DISTRICTS
    )

    valores_lojas = ',\n'.join(
        "    (%-14s, %-6s, %-14s, %-20s, '%s')"
        % (
            "'%s'" % store_id(code),
            "'%s'" % code,
            sql_text(name),
            sql_text(FULL_NAMES.get(code)),
            district,
        )
        for code, name, district in STORES
    )

    return f'''-- 0016 -- Rede oficial: {len(DISTRICTS)} distritos e {len(STORES)} lojas ---------------------------
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
{valores_dist}
on conflict (id) do update
  set code         = excluded.code,
      name         = excluded.name,
      manager_name = excluded.manager_name,
      active       = true;

-- ---------------------------------------------------------------------------
-- Lojas
-- ---------------------------------------------------------------------------
insert into public.quadro_stores (id, code, name, full_name, district_id) values
{valores_lojas}
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

  if v_total <> {len(STORES)} then
    raise exception 'Esperado {len(STORES)} lojas ativas, encontrado %', v_total;
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
'''


def main():
    check_counts()

    with open('src/data/network.ts', 'w', encoding='utf-8') as fh:
        fh.write(build_ts())

    with open('supabase/migrations/0016_seed_network.sql', 'w', encoding='ascii') as fh:
        fh.write(build_sql())

    print('src/data/network.ts                       gerado')
    print('supabase/migrations/0016_seed_network.sql gerado')
    print(f'{len(STORES)} lojas · {len(DISTRICTS)} distritos '
          f'(D1={sum(1 for s in STORES if s[2] == "district-1")}, '
          f'D2={sum(1 for s in STORES if s[2] == "district-2")})')


if __name__ == '__main__':
    main()
