-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 015 · Seguridad, roles, concurrencia e historial
-- v0.11.0
-- ==========================================================
-- Requiere migraciones 001–014 aplicadas.
-- Esta migración:
--   1. Crea perfiles y asignaciones de usuarios.
--   2. Reemplaza el acceso amplio de desarrollo por RLS real.
--   3. Agrega control de versión a registros editables.
--   4. Registra automáticamente cambios relevantes.
--   5. Protege la aprobación de ponderaciones concurrentes.
-- ==========================================================

begin;

-- ----------------------------------------------------------
-- 1. PERFILES Y ASIGNACIONES
-- ----------------------------------------------------------
create table if not exists public.perfiles_usuario (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'consulta'
    check (rol in ('administrador','coordinador','consejeria','consulta')),
  estado text not null default 'activo'
    check (estado in ('activo','inactivo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_perfiles_usuario_email
  on public.perfiles_usuario (lower(email));
create index if not exists idx_perfiles_usuario_rol
  on public.perfiles_usuario (rol, estado);

create table if not exists public.usuario_consejerias (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles_usuario(id) on delete cascade,
  vigencia_consejeria_id uuid not null references public.vigencia_consejerias(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (usuario_id, vigencia_consejeria_id)
);

create index if not exists idx_usuario_consejerias_usuario
  on public.usuario_consejerias(usuario_id);
create index if not exists idx_usuario_consejerias_vc
  on public.usuario_consejerias(vigencia_consejeria_id);

-- Sincroniza usuarios existentes. Los nuevos usuarios se crean como Consulta.
insert into public.perfiles_usuario (id, email, nombre, rol, estado, created_at, updated_at)
select
  u.id,
  coalesce(u.email, 'usuario-' || left(u.id::text, 8) || '@sin-correo.local'),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Usuario'
  ),
  'consulta',
  'activo',
  coalesce(u.created_at, now()),
  now()
from auth.users u
on conflict (id) do update
set email = excluded.email,
    nombre = coalesce(public.perfiles_usuario.nombre, excluded.nombre),
    updated_at = now();

-- Si todavía no existe Administrador activo, el usuario más antiguo queda
-- como Administrador inicial. Luego puede administrar los demás perfiles.
do $$
declare
  v_admin_id uuid;
begin
  if not exists (
    select 1 from public.perfiles_usuario
    where rol = 'administrador' and estado = 'activo'
  ) then
    select p.id into v_admin_id
    from public.perfiles_usuario p
    join auth.users u on u.id = p.id
    order by u.created_at nulls last, p.created_at, p.id
    limit 1;

    if v_admin_id is not null then
      update public.perfiles_usuario
      set rol = 'administrador', updated_at = now()
      where id = v_admin_id;
    end if;
  end if;
end $$;

create or replace function public.app_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.perfiles_usuario (
    id, email, nombre, rol, estado, created_at, updated_at
  ) values (
    new.id,
    coalesce(new.email, 'usuario-' || left(new.id::text, 8) || '@sin-correo.local'),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    ),
    'consulta',
    'activo',
    now(),
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_new_auth_user on auth.users;
create trigger trg_app_new_auth_user
after insert or update of email on auth.users
for each row execute function public.app_handle_new_user();

create or replace function public.app_touch_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_app_touch_profile on public.perfiles_usuario;
create trigger trg_app_touch_profile
before update on public.perfiles_usuario
for each row execute function public.app_touch_profile();

-- Evita dejar el Sistema sin un Administrador activo.
create or replace function public.app_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_admins integer;
begin
  if tg_op = 'UPDATE'
     and old.rol = 'administrador'
     and old.estado = 'activo'
     and (new.rol <> 'administrador' or new.estado <> 'activo') then
    select count(*) into v_active_admins
    from public.perfiles_usuario
    where rol = 'administrador' and estado = 'activo';

    if v_active_admins <= 1 then
      raise exception 'Debe existir al menos un Administrador activo.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_protect_last_admin on public.perfiles_usuario;
create trigger trg_app_protect_last_admin
before update on public.perfiles_usuario
for each row execute function public.app_protect_last_admin();

-- ----------------------------------------------------------
-- 2. FUNCIONES DE AUTORIZACIÓN
-- ----------------------------------------------------------
create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.rol
  from public.perfiles_usuario p
  where p.id = auth.uid()
    and p.estado = 'activo'
  limit 1;
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() = 'administrador', false);
$$;

create or replace function public.app_is_global_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('administrador','coordinador','consulta'), false);
$$;

create or replace function public.app_is_global_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('administrador','coordinador'), false);
$$;

