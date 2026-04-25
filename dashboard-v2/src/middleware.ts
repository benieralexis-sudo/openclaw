import { NextResponse, type NextRequest } from "next/server";

// Better Auth pose un cookie `ifind.session_token` ou `__Secure-ifind.session_token` selon HTTPS
const SESSION_COOKIES = ["ifind.session_token", "__Secure-ifind.session_token"];

const PROTECTED_PREFIXES = ["/dashboard", "/triggers", "/pipeline", "/unibox", "/clients", "/settings", "/system", "/onboarding"];
const AUTH_PAGES = ["/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
  ],
};
