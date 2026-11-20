"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { commonsWorkspacePath } from "@/lib/commons-route";
import { personFacingError } from "@/lib/person-facing-error";

export function JoinAction({
  token,
  signedIn,
  label = "Join trip",
  className = "join-primary",
  pollPublicId,
  textMessagingOffered = false,
}: {
  token: string;
  signedIn: boolean;
  label?: string;
  className?: string;
  pollPublicId?: string;
  /** After joining, offer texts for this trip before opening it. Skippable, and only when texts can actually be sent. */
  textMessagingOffered?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!signedIn) {
    return (
      <Link className={className} href={`/sign-in?next=${encodeURIComponent(`/join/${token}`)}&intent=invited`}>
        {label}
      </Link>
    );
  }

  async function join() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/invitations/${token}/claim`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Invitation not accepted. Try again.");
      router.push(pollPublicId && /^[0-9a-f]{12}$/.test(pollPublicId) ? `/c/poll/${pollPublicId}` : textMessagingOffered ? `/messages/trip/${payload.commonsId}?joined=1` : commonsWorkspacePath(payload.commonsId));
      router.refresh();
    } catch (joinError) {
      setError(personFacingError(joinError, "Invitation not accepted. Try again."));
      setPending(false);
    }
  }

  return (
    <>
      <button className={className} type="button" onClick={join} disabled={pending}>
        {pending ? "Joining…" : label}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </>
  );
}
