import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { safeCommercialContinuation } from "@/lib/invitations/continuation";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const isPasswordReset = url.searchParams.get("next") === "/reset-password";
  const requested = url.searchParams.get("next");
  const next = isPasswordReset ? "/reset-password" : safeCommercialContinuation(requested) ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  return NextResponse.redirect(new URL("/login?auth-error=invalid", url.origin));
}
