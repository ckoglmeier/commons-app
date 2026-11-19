"use client";

import { useRef, useState } from "react";

/**
 * Two steps on one form: send a code, enter it. Verifying a number never turns on texts. Everything typed survives a failure, and the number stays
 * editable until a code goes out.
 */
export function PhoneVerification({ initialPhone = "", submitLabel = "Text me a code", onVerified, onCancel, onCodeSent }: { initialPhone?: string; submitLabel?: string; onVerified: (phone: string) => void; onCancel?: () => void; onCodeSent?: () => void }) {
  const [phone, setPhone] = useState(initialPhone), [code, setCode] = useState(""), [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const sending = useRef(false), codeInput = useRef<HTMLInputElement>(null);

  async function call(method: "POST" | "PUT", body: Record<string, string>) {
    const response = await fetch("/api/v1/profile/contact", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message ?? "That didn’t go through. Try again.");
    return payload as { phone: string };
  }
  async function run(action: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(""); setStatus("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "That didn’t go through. Try again."); }
    finally { sending.current = false; setBusy(false); }
  }
  const sendCode = () => run(async () => {
    const sent = await call("POST", { kind: "phone", value: phone });
    setPhone(sent.phone); setCode(""); setCodeSent(true); setStatus(`We texted a code to ${sent.phone}.`); onCodeSent?.();
    requestAnimationFrame(() => codeInput.current?.focus());
  });
  const confirm = () => run(async () => { onVerified((await call("PUT", { value: phone, code })).phone); });

  return <form className="phone-verify" onSubmit={event => { event.preventDefault(); void (codeSent ? confirm() : sendCode()); }}>
    {codeSent ? <label className="field"><span>Code from the text</span>
      <input ref={codeInput} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={event => setCode(event.target.value)} /></label>
      : <label className="field"><span>Mobile number</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(415) 555-0123" required value={phone} onChange={event => setPhone(event.target.value)} /></label>}
    <div className="phone-verify-actions">
      <button type="submit" className="sheet-primary" disabled={busy || (codeSent ? code.trim().length < 6 : phone.trim().length < 7)}>{busy ? "Working…" : codeSent ? "Confirm number" : submitLabel}</button>
      {codeSent ? <>
        <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
        <button type="button" className="sheet-secondary" disabled={busy} onClick={() => { setCodeSent(false); setCode(""); setStatus(""); setError(""); }}>Use a different number</button>
      </> : onCancel ? <button type="button" className="sheet-secondary" disabled={busy} onClick={onCancel}>Cancel</button> : null}
    </div>
    <div aria-live="polite">
      {status ? <p className="entry-footnote" role="status">{status}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  </form>;
}
