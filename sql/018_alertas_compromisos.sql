-- ==========================================================
-- ONIC Buen Gobierno · v0.14.0
-- Centro de alertas + compromisos / tareas
-- Requiere las funciones de seguridad multiusuario instaladas
-- en versiones anteriores.
-- ==========================================================

begin;

create table if not exists public.compromisos_tareas (
  id uuid primary key default gen_random_uuid(),
  vigencia_id uuid not null references public.vigencias(id) on delete cascade,
  vigencia_consejeria_id uuid references public.vigencia_consejerias(id) on delete cascade,

  -- Referencia funcional dentro del Sistema.
  entidad_tipo text not null default 'vigencia',
  entidad_id uuid,
  entidad_nombre text,
  ruta text,
  navigation jsonb not null default '{}'::jsonb,
  alerta_clave text,

  titulo text not null,
  descripcion text,
  prioridad text not null default 'media'
    check (prioridad in ('baja','media','alta')),
  fecha_limite date,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','en_proceso','completada','cancelada')),
  resultado_cierre text,

  responsable_usuario_id uuid references public.perfiles_usuario(id) on delete set null,
  responsable_nombre text,
  responsable_email text,

  creado_por_id uuid,
  creado_por_email text,
  creado_en timestamptz not null default now(),
  actualizado_por_id uuid,
  actualizado_por_email text,
  actualizado_en timestamptz not null default now(),
  completado_en timestamptz,
  row_version bigint not null default 1
);

create index if not exists idx_compromisos_vigencia_estado
  on public.compromisos_tareas(vigencia_id, estado, fecha_limite);

create index if not exists idx_compromisos_vc_estado
  on public.compromisos_tareas(vigencia_consejeria_id, estado, fecha_limite);

create index if not exists idx_compromisos_responsable
  on public.compromisos_tareas(responsable_usuario_id, estado, fecha_limite);

create index if not exists idx_compromisos_alerta
  on public.compromisos_tareas(alerta_clave)
  where alerta_clave is not null;

alter table public.compromisos_tareas enable row level security;

-- Lectura: un usuario global ve la Vigencia completa; un usuario de
-- Consejería ve únicamente los compromisos de sus Consejerías asignadas.
drop policy if exists app_compromisos_select on public.compromisos_tareas;
create policy app_compromisos_select on public.compromisos_tareas
for select to authenticated
using (
  case
    when vigencia_consejeria_id is not null then public.app_can_read_vc(vigencia_consejeria_id)
    else public.app_can_read_vigencia(vigencia_id)
  end
);

-- Escritura: Administrador/Coordinador pueden trabajar a nivel de Vigencia.
-- Consejería puede crear y actualizar únicamente dentro de su alcance.
drop policy if exists app_compromisos_insert on public.compromisos_tareas;
create policy app_compromisos_insert on public.compromisos_tareas
for insert to authenticated
with check (
  case
    when vigencia_consejeria_id is not null then public.app_can_write_vc(vigencia_consejeria_id)
    else public.app_is_global_writer()
  end
);

drop policy if exists app_compromisos_update on public.compromisos_tareas;
create policy app_compromisos_update on public.compromisos_tareas
for update to authenticated
using (
  case
    when vigencia_consejeria_id is not null then public.app_can_write_vc(vigencia_consejeria_id)
    else public.app_is_global_writer()
  end
)
with check (
  case
    when vigencia_consejeria_id is not null then public.app_can_write_vc(vigencia_consejeria_id)
    else public.app_is_global_writer()
  end
);

-- No se elimina desde la interfaz: los compromisos se completan o cancelan.
-- La eliminación física se reserva al Administrador y al borrado forzado
drop policy if exists app_compromisos_delete on public.compromisos_tareas;
create policy app_compromisos_delete on public.compromisos_tareas
for delete to authenticated
using (public.app_is_admin());

