/**
 * Test-only browser shim for component tests: a fake `window` (timers, storage, location), an optional `document`, and a `fetch`
 * the test controls. Nothing touches the network.
 */
export type FakeBrowserEnvironment = ReturnType<typeof installFakeBrowserEnvironment>;

export function installFakeBrowserEnvironment(options: {
  /** Handles every fetch the component makes. Unhandled requests throw so a test never reaches the network. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Page path the fake window reports. Analytics stay silent on /join/ and /auth/ paths (the default); use a trip path to observe events. */
  pathname?: string;
} = {}) {
  const windowTarget = new EventTarget();
  const storage = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const fakeWindow = Object.assign(windowTarget, {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    requestAnimationFrame: (callback: (time: number) => void) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (handle: number) => globalThis.clearTimeout(handle),
    // Analytics deliberately no-op on /join/ paths; tests never send analytics.
    location: { pathname: options.pathname ?? "/join/synthetic-test", search: "", hostname: "localhost" },
    history: { replaceState: () => {} },
    confirm: () => true,
    sessionStorage, localStorage: sessionStorage,
    innerWidth: 390,
  });
  const originals = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
  };
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", fakeWindow);
  define("localStorage", sessionStorage);
  if (options.pathname) define("document", { referrer: "", cookie: "", querySelector: () => null });
  define("requestAnimationFrame", fakeWindow.requestAnimationFrame);
  define("cancelAnimationFrame", fakeWindow.cancelAnimationFrame);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (options.fetch) return options.fetch(url, init);
    throw new Error(`Unexpected fetch in component test: ${url}`);
  }) as typeof fetch;
  return {
    restore() {
      globalThis.fetch = previousFetch;
      for (const [name, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor as PropertyDescriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

export function settle(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