create or replace function public.app_can_read_vc(p_vigencia_consejeria_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_vigencia_consejeria_id is null then false
    when public.app_is_global_reader() then true
    when public.app_current_role() = 'consejeria' then exists (
      select 1
      from public.usuario_consejerias uc
      where uc.usuario_id = auth.uid()
        and uc.vigencia_consejeria_id = p_vigencia_consejeria_id
    )
    else false
  end;
$$;

create or replace function public.app_can_write_vc(p_vigencia_consejeria_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_vigencia_consejeria_id is null then false
    when public.app_is_global_writer() then true
    when public.app_current_role() = 'consejeria' then exists (
      select 1
      from public.usuario_consejerias uc
      where uc.usuario_id = auth.uid()
        and uc.vigencia_consejeria_id = p_vigencia_consejeria_id
    )
    else false
  end;
$$;

create or replace function public.app_can_read_vigencia(p_vigencia_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_vigencia_id is null then false
    when public.app_is_global_reader() then true
    when public.app_current_role() = 'consejeria' then exists (
      select 1
      from public.usuario_consejerias uc
      join public.vigencia_consejerias vc
        on vc.id = uc.vigencia_consejeria_id
      where uc.usuario_id = auth.uid()
        and vc.vigencia_id = p_vigencia_id
    )
    else false
  end;
$$;

create or replace function public.app_vc_for_linea(p_linea_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.vigencia_consejeria_id
  from public.lineas_accion l
  where l.id = p_linea_id;
$$;

create or replace function public.app_vc_for_programa(p_programa_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.vigencia_consejeria_id
  from public.programas p
  join public.lineas_accion l on l.id = p.linea_accion_id
  where p.id = p_programa_id;
$$;

create or replace function public.app_vc_for_proyecto(p_proyecto_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.vigencia_consejeria_id
  from public.proyectos pr
  join public.programas p on p.id = pr.programa_id
  join public.lineas_accion l on l.id = p.linea_accion_id
  where pr.id = p_proyecto_id;
$$;

create or replace function public.app_vc_for_actividad(p_actividad_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.app_vc_for_proyecto(a.proyecto_id)
  from public.actividades a
  where a.id = p_actividad_id;
$$;

create or replace function public.app_vc_for_indicador(p_indicador_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.app_vc_for_actividad(i.actividad_id)
  from public.indicadores_actividad i
  where i.id = p_indicador_id;
$$;

create or replace function public.app_vigencia_for_vc(p_vc_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select vc.vigencia_id
  from public.vigencia_consejerias vc
  where vc.id = p_vc_id;
$$;

-- ----------------------------------------------------------
-- 3. CONTROL DE VERSIÓN Y TRAZABILIDAD DEL ÚLTIMO CAMBIO
-- ----------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'vigencias','consejerias','vigencia_consejerias','fuentes_mandatos',
    'mandatos','lineas_accion','programas','proyectos','actividades',
    'indicadores_actividad','presupuesto_actividad_rubros',
    'evidencias_actividad','biblioteca_consejeria_documentos','auditoria_notas'
  ]
  loop
    execute format('alter table public.%I add column if not exists row_version bigint not null default 1', t);
    execute format('alter table public.%I add column if not exists created_by_id uuid', t);
    execute format('alter table public.%I add column if not exists created_by_email text', t);
    execute format('alter table public.%I add column if not exists updated_by_id uuid', t);
    execute format('alter table public.%I add column if not exists updated_by_email text', t);
  end loop;
end $$;

create or replace function public.app_stamp_editable_row()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.row_version := coalesce(new.row_version, 1);
    new.created_by_id := coalesce(new.created_by_id, auth.uid());
    new.created_by_email := coalesce(
      new.created_by_email,
      nullif(auth.jwt() ->> 'email', ''),
      'Usuario'
    );
  elsif tg_op = 'UPDATE' then
    new.row_version := coalesce(old.row_version, 1) + 1;
    new.updated_by_id := auth.uid();
    new.updated_by_email := coalesce(nullif(auth.jwt() ->> 'email', ''), 'Usuario');
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'vigencias','consejerias','vigencia_consejerias','fuentes_mandatos',
    'mandatos','lineas_accion','programas','proyectos','actividades',
    'indicadores_actividad','presupuesto_actividad_rubros',
    'evidencias_actividad','biblioteca_consejeria_documentos','auditoria_notas'
  ]
  loop
    execute format('drop trigger if exists trg_app_stamp_editable_row on public.%I', t);
    execute format(
      'create trigger trg_app_stamp_editable_row before insert or update on public.%I for each row execute function public.app_stamp_editable_row()',
      t
    );
  end loop;
end $$;

-- Los porcentajes oficiales no pueden ser alterados directamente por un
-- usuario de Consejería. Se aprueban desde el flujo de Ponderaciones.
create or replace function public.app_guard_project_weight()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.app_current_role() = 'consejeria'
     and (
       new.ponderacion is distinct from old.ponderacion
       or new.metodo_ponderacion is distinct from old.metodo_ponderacion
     ) then
    raise exception 'La ponderación oficial solo puede ser aprobada por un Coordinador o Administrador.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_guard_project_weight on public.proyectos;
create trigger trg_app_guard_project_weight
before update on public.proyectos
for each row execute function public.app_guard_project_weight();

-- Un usuario de Consejería puede actualizar su perfil operativo, pero no
-- cambiar la Vigencia, la Consejería institucional ni retirarla del Plan.
create or replace function public.app_guard_vc_sensitive_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.app_current_role() = 'consejeria'
     and (
       new.vigencia_id is distinct from old.vigencia_id
       or new.consejeria_id is distinct from old.consejeria_id
       or new.estado is distinct from old.estado
     ) then
    raise exception 'El estado y la vinculación institucional de la Consejería solo pueden ser modificados por un Coordinador o Administrador.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_guard_vc_sensitive_fields on public.vigencia_consejerias;
create trigger trg_app_guard_vc_sensitive_fields
before update on public.vigencia_consejerias
for each row execute function public.app_guard_vc_sensitive_fields();

-- ----------------------------------------------------------
-- 4. HISTORIAL AUTOMÁTICO DE ACTIVIDAD
-- ----------------------------------------------------------
create table if not exists public.historial_actividad (
  id uuid primary key default gen_random_uuid(),
  vigencia_id uuid,
  vigencia_consejeria_id uuid,
  usuario_id uuid,
  usuario_email text not null default 'Sistema',
  accion text not null,
  entidad_tipo text not null,
  entidad_id uuid,
  entidad_nombre text,
  tabla_origen text,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  cambios jsonb,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists idx_historial_actividad_fecha
  on public.historial_actividad(creado_en desc);
create index if not exists idx_historial_actividad_vigencia
  on public.historial_actividad(vigencia_id, creado_en desc);
create index if not exists idx_historial_actividad_vc
  on public.historial_actividad(vigencia_consejeria_id, creado_en desc);
create index if not exists idx_historial_actividad_usuario
  on public.historial_actividad(usuario_id, creado_en desc);
create index if not exists idx_historial_actividad_accion
  on public.historial_actividad(accion, creado_en desc);

create or replace function public.app_strip_log_meta(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(p_row, '{}'::jsonb)
    - 'updated_at'
    - 'row_version'
    - 'created_by_id'
    - 'created_by_email'
    - 'updated_by_id'
    - 'updated_by_email';
$$;

create or replace function public.app_jsonb_changes(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
as $$
  with keys as (
    select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as key
    union
    select jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) as key
  )
  select coalesce(
    jsonb_object_agg(
      key,
      jsonb_build_object(
        'antes', p_old -> key,
        'despues', p_new -> key
      )
    ) filter (where (p_old -> key) is distinct from (p_new -> key)),
    '{}'::jsonb
  )
  from keys;
$$;

create or replace function public.app_history_context(p_table text, p_row jsonb)
returns table(vigencia_id uuid, vigencia_consejeria_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parent uuid;
begin
  vigencia_id := null;
  vigencia_consejeria_id := null;

  if p_table = 'vigencias' then
    vigencia_id := nullif(p_row ->> 'id', '')::uuid;

  elsif p_table = 'vigencia_consejerias' then
    vigencia_consejeria_id := nullif(p_row ->> 'id', '')::uuid;
    vigencia_id := nullif(p_row ->> 'vigencia_id', '')::uuid;

  elsif p_table in ('fuentes_mandatos','mandatos') then
    vigencia_id := nullif(p_row ->> 'vigencia_id', '')::uuid;

  elsif p_table = 'mandato_consejerias' then
    vigencia_consejeria_id := nullif(p_row ->> 'vigencia_consejeria_id', '')::uuid;
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'lineas_accion' then
    vigencia_consejeria_id := nullif(p_row ->> 'vigencia_consejeria_id', '')::uuid;
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'programas' then
    v_parent := nullif(p_row ->> 'linea_accion_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_linea(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'proyectos' then
    v_parent := nullif(p_row ->> 'programa_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_programa(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'proyecto_mandatos' then
    v_parent := nullif(p_row ->> 'proyecto_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_proyecto(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'actividades' then
    v_parent := nullif(p_row ->> 'proyecto_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_proyecto(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'indicadores_actividad' then
    v_parent := nullif(p_row ->> 'actividad_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_actividad(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'seguimientos_indicador' then
    v_parent := nullif(p_row ->> 'indicador_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_indicador(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table in ('presupuesto_actividad_rubros','evidencias_actividad','seguimientos_actividad') then
    v_parent := nullif(p_row ->> 'actividad_id', '')::uuid;
    vigencia_consejeria_id := public.app_vc_for_actividad(v_parent);
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'biblioteca_consejeria_documentos' then
    vigencia_consejeria_id := nullif(p_row ->> 'vigencia_consejeria_id', '')::uuid;
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);

  elsif p_table = 'auditoria_notas' then
    vigencia_id := nullif(p_row ->> 'vigencia_id', '')::uuid;
    if nullif(p_row ->> 'vigencia_consejeria_id', '') is not null then
      vigencia_consejeria_id := (p_row ->> 'vigencia_consejeria_id')::uuid;
    end if;

  elsif p_table = 'ponderacion_consejeria_aprobaciones' then
    vigencia_id := nullif(p_row ->> 'vigencia_id', '')::uuid;
    vigencia_consejeria_id := nullif(p_row ->> 'vigencia_consejeria_id', '')::uuid;

  elsif p_table = 'usuario_consejerias' then
    vigencia_consejeria_id := nullif(p_row ->> 'vigencia_consejeria_id', '')::uuid;
    vigencia_id := public.app_vigencia_for_vc(vigencia_consejeria_id);
  end if;

  return next;
end;
$$;

create or replace function public.app_entity_type_for_table(p_table text)
returns text
language sql
immutable
as $$
  select case p_table
    when 'vigencias' then 'vigencia'
    when 'consejerias' then 'consejeria_catalogo'
    when 'vigencia_consejerias' then 'consejeria'
    when 'fuentes_mandatos' then 'fuente_mandato'
    when 'mandatos' then 'mandato'
    when 'mandato_consejerias' then 'vinculo_mandato_consejeria'
    when 'lineas_accion' then 'linea'
    when 'programas' then 'programa'
    when 'proyectos' then 'proyecto'
    when 'proyecto_mandatos' then 'vinculo_proyecto_mandato'
    when 'actividades' then 'actividad'
    when 'indicadores_actividad' then 'indicador'
    when 'seguimientos_indicador' then 'avance_indicador'
    when 'presupuesto_actividad_rubros' then 'presupuesto'
    when 'evidencias_actividad' then 'evidencia'
    when 'seguimientos_actividad' then 'seguimiento'
    when 'biblioteca_consejeria_documentos' then 'biblioteca'
    when 'auditoria_notas' then 'nota_auditoria'
    when 'ponderacion_consejeria_aprobaciones' then 'ponderacion'
    when 'perfiles_usuario' then 'usuario'
    when 'usuario_consejerias' then 'asignacion_usuario'
    else p_table
  end;
$$;

create or replace function public.app_log_table_change()
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
  v_entity_name text;
  v_entity_id uuid;
  v_vigencia_id uuid;
  v_vc_id uuid;
  v_role text;
begin
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    v_new := public.app_strip_log_meta(v_row);
    v_old := null;
    v_action := case
      when tg_table_name = 'ponderacion_consejeria_aprobaciones' then 'aprobar_ponderacion'
      else 'crear'
    end;
  elsif tg_op = 'UPDATE' then
    v_row := to_jsonb(new);
    v_new := public.app_strip_log_meta(to_jsonb(new));
    v_old := public.app_strip_log_meta(to_jsonb(old));
    v_changes := public.app_jsonb_changes(v_old, v_new);
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    v_action := case
      when tg_table_name = 'auditoria_notas'
           and coalesce(v_old ->> 'estado', '') <> 'resuelta'
           and coalesce(v_new ->> 'estado', '') = 'resuelta' then 'resolver_nota'
      else 'actualizar'
    end;
  else
    v_row := to_jsonb(old);
    v_old := public.app_strip_log_meta(v_row);
    v_new := null;
    v_action := 'eliminar';
  end if;

  if v_changes is null and tg_op = 'UPDATE' then
    v_changes := public.app_jsonb_changes(v_old, v_new);
  end if;

  begin
    v_entity_id := nullif(v_row ->> 'id', '')::uuid;
  exception when others then
    v_entity_id := null;
  end;

  v_entity_name := coalesce(
    nullif(trim(v_row ->> 'nombre'), ''),
    nullif(trim(v_row ->> 'titulo'), ''),
    nullif(trim(v_row ->> 'rubro'), ''),
    nullif(trim(v_row ->> 'entidad_nombre'), ''),
    nullif(trim(v_row ->> 'codigo'), ''),
    nullif(trim(v_row ->> 'email'), ''),
    nullif(trim(v_row ->> 'consejeria_nombre'), ''),
    nullif(left(trim(v_row ->> 'texto'), 120), ''),
    public.app_entity_type_for_table(tg_table_name)
  );

  select c.vigencia_id, c.vigencia_consejeria_id
  into v_vigencia_id, v_vc_id
  from public.app_history_context(tg_table_name, v_row) c;

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
    v_vigencia_id,
    v_vc_id,
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'Sistema'),
    v_action,
    public.app_entity_type_for_table(tg_table_name),
    v_entity_id,
    v_entity_name,
    tg_table_name,
    v_old,
    v_new,
    coalesce(v_changes, '{}'::jsonb),
    jsonb_build_object('operacion', tg_op)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Vincula notas de Auditoría con su Consejería cuando el contexto lo permite.
alter table public.auditoria_notas
  add column if not exists vigencia_consejeria_id uuid;

update public.auditoria_notas n
set vigencia_consejeria_id = case
  when nullif(n.navegacion ->> 'vigencia_consejeria_id', '') is not null
       and (n.navegacion ->> 'vigencia_consejeria_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (n.navegacion ->> 'vigencia_consejeria_id')::uuid
  when n.entidad_tipo = 'consejeria' then n.entidad_id
  when n.entidad_tipo = 'linea' then public.app_vc_for_linea(n.entidad_id)
  when n.entidad_tipo = 'programa' then public.app_vc_for_programa(n.entidad_id)
  when n.entidad_tipo = 'proyecto' then public.app_vc_for_proyecto(n.entidad_id)
  when n.entidad_tipo = 'actividad' then public.app_vc_for_actividad(n.entidad_id)
  when n.entidad_tipo = 'indicador' then public.app_vc_for_indicador(n.entidad_id)
  else null
end
where n.vigencia_consejeria_id is null;

create index if not exists idx_auditoria_notas_vc
  on public.auditoria_notas(vigencia_consejeria_id, creado_en desc);

create or replace function public.app_set_auditoria_vc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vigencia_consejeria_id is null then
    begin
      if nullif(new.navegacion ->> 'vigencia_consejeria_id', '') is not null then
        new.vigencia_consejeria_id := (new.navegacion ->> 'vigencia_consejeria_id')::uuid;
      elsif new.entidad_tipo = 'consejeria' then
        new.vigencia_consejeria_id := new.entidad_id;
      elsif new.entidad_tipo = 'linea' then
        new.vigencia_consejeria_id := public.app_vc_for_linea(new.entidad_id);
      elsif new.entidad_tipo = 'programa' then
        new.vigencia_consejeria_id := public.app_vc_for_programa(new.entidad_id);
      elsif new.entidad_tipo = 'proyecto' then
        new.vigencia_consejeria_id := public.app_vc_for_proyecto(new.entidad_id);
      elsif new.entidad_tipo = 'actividad' then
        new.vigencia_consejeria_id := public.app_vc_for_actividad(new.entidad_id);
      elsif new.entidad_tipo = 'indicador' then
        new.vigencia_consejeria_id := public.app_vc_for_indicador(new.entidad_id);
      end if;
    exception when others then
      new.vigencia_consejeria_id := null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_set_auditoria_vc on public.auditoria_notas;
create trigger trg_app_set_auditoria_vc
before insert or update on public.auditoria_notas
for each row execute function public.app_set_auditoria_vc();

-- Triggers del historial. Se instalan después de la sincronización inicial.
do $$
declare
  t text;
begin
  foreach t in array array[
    'vigencias','consejerias','vigencia_consejerias','fuentes_mandatos','mandatos',
    'mandato_consejerias','lineas_accion','programas','proyectos','proyecto_mandatos',
    'actividades','indicadores_actividad','seguimientos_indicador',
    'presupuesto_actividad_rubros','evidencias_actividad','seguimientos_actividad',
    'biblioteca_consejeria_documentos','auditoria_notas',
    'ponderacion_consejeria_aprobaciones','perfiles_usuario','usuario_consejerias'
  ]
  loop
    execute format('drop trigger if exists trg_app_history on public.%I', t);
    execute format(
      'create trigger trg_app_history after insert or update or delete on public.%I for each row execute function public.app_log_table_change()',
      t
    );
  end loop;
end $$;

create or replace function public.registrar_evento_sesion(p_evento text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión activa.';
  end if;

  if p_evento not in ('iniciar_sesion','cerrar_sesion') then
    raise exception 'El tipo de evento no es válido.';
  end if;

  insert into public.historial_actividad (
    usuario_id, usuario_email, accion, entidad_tipo, entidad_nombre, detalle
  ) values (
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'Usuario'),
    p_evento,
    'sesion',
    'Sesión de usuario',
    '{}'::jsonb
  );
end;
$$;

create or replace function public.registrar_evento_manual(
  p_accion text,
  p_entidad_tipo text default 'sistema',
  p_entidad_id uuid default null,
  p_entidad_nombre text default null,
  p_vigencia_id uuid default null,
  p_vigencia_consejeria_id uuid default null,
  p_detalle jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión activa.';
  end if;

  if p_accion not in (
    'conflicto_edicion','generar_respaldo','importar_vigencia',
    'restaurar_vigencia','exportar_historial','generar_documento'
  ) then
    raise exception 'El tipo de evento no es válido.';
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
    detalle
  ) values (
    p_vigencia_id,
    p_vigencia_consejeria_id,
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'Usuario'),
    p_accion,
    coalesce(nullif(trim(p_entidad_tipo), ''), 'sistema'),
    p_entidad_id,
    p_entidad_nombre,
    coalesce(p_detalle, '{}'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------
-- 5. RLS DE PRODUCCIÓN
-- ----------------------------------------------------------
alter table public.perfiles_usuario enable row level security;
alter table public.usuario_consejerias enable row level security;
alter table public.historial_actividad enable row level security;

-- Elimina la política amplia utilizada durante desarrollo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'vigencias','consejerias','vigencia_consejerias','fuentes_mandatos','mandatos',
    'mandato_consejerias','lineas_accion','programas','proyectos','proyecto_mandatos',
    'actividades','indicadores_actividad','seguimientos_indicador',
    'presupuesto_actividad_rubros','evidencias_actividad','seguimientos_actividad',
    'biblioteca_consejeria_documentos','auditoria_notas',
    'ponderacion_consejeria_aprobaciones'
  ]
  loop
    execute format('drop policy if exists "authenticated_full_access" on public.%I', t);
  end loop;
end $$;

-- Perfiles y asignaciones.
drop policy if exists app_profiles_select on public.perfiles_usuario;
create policy app_profiles_select on public.perfiles_usuario
for select to authenticated
using (id = auth.uid() or public.app_is_admin());

drop policy if exists app_profiles_update on public.perfiles_usuario;
create policy app_profiles_update on public.perfiles_usuario
for update to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

drop policy if exists app_user_vc_select on public.usuario_consejerias;
create policy app_user_vc_select on public.usuario_consejerias
for select to authenticated
using (usuario_id = auth.uid() or public.app_is_admin());

drop policy if exists app_user_vc_insert on public.usuario_consejerias;
create policy app_user_vc_insert on public.usuario_consejerias
for insert to authenticated
with check (public.app_is_admin());

drop policy if exists app_user_vc_delete on public.usuario_consejerias;
create policy app_user_vc_delete on public.usuario_consejerias
for delete to authenticated
using (public.app_is_admin());

-- Vigencias.
drop policy if exists app_vigencias_select on public.vigencias;
create policy app_vigencias_select on public.vigencias
for select to authenticated
using (public.app_can_read_vigencia(id));

drop policy if exists app_vigencias_insert on public.vigencias;
create policy app_vigencias_insert on public.vigencias
for insert to authenticated
with check (public.app_is_global_writer());

drop policy if exists app_vigencias_update on public.vigencias;
create policy app_vigencias_update on public.vigencias
for update to authenticated
using (public.app_is_global_writer())
with check (public.app_is_global_writer());

drop policy if exists app_vigencias_delete on public.vigencias;
create policy app_vigencias_delete on public.vigencias
for delete to authenticated
using (public.app_is_admin());

-- Catálogo de Consejerías: lectura institucional para todo usuario activo.
drop policy if exists app_consejerias_select on public.consejerias;
create policy app_consejerias_select on public.consejerias
for select to authenticated
using (public.app_current_role() is not null);

drop policy if exists app_consejerias_insert on public.consejerias;
create policy app_consejerias_insert on public.consejerias
for insert to authenticated
with check (public.app_is_global_writer());

drop policy if exists app_consejerias_update on public.consejerias;
create policy app_consejerias_update on public.consejerias
for update to authenticated
using (public.app_is_global_writer())
with check (public.app_is_global_writer());

drop policy if exists app_consejerias_delete on public.consejerias;
create policy app_consejerias_delete on public.consejerias
for delete to authenticated
using (public.app_is_admin());

-- Consejería dentro de una Vigencia.
drop policy if exists app_vc_select on public.vigencia_consejerias;
create policy app_vc_select on public.vigencia_consejerias
for select to authenticated
using (public.app_can_read_vc(id));

drop policy if exists app_vc_insert on public.vigencia_consejerias;
create policy app_vc_insert on public.vigencia_consejerias
for insert to authenticated
with check (public.app_is_global_writer());

drop policy if exists app_vc_update on public.vigencia_consejerias;
create policy app_vc_update on public.vigencia_consejerias
for update to authenticated
using (public.app_can_write_vc(id))
with check (public.app_can_write_vc(id));

drop policy if exists app_vc_delete on public.vigencia_consejerias;
create policy app_vc_delete on public.vigencia_consejerias
for delete to authenticated
using (public.app_is_global_writer());

-- Fuentes y Mandatos: usuarios de Consejería consultan su Vigencia; la
-- formulación de Mandatos queda en Administrador/Coordinador.
drop policy if exists app_fuentes_select on public.fuentes_mandatos;
create policy app_fuentes_select on public.fuentes_mandatos
for select to authenticated using (public.app_can_read_vigencia(vigencia_id));
drop policy if exists app_fuentes_insert on public.fuentes_mandatos;
create policy app_fuentes_insert on public.fuentes_mandatos
for insert to authenticated with check (public.app_is_global_writer());
drop policy if exists app_fuentes_update on public.fuentes_mandatos;
create policy app_fuentes_update on public.fuentes_mandatos
for update to authenticated using (public.app_is_global_writer()) with check (public.app_is_global_writer());
drop policy if exists app_fuentes_delete on public.fuentes_mandatos;
create policy app_fuentes_delete on public.fuentes_mandatos
for delete to authenticated using (public.app_is_global_writer());

drop policy if exists app_mandatos_select on public.mandatos;
create policy app_mandatos_select on public.mandatos
for select to authenticated using (public.app_can_read_vigencia(vigencia_id));
drop policy if exists app_mandatos_insert on public.mandatos;
create policy app_mandatos_insert on public.mandatos
for insert to authenticated with check (public.app_is_global_writer());
drop policy if exists app_mandatos_update on public.mandatos;
create policy app_mandatos_update on public.mandatos
for update to authenticated using (public.app_is_global_writer()) with check (public.app_is_global_writer());
drop policy if exists app_mandatos_delete on public.mandatos;
create policy app_mandatos_delete on public.mandatos
for delete to authenticated using (public.app_is_global_writer());

drop policy if exists app_mandato_vc_select on public.mandato_consejerias;
create policy app_mandato_vc_select on public.mandato_consejerias
for select to authenticated using (public.app_can_read_vc(vigencia_consejeria_id));
drop policy if exists app_mandato_vc_insert on public.mandato_consejerias;
create policy app_mandato_vc_insert on public.mandato_consejerias
for insert to authenticated with check (public.app_is_global_writer());
drop policy if exists app_mandato_vc_delete on public.mandato_consejerias;
create policy app_mandato_vc_delete on public.mandato_consejerias
for delete to authenticated using (public.app_is_global_writer());

-- Líneas de Acción.
drop policy if exists app_lineas_select on public.lineas_accion;
create policy app_lineas_select on public.lineas_accion
for select to authenticated using (public.app_can_read_vc(vigencia_consejeria_id));
drop policy if exists app_lineas_insert on public.lineas_accion;
create policy app_lineas_insert on public.lineas_accion
for insert to authenticated with check (public.app_can_write_vc(vigencia_consejeria_id));
drop policy if exists app_lineas_update on public.lineas_accion;
create policy app_lineas_update on public.lineas_accion
for update to authenticated using (public.app_can_write_vc(vigencia_consejeria_id)) with check (public.app_can_write_vc(vigencia_consejeria_id));
drop policy if exists app_lineas_delete on public.lineas_accion;
create policy app_lineas_delete on public.lineas_accion
for delete to authenticated using (public.app_can_write_vc(vigencia_consejeria_id));

-- Programas.
drop policy if exists app_programas_select on public.programas;
create policy app_programas_select on public.programas
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_linea(linea_accion_id)));
drop policy if exists app_programas_insert on public.programas;
create policy app_programas_insert on public.programas
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_linea(linea_accion_id)));
drop policy if exists app_programas_update on public.programas;
create policy app_programas_update on public.programas
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_linea(linea_accion_id))) with check (public.app_can_write_vc(public.app_vc_for_linea(linea_accion_id)));
drop policy if exists app_programas_delete on public.programas;
create policy app_programas_delete on public.programas
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_linea(linea_accion_id)));

-- Proyectos.
drop policy if exists app_proyectos_select on public.proyectos;
create policy app_proyectos_select on public.proyectos
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_programa(programa_id)));
drop policy if exists app_proyectos_insert on public.proyectos;
create policy app_proyectos_insert on public.proyectos
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_programa(programa_id)));
drop policy if exists app_proyectos_update on public.proyectos;
create policy app_proyectos_update on public.proyectos
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_programa(programa_id))) with check (public.app_can_write_vc(public.app_vc_for_programa(programa_id)));
drop policy if exists app_proyectos_delete on public.proyectos;
create policy app_proyectos_delete on public.proyectos
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_programa(programa_id)));

