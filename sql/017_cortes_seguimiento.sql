-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 017 · Cortes de seguimiento e histórico de avance
-- v0.13.0
-- ==========================================================
-- Crea fotografías periódicas del avance de una Vigencia.
-- Los cortes aprobados/cerrados alimentan el histórico gráfico.
-- La fotografía conserva avance/cobertura general y por Consejería.
-- ==========================================================

begin;

create table if not exists public.cortes_seguimiento (
  id uuid primary key default gen_random_uuid(),
  vigencia_id uuid not null references public.vigencias(id) on delete cascade,
  nombre text not null,
  fecha_corte date not null,
  estado text not null default 'abierto'
    check (estado in ('abierto','revision','aprobado','cerrado')),
  observaciones text,
  avance_vigencia numeric(7,2),
  cobertura_vigencia numeric(7,2) not null default 0,
  creado_por_id uuid,
  creado_por_email text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  aprobado_por_id uuid,
  aprobado_por_email text,
  aprobado_en timestamptz,
  cerrado_por_id uuid,
  cerrado_por_email text,
  cerrado_en timestamptz,
  row_version bigint not null default 1,
  constraint cortes_avance_rango check (
    avance_vigencia is null or (avance_vigencia >= 0 and avance_vigencia <= 100)
  ),
  constraint cortes_cobertura_rango check (
    cobertura_vigencia >= 0 and cobertura_vigencia <= 100
  )
);

create table if not exists public.cortes_seguimiento_consejerias (
  id uuid primary key default gen_random_uuid(),
  corte_id uuid not null references public.cortes_seguimiento(id) on delete cascade,
  vigencia_consejeria_id uuid not null references public.vigencia_consejerias(id) on delete cascade,
  consejeria_nombre text not null,
  estado_consejeria text,
  avance numeric(7,2),
  cobertura numeric(7,2),
  created_at timestamptz not null default now(),
  unique (corte_id, vigencia_consejeria_id),
  constraint cortes_vc_avance_rango check (
    avance is null or (avance >= 0 and avance <= 100)
  ),
  constraint cortes_vc_cobertura_rango check (
    cobertura is null or (cobertura >= 0 and cobertura <= 100)
  )
);

create index if not exists idx_cortes_vigencia_fecha
  on public.cortes_seguimiento(vigencia_id, fecha_corte, creado_en);

create index if not exists idx_cortes_estado
  on public.cortes_seguimiento(vigencia_id, estado, fecha_corte);

create index if not exists idx_cortes_vc_corte
  on public.cortes_seguimiento_consejerias(corte_id);

create index if not exists idx_cortes_vc_scope
  on public.cortes_seguimiento_consejerias(vigencia_consejeria_id, corte_id);

alter table public.cortes_seguimiento enable row level security;
alter table public.cortes_seguimiento_consejerias enable row level security;

-- Lectura según alcance del usuario. La administración de cortes queda
-- reservada a Administrador y Coordinador.
drop policy if exists app_cortes_select on public.cortes_seguimiento;
create policy app_cortes_select on public.cortes_seguimiento
for select to authenticated
using (public.app_can_read_vigencia(vigencia_id));

drop policy if exists app_cortes_insert on public.cortes_seguimiento;
create policy app_cortes_insert on public.cortes_seguimiento
for insert to authenticated
with check (public.app_is_global_writer());

drop policy if exists app_cortes_update on public.cortes_seguimiento;
create policy app_cortes_update on public.cortes_seguimiento
for update to authenticated
using (public.app_is_global_writer())
with check (public.app_is_global_writer());

drop policy if exists app_cortes_delete on public.cortes_seguimiento;
create policy app_cortes_delete on public.cortes_seguimiento
for delete to authenticated
using (public.app_is_admin());

drop policy if exists app_cortes_vc_select on public.cortes_seguimiento_consejerias;
create policy app_cortes_vc_select on public.cortes_seguimiento_consejerias
for select to authenticated
using (public.app_can_read_vc(vigencia_consejeria_id));

drop policy if exists app_cortes_vc_insert on public.cortes_seguimiento_consejerias;
create policy app_cortes_vc_insert on public.cortes_seguimiento_consejerias
for insert to authenticated
with check (public.app_is_global_writer());

