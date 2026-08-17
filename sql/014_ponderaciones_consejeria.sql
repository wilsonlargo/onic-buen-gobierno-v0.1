-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 014 · Ponderaciones por Consejería
-- v0.10.0
-- ==========================================================

create table if not exists public.ponderacion_consejeria_aprobaciones (
  id uuid primary key default gen_random_uuid(),
  vigencia_id uuid not null references public.vigencias(id) on delete cascade,
  vigencia_consejeria_id uuid not null references public.vigencia_consejerias(id) on delete cascade,
  consejeria_nombre text not null,
  descripcion text not null check (length(trim(descripcion)) > 0),
  snapshot jsonb not null default '{}'::jsonb,
  aprobado_por_id uuid default auth.uid(),
  aprobado_por_email text not null default coalesce(auth.jwt() ->> 'email', 'Usuario'),
  aprobado_en timestamptz not null default now()
);

create index if not exists idx_ponderacion_aprobaciones_vigencia
  on public.ponderacion_consejeria_aprobaciones(vigencia_id, aprobado_en desc);
create index if not exists idx_ponderacion_aprobaciones_consejeria
  on public.ponderacion_consejeria_aprobaciones(vigencia_consejeria_id, aprobado_en desc);

alter table public.ponderacion_consejeria_aprobaciones enable row level security;
drop policy if exists authenticated_full_access on public.ponderacion_consejeria_aprobaciones;
create policy authenticated_full_access
on public.ponderacion_consejeria_aprobaciones
for all to authenticated
using (true)
with check (true);

