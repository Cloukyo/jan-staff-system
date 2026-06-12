export function validatePrivatePassword(password: string, email: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Include uppercase, lowercase, a number and a symbol.";
  }
  const emailName = email.split("@")[0]?.toLowerCase();
  if (emailName && emailName.length >= 4 && password.toLowerCase().includes(emailName)) return "Do not include your email name in the password.";
  return null;
}
