import { cookies } from "next/headers";
import { COOKIE_NAME, tokenMatches } from "./access";

/**
 * Server-side auth check for Server Components and Server Actions. Reads the
 * httpOnly session cookie via next/headers. Used to gate every mutating admin
 * action - the proxy only covers /admin paths, so actions invoked from other
 * routes (e.g. rename/delete in the block modal on "/") MUST guard themselves.
 */
export async function isAuthed(): Promise<boolean> {
  const store = await cookies();
  return tokenMatches(store.get(COOKIE_NAME)?.value);
}
