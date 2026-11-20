"use client";

import {
  CommonsPeopleSchema,
  InvitationDeliveryActionSchema,
  InvitationLinkSchema,
  TravelerProfileSchema,
  type CommonsPeople,
  type CommonsParticipant,
  type CommonsPerson,
  type TravelerProfile,
} from "@commons/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trackProductEvent } from "@/lib/product-analytics";
import { CheckIcon, ChevronRightIcon, CloseIcon, EditIcon, PlusIcon } from "./icons";
import { TripLifecycleAction } from "./trip-lifecycle-action";
import { TravelerPreferencesForm } from "./traveler-preferences-form";
import { ModalLayer } from "./modal-layer";
import { GroupInvitationPanel } from "./group-invitation-panel";
import { GoingAction } from "./trip-stage-gate";
import { personFacingError } from "@/lib/person-facing-error";

async function responseJson(response: Response, fallback: string) {
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : fallback);
  return payload ?? {};
}

// On a copy without email, Commons never sends invitations. An invitation it could not send for that reason is the normal path, not a failure.
function linkOnly(person: CommonsPerson, emailInvitations: boolean) {
  if (emailInvitations || person.invitation?.status !== "pending") return false;
  const code = person.invitation.deliveryErrorCode;
  return person.invitation.deliveryState === "not_sent" || (person.invitation.deliveryState === "failed" && (code === "delivery_disabled" || code === "email_not_configured"));
}

function deliveryLabel(person: CommonsPerson, emailInvitations = true) {
  if (person.membershipStatus === "active") return "Joined";
  if (linkOnly(person, emailInvitations)) return "Not sent";
  if (person.invitation?.status === "expired") return "Needs attention";
  const delivery = person.invitation?.deliveryState;
  if (delivery === "failed") return "Needs attention";
  if (delivery === "queued") return "Sending";
  if (delivery === "sent") return "Invited";
  return "Not sent";
}

function deliveryHelp(person: CommonsPerson, emailInvitations = true) {
  if (person.invitation?.status === "expired") {
    return "This legacy invitation needs a new private link.";
  }
  if (linkOnly(person, emailInvitations)) return "Copy their private link and send it yourself.";
  const code = person.invitation?.deliveryErrorCode;
  if (code === "delivery_disabled" || code === "email_not_configured") {
    return "Email isn’t set up yet. Copy the private link instead.";
  }
  if (code === "provider_unavailable" || code === "delivery_interrupted") {
    return "Email was interrupted. Try sending it again, or copy the private link.";
  }
  if (person.invitation?.deliveryState === "failed") {
    return "Email wasn’t delivered. Try again, or copy the private link.";
  }
  if (person.invitation?.deliveryState === "sent") {
    return `Sent to ${person.email}. Waiting for them to join.`;
  }
  return person.email ?? "";
}

