const validCorrelationId = /^[A-Za-z0-9._-]{16,80}$/;

export function correlationId(incoming: string | null | undefined): string {
  const candidate = incoming?.trim();
  return candidate && validCorrelationId.test(candidate)
    ? candidate
    : globalThis.crypto.randomUUID();
}
