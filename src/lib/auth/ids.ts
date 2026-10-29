/**
 * Anonymous visitor sessions are identified by a stable, cookie-derived id with
 * this prefix. They are not accounts: no password exists, no email is visible,
 * and their run history stays in the browser.
 */
export const ANONYMOUS_USER_ID_PREFIX = "anon_";

export function isAnonymousUserId(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith(ANONYMOUS_USER_ID_PREFIX);
}
