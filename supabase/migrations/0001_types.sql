-- 0001 — Tipos ---------------------------------------------------------------
--
-- COEXISTÊNCIA: nenhuma extensão é criada aqui.
-- `gen_random_uuid()` faz parte do núcleo do PostgreSQL desde a versão 13,
-- então pgcrypto não é necessário. Um `create extension` exigiria privilégio
-- elevado e poderia instalar a extensão no schema public do banco
-- compartilhado — efeito colateral que não é deste sistema.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'quadro_conference_status') then
    -- REOPENED existe no modelo; o fluxo de reabertura é de uma fase futura.
    create type public.quadro_conference_status as enum ('DRAFT', 'SUBMITTED', 'REOPENED');
  end if;

  if not exists (select 1 from pg_type where typname = 'quadro_profile_role') then
    create type public.quadro_profile_role as enum ('MANAGER', 'SUPERVISOR', 'ADMIN');
  end if;
end
$$;