-- Proyecto ↔ Mandato.
drop policy if exists app_pm_select on public.proyecto_mandatos;
create policy app_pm_select on public.proyecto_mandatos
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_proyecto(proyecto_id)));
drop policy if exists app_pm_insert on public.proyecto_mandatos;
create policy app_pm_insert on public.proyecto_mandatos
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_proyecto(proyecto_id)));
drop policy if exists app_pm_delete on public.proyecto_mandatos;
create policy app_pm_delete on public.proyecto_mandatos
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_proyecto(proyecto_id)));

-- Actividades.
drop policy if exists app_actividades_select on public.actividades;
create policy app_actividades_select on public.actividades
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_proyecto(proyecto_id)));
drop policy if exists app_actividades_insert on public.actividades;
create policy app_actividades_insert on public.actividades
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_proyecto(proyecto_id)));
drop policy if exists app_actividades_update on public.actividades;
create policy app_actividades_update on public.actividades
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_proyecto(proyecto_id))) with check (public.app_can_write_vc(public.app_vc_for_proyecto(proyecto_id)));
drop policy if exists app_actividades_delete on public.actividades;
create policy app_actividades_delete on public.actividades
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_proyecto(proyecto_id)));

-- Indicadores.
drop policy if exists app_indicadores_select on public.indicadores_actividad;
create policy app_indicadores_select on public.indicadores_actividad
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_indicadores_insert on public.indicadores_actividad;
create policy app_indicadores_insert on public.indicadores_actividad
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_indicadores_update on public.indicadores_actividad;
create policy app_indicadores_update on public.indicadores_actividad
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id))) with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_indicadores_delete on public.indicadores_actividad;
create policy app_indicadores_delete on public.indicadores_actividad
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));

