export type AuthIntent = "sign-in" | "create" | "invited" | "access";

const RESOLVE_AGAINST = "https://commons.invalid";
const STARTS_LIKE_ANOTHER_HOST = /^\/[/\\]/;

/**
 * The path to send someone to after signing in, or "/" if it could leave Commons. Browsers treat a backslash as a slash and drop tabs and newlines, so
 * `/\evil.example` and `/<tab>/evil.example` both mean another site. Checking the start of the text isn't enough: the value is resolved the way a browser
 * would, and the path must also stay local after dot segments and one round of decoding, in case something later in the chain normalizes it.
 */
export function safeAuthNext(value: string | null | undefined) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what's being refused
  if (!value?.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const { origin, pathname } = new URL(value, RESOLVE_AGAINST);
    if (origin !== RESOLVE_AGAINST || STARTS_LIKE_ANOTHER_HOST.test(pathname) || STARTS_LIKE_ANOTHER_HOST.test(decodeURIComponent(pathname))) return "/";
  } catch {
    return "/";
  }
  return value;
}

export function hasCompletedAccountName(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("first_name" in metadata)) return false;
  return typeof metadata.first_name === "string" && metadata.first_name.trim().length > 0;
}

export function accountCreationPath(next: string, intent: AuthIntent = "sign-in") {
  const params = new URLSearchParams({ next: safeAuthNext(next), intent });
  return `/account/create?${params.toString()}`;
}
