-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 016 · Planeador del Proyecto
-- v0.12.0
-- ==========================================================
-- Agrega el color visual de cada Actividad para el Planeador.
-- Las fechas, responsable, estado, indicadores, presupuesto,
-- evidencias y seguimiento siguen perteneciendo a las tablas
-- existentes. No se agrega un nuevo nivel a la estructura.
-- También conserva el color del Planeador en copias de seguridad
-- y restauraciones, manteniendo los wrappers de Auditoría y
-- Ponderaciones instalados en migraciones posteriores.
-- ==========================================================

begin;

alter table public.actividades
  add column if not exists planeador_color text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'actividades_planeador_color_valido'
      and conrelid = 'public.actividades'::regclass
  ) then
    alter table public.actividades
      add constraint actividades_planeador_color_valido
      check (
        planeador_color is null
        or planeador_color in (
          'verde','azul','turquesa','amarillo',
          'naranja','rojo','morado','gris'
        )
      );
  end if;
end;
$$;

commit;

-- La función base de respaldo/restauración (v0.7.6) es la que
-- construye y recrea las Actividades. Se actualiza únicamente
-- para añadir planeador_color. Los wrappers actuales continúan
-- funcionando sin cambios.

create or replace function public.importar_vigencia_json_core_v076(
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_schema text;
  v_vigencia jsonb;

  v_vigencia_id uuid;
  v_consejeria_id uuid;
  v_vigencia_consejeria_id uuid;
  v_fuente_id uuid;
  v_mandato_id uuid;
  v_linea_id uuid;
  v_programa_id uuid;
  v_proyecto_id uuid;
  v_actividad_id uuid;
  v_indicador_id uuid;
  v_evidencia_indicador_id uuid;

  v_consej jsonb;
  v_fuente jsonb;
  v_mandato jsonb;
  v_doc jsonb;
  v_linea jsonb;
  v_programa jsonb;
  v_proyecto jsonb;
  v_actividad jsonb;
  v_indicador jsonb;
  v_followup jsonb;
  v_rubro jsonb;
  v_evidencia jsonb;
  v_seguimiento_actividad jsonb;

  v_ref text;
  v_ref_rel text;
  v_fuente_ref text;
  v_indicator_ref text;

  -- Mapas REF del archivo -> UUID reales creados/reutilizados.
  v_consejeria_map jsonb := '{}'::jsonb;
  v_fuente_map jsonb := '{}'::jsonb;
  v_mandato_map jsonb := '{}'::jsonb;
  v_indicator_map jsonb := '{}'::jsonb;

  v_program_project_count integer;
  v_program_weight_sum numeric(10,2);

  v_count_consejerias integer := 0;
  v_count_consejerias_nuevas integer := 0;
  v_count_consejerias_reutilizadas integer := 0;
  v_count_fuentes integer := 0;
  v_count_mandatos integer := 0;
  v_count_mandato_links integer := 0;
  v_count_documentos integer := 0;
  v_count_lineas integer := 0;
  v_count_programas integer := 0;
  v_count_proyectos integer := 0;
  v_count_proyecto_mandatos integer := 0;
  v_count_actividades integer := 0;
  v_count_indicadores integer := 0;
  v_count_seguimientos_indicador integer := 0;
  v_count_rubros integer := 0;
  v_count_evidencias integer := 0;
  v_count_seguimientos_actividad integer := 0;
begin
  -- --------------------------------------------------------
  -- Validación base
  -- --------------------------------------------------------
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception
      'El archivo debe contener un objeto JSON válido.';
  end if;

  v_schema := p_payload ->> 'schema';

  if v_schema is distinct from 'onic-buen-gobierno.v1' then
    raise exception
      'Formato JSON no compatible. Se esperaba schema "onic-buen-gobierno.v1".';
  end if;

  v_vigencia := p_payload -> 'vigencia';

  if v_vigencia is null or jsonb_typeof(v_vigencia) <> 'object' then
    raise exception
      'El archivo no contiene el objeto "vigencia".';
  end if;

  if nullif(trim(v_vigencia ->> 'nombre'), '') is null then
    raise exception 'La Vigencia requiere nombre.';
  end if;

  if nullif(v_vigencia ->> 'fecha_inicio', '') is null
     or nullif(v_vigencia ->> 'fecha_fin', '') is null then
    raise exception
      'La Vigencia requiere fecha_inicio y fecha_fin.';
  end if;

  if (v_vigencia ->> 'fecha_fin')::date
     < (v_vigencia ->> 'fecha_inicio')::date then
    raise exception
      'fecha_fin no puede ser anterior a fecha_inicio.';
  end if;

  if exists (
    select 1
    from public.vigencias v
    where lower(trim(v.nombre)) =
          lower(trim(v_vigencia ->> 'nombre'))
      and v.fecha_inicio =
          (v_vigencia ->> 'fecha_inicio')::date
      and v.fecha_fin =
          (v_vigencia ->> 'fecha_fin')::date
  ) then
    raise exception
      'Ya existe una Vigencia con el mismo nombre y periodo.';
  end if;

  if jsonb_typeof(
       coalesce(
         p_payload -> 'consejerias',
         '[]'::jsonb
       )
     ) <> 'array' then
    raise exception
      '"consejerias" debe ser un arreglo JSON.';
  end if;

  if jsonb_array_length(
       coalesce(
         p_payload -> 'consejerias',
         '[]'::jsonb
       )
     ) = 0 then
    raise exception
      'La importación debe contener al menos una Consejería.';
  end if;

  -- --------------------------------------------------------
  -- Vigencia
  -- --------------------------------------------------------
  insert into public.vigencias (
    nombre,
    fecha_inicio,
    fecha_fin,
    lema,
    descripcion,
    estado
  )
  values (
    trim(v_vigencia ->> 'nombre'),
    (v_vigencia ->> 'fecha_inicio')::date,
    (v_vigencia ->> 'fecha_fin')::date,
    nullif(trim(v_vigencia ->> 'lema'), ''),
    nullif(trim(v_vigencia ->> 'descripcion'), ''),
    coalesce(
      nullif(trim(v_vigencia ->> 'estado'), ''),
      'borrador'
    )
  )
  returning id into v_vigencia_id;

  -- --------------------------------------------------------
  -- Consejerías + participación + biblioteca
  -- --------------------------------------------------------
  for v_consej in
    select value
    from jsonb_array_elements(
      coalesce(
        p_payload -> 'consejerias',
        '[]'::jsonb
      )
    )
  loop
    v_ref := nullif(trim(v_consej ->> 'ref'), '');

    if v_ref is null then
      raise exception
        'Cada Consejería requiere un campo ref.';
    end if;

    if v_consejeria_map ? v_ref then
      raise exception
        'REF de Consejería duplicado: %', v_ref;
    end if;

    if nullif(
         trim(
           v_consej #>> '{catalogo,nombre_largo}'
         ),
         ''
       ) is null
       or nullif(
         trim(
           v_consej #>> '{catalogo,nombre_corto}'
         ),
         ''
       ) is null then
      raise exception
        'La Consejería % requiere nombre_largo y nombre_corto en catalogo.',
        v_ref;
    end if;

    v_consejeria_id := null;

    select c.id
      into v_consejeria_id
    from public.consejerias c
    where lower(trim(c.nombre_corto)) =
          lower(
            trim(
              v_consej #>> '{catalogo,nombre_corto}'
            )
          )
       or lower(trim(c.nombre_largo)) =
          lower(
            trim(
              v_consej #>> '{catalogo,nombre_largo}'
            )
          )
    order by
      case
        when lower(trim(c.nombre_corto)) =
             lower(
               trim(
                 v_consej #>> '{catalogo,nombre_corto}'
               )
             )
        then 0
        else 1
      end,
      c.created_at
    limit 1;

    if v_consejeria_id is null then
      insert into public.consejerias (
        nombre_largo,
        nombre_corto,
        descripcion,
        funciones,
        icono_url,
        orden,
        estado
      )
      values (
        trim(
          v_consej #>> '{catalogo,nombre_largo}'
        ),
        trim(
          v_consej #>> '{catalogo,nombre_corto}'
        ),
        nullif(
          trim(
            v_consej #>> '{catalogo,descripcion}'
          ),
          ''
        ),
        nullif(
          trim(
            v_consej #>> '{catalogo,funciones}'
          ),
          ''
        ),
        nullif(
          trim(
            v_consej #>> '{catalogo,icono_url}'
          ),
          ''
        ),
        coalesce(
          nullif(
            v_consej #>> '{catalogo,orden}',
            ''
          )::integer,
          0
        ),
        coalesce(
          nullif(
            trim(
              v_consej #>> '{catalogo,estado}'
            ),
            ''
          ),
          'activa'
        )
      )
      returning id into v_consejeria_id;

      v_count_consejerias_nuevas :=
        v_count_consejerias_nuevas + 1;
    else
      v_count_consejerias_reutilizadas :=
        v_count_consejerias_reutilizadas + 1;
    end if;

    insert into public.vigencia_consejerias (
      vigencia_id,
      consejeria_id,
      responsable,
      pueblo,
      detalle,
      foto_url,
      estado
    )
    values (
      v_vigencia_id,
      v_consejeria_id,
      nullif(
        trim(
          v_consej #>> '{participacion,responsable}'
        ),
        ''
      ),
      nullif(
        trim(
          v_consej #>> '{participacion,pueblo}'
        ),
        ''
      ),
      nullif(
        trim(
          v_consej #>> '{participacion,detalle}'
        ),
        ''
      ),
      nullif(
        trim(
          v_consej #>> '{participacion,foto_url}'
        ),
        ''
      ),
      coalesce(
        nullif(
          trim(
            v_consej #>> '{participacion,estado}'
          ),
          ''
        ),
        'activa'
      )
    )
    returning id into v_vigencia_consejeria_id;

    v_consejeria_map :=
      v_consejeria_map
      || jsonb_build_object(
           v_ref,
           v_vigencia_consejeria_id::text
         );

    v_count_consejerias :=
      v_count_consejerias + 1;

    for v_doc in
      select value
      from jsonb_array_elements(
        coalesce(
          v_consej -> 'biblioteca',
          '[]'::jsonb
        )
      )
    loop
      insert into public.biblioteca_consejeria_documentos (
        vigencia_consejeria_id,
        titulo,
        palabras_clave,
        descripcion,
        url,
        tipo_documento,
        orden,
        estado
      )
      values (
        v_vigencia_consejeria_id,
        trim(v_doc ->> 'titulo'),
        nullif(
          trim(v_doc ->> 'palabras_clave'),
          ''
        ),
        nullif(
          trim(v_doc ->> 'descripcion'),
          ''
        ),
        trim(v_doc ->> 'url'),
        coalesce(
          nullif(
            trim(v_doc ->> 'tipo_documento'),
            ''
          ),
          'enlace'
        ),
        coalesce(
          nullif(v_doc ->> 'orden', '')::integer,
          0
        ),
        coalesce(
          nullif(trim(v_doc ->> 'estado'), ''),
          'activo'
        )
      );

      v_count_documentos :=
        v_count_documentos + 1;
    end loop;
  end loop;

  -- --------------------------------------------------------
  -- Fuentes de Mandatos
  -- --------------------------------------------------------
  for v_fuente in
    select value
    from jsonb_array_elements(
      coalesce(
        p_payload -> 'fuentes_mandatos',
        '[]'::jsonb
      )
    )
  loop
    v_ref := nullif(trim(v_fuente ->> 'ref'), '');

    if v_ref is null then
      raise exception
        'Cada Fuente de Mandatos requiere ref.';
    end if;

    if v_fuente_map ? v_ref then
      raise exception
        'REF de Fuente duplicado: %', v_ref;
    end if;

    insert into public.fuentes_mandatos (
      vigencia_id,
      nombre,
      descripcion,
      orden
    )
    values (
      v_vigencia_id,
      trim(v_fuente ->> 'nombre'),
      nullif(
        trim(v_fuente ->> 'descripcion'),
        ''
      ),
      coalesce(
        nullif(v_fuente ->> 'orden', '')::integer,
        0
      )
    )
    returning id into v_fuente_id;

    v_fuente_map :=
      v_fuente_map
      || jsonb_build_object(
           v_ref,
           v_fuente_id::text
         );

    v_count_fuentes :=
      v_count_fuentes + 1;
  end loop;

  -- --------------------------------------------------------
  -- Mandatos + asignación a Consejerías
  -- --------------------------------------------------------
  for v_mandato in
    select value
    from jsonb_array_elements(
      coalesce(
        p_payload -> 'mandatos',
        '[]'::jsonb
      )
    )
  loop
    v_ref := nullif(trim(v_mandato ->> 'ref'), '');

    if v_ref is null then
      raise exception
        'Cada Mandato requiere ref.';
    end if;

    if v_mandato_map ? v_ref then
      raise exception
        'REF de Mandato duplicado: %', v_ref;
    end if;

    v_fuente_ref :=
      nullif(
        trim(v_mandato ->> 'fuente_ref'),
        ''
      );

    v_fuente_id := null;

    if v_fuente_ref is not null then
      if not (v_fuente_map ? v_fuente_ref) then
        raise exception
          'El Mandato % usa una fuente_ref inexistente: %',
          v_ref,
          v_fuente_ref;
      end if;

      v_fuente_id :=
        (v_fuente_map ->> v_fuente_ref)::uuid;
    end if;

    insert into public.mandatos (
      vigencia_id,
      fuente_id,
      codigo,
      titulo,
      texto,
      observaciones,
      orden,
      estado
    )
    values (
      v_vigencia_id,
      v_fuente_id,
      nullif(trim(v_mandato ->> 'codigo'), ''),
      nullif(trim(v_mandato ->> 'titulo'), ''),
      trim(v_mandato ->> 'texto'),
      nullif(
        trim(v_mandato ->> 'observaciones'),
        ''
      ),
      coalesce(
        nullif(v_mandato ->> 'orden', '')::integer,
        0
      ),
      coalesce(
        nullif(trim(v_mandato ->> 'estado'), ''),
        'activo'
      )
    )
    returning id into v_mandato_id;

    v_mandato_map :=
      v_mandato_map
      || jsonb_build_object(
           v_ref,
           v_mandato_id::text
         );

    v_count_mandatos :=
      v_count_mandatos + 1;

    for v_ref_rel in
      select value
      from jsonb_array_elements_text(
        coalesce(
          v_mandato -> 'consejerias',
          '[]'::jsonb
        )
      )
    loop
      if not (v_consejeria_map ? v_ref_rel) then
        raise exception
          'El Mandato % referencia una Consejería inexistente: %',
          v_ref,
          v_ref_rel;
      end if;

      insert into public.mandato_consejerias (
        mandato_id,
        vigencia_consejeria_id
      )
      values (
        v_mandato_id,
        (v_consejeria_map ->> v_ref_rel)::uuid
      );

      v_count_mandato_links :=
        v_count_mandato_links + 1;
    end loop;
  end loop;

  -- --------------------------------------------------------
  -- Jerarquía operativa
  -- --------------------------------------------------------
  for v_consej in
    select value
    from jsonb_array_elements(
      coalesce(
        p_payload -> 'consejerias',
        '[]'::jsonb
      )
    )
  loop
    v_ref := trim(v_consej ->> 'ref');

    v_vigencia_consejeria_id :=
      (v_consejeria_map ->> v_ref)::uuid;

    for v_linea in
      select value
      from jsonb_array_elements(
        coalesce(
          v_consej -> 'lineas',
          '[]'::jsonb
        )
      )
    loop
      insert into public.lineas_accion (
        vigencia_consejeria_id,
        nombre,
        nombre_corto,
        descripcion,
        orden,
        estado
      )
      values (
        v_vigencia_consejeria_id,
        trim(v_linea ->> 'nombre'),
        nullif(trim(v_linea ->> 'nombre_corto'), ''),
        nullif(trim(v_linea ->> 'descripcion'), ''),
        coalesce(
          nullif(v_linea ->> 'orden', '')::integer,
          0
        ),
        coalesce(
          nullif(trim(v_linea ->> 'estado'), ''),
          'activa'
        )
      )
      returning id into v_linea_id;

      v_count_lineas :=
        v_count_lineas + 1;

      for v_programa in
        select value
        from jsonb_array_elements(
          coalesce(
            v_linea -> 'programas',
            '[]'::jsonb
          )
        )
      loop
        insert into public.programas (
          linea_accion_id,
          nombre,
          nombre_corto,
          descripcion,
          orden,
          estado
        )
        values (
          v_linea_id,
          trim(v_programa ->> 'nombre'),
          nullif(
            trim(v_programa ->> 'nombre_corto'),
            ''
          ),
          nullif(
            trim(v_programa ->> 'descripcion'),
            ''
          ),
          coalesce(
            nullif(
              v_programa ->> 'orden',
              ''
            )::integer,
            0
          ),
          coalesce(
            nullif(
              trim(v_programa ->> 'estado'),
              ''
            ),
            'activo'
          )
        )
        returning id into v_programa_id;

        v_count_programas :=
          v_count_programas + 1;

        v_program_project_count := 0;
        v_program_weight_sum := 0;

        for v_proyecto in
          select value
          from jsonb_array_elements(
            coalesce(
              v_programa -> 'proyectos',
              '[]'::jsonb
            )
          )
        loop
          v_program_project_count :=
            v_program_project_count + 1;

          v_program_weight_sum :=
            v_program_weight_sum
            + coalesce(
                nullif(
                  v_proyecto ->> 'ponderacion',
                  ''
                )::numeric,
                0
              );

          insert into public.proyectos (
            programa_id,
            codigo,
            nombre,
            nombre_corto,
            descripcion,
            objetivo_general,
            responsable,
            fecha_inicio,
            fecha_fin,
            estado,
            tiene_financiacion,
            valor_estimado,
            metodo_ponderacion,
            ponderacion,
            orden
          )
          values (
            v_programa_id,
            nullif(
              trim(v_proyecto ->> 'codigo'),
              ''
            ),
            trim(v_proyecto ->> 'nombre'),
            nullif(
              trim(v_proyecto ->> 'nombre_corto'),
              ''
            ),
            nullif(
              trim(v_proyecto ->> 'descripcion'),
              ''
            ),
            nullif(
              trim(
                v_proyecto ->> 'objetivo_general'
              ),
              ''
            ),
            nullif(
              trim(v_proyecto ->> 'responsable'),
              ''
            ),
            nullif(
              v_proyecto ->> 'fecha_inicio',
              ''
            )::date,
            nullif(
              v_proyecto ->> 'fecha_fin',
              ''
            )::date,
            coalesce(
              nullif(
                trim(v_proyecto ->> 'estado'),
                ''
              ),
              'borrador'
            ),
            coalesce(
              (v_proyecto ->> 'tiene_financiacion')::boolean,
              false
            ),
            nullif(
              v_proyecto ->> 'valor_estimado',
              ''
            )::numeric,
            coalesce(
              nullif(
                trim(
                  v_proyecto ->> 'metodo_ponderacion'
                ),
                ''
              ),
              'manual'
            ),
            coalesce(
              nullif(
                v_proyecto ->> 'ponderacion',
                ''
              )::numeric,
              0
            ),
            coalesce(
              nullif(
                v_proyecto ->> 'orden',
                ''
              )::integer,
              0
            )
          )
          returning id into v_proyecto_id;

          v_count_proyectos :=
            v_count_proyectos + 1;

          -- Mandatos vinculados al Proyecto.
          for v_ref_rel in
            select value
            from jsonb_array_elements_text(
              coalesce(
                v_proyecto -> 'mandatos',
                '[]'::jsonb
              )
            )
          loop
            if not (v_mandato_map ? v_ref_rel) then
              raise exception
                'El Proyecto "%" referencia un Mandato inexistente: %',
                v_proyecto ->> 'nombre',
                v_ref_rel;
            end if;

            insert into public.proyecto_mandatos (
              proyecto_id,
              mandato_id
            )
            values (
              v_proyecto_id,
              (v_mandato_map ->> v_ref_rel)::uuid
            );

            v_count_proyecto_mandatos :=
              v_count_proyecto_mandatos + 1;
          end loop;

          -- Actividades.
          for v_actividad in
            select value
            from jsonb_array_elements(
              coalesce(
                v_proyecto -> 'actividades',
                '[]'::jsonb
              )
            )
          loop
            insert into public.actividades (
              proyecto_id,
              codigo,
              nombre,
              descripcion,
              responsable,
              fecha_inicio,
              fecha_fin,
              estado,
              planeador_color,
              orden
            )
            values (
              v_proyecto_id,
              nullif(
                trim(v_actividad ->> 'codigo'),
                ''
              ),
              trim(v_actividad ->> 'nombre'),
              nullif(
                trim(v_actividad ->> 'descripcion'),
                ''
              ),
              nullif(
                trim(v_actividad ->> 'responsable'),
                ''
              ),
              nullif(
                v_actividad ->> 'fecha_inicio',
                ''
              )::date,
              nullif(
                v_actividad ->> 'fecha_fin',
                ''
              )::date,
              coalesce(
                nullif(
                  trim(v_actividad ->> 'estado'),
                  ''
                ),
                'borrador'
              ),
              nullif(
                trim(v_actividad ->> 'planeador_color'),
                ''
              ),
              coalesce(
                nullif(
                  v_actividad ->> 'orden',
                  ''
                )::integer,
                0
              )
            )
            returning id into v_actividad_id;

            v_count_actividades :=
              v_count_actividades + 1;

            -- Mapa local de indicadores de esta Actividad.
            v_indicator_map := '{}'::jsonb;

            for v_indicador in
              select value
              from jsonb_array_elements(
                coalesce(
                  v_actividad -> 'indicadores',
                  '[]'::jsonb
                )
              )
            loop
              v_indicator_ref :=
                nullif(
                  trim(v_indicador ->> 'ref'),
                  ''
                );

              if v_indicator_ref is null then
                raise exception
                  'Cada indicador requiere ref. Actividad: %',
                  v_actividad ->> 'nombre';
              end if;

              if v_indicator_map ? v_indicator_ref then
                raise exception
                  'REF de indicador duplicado en la Actividad "%": %',
                  v_actividad ->> 'nombre',
                  v_indicator_ref;
              end if;

              insert into public.indicadores_actividad (
                actividad_id,
                codigo,
                nombre,
                descripcion,
                unidad_medida,
                linea_base,
                meta,
                valor_actual,
                sentido,
                estado,
                orden
              )
              values (
                v_actividad_id,
                nullif(
                  trim(v_indicador ->> 'codigo'),
                  ''
                ),
                trim(v_indicador ->> 'nombre'),
                nullif(
                  trim(v_indicador ->> 'descripcion'),
                  ''
                ),
                nullif(
                  trim(v_indicador ->> 'unidad_medida'),
                  ''
                ),
                coalesce(
                  nullif(
                    v_indicador ->> 'linea_base',
                    ''
                  )::numeric,
                  0
                ),
                (v_indicador ->> 'meta')::numeric,
                coalesce(
                  nullif(
                    v_indicador ->> 'valor_actual',
                    ''
                  )::numeric,
                  coalesce(
                    nullif(
                      v_indicador ->> 'linea_base',
                      ''
                    )::numeric,
                    0
                  )
                ),
                coalesce(
                  nullif(
                    trim(v_indicador ->> 'sentido'),
                    ''
                  ),
                  'ascendente'
                ),
                coalesce(
                  nullif(
                    trim(v_indicador ->> 'estado'),
                    ''
                  ),
                  'activo'
                ),
                coalesce(
                  nullif(
                    v_indicador ->> 'orden',
                    ''
                  )::integer,
                  0
                )
              )
              returning id into v_indicador_id;

              v_indicator_map :=
                v_indicator_map
                || jsonb_build_object(
                     v_indicator_ref,
                     v_indicador_id::text
                   );

              v_count_indicadores :=
                v_count_indicadores + 1;

              for v_followup in
                select value
                from jsonb_array_elements(
                  coalesce(
                    v_indicador -> 'seguimientos',
                    '[]'::jsonb
                  )
                )
              loop
                insert into public.seguimientos_indicador (
                  indicador_id,
                  fecha_corte,
                  valor,
                  observacion
                )
                values (
                  v_indicador_id,
                  (v_followup ->> 'fecha_corte')::date,
                  (v_followup ->> 'valor')::numeric,
                  nullif(
                    trim(v_followup ->> 'observacion'),
                    ''
                  )
                );

                v_count_seguimientos_indicador :=
                  v_count_seguimientos_indicador + 1;
              end loop;
            end loop;

            -- Presupuesto.
            for v_rubro in
              select value
              from jsonb_array_elements(
                coalesce(
                  v_actividad -> 'presupuesto',
                  '[]'::jsonb
                )
              )
            loop
              insert into public.presupuesto_actividad_rubros (
                actividad_id,
                rubro,
                descripcion,
                programado,
                ejecutado,
                estado,
                orden
              )
              values (
                v_actividad_id,
                trim(v_rubro ->> 'rubro'),
                nullif(
                  trim(v_rubro ->> 'descripcion'),
                  ''
                ),
                coalesce(
                  nullif(
                    v_rubro ->> 'programado',
                    ''
                  )::numeric,
                  0
                ),
                coalesce(
                  nullif(
                    v_rubro ->> 'ejecutado',
                    ''
                  )::numeric,
                  0
                ),
                coalesce(
                  nullif(
                    trim(v_rubro ->> 'estado'),
                    ''
                  ),
                  'activo'
                ),
                coalesce(
                  nullif(
                    v_rubro ->> 'orden',
                    ''
                  )::integer,
                  0
                )
              );

              v_count_rubros :=
                v_count_rubros + 1;
            end loop;

            -- Evidencias.
            for v_evidencia in
              select value
              from jsonb_array_elements(
                coalesce(
                  v_actividad -> 'evidencias',
                  '[]'::jsonb
                )
              )
            loop
              v_indicator_ref :=
                nullif(
                  trim(
                    v_evidencia ->> 'indicador_ref'
                  ),
                  ''
                );

              v_evidencia_indicador_id := null;

              if v_indicator_ref is not null then
                if not (v_indicator_map ? v_indicator_ref) then
                  raise exception
                    'La Evidencia "%" usa indicador_ref inexistente: %',
                    v_evidencia ->> 'nombre',
                    v_indicator_ref;
                end if;

                v_evidencia_indicador_id :=
                  (v_indicator_map ->> v_indicator_ref)::uuid;
              end if;

              insert into public.evidencias_actividad (
                actividad_id,
                indicador_id,
                nombre,
                tipo,
                descripcion,
                fecha,
                url,
                observaciones,
                estado
              )
              values (
                v_actividad_id,
                v_evidencia_indicador_id,
                trim(v_evidencia ->> 'nombre'),
                nullif(
                  trim(v_evidencia ->> 'tipo'),
                  ''
                ),
                nullif(
                  trim(v_evidencia ->> 'descripcion'),
                  ''
                ),
                nullif(
                  v_evidencia ->> 'fecha',
                  ''
                )::date,
                nullif(
                  trim(v_evidencia ->> 'url'),
                  ''
                ),
                nullif(
                  trim(v_evidencia ->> 'observaciones'),
                  ''
                ),
                coalesce(
                  nullif(
                    trim(v_evidencia ->> 'estado'),
                    ''
                  ),
                  'activa'
                )
              );

              v_count_evidencias :=
                v_count_evidencias + 1;
            end loop;

            -- Seguimiento narrativo de Actividad.
            for v_seguimiento_actividad in
              select value
              from jsonb_array_elements(
                coalesce(
                  v_actividad -> 'seguimientos',
                  '[]'::jsonb
                )
              )
            loop
              insert into public.seguimientos_actividad (
                actividad_id,
                fecha_corte,
                resumen,
                logros,
                dificultades,
                proximos_pasos
              )
              values (
                v_actividad_id,
                (
                  v_seguimiento_actividad
                  ->> 'fecha_corte'
                )::date,
                nullif(
                  trim(
                    v_seguimiento_actividad
                    ->> 'resumen'
                  ),
                  ''
                ),
                nullif(
                  trim(
                    v_seguimiento_actividad
                    ->> 'logros'
                  ),
                  ''
                ),
                nullif(
                  trim(
                    v_seguimiento_actividad
                    ->> 'dificultades'
                  ),
                  ''
                ),
                nullif(
                  trim(
                    v_seguimiento_actividad
                    ->> 'proximos_pasos'
                  ),
                  ''
                )
              );

              v_count_seguimientos_actividad :=
                v_count_seguimientos_actividad + 1;
            end loop;
          end loop;
        end loop;

        -- Los Proyectos son el único nivel con ponderación manual.
        -- Para que el tablero sea verificable, cada Programa importado
        -- debe quedar con 100 % distribuido entre sus Proyectos.
        if coalesce(
             p_payload #>> '{metadata,tipo}',
             ''
           ) <> 'copia_seguridad'
           and v_program_project_count > 0
           and abs(v_program_weight_sum - 100) > 0.01 then
          raise exception
            'Las ponderaciones de los Proyectos del Programa "%" suman % y deben sumar 100.',
            v_programa ->> 'nombre',
            v_program_weight_sum;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'vigencia_id', v_vigencia_id,
    'vigencia_nombre', v_vigencia ->> 'nombre',
    'resumen', jsonb_build_object(
      'consejerias', v_count_consejerias,
      'consejerias_nuevas', v_count_consejerias_nuevas,
      'consejerias_reutilizadas', v_count_consejerias_reutilizadas,
      'fuentes_mandatos', v_count_fuentes,
      'mandatos', v_count_mandatos,
      'mandato_consejerias', v_count_mandato_links,
      'documentos_biblioteca', v_count_documentos,
      'lineas', v_count_lineas,
      'programas', v_count_programas,
      'proyectos', v_count_proyectos,
      'proyecto_mandatos', v_count_proyecto_mandatos,
      'actividades', v_count_actividades,
      'indicadores', v_count_indicadores,
      'seguimientos_indicador', v_count_seguimientos_indicador,
      'rubros_presupuesto', v_count_rubros,
      'evidencias', v_count_evidencias,
      'seguimientos_actividad', v_count_seguimientos_actividad
    )
  );
