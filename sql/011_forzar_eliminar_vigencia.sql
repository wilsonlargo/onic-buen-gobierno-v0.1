-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 011 · Eliminación forzada de Vigencia
-- v0.7.5
-- ==========================================================
--
-- Esta migración NO modifica las FK RESTRICT existentes.
-- La eliminación normal continúa protegida.
--
-- Se crean dos RPC:
--
--   resumen_eliminacion_vigencia(uuid)
--   forzar_eliminar_vigencia(uuid, text, text)
--
-- La segunda elimina explícitamente toda la estructura
-- perteneciente a la Vigencia, de abajo hacia arriba.
--
-- El catálogo public.consejerias NO se elimina porque es un
-- catálogo institucional estable y puede ser compartido por
-- varias Vigencias.
-- ==========================================================

-- ----------------------------------------------------------
-- RESUMEN PREVIO
-- ----------------------------------------------------------
create or replace function public.resumen_eliminacion_vigencia(
  p_vigencia_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nombre text;

  v_consejerias integer := 0;
  v_consejerias_catalogo integer := 0;
  v_consejerias_compartidas integer := 0;

  v_documentos integer := 0;
  v_fuentes integer := 0;
  v_mandatos integer := 0;
  v_mandato_consejerias integer := 0;
  v_lineas integer := 0;
  v_programas integer := 0;
  v_proyectos integer := 0;
  v_proyecto_mandatos integer := 0;
  v_actividades integer := 0;
  v_indicadores integer := 0;
  v_seguimientos_indicador integer := 0;
  v_presupuesto integer := 0;
  v_evidencias integer := 0;
  v_seguimientos_actividad integer := 0;
begin
  select nombre
    into v_nombre
  from public.vigencias
  where id = p_vigencia_id;

  if v_nombre is null then
    raise exception
      'La Vigencia no existe o ya fue eliminada.';
  end if;

  select count(*)
    into v_consejerias
  from public.vigencia_consejerias vc
  where vc.vigencia_id = p_vigencia_id;

  select count(distinct vc.consejeria_id)
    into v_consejerias_catalogo
  from public.vigencia_consejerias vc
  where vc.vigencia_id = p_vigencia_id;

  select count(distinct vc.consejeria_id)
    into v_consejerias_compartidas
  from public.vigencia_consejerias vc
  where vc.vigencia_id = p_vigencia_id
    and exists (
      select 1
      from public.vigencia_consejerias otras
      where otras.consejeria_id = vc.consejeria_id
        and otras.vigencia_id <> p_vigencia_id
    );

  select count(*)
    into v_documentos
  from public.biblioteca_consejeria_documentos b
  where b.vigencia_consejeria_id in (
    select vc.id
    from public.vigencia_consejerias vc
    where vc.vigencia_id = p_vigencia_id
  );

  select count(*)
    into v_fuentes
  from public.fuentes_mandatos f
  where f.vigencia_id = p_vigencia_id;

  select count(*)
    into v_mandatos
  from public.mandatos m
  where m.vigencia_id = p_vigencia_id;

  select count(*)
    into v_mandato_consejerias
  from public.mandato_consejerias mc
  where mc.mandato_id in (
    select m.id
    from public.mandatos m
    where m.vigencia_id = p_vigencia_id
  )
  or mc.vigencia_consejeria_id in (
    select vc.id
    from public.vigencia_consejerias vc
    where vc.vigencia_id = p_vigencia_id
  );

  select count(*)
    into v_lineas
  from public.lineas_accion l
  where l.vigencia_consejeria_id in (
    select vc.id
    from public.vigencia_consejerias vc
    where vc.vigencia_id = p_vigencia_id
  );

  select count(*)
    into v_programas
  from public.programas p
  where p.linea_accion_id in (
    select l.id
    from public.lineas_accion l
    where l.vigencia_consejeria_id in (
      select vc.id
      from public.vigencia_consejerias vc
      where vc.vigencia_id = p_vigencia_id
    )
  );

  select count(*)
    into v_proyectos
  from public.proyectos p
  where p.programa_id in (
    select pr.id
    from public.programas pr
    where pr.linea_accion_id in (
      select l.id
      from public.lineas_accion l
      where l.vigencia_consejeria_id in (
        select vc.id
        from public.vigencia_consejerias vc
        where vc.vigencia_id = p_vigencia_id
      )
    )
  );

  select count(*)
    into v_proyecto_mandatos
  from public.proyecto_mandatos pm
  where pm.proyecto_id in (
    select p.id
    from public.proyectos p
    where p.programa_id in (
      select pr.id
      from public.programas pr
      where pr.linea_accion_id in (
        select l.id
        from public.lineas_accion l
        where l.vigencia_consejeria_id in (
          select vc.id
          from public.vigencia_consejerias vc
          where vc.vigencia_id = p_vigencia_id
        )
      )
    )
  )
  or pm.mandato_id in (
    select m.id
    from public.mandatos m
    where m.vigencia_id = p_vigencia_id
  );

  select count(*)
    into v_actividades
  from public.actividades a
  where a.proyecto_id in (
    select p.id
    from public.proyectos p
    where p.programa_id in (
      select pr.id
      from public.programas pr
      where pr.linea_accion_id in (
        select l.id
        from public.lineas_accion l
        where l.vigencia_consejeria_id in (
          select vc.id
          from public.vigencia_consejerias vc
          where vc.vigencia_id = p_vigencia_id
        )
      )
    )
  );

  select count(*)
    into v_indicadores
  from public.indicadores_actividad i
  where i.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  );

  select count(*)
    into v_seguimientos_indicador
  from public.seguimientos_indicador si
  where si.indicador_id in (
    select i.id
    from public.indicadores_actividad i
    where i.actividad_id in (
      select a.id
      from public.actividades a
      where a.proyecto_id in (
        select p.id
        from public.proyectos p
        where p.programa_id in (
          select pr.id
          from public.programas pr
          where pr.linea_accion_id in (
            select l.id
            from public.lineas_accion l
            where l.vigencia_consejeria_id in (
              select vc.id
              from public.vigencia_consejerias vc
              where vc.vigencia_id = p_vigencia_id
            )
          )
        )
      )
    )
  );

  select count(*)
    into v_presupuesto
  from public.presupuesto_actividad_rubros pa
  where pa.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  );

  select count(*)
    into v_evidencias
  from public.evidencias_actividad e
  where e.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  )
  or e.indicador_id in (
    select i.id
    from public.indicadores_actividad i
    where i.actividad_id in (
      select a.id
      from public.actividades a
      where a.proyecto_id in (
        select p.id
        from public.proyectos p
        where p.programa_id in (
          select pr.id
          from public.programas pr
          where pr.linea_accion_id in (
            select l.id
            from public.lineas_accion l
            where l.vigencia_consejeria_id in (
              select vc.id
              from public.vigencia_consejerias vc
              where vc.vigencia_id = p_vigencia_id
            )
          )
        )
      )
    )
  );

  select count(*)
    into v_seguimientos_actividad
  from public.seguimientos_actividad sa
  where sa.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  );

  return jsonb_build_object(
    'vigencia_id', p_vigencia_id,
    'vigencia_nombre', v_nombre,
    'consejerias_vigencia', v_consejerias,
    'consejerias_catalogo_preservadas', v_consejerias_catalogo,
    'consejerias_compartidas_otras_vigencias', v_consejerias_compartidas,
    'documentos_biblioteca', v_documentos,
    'fuentes_mandatos', v_fuentes,
    'mandatos', v_mandatos,
    'mandato_consejerias', v_mandato_consejerias,
    'lineas', v_lineas,
    'programas', v_programas,
    'proyectos', v_proyectos,
    'proyecto_mandatos', v_proyecto_mandatos,
    'actividades', v_actividades,
    'indicadores', v_indicadores,
    'seguimientos_indicador', v_seguimientos_indicador,
    'rubros_presupuesto', v_presupuesto,
    'evidencias', v_evidencias,
    'seguimientos_actividad', v_seguimientos_actividad
  );