drop policy if exists app_cortes_vc_update on public.cortes_seguimiento_consejerias;
create policy app_cortes_vc_update on public.cortes_seguimiento_consejerias
for update to authenticated
using (public.app_is_global_writer())
with check (public.app_is_global_writer());

drop policy if exists app_cortes_vc_delete on public.cortes_seguimiento_consejerias;
create policy app_cortes_vc_delete on public.cortes_seguimiento_consejerias
for delete to authenticated
using (public.app_is_global_writer());

-- ----------------------------------------------------------
-- Protección de estados, congelación del corte y versión.
-- ----------------------------------------------------------
create or replace function public.app_guard_corte_seguimiento()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_email text;
begin
  if not public.app_is_global_writer() then
    raise exception 'Solo un Administrador o Coordinador puede administrar cortes de seguimiento.';
  end if;

  v_email := coalesce(nullif(auth.jwt() ->> 'email', ''), 'Usuario');

  if tg_op = 'INSERT' then
    new.nombre := nullif(trim(new.nombre), '');
    if new.nombre is null then
      raise exception 'El corte debe tener un nombre.';
    end if;
    if new.fecha_corte is null then
      raise exception 'El corte debe tener una fecha.';
    end if;
    new.row_version := coalesce(new.row_version, 1);
    new.creado_por_id := coalesce(new.creado_por_id, auth.uid());
    new.creado_por_email := coalesce(nullif(new.creado_por_email, ''), v_email);
    new.creado_en := coalesce(new.creado_en, now());
    new.actualizado_en := coalesce(new.actualizado_en, now());
    return new;
  end if;

  -- Un corte cerrado es inmutable.
  if old.estado = 'cerrado' then
    raise exception 'El corte está cerrado y no puede modificarse.';
  end if;

  -- Después de aprobar, únicamente se permite el paso a Cerrado.
  if old.estado = 'aprobado' then
    if new.estado <> 'cerrado' then
      raise exception 'Un corte aprobado solo puede pasar a Cerrado.';
    end if;

    if new.nombre is distinct from old.nombre
       or new.fecha_corte is distinct from old.fecha_corte
       or new.observaciones is distinct from old.observaciones
       or new.avance_vigencia is distinct from old.avance_vigencia
       or new.cobertura_vigencia is distinct from old.cobertura_vigencia then
      raise exception 'La fotografía de un corte aprobado no puede modificarse.';
    end if;
  end if;

  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'abierto' and new.estado = 'revision')
      or (old.estado = 'revision' and new.estado = 'aprobado')
      or (old.estado = 'aprobado' and new.estado = 'cerrado')
    ) then
      raise exception 'La transición de estado del corte no es válida.';
    end if;

    if new.estado = 'aprobado' then
      new.aprobado_por_id := auth.uid();
      new.aprobado_por_email := v_email;
      new.aprobado_en := now();
    elsif new.estado = 'cerrado' then
      new.cerrado_por_id := auth.uid();
      new.cerrado_por_email := v_email;
      new.cerrado_en := now();
    end if;
  end if;

  new.row_version := coalesce(old.row_version, 1) + 1;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_app_guard_corte_seguimiento on public.cortes_seguimiento;
create trigger trg_app_guard_corte_seguimiento
before insert or update on public.cortes_seguimiento
for each row execute function public.app_guard_corte_seguimiento();

-- ----------------------------------------------------------
-- Historial automático del corte (sin registrar cada fila de
-- la fotografía por Consejería para evitar ruido excesivo).
-- ----------------------------------------------------------
create or replace function public.app_log_corte_seguimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text;
  v_row jsonb;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    v_old := null;
    v_new := public.app_strip_log_meta(v_row);
    v_changes := '{}'::jsonb;
    v_action := 'crear_corte';
  elsif tg_op = 'UPDATE' then
    v_row := to_jsonb(new);
    v_old := public.app_strip_log_meta(to_jsonb(old));
    v_new := public.app_strip_log_meta(to_jsonb(new));
    v_changes := public.app_jsonb_changes(v_old, v_new);
    v_action := case
      when old.estado <> new.estado and new.estado = 'revision' then 'corte_revision'
      when old.estado <> new.estado and new.estado = 'aprobado' then 'aprobar_corte'
      when old.estado <> new.estado and new.estado = 'cerrado' then 'cerrar_corte'
      else 'actualizar_corte'
    end;
  else
    v_row := to_jsonb(old);
    v_old := public.app_strip_log_meta(v_row);
    v_new := null;
    v_changes := '{}'::jsonb;
    v_action := 'eliminar_corte';
  end if;

  insert into public.historial_actividad (
    vigencia_id,
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
    auth.uid(),
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'Sistema'),
    v_action,
    'corte_seguimiento',
    nullif(v_row ->> 'id', '')::uuid,
    coalesce(nullif(v_row ->> 'nombre', ''), 'Corte de seguimiento'),
    'cortes_seguimiento',
    v_old,
    v_new,
    coalesce(v_changes, '{}'::jsonb),
    jsonb_build_object('operacion', tg_op)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_app_history_corte on public.cortes_seguimiento;
