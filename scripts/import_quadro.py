#!/usr/bin/env python3
"""
Importador da planilha Quadrodia.xlsx.

Lê a planilha (SOMENTE LEITURA — o arquivo original nunca é alterado) e regera:
  - src/data/catalog.ts   (lojas + funções usadas pelo app)
  - supabase/seed.sql     (mesmo conteúdo em SQL para o Supabase)

Regras aplicadas:
  - a linha de cabeçalho e linhas vazias/subtotal são descartadas;
  - funções NUNCA são agrupadas ou fundidas: cada linha da planilha vira uma função;
  - "GRUPO - SETOR" é quebrado em function_group + sector;
  - sem " - " -> function_group = nome completo, sector = NULL;
  - QUANTIDADE vazia -> authorized_quantity = NULL (nada é inventado).

Uso:
    python3 scripts/import_quadro.py docs/Quadrodia.xlsx
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("Instale a dependência: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent

# Linhas que aparecem em planilhas mas NÃO são funções.
NON_POSITION_TOKENS = {
    "SETOR", "FUNCAO", "FUNÇÃO", "CARGO", "TOTAL", "TOTAIS", "SUBTOTAL",
    "SUB-TOTAL", "SOMA", "GERAL", "TOTAL GERAL", "QUANTIDADE", "LOJA",
    "OBSERVACAO", "OBSERVAÇÃO", "PENDENCIAS", "PENDÊNCIAS",
}

SEPARATOR = re.compile(r"\s+-\s+")


def strip_accents(value: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", value)
        if unicodedata.category(ch) != "Mn"
    )


def slugify(value: str) -> str:
    slug = strip_accents(value).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return slug or "item"


def clean(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def is_non_position(label: str) -> bool:
    normalized = strip_accents(label).upper().strip()
    return normalized in {strip_accents(t).upper() for t in NON_POSITION_TOKENS}


def parse_store(raw: str) -> tuple[str, str]:
    """'124 - PARQUE SHOPPING' -> ('124', 'PARQUE SHOPPING')"""
    parts = SEPARATOR.split(raw, maxsplit=1)
    if len(parts) == 2 and parts[0].strip():
        return parts[0].strip(), parts[1].strip()
    return slugify(raw).upper(), raw


def split_position(raw: str) -> tuple[str, str | None]:
    """'REPOSITOR - HORTI' -> ('REPOSITOR', 'HORTI')"""
    parts = SEPARATOR.split(raw, maxsplit=1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[0].strip(), parts[1].strip()
    return raw, None


def to_int(value):
    if value is None or clean(value) == "":
        return None
    try:
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return None


def sql_text(value) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def sql_int(value) -> str:
    return "NULL" if value is None else str(int(value))


def ts_text(value) -> str:
    if value is None or value == "":
        return "null"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def read_workbook(xlsx_path: Path):
    workbook = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    stores: dict[str, dict] = {}
    positions: dict[str, dict] = {}
    staffing: list[dict] = []
    skipped: list[str] = []
    order = 0

    for sheet in workbook.worksheets:
        header_seen = False
        for row in sheet.iter_rows(values_only=True):
            cells = [clean(c) for c in row] + ["", "", "", "", ""]
            store_label, position_label = cells[0], cells[1]

            if not header_seen and is_non_position(position_label):
                header_seen = True
                continue
            if not store_label and not position_label:
                continue
            if not position_label or is_non_position(position_label):
                if position_label:
                    skipped.append(position_label)
                continue

            code, store_name = parse_store(store_label or "SEM LOJA")
            store_id = f"store-{slugify(code)}"
            stores.setdefault(store_id, {
                "id": store_id, "code": code, "name": store_name, "active": True,
            })

            group, sector = split_position(position_label)
            position_id = f"pos-{slugify(position_label)}"
            if position_id not in positions:
                order += 1
                positions[position_id] = {
                    "id": position_id,
                    "name": position_label,
                    "functionGroup": group,
                    "sector": sector,
                    "active": True,
                    "displayOrder": order,
                }

            staffing.append({
                "id": f"staff-{slugify(code)}-{slugify(position_label)}",
                "storeId": store_id,
                "positionId": position_id,
                "authorizedQuantity": to_int(row[2] if len(row) > 2 else None),
                "observation": cells[3] or None,
                "pendency": cells[4] or None,
            })

    workbook.close()
    return list(stores.values()), list(positions.values()), staffing, skipped


def render_catalog_ts(stores, positions, staffing, source_name: str) -> str:
    lines = [
        "/**",
        " * ARQUIVO GERADO AUTOMATICAMENTE — não editar à mão.",
        f" * Origem: docs/{source_name}",
        " * Regerar: python3 scripts/import_quadro.py docs/Quadrodia.xlsx",
        " *",
        " * Nenhuma função foi agrupada ou inventada: cada linha da planilha",
        " * corresponde a exatamente uma função (Position).",
        " */",
        "import type { Position, Store, StoreStaffing } from '@/types/domain';",
        "",
        f"export const CATALOG_SOURCE_FILE = 'docs/{source_name}';",
        "",
        "export const STORES: Store[] = [",
    ]
    for store in stores:
        lines.append(
            f"  {{ id: {ts_text(store['id'])}, code: {ts_text(store['code'])}, "
            f"name: {ts_text(store['name'])}, active: {'true' if store['active'] else 'false'} }},"
        )
    lines += ["];", "", "export const POSITIONS: Position[] = ["]
    for position in positions:
        lines.append(
            f"  {{ id: {ts_text(position['id'])}, name: {ts_text(position['name'])}, "
            f"functionGroup: {ts_text(position['functionGroup'])}, "
            f"sector: {ts_text(position['sector'])}, "
            f"active: {'true' if position['active'] else 'false'}, "
            f"displayOrder: {position['displayOrder']} }},"
        )
    lines += ["];", "", "export const STORE_STAFFING: StoreStaffing[] = ["]
    for item in staffing:
        quantity = "null" if item["authorizedQuantity"] is None else str(item["authorizedQuantity"])
        lines.append(
            f"  {{ id: {ts_text(item['id'])}, storeId: {ts_text(item['storeId'])}, "
            f"positionId: {ts_text(item['positionId'])}, authorizedQuantity: {quantity}, "
            f"effectiveFrom: '2026-01-01', effectiveTo: null }},"
        )
    lines += ["];", ""]
    return "\n".join(lines)


def render_seed_sql(stores, positions, staffing, source_name: str) -> str:
    lines = [
        "-- ARQUIVO GERADO AUTOMATICAMENTE — não editar à mão.",
        f"-- Origem: docs/{source_name}",
        "-- Regerar: python3 scripts/import_quadro.py docs/Quadrodia.xlsx",
        "",
        "begin;",
        "",
        "-- Lojas -------------------------------------------------------------",
        "insert into public.quadro_stores (id, code, name, active) values",
    ]
    lines.append(",\n".join(
        f"  ({sql_text(s['id'])}, {sql_text(s['code'])}, {sql_text(s['name'])}, true)"
        for s in stores
    ) + """