end;
$$;

-- ----------------------------------------------------------
-- ELIMINACIÓN FORZADA
-- ----------------------------------------------------------
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
  v_vigencia_nombre text;
  v_resumen jsonb;
  v_deleted integer := 0;
  v_total_deleted integer := 0;
begin
  select nombre
    into v_vigencia_nombre
  from public.vigencias
  where id = p_vigencia_id
  for update;

  if v_vigencia_nombre is null then
    raise exception
      'La Vigencia no existe o ya fue eliminada.';
  end if;

  if upper(trim(coalesce(p_confirmacion, '')))
     <> 'ELIMINAR VIGENCIA' then
    raise exception
      'Confirmación inválida. Debes escribir ELIMINAR VIGENCIA.';
  end if;

  if trim(coalesce(p_nombre_confirmacion, ''))
     <> v_vigencia_nombre then
    raise exception
      'El nombre de confirmación no coincide exactamente con la Vigencia.';
  end if;

  -- Guardamos el resumen ANTES de borrar.
  v_resumen :=
    public.resumen_eliminacion_vigencia(
      p_vigencia_id
    );

  -- ========================================================
  -- 1. Evidencias
  -- ========================================================
  delete from public.evidencias_actividad e
  where e.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  )
  or e.indicador_id in (
    select i.id
    from public.indicadores_actividad i
    where i.actividad_id in (
      select a.id
      from public.actividades a
      where a.proyecto_id in (
        select p.id
        from public.proyectos p
        where p.programa_id in (
          select pr.id
          from public.programas pr
          where pr.linea_accion_id in (
            select l.id
            from public.lineas_accion l
            where l.vigencia_consejeria_id in (
              select vc.id
              from public.vigencia_consejerias vc
              where vc.vigencia_id = p_vigencia_id
            )
          )
        )
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 2. Seguimientos de indicadores
  -- ========================================================
  delete from public.seguimientos_indicador si
  where si.indicador_id in (
    select i.id
    from public.indicadores_actividad i
    where i.actividad_id in (
      select a.id
      from public.actividades a
      where a.proyecto_id in (
        select p.id
        from public.proyectos p
        where p.programa_id in (
          select pr.id
          from public.programas pr
          where pr.linea_accion_id in (
            select l.id
            from public.lineas_accion l
            where l.vigencia_consejeria_id in (
              select vc.id
              from public.vigencia_consejerias vc
              where vc.vigencia_id = p_vigencia_id
            )
          )
        )
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 3. Seguimientos narrativos de Actividad
  -- ========================================================
  delete from public.seguimientos_actividad sa
  where sa.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 4. Presupuesto de Actividades
  -- ========================================================
  delete from public.presupuesto_actividad_rubros pa
  where pa.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 5. Indicadores
  -- ========================================================
  delete from public.indicadores_actividad i
  where i.actividad_id in (
    select a.id
    from public.actividades a
    where a.proyecto_id in (
      select p.id
      from public.proyectos p
      where p.programa_id in (
        select pr.id
        from public.programas pr
        where pr.linea_accion_id in (
          select l.id
          from public.lineas_accion l
          where l.vigencia_consejeria_id in (
            select vc.id
            from public.vigencia_consejerias vc
            where vc.vigencia_id = p_vigencia_id
          )
        )
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 6. Actividades
  -- ========================================================
  delete from public.actividades a
  where a.proyecto_id in (
    select p.id
    from public.proyectos p
    where p.programa_id in (
      select pr.id
      from public.programas pr
      where pr.linea_accion_id in (
        select l.id
        from public.lineas_accion l
        where l.vigencia_consejeria_id in (
          select vc.id
          from public.vigencia_consejerias vc
          where vc.vigencia_id = p_vigencia_id
        )
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 7. Vínculos Proyecto ↔ Mandato
  -- Borra tanto por Proyectos de la Vigencia como por Mandatos
  -- de la Vigencia para limpiar cualquier vínculo cruzado.
  -- ========================================================
  delete from public.proyecto_mandatos pm
  where pm.proyecto_id in (
    select p.id
    from public.proyectos p
    where p.programa_id in (
      select pr.id
      from public.programas pr
      where pr.linea_accion_id in (
        select l.id
        from public.lineas_accion l
        where l.vigencia_consejeria_id in (
          select vc.id
          from public.vigencia_consejerias vc
          where vc.vigencia_id = p_vigencia_id
        )
      )
    )
  )
  or pm.mandato_id in (
    select m.id
    from public.mandatos m
    where m.vigencia_id = p_vigencia_id
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 8. Proyectos
  -- ========================================================
  delete from public.proyectos p
  where p.programa_id in (
    select pr.id
    from public.programas pr
    where pr.linea_accion_id in (
      select l.id
      from public.lineas_accion l
      where l.vigencia_consejeria_id in (
        select vc.id
        from public.vigencia_consejerias vc
        where vc.vigencia_id = p_vigencia_id
      )
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 9. Programas
  -- ========================================================
  delete from public.programas pr
  where pr.linea_accion_id in (
    select l.id
    from public.lineas_accion l
    where l.vigencia_consejeria_id in (
      select vc.id
      from public.vigencia_consejerias vc
      where vc.vigencia_id = p_vigencia_id
    )
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 10. Líneas
  -- ========================================================
  delete from public.lineas_accion l
  where l.vigencia_consejeria_id in (
    select vc.id
    from public.vigencia_consejerias vc
    where vc.vigencia_id = p_vigencia_id
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 11. Biblioteca documental de Consejerías
  -- ========================================================
  delete from public.biblioteca_consejeria_documentos b
  where b.vigencia_consejeria_id in (
    select vc.id
    from public.vigencia_consejerias vc
    where vc.vigencia_id = p_vigencia_id
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 12. Asignaciones Mandato ↔ Consejería
  -- ========================================================
  delete from public.mandato_consejerias mc
  where mc.mandato_id in (
    select m.id
    from public.mandatos m
    where m.vigencia_id = p_vigencia_id
  )
  or mc.vigencia_consejeria_id in (
    select vc.id
    from public.vigencia_consejerias vc
    where vc.vigencia_id = p_vigencia_id
  );

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 13. Mandatos
  -- ========================================================
  delete from public.mandatos m
  where m.vigencia_id = p_vigencia_id;

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 14. Fuentes de Mandatos
  -- ========================================================
  delete from public.fuentes_mandatos f
  where f.vigencia_id = p_vigencia_id;

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 15. Participación de Consejerías en la Vigencia
  -- El catálogo public.consejerias SE CONSERVA.
  -- ========================================================
  delete from public.vigencia_consejerias vc
  where vc.vigencia_id = p_vigencia_id;

  get diagnostics v_deleted = row_count;
  v_total_deleted := v_total_deleted + v_deleted;

  -- ========================================================
  -- 16. Vigencia
  -- ========================================================
  delete from public.vigencias v
  where v.id = p_vigencia_id;

  get diagnostics v_deleted = row_count;

  if v_deleted <> 1 then
    raise exception
      'No fue posible eliminar el registro principal de la Vigencia.';
  end if;

  v_total_deleted := v_total_deleted + v_deleted;

  return jsonb_build_object(
    'ok', true,
    'vigencia_id', p_vigencia_id,
    'vigencia_nombre', v_vigencia_nombre,
    'registros_eliminados', v_total_deleted,
    'consejerias_catalogo_preservadas',
      coalesce(
        (v_resumen ->> 'consejerias_catalogo_preservadas')::integer,
        0
      ),
    'resumen_previo', v_resumen
  );

exception
  when foreign_key_violation then
    raise exception
      'La eliminación fue cancelada porque existe una relación protegida no contemplada por esta versión del sistema. No se eliminó parcialmente la Vigencia. Detalle: %',
      sqlerrm;
end;
$$;

revoke all
on function public.resumen_eliminacion_vigencia(uuid)
from public;

revoke all
on function public.forzar_eliminar_vigencia(uuid, text, text)
from public;

grant execute
on function public.resumen_eliminacion_vigencia(uuid)
to authenticated;

grant execute
on function public.forzar_eliminar_vigencia(uuid, text, text)
to authenticated;

notify pgrst, 'reload schema';
