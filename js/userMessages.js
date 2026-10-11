const TECHNICAL_ERROR_PATTERN = /(supabase|postgrest|postgres|schema(?:\s+cache)?|relation\s+[^ ]+\s+does\s+not\s+exist|column\s+[^ ]+\s+does\s+not\s+exist|constraint|foreign\s+key|duplicate\s+key|violates|row[- ]level\s+security|\brls\b|\brpc\b|jwt|pgrst\d*|sqlstate|permission\s+denied|failed\s+to\s+fetch|networkerror|cannot\s+read\s+properties|is\s+not\s+a\s+function|undefined|42p\d+|23\d{3}|22p\d+)/i;

/**
 * Devuelve un mensaje comprensible para el usuario y evita exponer
 * detalles internos de infraestructura o programación en la interfaz.
 */
export function friendlyErrorMessage(error, fallback = "No fue posible completar la operación. Intenta nuevamente.") {
  const message = String(error?.message || "").trim();

  if (!message) return fallback;

  // Los conflictos de edición y las validaciones funcionales están pensados
  // para ser leídos por el usuario y deben conservar su explicación.
  if (error?.code === "APP_EDIT_CONFLICT") return message;

  return TECHNICAL_ERROR_PATTERN.test(message) ? fallback : message;
}