create trigger trg_app_history_corte
after insert or update or delete on public.cortes_seguimiento
for each row execute function public.app_log_corte_seguimiento();

-- ----------------------------------------------------------
-- RPC: creación atómica del corte y su fotografía.
-- ----------------------------------------------------------
create or replace function public.crear_corte_seguimiento(
  p_vigencia_id uuid,
  p_nombre text,
  p_fecha_corte date,
  p_observaciones text,
  p_avance_vigencia numeric,
  p_cobertura_vigencia numeric,
  p_consejerias jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte_id uuid;
  v_item jsonb;
  v_vc_id uuid;
begin
  if auth.uid() is null or not public.app_is_global_writer() then
    raise exception 'Solo un Administrador o Coordinador puede crear cortes de seguimiento.';
  end if;

  if not exists (select 1 from public.vigencias v where v.id = p_vigencia_id) then
    raise exception 'La Vigencia seleccionada no existe.';
  end if;

  insert into public.cortes_seguimiento (
    vigencia_id,
    nombre,
    fecha_corte,
    observaciones,
    avance_vigencia,
    cobertura_vigencia
  ) values (
    p_vigencia_id,
    nullif(trim(p_nombre), ''),
    p_fecha_corte,
    nullif(trim(coalesce(p_observaciones, '')), ''),
    case when p_avance_vigencia is null then null else greatest(0, least(100, p_avance_vigencia)) end,
    greatest(0, least(100, coalesce(p_cobertura_vigencia, 0)))
  ) returning id into v_corte_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_consejerias, '[]'::jsonb))
  loop
    v_vc_id := nullif(v_item ->> 'vigencia_consejeria_id', '')::uuid;

    if v_vc_id is null or not exists (
      select 1
      from public.vigencia_consejerias vc
      where vc.id = v_vc_id
        and vc.vigencia_id = p_vigencia_id
    ) then
      raise exception 'La fotografía contiene una Consejería que no pertenece a la Vigencia.';
    end if;

    insert into public.cortes_seguimiento_consejerias (
      corte_id,
      vigencia_consejeria_id,
      consejeria_nombre,
      estado_consejeria,
      avance,
      cobertura
    ) values (
      v_corte_id,
      v_vc_id,
      coalesce(nullif(trim(v_item ->> 'consejeria_nombre'), ''), 'Consejería'),
      nullif(v_item ->> 'estado_consejeria', ''),
      case when (v_item ->> 'avance') is null then null else greatest(0, least(100, (v_item ->> 'avance')::numeric)) end,
      case when (v_item ->> 'cobertura') is null then null else greatest(0, least(100, (v_item ->> 'cobertura')::numeric)) end
    );
  end loop;

  return v_corte_id;
end;
$$;