function deliveryErrorHelp(code: string | null) {
  if (code === "delivery_disabled" || code === "email_not_configured") return "Email isn’t set up yet. Copy the private link instead.";
  if (code === "provider_unavailable" || code === "delivery_interrupted") return "Email was interrupted. Try sending it again, or copy the private link.";
  return "Email wasn’t delivered. Try again, or copy the private link.";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : parts[0]?.[1] ?? ""}`.toUpperCase();
}

export function PeopleSheet({
  slug,
  tripName,
  tripStatus,
  participants,
  currentPersonId,
  canManage,
  close,
  inline = false,
  persistent = true,
  renderPersonTravel,
  hasTravel = false,
  onPeopleChanged,
  attendance,
  decidingStage = false,
  emailInvitations = true,
}: {
  decidingStage?: boolean;
  /** False when this copy has no email set up: organizers share private links themselves. */
  emailInvitations?: boolean;
  slug: string;
  tripName: string;
  tripStatus: "planning" | "active" | "closing" | "archived";
  participants: CommonsParticipant[];
  currentPersonId: string;
  canManage: boolean;
  close: () => void;
  inline?: boolean;
  persistent?: boolean;
  hasTravel?: boolean;
  onPeopleChanged?: () => Promise<void>;
  renderPersonTravel?: (personId: string) => ReactNode;
  attendance?: ReactNode;
}) {
  // Before the organizer says the trip is going, People is read-only.
  const mayInvite = !decidingStage;
  const [data, setData] = useState<CommonsPeople | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [accessMode, setAccessMode] = useState<"account" | "managed">("account");
  const [inviteRole, setInviteRole] = useState<"member" | "organizer">("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roleConfirm, setRoleConfirm] = useState<{ personId: string; role: "organizer" | "member" } | null>(null);
  const [managedProfile, setManagedProfile] = useState<TravelerProfile | null>(null);

  useEffect(() => {
    if (claimingId) inviteEmailRef.current?.focus();
  }, [claimingId]);

  async function load() {
    const response = await fetch(`/api/v1/commons/${slug}/people`, { cache: "no-store" });
    const payload = await responseJson(response, "People could not be loaded. Try again.");
    setData(CommonsPeopleSchema.parse(payload.people));
      void onPeopleChanged?.().catch(() => { /* The next event refresh can retry. */ });
  }

  useEffect(() => {
    if (!canManage || !persistent) return;
    let cancelled = false;
    void fetch(`/api/v1/commons/${slug}/people`, { cache: "no-store" })
      .then((response) => responseJson(response, "People could not be loaded. Try again."))
      .then((payload) => {
        if (!cancelled) setData(CommonsPeopleSchema.parse(payload.people));
      })
      .catch((loadError) => {
        if (!cancelled) setError(personFacingError(loadError, "People could not be loaded."));
      });
    return () => { cancelled = true; };
  }, [canManage, persistent, slug]);

  const counts = useMemo(() => {
    if (!canManage || !data) {
      return {
        joined: participants.filter((person) => person.membershipStatus === "active").length,
        managed: participants.filter((person) => person.accessMode === "managed").length,
        invited: participants.filter((person) => person.membershipStatus === "invited").length,
        attention: 0,
      };
    }
    const people = data?.people ?? [];
    return {
      joined: people.filter((person) => person.membershipStatus === "active").length,
      managed: people.filter((person) => person.accessMode === "managed").length,
      invited: people.filter((person) => person.invitation?.status === "pending" && (person.invitation.deliveryState !== "failed" || linkOnly(person, emailInvitations))).length,
      attention: people.filter((person) => (person.invitation?.deliveryState === "failed" && !linkOnly(person, emailInvitations)) || person.invitation?.status === "expired").length,
    };
  }, [canManage, data, emailInvitations, participants]);

  function beginEdit(person: CommonsPerson) {
    setClaimingId(null);
    setAccessMode("account");
    setEditingId(person.invitation?.id ?? null);
    setDisplayName(person.displayName);
    setEmail(person.email ?? "");
    setMessage(person.invitation?.message ?? "");
    setError("");
  }

  function resetForm() {
    setAdding(false);
    setClaimingId(null);
    setEditingId(null);
    setDisplayName("");
    setEmail("");
    setMessage("");
    setAccessMode("account");
    setInviteRole("member");
  }

  async function savePerson(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const url = editingId
        ? `/api/v1/commons/${slug}/invitations/${editingId}`
        : claimingId ? `/api/v1/commons/${slug}/people/${claimingId}/invite`
        : `/api/v1/commons/${slug}/people`;
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          email: accessMode === "managed" ? null : email,
          accessMode,
          role: accessMode === "managed" ? "member" : inviteRole,
          canClaimAccess: false,
          message: accessMode === "managed" ? null : message.trim() || null,
        }),
      });
      const payload = await responseJson(response, editingId ? "Invitation not updated." : "Traveler not added.");
      const savedPeople = CommonsPeopleSchema.parse(payload.people);
      setData(savedPeople);
      void onPeopleChanged?.().catch(() => { /* The next event refresh can retry. */ });
      const invitation = savedPeople.people.find(person => claimingId ? person.personId === claimingId : person.email?.toLowerCase() === email.trim().toLowerCase())?.invitation;
      setNotice(editingId ? "Invitation updated." : accessMode === "managed" ? `${displayName.trim()} was added without an account.` : !emailInvitations ? inviteRole === "organizer" && !claimingId ? `${displayName.trim()}’s organizer invitation is ready. Copy their private link and send it to them.` : `${displayName.trim()} was added. Copy their private link and send it to them.` : invitation?.deliveryState === "sent" ? `${displayName.trim()} was added. Invitation email sent.` : invitation?.deliveryState === "queued" ? `${displayName.trim()} was added. Invitation email queued.` : invitation?.deliveryState === "failed" ? `${displayName.trim()} was added, but the invitation email could not be sent. Use Retry invitation to try again.` : inviteRole === "organizer" && !claimingId ? `${displayName.trim()}’s organizer invitation is ready. No email sent yet.` : `${displayName.trim()} was added, but the invitation email was not sent. Use Send invitation to retry.`);
      if (emailInvitations && !editingId && accessMode === "account" && invitation?.deliveryState === "failed") setError(deliveryErrorHelp(invitation.deliveryErrorCode));
      resetForm();
    } catch (saveError) {
      setError(personFacingError(saveError, "Changes not saved. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function send(invitationId: string) {
    setBusy(`send-${invitationId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/invitations/${invitationId}/send`, { method: "POST" });
      const payload = await responseJson(response, "Invitation email could not be sent.");
      const delivery = InvitationDeliveryActionSchema.parse(payload.delivery);
      trackProductEvent("invitation_sent", { commonsSlug: slug, properties: { deliveryState: delivery.deliveryState } });
      await load();
      if (delivery.deliveryState === "sent") setNotice("Invitation email sent.");
      else setError(deliveryErrorHelp(delivery.deliveryErrorCode));
    } catch (sendError) {
      setError(personFacingError(sendError, "Invitation email could not be sent."));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(invitationId: string) {
    setBusy(`copy-${invitationId}`);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/invitations/${invitationId}/link`, { cache: "no-store" });
      const payload = await responseJson(response, "Private link unavailable.");
      const link = InvitationLinkSchema.parse(payload.link);
      await navigator.clipboard.writeText(link.url);
      trackProductEvent("invitation_link_copied", { commonsSlug: slug, properties: { source: "people" } });
      setNotice("Private link copied.");
    } catch (copyError) {
      setError(personFacingError(copyError, "Private link unavailable."));
    } finally {
      setBusy(null);
    }
  }

  async function openManagedProfile(personId: string) {
    setBusy(`profile-${personId}`);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/people/${personId}/profile`, { cache: "no-store" });
      const payload = await responseJson(response, "Private travel details could not be loaded.");
      setManagedProfile(TravelerProfileSchema.parse(payload));
    } catch (profileError) {
      setError(personFacingError(profileError, "Private travel details could not be loaded."));
    } finally {
      setBusy(null);
    }
  }

  async function rotateLink(invitationId: string) {
    if (!window.confirm("Replace this private link? The old link will stop working.")) return;
    setBusy(`rotate-${invitationId}`);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/invitations/${invitationId}/link`, { method: "POST" });
      const payload = await responseJson(response, "Private link not replaced.");
      const link = InvitationLinkSchema.parse(payload.link);
      await navigator.clipboard.writeText(link.url);
      trackProductEvent("invitation_link_replaced", { commonsSlug: slug });
      await load();
      setNotice("New private link copied. The old link no longer works.");
    } catch (rotateError) {
      setError(personFacingError(rotateError, "Private link not replaced. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(person: CommonsPerson) {
    const invitationId = person.invitation?.id;
    if (!invitationId || !window.confirm(`Revoke ${person.displayName}’s invitation? Their private link will stop working.`)) return;
    setBusy(`revoke-${invitationId}`);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/invitations/${invitationId}`, { method: "DELETE" });
      const payload = await responseJson(response, "Invitation not revoked.");
      setData(CommonsPeopleSchema.parse(payload.people));
      void onPeopleChanged?.().catch(() => { /* The next event refresh can retry. */ });
      setSelectedId(null);
      trackProductEvent("invitation_revoked", { commonsSlug: slug });
      setNotice(`${person.displayName}’s invitation was revoked.`);
    } catch (revokeError) {
      setError(personFacingError(revokeError, "Invitation not revoked. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function updateRole(person: CommonsPerson, role: "organizer" | "member") {
    setBusy(`role-${person.personId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/people/${person.personId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = await responseJson(response, "Organizer access not changed.");
      setData(CommonsPeopleSchema.parse(payload.people));
      void onPeopleChanged?.().catch(() => { /* The next event refresh can retry. */ });
      setRoleConfirm(null);
      setNotice(person.membershipStatus === "invited"
        ? `${person.displayName} will join as ${role === "organizer" ? "an organizer" : "a traveler"}. Their existing link still works. No email was sent.`
        : role === "organizer"
        ? `${person.displayName} is now an organizer.`
        : `${person.displayName} is no longer an organizer.`);
    } catch (roleError) {
      setError(personFacingError(roleError, "Organizer access not changed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const personForm = (
    <form className="people-form" onSubmit={(event) => void savePerson(event)}>
            <span className="view-kicker">{claimingId ? "Invite to Commons" : editingId ? "Edit invitation" : "Add traveler"}</span>
            <label className="field"><span>Name</span><input readOnly={Boolean(claimingId)} value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required /></label>
            {!editingId && !claimingId ? <fieldset className="people-access-choice"><legend>Access</legend><label aria-label="Invite with an account"><input type="radio" name="access-mode" checked={accessMode === "account"} onChange={() => setAccessMode("account")} /><span><strong>Invite with an account</strong><small>For someone who has their own email and will use Commons.</small></span></label><label aria-label="Add without an account"><input type="radio" name="access-mode" checked={accessMode === "managed"} onChange={() => setAccessMode("managed")} /><span><strong>Add without an account</strong><small>For a child or someone whose plans the organizer will manage.</small></span></label></fieldset> : null}
            {accessMode === "account" ? <><label className="field"><span>Email</span><input ref={inviteEmailRef} value={email} onChange={(event) => setEmail(event.target.value)} type="email" maxLength={254} required /></label><label className="field"><span>Invitation message <small>Optional</small></span><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} placeholder="Add a note" /></label></> : null}
            {!editingId && !claimingId && accessMode === "account" ? <label className="field"><span>Trip role</span><select aria-label="Trip role" aria-describedby="invite-role-help" value={inviteRole} onChange={event => setInviteRole(event.target.value as "member" | "organizer")}><option value="member">Traveler</option><option value="organizer">Organizer</option></select><small id="invite-role-help">{inviteRole === "organizer" ? "After joining, they can use Workspace, edit trip details, invite people, and manage organizer access." : "They can join plans, answer polls, and contribute to the trip."}</small></label> : null}
            <p>{!emailInvitations && accessMode === "account" ? claimingId ? "Email isn’t set up on this copy, so Commons won’t send an invitation. Copy their private link and send it yourself. After they sign in with this email and accept, they’ll keep their trip history, answer polls, and manage their own private profile. Your access to their private profile will end." : editingId ? "Email isn’t set up on this copy, so the message isn’t sent. Changing the email also replaces the private link." : inviteRole === "organizer" ? "This prepares an organizer invitation. Email isn’t set up on this copy, so copy their private link and send it yourself when you’re ready. Organizer access begins after acceptance." : "Email isn’t set up on this copy, so Commons won’t send an invitation. Add them, then copy their private link and send it yourself. They still need to accept; attendance is separate." : claimingId ? "Inviting this traveler sends an email now. After verifying this email and accepting, they’ll keep their trip history, answer polls, and manage their own private profile. Your access to their private profile will end." : editingId ? "The message is included the next time you send the invitation. Changing the email also replaces the private link." : accessMode === "managed" ? "They appear in the trip, but do not receive an invitation or need to take action." : inviteRole === "organizer" ? "This prepares an organizer invitation. Send it separately when you’re ready. Organizer access begins after acceptance." : "Inviting this traveler sends their invitation email automatically. They still need to accept; attendance is separate."}</p>
            <div><button type="button" onClick={resetForm}>Cancel</button><button type="submit" disabled={busy === "save"}>{busy === "save" ? "Saving…" : editingId ? "Save changes" : claimingId || (accessMode === "account" && inviteRole === "member") ? "Invite traveler" : accessMode === "account" ? "Prepare organizer invitation" : "Add traveler"}</button></div>
          </form>
  );

  return (
    <PeopleContainer inline={inline} close={close}>
      <section className={inline ? "people-inline-section" : "sheet people-sheet"} role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby="people-sheet-title">
        {!inline ? <><div className="sheet-handle" />
        <header className="sheet-header">
          <h2 id="people-sheet-title">People</h2>
          <button onClick={close} aria-label="Close people"><CloseIcon /></button>
        </header>
        </> : null}
        {inline ? <h2 id="people-sheet-title">{hasTravel ? "People and travel" : "People"}</h2> : null}
        <p className={inline ? "sr-only" : "sheet-summary"}>{canManage && !decidingStage ? "Invite travelers and help anyone who has trouble getting in." : "See who has joined and who’s been invited."}</p>
        {canManage && persistent && decidingStage ? <section className="first-invite-entry" aria-label="Invite people when you’re ready"><p>Keep gathering interest on Trip. When you’re ready, invite people to join.</p><GoingAction slug={slug} intent="invite" lead="Say the trip is going to invite people." /></section> : null}
        {canManage && persistent && mayInvite ? <GroupInvitationPanel key={slug} slug={slug} /> : null}

        {!canManage || !persistent || (!data && error) ? (
          <>
            <div className="people-counts people-counts--roster" aria-label="Traveler status">
              <span><strong>{counts.joined}</strong><small>Joined</small></span>
              {counts.managed ? <span><strong>{counts.managed}</strong><small>Managed</small></span> : null}
              <span><strong>{counts.invited}</strong><small>Invited</small></span>
            </div>
            <div className="people-list">
              {participants.map((person) => (
                <article key={person.id} className="people-row">
                  <div className="people-row__summary people-row__summary--static">
                    <span className="people-avatar">{person.initials}</span>
                    <span>
                      <strong>{person.displayName}{person.role === "organizer" ? <em>Organizer</em> : null}</strong>
                      {person.accessMode === "managed" ? (
                        <small>Managed by {person.managedByPersonIds?.map((personId) => participants.find((participant) => participant.id === personId)?.displayName.split(" ")[0]).filter(Boolean).join(" and ")}</small>
                      ) : person.role === "organizer" && !inline ? <small>Trip organizer</small> : null}
                    </span>
                    <span className="people-status">{person.accessMode === "managed" ? "No account" : person.membershipStatus === "active" ? "Joined" : "Invited"}</span>
                  </div>
                  {person.membershipStatus === "active" ? renderPersonTravel?.(person.id) : null}
                  {Object.keys(person.sharedPreferences ?? {}).length ? <div className="shared-preferences"><strong>Shared with this trip</strong>{Object.values(person.sharedPreferences ?? {}).filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div> : null}
                  {persistent && person.accessMode === "managed" && person.managedByPersonIds?.includes(currentPersonId) ? (
                    <div className="people-row__details people-row__details--managed">
                      {managedProfile?.personId === person.id ? (
                        <TravelerPreferencesForm profile={managedProfile} endpoint={`/api/v1/commons/${slug}/people/${person.id}/profile`} managed />
                      ) : (
                        <button className="sheet-secondary" type="button" onClick={() => void openManagedProfile(person.id)} disabled={Boolean(busy)}>
                          {busy === `profile-${person.id}` ? "Loading…" : "Edit private travel details"}
                        </button>
                      )}
                    </div>
                  ) : persistent && person.id === currentPersonId ? <div className="people-row__details people-row__details--managed">{managedProfile?.personId === person.id ? <TravelerPreferencesForm profile={managedProfile} endpoint={`/api/v1/commons/${slug}/people/${person.id}/profile`} /> : <button className="sheet-secondary" type="button" onClick={() => void openManagedProfile(person.id)} disabled={Boolean(busy)}>{busy === `profile-${person.id}` ? "Loading…" : "Review and share your travel details"}</button>}</div> : null}
                </article>
              ))}
            </div>
          </>
        ) : data ? (
          <>
            <div className="people-counts" aria-label="Traveler status">
              <span><strong>{counts.joined}</strong><small>Joined</small></span>
              <span><strong>{counts.invited}</strong><small>Invited</small></span>
              <span className={counts.attention ? "needs-attention" : ""}><strong>{counts.attention}</strong><small>Needs attention</small></span>
            </div>
            <div className="people-list">
              {data.people.map((person) => {
                const selected = selectedId === person.personId;
                const pending = person.invitation?.status === "pending";
                const expired = person.invitation?.status === "expired";
                const isCurrentPerson = person.personId === data.currentPersonId;
                const proposedRole = person.role === "organizer" ? "member" : "organizer";
                const confirmingRole = roleConfirm?.personId === person.personId && roleConfirm.role === proposedRole;
                const firstName = person.displayName.split(" ")[0];
                const isAssignedManager = person.accessMode === "managed" && person.managedByPersonIds?.includes(data.currentPersonId);
                const managerNames = person.managedByPersonIds
                  ?.map((managerId) => data.people.find((candidate) => candidate.personId === managerId)?.displayName.split(" ")[0])
                  .filter(Boolean)
                  .join(" and ");
                return (
                  <article key={person.membershipId} className={`people-row${person.invitation?.deliveryState === "failed" && !linkOnly(person, emailInvitations) ? " people-row--attention" : ""}`}>
                    <button className="people-row__summary" type="button" onClick={() => { setSelectedId(selected ? null : person.personId); setManagedProfile(null); setRoleConfirm(null); }} aria-expanded={selected}>
                      <span className="people-avatar">{initials(person.displayName)}</span>
                      <span><strong>{person.displayName}{person.role === "organizer" ? <em>Organizer</em> : null}</strong><small>{person.accessMode === "managed" ? `Managed${managerNames ? ` by ${managerNames}` : ""} · no account` : person.role === "organizer" ? "Trip organizer" : deliveryHelp(person, emailInvitations)}</small></span>
                      <span className={`people-status people-status--${person.invitation?.status === "expired" ? "failed" : linkOnly(person, emailInvitations) ? "not_sent" : person.invitation?.deliveryState ?? "joined"}`}>{person.accessMode === "managed" ? pending ? "Invitation pending" : "Managed" : deliveryLabel(person, emailInvitations)}</span>
                      <ChevronRightIcon />
                    </button>
                    {person.membershipStatus === "active" ? renderPersonTravel?.(person.personId) : null}
                    {mayInvite && inline && editingId && person.invitation?.id === editingId ? personForm : null}
                    {mayInvite && inline && claimingId === person.personId ? personForm : null}
                    {selected ? (
                      <div className="people-row__details">
                        {Object.keys(participants.find((participant) => participant.id === person.personId)?.sharedPreferences ?? {}).length ? <div className="shared-preferences"><strong>Shared with this trip</strong>{Object.values(participants.find((participant) => participant.id === person.personId)?.sharedPreferences ?? {}).filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div> : null}
                        {pending ? (
                          <>
                            <div className="people-role-note">
                              <strong>Joining as {person.role === "organizer" ? "an organizer" : "a traveler"}</strong>
                              {person.accessMode === "managed" ? <><p>Managed until they accept. Their trip history stays with them.</p><p>{deliveryHelp(person, emailInvitations)}</p></> : confirmingRole ? <><p>{proposedRole === "organizer" ? "After joining, they can use Workspace, edit trip details, invite people, and manage organizer access." : "They’ll join as a traveler without organizer access."} Their existing invitation link stays valid. No email will be sent.</p><div className="people-role-confirm"><button type="button" onClick={() => setRoleConfirm(null)} disabled={Boolean(busy)}>Cancel</button><button type="button" onClick={() => void updateRole(person, proposedRole)} disabled={Boolean(busy)}>{busy === `role-${person.personId}` ? "Saving…" : proposedRole === "organizer" ? "Invite as organizer" : "Invite as traveler"}</button></div></> : <button className="sheet-secondary" type="button" onClick={() => setRoleConfirm({ personId: person.personId, role: proposedRole })} disabled={Boolean(busy)}>{proposedRole === "organizer" ? "Change to organizer" : "Change to traveler"}</button>}
                            </div>
                            {mayInvite ? <div className="people-row__actions">
                              {emailInvitations ? <button type="button" onClick={() => void send(person.invitation!.id)} disabled={Boolean(busy) || person.invitation?.deliveryState === "queued"}>{busy === `send-${person.invitation!.id}` ? "Sending…" : person.invitation?.deliveryState === "queued" ? "Email queued" : person.invitation?.deliveryState === "sent" ? "Resend email" : person.invitation?.deliveryState === "failed" ? "Retry invitation" : "Send invitation"}</button> : null}
                              <button type="button" onClick={() => void copyLink(person.invitation!.id)} disabled={Boolean(busy)}>{busy === `copy-${person.invitation!.id}` ? "Copying…" : "Copy private link"}</button>
                              <button type="button" onClick={() => beginEdit(person)} disabled={Boolean(busy)}><EditIcon /> Edit</button>
                              <button type="button" onClick={() => void rotateLink(person.invitation!.id)} disabled={Boolean(busy)}>Replace link</button>
                            </div> : null}
                            <button className="people-revoke" type="button" onClick={() => void revoke(person)} disabled={Boolean(busy)}>{busy === `revoke-${person.invitation!.id}` ? "Revoking…" : "Revoke invitation"}</button>
                          </>
                        ) : expired ? (
                          <div className="member-removal-note">
                            <strong>This legacy invitation needs a new link.</strong>
                            <p>Replace the private link so {person.displayName.split(" ")[0]} can join. New invitation links do not expire.</p>
                            <button className="sheet-secondary" type="button" disabled>Copy private link</button>
                            {mayInvite ? <button className="sheet-secondary" type="button" onClick={() => void rotateLink(person.invitation!.id)} disabled={Boolean(busy)}>Replace and copy link</button> : null}
                            <button className="people-revoke" type="button" onClick={() => void revoke(person)} disabled={Boolean(busy)}>Revoke invitation</button>
                          </div>
                        ) : person.accessMode === "managed" ? (
                          <>
                            <div className="member-removal-note">
                              <strong>No account required.</strong>
                              {mayInvite ? <button className="sheet-secondary" type="button" disabled={Boolean(busy)} onClick={() => {
                                resetForm(); setClaimingId(person.personId); setDisplayName(person.displayName); setError(""); setNotice("");
                              }}>Invite to Commons</button> : null}
                              <p>{isAssignedManager
                                ? `You can maintain ${firstName}’s reusable private travel details and include them in plans.`
                                : `${firstName}’s private travel details are only available to explicitly assigned managers.`}</p>
                              {isAssignedManager && managedProfile?.personId !== person.personId ? (
                                <button className="sheet-secondary" type="button" onClick={() => void openManagedProfile(person.personId)} disabled={Boolean(busy)}>
                                  {busy === `profile-${person.personId}` ? "Loading…" : "Edit private travel details"}
                                </button>
                              ) : null}
                            </div>
                            {isAssignedManager && managedProfile?.personId === person.personId ? (
                              <TravelerPreferencesForm
                                profile={managedProfile}
                                endpoint={`/api/v1/commons/${slug}/people/${person.personId}/profile`}
                                managed
                              />
                            ) : null}
                          </>
                        ) : (
                          <div className="people-access-stack">
                            {isCurrentPerson ? managedProfile?.personId === person.personId ? <TravelerPreferencesForm profile={managedProfile} endpoint={`/api/v1/commons/${slug}/people/${person.personId}/profile`} /> : <button className="sheet-secondary" type="button" onClick={() => void openManagedProfile(person.personId)} disabled={Boolean(busy)}>{busy === `profile-${person.personId}` ? "Loading…" : "Review and share your travel details"}</button> : null}
                            <div className="people-role-note">
                              {confirmingRole ? (
                                <>
                                  <strong>{proposedRole === "organizer" ? `Make ${firstName} an organizer?` : `Remove organizer access for ${firstName}?`}</strong>
                                  <p>{proposedRole === "organizer"
                                    ? `${person.displayName} will be able to add travelers, manage invitations, and change organizer access.`
                                    : `${person.displayName} will remain on the trip but will no longer be able to manage travelers or invitations.`}</p>
                                  <div className="people-role-confirm">
                                    <button type="button" onClick={() => setRoleConfirm(null)} disabled={Boolean(busy)}>Cancel</button>
                                    <button type="button" onClick={() => void updateRole(person, proposedRole)} disabled={Boolean(busy)}>
                                      {busy === `role-${person.personId}` ? "Saving…" : proposedRole === "organizer" ? "Make organizer" : "Remove organizer access"}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <strong>Organizer access</strong>
                                  <p>{isCurrentPerson
                                    ? "You can add travelers, manage invitations, and change organizer access."
                                    : person.role === "organizer"
                                      ? `${firstName} can add travelers, manage invitations, and change organizer access.`
                                      : "Organizers can add travelers, manage invitations, and change organizer access."}</p>
                                  {!isCurrentPerson ? (
                                    <button
                                      className={person.role === "organizer" ? "people-role-remove" : "sheet-secondary"}
                                      type="button"
                                      onClick={() => setRoleConfirm({ personId: person.personId, role: proposedRole })}
                                      disabled={Boolean(busy)}
                                    >
                                      {person.role === "organizer" ? "Remove organizer access" : `Make ${firstName} an organizer`}
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                            {person.role !== "organizer" ? (
                              <div className="member-removal-note">
                                <strong>Removal isn’t available yet.</strong>
                                <p>{person.removal.moneyItems ? `${person.removal.moneyItems} money ${person.removal.moneyItems === 1 ? "entry needs" : "entries need"} a safe handoff. ` : ""}Trip responsibilities must be reassigned first. Their past messages, expenses, and photos will stay attributed.</p>
                                <button className="people-remove-blocked" type="button" disabled>Remove traveler</button>
                              </div>
                            ) : null}
                          </div>
                        )}
                        {(pending || expired) && isAssignedManager ? managedProfile?.personId === person.personId
                          ? <TravelerPreferencesForm profile={managedProfile} endpoint={`/api/v1/commons/${slug}/people/${person.personId}/profile`} managed />
                          : <button className="sheet-secondary" type="button" disabled={Boolean(busy)} onClick={() => void openManagedProfile(person.personId)}>Edit private travel details</button>
                          : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : !error ? <div className="people-loading">Loading people…</div> : null}

        {canManage && persistent && mayInvite && (adding || (!inline && (editingId || claimingId))) ? (
          personForm
        ) : canManage && persistent && mayInvite ? (
          <button className="sheet-primary" type="button" onClick={() => { setAdding(true); setDisplayName(""); setEmail(""); setMessage(""); setAccessMode("account"); setError(""); }}><PlusIcon /> Add traveler</button>
        ) : null}
        {attendance}
        {canManage && persistent ? (
          <section className="people-trip-settings" aria-labelledby="people-trip-settings-title">
            <div>
              <strong id="people-trip-settings-title">Trip settings</strong>
              <p>{tripStatus === "archived"
                ? "This trip is archived. Its shared history and participant access are unchanged."
                : "Archive this trip when the group is done with it."}</p>
            </div>
            <TripLifecycleAction
              slug={slug}
              name={tripName}
              archived={tripStatus === "archived"}
            />
          </section>
        ) : null}
        {notice ? <p className="people-notice" role="status"><CheckIcon /> {notice}</p> : null}
        {error ? <div role="alert"><p className="form-error">{error}</p>{canManage && persistent && !data ? <button className="sheet-secondary" type="button" onClick={() => { setError(""); void load().catch(cause => setError(personFacingError(cause, "People could not be loaded."))); }}>Reload people</button> : null}</div> : null}
      </section>
    </PeopleContainer>
  );
}

function PeopleContainer({ inline, close, children }: { inline: boolean; close: () => void; children: ReactNode }) {
  return inline ? <div className="event-people-inline">{children}</div> : <ModalLayer close={close}>{children}</ModalLayer>;
}
