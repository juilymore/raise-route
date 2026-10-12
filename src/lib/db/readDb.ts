import "server-only";
import { query } from "./client";
import { companyProfileSchema, overviewSchema, vcRowSchema } from "./rows";

/** Read-only queries for pages. Rows are validated with zod so schema drift fails loudly instead of rendering garbage. */
export async function listVcs() {
  const rows = await query("select * from public.vc_pipeline order by firm");
  return rows.map((r) => vcRowSchema.parse(r));
}

export async function getOverview() {
  const [row] = await query("select * from public.v_pipeline_overview");
  return overviewSchema.parse(row);
}

export async function getCompanyProfile() {
  const [row] = await query("select * from public.company_profile where id = 1");
  const profile = companyProfileSchema.parse(row);
  const [flag] = await query<{ value: { value?: boolean } }>(
    "select value from public.app_settings where key = 'company_profile_is_sample'",
  );
  return { profile, isSample: flag?.value?.value === true };
}
