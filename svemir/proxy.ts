import { NextRequest, NextResponse } from "next/server";

const BASIC_AUTH_PATHS =
  /^\/(admin|api\/(scrape|upload-image|parse-bookmarks))(\/|$)/;
const CORS_PATHS = /^\/api\/v1\//;

function unauthorized() {
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
  });
}

function checkBasic(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const [u, p] = atob(header.slice(6)).split(":");
    return (
      u === process.env.ADMIN_USERNAME && p === process.env.ADMIN_PASSWORD
    );
  } catch {
    return false;
  }
}

function allowedOrigin(origin: string): string {
  if (!origin) return "";
  if (origin.startsWith("chrome-extension://")) return origin;
  if (origin === "https://svemir.space") return origin;
  if (origin === "http://localhost:3000") return origin;
  return "";
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (BASIC_AUTH_PATHS.test(pathname)) {
    return checkBasic(req) ? NextResponse.next() : unauthorized();
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
    "/admin/:path*",
    "/api/scrape",
    "/api/upload-image",
    "/api/parse-bookmarks",
    "/api/v1/:path*",
  ],
};