-- ----------------------------------------------------------
-- Aprobación atómica: valida toda la Consejería y solo
-- entonces actualiza las ponderaciones oficiales.
-- ----------------------------------------------------------
create or replace function public.aprobar_ponderacion_consejeria(
  p_vigencia_consejeria_id uuid,
  p_descripcion text,
  p_ponderaciones jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vigencia_id uuid;
  v_consejeria_nombre text;
  v_estado text;
  v_item jsonb;
  v_project_id uuid;
  v_weight numeric;
  v_method text;
  v_program record;
  v_actual integer;
  v_received integer;
  v_sum numeric;
  v_total_items integer;
  v_distinct_items integer;
  v_updated integer := 0;
  v_snapshot jsonb;
  v_approval_id uuid;
begin
  if nullif(trim(p_descripcion), '') is null then
    raise exception 'La descripción o criterio de la ponderación es obligatorio.';
  end if;

  if jsonb_typeof(p_ponderaciones) is distinct from 'array' then
    raise exception 'La propuesta de ponderación debe enviarse como una lista.';
  end if;

  select
    vc.vigencia_id,
    coalesce(nullif(trim(c.nombre_corto), ''), c.nombre_largo),
    vc.estado
  into
    v_vigencia_id,
    v_consejeria_nombre,
    v_estado
  from public.vigencia_consejerias vc
  join public.consejerias c on c.id = vc.consejeria_id
  where vc.id = p_vigencia_consejeria_id;

  if not found then
    raise exception 'La Consejería seleccionada no existe en la Vigencia.';
  end if;

  if v_estado <> 'activa' then
    raise exception 'La Consejería debe estar activa para aprobar su ponderación.';
  end if;

  select count(*), count(distinct value ->> 'proyecto_id')
  into v_total_items, v_distinct_items
  from jsonb_array_elements(p_ponderaciones);

  if v_total_items <> v_distinct_items then
    raise exception 'La propuesta contiene Proyectos repetidos.';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_ponderaciones)
  loop
    begin
      v_project_id := (v_item ->> 'proyecto_id')::uuid;
      v_weight := (v_item ->> 'ponderacion')::numeric;
    exception when others then
      raise exception 'La propuesta contiene un identificador o porcentaje inválido.';
    end;

    v_method := coalesce(nullif(trim(v_item ->> 'metodo_ponderacion'), ''), 'manual');

    if v_weight < 0 or v_weight > 100 then
      raise exception 'Cada ponderación debe estar entre 0 y 100.';
    end if;

    if v_method not in ('manual','sugerida') then
      raise exception 'El método de ponderación no es válido.';
    end if;

    if not exists (
      select 1
      from public.proyectos pr
      join public.programas pg on pg.id = pr.programa_id
      join public.lineas_accion l on l.id = pg.linea_accion_id
      where pr.id = v_project_id
        and l.vigencia_consejeria_id = p_vigencia_consejeria_id
        and l.estado = 'activa'
        and pg.estado = 'activo'
    ) then
      raise exception 'La propuesta contiene un Proyecto que no pertenece a un Programa activo de la Consejería.';
    end if;
  end loop;

  for v_program in
    select pg.id, pg.nombre
    from public.programas pg
    join public.lineas_accion l on l.id = pg.linea_accion_id
    where l.vigencia_consejeria_id = p_vigencia_consejeria_id
      and l.estado = 'activa'
      and pg.estado = 'activo'
    order by pg.orden, pg.nombre
  loop
    select count(*) into v_actual
    from public.proyectos pr
    where pr.programa_id = v_program.id;

    if v_actual = 0 then
      continue;
    end if;

    select
      count(*),
      coalesce(sum((j.value ->> 'ponderacion')::numeric), 0)
    into v_received, v_sum
    from jsonb_array_elements(p_ponderaciones) j
    join public.proyectos pr
      on pr.id = (j.value ->> 'proyecto_id')::uuid
    where pr.programa_id = v_program.id;

    if v_received <> v_actual then
      raise exception 'El Programa "%" no contiene una propuesta para todos sus Proyectos.', v_program.nombre;
    end if;

    if abs(v_sum - 100) > 0.005 then
      raise exception 'El Programa "%" suma % y debe sumar exactamente 100,00 %.', v_program.nombre, round(v_sum, 2);
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_ponderaciones)
  loop
    v_project_id := (v_item ->> 'proyecto_id')::uuid;
    v_weight := round((v_item ->> 'ponderacion')::numeric, 2);
    v_method := coalesce(nullif(trim(v_item ->> 'metodo_ponderacion'), ''), 'manual');

    update public.proyectos
    set ponderacion = v_weight,
        metodo_ponderacion = v_method
    where id = v_project_id;

    v_updated := v_updated + 1;
  end loop;

  select jsonb_build_object(
    'consejeria_nombre', v_consejeria_nombre,
    'proyectos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'linea_nombre', l.nombre,
          'programa_nombre', pg.nombre,
          'proyecto_codigo', pr.codigo,
          'proyecto_nombre', pr.nombre,
          'ponderacion', pr.ponderacion,
          'metodo_ponderacion', pr.metodo_ponderacion
        ) order by l.orden, l.nombre, pg.orden, pg.nombre, pr.orden, pr.nombre
      ),
      '[]'::jsonb
    )
  )
  into v_snapshot
  from public.proyectos pr
  join public.programas pg on pg.id = pr.programa_id
  join public.lineas_accion l on l.id = pg.linea_accion_id
  where l.vigencia_consejeria_id = p_vigencia_consejeria_id
    and l.estado = 'activa'
    and pg.estado = 'activo';

  insert into public.ponderacion_consejeria_aprobaciones (
    vigencia_id,
    vigencia_consejeria_id,
    consejeria_nombre,
    descripcion,
    snapshot
  ) values (
    v_vigencia_id,
    p_vigencia_consejeria_id,
    v_consejeria_nombre,
    trim(p_descripcion),
    coalesce(v_snapshot, '{}'::jsonb)
  )
  returning id into v_approval_id;

  return jsonb_build_object(
    'ok', true,
    'aprobacion_id', v_approval_id,
    'proyectos_actualizados', v_updated,
    'vigencia_id', v_vigencia_id,
    'vigencia_consejeria_id', p_vigencia_consejeria_id
  );
end;
$$;

-- ----------------------------------------------------------
-- Integración con copia de seguridad / restauración.
-- Conserva el núcleo de v0.8.0 y añade el historial de
-- aprobaciones de ponderación.
-- ----------------------------------------------------------
do $$
begin
  if to_regprocedure('public.exportar_vigencia_json_core_v080(uuid)') is null
     and to_regprocedure('public.exportar_vigencia_json(uuid)') is not null then
    execute 'alter function public.exportar_vigencia_json(uuid) rename to exportar_vigencia_json_core_v080';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.importar_vigencia_json_core_v080(jsonb)') is null
     and to_regprocedure('public.importar_vigencia_json(jsonb)') is not null then
    execute 'alter function public.importar_vigencia_json(jsonb) rename to importar_vigencia_json_core_v080';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.resumen_eliminacion_vigencia_core_v080(uuid)') is null
     and to_regprocedure('public.resumen_eliminacion_vigencia(uuid)') is not null then
    execute 'alter function public.resumen_eliminacion_vigencia(uuid) rename to resumen_eliminacion_vigencia_core_v080';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.forzar_eliminar_vigencia_core_v080(uuid,text,text)') is null
     and to_regprocedure('public.forzar_eliminar_vigencia(uuid,text,text)') is not null then
    execute 'alter function public.forzar_eliminar_vigencia(uuid,text,text) rename to forzar_eliminar_vigencia_core_v080';
  end if;
