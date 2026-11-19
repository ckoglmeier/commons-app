"use client";

import { useState } from "react";
import { PhoneVerification } from "@/components/phone-verification";

/** Shown only once real texts can be sent. Sign-in stays email-only; this number is for texting about trips, and confirming it turns nothing on. */
export function ProfileMobile({ phone: initialPhone }: { phone: string | null }) {
  const [phone, setPhone] = useState(initialPhone), [editing, setEditing] = useState(false), [message, setMessage] = useState("");
  return (
    <section className="profile-contact">
      <h2>Texting</h2>
      <div className="profile-contact-row">
        <div><span>Mobile</span><strong>{phone ?? "Not added"}</strong><small>{phone ? "Confirmed. You choose texts for each trip." : "Lets you turn on texts for a trip."}</small></div>
        <button type="button" onClick={() => { setEditing(true); setMessage(""); }}>{phone ? "Change" : "Add"}</button>
      </div>
      {editing ? <>
        {phone ? <p className="profile-contact-message">Changing your number turns off texts for your trips until you turn them on again.</p> : null}
        <PhoneVerification onVerified={verified => { setPhone(verified); setEditing(false); setMessage(`${verified} is confirmed.`); }} onCancel={() => setEditing(false)} />
      </> : null}
      {message ? <p className="profile-contact-message" role="status">{message}</p> : null}
    </section>
  );
}