-- Avances de indicador.
drop policy if exists app_si_select on public.seguimientos_indicador;
create policy app_si_select on public.seguimientos_indicador
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_indicador(indicador_id)));
drop policy if exists app_si_insert on public.seguimientos_indicador;
create policy app_si_insert on public.seguimientos_indicador
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_indicador(indicador_id)));
drop policy if exists app_si_update on public.seguimientos_indicador;
create policy app_si_update on public.seguimientos_indicador
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_indicador(indicador_id))) with check (public.app_can_write_vc(public.app_vc_for_indicador(indicador_id)));
drop policy if exists app_si_delete on public.seguimientos_indicador;
create policy app_si_delete on public.seguimientos_indicador
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_indicador(indicador_id)));

-- Presupuesto.
drop policy if exists app_budget_select on public.presupuesto_actividad_rubros;
create policy app_budget_select on public.presupuesto_actividad_rubros
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_budget_insert on public.presupuesto_actividad_rubros;
create policy app_budget_insert on public.presupuesto_actividad_rubros
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_budget_update on public.presupuesto_actividad_rubros;
create policy app_budget_update on public.presupuesto_actividad_rubros
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id))) with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_budget_delete on public.presupuesto_actividad_rubros;
create policy app_budget_delete on public.presupuesto_actividad_rubros
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));

