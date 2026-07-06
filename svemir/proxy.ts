import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, tokenMatches } from "@/lib/access";

// Paths that require the admin session cookie: the admin-only helper APIs.
// (The /admin page UI was retired - owners add/manage via the floating +
// composer, whose server actions re-check auth themselves.)
const GATED_PATHS = /^\/api\/(scrape|upload-image|parse-bookmarks)(\/|$)/;
const CORS_PATHS = /^\/api\/v1\//;

function allowedOrigin(origin: string): string {
  if (!origin) return "";
  if (origin.startsWith("chrome-extension://")) return origin;
  if (origin === "https://svemir.space") return origin;
  if (origin === "http://localhost:3000") return origin;
  return "";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (GATED_PATHS.test(pathname)) {
    const authed = await tokenMatches(req.cookies.get(COOKIE_NAME)?.value);
    // These are all APIs, so answer programmatically (no WWW-Authenticate
    // header - that's what triggered the browser-native Basic Auth dialog we
    // replaced with our own sign-in popup).
    if (!authed) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (CORS_PATHS.test(pathname)) {
    const origin = req.headers.get("origin") ?? "";
    const allow = allowedOrigin(origin);

    if (req.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: allow
          ? {
              "Access-Control-Allow-Origin": allow,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "authorization, content-type",
              "Access-Control-Max-Age": "600",
              Vary: "Origin",
            }
          : {},
      });
    }

    const res = NextResponse.next();
    if (allow) {
      res.headers.set("Access-Control-Allow-Origin", allow);
      res.headers.set("Vary", "Origin");
    }
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/scrape",
    "/api/upload-image",
    "/api/parse-bookmarks",
    "/api/v1/:path*",
  ],
};
