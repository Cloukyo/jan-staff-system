import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { createPilotEmailHmac } from "./email-hmac";

export const PILOT_SIGNUP_MESSAGE =
  "Commercial signup is currently limited to approved pilot organisations. Use the approved work email or contact the pilot team.";

export type PilotSignupReservation = {
  emailHmac: string;
  attemptId: string;
};

type RpcClient = {
  rpc(
    functionName: string,
    parameters: Record<string, string>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

function pilotGateEnabled(): boolean {
  return process.env.COMMERCIAL_PILOT_SIGNUP_GATE?.trim() === "true";
}

function pilotSecret(): string {
  const secret = process.env.COMMERCIAL_PILOT_ACCESS_HMAC_SECRET?.trim();
  if (!secret) throw new Error("Commercial pilot signup is enabled without its HMAC secret.");
  return secret;
}

async function pilotRpc(
  functionName: string,
  parameters: Record<string, string>,
): Promise<string | null> {
  const client = createSupabaseAdminClient() as unknown as RpcClient;
  const { data, error } = await client.rpc(functionName, parameters);
  if (error) return null;
  return typeof data === "string" ? data : null;
}

export async function reservePilotSignup(
  email: string,
): Promise<PilotSignupReservation | null | false> {
  if (!pilotGateEnabled()) return null;
  const reservation = {
    emailHmac: createPilotEmailHmac(email, pilotSecret()),
    attemptId: randomUUID(),
  };
  const outcome = await pilotRpc("reserve_commercial_pilot_access", {
    email_hmac_value: reservation.emailHmac,
    signup_attempt_id: reservation.attemptId,
  });
  return outcome === "reserved" ? reservation : false;
}

export async function bindPilotSignup(
  reservation: PilotSignupReservation,
  authUserId: string,
): Promise<boolean> {
  const outcome = await pilotRpc("bind_commercial_pilot_access", {
    email_hmac_value: reservation.emailHmac,
    signup_attempt_id: reservation.attemptId,
    auth_user_id_value: authUserId,
  });
  return outcome === "bound";
}

export async function releasePilotSignup(
  reservation: PilotSignupReservation,
): Promise<void> {
  await pilotRpc("release_commercial_pilot_access", {
    email_hmac_value: reservation.emailHmac,
    signup_attempt_id: reservation.attemptId,
  });
}
