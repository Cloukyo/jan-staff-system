import { createHash } from "node:crypto";

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Payroll fingerprints require finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).sort().join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Payroll fingerprints do not support ${typeof value} values.`);
}

export function fingerprintPayrollInput(input: unknown): string {
  return createHash("sha256").update(canonicalValue(input), "utf8").digest("hex");
}