-- Evidencias.
drop policy if exists app_evidencias_select on public.evidencias_actividad;
create policy app_evidencias_select on public.evidencias_actividad
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_evidencias_insert on public.evidencias_actividad;
create policy app_evidencias_insert on public.evidencias_actividad
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_evidencias_update on public.evidencias_actividad;
create policy app_evidencias_update on public.evidencias_actividad
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id))) with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_evidencias_delete on public.evidencias_actividad;
create policy app_evidencias_delete on public.evidencias_actividad
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));

-- Seguimientos narrativos.
drop policy if exists app_sa_select on public.seguimientos_actividad;
create policy app_sa_select on public.seguimientos_actividad
for select to authenticated using (public.app_can_read_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_sa_insert on public.seguimientos_actividad;
create policy app_sa_insert on public.seguimientos_actividad
for insert to authenticated with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_sa_update on public.seguimientos_actividad;
create policy app_sa_update on public.seguimientos_actividad
for update to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id))) with check (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));
drop policy if exists app_sa_delete on public.seguimientos_actividad;
create policy app_sa_delete on public.seguimientos_actividad
for delete to authenticated using (public.app_can_write_vc(public.app_vc_for_actividad(actividad_id)));

-- Biblioteca.
drop policy if exists app_biblioteca_select on public.biblioteca_consejeria_documentos;
create policy app_biblioteca_select on public.biblioteca_consejeria_documentos
for select to authenticated using (public.app_can_read_vc(vigencia_consejeria_id));
drop policy if exists app_biblioteca_insert on public.biblioteca_consejeria_documentos;
create policy app_biblioteca_insert on public.biblioteca_consejeria_documentos
for insert to authenticated with check (public.app_can_write_vc(vigencia_consejeria_id));
drop policy if exists app_biblioteca_update on public.biblioteca_consejeria_documentos;
create policy app_biblioteca_update on public.biblioteca_consejeria_documentos
for update to authenticated using (public.app_can_write_vc(vigencia_consejeria_id)) with check (public.app_can_write_vc(vigencia_consejeria_id));
drop policy if exists app_biblioteca_delete on public.biblioteca_consejeria_documentos;
create policy app_biblioteca_delete on public.biblioteca_consejeria_documentos
for delete to authenticated using (public.app_can_write_vc(vigencia_consejeria_id));

