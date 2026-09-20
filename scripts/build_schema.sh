#!/usr/bin/env bash
# Gera supabase/schema.sql concatenando as migrations em ordem.
#
# As migrations são a FONTE DA VERDADE. O schema.sql é só um atalho para
# criar um banco novo de uma vez — e é regerado por este script, então os
# dois nunca divergem.
#
# Uso:  bash scripts/build_schema.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/supabase/schema.sql"
MIGRATIONS="$ROOT/supabase/migrations"

{
  echo "-- ============================================================================"
  echo "-- HIPERIDEAL | Conferência Diária de Quadro"
  echo "-- SNAPSHOT GERADO AUTOMATICAMENTE — não editar à mão."
  echo "--"
  echo "-- Fonte da verdade: supabase/migrations/*.sql"
  echo "-- Regerar:          bash scripts/build_schema.sh"
  echo "--"
  echo "-- BANCO NOVO ......: rode este arquivo inteiro (ou as migrations em ordem)."
  echo "-- BANCO EXISTENTE .: rode APENAS as migrations novas, em ordem."
  echo "--"
  echo "-- No PostgreSQL local, rode ANTES: supabase/local/00_auth_shim.sql"
  echo "-- (no Supabase o schema auth já existe — não rode o shim lá)."
  echo "--"
  echo "-- ATENÇÃO: a migration 0011 liga RLS com políticas reais por perfil."
  echo "-- Sem um registro em public.profiles, o usuário autenticado não lê nada."
  echo "-- Veja docs/SEGURANCA-RLS.md."
  echo "-- ============================================================================"
  echo

  for file in "$MIGRATIONS"/*.sql; do
    echo
    echo "-- ==========================================================================="
    echo "-- $(basename "$file")"
    echo "-- ==========================================================================="
    cat "$file"
    echo
  done
} > "$OUT"

# install.sql = schema + seed, para colar de uma vez no SQL Editor do Supabase.
INSTALL="$ROOT/supabase/install.sql"
{
  echo "-- ============================================================================"
  echo "-- HIPERIDEAL | Conferência Diária de Quadro"
  echo "-- INSTALAÇÃO COMPLETA — GERADO AUTOMATICAMENTE, não editar à mão."
  echo "-- Regerar: bash scripts/build_schema.sh"
  echo "--"
  echo "-- Cole este arquivo INTEIRO no SQL Editor do Supabase e execute uma vez."
  ULTIMA="$(basename "$(ls -1 "$MIGRATIONS"/*.sql | tail -1)" .sql | cut -d_ -f1)"
  echo "-- Contém: estrutura (migrations 0001..$ULTIMA) + catálogo da planilha."
  echo "--"
  echo "-- NÃO rode supabase/local/00_auth_shim.sql no Supabase: o schema auth"
  echo "-- já existe lá. O shim é só para PostgreSQL local."
  echo "--"
  echo "-- Depois de executar, rode supabase/tests/schema_checks.sql para conferir."
  echo "-- ============================================================================"
  echo
  cat "$OUT"
  echo
  echo "-- ==========================================================================="
  echo "-- seed.sql — catálogo gerado de docs/Quadrodia.xlsx"
  echo "-- ==========================================================================="
  cat "$ROOT/supabase/seed.sql"

  # ---------------------------------------------------------------------------
  # 0017 REPETIDA, DE PROPÓSITO.
  #
  # Ela vincula as funções a todas as lojas, e depende de DUAS fontes: as lojas
  # (migration 0016) e as funções (seed.sql). Como as migrations rodam ANTES do
  # seed, na passagem em ordem numérica o catálogo de funções ainda está vazio e
  # o insert acerta zero linhas — a rede sairia instalada com 33 lojas sem
  # função nenhuma, silenciosamente.
  #
  # Repetir aqui resolve, e é seguro: o arquivo é idempotente (só insere par
  # que ainda não existe, com id determinístico), então a segunda execução cria
  # o que faltava e uma terceira não faria nada.
  # ---------------------------------------------------------------------------
  echo
  echo "-- ==========================================================================="
  echo "-- 0017_seed_network_staffing.sql — REEXECUÇÃO após o seed"
  echo "--"
  echo "-- Repetida de propósito: na ordem das migrations o catálogo de funções"
  echo "-- ainda não existia. É idempotente — ver o cabeçalho do arquivo."
  echo "-- ==========================================================================="
  cat "$MIGRATIONS/0017_seed_network_staffing.sql"
} > "$INSTALL"

echo "schema.sql regerado a partir de $(ls -1 "$MIGRATIONS"/*.sql | wc -l) migrations."
echo "install.sql gerado (schema + seed) para colar no SQL Editor do Supabase."
