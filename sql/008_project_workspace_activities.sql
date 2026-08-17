-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 008 · Espacio de trabajo del Proyecto
-- v0.7
-- ==========================================================

begin;

create table if not exists public.actividades (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete restrict,
  codigo text,
  nombre text not null,
  descripcion text,
  responsable text,
  fecha_inicio date,
  fecha_fin date,
  estado text not null default 'borrador'
    check (estado in ('borrador','programada','en_ejecucion','suspendida','completada','cancelada')),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint actividad_fechas_validas check (
    fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio
  )
);

create index if not exists idx_actividades_proyecto
  on public.actividades (proyecto_id);

create table if not exists public.indicadores_actividad (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete restrict,
  codigo text,
  nombre text not null,
  descripcion text,
  unidad_medida text,
  linea_base numeric(18,4) not null default 0,
  meta numeric(18,4) not null,
  valor_actual numeric(18,4) not null default 0,
  sentido text not null default 'ascendente'
    check (sentido in ('ascendente','descendente')),
  estado text not null default 'activo'
    check (estado in ('activo','inactivo')),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_indicadores_actividad
  on public.indicadores_actividad (actividad_id);

create table if not exists public.seguimientos_indicador (
  id uuid primary key default gen_random_uuid(),
  indicador_id uuid not null references public.indicadores_actividad(id) on delete restrict,
  fecha_corte date not null,
  valor numeric(18,4) not null,
  observacion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_seguimientos_indicador
  on public.seguimientos_indicador (indicador_id, fecha_corte);

create table if not exists public.presupuesto_actividad_rubros (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete restrict,
  rubro text not null,
  descripcion text,
  programado numeric(18,2) not null default 0 check (programado >= 0),
  ejecutado numeric(18,2) not null default 0 check (ejecutado >= 0),
  estado text not null default 'activo' check (estado in ('activo','inactivo')),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_presupuesto_actividad
  on public.presupuesto_actividad_rubros (actividad_id);

create table if not exists public.evidencias_actividad (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete restrict,
  indicador_id uuid references public.indicadores_actividad(id) on delete restrict,
  nombre text not null,
  tipo text,
  descripcion text,
  fecha date,
  url text,
  observaciones text,
  estado text not null default 'activa' check (estado in ('activa','archivada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_evidencias_actividad
  on public.evidencias_actividad (actividad_id);
create index if not exists idx_evidencias_indicador
  on public.evidencias_actividad (indicador_id);

create table if not exists public.seguimientos_actividad (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.actividades(id) on delete restrict,
  fecha_corte date not null,
  resumen text,
  logros text,
  dificultades text,
  proximos_pasos text,
  created_at timestamptz not null default now()
);

create index if not exists idx_seguimientos_actividad
  on public.seguimientos_actividad (actividad_id, fecha_corte);

drop trigger if exists trg_actividades_updated_at on public.actividades;
create trigger trg_actividades_updated_at
before update on public.actividades
for each row execute function public.set_updated_at();

drop trigger if exists trg_indicadores_actividad_updated_at on public.indicadores_actividad;
create trigger trg_indicadores_actividad_updated_at
before update on public.indicadores_actividad
for each row execute function public.set_updated_at();

drop trigger if exists trg_presupuesto_actividad_updated_at on public.presupuesto_actividad_rubros;
create trigger trg_presupuesto_actividad_updated_at
before update on public.presupuesto_actividad_rubros
for each row execute function public.set_updated_at();

drop trigger if exists trg_evidencias_actividad_updated_at on public.evidencias_actividad;
create trigger trg_evidencias_actividad_updated_at
before update on public.evidencias_actividad
for each row execute function public.set_updated_at();

create or replace function public.sync_indicador_valor_actual()
returns trigger
language plpgsql
as $$
declare
  v_indicador_id uuid;
  v_ultimo_valor numeric(18,4);
  v_linea_base numeric(18,4);
begin
  if tg_op = 'DELETE' then
    v_indicador_id := old.indicador_id;
  else
    v_indicador_id := new.indicador_id;
  end if;

  select linea_base into v_linea_base
  from public.indicadores_actividad
  where id = v_indicador_id;

  select valor into v_ultimo_valor
  from public.seguimientos_indicador
  where indicador_id = v_indicador_id
  order by fecha_corte desc, created_at desc
  limit 1;

  update public.indicadores_actividad
  set valor_actual = coalesce(v_ultimo_valor, v_linea_base, 0)
  where id = v_indicador_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_indicador_valor_actual_insert on public.seguimientos_indicador;
create trigger trg_sync_indicador_valor_actual_insert
after insert on public.seguimientos_indicador
for each row execute function public.sync_indicador_valor_actual();

drop trigger if exists trg_sync_indicador_valor_actual_update on public.seguimientos_indicador;
create trigger trg_sync_indicador_valor_actual_update
after update on public.seguimientos_indicador
for each row execute function public.sync_indicador_valor_actual();

drop trigger if exists trg_sync_indicador_valor_actual_delete on public.seguimientos_indicador;
create trigger trg_sync_indicador_valor_actual_delete
after delete on public.seguimientos_indicador
for each row execute function public.sync_indicador_valor_actual();

alter table public.actividades enable row level security;
alter table public.indicadores_actividad enable row level security;
alter table public.seguimientos_indicador enable row level security;
alter table public.presupuesto_actividad_rubros enable row level security;
alter table public.evidencias_actividad enable row level security;
alter table public.seguimientos_actividad enable row level security;

drop policy if exists "authenticated_full_access" on public.actividades;
create policy "authenticated_full_access" on public.actividades
for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.indicadores_actividad;
create policy "authenticated_full_access" on public.indicadores_actividad
for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.seguimientos_indicador;
create policy "authenticated_full_access" on public.seguimientos_indicador
for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.presupuesto_actividad_rubros;
create policy "authenticated_full_access" on public.presupuesto_actividad_rubros
for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.evidencias_actividad;
create policy "authenticated_full_access" on public.evidencias_actividad
for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.seguimientos_actividad;
create policy "authenticated_full_access" on public.seguimientos_actividad
for all to authenticated using (true) with check (true);

commit;
notify pgrst, 'reload schema';
