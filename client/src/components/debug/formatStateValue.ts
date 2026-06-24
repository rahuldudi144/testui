/** Soft cap for unknown large strings/objects in debug state (avoid freezing the UI). */
const SOFT_MAX_CHARS = 32_000;

/**
 * Format a state field for display in the debug panel.
 * SQL and other code fields are never truncated at arbitrary short limits.
 */
export function formatStateFieldValue(
  key: string | null | undefined,
  value: unknown,
): string {
  void key;
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    if (value.length > SOFT_MAX_CHARS) {
      return `${value.slice(0, SOFT_MAX_CHARS)}\n\n… truncated (${value.length.toLocaleString()} chars total)`;
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((v) => String(v)).join("\n");
    if (text.length > SOFT_MAX_CHARS) {
      return `${text.slice(0, SOFT_MAX_CHARS)}\n\n… truncated (${text.length.toLocaleString()} chars total)`;
    }
    return text;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length > SOFT_MAX_CHARS) {
      return `${json.slice(0, SOFT_MAX_CHARS)}\n\n… truncated (${json.length.toLocaleString()} chars total)`;
    }
    return json;
  } catch {
    return String(value);
  }
}