-- Auditoría y notas.
drop policy if exists app_auditoria_select on public.auditoria_notas;
create policy app_auditoria_select on public.auditoria_notas
for select to authenticated
using (
  case
    when vigencia_consejeria_id is not null then public.app_can_read_vc(vigencia_consejeria_id)
    else public.app_can_read_vigencia(vigencia_id)
  end
);
drop policy if exists app_auditoria_insert on public.auditoria_notas;
create policy app_auditoria_insert on public.auditoria_notas
for insert to authenticated
with check (
  case
    when vigencia_consejeria_id is not null then public.app_can_write_vc(vigencia_consejeria_id)
    when public.app_is_global_writer() then true
    else public.app_current_role() = 'consejeria' and public.app_can_read_vigencia(vigencia_id)
  end
);
drop policy if exists app_auditoria_update on public.auditoria_notas;
create policy app_auditoria_update on public.auditoria_notas
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

-- Aprobaciones de ponderación: consulta según alcance; escritura solo global.
drop policy if exists app_ponderacion_select on public.ponderacion_consejeria_aprobaciones;
create policy app_ponderacion_select on public.ponderacion_consejeria_aprobaciones
for select to authenticated using (public.app_can_read_vc(vigencia_consejeria_id));
drop policy if exists app_ponderacion_insert on public.ponderacion_consejeria_aprobaciones;
create policy app_ponderacion_insert on public.ponderacion_consejeria_aprobaciones
for insert to authenticated with check (public.app_is_global_writer());
drop policy if exists app_ponderacion_update on public.ponderacion_consejeria_aprobaciones;
create policy app_ponderacion_update on public.ponderacion_consejeria_aprobaciones
for update to authenticated using (public.app_is_global_writer()) with check (public.app_is_global_writer());
drop policy if exists app_ponderacion_delete on public.ponderacion_consejeria_aprobaciones;
create policy app_ponderacion_delete on public.ponderacion_consejeria_aprobaciones
for delete to authenticated using (public.app_is_global_writer());

