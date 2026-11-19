"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { CommonsParticipant, CommonsState, CommonsSummary, TripLetterSections } from "@commons/contracts";
import { CommonsSnapshotSchema, TripTaskSchema, type TripTask } from "@commons/contracts";
import { thingsToDo, coordinatorNextSteps, currentNextStep, travelNextStepDescriptor } from "@commons/domain";
import { commonsPath } from "@/lib/commons-route";
import { useTripTaskIntakes } from "./use-trip-task-intakes";
import { homeShortcuts, homeUpdates } from "@/lib/home-dashboard";
import { DEFAULT_LETTER_SECTIONS, tripLetterDateline, tripLetterFacts, tripLetterUpdateText } from "@/lib/trip-letter";
import { TripLetterArrange, TripLetterShareUpdate, TripLetterWelcome } from "./trip-letter-controls";
import { FirstInviteNotice } from "./first-invite-notice";
import { TripBigQuestions } from "./trip-big-questions";
import { CalendarIcon, ImageIcon, PinIcon, QuestionIcon, ReceiptIcon } from "./icons";
import { ParticipantQuestionNextSteps } from "./participant-question-next-steps";
import { LogisticsAddMenu, type LogisticsAddKind } from "./logistics-add-menu";

const ignoreMayInvite = () => undefined;
/** Where a traveler can talk with Commons from this trip: messages in Commons ("web"), texting ("sms"), or neither. */
export type TextMessagingChannel = false | "sms" | "web";

