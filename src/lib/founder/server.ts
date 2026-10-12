import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { COOKIE_NAME, verifySessionToken } from "./session";

/** For server components: is the current visitor a logged-in founder? */
export async function currentIsFounder(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(COOKIE_NAME)?.value, getEnv().SESSION_SECRET);
}