-- ----------------------------------------------------------
-- Guardado, responsable, trazabilidad y control de versión.
-- ----------------------------------------------------------
create or replace function public.app_guard_compromiso_tarea()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_profile public.perfiles_usuario%rowtype;
begin
  if new.vigencia_consejeria_id is not null then
    if not public.app_can_write_vc(new.vigencia_consejeria_id) then
      raise exception 'No tienes permiso para administrar compromisos en esta Consejería.';
    end if;

    if not exists (
      select 1
      from public.vigencia_consejerias vc
      where vc.id = new.vigencia_consejeria_id
        and vc.vigencia_id = new.vigencia_id
    ) then
      raise exception 'La Consejería seleccionada no pertenece a la Vigencia.';
    end if;
  elsif not public.app_is_global_writer() then
    raise exception 'Los compromisos generales de la Vigencia solo pueden ser administrados por Coordinación.';
  end if;

  new.titulo := nullif(trim(new.titulo), '');
  if new.titulo is null then
    raise exception 'El compromiso debe tener un título.';
  end if;

  new.descripcion := nullif(trim(coalesce(new.descripcion, '')), '');
  new.resultado_cierre := nullif(trim(coalesce(new.resultado_cierre, '')), '');
  new.entidad_nombre := nullif(trim(coalesce(new.entidad_nombre, '')), '');
  new.ruta := nullif(trim(coalesce(new.ruta, '')), '');
  new.alerta_clave := nullif(trim(coalesce(new.alerta_clave, '')), '');
  new.navigation := coalesce(new.navigation, '{}'::jsonb);

  if new.prioridad not in ('baja','media','alta') then
    new.prioridad := 'media';
  end if;

  if new.estado not in ('pendiente','en_proceso','completada','cancelada') then
    new.estado := 'pendiente';
  end if;

  if new.responsable_usuario_id is not null then
    select * into v_profile
    from public.perfiles_usuario p
    where p.id = new.responsable_usuario_id
      and p.estado = 'activo';

    if not found then
      raise exception 'El responsable seleccionado no está disponible.';
    end if;

    if v_profile.rol = 'consulta' then
      raise exception 'Un usuario de Consulta no puede ser responsable de un compromiso.';
    end if;

    new.responsable_nombre := coalesce(nullif(v_profile.nombre, ''), v_profile.email);
    new.responsable_email := v_profile.email;
  else
    new.responsable_nombre := nullif(trim(coalesce(new.responsable_nombre, '')), '');
    new.responsable_email := nullif(trim(coalesce(new.responsable_email, '')), '');
  end if;

  v_email := coalesce(nullif(auth.jwt() ->> 'email', ''), 'Usuario');

  if tg_op = 'INSERT' then
    new.creado_por_id := coalesce(new.creado_por_id, auth.uid());
    new.creado_por_email := coalesce(nullif(new.creado_por_email, ''), v_email);
    new.creado_en := coalesce(new.creado_en, now());
    new.actualizado_por_id := coalesce(new.actualizado_por_id, auth.uid());
    new.actualizado_por_email := coalesce(nullif(new.actualizado_por_email, ''), v_email);
    new.actualizado_en := coalesce(new.actualizado_en, now());
    new.row_version := coalesce(new.row_version, 1);

    if new.estado = 'completada' then
      new.completado_en := coalesce(new.completado_en, now());
    else
      new.completado_en := null;
    end if;

    return new;
  end if;

  new.actualizado_por_id := auth.uid();
  new.actualizado_por_email := v_email;
  new.actualizado_en := now();
  new.row_version := coalesce(old.row_version, 1) + 1;

  if new.estado = 'completada' and old.estado <> 'completada' then
    new.completado_en := now();
  elsif new.estado <> 'completada' then
    new.completado_en := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_guard_compromiso on public.compromisos_tareas;
create trigger trg_app_guard_compromiso
before insert or update on public.compromisos_tareas
for each row execute function public.app_guard_compromiso_tarea();

