"use client";

import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { currencySymbol, pollQuestionFormat, PollWorkingDraftSchema, type CreatePollRequest, type PollQuestion, type PollOption, type PollWorkingDraft } from "@commons/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getEarlyPollTemplate } from "@/lib/early-poll-templates";
import { housingConceptQuestion, movePollQuestion, newPollOption, newPollQuestion, pollDraftError } from "@/lib/poll-builder";
import { PollHousingFacts } from "@/components/poll-housing-facts";
import { PollQuestionAssistance } from "@/components/poll-question-assistance";
import { PollQuestionSection } from "@/components/poll-question-section";
import { PollAvailabilityEditor, newAvailabilityQuestion } from "@/components/poll-availability-editor";
import { PlusIcon } from "@/components/icons";
import { trackProductEvent } from "@/lib/product-analytics";
import { framingRevision } from "@/lib/poll-framing-apply";
import { personFacingError } from "@/lib/person-facing-error";

type StayPollOption = { id: string; name: string; address: string; url: string | null; startsOn?: string; endsOn?: string; description?: string | null };

function stayPollIntro(options: StayPollOption[]) {
  const day = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const first = options[0], same = first?.startsOn && options.every(option => option.startsOn === first.startsOn && option.endsOn === first.endsOn);
  return `We’re choosing where to stay${same && first.startsOn && first.endsOn ? ` ${day(first.startsOn)}–${day(first.endsOn)}` : ""}. Pick every place that could work for you, then your first choice if you have one. Nothing is booked yet.`;
}

