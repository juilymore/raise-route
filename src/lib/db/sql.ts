/** Pure SQL helpers (no I/O) so the safety rules are unit-testable. */

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function assertIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${JSON.stringify(name)}`);
  return name;
}

/** Build a parameterised INSERT for an allow-listed table. Values are never interpolated. */
export function buildInsert(allowed: readonly string[], table: string, row: Record<string, unknown>) {
  if (!allowed.includes(table)) throw new Error(`Table not allowed for this client: ${table}`);
  const cols = Object.keys(row).filter((k) => row[k] !== undefined).map(assertIdent);
  if (cols.length === 0) throw new Error("insert: empty row");
  const text = `insert into public.${assertIdent(table)} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  const values = cols.map((c) => {
    const v = row[c];
    return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  return { text, values };
}