-- ----------------------------------------------------------
-- Historial automático.
-- ----------------------------------------------------------
create or replace function public.app_log_compromiso_tarea()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    v_old := null;
    v_new := public.app_strip_log_meta(v_row);
    v_changes := '{}'::jsonb;
    v_action := 'crear_compromiso';
  elsif tg_op = 'UPDATE' then
    v_row := to_jsonb(new);
    v_old := public.app_strip_log_meta(to_jsonb(old));
    v_new := public.app_strip_log_meta(to_jsonb(new));
    v_changes := public.app_jsonb_changes(v_old, v_new);

    v_action := case
      when old.estado <> new.estado and new.estado = 'completada' then 'completar_compromiso'
      when old.estado <> new.estado and new.estado = 'cancelada' then 'cancelar_compromiso'
      when old.estado in ('completada','cancelada') and new.estado in ('pendiente','en_proceso') then 'reabrir_compromiso'
      else 'actualizar_compromiso'
    end;
  else
    v_row := to_jsonb(old);
    v_old := public.app_strip_log_meta(v_row);
    v_new := null;
    v_changes := '{}'::jsonb;
    v_action := 'eliminar_compromiso';
  end if;

  insert into public.historial_actividad (
    vigencia_id,
    vigencia_consejeria_id,
    usuario_id,
    usuario_email,
    accion,
    entidad_tipo,
    entidad_id,
    entidad_nombre,
    tabla_origen,
    datos_anteriores,
    datos_nuevos,
    cambios,
    detalle
  ) values (
    nullif(v_row ->> 'vigencia_id', '')::uuid,
    nullif(v_row ->> 'vigencia_consejeria_id', '')::uuid,
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'Sistema'),
    v_action,
    'compromiso',
    nullif(v_row ->> 'id', '')::uuid,
    coalesce(nullif(v_row ->> 'titulo', ''), 'Compromiso'),
    'compromisos_tareas',
    v_old,
    v_new,
    coalesce(v_changes, '{}'::jsonb),
    jsonb_build_object('operacion', tg_op)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_app_history_compromiso on public.compromisos_tareas;
create trigger trg_app_history_compromiso
after insert or update or delete on public.compromisos_tareas
for each row execute function public.app_log_compromiso_tarea();

