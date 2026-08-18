import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalise(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) throw new Error("Value cannot be represented as canonical JSON.");
      result[key] = normalise(child);
    }
    return result;
  }
  throw new Error("Value cannot be represented as canonical JSON.");
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalise(value));
}

export function sha256CanonicalJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
