const blockedPins = new Set(["0000", "1111", "1234", "4321", "0123", "9999"]);

export function validateKioskPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "Use four to six digits.";
  if (blockedPins.has(pin) || /^(\d)\1+$/.test(pin)) return "Choose a less predictable PIN.";
  const numeric = Number(pin);
  if (pin.length === 4 && numeric >= 1900 && numeric <= 2099) return "Do not use a birth year.";
  return null;
}

export function kioskResultMessage(code: string): string {
  const messages: Record<string, string> = {
    invalid_pin: "PIN not recognised. Please try again.",
    locked: "Too many attempts. Please wait 15 minutes or ask a manager for help.",
    reset_required: "A manager must set or reset your kiosk PIN.",
    unavailable: "Kiosk access is not available for this staff member.",
    already_clocked_in: "You are already clocked in.",
    not_clocked_in: "You cannot clock out because no open shift was found.",
    too_soon: "Please wait a few seconds before trying again.",
    invalid_event: "That clock action is not valid.",
    recorded: "Attendance recorded.",
  };
  return messages[code] ?? "The kiosk request could not be completed.";
}
