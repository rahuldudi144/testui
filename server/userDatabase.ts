/** Host label for a database URI. The password is not included. */
export function parseDbHost(dbUri: string): string {
  try {
    const url = new URL(dbUri);
    const port = url.port ? `:${url.port}` : "";
    return `${url.hostname}${port}`;
  } catch {
    return "database";
  }
}

export function countTables(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 0;
  }
  const tables = (metadata as { tables?: unknown }).tables;
  if (tables && typeof tables === "object" && !Array.isArray(tables)) {
    return Object.keys(tables).length;
  }
  return 0;
}
