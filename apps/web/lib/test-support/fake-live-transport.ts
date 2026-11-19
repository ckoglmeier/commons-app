/**
 * Test-only fakes for the browser voice transport: microphone, WebRTC peer,
 * data channel, audio element and the Live session start endpoint. No real
 * media or provider connection is created.
 */
export class FakeDataChannel extends EventTarget {
  readyState: "connecting" | "open" | "closed" = "open";
  sent: Array<Record<string, unknown>> = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  /** Deliver one server event exactly as the Live data channel would. */
  emit(event: Record<string, unknown>) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); }
}

export class FakeTrack {
  stopped = false;
  /** `false` = muted (the browser sends silence). */
  enabled = true;
  onended: (() => void) | null = null;
  stop() { this.stopped = true; }
}

export class FakeMediaStream {
  tracks = [new FakeTrack()];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

export type FakeLiveEnvironment = ReturnType<typeof installFakeLiveEnvironment>;

/**
 * Installs window/navigator/RTCPeerConnection/Audio fakes. `holdMicrophone`
 * keeps getUserMedia pending until `releaseMicrophone()` so tests can close a
 * session while it is still connecting.
 */
export function installFakeLiveEnvironment(options: {
  holdMicrophone?: boolean;
  /** Keep the Live session start request pending until `releaseLive()` (the organizer closes while the connection is being made). */
  holdLive?: boolean; liveFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** getUserMedia rejects with a DOMException of this name (for example NotAllowedError). */
  microphoneError?: string;
  /** audio.play() rejects, like a browser that blocked autoplay. */
  playbackBlocked?: boolean;
  /** Fail the Live session start with this HTTP status and error text. */
  liveFailure?: { status: number; error: string };
  /** Network address gathering never finishes (`iceGatheringState` stays "gathering"), like a network that never yields candidates. */
  holdIce?: boolean;
  /** Page path the fake window reports. Analytics stay silent on /join/ and /auth/ paths (the default); use a trip path to observe events. */
  pathname?: string;
} = {}) {
  const peers: FakePeer[] = [];
  const streams: FakeMediaStream[] = [];
  const liveRequests: string[] = [];
  const liveBodies: Array<Record<string, unknown>> = [];
  const audios: Array<{ played: number; srcObject: unknown }> = [];
  let releaseMicrophone: () => void = () => {};
  let releaseLive: () => void = () => {};
  class FakePeer {
    closed = false;
    iceGatheringState = options.holdIce ? "gathering" : "complete";
    connectionState = "new";
    localDescription: { type: string; sdp: string } | null = null;
    channel: FakeDataChannel | null = null;
    ontrack: unknown = null;
    onconnectionstatechange: unknown = null;
    constructor() { peers.push(this); }
    tracksAdded = 0;
    addTrack() { this.tracksAdded += 1; }
    /** Drive `onconnectionstatechange` like the browser does. */
    setConnectionState(state: string) { this.connectionState = state; (this.onconnectionstatechange as (() => void) | null)?.(); }
    /** Deliver the remote audio stream (the coordinator's voice). */
    deliverRemoteAudio() { (this.ontrack as ((event: { streams: unknown[] }) => void) | null)?.({ streams: [{ id: "remote" }] }); }
    createDataChannel() { this.channel = new FakeDataChannel(); return this.channel; }
    async createOffer() { return { type: "offer", sdp: "v=0 synthetic-offer" }; }
    async setLocalDescription(description: { type: string; sdp: string }) { this.localDescription = description; }
    async setRemoteDescription() {}
    addEventListener() {}
    removeEventListener() {}
    close() { this.closed = true; if (this.channel) this.channel.readyState = "closed"; }
  }
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
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    RTCPeerConnection: Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection"),
    Audio: Object.getOwnPropertyDescriptor(globalThis, "Audio"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
    fetch: globalThis.fetch,
  };
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", fakeWindow);
  define("localStorage", sessionStorage);
  if (options.pathname) define("document", { referrer: "", cookie: "", querySelector: () => null });
  define("requestAnimationFrame", fakeWindow.requestAnimationFrame);
  define("cancelAnimationFrame", fakeWindow.cancelAnimationFrame);
  define("navigator", {
    mediaDevices: {
      getUserMedia: async () => {
        if (options.microphoneError) throw new DOMException("blocked", options.microphoneError);
        if (options.holdMicrophone) await new Promise<void>(resolve => { releaseMicrophone = resolve; });
        const stream = new FakeMediaStream();
        streams.push(stream);
        return stream;
      },
    },
  });
  define("RTCPeerConnection", FakePeer);
  define("Audio", class {
    autoplay = false; srcObject: unknown = null; played = 0;
    constructor() { audios.push(this); }
    play() { this.played += 1; return options.playbackBlocked ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : Promise.resolve(); }
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/coordinator/live")) {
      liveRequests.push(url);
      liveBodies.push(JSON.parse(String(init?.body ?? "{}")));
      if (options.holdLive) await new Promise<void>(resolve => { releaseLive = resolve; });
      if (options.liveFailure) return new Response(JSON.stringify({ error: options.liveFailure.error }), { status: options.liveFailure.status });
      return new Response(JSON.stringify({ session: { id: "live-synthetic" }, transport: { type: "webrtc", sdp: "v=0 synthetic-answer" } }), { status: 201 });
    }
    if (options.liveFetch) return options.liveFetch(url, init);
    throw new Error(`Unexpected fetch in voice test: ${url}`);
  }) as typeof fetch;
  return {
    peers, streams, liveRequests, liveBodies, audios,
    releaseMicrophone: () => releaseMicrophone(),
    releaseLive: () => releaseLive(),
    get channel() { return peers.at(-1)?.channel ?? null; },
    restore() {
      globalThis.fetch = previousFetch ?? originals.fetch;
      for (const [name, descriptor] of Object.entries(originals)) {
        if (name === "fetch") continue;
        if (descriptor) Object.defineProperty(globalThis, name, descriptor as PropertyDescriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

export function settle(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