export function PollStarter({ guestEmailsAllowed = true, linkOnly = false, bigQuestion, slug, eventName, timezone = "UTC", defaultCurrency = "USD", startsOn, canSuggest = false, suggestionsAvailable = false, people = [], sourcePoll, stayOptions = [], transportOptions = [], activityOptions = [], templateId, templateKey, prefillTitle, initialDraft, savedDrafts = [] }: {
  /** The trip's plan template, so its own default polls are found. */
  templateKey?: string | null;
  /** A question from the template's "Also to settle" list, used as the poll title. */
  prefillTitle?: string;
  /** Free stage: a link poll. Nobody joins the trip, and Commons sends nothing. */
  linkOnly?: boolean;
  /** False with password sign-in: a typed address proves nothing, so guests can't be named by email. */
  guestEmailsAllowed?: boolean;
  /** Which big question this poll asks, when opened from Trip. */
  bigQuestion?: "where" | "when" | "who";
  slug: string; eventName: string; timezone?: string; defaultCurrency?: string; startsOn?: string | null; canSuggest?: boolean; suggestionsAvailable?: boolean; people?: Array<{ id: string; name: string }>; sourcePoll?: { id: string; title: string }; stayOptions?: StayPollOption[]; transportOptions?: Array<{ id: string; name: string; description: string | null }>; activityOptions?: Array<{ id: string; name: string; description: string | null }>; templateId?: string; initialDraft?: PollWorkingDraft; savedDrafts?: PollWorkingDraft[] }) {
  const router = useRouter();
  const sourcePollId = initialDraft?.data.sourcePollId ?? sourcePoll?.id;
  const stayPoll = !initialDraft && !sourcePoll && !getEarlyPollTemplate(templateId, templateKey) && stayOptions.length >= 2;
  const transportPoll = !initialDraft && !sourcePoll && !getEarlyPollTemplate(templateId, templateKey) && !stayPoll && transportOptions.length >= 2;
  const activityPoll = !initialDraft && !sourcePoll && !getEarlyPollTemplate(templateId, templateKey) && !stayPoll && !transportPoll && activityOptions.length >= 2;
  const defaultTitle = (prefillTitle ? prefillTitle : templateId && templateId !== "early-hotel" && getEarlyPollTemplate(templateId, templateKey) ? getEarlyPollTemplate(templateId, templateKey)!.title : sourcePoll ? `Follow-up: ${sourcePoll.title}` : stayPoll ? "Which place should we stay?" : transportPoll ? "How should we get around?" : activityPoll ? "Which activities should we do?" : `${eventName}: help shape the trip`).slice(0, 120);
  const [title, setTitle] = useState(initialDraft?.data.title ?? defaultTitle);
  const [intro, setIntro] = useState(initialDraft?.data.intro ?? (stayPoll ? stayPollIntro(stayOptions) : transportPoll ? "We’re deciding how to get around. Pick every option that could work for you, then your first choice if you have one. Nothing is booked yet." : activityPoll ? "We’re choosing what to do. Pick every activity you’d do. Choosing here doesn’t change the plan." : ""));
  const [framingRequest, setFramingRequest] = useState(initialDraft?.data.framingRequest ?? "");
  // Before "We're going" every poll is a link poll. After it the organizer picks: trip members only, or anyone with the link.
  const [access, setAccess] = useState<"people" | "link">(initialDraft && !initialDraft.data.audience ? "link" : "people");
  const anyoneWithLink = linkOnly || access === "link";
  const [settledFacts, setSettledFacts] = useState(initialDraft?.data.settledFacts ?? "");
  const [recipientIds, setRecipientIds] = useState(initialDraft?.data.audience?.personIds ?? (sourcePoll ? [] : people.map(person => person.id)));
  const [guestEmails, setGuestEmails] = useState(initialDraft?.data.audience?.guestEmails.join(", ") ?? "");
  const audience = { personIds: recipientIds, guestEmails: guestEmailsAllowed ? [...new Set(guestEmails.split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean))] : [] };
  const recipientNames = people.filter(person => recipientIds.includes(person.id)).map(person => person.name).join(", ");
  const [ballotMode, setBallotMode] = useState<CreatePollRequest["ballotMode"]>(initialDraft?.data.ballotMode ?? "transparent");
  const [questions, setQuestions] = useState<PollQuestion[]>(() => {
    if (initialDraft) return initialDraft.data.questions;
    const template = getEarlyPollTemplate(templateId, templateKey);
    if (template) return structuredClone(template.questions);
    if (stayOptions.length >= 2) {
      return [{
        id: "71000000-0000-4000-8000-000000000004", kind: "choice", prompt: "Which places could work for you?", required: true,
        selectionMode: "multiple", options: stayOptions.map(stay => ({ id: stay.id, label: stay.name, description: stay.description ?? (stay.address || null),
          exclusive: false, url: stay.url, resource: { type: "stay", id: stay.id } })),
      }, {
        id: "71000000-0000-4000-8000-000000000005", kind: "choice", prompt: "If you had to pick one, which would it be?", required: false,
        selectionMode: "single", options: stayOptions.map((stay, index) => ({ id: `71b00000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          label: stay.name, description: null, exclusive: false, url: stay.url, resource: { type: "stay", id: stay.id } })),
      }];
    }
    if (transportOptions.length >= 2) {
      const options = (prefix: string, described: boolean) => transportOptions.map((plan, index) => ({ id: `71${prefix}00000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        label: plan.name, description: described ? plan.description : null, exclusive: false }));
      return [
        { id: "71000000-0000-4000-8000-000000000006", kind: "choice", prompt: "Which options could work for you?", required: true, selectionMode: "multiple", options: options("c", true) },
        { id: "71000000-0000-4000-8000-000000000007", kind: "choice", prompt: "If you had to pick one, which would it be?", required: false, selectionMode: "single", options: options("d", false) },
      ];
    }
    if (activityOptions.length >= 2) {
      return [{ id: "71000000-0000-4000-8000-000000000008", kind: "choice", prompt: "Which of these would you do?", required: true, selectionMode: "multiple",
        options: activityOptions.map(activity => ({ id: activity.id, label: activity.name, description: activity.description, exclusive: false, url: null, resource: null })) }];
    }
    return [];
  });
  const [review, setReview] = useState(false);
  const [publishedHref, setPublishedHref] = useState<string | null>(null);
  const [newQuestionId, setNewQuestionId] = useState<string | null>(null);
  const questionPicker = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<CreatePollRequest | null>(null);
  const inFlight = useRef(false);
  const [saved, setSaved] = useState<PollWorkingDraft | undefined>(initialDraft);
  const [dirty, setDirty] = useState(!initialDraft);
  const saveCommand = useRef<{ id: string; commandId: string; expectedVersion: number; data: PollWorkingDraft["data"] } | null>(null);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [review]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function leave(href: string) {
    if (inFlight.current) return;
    if (dirty && !await saveDraft()) {
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({ block: "center" }));
      return;
    }
    router.push(href);
  }

  function followSavedLink(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void leave(event.currentTarget.pathname + event.currentTarget.search);
  }

  function edit() { setReview(false); setError(""); pending.current = null; saveCommand.current = null; setDirty(true); }
  function updateQuestion(index: number, question: PollQuestion) {
    edit(); setQuestions(current => current.map((item, position) => position === index ? question : item));
  }
  function addQuestion(question: PollQuestion) {
    if (questionPicker.current) questionPicker.current.open = false;
    setNewQuestionId(question.id);
    edit(); setQuestions(current => current.length < 8 ? [...current, question] : current);
    requestAnimationFrame(() => document.getElementById(`prompt-${question.id}`)?.focus());
  }
  async function saveDraft(): Promise<PollWorkingDraft | undefined> {
    if (inFlight.current) return;
    if (saved && !dirty) return saved;
    inFlight.current = true; setBusy(true); setError("");
    const firstSave = !saved;
    saveCommand.current ??= { id: saved?.id ?? crypto.randomUUID(), commandId: crypto.randomUUID(),
      expectedVersion: saved?.version ?? 0, data: { title, intro: intro || null, settledFacts, framingRequest: framingRequest.trim() || undefined, ballotMode, questions, audience: anyoneWithLink ? undefined : audience, sourcePollId } };
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/poll-drafts`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(saveCommand.current) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Draft not saved. Your edits are still here. Try again.");
      const draft = PollWorkingDraftSchema.parse(payload.draft);
      setSaved(draft); setDirty(false); saveCommand.current = null;
      window.history.replaceState(null, "", `/c/${encodeURIComponent(slug)}/polls/new/?draft=${draft.id}`);
      if (firstSave) trackProductEvent("poll_draft_started", { commonsSlug: slug, properties: { source: sourcePoll ? "follow_up" : stayPoll ? "stays" : transportPoll ? "transport" : activityPoll ? "activities" : templateId ? "template" : "blank", optionCount: questions.reduce((total, question) => total + ("options" in question ? question.options.length : 0), 0) } });
      return draft;
    } catch (cause) {
      setError(personFacingError(cause, "Draft not saved. Your edits are still here. Try again."));
    } finally { inFlight.current = false; setBusy(false); }
  }
  /** Applies a reviewed suggestion through the normal draft save. Nothing changes here unless the save succeeds against the current version. */
  async function applySuggestion(next: { title: string; intro: string; questions: PollQuestion[] }): Promise<"applied" | "conflict" | "failed"> {
    if (inFlight.current || !saved || dirty) return "failed";
    inFlight.current = true; setBusy(true); setError("");
    try {
      const data = { title: next.title, intro: next.intro || null, settledFacts, framingRequest: framingRequest.trim() || undefined, ballotMode, questions: next.questions, audience, sourcePollId };
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/poll-drafts`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: saved.id, commandId: crypto.randomUUID(), expectedVersion: saved.version, data }) });
      if (response.status === 409) return "conflict";
      const payload = await response.json();
      if (!response.ok) return "failed";
      const draft = PollWorkingDraftSchema.parse(payload.draft);
      setSaved(draft); setDirty(false); saveCommand.current = null; pending.current = null; setReview(false);
      setTitle(next.title); setIntro(next.intro); setQuestions(next.questions);
      return "applied";
    } catch { return "failed"; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function reviewPoll() {
    const body: CreatePollRequest = { commandId: pending.current?.commandId ?? crypto.randomUUID(), title, intro: intro || null, ballotMode, questions, ...(anyoneWithLink ? {} : { audience }), sourcePollId };
    const validation = pollDraftError(body);
    if (validation) { setError(validation); return; }
    const draft = await saveDraft();
    if (!draft) return;
    pending.current = { ...body, draftId: draft.id, draftVersion: draft.version, ...(anyoneWithLink ? { publicationApproval: { approved: true, access: "link" as const } } : {}) }; setError(""); setReview(true);
  }
  async function createPoll() {
    if (inFlight.current || publishedHref || !pending.current || !review) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/polls`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pending.current),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Poll not created. Your draft is still here. Try again.");
      trackProductEvent("poll_published", { commonsSlug: slug, properties: { questionCount: questions.length, optionCount: questions.reduce((total, question) => total + ("options" in question ? question.options.length : 0), 0), ballotMode, assisted: Boolean(framingRequest.trim()) } });
      const href = `/c/${encodeURIComponent(slug)}/polls/${encodeURIComponent(payload.poll.id)}/`;
      // The poll is live either way. A failed link just leaves the question open on Trip, where it can be asked again.
      if (bigQuestion) await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/big-questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: bigQuestion, pollId: payload.poll.id }) }).catch(() => undefined);
      setPublishedHref(href);
      pending.current = null;
      // The destination loads fresh data. Refreshing the old route here can race navigation.
      router.push(href);
    } catch (cause) {
      setError(personFacingError(cause, "Poll not created. Your draft is still here. Try again."));
      // Retry the reviewed command, not a fresh command after an uncertain result.
    } finally { inFlight.current = false; setBusy(false); }
  }

  if (publishedHref) return <main className="poll-organizer-shell">
    <PollWorkspaceHeader eventName={eventName} eventHref={`/c/${slug}`} pollsHref={`/c/${slug}/polls`} />
    <div className="poll-organizer-content"><h1>Poll published</h1><p role="status">Ready to share.</p><a className="cm-action cm-action--primary" href={publishedHref}>Open poll</a></div>
  </main>;

  return <main className="poll-organizer-shell">
    <PollWorkspaceHeader eventName={eventName} eventHref={`/c/${slug}`} pollsHref={`/c/${slug}/polls`} busy={busy} onNavigate={href => void leave(href)}>
      <div className="poll-draft-status"><span role="status">{busy ? "Saving…" : saved && !dirty ? "Saved" : "Unsaved changes"}</span>{!review ? <button className="cm-action cm-action--quiet" type="button" disabled={busy || !dirty} onClick={() => void saveDraft()}>Save draft</button> : null}</div>
    </PollWorkspaceHeader>
    <div className="poll-organizer-content fieldnotes-builder">
      <div className="poll-organizer-intro"><h1>{review ? "Preview your poll" : "Ask the group"}</h1></div>
      {sourcePollId ? <p>Follow-up to <Link href={`/c/${slug}/polls/${sourcePollId}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); void leave(`/c/${slug}/polls/${sourcePollId}`); } }}>the earlier poll</Link>. Pick who can answer again. Earlier answers and prices aren’t copied.</p> : null}
      {!initialDraft && !saved && savedDrafts.length ? <details className="fieldnotes-context"><summary>Your saved polls</summary>{savedDrafts.map(draft => <p key={draft.id}><Link className="poll-saved-link" onClick={followSavedLink} href={draft.publishedPollId ? `/c/${slug}/polls/${draft.publishedPollId}` : `/c/${slug}/polls/new/?draft=${draft.id}`}>{draft.data.title || "Untitled poll"} · {draft.publishedPollId ? "Shared" : "Draft"}</Link></p>)}</details> : null}
      {review ? <section className="poll-preview" aria-label="Poll review">
        <h2>{title}</h2>{intro ? <p>{intro}</p> : null}
        <p>{ballotMode === "secret" ? "Secret ballot. Only totals show, after voting closes." : anyoneWithLink ? "Named answers. People on the trip can see who chose what. Comments are visible to the creator and organizers only." : "Named answers. Selected participants and organizers can see choices. Comments are visible to the creator and organizers only."}</p>
        {anyoneWithLink ? <><h3>Who can answer</h3>
        <p>Anyone with the link. They don’t sign in or join the trip, and names are self-reported.</p></> : <><h3>Reviewed audience</h3>
        <p>{recipientNames ? `Trip participants: ${recipientNames}. Anyone still invited needs to accept their trip invitation first.` : "Trip participants: None."}</p>
        {guestEmailsAllowed ? <p>Response-only guests: {audience.guestEmails.join(", ") || "None"}. They can answer but can’t open the trip.</p> : null}
        <p>Recipients sign in with their account. Answering isn’t an RSVP.</p></>}
        {questions.map((question, index) => <div className="poll-preview__question" key={question.id}><span>{index + 1}</span><div><strong>{question.prompt}</strong><p>{question.required ? "Required" : "Optional"} · {pollQuestionFormat(question)}</p>{question.kind !== "text" ? <ul>{question.options.map(item => <li key={item.id}>{item.label}{item.description ? ` — ${item.description}` : ""}{item.exclusive ? " (cannot be combined)" : ""}{item.housing ? <PollHousingFacts housing={item.housing} /> : null}{item.url ? <a href={item.url} target="_blank" rel="noreferrer">View source</a> : null}</li>)}</ul> : null}</div></div>)}
        <p>Publishing doesn’t email anyone or change the trip. You share the link next.</p>
      </section> : <fieldset className="fieldnotes-editing" disabled={busy}>
        {canSuggest ? <PollQuestionAssistance available={suggestionsAvailable} slug={slug} revision={framingRevision({ framingRequest, intro, settledFacts, title, questions })} title={title} defaultTitle={defaultTitle} intro={intro} questions={questions}
          framingRequest={framingRequest} onFramingRequest={value => { edit(); setFramingRequest(value); }} ready={framingRequest.trim().length >= 5 || (!framingRequest.trim() && intro.trim().length >= 5)} saveDraft={saveDraft} onApply={applySuggestion} /> : null}
        <label className="fieldnotes-field"><span>Introduction for the group</span><textarea value={intro} onChange={event => { edit(); setIntro(event.target.value); }} maxLength={500} rows={3} placeholder="Saturday is open. Pick every activity you’d do." /></label>
        <details className="fieldnotes-context"><summary>Already decided · Optional</summary><label className="fieldnotes-field"><span>What should stay fixed?</span><textarea value={settledFacts} onChange={event => { edit(); setSettledFacts(event.target.value); }} maxLength={1500} rows={2} placeholder="Saturday evening; staying in Denver." /><small>Private. Doesn’t change the trip.</small></label></details>
        <section className="fieldnotes-questions" aria-label="Questions">
          <h2>Your questions</h2>
                    {questions.map((question, index) => <PollQuestionSection key={question.id} id={question.id} title={`${index + 1}. ${question.prompt || "Untitled question"}`} meta={`${question.kind === "text" ? "Written answer" : `${question.options.length} options · ${pollQuestionFormat(question)}`} · ${question.required ? "Required" : "Optional"}`} initiallyOpen={index === 0 || question.id === newQuestionId}><fieldset className="fieldnotes-question-editor">
            <legend className="sr-only">Question {index + 1}</legend>
            <label className="fieldnotes-field"><span className="sr-only">Question {index + 1}</span><input id={`prompt-${question.id}`} placeholder="What would you like to ask?" value={question.prompt} maxLength={240} onChange={event => updateQuestion(index, { ...question, prompt: event.target.value })} /></label>
            <details className="fieldnotes-context poll-question-settings"><summary>Question settings</summary><div className="fieldnotes-toolbar">
              <label><input type="checkbox" checked={question.required} onChange={event => updateQuestion(index, { ...question, required: event.target.checked })} /> Required</label>
              <button className="cm-action" type="button" disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => { edit(); setQuestions(movePollQuestion(questions, index, -1)); }}>Move up</button>
              <button className="cm-action" type="button" disabled={index === questions.length - 1} aria-label={`Move question ${index + 1} down`} onClick={() => { edit(); setQuestions(movePollQuestion(questions, index, 1)); }}>Move down</button>
              <button className="cm-action cm-action--danger" type="button" aria-label={`Remove question ${index + 1}`} onClick={() => { edit(); setQuestions(questions.filter(item => item.id !== question.id)); requestAnimationFrame(() => questionPicker.current?.querySelector("summary")?.focus()); }}>Remove question</button>
            </div>
            {question.kind === "choice" && !question.availability ? <><label className="fieldnotes-field"><span>Response style</span><select value={question.selectionMode} onChange={event => updateQuestion(index, { ...question, selectionMode: event.target.value as "single" | "multiple" })}><option value="multiple">Choose all that work</option><option value="single">Choose one</option></select></label>{question.options.every(option => !option.label && !option.description && !option.housing && !option.url && !option.resource) ? <button className="cm-action" type="button" onClick={() => updateQuestion(index, { ...newAvailabilityQuestion(timezone), id: question.id, prompt: question.prompt || "Which days work for you?", required: question.required })}>Use date choices</button> : null}</> : null}
            </details>
            {question.kind === "choice" && question.availability ? <PollAvailabilityEditor question={question} initialMonth={startsOn ?? undefined} onChange={next => updateQuestion(index, next)} /> : question.kind === "choice" ? <>
              {question.options.map((option, optionIndex) => <OptionEditor defaultCurrency={defaultCurrency} key={option.id} option={option} index={optionIndex} questionIndex={index} canRemove={question.options.length > 2}
                onChange={next => updateQuestion(index, { ...question, options: question.options.map(item => item.id === option.id ? next : item) })}
                onRemove={() => updateQuestion(index, { ...question, options: question.options.filter(item => item.id !== option.id) })} />)}
              <button className="cm-action cm-action--quiet" type="button" disabled={question.options.length >= 12} onClick={() => updateQuestion(index, { ...question, options: [...question.options, newPollOption()] })}><PlusIcon />Add option</button>
            </> : question.kind === "text" ? null : <><p>Edit this in the date and location recipe.</p><ul>{question.options.map(option => <li key={option.id}>{option.label}</li>)}</ul></>}
          </fieldset></PollQuestionSection>)}
          <details ref={questionPicker} className="poll-question-picker"><summary className="cm-action"><PlusIcon />Add question</summary><div className="poll-question-types">
            <button className="cm-action" type="button" disabled={questions.length >= 8} onClick={() => addQuestion(newAvailabilityQuestion(timezone))}>Which days?</button>
            <button className="cm-action" type="button" disabled={questions.length >= 8} onClick={() => addQuestion(newPollQuestion())}>Choose from options</button>
            <button className="cm-action" type="button" disabled={questions.length >= 8} onClick={() => addQuestion(newPollQuestion("text"))}>Written answer</button>
            <button className="cm-action" type="button" disabled={questions.length >= 8} onClick={() => addQuestion(housingConceptQuestion())}>Compare stays</button>
          </div></details>
        </section>
        <section aria-label="Sharing settings">
        <h2>Before you share</h2>
        <label className="fieldnotes-field"><span>Poll title</span><input value={title} onChange={event => { edit(); setTitle(event.target.value); }} maxLength={120} /></label>
        {!linkOnly ? <fieldset className="poll-access-choice"><legend>Who can answer</legend>
          <label className="fieldnotes-toolbar"><input type="radio" name="poll-access" checked={access === "people"} onChange={() => { edit(); setAccess("people"); }} />Trip invitees · Sign-in required</label>
          <label className="fieldnotes-toolbar"><input type="radio" name="poll-access" checked={access === "link"} onChange={() => { edit(); setAccess("link"); }} />Anyone with the link · No sign-in</label>
        </fieldset> : null}
        {anyoneWithLink ? <p className="fieldnotes-note"><strong>Anyone with the link can answer.</strong> They don’t sign in or join the trip. Commons doesn’t send it.</p> : <details className="fieldnotes-context"><summary>Who can answer · {recipientIds.length} trip participants{guestEmailsAllowed ? ` · ${audience.guestEmails.length} guests` : ""}</summary>
          {guestEmailsAllowed ? <p>Guests can answer the poll but can’t open the trip.</p> : null}
          {people.map(person => <label className="fieldnotes-toolbar" key={person.id}><input type="checkbox" checked={recipientIds.includes(person.id)} onChange={event => { edit(); setRecipientIds(event.target.checked ? [...recipientIds, person.id] : recipientIds.filter(id => id !== person.id)); }} />{person.name}</label>)}
          {guestEmailsAllowed ? <label className="fieldnotes-field"><span>Response-only guest emails · Optional</span><textarea value={guestEmails} onChange={event => { edit(); setGuestEmails(event.target.value); }} rows={2} maxLength={10000} /><small>Separate emails with commas.</small></label> : null}
        </details>}
        <label className="fieldnotes-field"><span>Answer visibility</span><select value={ballotMode} onChange={event => { edit(); setBallotMode(event.target.value as CreatePollRequest["ballotMode"]); }}><option value="transparent">Named answers</option><option value="secret">Secret ballot</option></select><small>Can’t change after you publish.</small></label>
        </section>
      </fieldset>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="poll-action-row poll-editor-actions">{review ? <button className="cm-action" type="button" disabled={busy} onClick={edit}>Edit poll</button> : <button className="cm-action" type="button" disabled={busy} onClick={() => void leave(`/c/${slug}/polls`)}>Save and leave</button>}<button className="cm-action cm-action--primary" type="button" disabled={busy || !questions.length} onClick={() => review ? void createPoll() : void reviewPoll()}>{busy ? "Saving…" : review ? "Publish poll" : "Preview poll"}</button></div>
    </div>
  </main>;
}

