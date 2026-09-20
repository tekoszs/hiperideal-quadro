-- 0012 — Motivos de falta ----------------------------------------------------
-- FOLGA NÃO ESTÁ AQUI de propósito: folga tem campo próprio
-- (quadro_daily_items.day_off_quantity) e nunca é motivo de falta.

insert into public.quadro_absence_reasons (id, name, active, display_order, requires_observation) values
  ('reason-atestado-medico',            'Atestado médico',             true, 1, false),
  ('reason-falta-injustificada',        'Falta injustificada',         true, 2, false),
  ('reason-ausencia-justificada',       'Ausência justificada',        true, 3, false),
  ('reason-declaracao-comparecimento',  'Declaração / comparecimento', true, 4, false),
  ('reason-afastamento',                'Afastamento',                 true, 5, false),
  ('reason-licenca',                    'Licença',                     true, 6, false),
  ('reason-suspensao',                  'Suspensão',                   true, 7, false),
  ('reason-outros',                     'Outros',                      true, 8, true)
on conflict (id) do update
  set name = excluded.name,
      display_order = excluded.display_order,
      requires_observation = excluded.requires_observation;