end;
$$;

create or replace function public.exportar_vigencia_json_core_v076(
  p_vigencia_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vigencia public.vigencias%rowtype;
  v_payload jsonb;
begin
  select *
    into v_vigencia
  from public.vigencias
  where id = p_vigencia_id;

  if not found then
    raise exception
      'La Vigencia no existe o ya fue eliminada.';
  end if;

  select jsonb_build_object(
    'schema', 'onic-buen-gobierno.v1',

    'metadata', jsonb_build_object(
      'tipo', 'copia_seguridad',
      'sistema', 'ONIC Buen Gobierno',
      'version_formato', '1',
      'version_aplicacion', '0.7.6',
      'original_vigencia_id', v_vigencia.id::text,
      'exportado_en', to_char(
        clock_timestamp() at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ),
      'nota',
        'Archivo generado por el sistema. Puede restaurarse mediante Importar vigencia.'
    ),

    'vigencia', jsonb_build_object(
      'nombre', v_vigencia.nombre,
      'fecha_inicio', v_vigencia.fecha_inicio,
      'fecha_fin', v_vigencia.fecha_fin,
      'lema', v_vigencia.lema,
      'descripcion', v_vigencia.descripcion,
      'estado', v_vigencia.estado
    ),

    'fuentes_mandatos',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'ref', f.id::text,
              'nombre', f.nombre,
              'descripcion', f.descripcion,
              'orden', f.orden
            )
            order by f.orden, f.nombre, f.id
          )
          from public.fuentes_mandatos f
          where f.vigencia_id = p_vigencia_id
        ),
        '[]'::jsonb
      ),

    'mandatos',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'ref', m.id::text,
              'fuente_ref',
                case
                  when m.fuente_id is null
                    then null
                  else m.fuente_id::text
                end,
              'codigo', m.codigo,
              'titulo', m.titulo,
              'texto', m.texto,
              'observaciones', m.observaciones,
              'orden', m.orden,
              'estado', m.estado,
              'consejerias',
                coalesce(
                  (
                    select jsonb_agg(
                      mc.vigencia_consejeria_id::text
                      order by mc.vigencia_consejeria_id::text
                    )
                    from public.mandato_consejerias mc
                    join public.vigencia_consejerias mvc
                      on mvc.id = mc.vigencia_consejeria_id
                    where mc.mandato_id = m.id
                      and mvc.vigencia_id = p_vigencia_id
                  ),
                  '[]'::jsonb
                )
            )
            order by m.orden, m.codigo nulls last, m.id
          )
          from public.mandatos m
          where m.vigencia_id = p_vigencia_id
        ),
        '[]'::jsonb
      ),

    'consejerias',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'ref', vc.id::text,

              'catalogo', jsonb_build_object(
                'nombre_largo', c.nombre_largo,
                'nombre_corto', c.nombre_corto,
                'descripcion', c.descripcion,
                'funciones', c.funciones,
                'icono_url', c.icono_url,
                'orden', c.orden,
                'estado', c.estado
              ),

              'participacion', jsonb_build_object(
                'responsable', vc.responsable,
                'pueblo', vc.pueblo,
                'detalle', vc.detalle,
                'foto_url', vc.foto_url,
                'estado', vc.estado
              ),

              'biblioteca',
                coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'titulo', b.titulo,
                        'palabras_clave', b.palabras_clave,
                        'descripcion', b.descripcion,
                        'url', b.url,
                        'tipo_documento', b.tipo_documento,
                        'orden', b.orden,
                        'estado', b.estado
                      )
                      order by b.orden, b.titulo, b.id
                    )
                    from public.biblioteca_consejeria_documentos b
                    where b.vigencia_consejeria_id = vc.id
                  ),
                  '[]'::jsonb
                ),

              'lineas',
                coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'nombre', l.nombre,
                        'nombre_corto', l.nombre_corto,
                        'descripcion', l.descripcion,
                        'orden', l.orden,
                        'estado', l.estado,

                        'programas',
                          coalesce(
                            (
                              select jsonb_agg(
                                jsonb_build_object(
                                  'nombre', pg.nombre,
                                  'nombre_corto', pg.nombre_corto,
                                  'descripcion', pg.descripcion,
                                  'orden', pg.orden,
                                  'estado', pg.estado,

                                  'proyectos',
                                    coalesce(
                                      (
                                        select jsonb_agg(
                                          jsonb_build_object(
                                            'codigo', p.codigo,
                                            'nombre', p.nombre,
                                            'nombre_corto', p.nombre_corto,
                                            'descripcion', p.descripcion,
                                            'objetivo_general', p.objetivo_general,
                                            'responsable', p.responsable,
                                            'fecha_inicio', p.fecha_inicio,
                                            'fecha_fin', p.fecha_fin,
                                            'estado', p.estado,
                                            'tiene_financiacion', p.tiene_financiacion,
                                            'valor_estimado', p.valor_estimado,
                                            'metodo_ponderacion', p.metodo_ponderacion,
                                            'ponderacion', p.ponderacion,
                                            'orden', p.orden,

                                            'mandatos',
                                              coalesce(
                                                (
                                                  select jsonb_agg(
                                                    pm.mandato_id::text
                                                    order by pm.mandato_id::text
                                                  )
                                                  from public.proyecto_mandatos pm
                                                  join public.mandatos mm
                                                    on mm.id = pm.mandato_id
                                                  where pm.proyecto_id = p.id
                                                    and mm.vigencia_id = p_vigencia_id
                                                ),
                                                '[]'::jsonb
                                              ),

                                            'actividades',
                                              coalesce(
                                                (
                                                  select jsonb_agg(
                                                    jsonb_build_object(
                                                      'codigo', a.codigo,
                                                      'nombre', a.nombre,
                                                      'descripcion', a.descripcion,
                                                      'responsable', a.responsable,
                                                      'fecha_inicio', a.fecha_inicio,
                                                      'fecha_fin', a.fecha_fin,
                                                      'estado', a.estado,
                                                      'planeador_color', a.planeador_color,
                                                      'orden', a.orden,

                                                      'indicadores',
                                                        coalesce(
                                                          (
                                                            select jsonb_agg(
                                                              jsonb_build_object(
                                                                'ref', i.id::text,
                                                                'codigo', i.codigo,
                                                                'nombre', i.nombre,
                                                                'descripcion', i.descripcion,
                                                                'unidad_medida', i.unidad_medida,
                                                                'linea_base', i.linea_base,
                                                                'meta', i.meta,
                                                                'valor_actual', i.valor_actual,
                                                                'sentido', i.sentido,
                                                                'estado', i.estado,
                                                                'orden', i.orden,

                                                                'seguimientos',
                                                                  coalesce(
                                                                    (
                                                                      select jsonb_agg(
                                                                        jsonb_build_object(
                                                                          'fecha_corte', si.fecha_corte,
                                                                          'valor', si.valor,
                                                                          'observacion', si.observacion
                                                                        )
                                                                        order by
                                                                          si.fecha_corte,
                                                                          si.created_at,
                                                                          si.id
                                                                      )
                                                                      from public.seguimientos_indicador si
                                                                      where si.indicador_id = i.id
                                                                    ),
                                                                    '[]'::jsonb
                                                                  )
                                                              )
                                                              order by i.orden, i.nombre, i.id
                                                            )
                                                            from public.indicadores_actividad i
                                                            where i.actividad_id = a.id
                                                          ),
                                                          '[]'::jsonb
                                                        ),

                                                      'presupuesto',
                                                        coalesce(
                                                          (
                                                            select jsonb_agg(
                                                              jsonb_build_object(
                                                                'rubro', pr.rubro,
                                                                'descripcion', pr.descripcion,
                                                                'programado', pr.programado,
                                                                'ejecutado', pr.ejecutado,
                                                                'estado', pr.estado,
                                                                'orden', pr.orden
                                                              )
                                                              order by pr.orden, pr.rubro, pr.id
                                                            )
                                                            from public.presupuesto_actividad_rubros pr
                                                            where pr.actividad_id = a.id
                                                          ),
                                                          '[]'::jsonb
                                                        ),

                                                      'evidencias',
                                                        coalesce(
                                                          (
                                                            select jsonb_agg(
                                                              jsonb_build_object(
                                                                'nombre', ev.nombre,
                                                                'tipo', ev.tipo,
                                                                'descripcion', ev.descripcion,
                                                                'fecha', ev.fecha,
                                                                'url', ev.url,
                                                                'indicador_ref',
                                                                  case
                                                                    when ev.indicador_id is null
                                                                      then null
                                                                    else ev.indicador_id::text
                                                                  end,
                                                                'observaciones', ev.observaciones,
                                                                'estado', ev.estado
                                                              )
                                                              order by
                                                                ev.fecha nulls last,
                                                                ev.nombre,
                                                                ev.id
                                                            )
                                                            from public.evidencias_actividad ev
                                                            where ev.actividad_id = a.id
                                                          ),
                                                          '[]'::jsonb
                                                        ),

                                                      'seguimientos',
                                                        coalesce(
                                                          (
                                                            select jsonb_agg(
                                                              jsonb_build_object(
                                                                'fecha_corte', sa.fecha_corte,
                                                                'resumen', sa.resumen,
                                                                'logros', sa.logros,
                                                                'dificultades', sa.dificultades,
                                                                'proximos_pasos', sa.proximos_pasos
                                                              )
                                                              order by
                                                                sa.fecha_corte,
                                                                sa.created_at,
                                                                sa.id
                                                            )
                                                            from public.seguimientos_actividad sa
                                                            where sa.actividad_id = a.id
                                                          ),
                                                          '[]'::jsonb
                                                        )
                                                    )
                                                    order by a.orden, a.nombre, a.id
                                                  )
                                                  from public.actividades a
                                                  where a.proyecto_id = p.id
                                                ),
                                                '[]'::jsonb
                                              )
                                          )
                                          order by p.orden, p.codigo nulls last, p.nombre, p.id
                                        )
                                        from public.proyectos p
                                        where p.programa_id = pg.id
                                      ),
                                      '[]'::jsonb
                                    )
                                )
                                order by pg.orden, pg.nombre, pg.id
                              )
                              from public.programas pg
                              where pg.linea_accion_id = l.id
                            ),
                            '[]'::jsonb
                          )
                      )
                      order by l.orden, l.nombre, l.id
                    )
                    from public.lineas_accion l
                    where l.vigencia_consejeria_id = vc.id
                  ),
                  '[]'::jsonb
                )
            )
            order by c.orden, c.nombre_corto, vc.id
          )
          from public.vigencia_consejerias vc
          join public.consejerias c
            on c.id = vc.consejeria_id
          where vc.vigencia_id = p_vigencia_id
        ),
        '[]'::jsonb
      )
  )
  into v_payload;

  return v_payload;
end;
$$;

notify pgrst, 'reload schema';
