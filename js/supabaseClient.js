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
      "Supabase no está configurado. Completa js/config.js con la URL y la clave pública del proyecto."
    );
  }

  return supabaseClient;
}
