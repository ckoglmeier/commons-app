"use client";

import { CommonsMark } from "@commons/ui";
import Image from "next/image";
import { type FormEvent, useState } from "react";
import styles from "./girls-trip-poll-prototype.module.css";

type Stage = "poll" | "submitted" | "organizer";
type SingleChoice = "room" | "baby";
type LimitedChoice = "archetype" | "hotel" | "food";
type ArrivalConcept = "cinema" | "postcard" | "reveal";

const roomOptions = ["I’d like my own room", "I’m happy sharing a room, but want my own bed", "I’m comfortable sharing a bed", "I’m flexible"];
const babyOptions = ["No", "Yes", "Maybe"];
const hotelOptions = ["Walkable to restaurants and drinks", "Pool or spa", "A beautiful property where we can hang out", "Easy access to wineries", "Larger rooms or suites", "Best possible value"];
const foodOptions = ["A long winery lunch", "One special dinner", "A tasting-menu experience", "Casual local favorites", "Brunch", "Keep the schedule flexible"];
const hotelArchetypes = [
  { label: "Charming inn", cost: "About $450 each", detail: "Simple, walkable, fewer amenities" },
  { label: "Polished boutique hotel", cost: "About $700 each", detail: "Design-forward with good gathering spaces" },
  { label: "Resort and spa", cost: "About $1,000 each", detail: "Full service with a destination-property feel" },
];

const earlyPoll = {
  tripId: "6b043aa5-4c4d-4515-a884-e3d1c9fa9968",
  organizer: "Robin",
  title: "Let’s pick where we’re staying.",
  recipientCount: 6,
} as const;

