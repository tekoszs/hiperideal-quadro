/**
 * ARQUIVO GERADO AUTOMATICAMENTE — não editar à mão.
 * Regerar: python3 scripts/build_network.py
 *
 * A REDE OFICIAL: 34 lojas em 2 distritos.
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

export interface DistrictRef {
  id: string;
  code: string;
  name: string;
  /** Responsável atual — informativo. NUNCA usado como regra de acesso. */
  managerName: string;
  active: boolean;
}

export interface NetworkStore {
  id: string;
  code: string;
  /** Nome operacional curto, como a rede chama a loja. */
  name: string;
  /** Nome por extenso, quando existe. Entra na busca. */
  fullName: string | null;
  districtId: string;
  active: boolean;
}

export const DISTRICTS: DistrictRef[] = [
  { id: 'district-1', code: '1', name: 'Distrito 1', managerName: 'Paulo Sergio', active: true },
  { id: 'district-2', code: '2', name: 'Distrito 2', managerName: 'Ericson Silva', active: true },
];

export const NETWORK_STORES: NetworkStore[] = [
  { id: 'store-119', code: '119', name: 'ITAIGARA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-108', code: '108', name: 'PITUBA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-127', code: '127', name: 'PATAMARES', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-104', code: '104', name: 'LNORTE', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-122', code: '122', name: 'OGOMES', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-126', code: '126', name: 'GUARAJUBA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-110', code: '110', name: 'PFORTE', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-118', code: '118', name: 'ICARDIM', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-128', code: '128', name: 'CARVORES', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-125', code: '125', name: 'ORLA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-102', code: '102', name: 'STELLA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-132', code: '132', name: 'ALPHAVILLE', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-133', code: '133', name: 'AQUARIUS', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-131', code: '131', name: 'FSANTANA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-124', code: '124', name: 'PQSHOP', fullName: 'PARQUE SHOPPING', districtId: 'district-1', active: true },
  { id: 'store-113', code: '113', name: 'ECOSTELLA', fullName: null, districtId: 'district-1', active: true },
  { id: 'store-307', code: '307', name: 'LEPARC', fullName: 'LE PARC', districtId: 'district-1', active: true },
  { id: 'store-310', code: '310', name: 'HEMISPHE', fullName: 'HEMISFERIO', districtId: 'district-1', active: true },
  { id: 'store-308', code: '308', name: 'SAUIPE', fullName: 'SAUIPE', districtId: 'district-1', active: true },
  { id: 'store-309', code: '309', name: 'IBERO', fullName: 'IBEROSTAR', districtId: 'district-1', active: true },
  { id: 'store-115', code: '115', name: 'CANELA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-129', code: '129', name: 'HORTO', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-114', code: '114', name: 'ARMACAO', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-120', code: '120', name: 'MDIAS', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-107', code: '107', name: 'BARRA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-130', code: '130', name: 'AMAZONAS', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-105', code: '105', name: 'LAPA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-117', code: '117', name: 'VLAURA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-123', code: '123', name: 'VITORIA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-109', code: '109', name: 'PARALELA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-106', code: '106', name: 'GRACA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-121', code: '121', name: 'APIPEMA', fullName: null, districtId: 'district-2', active: true },
  { id: 'store-306', code: '306', name: 'CESPANA', fullName: 'COSTA ESPANHA', districtId: 'district-2', active: true },
  { id: 'store-311', code: '311', name: 'PANAMBY', fullName: 'PANAMBY', districtId: 'district-2', active: true },
];

/** `307 - LEPARC` — o rótulo que aparece no seletor e nos painéis. */
export function storeLabel(store: { code: string; name: string }): string {
  return `${store.code} - ${store.name}`;
}

export function getDistrict(districtId: string | null): DistrictRef | undefined {
  if (!districtId) return undefined;
  return DISTRICTS.find((district) => district.id === districtId);
}

/** Lojas de um distrito, ou todas quando `districtId` é null. */
export function storesOfDistrict(districtId: string | null): NetworkStore[] {
  if (!districtId) return NETWORK_STORES.filter((store) => store.active);
  return NETWORK_STORES.filter((store) => store.active && store.districtId === districtId);
}
