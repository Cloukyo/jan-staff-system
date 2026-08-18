import { canonicalJson, sha256CanonicalJson, type JsonValue } from "./canonical-json";

export type CustomerExportDependencies = {
  prepare(): Promise<unknown>;
  recordAudit(input: {
    schemaVersion: string;
    digest: string;
    filename: string;
    counts: Record<string, number>;
  }): Promise<unknown>;
  now?: () => Date;
};

const forbiddenKeys = new Set([
  "authuserid", "token", "tokenhash", "devicetoken", "devicetokenhash", "pinhash", "pinverifier",
  "failedattemptcount", "lockeduntil", "registrationsecret", "claimantnonce", "fingerprint",
  "invitationtoken", "invitationtokenhash", "deliverysecretid", "vaultid", "providercustomerid",
  "providersubscriptionid", "providerpriceid", "providersessionid", "providerwebhookid", "requesthash",
  "rawdraft", "storagepath", "encryptedvalue",
]);

function keyIdentity(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertSafe(value: unknown, path = "export"): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafe(child, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(keyIdentity(key))) throw new Error(`Customer export contains a forbidden field at ${path}.${key}.`);
      assertSafe(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Customer export contains a non-JSON value at ${path}.`);
}

function londonDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function buildCustomerExport(dependencies: CustomerExportDependencies): Promise<{
  filename: string;
  canonicalBody: string;
  digest: string;
  counts: Record<string, number>;
}> {
  const projection = await dependencies.prepare();
  assertSafe(projection);
  if (!projection || Array.isArray(projection) || typeof projection !== "object") throw new Error("Customer export projection is unavailable.");
  const record = projection as Record<string, JsonValue>;
  const categories = record.categories;
  if (!categories || Array.isArray(categories) || typeof categories !== "object") throw new Error("Customer export categories are unavailable.");
  const categoryRecord = categories as Record<string, JsonValue>;
  const counts = Object.fromEntries(Object.entries(categoryRecord).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
  const now = (dependencies.now ?? (() => new Date()))();
  const schemaVersion = String(record.exportVersion);
  const filename = `workforce-platform-export-${londonDate(now)}.json`;
  const unsigned: JsonValue = {
    manifest: {
      schemaVersion,
      organisationId: String(record.organisationId),
      generatedAt: now.toISOString(),
      presentationTimezone: String(record.presentationTimezone),
      counts,
      omissions: record.omissions ?? [],
    },
    data: categoryRecord,
  };
  const digest = sha256CanonicalJson(unsigned);
  const bundle: JsonValue = {
    manifest: { ...(unsigned as { manifest: Record<string, JsonValue> }).manifest, digest },
    data: categoryRecord,
  };
  await dependencies.recordAudit({ schemaVersion, digest, filename, counts });
  return { filename, canonicalBody: canonicalJson(bundle), digest, counts };
}
