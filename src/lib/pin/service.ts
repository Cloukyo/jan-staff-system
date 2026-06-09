export function prototypeHashPin(pin: string): string {
  if (typeof btoa === "function") return `prototype-only:${btoa(pin)}`;
  return `prototype-only:${Buffer.from(pin).toString("base64")}`;
}

export function verifyPrototypePin(pin: string, hash: string): boolean {
  return prototypeHashPin(pin) === hash;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