export function HomeDashboard({ coverImage = null, decidingStage = false, state, commons, participants, currentActorId, activityParticipation, addPlan, addReceipt, addPhotos, openPhotos, photoCount = state.moments.length, addTravelPlans, travelUploadAvailable = false, confirmationIntakeEnabled = false, goToPlan, openItem, openStay, canAskGroup = false, openTodo, tasksPanel, tripLetter = false, textMessaging = false }: {
  /** Organizer, still getting to "We're going": the big questions are the whole page. */
  coverImage?: string | null;
  decidingStage?: boolean;
  /** This trip is on the new experience: DESIGN.md "The trip letter". */
  tripLetter?: boolean;
  /** The text channel can actually send. Off: no enrollment link or text action. */
  textMessaging?: TextMessagingChannel;
  tasksPanel?: React.ReactNode; openTodo?: (id:string)=>void;
  openItem?: (id: string) => void; openStay?: (id: string) => void; canAskGroup?: boolean; addPhotos?: () => void; openPhotos?: () => void; photoCount?: number;
  travelUploadAvailable?: boolean;
  confirmationIntakeEnabled?: boolean;
  state: CommonsState; commons: CommonsSummary; participants: CommonsParticipant[]; currentActorId: string; activityParticipation: CommonsState["participation"];
  addPlan: (kind?: LogisticsAddKind) => void; addTravelPlans: (step?: import("@commons/domain").CoordinatorNextStep) => void; addReceipt: () => void;
  goToPlan: (date?: string) => void; goToMoney: () => void; openTripDetails: () => void;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [letterWelcome, setLetterWelcome] = useState(commons.welcomeMessage ?? null);
  const [letterWelcomeAuthor, setLetterWelcomeAuthor] = useState(commons.welcomeAuthorPersonId ?? null);
  const [savedLetterSections, setSavedLetterSections] = useState<{ value: TripLetterSections | null } | null>(null);
  const letterSections = (savedLetterSections ? savedLetterSections.value : commons.letterSections) ?? DEFAULT_LETTER_SECTIONS;
  const [checkingStep, setCheckingStep] = useState(false);
  const [stepError, setStepError] = useState("");
  const [tripTasks, setTripTasks] = useState<TripTask[]>([]);
  const completionCommands = useRef(new Map<string,string>());
  const [completingTodo,setCompletingTodo]=useState<string|null>(null);
  const [tripTasksUnavailable, setTripTasksUnavailable] = useState(false);
  useEffect(() => {
    if (!travelUploadAvailable) return;
    let active = true;
    const load = () => { void fetch(`/api/v1/commons/${commons.slug}/tasks`, {cache:"no-store"}).then(async response => {
      if (!response.ok) throw new Error("Tasks unavailable");
      const value = await response.json();
      if (!Array.isArray(value.tasks)) throw new Error("Tasks unavailable");
      const tasks = value.tasks.map((task: unknown) => TripTaskSchema.parse(task));
      if (active) { setTripTasks(tasks); setTripTasksUnavailable(false); }
    }).catch(() => { if (active) setTripTasksUnavailable(true); }); };
    load();
    const timer = window.setInterval(load, 15000);
    window.addEventListener("focus", load);
    window.addEventListener("commons:trip-tasks-changed", load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", load); window.removeEventListener("commons:trip-tasks-changed",load); };
  }, [commons.slug, travelUploadAvailable]);
  const {intakes,setIntakes,intakeState,setIntakeState} = useTripTaskIntakes(commons.slug,confirmationIntakeEnabled);
  useEffect(() => { const first = window.setTimeout(() => setNow(Date.now()), 0); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => { window.clearTimeout(first); window.clearInterval(timer); }; }, []);
  const shortcuts = homeShortcuts(state, commons, currentActorId, activityParticipation, now ?? 0);
  const askHref = canAskGroup ? `${commonsPath(commons.id)}/polls/new` : undefined;
  const nextStep = now === null ? undefined : coordinatorNextSteps({ commons, state, participants, personId: currentActorId, now, travelState: "loaded", intakes, intakeState, uploadAvailable:travelUploadAvailable }).steps[0];
  const descriptor = nextStep ? travelNextStepDescriptor(nextStep) : null;
  async function openNextStep() {
    if (!nextStep || checkingStep) return;
    if (!travelUploadAvailable) { addTravelPlans(nextStep); return; }
    setCheckingStep(true); setStepError("");
    try {
      const response = await fetch(`/api/v1/commons/${commons.slug}/state`, {cache:"no-store"});
      if (!response.ok) throw new Error("unavailable");
      const latest = CommonsSnapshotSchema.parse((await response.json()).snapshot);
      if (latest.commons.id !== commons.id || latest.currentActor.id !== currentActorId) throw new Error("unavailable");
      let currentIntakes = intakes;
      if (confirmationIntakeEnabled) {
        const intakeResponse = await fetch(`/api/v1/commons/${commons.slug}/confirmations/intakes`, {cache:"no-store"});
        if (!intakeResponse.ok) throw new Error("unavailable");
        const body = await intakeResponse.json();
        if (!Array.isArray(body.intakes)) throw new Error("unavailable");
        currentIntakes = body.intakes; setIntakes(currentIntakes); setIntakeState("loaded");
      }
      // Reuse the canonical selector immediately before opening an editor or private review.
      // Revalidation runs only after a click and awaited network reads, never during render.
      // eslint-disable-next-line react-hooks/purity
      const current = coordinatorNextSteps({commons:latest.commons,state:latest.state,participants:latest.participants,personId:currentActorId,now:Date.now(),travelState:"loaded",intakes:currentIntakes,intakeState:"loaded",uploadAvailable:travelUploadAvailable}).steps[0];
      addTravelPlans(current && descriptor && currentNextStep(descriptor, [travelNextStepDescriptor(current)]) ? current : undefined);
    } catch {
      setStepError("Couldn’t reload your travel details. Open Travel & stays to check them.");
    } finally { setCheckingStep(false); }
  }
  async function completeTodo(id:string) {
    const task=tripTasks.find(task=>task.id===id);
    if(!task || completingTodo)return;
    setCompletingTodo(id);setStepError("");
    const key=`${id}:${task.version}`,commandId=completionCommands.current.get(key) ?? crypto.randomUUID();
    completionCommands.current.set(key,commandId);
    try {
      const response=await fetch(`/api/v1/commons/${commons.slug}/tasks`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({commandId,id:task.id,title:task.title,ownerPersonId:task.ownerPersonId,dueOn:task.dueOn,completed:true,itemKind:task.itemKind,itemId:task.itemId,expectedVersion:task.version})});
      const value=await response.json();if(!response.ok)throw new Error(value.error ?? "The to-do wasn’t completed. Try again.");
      const saved=TripTaskSchema.parse(value.task);setTripTasks(current=>current.map(task=>task.id===saved.id?saved:task));
      completionCommands.current.delete(key);window.dispatchEvent(new Event("commons:trip-tasks-changed"));
    } catch(cause){setStepError(cause instanceof Error?cause.message:"The to-do wasn’t completed. Try again.");}
    finally{setCompletingTodo(null);}
  }
  const actionItems = thingsToDo({tripId:commons.id,personId:currentActorId,organizer:canAskGroup,state,travel:nextStep,tripTasks:tripTasksUnavailable ? [] : tripTasks,today:now === null ? undefined : new Intl.DateTimeFormat("en-CA",{timeZone:commons.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now))});
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [firstInviteWaiting, setFirstInviteWaiting] = useState(false);
  const stepCount = actionItems.length;
  const next = now === null ? undefined : shortcuts.next;
  const stay = shortcuts.stay ?? shortcuts.legacyStay;
  const formatDate = (at: string) => new Intl.DateTimeFormat("en-US", { timeZone: commons.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
  if (decidingStage) return <div className="trip-letter"><header className="event-page-header trip-page-heading"><h2>Trip</h2><LogisticsAddMenu canAddStay={canAskGroup} choose={addPlan} addPhotos={addPhotos} addReceipt={addReceipt} /></header><div className="big-questions-page">{coverImage ? <Image className="trip-letter__cover" src={coverImage} alt="" width={1200} height={480} sizes="(max-width: 899px) 100vw, 65vw" /> : null}<TripBigQuestions slug={commons.slug} tripName={commons.name} /></div></div>;
  if (tripLetter) {
    const dateline = tripLetterDateline(state, commons, participants, currentActorId);
    const facts = tripLetterFacts(state, commons, currentActorId, activityParticipation, now ?? 0);
    // The letter is about the trip. Money has its own destination, and an expense edit isn't news for the group.
    const updates = homeUpdates(state, { includeMessages: false }).filter(update => update.destination !== "money").slice(0, 4);
    const photo = state.moments[0];
    const origin = now === null ? "" : window.location.origin;
    const updateDate = (at: string) => new Intl.DateTimeFormat("en-US", { timeZone: commons.timezone, month: "long", day: "numeric" }).format(new Date(at));
    return <div className="trip-letter">
      <header className="event-page-header trip-page-heading"><h2>Trip</h2><LogisticsAddMenu canAddStay={canAskGroup} choose={addPlan} addPhotos={addPhotos} addReceipt={addReceipt} /></header>
      <div className="trip-letter__layout">
        <div className="trip-letter__side">
          <section className="trip-letter__needs-section" aria-labelledby="trip-letter-needs-title">
            <h3 id="trip-letter-needs-title">Needs you</h3>
            {canAskGroup ? <FirstInviteNotice slug={commons.slug} prominent onMayInvite={ignoreMayInvite} onActionChange={setFirstInviteWaiting} /> : null}
            {stepCount ? <ul className="trip-letter__needs">{(showAllSteps ? actionItems : actionItems.slice(0,3)).map(item => {
              const content = <><strong>{item.title}</strong><span>{item.detail}</span><small>{item.action}</small></>;
              const poll = (item.target.kind === "poll" || item.target.kind === "poll_results") ? state.pollRequests?.find(poll=>poll.id === item.target.id) : undefined;
              return <li key={item.id}>{item.target.kind === "todo" && openTodo ? <button type="button" className="home-next-step" onClick={()=>openTodo(item.target.id)}>{content}</button> : item.target.kind === "todo" ? <Link className="home-next-step" href={`${commonsPath(commons.id)}?arrival=0&view=home&todo=${encodeURIComponent(item.target.id)}`}>{content}</Link> : item.target.kind === "travel_item" ? <Link className="home-next-step" href={`${commonsPath(commons.id)}?arrival=0&view=logistics&travelId=${encodeURIComponent(item.target.id)}`}>{content}</Link> : poll ? <Link className="home-next-step" href={item.target.kind === "poll_results" ? `${commonsPath(commons.id)}/polls/${poll.id}` : poll.canManage ? `${commonsPath(commons.id)}/polls/${poll.id}` : `/c/poll/${poll.publicId}`}>{content}</Link> : <button className="home-next-step" type="button" disabled={item.target.kind === "travel" && checkingStep} onClick={()=>{if(item.target.kind === "travel") void openNextStep();}}>{content}</button>}{item.target.kind === "todo" ? <button type="button" className="text-action" disabled={completingTodo !== null} onClick={()=>void completeTodo(item.target.id)}>{completingTodo === item.target.id ? "Saving…" : "Mark complete"}</button> : null}</li>;
            })}</ul> : firstInviteWaiting ? null : <p className="trip-letter__quiet">{now === null ? "Checking your to-dos…" : "Nothing is waiting for you."}</p>}
            <ParticipantQuestionNextSteps slug={commons.slug} />
            {stepCount > 3 ? <button className="text-action" type="button" onClick={()=>setShowAllSteps(value=>!value)}>{showAllSteps ? "Show fewer" : `Show ${stepCount-3} more`}</button> : null}
            {tripTasksUnavailable ? <p className="cm-note" role="status">Couldn’t reload your assigned to-dos. They’re still saved.</p> : null}
            {stepError ? <p className="cm-note" role="alert">{stepError}</p> : null}
          </section>
          {/* One primary action at a time: inviting while that's the step, otherwise Ask the group. The rest are quiet rows in two groups. */}
          <section className="trip-letter__tools" aria-label="Actions">
            {askHref && !firstInviteWaiting ? <Link className="view-primary-action" href={askHref}><QuestionIcon /> Ask the group</Link> : null}
            {askHref || canAskGroup ? <div className="trip-letter__tool-group">
              {askHref && firstInviteWaiting ? <Link className="home-action" href={askHref}><QuestionIcon /><span>Ask the group</span></Link> : null}
              {canAskGroup ? <Link className="home-action" href={`${commonsPath(commons.id)}/polls`}><QuestionIcon /><span>Polls and results</span></Link> : null}
              {canAskGroup ? <TripLetterShareUpdate slug={commons.slug} canText={Boolean(textMessaging)} canWrite={textMessaging === "web"} tripEnded={Boolean(commons.endsOn && now !== null && commons.endsOn < new Date(now).toISOString().slice(0, 10))} text={tripLetterUpdateText({ name: commons.name, facts, updates: updates.filter(update => update.destination !== "plan" || state.itinerary.some(item => item.id === update.itemId && item.participantScope === "everyone")), url: origin ? `${origin}${commonsPath(commons.id)}` : commonsPath(commons.id) })} recipients={participants.filter(person => person.id !== currentActorId && person.membershipStatus === "active").map(person => person.displayName)} /> : null}
            </div> : null}
            <div className="trip-letter__tool-group">
              {shortcuts.hasPlans ? <button className="home-action" type="button" onClick={() => goToPlan()}><CalendarIcon /><span>View plans</span></button> : null}
              {photoCount > 0 && openPhotos ? <button className="home-action" type="button" onClick={openPhotos}><ImageIcon /><span>View photos</span></button> : null}
              {textMessaging ? <Link className="home-action" href={`/messages/trip/${commons.slug}`}><span>{textMessaging === "web" ? "Messages from Commons" : "Text with Commons"}</span></Link> : null}
            </div>
            {canAskGroup ? <div className="trip-letter__tool-group"><TripLetterArrange slug={commons.slug} sections={savedLetterSections ? savedLetterSections.value : commons.letterSections ?? null} onSaved={next => setSavedLetterSections({ value: next })} /></div> : null}
          </section>
          {tasksPanel ? <div className="home-todos trip-letter__todos" id="trip-todos" tabIndex={-1}>{tasksPanel}</div> : null}
        </div>
        <article className="trip-letter__paper cm-document-paper" data-aged={now !== null && Boolean(commons.endsOn) && now - Date.parse(commons.endsOn!) > 365 * 86400000 || undefined}>
          {coverImage ? <Image className="trip-letter__cover" src={coverImage} alt="" width={1200} height={480} sizes="(max-width: 899px) 100vw, 65vw" /> : null}
          <header>{dateline ? <p className="trip-letter__dateline">{dateline}</p> : null}<p className="trip-letter__name">{commons.name}</p></header>
          {letterSections.filter(section => !section.hidden).map(section => {
            if (section.id === "welcome") return <TripLetterWelcome key="welcome" slug={commons.slug} welcome={letterWelcome} authorName={participants.find(person => person.id === letterWelcomeAuthor)?.displayName ?? null} canEdit={canAskGroup} onSaved={text => { setLetterWelcome(text); setLetterWelcomeAuthor(text ? currentActorId : null); }} />;
            if (section.id === "facts") return <dl key="facts" className="trip-letter__facts">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
            if (section.id === "photo") return photo ? /* eslint-disable-next-line @next/next/no-img-element -- Permitted trip photos come from the existing authorized asset routes. */
              <img key="photo" className="trip-letter__photo" src={photo.assetUrl} alt={photo.altText} /> : null;
            return updates.length ? <section key="latest" aria-labelledby="trip-letter-latest-title"><h3 id="trip-letter-latest-title">Latest</h3><ul className="trip-letter__updates">{updates.map(update => <li key={update.id}><strong>{update.title}</strong><span>{update.detail} · {updateDate(update.at)}</span></li>)}</ul></section> : null;
          })}
        </article>
      </div>
    </div>;
  }
  return <div className="product-view home-dashboard">
    {/* Ask the group is Trip's primary organizer action, reachable first on phones. */}
    {askHref
      ? <header className="view-intro view-intro--with-action event-page-header"><h2>Trip</h2><div className="money-actions"><LogisticsAddMenu canAddStay={canAskGroup} choose={addPlan} addPhotos={addPhotos} addReceipt={addReceipt} /><Link className="view-primary-action" href={askHref}><QuestionIcon /> Ask the group</Link></div></header>
      : <header className="event-page-header trip-page-heading"><h2>Trip</h2><LogisticsAddMenu canAddStay={canAskGroup} choose={addPlan} addPhotos={addPhotos} addReceipt={addReceipt} /></header>}
    <div className="home-dashboard__columns">
      <aside className="home-dashboard__rail" aria-label="Coming up and actions">
        <section className="home-dashboard__shortcuts home-dashboard__coming-up" aria-labelledby="home-coming-up-title">
        <h3 id="home-coming-up-title">Coming up</h3>
        <div className="home-shortcuts">
          {stay && openStay && "id" in stay ? <button className="home-shortcut" type="button" onClick={() => openStay(String(stay.id))}><PinIcon /><span><strong>{stay.name}</strong><small>{stay.address}</small><small>View stay details</small></span></button> : stay ? <a className="home-shortcut" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stay.address)}`} target="_blank" rel="noreferrer"><PinIcon /><span><strong>{stay.name}</strong><small>{stay.address}</small><small>Open Google Maps</small></span></a> : null}
          {!shortcuts.hasPlans ? <>
            <LogisticsAddMenu canAddStay={canAskGroup} choose={addPlan} />
          </> : next ? <button className="home-shortcut" onClick={() => openItem ? openItem(next.id) : goToPlan()}><CalendarIcon /><span><small>Your next activity · {formatDate(next.startsAt!)}</small><strong>{next.title}</strong>{next.location ? <small>{next.location}</small> : null}</span></button> : <button className="home-shortcut" onClick={() => goToPlan()}><CalendarIcon /><span>View plans</span></button>}
        </div>
        </section>
        <section className="home-dashboard__shortcuts home-dashboard__actions" aria-labelledby="home-actions-title">
        <h3 id="home-actions-title">Actions</h3>
        <div className="home-actions">
          {canAskGroup ? <Link className="home-action" href={`${commonsPath(commons.id)}/polls`}><QuestionIcon /><span>Polls and results</span></Link> : null}
          {photoCount > 0 && openPhotos ? <button className="home-action" type="button" onClick={openPhotos}><ImageIcon /><span>View photos</span></button> : null}
          <button className="home-action" type="button" onClick={addReceipt}><ReceiptIcon /><span>Add receipts</span></button>
        </div>
        </section>
      </aside>
      <section className="home-dashboard__feed" aria-label="Decisions and recent activity">
        <section className="home-next-steps" aria-labelledby="home-next-steps-title">
          <h3 id="home-next-steps-title">What’s next</h3>
          {confirmationIntakeEnabled && intakeState === "unavailable" ? <p className="cm-note" role="status">Checking your confirmation uploads. Arrival reminders show once they load.</p> : null}
          {nextStep?.reason === "arrival_processing" ? <p role="status">Your confirmation is processing. You don’t need to upload it again.</p> : null}
          {tripTasksUnavailable ? <p className="cm-note" role="status">Couldn’t reload your assigned to-dos. They’re still saved.</p> : null}
          {stepCount ? <ul className="home-next-steps__list">{(showAllSteps ? actionItems : actionItems.slice(0,3)).map(item => {
            const content = <><strong>{item.title}</strong><span>{item.detail}</span><small>{item.action}</small></>;
            const poll = (item.target.kind === "poll" || item.target.kind === "poll_results") ? state.pollRequests?.find(poll=>poll.id === item.target.id) : undefined;
            return <li key={item.id}>{item.target.kind === "todo" && openTodo ? <button type="button" className="home-next-step" onClick={()=>openTodo(item.target.id)}>{content}</button> : item.target.kind === "todo" ? <Link className="home-next-step" href={`${commonsPath(commons.id)}?arrival=0&view=home&todo=${encodeURIComponent(item.target.id)}`}>{content}</Link> : item.target.kind === "travel_item" ? <Link className="home-next-step" href={`${commonsPath(commons.id)}?arrival=0&view=logistics&travelId=${encodeURIComponent(item.target.id)}`}>{content}</Link> : poll ? <Link className="home-next-step" href={item.target.kind === "poll_results" ? `${commonsPath(commons.id)}/polls/${poll.id}` : poll.canManage ? `${commonsPath(commons.id)}/polls/${poll.id}` : `/c/poll/${poll.publicId}`}>{content}</Link> : <button className="home-next-step" type="button" disabled={item.target.kind === "travel" && checkingStep} data-next-step={item.descriptor?.reason} onClick={()=>{if(item.target.kind === "travel") void openNextStep();}}>{content}</button>}{item.target.kind === "todo" ? <button type="button" className="text-action" disabled={completingTodo !== null} onClick={()=>void completeTodo(item.target.id)}>{completingTodo === item.target.id ? "Saving…" : "Mark complete"}</button> : null}</li>;
          })}</ul> : <p className="home-next-steps__empty">{now === null || confirmationIntakeEnabled && intakeState === "unavailable" ? "Checking your to-dos…" : "No to-dos waiting for you."}</p>}
          <ParticipantQuestionNextSteps slug={commons.slug} />
          {stepCount > 3 ? <button className="text-action" type="button" onClick={()=>setShowAllSteps(value=>!value)}>{showAllSteps ? "Show fewer" : `Show ${stepCount-3} more`}</button> : null}
          {stepError ? <p className="cm-note" role="alert">{stepError}</p> : null}
        </section>
        {tasksPanel ? <div className="home-todos" id="trip-todos" tabIndex={-1}>{tasksPanel}</div> : null}
      </section>
    </div>

  </div>;
}
