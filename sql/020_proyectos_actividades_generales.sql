begin;

alter table public.proyectos
  add column if not exists tipo_unidad text not null default 'proyecto';

alter table public.proyectos
  add column if not exists actividad_principal_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'proyectos_tipo_unidad_check'
      and conrelid = 'public.proyectos'::regclass
  ) then
    alter table public.proyectos
      add constraint proyectos_tipo_unidad_check
      check (tipo_unidad in ('proyecto', 'actividad_general'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'proyectos_actividad_principal_id_fkey'
      and conrelid = 'public.proyectos'::regclass
  ) then
    alter table public.proyectos
      add constraint proyectos_actividad_principal_id_fkey
      foreign key (actividad_principal_id)
      references public.actividades(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_proyectos_tipo_unidad
  on public.proyectos (tipo_unidad);

comment on column public.proyectos.tipo_unidad is
  'Tipo de unidad operativa en el Programa: proyecto o actividad_general.';
comment on column public.proyectos.actividad_principal_id is
  'Actividad técnica usada como soporte interno para indicadores, presupuesto, evidencias y seguimiento de una actividad general.';

-- Integridad adicional: una actividad operativa principal no puede pertenecer a dos unidades.
create unique index if not exists idx_proyectos_actividad_principal_unique
  on public.proyectos (actividad_principal_id)
  where actividad_principal_id is not null;

commit;
