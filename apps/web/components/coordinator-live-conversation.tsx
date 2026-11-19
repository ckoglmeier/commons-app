"use client";

import { useEffect, useRef, useState } from "react";
import { MicrophoneIcon } from "./icons";
import { trackProductEvent } from "@/lib/product-analytics";
import {
  DelegationQueue, delegationOutcomeFields, elapsedMs, isFillerCaption, isRetryableDelegation, nextCaption, spokenDelegationOutcome, voiceRequestFrom,
  type Caption, type LiveTranscriptFragment, type VoiceDelegateOutcome, type VoiceDelegation,
} from "@/lib/coordinator-live";

/**
 * Voice conversation with the coordinator (design section 10).
 *
 * The speaking model (GPT-Live) only listens and talks. Everything about the trip is delegated: each `session.delegation.created` becomes
 * one request that goes through the Workspace's ordinary turn path (`onDelegate`), and the result is spoken back as structured commentary.
 * Event names and session fields follow the OpenAI GPT-Live guides (see the Stage 6 entry in the stage log for the URLs and what could not
 * be verified). GPT-Live has no speech-started/stopped, transcript-completed or response-lifecycle events, so "Responding" is derived
 * from output transcript activity.
 */

type LivePhase = "idle" | "ready" | "connecting" | "listening" | "ended" | "error";
type LiveEvent = {
  type?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  reason?: string;
  delegation?: { id?: string; target?: string };
  error?: { code?: string; message?: string; client_event_id?: string };
};
type Job = VoiceDelegation;
type DelegationRecord = { job: Job | null; commandId: string; state: "waiting" | "queued" | "running" | "done" | "retry" };

/** Waits and limits. Mutable only so tests can shorten them. */
export const voiceTiming = {
  /** After a delegation event, wait for late transcript deltas before reading the request. */
  transcriptSettleMs: 240,
  /**
   * When no words have arrived yet, keep looking this long before asking the organizer to repeat. The first utterance of a session is often
   * transcribed late (live, September 30: the first request was always "I didn't catch that"); later ones arrive within the settle time.
   */
  transcriptWaitMs: 2_400,
  /** How often to look again while waiting for late words. */
  transcriptRetryMs: 200,
  /** Ask GPT-Live to close and wait for `session.closed` this long before releasing the connection. */
  closeWaitMs: 1_500,
  /** No output transcript for this long means the coordinator has stopped speaking. */
  respondingIdleMs: 1_600,
  /** A settled coordinator caption is announced to assistive technology after this quiet time. */
  announceSettleMs: 1_200,
  /** `disconnected` can recover on its own; wait this long before calling the connection lost. */
  reconnectGraceMs: 8_000,
  /** The session never reported `session.started`. */
  connectTimeoutMs: 25_000,
  /** Network address gathering never finished; the offer cannot be sent, so the start fails with an honest message and everything is released. */
  iceGatherMs: 8_000,
};

const WORKING_LABEL_LIMIT = 60;
const bounded = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;

