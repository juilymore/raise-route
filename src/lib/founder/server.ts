/**
 * There is no login: every visitor can use Run now and edit notes, the company profile and the scoring table.
 * Kept as a function so pages read the same way; the database guards (not this flag) protect the system columns.
 */
export async function currentIsFounder(): Promise<boolean> {
  return true;
}
