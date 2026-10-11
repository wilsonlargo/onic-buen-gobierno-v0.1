const config = window.APP_CONFIG || {};

export const isSupabaseConfigured = Boolean(
  config.supabaseUrl &&
  config.supabaseKey &&
  window.supabase?.createClient
);

export const supabaseClient = isSupabaseConfigured
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseKey)
  : null;

export function requireSupabase() {
  if (!supabaseClient) {
    throw new Error(
      "El Sistema no está disponible en este momento. Contacta al Administrador."
    );
  }

  return supabaseClient;
}