end;
$$;

create or replace function public.exportar_vigencia_json(p_vigencia_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base jsonb;
  v_approvals jsonb;
begin
  v_base := public.exportar_vigencia_json_core_v080(p_vigencia_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'consejeria_nombre', a.consejeria_nombre,
        'descripcion', a.descripcion,
        'snapshot', a.snapshot,
        'aprobado_por_email', a.aprobado_por_email,
        'aprobado_en', a.aprobado_en
      ) order by a.aprobado_en, a.id
    ),
    '[]'::jsonb
  ) into v_approvals
  from public.ponderacion_consejeria_aprobaciones a
  where a.vigencia_id = p_vigencia_id;

  return v_base || jsonb_build_object('ponderacion_aprobaciones', v_approvals);
end;
$$;

create or replace function public.importar_vigencia_json(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_vigencia_id uuid;
  v_item jsonb;
  v_vc_id uuid;
  v_count integer := 0;
begin
  v_result := public.importar_vigencia_json_core_v080(p_payload);
  v_vigencia_id := (v_result ->> 'vigencia_id')::uuid;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'ponderacion_aprobaciones', '[]'::jsonb))
  loop
    v_vc_id := null;

    select vc.id into v_vc_id
    from public.vigencia_consejerias vc
    join public.consejerias c on c.id = vc.consejeria_id
    where vc.vigencia_id = v_vigencia_id
      and (
        lower(trim(c.nombre_corto)) = lower(trim(v_item ->> 'consejeria_nombre'))
        or lower(trim(c.nombre_largo)) = lower(trim(v_item ->> 'consejeria_nombre'))
      )
    order by vc.id
    limit 1;

    if v_vc_id is not null then
      insert into public.ponderacion_consejeria_aprobaciones (
        vigencia_id,
        vigencia_consejeria_id,
        consejeria_nombre,
        descripcion,
        snapshot,
        aprobado_por_id,
        aprobado_por_email,
        aprobado_en
      ) values (
        v_vigencia_id,
        v_vc_id,
        coalesce(nullif(trim(v_item ->> 'consejeria_nombre'), ''), 'Consejería restaurada'),
        coalesce(nullif(trim(v_item ->> 'descripcion'), ''), 'Ponderación restaurada'),
        coalesce(v_item -> 'snapshot', '{}'::jsonb),
        null,
        coalesce(nullif(trim(v_item ->> 'aprobado_por_email'), ''), 'Usuario histórico'),
        coalesce(nullif(v_item ->> 'aprobado_en','')::timestamptz, now())
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_result || jsonb_build_object('ponderacion_aprobaciones_restauradas', v_count);
end;
$$;

create or replace function public.resumen_eliminacion_vigencia(p_vigencia_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base jsonb;
  v_count integer;
begin
  v_base := public.resumen_eliminacion_vigencia_core_v080(p_vigencia_id);
  select count(*) into v_count
  from public.ponderacion_consejeria_aprobaciones
  where vigencia_id = p_vigencia_id;
  return v_base || jsonb_build_object('aprobaciones_ponderacion', v_count);
end;
$$;

create or replace function public.forzar_eliminar_vigencia(
  p_vigencia_id uuid,
  p_confirmacion text,
  p_nombre_confirmacion text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_result jsonb;
  v_total integer;
begin
  select count(*) into v_count
  from public.ponderacion_consejeria_aprobaciones
  where vigencia_id = p_vigencia_id;

  v_result := public.forzar_eliminar_vigencia_core_v080(
    p_vigencia_id,
    p_confirmacion,
    p_nombre_confirmacion
  );

  v_total := coalesce((v_result ->> 'registros_eliminados')::integer, 0) + v_count;

  return v_result || jsonb_build_object(
    'aprobaciones_ponderacion_eliminadas', v_count,
    'registros_eliminados', v_total
  );
end;
$$;

revoke all on function public.aprobar_ponderacion_consejeria(uuid,text,jsonb) from public;
revoke all on function public.exportar_vigencia_json(uuid) from public;
revoke all on function public.importar_vigencia_json(jsonb) from public;
revoke all on function public.resumen_eliminacion_vigencia(uuid) from public;
revoke all on function public.forzar_eliminar_vigencia(uuid,text,text) from public;

grant execute on function public.aprobar_ponderacion_consejeria(uuid,text,jsonb) to authenticated;
grant execute on function public.exportar_vigencia_json(uuid) to authenticated;
grant execute on function public.importar_vigencia_json(jsonb) to authenticated;
grant execute on function public.resumen_eliminacion_vigencia(uuid) to authenticated;
grant execute on function public.forzar_eliminar_vigencia(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