-- Historial: Administrador y Coordinador tienen consulta transversal.
-- Usuario de Consejería puede consultar únicamente eventos de sus asignaciones.
drop policy if exists app_history_select on public.historial_actividad;
create policy app_history_select on public.historial_actividad
for select to authenticated
using (
  public.app_current_role() in ('administrador','coordinador')
  or (
    public.app_current_role() = 'consejeria'
    and vigencia_consejeria_id is not null
    and public.app_can_read_vc(vigencia_consejeria_id)
  )
);

-- ----------------------------------------------------------
-- 6. PONDERACIÓN CON PROTECCIÓN DE CONCURRENCIA
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
  v_base_version bigint;
  v_current_version bigint;
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
  if public.app_current_role() not in ('administrador','coordinador') then
    raise exception 'Solo un Coordinador o Administrador puede aprobar ponderaciones.';
  end if;

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
  into v_vigencia_id, v_consejeria_nombre, v_estado
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

  for v_item in select value from jsonb_array_elements(p_ponderaciones)
  loop
    begin
      v_project_id := (v_item ->> 'proyecto_id')::uuid;
      v_weight := (v_item ->> 'ponderacion')::numeric;
      v_base_version := (v_item ->> 'version_base')::bigint;
    exception when others then
      raise exception 'La propuesta contiene un identificador, porcentaje o versión inválida.';
    end;

    v_method := coalesce(nullif(trim(v_item ->> 'metodo_ponderacion'), ''), 'manual');

    if v_weight < 0 or v_weight > 100 then
      raise exception 'Cada ponderación debe estar entre 0 y 100.';
    end if;

    if v_method not in ('manual','sugerida') then
      raise exception 'El método de ponderación no es válido.';
    end if;

    select pr.row_version into v_current_version
    from public.proyectos pr
    join public.programas pg on pg.id = pr.programa_id
    join public.lineas_accion l on l.id = pg.linea_accion_id
    where pr.id = v_project_id
      and l.vigencia_consejeria_id = p_vigencia_consejeria_id
      and l.estado = 'activa'
      and pg.estado = 'activo';

    if not found then
      raise exception 'La propuesta contiene un Proyecto que no pertenece a un Programa activo de la Consejería.';
    end if;

    if v_current_version <> v_base_version then
      raise exception 'La ponderación no pudo aprobarse porque otro usuario modificó uno de los Proyectos. Recarga la Consejería y revisa la propuesta antes de aprobar.';
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

    if v_actual = 0 then continue; end if;

    select count(*), coalesce(sum((j.value ->> 'ponderacion')::numeric), 0)
    into v_received, v_sum
    from jsonb_array_elements(p_ponderaciones) j
    join public.proyectos pr on pr.id = (j.value ->> 'proyecto_id')::uuid
    where pr.programa_id = v_program.id;

    if v_received <> v_actual then
      raise exception 'El Programa "%" no contiene una propuesta para todos sus Proyectos.', v_program.nombre;
    end if;

    if abs(v_sum - 100) > 0.005 then
      raise exception 'El Programa "%" suma % y debe sumar exactamente 100,00 %%.', v_program.nombre, round(v_sum, 2);
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_ponderaciones)
  loop
    v_project_id := (v_item ->> 'proyecto_id')::uuid;
    v_weight := round((v_item ->> 'ponderacion')::numeric, 2);
    v_method := coalesce(nullif(trim(v_item ->> 'metodo_ponderacion'), ''), 'manual');
    v_base_version := (v_item ->> 'version_base')::bigint;

    update public.proyectos
    set ponderacion = v_weight,
        metodo_ponderacion = v_method
    where id = v_project_id
      and row_version = v_base_version;

    if not found then
      raise exception 'La ponderación cambió durante la aprobación. Recarga la información e inténtalo nuevamente.';
    end if;

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
          'metodo_ponderacion', pr.metodo_ponderacion,
          'row_version', pr.row_version
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
  ) returning id into v_approval_id;

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
-- 7. PERMISOS DE FUNCIONES Y TABLAS NUEVAS
-- ----------------------------------------------------------
grant select on public.perfiles_usuario to authenticated;
grant update on public.perfiles_usuario to authenticated;
grant select, insert, delete on public.usuario_consejerias to authenticated;
grant select on public.historial_actividad to authenticated;