function ChoiceQuestion({
  number,
  prompt,
  options,
  value,
  onChange,
}: {
  number: number;
  prompt: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className={styles.question}>
      <legend><span>{String(number).padStart(2, "0")}</span>{prompt}</legend>
      <div className={styles.options}>
        {options.map((option) => (
          <label className={styles.option} key={option}>
            <input type="radio" name={`question-${number}`} checked={value === option} onChange={() => onChange(option)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LimitedQuestion({
  number,
  prompt,
  options,
  selected,
  onToggle,
}: {
  number: number;
  prompt: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className={styles.question}>
      <legend><span>{String(number).padStart(2, "0")}</span>{prompt}<em>Choose up to two</em></legend>
      <div className={styles.options}>
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <label className={styles.option} key={option}>
              <input type="checkbox" checked={checked} disabled={!checked && selected.length >= 2} onChange={() => onToggle(option)} />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function HotelArchetypeQuestion({ selected, onToggle }: { selected: string[]; onToggle: (value: string) => void }) {
  return (
    <fieldset className={`${styles.question} ${styles.archetypeQuestion}`}>
      <legend><span>01</span>Which hotel options would work for you?<em>Choose any</em></legend>
      <p>Estimated per person for two nights, including taxes and fees, with two people per room.</p>
      <div className={styles.archetypes}>
        {hotelArchetypes.map((option) => (
          <label className={styles.archetype} key={option.label}>
            <input aria-label={`Select ${option.label}`} type="checkbox" checked={selected.includes(option.label)} onChange={() => onToggle(option.label)} />
            <span><strong>{option.label}</strong><b>{option.cost}</b><small>{option.detail}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function GirlsTripPollPrototype({ coverImageUrl }: { coverImageUrl?: string | null }) {
  const [stage, setStage] = useState<Stage>("poll");
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<SingleChoice, string>>({ room: "", baby: "" });
  const [limited, setLimited] = useState<Record<LimitedChoice, string[]>>({ archetype: [], hotel: [], food: [] });
  const [wineClubs, setWineClubs] = useState("");
  const [wineries, setWineries] = useState("");
  const [dietary, setDietary] = useState("");
  const [shared, setShared] = useState(false);
  const [arrivalConcept, setArrivalConcept] = useState<ArrivalConcept>("cinema");
  const [responseSaved, setResponseSaved] = useState(false);

  const ready = Boolean(name.trim() && limited.archetype.length && answers.room && answers.baby && limited.hotel.length && limited.food.length);

  function setSingle(key: SingleChoice, value: string) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  function toggleLimited(key: LimitedChoice, value: string) {
    setLimited((current) => {
      const values = current[key];
      if (values.includes(value)) return { ...current, [key]: values.filter((item) => item !== value) };
      if (key !== "archetype" && values.length >= 2) return current;
      return { ...current, [key]: [...values, value] };
    });
  }

  function submitPoll(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setResponseSaved(true);
    setStage("submitted");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const stageLabel = stage === "poll" ? "8 questions" : stage === "organizer" ? "Organizer view" : "Invitation";
  const hasResponse = responseSaved && Boolean(name.trim());

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <header className={styles.header}>
          <span className={styles.brand}><i><CommonsMark /></i><strong>Commons</strong></span>
          <span className={styles.headerActions}>
            <em>{stageLabel}</em>
            {stage === "organizer" ? <button type="button" onClick={() => setStage("poll")}>Participant view</button> : <button type="button" onClick={() => setStage("organizer")}>Organizer view</button>}
          </span>
        </header>

        {stage === "poll" ? <section className={`${styles.coverHero} ${styles[`coverHero--${arrivalConcept}`]}`} data-has-image={Boolean(coverImageUrl)}>
          <div className={styles.conceptPicker} aria-label="Choose arrival design">
            <span>Arrival design</span>
            {(["cinema", "postcard", "reveal"] as const).map((concept, index) => <button type="button" key={concept} aria-label={`Preview ${concept} arrival design`} aria-pressed={arrivalConcept === concept} onClick={() => setArrivalConcept(concept)}><b>{index + 1}</b>{concept}</button>)}
          </div>
          <div className={styles.coverBackdrop}>{coverImageUrl ? <Image src={coverImageUrl} alt="" fill sizes="(max-width: 700px) 100vw, 672px" unoptimized /> : null}</div>
          <div className={styles.postcardStack} aria-hidden="true"><i /><i /></div>
          <div className={styles.coverFrame}>{coverImageUrl ? <Image src={coverImageUrl} alt="Napa or Sonoma girls trip cover" fill sizes="(max-width: 700px) 88vw, 560px" unoptimized /> : <span>Trip cover preview</span>}</div>
          <div className={styles.revealPanelLeft} aria-hidden="true" />
          <div className={styles.revealPanelRight} aria-hidden="true" />
          <div className={styles.coverScrim} />
          <div className={styles.coverContent}>
            <span>Robin’s girls trip</span>
            <h1>{earlyPoll.title}</h1>
            <div><b>Thursday–Saturday</b><b>Napa or Sonoma</b><b>About 6</b></div>
          </div>
          <span className={styles.continueCue}>Begin the poll <i>↓</i></span>
        </section> : null}

        {stage === "poll" ? (
          <form className={styles.body} onSubmit={submitPoll}>
            <label className={styles.nameField}>
              <span>Your name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="First name" autoComplete="given-name" required />
            </label>

            <HotelArchetypeQuestion selected={limited.archetype} onToggle={(value) => toggleLimited("archetype", value)} />
            <ChoiceQuestion number={2} prompt="What room setup works for you?" options={roomOptions} value={answers.room} onChange={(value) => setSingle("room", value)} />
            <ChoiceQuestion number={3} prompt="Will a baby be staying with you?" options={babyOptions} value={answers.baby} onChange={(value) => setSingle("baby", value)} />
            <LimitedQuestion number={4} prompt="What matters most for the hotel?" options={hotelOptions} selected={limited.hotel} onToggle={(value) => toggleLimited("hotel", value)} />

            <label className={styles.textQuestion}>
              <span><b>05</b>Do you belong to any wine clubs or have winery memberships?<em>Optional</em></span>
              <textarea value={wineClubs} onChange={(event) => setWineClubs(event.target.value)} placeholder="Winery and any guest benefits" rows={3} />
            </label>

            <label className={styles.textQuestion}>
              <span><b>06</b>Any favorite wineries—or ones you’ve always wanted to visit?<em>Optional</em></span>
              <textarea value={wineries} onChange={(event) => setWineries(event.target.value)} placeholder="Add as many as you’d like" rows={3} />
            </label>

            <LimitedQuestion number={7} prompt="Which food experiences should we prioritize?" options={foodOptions} selected={limited.food} onToggle={(value) => toggleLimited("food", value)} />

            <label className={styles.textQuestion}>
              <span><b>08</b>Any dietary restrictions or strong food preferences?<em>Optional</em></span>
              <textarea value={dietary} onChange={(event) => setDietary(event.target.value)} placeholder="For example: gluten-free or vegetarian" rows={3} />
            </label>

            <button className={styles.primary} type="submit" disabled={!ready}>Send my choices</button>
            {!ready ? <p className={styles.requirements}>Answer the first four questions and choose your food priorities.</p> : null}
          </form>
        ) : null}

        {stage === "submitted" ? (
          <div className={styles.body}>
            <span className={styles.kicker}>Your choices are in</span>
            <h1>Thanks, {name.trim()}.</h1>
            <p className={styles.lede}>{earlyPoll.organizer} can use your answers to narrow down the hotel and weekend.</p>

            <div className={styles.scopeBlock}>
              <span>For this trip</span>
              <dl>
                <div><dt>Hotel options</dt><dd>{limited.archetype.join(" · ")}</dd></div>
                <div><dt>Room setup</dt><dd>{answers.room}</dd></div>
                <div><dt>Baby plans</dt><dd>{answers.baby}</dd></div>
                <div><dt>Hotel priorities</dt><dd>{limited.hotel.join(" · ")}</dd></div>
                <div><dt>Food priorities</dt><dd>{limited.food.join(" · ")}</dd></div>
                <div><dt>Wine memberships</dt><dd>{wineClubs.trim() || "None shared"}</dd></div>
                <div><dt>Favorite wineries</dt><dd>{wineries.trim() || "None shared"}</dd></div>
                <div><dt>Dietary needs</dt><dd>{dietary.trim() || "None shared"}</dd></div>
              </dl>
            </div>

            <button className={styles.secondary} type="button" onClick={() => setStage("poll")}>Revise my response</button>
          </div>
        ) : null}

        {stage === "organizer" ? (
          <div className={styles.body} data-trip-id={earlyPoll.tripId}>
            <span className={styles.kicker}>Early poll · Organizer</span>
            <h1>Hotel direction.</h1>
            <p className={styles.lede}>This poll belongs to <strong>Napa or Sonoma girls trip</strong>.</p>

            <section className={styles.attachedTrip}>
              <span>Attached trip</span>
              <strong>{earlyPoll.tripId}</strong>
            </section>

            <section className={styles.sharePanel} aria-labelledby="share-poll-title">
              <div><span>{shared ? "Shared with the group" : "Ready to share"}</span><h2 id="share-poll-title">Invite the group to answer</h2><p>{shared ? `${earlyPoll.recipientCount} people have an event invitation and the poll todo is in the group conversation.` : `Sharing creates or preserves event invitations for ${earlyPoll.recipientCount} people and adds one linked todo to the group conversation.`}</p></div>
              <button type="button" onClick={() => setShared(true)} disabled={shared}>{shared ? "Poll shared" : "Share poll with group"}</button>
            </section>

            <section className={styles.organizerResults} aria-labelledby="organizer-results-title">
              <div className={styles.resultsHeading}><div><span>Results</span><h2 id="organizer-results-title">{hasResponse ? "1 of 6 answered" : "No responses yet"}</h2></div><button type="button" onClick={() => setStage("poll")}>Open participant preview</button></div>
              {hasResponse ? <>
                <div className={styles.responsePerson}><span>{name.trim()}</span><small>Answered just now</small></div>
                <dl>
                  <div><dt>Hotel options</dt><dd>{limited.archetype.join(" · ")}</dd></div>
                  <div><dt>Room setup</dt><dd>{answers.room}</dd></div>
                  <div><dt>Baby plans</dt><dd>{answers.baby}</dd></div>
                  <div><dt>Hotel priorities</dt><dd>{limited.hotel.join(" · ")}</dd></div>
                  <div><dt>Food priorities</dt><dd>{limited.food.join(" · ")}</dd></div>
                  <div><dt>Wine memberships</dt><dd>{wineClubs.trim() || "None shared"}</dd></div>
                  <div><dt>Favorite wineries</dt><dd>{wineries.trim() || "None shared"}</dd></div>
                  <div><dt>Dietary needs</dt><dd>{dietary.trim() || "None shared"}</dd></div>
                </dl>
              </> : <p className={styles.emptyResults}>Responses will appear here by person and roll up by option. No sample votes are shown.</p>}
            </section>

            <section className={styles.todoPreview}><span>Conversation todo</span><strong>Answer Robin’s hotel poll</strong><small>Poll invite · Opens the poll page</small></section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