-- ----------------------------------------------------------
-- Responsables disponibles para tareas.
-- ----------------------------------------------------------
create or replace function public.listar_responsables_tareas(
  p_vigencia_id uuid,
  p_vigencia_consejeria_id uuid default null
)
returns table (
  id uuid,
  email text,
  nombre text,
  rol text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if public.app_is_global_writer() then
    return query
      select p.id, p.email, p.nombre, p.rol
      from public.perfiles_usuario p
      where p.estado = 'activo'
        and p.rol in ('administrador','coordinador','consejeria')
      order by coalesce(nullif(p.nombre, ''), p.email), p.email;
    return;
  end if;

  if public.app_current_role() = 'consejeria'
     and p_vigencia_consejeria_id is not null
     and public.app_can_write_vc(p_vigencia_consejeria_id) then
    return query
      select distinct p.id, p.email, p.nombre, p.rol
      from public.perfiles_usuario p
      where p.estado = 'activo'
        and p.rol in ('administrador','coordinador','consejeria')
        and (
          p.rol in ('administrador','coordinador')
          or p.id = auth.uid()
          or exists (
            select 1
            from public.usuario_consejerias uc
            where uc.usuario_id = p.id
              and uc.vigencia_consejeria_id = p_vigencia_consejeria_id
          )
        )
      order by coalesce(nullif(p.nombre, ''), p.email), p.email;
    return;
  end if;

  return query
    select p.id, p.email, p.nombre, p.rol
    from public.perfiles_usuario p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.rol <> 'consulta';
end;
$$;

commit;

-- ==========================================================
-- COPIA DE SEGURIDAD / RESTAURACIÓN / ELIMINACIÓN DE VIGENCIA
-- ==========================================================
-- Se envuelven las funciones de v0.13.3 para añadir compromisos.

do $$
begin
  if to_regprocedure('public.exportar_vigencia_json_core_v0133(uuid)') is null
     and to_regprocedure('public.exportar_vigencia_json(uuid)') is not null then
    execute 'alter function public.exportar_vigencia_json(uuid) rename to exportar_vigencia_json_core_v0133';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.importar_vigencia_json_core_v0133(jsonb)') is null
     and to_regprocedure('public.importar_vigencia_json(jsonb)') is not null then
    execute 'alter function public.importar_vigencia_json(jsonb) rename to importar_vigencia_json_core_v0133';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.resumen_eliminacion_vigencia_core_v0133(uuid)') is null
     and to_regprocedure('public.resumen_eliminacion_vigencia(uuid)') is not null then
    execute 'alter function public.resumen_eliminacion_vigencia(uuid) rename to resumen_eliminacion_vigencia_core_v0133';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.forzar_eliminar_vigencia_core_v0133(uuid,text,text)') is null
     and to_regprocedure('public.forzar_eliminar_vigencia(uuid,text,text)') is not null then
    execute 'alter function public.forzar_eliminar_vigencia(uuid,text,text) rename to forzar_eliminar_vigencia_core_v0133';
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
  v_compromisos jsonb;
begin
  v_base := public.exportar_vigencia_json_core_v0133(p_vigencia_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'consejeria_nombre', coalesce(c.nombre_corto, c.nombre_largo),
        'entidad_tipo', t.entidad_tipo,
        'entidad_nombre', t.entidad_nombre,
        'ruta', t.ruta,
        'alerta_clave', t.alerta_clave,
        'titulo', t.titulo,
        'descripcion', t.descripcion,
        'prioridad', t.prioridad,
        'fecha_limite', t.fecha_limite,
        'estado', t.estado,
        'resultado_cierre', t.resultado_cierre,
        'responsable_email', t.responsable_email,
        'responsable_nombre', t.responsable_nombre,
        'creado_por_email', t.creado_por_email,
        'creado_en', t.creado_en,
        'actualizado_por_email', t.actualizado_por_email,
        'actualizado_en', t.actualizado_en,
        'completado_en', t.completado_en
      ) order by t.creado_en, t.id
    ),
    '[]'::jsonb
  ) into v_compromisos
  from public.compromisos_tareas t
  left join public.vigencia_consejerias vc on vc.id = t.vigencia_consejeria_id
  left join public.consejerias c on c.id = vc.consejeria_id
  where t.vigencia_id = p_vigencia_id;

  return v_base || jsonb_build_object('compromisos_tareas', v_compromisos);
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
  v_responsable_id uuid;
  v_count integer := 0;
