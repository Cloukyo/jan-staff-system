import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAppMode } from "@/lib/app-mode";
import { correlationId } from "@/lib/observability/request-context";
import { browserIdentifiers } from "@/lib/platform/browser-identifiers";

const protectedPrefixes = ["/dashboard", "/staff", "/compliance", "/rota", "/attendance", "/payroll", "/settings", "/leave", "/accounts", "/profile", "/my-rota", "/my-attendance", "/change-password", "/reset-password", "/onboarding", "/mfa"];

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

  return correlated(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