export function CoordinatorLiveConversation({
  available,
  disabled,
  coordinatorName,
  slug,
  onDelegate,
  activeThreadId = null,
  startReady = false,
  workspaceActive = true,
}: {
  workspaceActive?: boolean;
  available: boolean;
  disabled: boolean;
  coordinatorName: string;
  slug: string;
  /** One delegated request. Called through a ref that is refreshed every render, so it always sees the latest thread, version and draft state. */
  onDelegate: (request: VoiceDelegation) => Promise<VoiceDelegateOutcome>;
  /** The Workspace's active thread when the session starts; the server validates it and tells the speaking model its title. Null = a new conversation. */
  activeThreadId?: string | null;
  /** Open the dialog ready to start (the Home voice entry). The microphone stays off until the organizer taps Start. */
  startReady?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const requestAbort = useRef<AbortController | null>(null);
  /** Incremented on start, end, close, error, pagehide and unmount. Every `await` in start() re-checks it, so a late startup never reopens a closed session. */
  const generation = useRef(0);
  const sessionId = useRef<string | null>(null);
  const started = useRef(false);
  const ending = useRef(false);
  const endedTracked = useRef(false);
  const phaseRef = useRef<LivePhase>("idle");
  const fragments = useRef<LiveTranscriptFragment[]>([]);
  const boundaryMs = useRef(0);
  const delegations = useRef(new Map<string, DelegationRecord>());
  const queue = useRef<DelegationQueue<Job> | null>(null);
  const commentaryIds = useRef(new Set<string>());
  const closeWaiter = useRef<(() => void) | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const respondingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionRef = useRef<Caption | null>(null);
  const delegateRef = useRef(onDelegate);
  const threadRef = useRef(activeThreadId);
  const [phase, setPhaseState] = useState<LivePhase>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [caption, setCaption] = useState<Caption | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [working, setWorking] = useState<{ label: string; waiting: number } | null>(null);
  const [responding, setResponding] = useState(false);
  const [muted, setMuted] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  // The latest callback and thread, every render: a data-channel listener created at session start must not run the render it was created in.
  useEffect(() => { delegateRef.current = onDelegate; threadRef.current = activeThreadId; });

  function setPhase(next: LivePhase) { phaseRef.current = next; setPhaseState(next); }
  function later(callback: () => void, ms: number) {
    const handle = setTimeout(() => { timers.current.delete(handle); callback(); }, ms);
    timers.current.add(handle);
    return handle;
  }
  function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }) { if (ref.current) clearTimeout(ref.current); ref.current = null; }
  function announce(text: string) { setAnnouncement(text); }

  /** Stop the microphone, close the connection, forget in-flight startup. Idempotent. */
  function release() {
    requestAbort.current?.abort();
    requestAbort.current = null;
    microphone.current?.getTracks().forEach(track => track.stop());
    microphone.current = null;
    peer.current?.close();
    peer.current = null;
    channel.current = null;
    if (audio.current) { audio.current.srcObject = null; audio.current = null; }
    for (const handle of timers.current) clearTimeout(handle);
    timers.current.clear();
    clearTimer(respondingTimer); clearTimer(announceTimer); clearTimer(reconnectTimer); clearTimer(connectTimer);
    // Work that has not started saved nothing and is dropped; the request already running finishes and lands in the thread.
    queue.current?.close();
    closeWaiter.current?.();
    closeWaiter.current = null;
  }
  /** Invalidate any startup or event still in flight, then release. */
  function shutDown() { generation.current += 1; release(); }
  function resetView() {
    setError(""); setNotice(""); setCaption(null); setAnnouncement(""); setWorking(null); setResponding(false); setMuted(false); setReconnecting(false); setPlaybackBlocked(false);
    captionRef.current = null;
  }

  useEffect(() => {
    const hide = () => { if (phaseRef.current === "connecting" || phaseRef.current === "listening") { shutDown(); setPhase("ended"); } };
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("pagehide", hide); shutDown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registered once; every function it calls reads refs only.
  }, []);
  useEffect(() => {
    if (workspaceActive) return;
    shutDown();
    dialog.current?.close();
    phaseRef.current = "idle";
    const frame = requestAnimationFrame(() => setPhaseState("idle"));
    return () => cancelAnimationFrame(frame);
    // Cleanup reads resource refs; inactivity also invalidates delayed microphone/session startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceActive]);
  useEffect(() => {
    if (!startReady || !available || !workspaceActive) return;
    const frame = requestAnimationFrame(() => {
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
      setPhaseState(value => { const next = value === "idle" ? "ready" : value; phaseRef.current = next; return next; });
    });
    return () => cancelAnimationFrame(frame);
  }, [startReady, available, workspaceActive]);
  // Keep keyboard focus on the one primary control while the dialog changes state (Start, End, Try again, Done).
  useEffect(() => { if (phase !== "idle" && dialog.current?.open) primary.current?.focus(); }, [phase]);

  function sendLiveEvent(event: Record<string, unknown>) {
    if (channel.current?.readyState === "open") { channel.current.send(JSON.stringify(event)); return true; }
    return false;
  }
  /** The result, spoken back through GPT-Live under the delegation's id. Nothing is sent once the session is gone. */
  function speak(delegationId: string, content: string) {
    const eventId = crypto.randomUUID();
    commentaryIds.current.add(eventId);
    if (commentaryIds.current.size > 50) commentaryIds.current.delete(commentaryIds.current.values().next().value as string);
    sendLiveEvent({ type: "session.commentary.append", event_id: eventId, delegation_id: delegationId, content });
  }

  function showCaption(speaker: Caption["speaker"], delta: string, startMs: number | undefined, endMs: number | undefined) {
    const next = nextCaption(captionRef.current, speaker, delta, startMs, endMs);
    captionRef.current = next;
    setCaption(next);
    if (speaker === "coordinator") {
      setResponding(true);
      clearTimer(respondingTimer);
      respondingTimer.current = later(() => setResponding(false), voiceTiming.respondingIdleMs);
      // Announce a caption once it has settled, and never a backchannel; the visible caption itself is not a live region.
      clearTimer(announceTimer);
      announceTimer.current = later(() => { const latest = captionRef.current; if (latest?.speaker === "coordinator" && !isFillerCaption(latest.text)) announce(latest.text); }, voiceTiming.announceSettleMs);
    } else setResponding(false);
  }

  // ----- delegations ------------------------------------------------------------------------------------------------------------------

  function refreshWorking() {
    const running = queue.current?.running;
    setWorking(running ? { label: bounded(running.text, WORKING_LABEL_LIMIT), waiting: queue.current?.waitingCount ?? 0 } : null);
  }

  async function runJob(job: Job, token: number) {
    if (token !== generation.current) return;
    const record = delegations.current.get(job.delegationId);
    if (record) record.state = "running";
    const startedAt = elapsedMs();
    let outcome: VoiceDelegateOutcome;
    try { outcome = await delegateRef.current(job); } catch { outcome = { kind: "unconfirmed" }; }
    const latencyMs = elapsedMs() - startedAt;
    if (record) record.state = isRetryableDelegation(outcome) ? "retry" : "done";
    // Correlated, content-free: ids, latency, outcome and error code only. Never the request, the reply or any audio.
    trackProductEvent("coordinator_voice_delegated", { commonsSlug: slug, properties: {
      inputMode: "voice", sessionId: job.sessionId, delegationId: job.delegationId, commandId: job.commandId, delegationLatencyMs: latencyMs,
      ...(Object.fromEntries(Object.entries(delegationOutcomeFields(outcome)).filter(([, value]) => value !== null)) as Record<string, string | number | boolean>),
    } });
    // The session ended while Commons worked: the answer is saved in the thread, and there is nobody to speak it to.
    if (token !== generation.current || ending.current) return;
    speak(job.delegationId, spokenDelegationOutcome(outcome, { truncated: job.truncated }));
  }

  function delegationCreated(event: LiveEvent, token: number) {
    const id = event.delegation?.id;
    if (!id || event.delegation?.target !== "client" || ending.current) return;
    const known = delegations.current.get(id);
    // A re-delivered event never becomes a second turn. Only a delegation whose outcome was unknown runs again, with the same command id, so the server replays it.
    if (known && known.state !== "retry") return;
    if (known?.state === "retry" && known.job) { known.state = "queued"; submit(known.job, id); return; }
    delegations.current.set(id, { job: null, commandId: crypto.randomUUID(), state: "waiting" });
    const offset = event.offset_ms ?? Number.MAX_SAFE_INTEGER;
    // The event carries no text; transcript deltas trail it slightly, so read the request after a short wait.
    later(() => intake(id, offset, token), voiceTiming.transcriptSettleMs);
  }

  function intake(id: string, offset: number, token: number, waitedMs = 0) {
    if (token !== generation.current || ending.current) return;
    const record = delegations.current.get(id);
    if (!record) return;
    let request = voiceRequestFrom(fragments.current, boundaryMs.current, offset);
    // Late words: look again before giving up. Requests run one at a time, so waiting never merges two of them.
    if (!request.text && waitedMs < voiceTiming.transcriptWaitMs) {
      later(() => intake(id, offset, token, waitedMs + voiceTiming.transcriptRetryMs), voiceTiming.transcriptRetryMs);
      return;
    }
    // Still nothing inside the delegation's window, but speech since the last request exists: its timestamps do not line up with the delegation's
    // offset (the two clocks are not documented to match). That unclaimed speech is this request.
    if (!request.text) request = voiceRequestFrom(fragments.current, boundaryMs.current, Number.MAX_SAFE_INTEGER);
    if (!request.text) {
      record.state = "done";
      speak(id, spokenDelegationOutcome({ kind: "notice", notice: "unheard" }));
      return;
    }
    if (request.boundaryMs !== null) boundaryMs.current = Math.max(boundaryMs.current, request.boundaryMs);
    const job: Job = { text: request.text, truncated: request.truncated, delegationId: id, sessionId: sessionId.current ?? "unknown", commandId: record.commandId };
    record.job = job;
    record.state = "queued";
    submit(job, id);
  }

  function submit(job: Job, id: string) {
    const placed = queue.current?.submit(job);
    if (placed === "overflow") {
      const record = delegations.current.get(id);
      if (record) record.state = "done";
      speak(id, spokenDelegationOutcome({ kind: "notice", notice: "busy" }));
      trackProductEvent("coordinator_voice_delegated", { commonsSlug: slug, properties: { inputMode: "voice", sessionId: job.sessionId, delegationId: id, commandId: job.commandId, outcome: "queue_full", queued: false } });
    }
  }

  // ----- session events ---------------------------------------------------------------------------------------------------------------

  function handleEvent(message: MessageEvent<string>, token: number) {
    // A late event from a closed or replaced session is ignored outright.
    if (token !== generation.current) return;
    let event: LiveEvent;
    try { event = JSON.parse(message.data) as LiveEvent; } catch { return; }
    if (event.type === "session.started") {
      started.current = true;
      clearTimer(connectTimer);
      setPhase("listening");
      announce("Listening.");
      trackProductEvent("coordinator_voice_started", { commonsSlug: slug, properties: { inputMode: "voice", sessionId: sessionId.current ?? "unknown" } });
    } else if (event.type === "session.input_transcript.delta" && event.delta) {
      fragments.current.push({ delta: event.delta, startMs: event.start_ms ?? 0, endMs: event.end_ms ?? event.start_ms ?? 0 });
      if (fragments.current.length > 400) fragments.current.splice(0, fragments.current.length - 400);
      showCaption("you", event.delta, event.start_ms, event.end_ms);
    } else if (event.type === "session.output_transcript.delta" && event.delta) {
      showCaption("coordinator", event.delta, event.start_ms, event.end_ms);
    } else if (event.type === "session.delegation.created") {
      delegationCreated(event, token);
    } else if (event.type === "session.closed") {
      finishFromServer(event.reason);
    } else if (event.type === "error") {
      // Per the GPT-Live guides an error event can accompany a live session (moderation cutting off speech, a rejected command), so it is not fatal.
      const failedCommand = event.error?.client_event_id && commentaryIds.current.has(event.error.client_event_id);
      setNotice(failedCommand ? "Commons couldn’t speak that result. Its answer is saved in the thread." : "Voice hit a problem with the last reply. Captions may be incomplete. You can keep talking or end the conversation.");
      trackProductEvent("coordinator_voice_failed", { commonsSlug: slug, properties: { inputMode: "voice", sessionId: sessionId.current ?? "unknown", ...(event.error?.code && /^[a-z_]{1,40}$/.test(event.error.code) ? { errorCode: event.error.code } : {}) } });
    }
  }

  /** `session.closed` arrived: our own close request, or the session ended on its own. */
  function finishFromServer(reason: string | undefined) {
    const requested = ending.current;
    closeWaiter.current?.();
    closeWaiter.current = null;
    shutDown();
    if (requested || reason === "close_requested" || reason === "remote_hangup") { if (phaseRef.current !== "idle") setPhase("ended"); trackEnded(); return; }
    if (reason === "connection_lost") { fail("The voice connection was lost. Requests already sent are still saved in the thread, and nothing will be repeated. Start again to keep talking."); return; }
    setNotice(reason === "expired" ? "The voice session reached its time limit and ended." : reason === "content" ? "The voice session was stopped by a safety filter and ended." : "The voice session ended.");
    setPhase("ended");
    trackEnded();
  }

  function trackEnded() {
    if (endedTracked.current) return;
    endedTracked.current = true;
    trackProductEvent("coordinator_voice_ended", { commonsSlug: slug, properties: { inputMode: "voice", sessionId: sessionId.current ?? "unknown" } });
  }

  function fail(message: string, errorCode?: string) {
    shutDown();
    setError(message);
    setPhase("error");
    trackProductEvent("coordinator_voice_failed", { commonsSlug: slug, properties: { inputMode: "voice", sessionId: sessionId.current ?? "unknown", ...(errorCode ? { errorCode } : {}) } });
  }

  /** Resolves true when network address gathering finished (or the session went stale), false when it did not finish in time. */
  async function waitForIce(connection: RTCPeerConnection, stale: () => boolean) {
    if (connection.iceGatheringState === "complete") return true;
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (finished: boolean) => {
        connection.removeEventListener("icegatheringstatechange", complete);
        if (timer) clearTimeout(timer);
        resolve(finished);
      };
      const complete = () => { if (connection.iceGatheringState === "complete" || stale()) settle(true); };
      connection.addEventListener("icegatheringstatechange", complete);
      timer = setTimeout(() => settle(stale()), voiceTiming.iceGatherMs);
    });
  }

  async function start() {
    if (!workspaceActive) return;
    const token = generation.current + 1;
    generation.current = token;
    release();
    const stale = () => token !== generation.current;
    resetView();
    started.current = false; ending.current = false; endedTracked.current = false;
    sessionId.current = null;
    fragments.current = []; boundaryMs.current = 0;
    delegations.current.clear(); commentaryIds.current.clear();
    queue.current = new DelegationQueue<Job>(job => runJob(job, token), refreshWorking);
    setPhase("connecting");
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    let stream: MediaStream | null = null, connection: RTCPeerConnection | null = null;
    const discard = () => { stream?.getTracks().forEach(track => track.stop()); connection?.close(); };
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") throw new Error("unsupported");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stale()) { discard(); return; }
      microphone.current = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("no_microphone");
      track.onended = () => { if (!stale() && !ending.current) fail("The microphone stopped. Check that it is connected, then start again."); };
      connection = new RTCPeerConnection();
      const live = connection;
      peer.current = live;
      live.addTrack(track, stream);
      const speaker = new Audio();
      speaker.autoplay = true;
      audio.current = speaker;
      live.ontrack = event => {
        if (stale() || audio.current !== speaker) return;
        speaker.srcObject = event.streams[0];
        // Autoplay can be blocked; captions keep working and the organizer can start playback.
        void Promise.resolve(speaker.play?.()).catch(() => { if (!stale()) setPlaybackBlocked(true); });
      };
      live.onconnectionstatechange = () => {
        if (stale()) return;
        if (live.connectionState === "connected") { clearTimer(reconnectTimer); setReconnecting(false); }
        else if (live.connectionState === "disconnected") {
          // Often transient. Say so, give it a moment to recover, and never claim more than that.
          setReconnecting(true);
          clearTimer(reconnectTimer);
          reconnectTimer.current = setTimeout(() => { if (!stale()) fail("The voice connection was lost. Requests already sent are still saved in the thread, and nothing will be repeated. Start again to keep talking."); }, voiceTiming.reconnectGraceMs);
        } else if (live.connectionState === "failed") fail("The voice connection failed. Requests already sent are still saved in the thread, and nothing will be repeated. Start again to keep talking.");
      };
      const data = live.createDataChannel("oai-events");
      channel.current = data;
      data.addEventListener("message", message => handleEvent(message as MessageEvent<string>, token));
      data.addEventListener("close", () => { if (!stale() && !ending.current && phaseRef.current === "listening") fail("The voice channel closed. Requests already sent are still saved in the thread. Start again to keep talking."); });
      const offer = await live.createOffer();
      if (stale()) { discard(); return; }
      await live.setLocalDescription(offer);
      if (stale()) { discard(); return; }
      const gathered = await waitForIce(live, stale);
      if (stale()) { discard(); return; }
      if (!gathered) throw new Error("ice_timeout");
      const abort = new AbortController();
      requestAbort.current = abort;
      const response = await fetch(`/api/v1/commons/${slug}/coordinator/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: live.localDescription?.sdp, threadId: threadRef.current }),
        signal: abort.signal,
      });
      const result = await response.json().catch(() => null) as { error?: string; session?: { id?: string }; transport?: { sdp?: string } } | null;
      if (stale()) { discard(); return; }
      if (!response.ok || !result?.transport?.sdp) throw new Error(typeof result?.error === "string" && result.error.length <= 200 ? result.error : "Voice conversation could not start.");
      sessionId.current = result.session?.id ?? null;
      await live.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      if (stale()) { discard(); return; }
      connectTimer.current = setTimeout(() => { if (!stale() && !started.current) fail("Voice didn’t connect. Check your connection, then try again."); }, voiceTiming.connectTimeoutMs);
    } catch (cause) {
      // A session that was closed while starting has nothing to report and nothing left running.
      if (stale()) { discard(); return; }
      const name = cause instanceof DOMException || (cause instanceof Error && "name" in cause) ? (cause as Error).name : "";
      if (cause instanceof Error && cause.message === "ice_timeout") { discard(); fail("Voice couldn’t connect to the network in time. Check your connection, then try again. Nothing was started.", "ice_timeout"); return; }
      const denied = ["NotAllowedError", "SecurityError"].includes(name);
      const missing = ["NotFoundError", "OverconstrainedError"].includes(name) || (cause instanceof Error && cause.message === "no_microphone");
      fail(denied ? "Microphone access was not allowed. Allow microphone access for Commons in your browser settings, then try again. Nothing was started."
        : missing ? "No microphone was found. Connect one, then try again."
        : cause instanceof Error && cause.message !== "unsupported" ? cause.message : "Voice conversation is not supported in this browser. You can still type.", denied ? "microphone_denied" : missing ? "microphone_missing" : undefined);
    }
  }

  async function end() {
    if (ending.current) return;
    ending.current = true;
    // This end belongs to the session that is running now. If a new session starts while it waits (End, Close, then Talk), it must not touch that one.
    const token = generation.current;
    if (started.current && channel.current?.readyState === "open") {
      // Ask GPT-Live to close, and keep the connection until it says so (or the wait runs out).
      const closed = new Promise<void>(resolve => { closeWaiter.current = resolve; });
      sendLiveEvent({ type: "session.close", event_id: crypto.randomUUID() });
      await Promise.race([closed, new Promise<void>(resolve => setTimeout(resolve, voiceTiming.closeWaitMs))]);
    }
    if (generation.current !== token) return;
    shutDown();
    // The dialog may have been closed while waiting: it stays closed and idle.
    if (phaseRef.current !== "idle") setPhase("ended");
    trackEnded();
  }

  async function close() {
    if (["connecting", "listening"].includes(phaseRef.current)) await end();
    dialog.current?.close();
    setPhase("idle");
    resetView();
    // Return keyboard focus to the Talk control once it is enabled again.
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function toggleMute() {
    const track = microphone.current?.getAudioTracks()[0];
    if (!track) return;
    const next = !muted;
    track.enabled = !next;
    setMuted(next);
    announce(next ? "Microphone muted." : "Microphone on.");
  }

  function playAudio() {
    void Promise.resolve(audio.current?.play?.()).then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
  }

  if (!available) return null;
  const live = phase === "connecting" || phase === "listening";
  const status = phase === "ready" ? "Ready. Your microphone is off until you start."
    : phase === "connecting" ? "Connecting…"
    : phase === "ended" ? "Conversation ended"
    : phase === "error" ? "Voice stopped"
    : reconnecting ? "Connection lost. Trying to reconnect…"
    : working ? `Working on “${working.label}”${working.waiting ? ` · ${working.waiting} waiting` : ""}`
    : responding ? "Responding"
    : muted ? "Microphone muted. Commons can’t hear you."
    : phase === "listening" ? "Listening" : "Voice beta";
  const active = phase === "listening" && !muted;
  const primaryLabel = live ? "End conversation" : phase === "ready" ? "Start conversation" : phase === "error" ? "Try again" : "Done";
  return <>
    <button ref={trigger} type="button" className="workspace-voice-start" onClick={() => void start()} disabled={disabled || phase === "connecting"} aria-label={`Talk with ${coordinatorName}`} title="Talk it through"><MicrophoneIcon /><span>Talk</span></button>
    <dialog ref={dialog} className="workspace-voice-dialog" aria-labelledby="workspace-voice-title" onCancel={event => { event.preventDefault(); void close(); }}>
      <header><div><span className="review-caption">VOICE BETA · ORGANIZERS ONLY</span><h2 id="workspace-voice-title">Talk with {coordinatorName}</h2></div><button type="button" className="cm-action" onClick={() => void close()}>Close</button></header>
      <div className="workspace-voice-body">
        <p className="workspace-voice-status"><span aria-hidden="true" data-active={active || Boolean(working)} />{status}</p>
        {error ? <p className="workspace-error" role="alert">{error}</p> : null}
        {notice ? <p className="workspace-voice-notice">{notice}</p> : null}
        {playbackBlocked ? <p className="workspace-voice-notice">Your browser blocked audio playback, so you can’t hear {coordinatorName}. Captions still work. <button type="button" className="cm-action" onClick={playAudio}>Play audio</button></p> : null}
        {caption ? <p className="workspace-voice-caption" data-speaker={caption.speaker}><strong>{caption.speaker === "you" ? "You" : coordinatorName}</strong> {caption.text}</p> : null}
        {phase === "ready" ? <p>This starts a new conversation with {coordinatorName}. Anything you have typed stays in the message box and is not sent by voice.</p> : null}
        {!caption && phase === "listening" && !reconnecting ? <p>Start talking. {coordinatorName} uses the trip’s saved details and hands each request to Commons.</p> : null}
        <p className="review-caption">Commons saves only the requests it works on, and its answers, in the organizer thread. It does not save a recording or a full transcript. Proposed changes still need your review and approval on screen before anything changes or is shared.</p>
        <p className="workspace-voice-live" aria-live="polite" aria-atomic="true">{announcement}</p>
      </div>
      <footer>
        <button ref={primary} type="button" className="cm-action cm-action--primary" onClick={() => void (phase === "ended" ? close() : live ? end() : start())}>{primaryLabel}</button>
        {live ? <button type="button" className="cm-action" aria-pressed={muted} onClick={toggleMute}>Mute microphone</button> : null}
      </footer>
    </dialog>
  </>;
}