function OptionEditor({ defaultCurrency, option, index, questionIndex, canRemove, onChange, onRemove }: { defaultCurrency: string; option: PollOption; index: number; questionIndex: number; canRemove: boolean; onChange: (option: PollOption) => void; onRemove: () => void }) {
  return <div className="fieldnotes-option-editor">
    <label className="fieldnotes-field"><span>Option {index + 1}</span><input value={option.label} maxLength={160} onChange={event => onChange({ ...option, label: event.target.value })} /></label>
    <details className="fieldnotes-context"><summary>{option.housing ? "Housing details" : "Details and settings"}{option.description || option.url || option.exclusive ? " · Added" : " · Optional"}</summary>
    <label className="fieldnotes-field"><span>Details · Optional</span><input value={option.description ?? ""} maxLength={180} placeholder="For housing: nights, people, total, fees, and unknowns" onChange={event => onChange({ ...option, description: event.target.value || null })} /></label>
    <label className="fieldnotes-field"><span>Source link · Optional</span><input type="url" value={option.url ?? ""} maxLength={2048} onChange={event => onChange({ ...option, url: event.target.value || null })} /></label>
    <label className="fieldnotes-toolbar"><input type="checkbox" checked={Boolean(option.housing)} onChange={event => onChange({ ...option, housing: event.target.checked ? { stage: "illustrative", nights: 3, people: 4, rooms: "Room arrangements not established", totalCents: null, currency: defaultCurrency, fees: "unknown", cancellation: null, checkedOn: null } : undefined })} /> Compare housing details</label>
    {option.housing ? <HousingEditor housing={option.housing} onChange={housing => onChange({ ...option, housing })} /> : null}
    <div className="fieldnotes-toolbar"><label><input type="checkbox" checked={option.exclusive} onChange={event => onChange({ ...option, exclusive: event.target.checked })} /> Cannot combine with another option</label><button type="button" disabled={!canRemove} aria-label={`Remove option ${index + 1} from question ${questionIndex + 1}`} onClick={onRemove}>Remove option</button></div>
    </details>
  </div>;
}

