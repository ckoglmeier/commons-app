const publicRoutes = new Set(['/support', '/legal/privacy', '/legal/terms']);

/** Only route shapes and explicitly approved scalar properties leave Commons. */
export function analyticsRoute(path: string): string | null {
  const pathname = path.split(/[?#]/)[0];
  if (/^\/(auth|join|invite|sign-in|account|admin|api)(\/|$)/.test(pathname)) return null;
  if (publicRoutes.has(pathname.replace(/\/$/, ''))) return pathname.replace(/\/$/, '');
  if (pathname === '/' || /^\/(new|trips)\/?$/.test(pathname)) return pathname.replace(/\/$/, '') || '/';
  if (/^\/c\/[^/]+\/(plan|money|photos)\/?$/.test(pathname)) return pathname.replace(/^\/c\/[^/]+/, '/c/[trip]').replace(/\/$/, '');
  if (/^\/c\/[^/]+\/?$/.test(pathname)) return '/c/[trip]';
  if (/^\/polls?\/[^/]+\/?$/.test(pathname)) return '/poll/[poll]';
  return null;
}

