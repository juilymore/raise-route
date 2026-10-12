import "server-only";
import { query } from "./client";
import { buildInsert } from "./sql";

/**
 * Founder-side database surface. Every write to founder-owned vc_pipeline data goes through the
 * founder_* SECURITY DEFINER functions (they set the actor flag the guard trigger checks).
 * Pipeline code must NEVER import this file.
 */
type Row = Record<string, unknown>;

const FOUNDER_INSERT_TABLES = ["feedback", "outreach_outcomes"] as const;
const COMPANY_PROFILE_COLUMNS = [
  "company_name", "product_description", "sector", "business_model", "stage",
  "geography", "icp", "raise_context", "relevance_keywords",
] as const;

export const founderDb = {
  async updateVc(vcId: string, patch: Row) {
    const [r] = await query<Row>("select * from public.founder_update_vc($1::uuid,$2::jsonb)", [vcId, JSON.stringify(patch)]);
    return r;
  },
  async appendContactEvent(vcId: string, event: Row) {
    const [r] = await query<Row>("select * from public.founder_append_contact_event($1::uuid,$2::jsonb)", [vcId, JSON.stringify(event)]);
    return r;
  },
  async getCompanyProfile() {
    const [r] = await query<Row>("select * from public.company_profile where id = 1");
    return r;
  },
  async updateCompanyProfile(patch: Record<string, unknown>) {
    const cols = Object.keys(patch).filter((k) => (COMPANY_PROFILE_COLUMNS as readonly string[]).includes(k));
    if (cols.length === 0) throw new Error("updateCompanyProfile: no editable columns in patch");
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const [r] = await query<Row>(`update public.company_profile set ${sets} where id = 1 returning *`, cols.map((c) => patch[c]));
    return r;
  },
  async insert(table: (typeof FOUNDER_INSERT_TABLES)[number], row: Row) {
    const { text, values } = buildInsert(FOUNDER_INSERT_TABLES, table, row);
    const [r] = await query<Row>(text, values);
    return r;
  },
};
