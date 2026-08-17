-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 013 · Auditoría y notas contextuales
-- v0.8.0
-- ==========================================================

create table if not exists public.auditoria_notas (
  id uuid primary key default gen_random_uuid(),
  vigencia_id uuid not null references public.vigencias(id) on delete cascade,
  entidad_tipo text not null check (
    entidad_tipo in ('vigencia','consejeria','linea','programa','proyecto','actividad','indicador','mandato')
  ),
  entidad_id uuid,
  entidad_nombre text not null,
  seccion text,
  ruta text not null,
  navegacion jsonb not null default '{}'::jsonb,
  tema text not null,
  comentario text not null,
  estado text not null default 'pendiente' check (
    estado in ('pendiente','en_proceso','resuelta')
  ),
  respuesta text,
  autor_id uuid default auth.uid(),
  autor_email text not null default coalesce(auth.jwt() ->> 'email', 'Usuario'),
  creado_en timestamptz not null default now(),
  modificado_por_id uuid,
  modificado_por_email text,
  modificado_en timestamptz not null default now(),
  resuelta_en timestamptz
);

create index if not exists idx_auditoria_notas_vigencia
  on public.auditoria_notas(vigencia_id);
create index if not exists idx_auditoria_notas_estado
  on public.auditoria_notas(vigencia_id, estado);
create index if not exists idx_auditoria_notas_entidad
  on public.auditoria_notas(vigencia_id, entidad_tipo, entidad_id);

alter table public.auditoria_notas enable row level security;

drop policy if exists authenticated_full_access on public.auditoria_notas;
create policy authenticated_full_access
on public.auditoria_notas
for all
to authenticated
using (true)
with check (true);

create or replace function public.touch_auditoria_nota()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.modificado_en := now();

  if new.estado = 'resuelta'
     and old.estado is distinct from 'resuelta'
     and new.resuelta_en is null then
    new.resuelta_en := now();
  end if;

  if new.estado <> 'resuelta' then
    new.resuelta_en := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_touch_auditoria_nota on public.auditoria_notas;
create trigger trg_touch_auditoria_nota
before update on public.auditoria_notas
for each row execute function public.touch_auditoria_nota();

-- ----------------------------------------------------------
-- Conservamos las funciones de v0.7.6 como núcleo.
-- ----------------------------------------------------------
do $$
begin
  if to_regprocedure('public.exportar_vigencia_json_core_v076(uuid)') is null
     and to_regprocedure('public.exportar_vigencia_json(uuid)') is not null then
    execute 'alter function public.exportar_vigencia_json(uuid) rename to exportar_vigencia_json_core_v076';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.importar_vigencia_json_core_v076(jsonb)') is null
     and to_regprocedure('public.importar_vigencia_json(jsonb)') is not null then
    execute 'alter function public.importar_vigencia_json(jsonb) rename to importar_vigencia_json_core_v076';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.resumen_eliminacion_vigencia_core_v076(uuid)') is null
     and to_regprocedure('public.resumen_eliminacion_vigencia(uuid)') is not null then
    execute 'alter function public.resumen_eliminacion_vigencia(uuid) rename to resumen_eliminacion_vigencia_core_v076';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.forzar_eliminar_vigencia_core_v076(uuid,text,text)') is null
     and to_regprocedure('public.forzar_eliminar_vigencia(uuid,text,text)') is not null then
    execute 'alter function public.forzar_eliminar_vigencia(uuid,text,text) rename to forzar_eliminar_vigencia_core_v076';
  end if;
end;
$$;

-- ----------------------------------------------------------
-- Copia de seguridad: añade auditoria[].
-- ----------------------------------------------------------
create or replace function public.exportar_vigencia_json(p_vigencia_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base jsonb;
  v_notas jsonb;
begin
  v_base := public.exportar_vigencia_json_core_v076(p_vigencia_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entidad_tipo', n.entidad_tipo,
        'entidad_nombre', n.entidad_nombre,
        'seccion', n.seccion,
        'ruta', n.ruta,
        'navegacion', n.navegacion,
        'tema', n.tema,
        'comentario', n.comentario,
        'estado', n.estado,
        'respuesta', n.respuesta,
        'autor_email', n.autor_email,
        'creado_en', n.creado_en,
        'modificado_por_email', n.modificado_por_email,
        'modificado_en', n.modificado_en,
        'resuelta_en', n.resuelta_en
      ) order by n.creado_en, n.id
    ),
    '[]'::jsonb
  ) into v_notas
  from public.auditoria_notas n
  where n.vigencia_id = p_vigencia_id;

  return v_base || jsonb_build_object('auditoria', v_notas);
end;
$$;

