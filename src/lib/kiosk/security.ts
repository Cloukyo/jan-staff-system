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
    locked: "PIN not recognised. Please try again or ask a manager for help.",
    reset_required: "A manager must set or reset your kiosk PIN.",
    change_required: "Choose your own private PIN before clocking in.",
    change_not_required: "This PIN no longer needs to be changed. Start again.",
    weak_pin: "Choose a less predictable PIN.",
    same_pin: "Your new PIN must be different from the temporary PIN.",
    pin_changed: "Your private PIN has been saved.",
    unavailable: "Kiosk access is not available for this staff member.",
    already_clocked_in: "You are already clocked in.",
    not_clocked_in: "You cannot clock out because no open shift was found.",
    too_soon: "Please wait a few seconds before trying again.",
    invalid_event: "That clock action is not valid.",
    recorded: "Attendance recorded.",
  };
  return messages[code] ?? "The kiosk request could not be completed.";
}
