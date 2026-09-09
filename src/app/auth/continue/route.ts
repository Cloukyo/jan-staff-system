import { NextResponse } from "next/server";
import { resolveAndApplyPostAuthDestination } from "@/lib/auth/post-auth-server";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const destination = await resolveAndApplyPostAuthDestination(url.searchParams.get("next"));
    return NextResponse.redirect(new URL(destination, url.origin));
  } catch (error) {
    if (error instanceof CommercialIdentityError && error.code === "not_authenticated") {
      return NextResponse.redirect(new URL("/login", url.origin));
    }
    throw error;
  }
}

export const POST = GET;
