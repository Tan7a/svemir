// Single-user access control, runtime-agnostic core.
//
// Reuses the EXISTING admin credentials (ADMIN_USERNAME / ADMIN_PASSWORD) that
// proxy.ts used for HTTP Basic Auth - we only swap the *mechanism* from a
// browser-native Basic Auth challenge to a cookie set by our own sign-in popup.
//
// This module must run in BOTH the proxy (Edge/Node middleware) and Node server
// actions, so it uses Web Crypto (`crypto.subtle`) rather than `node:crypto`.
// It must NOT import `next/headers` (that would break the proxy bundle) - the
// cookie-store helpers live in access-server.ts / access-actions.ts instead.

export const COOKIE_NAME = "svemir_access";
// Readable companion cookie (value "1") used only by the client Add button to
// decide popup-vs-navigate. NOT a security boundary - real auth is COOKIE_NAME.
export const HINT_COOKIE = "svemir_access_hint";

// Versioned salt so the token shape can be rotated later without colliding.
const SALT = "svemir-access:v1:";

function configuredCreds(): { username: string; password: string } | null {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return null; // fail closed when unconfigured
  return { username, password };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The cookie value we expect for an authenticated session: a hash of the
 * configured credentials. Returns null when ADMIN_USERNAME/ADMIN_PASSWORD are
 * missing so the gate fails closed (no Add) rather than open.
 */
export async function expectedToken(): Promise<string | null> {
  const creds = configuredCreds();
  if (!creds) return null;
  return sha256Hex(`${SALT}${creds.username}:${creds.password}`);
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** True when the submitted username + password match the configured admin. */
export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const creds = configuredCreds();
  if (!creds) return false;
  // Compare against the same hash both sides derive, so neither the raw
  // password nor a length side-channel leaks through the comparison.
  const presented = await sha256Hex(`${SALT}${username}:${password}`);
  const expected = await expectedToken();
  return expected != null && timingSafeEqualHex(presented, expected);
}

/** True when a cookie value matches the expected session token. */
export async function tokenMatches(
  value: string | undefined | null
): Promise<boolean> {
  if (!value) return false;
  const expected = await expectedToken();
  return expected != null && timingSafeEqualHex(value, expected);
}
