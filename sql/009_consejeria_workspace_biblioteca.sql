-- ==========================================================
-- ONIC · SISTEMA DE BUEN GOBIERNO
-- Migración 009 · Edición extendida de Consejerías
-- v0.7.1
-- ==========================================================
--
-- La relación Consejería ↔ Mandato ya existe en:
--   mandato_consejerias
--
-- Esta migración agrega únicamente la Biblioteca documental
-- asociada a una Consejería dentro de una Vigencia.
-- ==========================================================

begin;

create table if not exists public.biblioteca_consejeria_documentos (
  id uuid primary key default gen_random_uuid(),

  vigencia_consejeria_id uuid not null
    references public.vigencia_consejerias(id)
    on delete restrict,

  titulo text not null,
  palabras_clave text,
  descripcion text,
  url text not null,

  tipo_documento text not null default 'enlace'
    check (tipo_documento in (
      'texto',
      'video',
      'pdf',
      'word',
      'presentacion',
      'hoja_calculo',
      'imagen',
      'audio',
      'enlace',
      'otro'
    )),

  orden integer not null default 0,

  estado text not null default 'activo'
    check (estado in ('activo', 'archivado')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_biblioteca_consejeria_vc
  on public.biblioteca_consejeria_documentos (vigencia_consejeria_id);

create index if not exists idx_biblioteca_consejeria_tipo
  on public.biblioteca_consejeria_documentos (tipo_documento);

drop trigger if exists trg_biblioteca_consejeria_updated_at
  on public.biblioteca_consejeria_documentos;

create trigger trg_biblioteca_consejeria_updated_at
before update on public.biblioteca_consejeria_documentos
for each row execute function public.set_updated_at();

alter table public.biblioteca_consejeria_documentos
  enable row level security;

drop policy if exists "authenticated_full_access"
  on public.biblioteca_consejeria_documentos;

create policy "authenticated_full_access"
  on public.biblioteca_consejeria_documentos
  for all
  to authenticated
  using (true)
  with check (true);

commit;

notify pgrst, 'reload schema';
