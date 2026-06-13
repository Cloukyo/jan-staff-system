import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAppMode } from "@/lib/app-mode";
const KIOSK_DEVICE_COOKIE = "jan_kiosk_device";

const protectedPrefixes = ["/dashboard", "/staff", "/compliance", "/rota", "/attendance", "/payroll", "/settings", "/leave", "/accounts", "/profile", "/my-rota", "/my-attendance", "/change-password", "/reset-password"];

export async function middleware(request: NextRequest) {
  const hasConfig = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`));
  const hasKioskDeviceCookie = Boolean(request.cookies.get(KIOSK_DEVICE_COOKIE)?.value);
  if (hasKioskDeviceCookie && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/clock";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (getAppMode() === "demo" || !hasConfig || !isProtected) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
    return NextResponse.redirect(url);
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
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
