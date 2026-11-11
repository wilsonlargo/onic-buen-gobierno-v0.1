begin;

alter table public.actividades
  add column if not exists tiene_financiacion boolean not null default false;

comment on column public.actividades.tiene_financiacion is
  'Indica si la actividad maneja presupuesto propio. La interfaz muestra Presupuesto cuando es true o existen rubros históricos.';

update public.actividades a
set tiene_financiacion = true
where exists (
  select 1
  from public.presupuesto_actividad_rubros pr
  where pr.actividad_id = a.id
);

update public.actividades a
set tiene_financiacion = true
from public.proyectos p
where p.tipo_unidad = 'actividad_general'
  and p.actividad_principal_id = a.id
  and p.tiene_financiacion is true;

commit;
