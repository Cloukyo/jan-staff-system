import { timingSafeEqual } from "node:crypto";

type NotificationRouteInput = {
  appEnvironment: string;
  authorization: string | null;
  workerSecret: string | null;
  deliveryEnabled: boolean;
};

function authorised(authorization: string | null, workerSecret: string | null): boolean {
  if (!authorization || !workerSecret) return false;
  const supplied = Buffer.from(authorization, "utf8");
  const expected = Buffer.from(`Bearer ${workerSecret}`, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function evaluateNotificationRoute(
  input: NotificationRouteInput,
): "not_found" | "disabled" | "process" {
  if (!["staging", "production"].includes(input.appEnvironment)) return "not_found";
  if (!authorised(input.authorization, input.workerSecret)) return "not_found";
  return input.deliveryEnabled ? "process" : "disabled";
}
