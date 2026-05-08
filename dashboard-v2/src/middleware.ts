import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";

// Better Auth pose un cookie `ifind.session_token` ou `__Secure-ifind.session_token` selon HTTPS
const SESSION_COOKIES = ["ifind.session_token", "__Secure-ifind.session_token"];

const PROTECTED_PREFIXES = ["/dashboard", "/triggers", "/pipeline", "/unibox", "/clients", "/settings", "/system", "/onboarding"];
const AUTH_PAGES = ["/login"];

// Préfixes API soumis au rate-limit (60 req/min/IP).
// Webhooks (HMAC) et /api/internal (CRON_SECRET) restent libres : déjà
// authentifiés par signature, et leur trafic est borné côté émetteur.
const RATE_LIMITED_API_PREFIXES = ["/api/triggers", "/api/leads"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rate-limit sur API publiques (anti-flood/abuse) — appliqué AVANT auth
  // pour ne pas exposer l'auth check à un flood non plafonné.
  if (RATE_LIMITED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const ip = extractClientIp(req);
    const result = checkRateLimit(`api:${ip}`);
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "rate_limited", retryAfterSec: result.retryAfterSec }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(result.retryAfterSec),
            "x-ratelimit-remaining": "0",
          },
        },
      );
    }
  }

  const hasSession = SESSION_COOKIES.some((name) => req.cookies.get(name)?.value);

  // Tente d'aller sur une route protégée sans session → /login
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
  }

  // Si déjà loggué et accès /login → redirige vers /dashboard
  if (AUTH_PAGES.includes(pathname) && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/triggers/:path*",
    "/pipeline/:path*",
    "/unibox/:path*",
    "/clients/:path*",
    "/settings/:path*",
    "/system/:path*",
    "/onboarding/:path*",
    "/login",
    "/api/triggers/:path*",
    "/api/leads/:path*",
  ],
};