function HousingEditor({ housing, onChange }: { housing: NonNullable<PollOption["housing"]>; onChange: (value: NonNullable<PollOption["housing"]>) => void }) {
  return <div>
    <label className="fieldnotes-field"><span>Comparison stage</span><select value={housing.stage} onChange={event => onChange({ ...housing, stage: event.target.value as "illustrative" | "quoted", totalCents: null, checkedOn: null })}><option value="illustrative">Illustrative concept · not a quote</option><option value="quoted">Real property · supplied quote</option></select></label>
    <p>Use the same nights, people, and currency for every option.</p>
    <label className="fieldnotes-field"><span>Nights</span><input type="number" min={1} max={365} value={housing.nights} onChange={event => onChange({ ...housing, nights: Number(event.target.value) })} /></label>
    <label className="fieldnotes-field"><span>People</span><input type="number" min={1} max={100} value={housing.people} onChange={event => onChange({ ...housing, people: Number(event.target.value) })} /></label>
    <label className="fieldnotes-field"><span>Room and bed arrangements</span><input value={housing.rooms} maxLength={180} onChange={event => onChange({ ...housing, rooms: event.target.value })} /></label>
    {housing.stage === "quoted" ? <>
      <label className="fieldnotes-field"><span>Total for this group and stay</span><span className="money-input"><b aria-hidden="true">{currencySymbol(housing.currency)}</b><input aria-label={`Quoted housing total in ${housing.currency}`} type="number" min={0} step="0.01" value={housing.totalCents === null ? "" : housing.totalCents / 100} onChange={event => onChange({ ...housing, totalCents: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100) })} /></span></label>
      <label className="fieldnotes-field"><span>Quote checked on</span><input type="date" value={housing.checkedOn ?? ""} onChange={event => onChange({ ...housing, checkedOn: event.target.value || null })} /></label>
    </> : null}
    <label className="fieldnotes-field"><span>Taxes and fees</span><select value={housing.fees} onChange={event => onChange({ ...housing, fees: event.target.value as typeof housing.fees })}><option value="unknown">Unknown</option><option value="included">Included in the supplied total</option><option value="excluded">Extra · final total unknown</option></select></label>
    <label className="fieldnotes-field"><span>Cancellation terms · Optional</span><textarea value={housing.cancellation ?? ""} maxLength={300} onChange={event => onChange({ ...housing, cancellation: event.target.value || null })} /></label>
    <PollHousingFacts housing={housing} />
  </div>;
}
