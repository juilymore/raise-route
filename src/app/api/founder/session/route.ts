import { isFounder, json } from "@/lib/founder/guard";

export const dynamic = "force-dynamic";

/** Is the caller a logged-in founder? Booleans only. */
export async function GET(req: Request) {
  return json({ founder: await isFounder(req) });
}