-- ----------------------------------------------------------
-- Restauración: reconstruye referencias principales usando
-- nombres y códigos portables guardados en navegacion.
-- ----------------------------------------------------------
create or replace function public.importar_vigencia_json(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_vigencia_id uuid;
  v_note jsonb;
  v_nav jsonb;
  v_new_nav jsonb;
  v_type text;
  v_vc_id uuid;
  v_linea_id uuid;
  v_programa_id uuid;
  v_proyecto_id uuid;
  v_actividad_id uuid;
  v_indicador_id uuid;
  v_mandato_id uuid;
  v_entity_id uuid;
  v_count integer := 0;
begin
  v_result := public.importar_vigencia_json_core_v076(p_payload);
  v_vigencia_id := (v_result ->> 'vigencia_id')::uuid;

  for v_note in
    select value from jsonb_array_elements(coalesce(p_payload -> 'auditoria', '[]'::jsonb))
  loop
    v_nav := coalesce(v_note -> 'navegacion', '{}'::jsonb);
    v_vc_id := null;
    v_linea_id := null;
    v_programa_id := null;
    v_proyecto_id := null;
    v_actividad_id := null;
    v_indicador_id := null;
    v_mandato_id := null;

    if nullif(trim(v_nav ->> 'consejeria_nombre'), '') is not null then
      select vc.id into v_vc_id
      from public.vigencia_consejerias vc
      join public.consejerias c on c.id = vc.consejeria_id
      where vc.vigencia_id = v_vigencia_id
        and (
          lower(trim(c.nombre_corto)) = lower(trim(v_nav ->> 'consejeria_nombre'))
          or lower(trim(c.nombre_largo)) = lower(trim(v_nav ->> 'consejeria_nombre'))
        )
      order by vc.id limit 1;
    end if;

    if v_vc_id is not null and nullif(trim(v_nav ->> 'linea_nombre'), '') is not null then
      select l.id into v_linea_id
      from public.lineas_accion l
      where l.vigencia_consejeria_id = v_vc_id
        and lower(trim(l.nombre)) = lower(trim(v_nav ->> 'linea_nombre'))
      order by l.id limit 1;
    end if;

    if v_linea_id is not null and nullif(trim(v_nav ->> 'programa_nombre'), '') is not null then
      select p.id into v_programa_id
      from public.programas p
      where p.linea_accion_id = v_linea_id
        and lower(trim(p.nombre)) = lower(trim(v_nav ->> 'programa_nombre'))
      order by p.id limit 1;
    end if;

    if v_programa_id is not null then
      select p.id into v_proyecto_id
      from public.proyectos p
      where p.programa_id = v_programa_id
        and (
          (nullif(trim(v_nav ->> 'proyecto_codigo'), '') is not null
           and lower(trim(coalesce(p.codigo,''))) = lower(trim(v_nav ->> 'proyecto_codigo')))
          or
          (nullif(trim(v_nav ->> 'proyecto_nombre'), '') is not null
           and lower(trim(p.nombre)) = lower(trim(v_nav ->> 'proyecto_nombre')))
        )
      order by case
        when lower(trim(coalesce(p.codigo,''))) = lower(trim(coalesce(v_nav ->> 'proyecto_codigo',''))) then 0
        else 1 end,
        p.id
      limit 1;
    end if;

    if v_proyecto_id is not null then
      select a.id into v_actividad_id
      from public.actividades a
      where a.proyecto_id = v_proyecto_id
        and (
          (nullif(trim(v_nav ->> 'actividad_codigo'), '') is not null
           and lower(trim(coalesce(a.codigo,''))) = lower(trim(v_nav ->> 'actividad_codigo')))
          or
          (nullif(trim(v_nav ->> 'actividad_nombre'), '') is not null
           and lower(trim(a.nombre)) = lower(trim(v_nav ->> 'actividad_nombre')))
        )
      order by a.id limit 1;
    end if;

    if v_actividad_id is not null then
      select i.id into v_indicador_id
      from public.indicadores_actividad i
      where i.actividad_id = v_actividad_id
        and (
          (nullif(trim(v_nav ->> 'indicador_codigo'), '') is not null
           and lower(trim(coalesce(i.codigo,''))) = lower(trim(v_nav ->> 'indicador_codigo')))
          or
          (nullif(trim(v_nav ->> 'indicador_nombre'), '') is not null
           and lower(trim(i.nombre)) = lower(trim(v_nav ->> 'indicador_nombre')))
        )
      order by i.id limit 1;
    end if;

    if nullif(trim(v_nav ->> 'mandato_codigo'), '') is not null then
      select m.id into v_mandato_id
      from public.mandatos m
      where m.vigencia_id = v_vigencia_id
        and lower(trim(coalesce(m.codigo,''))) = lower(trim(v_nav ->> 'mandato_codigo'))
      order by m.id limit 1;
    end if;

    v_type := coalesce(nullif(trim(v_note ->> 'entidad_tipo'), ''), 'vigencia');
    v_entity_id := case v_type
      when 'vigencia' then v_vigencia_id
      when 'consejeria' then v_vc_id
      when 'linea' then v_linea_id
      when 'programa' then v_programa_id
      when 'proyecto' then v_proyecto_id
      when 'actividad' then v_actividad_id
      when 'indicador' then v_indicador_id
      when 'mandato' then v_mandato_id
      else null end;

    v_new_nav := v_nav || jsonb_build_object('vigencia_id', v_vigencia_id::text);
    if v_vc_id is not null then v_new_nav := v_new_nav || jsonb_build_object('vigencia_consejeria_id', v_vc_id::text); end if;
    if v_linea_id is not null then v_new_nav := v_new_nav || jsonb_build_object('linea_id', v_linea_id::text); end if;
    if v_programa_id is not null then v_new_nav := v_new_nav || jsonb_build_object('programa_id', v_programa_id::text); end if;
    if v_proyecto_id is not null then v_new_nav := v_new_nav || jsonb_build_object('proyecto_id', v_proyecto_id::text); end if;
    if v_actividad_id is not null then v_new_nav := v_new_nav || jsonb_build_object('actividad_id', v_actividad_id::text); end if;
    if v_indicador_id is not null then v_new_nav := v_new_nav || jsonb_build_object('indicador_id', v_indicador_id::text); end if;
    if v_mandato_id is not null then v_new_nav := v_new_nav || jsonb_build_object('mandato_id', v_mandato_id::text); end if;

    insert into public.auditoria_notas (
      vigencia_id, entidad_tipo, entidad_id, entidad_nombre,
      seccion, ruta, navegacion, tema, comentario, estado,
      respuesta, autor_email, creado_en, modificado_por_email,
      modificado_en, resuelta_en
    ) values (
      v_vigencia_id,
      v_type,
      v_entity_id,
      coalesce(nullif(trim(v_note ->> 'entidad_nombre'), ''), 'Referencia restaurada'),
      nullif(trim(v_note ->> 'seccion'), ''),
      coalesce(nullif(trim(v_note ->> 'ruta'), ''), 'Vigencia restaurada'),
      v_new_nav,
      coalesce(nullif(trim(v_note ->> 'tema'), ''), 'Nota restaurada'),
      coalesce(nullif(trim(v_note ->> 'comentario'), ''), 'Sin comentario'),
      coalesce(nullif(trim(v_note ->> 'estado'), ''), 'pendiente'),
      nullif(trim(v_note ->> 'respuesta'), ''),
      coalesce(nullif(trim(v_note ->> 'autor_email'), ''), 'Usuario histórico'),
      coalesce(nullif(v_note ->> 'creado_en','')::timestamptz, now()),
      nullif(trim(v_note ->> 'modificado_por_email'), ''),
      coalesce(nullif(v_note ->> 'modificado_en','')::timestamptz,
               nullif(v_note ->> 'creado_en','')::timestamptz, now()),
      nullif(v_note ->> 'resuelta_en','')::timestamptz
    );

    v_count := v_count + 1;
  end loop;

  return v_result || jsonb_build_object('auditoria_restaurada', v_count);
end;
$$;

-- ----------------------------------------------------------
-- Eliminación forzada: las notas se eliminan por CASCADE.
-- ----------------------------------------------------------
create or replace function public.resumen_eliminacion_vigencia(p_vigencia_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base jsonb;
  v_notas integer;
begin
  v_base := public.resumen_eliminacion_vigencia_core_v076(p_vigencia_id);
  select count(*) into v_notas from public.auditoria_notas where vigencia_id = p_vigencia_id;
  return v_base || jsonb_build_object('notas_auditoria', v_notas);
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
  v_notas integer;
  v_result jsonb;
  v_total integer;
begin
  select count(*) into v_notas from public.auditoria_notas where vigencia_id = p_vigencia_id;
  v_result := public.forzar_eliminar_vigencia_core_v076(
    p_vigencia_id, p_confirmacion, p_nombre_confirmacion
  );
  v_total := coalesce((v_result ->> 'registros_eliminados')::integer, 0) + v_notas;
  return v_result || jsonb_build_object(
    'notas_auditoria_eliminadas', v_notas,
    'registros_eliminados', v_total
  );
end;
$$;

revoke all on function public.exportar_vigencia_json(uuid) from public;
revoke all on function public.importar_vigencia_json(jsonb) from public;
revoke all on function public.resumen_eliminacion_vigencia(uuid) from public;
revoke all on function public.forzar_eliminar_vigencia(uuid,text,text) from public;

grant execute on function public.exportar_vigencia_json(uuid) to authenticated;
grant execute on function public.importar_vigencia_json(jsonb) to authenticated;
grant execute on function public.resumen_eliminacion_vigencia(uuid) to authenticated;
grant execute on function public.forzar_eliminar_vigencia(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