-- ----------------------------------------------------------
-- RPC: actualizar fotografía mientras está Abierto/Revisión.
-- Incluye control de versión para evitar sobrescritura simultánea.
-- ----------------------------------------------------------
create or replace function public.actualizar_fotografia_corte(
  p_corte_id uuid,
  p_version_esperada bigint,
  p_avance_vigencia numeric,
  p_cobertura_vigencia numeric,
  p_consejerias jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte public.cortes_seguimiento%rowtype;
  v_item jsonb;
  v_vc_id uuid;
begin
  if auth.uid() is null or not public.app_is_global_writer() then
    raise exception 'Solo un Administrador o Coordinador puede actualizar cortes de seguimiento.';
  end if;

  select * into v_corte
  from public.cortes_seguimiento
  where id = p_corte_id
  for update;

  if not found then
    raise exception 'El corte no existe.';
  end if;

  if v_corte.row_version <> p_version_esperada then
    raise exception 'Este corte fue modificado por otro usuario. Recarga la información antes de continuar.';
  end if;

  if v_corte.estado not in ('abierto','revision') then
    raise exception 'La fotografía solo puede actualizarse mientras el corte esté Abierto o En revisión.';
  end if;

  update public.cortes_seguimiento
  set avance_vigencia = case when p_avance_vigencia is null then null else greatest(0, least(100, p_avance_vigencia)) end,
      cobertura_vigencia = greatest(0, least(100, coalesce(p_cobertura_vigencia, 0)))
  where id = p_corte_id;

  delete from public.cortes_seguimiento_consejerias
  where corte_id = p_corte_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_consejerias, '[]'::jsonb))
  loop
    v_vc_id := nullif(v_item ->> 'vigencia_consejeria_id', '')::uuid;

    if v_vc_id is null or not exists (
      select 1
      from public.vigencia_consejerias vc
      where vc.id = v_vc_id
        and vc.vigencia_id = v_corte.vigencia_id
    ) then
      raise exception 'La fotografía contiene una Consejería que no pertenece a la Vigencia.';
    end if;

    insert into public.cortes_seguimiento_consejerias (
      corte_id,
      vigencia_consejeria_id,
      consejeria_nombre,
      estado_consejeria,
      avance,
      cobertura
    ) values (
      p_corte_id,
      v_vc_id,
      coalesce(nullif(trim(v_item ->> 'consejeria_nombre'), ''), 'Consejería'),
      nullif(v_item ->> 'estado_consejeria', ''),
      case when (v_item ->> 'avance') is null then null else greatest(0, least(100, (v_item ->> 'avance')::numeric)) end,
      case when (v_item ->> 'cobertura') is null then null else greatest(0, least(100, (v_item ->> 'cobertura')::numeric)) end
    );
  end loop;

  select * into v_corte from public.cortes_seguimiento where id = p_corte_id;
  return jsonb_build_object(
    'ok', true,
    'corte_id', v_corte.id,
    'row_version', v_corte.row_version,
    'avance_vigencia', v_corte.avance_vigencia,
    'cobertura_vigencia', v_corte.cobertura_vigencia
  );
end;
$$;

-- ----------------------------------------------------------
-- RPC: transición controlada de estado.
-- Abierto -> Revisión -> Aprobado -> Cerrado.
-- ----------------------------------------------------------
create or replace function public.cambiar_estado_corte_seguimiento(
  p_corte_id uuid,
  p_version_esperada bigint,
  p_nuevo_estado text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte public.cortes_seguimiento%rowtype;
begin
  if auth.uid() is null or not public.app_is_global_writer() then
    raise exception 'Solo un Administrador o Coordinador puede cambiar el estado de un corte.';
  end if;

  update public.cortes_seguimiento
  set estado = p_nuevo_estado
  where id = p_corte_id
    and row_version = p_version_esperada
  returning * into v_corte;

  if not found then
    if exists (select 1 from public.cortes_seguimiento where id = p_corte_id) then
      raise exception 'Este corte fue modificado por otro usuario. Recarga la información antes de continuar.';
    end if;
    raise exception 'El corte no existe.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'corte_id', v_corte.id,
    'estado', v_corte.estado,
    'row_version', v_corte.row_version
  );
end;
$$;

commit;

-- ==========================================================
-- COPIA DE SEGURIDAD / RESTAURACIÓN / ELIMINACIÓN DE VIGENCIA
-- ==========================================================
-- Se envuelven las funciones actuales para conservar todo lo ya
-- implementado en versiones anteriores y añadir los Cortes.

do $$
begin
  if to_regprocedure('public.exportar_vigencia_json_core_v0121(uuid)') is null
     and to_regprocedure('public.exportar_vigencia_json(uuid)') is not null then
    execute 'alter function public.exportar_vigencia_json(uuid) rename to exportar_vigencia_json_core_v0121';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.importar_vigencia_json_core_v0121(jsonb)') is null
     and to_regprocedure('public.importar_vigencia_json(jsonb)') is not null then
    execute 'alter function public.importar_vigencia_json(jsonb) rename to importar_vigencia_json_core_v0121';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.resumen_eliminacion_vigencia_core_v0121(uuid)') is null
     and to_regprocedure('public.resumen_eliminacion_vigencia(uuid)') is not null then
    execute 'alter function public.resumen_eliminacion_vigencia(uuid) rename to resumen_eliminacion_vigencia_core_v0121';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.forzar_eliminar_vigencia_core_v0121(uuid,text,text)') is null
     and to_regprocedure('public.forzar_eliminar_vigencia(uuid,text,text)') is not null then
    execute 'alter function public.forzar_eliminar_vigencia(uuid,text,text) rename to forzar_eliminar_vigencia_core_v0121';
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
  v_cortes jsonb;
