-- V5.4.17 · Reubicación administrativa de Proyectos / Actividades generales
-- Script idempotente de referencia para entornos que no tengan la función desplegada.

create or replace function public.app_reubicar_unidades(
  p_unidad_ids uuid[],
  p_programa_destino_id uuid
)
returns table (
  id uuid,
  nombre text,
  tipo_unidad text,
  programa_origen_id uuid,
  programa_destino_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_dest_vc uuid;
  v_found integer;
  v_invalid integer;
  v_to_move integer;
  v_max_order integer;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesión activa.';
  end if;

  if not public.app_is_admin() then
    raise exception 'Solo un Administrador puede reubicar Proyectos o Actividades generales.';
  end if;

  if p_programa_destino_id is null then
    raise exception 'Debes seleccionar un Programa de destino.';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
  into v_ids
  from unnest(coalesce(p_unidad_ids, '{}'::uuid[])) as x
  where x is not null;

  if cardinality(v_ids) = 0 then
    raise exception 'Selecciona al menos una unidad para mover.';
  end if;

  select l.vigencia_consejeria_id
  into v_dest_vc
  from public.programas p
  join public.lineas_accion l on l.id = p.linea_accion_id
  where p.id = p_programa_destino_id;

  if v_dest_vc is null then
    raise exception 'El Programa de destino no existe.';
  end if;

  select count(*)
  into v_found
  from public.proyectos pr
  where pr.id = any(v_ids);

  if v_found <> cardinality(v_ids) then
    raise exception 'Una o más unidades seleccionadas ya no existen o no son accesibles.';
  end if;

  select count(*)
  into v_invalid
  from public.proyectos pr
  join public.programas p on p.id = pr.programa_id
  join public.lineas_accion l on l.id = p.linea_accion_id
  where pr.id = any(v_ids)
    and l.vigencia_consejeria_id is distinct from v_dest_vc;

  if v_invalid > 0 then
    raise exception 'Solo puedes mover unidades dentro de la misma Vigencia y Consejería.';
  end if;

  select count(*)
  into v_to_move
  from public.proyectos pr
  where pr.id = any(v_ids)
    and pr.programa_id is distinct from p_programa_destino_id;

  if v_to_move = 0 then
    raise exception 'Las unidades seleccionadas ya pertenecen al Programa de destino.';
  end if;

  select coalesce(max(pr.orden), -1)
  into v_max_order
  from public.proyectos pr
  where pr.programa_id = p_programa_destino_id
    and not (pr.id = any(v_ids));

  return query
  with selected as (
    select
      pr.id,
      pr.nombre,
      pr.tipo_unidad,
      pr.programa_id as programa_origen_id,
      row_number() over (order by pr.orden asc, pr.nombre asc, pr.id asc) as rn
    from public.proyectos pr
    where pr.id = any(v_ids)
      and pr.programa_id is distinct from p_programa_destino_id
  ),
  moved as (
    update public.proyectos pr
    set
      programa_id = p_programa_destino_id,
      orden = v_max_order + selected.rn::integer
    from selected
    where pr.id = selected.id
    returning pr.id, pr.nombre, pr.tipo_unidad, selected.programa_origen_id
  )
  select moved.id, moved.nombre, moved.tipo_unidad, moved.programa_origen_id, p_programa_destino_id
  from moved
  order by moved.nombre;
end;
$$;

revoke execute on function public.app_reubicar_unidades(uuid[], uuid) from public;
revoke execute on function public.app_reubicar_unidades(uuid[], uuid) from anon;
grant execute on function public.app_reubicar_unidades(uuid[], uuid) to authenticated;