-- FASE 4: quem manda no nome e no distrito da loja e a rede oficial
-- (migration 0016_seed_network.sql), nao a planilha. Aqui o insert so garante
-- que a loja EXISTA, para o quadro autorizado ter chave estrangeira valida.
-- `do nothing` evita que este seed desfaca o nome operacional da rede -- foi
-- exatamente o que aconteceu no primeiro teste: a 124 voltava a "PARQUE
-- SHOPPING" depois de a migration ja ter gravado "PQSHOP".
on conflict (id) do nothing;""")
    lines += ["", "-- Funções -----------------------------------------------------------",
              "insert into public.quadro_positions (id, name, function_group, sector, active, display_order) values"]
    lines.append(",\n".join(
        f"  ({sql_text(p['id'])}, {sql_text(p['name'])}, {sql_text(p['functionGroup'])}, "
        f"{sql_text(p['sector'])}, true, {p['displayOrder']})"
        for p in positions
    ) + "\non conflict (id) do update set name = excluded.name, "
        "function_group = excluded.function_group, sector = excluded.sector, "
        "display_order = excluded.display_order;")
    lines += ["", "-- Quadro por loja (authorized_quantity NULL = não informado na planilha) --",
              "insert into public.quadro_store_staffing (id, store_id, position_id, authorized_quantity, effective_from) values"]
    lines.append(",\n".join(
        f"  ({sql_text(i['id'])}, {sql_text(i['storeId'])}, {sql_text(i['positionId'])}, "
        f"{sql_int(i['authorizedQuantity'])}, date '2026-01-01')"
        for i in staffing
    ) + "\non conflict (id) do update set authorized_quantity = excluded.authorized_quantity;")
    lines += ["", "commit;", ""]
    return "\n".join(lines)


def main() -> None:
    xlsx_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "Quadrodia.xlsx"
    if not xlsx_path.is_absolute():
        xlsx_path = ROOT / xlsx_path
    if not xlsx_path.exists():
        sys.exit(f"Planilha não encontrada: {xlsx_path}")

    stores, positions, staffing, skipped = read_workbook(xlsx_path)

    (ROOT / "src" / "data" / "catalog.ts").write_text(
        render_catalog_ts(stores, positions, staffing, xlsx_path.name), encoding="utf-8"
    )
    (ROOT / "supabase" / "seed.sql").write_text(
        render_seed_sql(stores, positions, staffing, xlsx_path.name), encoding="utf-8"
    )

    with_sector = [p for p in positions if p["sector"]]
    groups = {p["functionGroup"] for p in positions}

    print(f"Planilha lida (somente leitura): {xlsx_path}")
    print(f"  Lojas encontradas .............. {len(stores)}")
    for store in stores:
        print(f"    - {store['code']} - {store['name']}")
    print(f"  Funções encontradas ............ {len(positions)}")
    print(f"    com setor .................... {len(with_sector)}")
    print(f"    sem setor .................... {len(positions) - len(with_sector)}")
    print(f"  Grupos de função distintos ..... {len(groups)}")
    print(f"  Vínculos loja x função ......... {len(staffing)}")
    print(f"  Linhas descartadas (cabeçalho/subtotal): {len(skipped)} {skipped or ''}")
    print("Gerados: src/data/catalog.ts e supabase/seed.sql")


if __name__ == "__main__":
    main()