begin
  v_base := public.exportar_vigencia_json_core_v0121(p_vigencia_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nombre', c.nombre,
        'fecha_corte', c.fecha_corte,
        'estado', c.estado,
        'observaciones', c.observaciones,
        'avance_vigencia', c.avance_vigencia,
        'cobertura_vigencia', c.cobertura_vigencia,
        'creado_por_email', c.creado_por_email,
        'creado_en', c.creado_en,
        'aprobado_por_email', c.aprobado_por_email,
        'aprobado_en', c.aprobado_en,
        'cerrado_por_email', c.cerrado_por_email,
        'cerrado_en', c.cerrado_en,
        'consejerias', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'consejeria_nombre', cc.consejeria_nombre,
              'estado_consejeria', cc.estado_consejeria,
              'avance', cc.avance,
              'cobertura', cc.cobertura
            ) order by cc.consejeria_nombre, cc.id
          )
          from public.cortes_seguimiento_consejerias cc
          where cc.corte_id = c.id
        ), '[]'::jsonb)
      ) order by c.fecha_corte, c.creado_en, c.id
    ),
    '[]'::jsonb
  ) into v_cortes
  from public.cortes_seguimiento c
  where c.vigencia_id = p_vigencia_id;

  return v_base || jsonb_build_object('cortes_seguimiento', v_cortes);
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
  v_cut jsonb;
  v_child jsonb;
  v_cut_id uuid;
  v_vc_id uuid;
  v_count_cortes integer := 0;
  v_count_cortes_vc integer := 0;
begin
  v_result := public.importar_vigencia_json_core_v0121(p_payload);
  v_vigencia_id := (v_result ->> 'vigencia_id')::uuid;

  for v_cut in
    select value from jsonb_array_elements(coalesce(p_payload -> 'cortes_seguimiento', '[]'::jsonb))
  loop
    insert into public.cortes_seguimiento (
      vigencia_id,
      nombre,
      fecha_corte,
      estado,
      observaciones,
      avance_vigencia,
      cobertura_vigencia,
      creado_por_id,
      creado_por_email,
      creado_en,
      aprobado_por_id,
      aprobado_por_email,
      aprobado_en,
      cerrado_por_id,
      cerrado_por_email,
      cerrado_en
    ) values (
      v_vigencia_id,
      coalesce(nullif(trim(v_cut ->> 'nombre'), ''), 'Corte restaurado'),
      coalesce(nullif(v_cut ->> 'fecha_corte', '')::date, current_date),
      case when v_cut ->> 'estado' in ('abierto','revision','aprobado','cerrado') then v_cut ->> 'estado' else 'abierto' end,
      nullif(v_cut ->> 'observaciones', ''),
      nullif(v_cut ->> 'avance_vigencia', '')::numeric,
      coalesce(nullif(v_cut ->> 'cobertura_vigencia', '')::numeric, 0),
      null,
      coalesce(nullif(v_cut ->> 'creado_por_email', ''), 'Usuario histórico'),
      coalesce(nullif(v_cut ->> 'creado_en', '')::timestamptz, now()),
      null,
      nullif(v_cut ->> 'aprobado_por_email', ''),
      nullif(v_cut ->> 'aprobado_en', '')::timestamptz,
      null,
      nullif(v_cut ->> 'cerrado_por_email', ''),
      nullif(v_cut ->> 'cerrado_en', '')::timestamptz
    ) returning id into v_cut_id;

    v_count_cortes := v_count_cortes + 1;

    for v_child in
      select value from jsonb_array_elements(coalesce(v_cut -> 'consejerias', '[]'::jsonb))
    loop
      v_vc_id := null;

      select vc.id into v_vc_id
      from public.vigencia_consejerias vc
      join public.consejerias co on co.id = vc.consejeria_id
      where vc.vigencia_id = v_vigencia_id
        and (
          lower(trim(co.nombre_corto)) = lower(trim(v_child ->> 'consejeria_nombre'))
          or lower(trim(co.nombre_largo)) = lower(trim(v_child ->> 'consejeria_nombre'))
        )
      order by vc.id
      limit 1;

      if v_vc_id is not null then
        insert into public.cortes_seguimiento_consejerias (
          corte_id,
          vigencia_consejeria_id,
          consejeria_nombre,
          estado_consejeria,
          avance,
          cobertura
        ) values (
          v_cut_id,
          v_vc_id,
          coalesce(nullif(trim(v_child ->> 'consejeria_nombre'), ''), 'Consejería'),
          nullif(v_child ->> 'estado_consejeria', ''),
          nullif(v_child ->> 'avance', '')::numeric,
          nullif(v_child ->> 'cobertura', '')::numeric
        );
        v_count_cortes_vc := v_count_cortes_vc + 1;
      end if;
    end loop;
  end loop;

  return v_result || jsonb_build_object(
    'cortes_seguimiento_restaurados', v_count_cortes,
    'cortes_consejerias_restaurados', v_count_cortes_vc
  );
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
  v_cortes integer;
  v_cortes_vc integer;