create or replace function public.guardar_perfil_usuario(
  p_usuario_id uuid,
  p_nombre text,
  p_rol text,
  p_estado text,
  p_vigencia_consejeria_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.app_is_admin() then
    raise exception 'Solo un Administrador puede modificar usuarios y permisos.';
  end if;

  if p_rol not in ('administrador','coordinador','consejeria','consulta') then
    raise exception 'El rol seleccionado no es válido.';
  end if;

  if p_estado not in ('activo','inactivo') then
    raise exception 'El estado seleccionado no es válido.';
  end if;

  update public.perfiles_usuario
  set nombre = nullif(trim(p_nombre), ''),
      rol = p_rol,
      estado = p_estado
  where id = p_usuario_id;

  if not found then
    raise exception 'El usuario seleccionado no existe.';
  end if;

  delete from public.usuario_consejerias
  where usuario_id = p_usuario_id;

  if p_rol = 'consejeria' and coalesce(array_length(p_vigencia_consejeria_ids, 1), 0) > 0 then
    insert into public.usuario_consejerias (usuario_id, vigencia_consejeria_id)
    select p_usuario_id, x.vc_id
    from unnest(p_vigencia_consejeria_ids) as x(vc_id)
    where exists (
      select 1 from public.vigencia_consejerias vc where vc.id = x.vc_id
    )
    on conflict (usuario_id, vigencia_consejeria_id) do nothing;

    get diagnostics v_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'usuario_id', p_usuario_id,
    'rol', p_rol,
    'estado', p_estado,
    'consejerias_asignadas', v_count
  );
end;
$$;

revoke all on function public.registrar_evento_sesion(text) from public;
revoke all on function public.registrar_evento_manual(text,text,uuid,text,uuid,uuid,jsonb) from public;
revoke all on function public.guardar_perfil_usuario(uuid,text,text,text,uuid[]) from public;
revoke all on function public.aprobar_ponderacion_consejeria(uuid,text,jsonb) from public;

grant execute on function public.registrar_evento_sesion(text) to authenticated;
grant execute on function public.registrar_evento_manual(text,text,uuid,text,uuid,uuid,jsonb) to authenticated;
grant execute on function public.guardar_perfil_usuario(uuid,text,text,text,uuid[]) to authenticated;
grant execute on function public.aprobar_ponderacion_consejeria(uuid,text,jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