begin
  v_result := public.importar_vigencia_json_core_v0133(p_payload);
  v_vigencia_id := (v_result ->> 'vigencia_id')::uuid;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload -> 'compromisos_tareas', '[]'::jsonb))
  loop
    v_vc_id := null;
    v_responsable_id := null;

    if nullif(trim(v_item ->> 'consejeria_nombre'), '') is not null then
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
    end if;

    if nullif(trim(v_item ->> 'responsable_email'), '') is not null then
      select p.id into v_responsable_id
      from public.perfiles_usuario p
      where lower(p.email) = lower(trim(v_item ->> 'responsable_email'))
        and p.estado = 'activo'
        and p.rol <> 'consulta'
      limit 1;
    end if;

    insert into public.compromisos_tareas (
      vigencia_id,
      vigencia_consejeria_id,
      entidad_tipo,
      entidad_id,
      entidad_nombre,
      ruta,
      navigation,
      alerta_clave,
      titulo,
      descripcion,
      prioridad,
      fecha_limite,
      estado,
      resultado_cierre,
      responsable_usuario_id,
      responsable_nombre,
      responsable_email,
      creado_por_id,
      creado_por_email,
      creado_en,
      actualizado_por_id,
      actualizado_por_email,
      actualizado_en,
      completado_en
    ) values (
      v_vigencia_id,
      v_vc_id,
      case when v_vc_id is not null then 'consejeria' else 'vigencia' end,
      case when v_vc_id is not null then v_vc_id else v_vigencia_id end,
      coalesce(nullif(v_item ->> 'entidad_nombre', ''), nullif(v_item ->> 'consejeria_nombre', ''), 'Vigencia restaurada'),
      nullif(v_item ->> 'ruta', ''),
      case
        when v_vc_id is not null then jsonb_build_object('view','consejerias','vigencia_id',v_vigencia_id,'vigencia_consejeria_id',v_vc_id)
        else jsonb_build_object('view','inicio','vigencia_id',v_vigencia_id)
      end,
      nullif(v_item ->> 'alerta_clave', ''),
      coalesce(nullif(trim(v_item ->> 'titulo'), ''), 'Compromiso restaurado'),
      nullif(v_item ->> 'descripcion', ''),
      case when v_item ->> 'prioridad' in ('baja','media','alta') then v_item ->> 'prioridad' else 'media' end,
      nullif(v_item ->> 'fecha_limite', '')::date,
      case when v_item ->> 'estado' in ('pendiente','en_proceso','completada','cancelada') then v_item ->> 'estado' else 'pendiente' end,
      nullif(v_item ->> 'resultado_cierre', ''),
      v_responsable_id,
      coalesce(nullif(v_item ->> 'responsable_nombre', ''), nullif(v_item ->> 'responsable_email', '')),
      nullif(v_item ->> 'responsable_email', ''),
      null,
      coalesce(nullif(v_item ->> 'creado_por_email', ''), 'Usuario histórico'),
      coalesce(nullif(v_item ->> 'creado_en', '')::timestamptz, now()),
      null,
      nullif(v_item ->> 'actualizado_por_email', ''),
      coalesce(nullif(v_item ->> 'actualizado_en', '')::timestamptz, now()),
      nullif(v_item ->> 'completado_en', '')::timestamptz
    );

    v_count := v_count + 1;
  end loop;

  return v_result || jsonb_build_object('compromisos_restaurados', v_count);
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
  v_compromisos integer;
begin
  v_base := public.resumen_eliminacion_vigencia_core_v0133(p_vigencia_id);

  select count(*) into v_compromisos
  from public.compromisos_tareas
  where vigencia_id = p_vigencia_id;

  return v_base || jsonb_build_object('compromisos_tareas', v_compromisos);
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
  v_compromisos integer;
  v_result jsonb;
  v_total integer;
begin
  select count(*) into v_compromisos
  from public.compromisos_tareas
  where vigencia_id = p_vigencia_id;

  v_result := public.forzar_eliminar_vigencia_core_v0133(
    p_vigencia_id,
    p_confirmacion,
    p_nombre_confirmacion
  );

  v_total := coalesce((v_result ->> 'registros_eliminados')::integer, 0) + v_compromisos;

  return v_result || jsonb_build_object(
    'compromisos_tareas_eliminados', v_compromisos,
    'registros_eliminados', v_total
  );
end;
$$;

grant select, insert, update, delete on public.compromisos_tareas to authenticated;

revoke all on function public.listar_responsables_tareas(uuid,uuid) from public;
revoke all on function public.exportar_vigencia_json(uuid) from public;
revoke all on function public.importar_vigencia_json(jsonb) from public;
revoke all on function public.resumen_eliminacion_vigencia(uuid) from public;
revoke all on function public.forzar_eliminar_vigencia(uuid,text,text) from public;

grant execute on function public.listar_responsables_tareas(uuid,uuid) to authenticated;
grant execute on function public.exportar_vigencia_json(uuid) to authenticated;
grant execute on function public.importar_vigencia_json(jsonb) to authenticated;
grant execute on function public.resumen_eliminacion_vigencia(uuid) to authenticated;
grant execute on function public.forzar_eliminar_vigencia(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
