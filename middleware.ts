import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAppMode } from "@/lib/app-mode";
import { correlationId } from "@/lib/observability/request-context";
import { browserIdentifiers } from "@/lib/platform/browser-identifiers";
import { COMMERCIAL_PREFERENCE_COOKIE, commercialPreferenceCookieOptions, getCommercialSessionSecret } from "@/lib/commercial-identity/cookie";
import { decodeCommercialPreference, encodeCommercialPreference, safeCommercialContinuation } from "@/lib/commercial-identity/preference";
import { requiresSiteNavigation, resolveSiteNavigation, sitePreference, siteSelectionUrl } from "@/lib/commercial-identity/site-navigation";
import type { CommercialMembershipSummary } from "@/types/tenancy";

const protectedPrefixes = ["/dashboard", "/staff", "/compliance", "/rota", "/attendance", "/payroll", "/settings", "/leave", "/accounts", "/profile", "/my-rota", "/my-attendance", "/change-password", "/reset-password", "/onboarding", "/mfa", "/organisations"];

export async function middleware(request: NextRequest) {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);
  const nextResponse = () =>
    NextResponse.next({ request: { headers: forwardedHeaders } });
  const correlated = <T extends NextResponse>(response: T): T => {
    response.headers.set("x-request-id", requestId);
    return response;
  };
  const hasConfig = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`));
  const hasKioskDeviceCookie = [browserIdentifiers.deviceCookie.current, ...browserIdentifiers.deviceCookie.legacy]
    .some((name) => Boolean(request.cookies.get(name)?.value));
  if (hasKioskDeviceCookie && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/clock";
    url.search = "";
    return correlated(NextResponse.redirect(url));
  }
  if (getAppMode() === "demo" || !hasConfig || !isProtected) {
    return correlated(nextResponse());
  }

  let response = nextResponse();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        forwardedHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return correlated(NextResponse.redirect(url));
  }

  const { data: account } = await supabase
    .from("staff_accounts")
    .select("must_change_password")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (account?.must_change_password && !["/change-password", "/reset-password"].includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/change-password";
    url.search = "";
    return correlated(NextResponse.redirect(url));
  }

  // Navigation recovery is not authorization. POST actions retain their own fresh,
  // sensitive membership/site checks and are never redirected around those checks.
  if (request.method === "GET" && requiresSiteNavigation(request.nextUrl.pathname)) {
    const { data: memberships, error } = await supabase.rpc("current_commercial_identity_snapshot");
    if (error || !Array.isArray(memberships)) {
      return correlated(new NextResponse("Your access could not be checked. Please try again.", { status: 503, headers: { "Cache-Control": "no-store" } }));
    }
    // Preserve the established legacy account flow, not a fallback on RPC failure.
    if (memberships.length === 0 && account) return correlated(response);
    const secret = getCommercialSessionSecret();
    const preference = await decodeCommercialPreference(request.cookies.get(COMMERCIAL_PREFERENCE_COOKIE)?.value, secret);
    const navigation = resolveSiteNavigation({ authUserId: user.id, email: user.email ?? null, aal: "aal1", memberships: memberships as CommercialMembershipSummary[] }, preference);
    const continuation = safeCommercialContinuation(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    const options = commercialPreferenceCookieOptions(process.env.NODE_ENV === "production");
    const refreshedCookies = response.cookies.getAll();
    if (navigation.kind !== "ready") {
      const target = navigation.kind === "organisation"
        ? `/organisations/select?next=${encodeURIComponent(continuation)}`
        : siteSelectionUrl(continuation, navigation.accessChanged);
      response = NextResponse.redirect(new URL(target, request.url));
      refreshedCookies.forEach((cookie) => response.cookies.set(cookie));
      if (navigation.kind === "organisation") {
        response.cookies.set(COMMERCIAL_PREFERENCE_COOKIE, "", { ...options, maxAge: 0 });
      } else if (navigation.accessChanged) {
        response.cookies.set(COMMERCIAL_PREFERENCE_COOKIE, await encodeCommercialPreference(sitePreference(navigation.context), secret), options);
      }
      return correlated(response);
    }
    if (navigation.context.selectedSiteId !== preference?.siteId) {
      const encoded = await encodeCommercialPreference(sitePreference(navigation.context), secret);
      request.cookies.set(COMMERCIAL_PREFERENCE_COOKIE, encoded);
      forwardedHeaders.set("cookie", request.headers.get("cookie") ?? "");
      response = nextResponse();
      refreshedCookies.forEach((cookie) => response.cookies.set(cookie));
      response.cookies.set(COMMERCIAL_PREFERENCE_COOKIE, encoded, options);
    }
  }
  return correlated(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