begin
  v_base := public.resumen_eliminacion_vigencia_core_v0121(p_vigencia_id);

  select count(*) into v_cortes
  from public.cortes_seguimiento
  where vigencia_id = p_vigencia_id;

  select count(*) into v_cortes_vc
  from public.cortes_seguimiento_consejerias cc
  join public.cortes_seguimiento c on c.id = cc.corte_id
  where c.vigencia_id = p_vigencia_id;

  return v_base || jsonb_build_object(
    'cortes_seguimiento', v_cortes,
    'cortes_consejerias', v_cortes_vc
  );
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
  v_cortes integer;
  v_cortes_vc integer;
  v_result jsonb;
  v_total integer;
begin
  select count(*) into v_cortes
  from public.cortes_seguimiento
  where vigencia_id = p_vigencia_id;

  select count(*) into v_cortes_vc
  from public.cortes_seguimiento_consejerias cc
  join public.cortes_seguimiento c on c.id = cc.corte_id
  where c.vigencia_id = p_vigencia_id;

  v_result := public.forzar_eliminar_vigencia_core_v0121(
    p_vigencia_id,
    p_confirmacion,
    p_nombre_confirmacion
  );

  v_total := coalesce((v_result ->> 'registros_eliminados')::integer, 0)
    + v_cortes + v_cortes_vc;

  return v_result || jsonb_build_object(
    'cortes_seguimiento_eliminados', v_cortes,
    'cortes_consejerias_eliminados', v_cortes_vc,
    'registros_eliminados', v_total
  );
end;
$$;

-- Permisos explícitos.
grant select, insert, update, delete on public.cortes_seguimiento to authenticated;
grant select, insert, update, delete on public.cortes_seguimiento_consejerias to authenticated;

revoke all on function public.crear_corte_seguimiento(uuid,text,date,text,numeric,numeric,jsonb) from public;
revoke all on function public.actualizar_fotografia_corte(uuid,bigint,numeric,numeric,jsonb) from public;
revoke all on function public.cambiar_estado_corte_seguimiento(uuid,bigint,text) from public;
revoke all on function public.exportar_vigencia_json(uuid) from public;
revoke all on function public.importar_vigencia_json(jsonb) from public;
revoke all on function public.resumen_eliminacion_vigencia(uuid) from public;
revoke all on function public.forzar_eliminar_vigencia(uuid,text,text) from public;

grant execute on function public.crear_corte_seguimiento(uuid,text,date,text,numeric,numeric,jsonb) to authenticated;
grant execute on function public.actualizar_fotografia_corte(uuid,bigint,numeric,numeric,jsonb) to authenticated;
grant execute on function public.cambiar_estado_corte_seguimiento(uuid,bigint,text) to authenticated;
grant execute on function public.exportar_vigencia_json(uuid) to authenticated;
grant execute on function public.importar_vigencia_json(jsonb) to authenticated;
grant execute on function public.resumen_eliminacion_vigencia(uuid) to authenticated;
grant execute on function public.forzar_eliminar_vigencia(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
