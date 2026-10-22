/** Password rules shared by the forms (client) and lib/password.ts (server). */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** Italian message for a password that cannot be used, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `La password può avere al massimo ${PASSWORD_MAX_LENGTH} caratteri.`;
  }
  if (/^\s|\s$/.test(password)) return "La password non può iniziare o finire con uno spazio.";
  return null;
}
