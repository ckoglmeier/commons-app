"use client";

import { CommonsMark } from "@commons/ui";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  onboardingPrototypeQuery,
  type OnboardingPrototypeMode,
  type OnboardingPrototypeScenario,
} from "@/lib/onboarding-prototype-state";
import styles from "./profile-onboarding.module.css";

type Scenario = OnboardingPrototypeScenario;

const scenarioDetails: Record<Scenario, { label: string; note: string; steps: number }> = {
  signup: {
    label: "Generic signup",
    note: "Use the shared phone-first flow, then enter Commons.",
    steps: 3,
  },
  referral: {
    label: "Friend referral",
    note: "Grant beta creation access without attaching an event.",
    steps: 4,
  },
  invitee: {
    label: "Invitation attached",
    note: "Use the same signup flow; finish with the invited trip.",
    steps: 5,
  },
  returning: {
    label: "Invitation, signed in",
    note: "Use the same event landing, then open the trip immediately.",
    steps: 3,
  },
};

const buildStages = [
  ["01", "Identity foundation", "Person and verified contact methods"],
  ["02", "Phone-first entry", "SMS code signs the person in"],
  ["03", "Referral access", "Limited launch grants; one claim per link"],
  ["04", "Reusable profile", "Built progressively inside Commons"],
  ["05", "Event reuse", "Confirm or override saved details"],
  ["Later", "Identity recovery", "Backlog: managed claims and merges"],
] as const;

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 10 3 3 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="8.5" width="11" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8.5V6.7a3 3 0 0 1 6 0v1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PrototypeHeader({ onReset }: { onReset: () => void }) {
  return (
    <header className={styles.prototypeHeader}>
      <div className={styles.brand}>
        <span><CommonsMark /></span>
        <strong>Commons</strong>
      </div>
      <div className={styles.prototypeStatus}>
        <span>Review prototype</span>
        <small>Nothing is saved</small>
      </div>
      <button type="button" onClick={onReset}>Restart flow</button>
    </header>
  );
}

function AppBar({ label }: { label: string }) {
  return (
    <div className={styles.appBar}>
      <div className={styles.appMark}><CommonsMark /></div>
      <strong>{label}</strong>
      <span>CK</span>
    </div>
  );
}

function PrimaryButton({ children }: { children: ReactNode }) {
  return <button className={styles.primary} type="submit">{children}<Arrow /></button>;
}

function EmailFallback({
  context,
  onBack,
  onContinue,
}: {
  context: "signup" | "referral" | "invitee";
  onBack: () => void;
  onContinue: () => void;
}) {
  const attachedCopy = context === "invitee"
    ? "Family – Fall Break stays attached. Opening the email link brings you back to this invitation."
    : context === "referral"
      ? "Casey’s beta invitation stays attached. Opening the email link returns you here."
      : "Opening the email link signs you in. You can add a mobile number later from Profile.";
  return (
    <form className={styles.screen} onSubmit={(event) => { event.preventDefault(); onContinue(); }}>
      <button className={styles.back} type="button" onClick={onBack}>← Use text message instead</button>
      <span className={styles.kicker}>Sign in by email</span>
      <h1>Use your email instead.</h1>
      <p className={styles.lede}>{attachedCopy}</p>
      <div className={styles.formFields}>
        <label>
          <span>First name</span>
          <input defaultValue={context === "invitee" ? "Robin" : context === "referral" ? "Maya" : "Casey"} autoComplete="given-name" />
        </label>
        <label>
          <span>Email</span>
          <input defaultValue={context === "invitee" ? "robin@example.com" : context === "referral" ? "maya@example.com" : "casey@example.com"} type="email" inputMode="email" autoComplete="email" />
        </label>
      </div>
      <PrimaryButton>Send sign-in link</PrimaryButton>
      <p className={styles.boundary}>Email is a fallback sign-in method. You can add and verify a mobile number later.</p>
    </form>
  );
}

function ProfileWelcomeQuestion({ name }: { name: string }) {
  const [origin, setOrigin] = useState("Denver International Airport (DEN)");
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div className={styles.dismissedQuestion} role="status">
        <span><strong>Skipped for now</strong><small>You can add your usual departure from Profile anytime.</small></span>
        <button type="button" onClick={() => setDismissed(false)}>Add it</button>
      </div>
    );
  }

  return (
    <section className={styles.welcomeQuestion} aria-labelledby={`profile-question-${name}`}>
      <span className={styles.questionNumber}>A useful starting point · Optional</span>
      <h2 id={`profile-question-${name}`}>Where do you usually travel from?</h2>
      <p>Commons can use this as a starting point when you plan a trip. Only you and Commons can see it.</p>
      {saved ? (
        <div className={styles.savedAnswer} role="status">
          <Check />
          <span><strong>Saved to your travel profile</strong><small>{origin}</small></span>
          <button type="button" onClick={() => setSaved(false)}>Change</button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
          <label>
            <span>City or airport</span>
            <input value={origin} onChange={(event) => setOrigin(event.target.value)} autoComplete="off" />
          </label>
          <div className={styles.questionActions}>
            <button type="submit">Save</button>
            <button type="button" onClick={() => setDismissed(true)}>Not now</button>
          </div>
        </form>
      )}
    </section>
  );
}

function TripWelcomeQuestion() {
  const [arrival, setArrival] = useState("Flying from Denver Thursday morning");
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div className={styles.dismissedQuestion} role="status">
        <span><strong>Skipped for now</strong><small>Add your arrival from Trip details whenever you know it.</small></span>
        <button type="button" onClick={() => setDismissed(false)}>Add it</button>
      </div>
    );
  }

  return (
    <section className={styles.welcomeQuestion} aria-labelledby="trip-arrival-question">
      <span className={styles.questionNumber}>For this trip · Optional</span>
      <h2 id="trip-arrival-question">How are you getting to Santa Fe?</h2>
      <p>Share whatever you know now. You can add exact times and itinerary details later.</p>
      {saved ? (
        <div className={styles.savedAnswer} role="status">
          <Check />
          <span><strong>Added to Family – Fall Break</strong><small>{arrival}</small></span>
          <button type="button" onClick={() => setSaved(false)}>Change</button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
          <label>
            <span>Travel details</span>
            <textarea value={arrival} onChange={(event) => setArrival(event.target.value)} rows={3} />
          </label>
          <div className={styles.questionActions}>
            <button type="submit">Add to this trip</button>
            <button type="button" onClick={() => setDismissed(true)}>Not now</button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReturningTripQuestion() {
  const [origin, setOrigin] = useState("Denver International Airport (DEN)");
  const [includeOdin, setIncludeOdin] = useState(true);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div className={styles.dismissedQuestion} role="status">
        <span><strong>Skipped for now</strong><small>Your saved profile and this trip are unchanged.</small></span>
        <button type="button" onClick={() => setDismissed(false)}>Review</button>
      </div>
    );
  }

  return (
    <section className={styles.welcomeQuestion} aria-labelledby="returning-trip-question">
      <span className={styles.questionNumber}>From your travel profile · Optional</span>
      <h2 id="returning-trip-question">Use your usual trip details?</h2>
      <p>These are private suggestions. Choose what applies before anything is added to Family – Fall Break.</p>
      {saved ? (
        <div className={styles.savedAnswer} role="status">
          <Check />
          <span><strong>Added to this trip</strong><small>{origin}{includeOdin ? " · Sam included" : ""}</small></span>
          <button type="button" onClick={() => setSaved(false)}>Change</button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
          <div className={styles.sourceBlock}>
            <div className={styles.sourceHeading}><Lock /><span><strong>Only you and Commons can see these now</strong><small>Your profile will not change</small></span></div>
            <div className={styles.reuseChoice}>
              <input type="checkbox" defaultChecked aria-label="Use departure for this trip" />
              <span><strong>Departure</strong><input aria-label="Departure for this trip" value={origin} onChange={(event) => setOrigin(event.target.value)} /></span>
            </div>
            <label className={styles.reuseChoice}>
              <input type="checkbox" aria-label="Include Sam in this trip" checked={includeOdin} onChange={(event) => setIncludeOdin(event.target.checked)} />
              <span><strong>Managed traveler</strong><small>Sam · Managed by you</small></span>
            </label>
          </div>
          <div className={styles.questionActions}>
            <button type="submit">Add to this trip</button>
            <button type="button" onClick={() => setDismissed(true)}>Not now</button>
          </div>
        </form>
      )}
    </section>
  );
}

function InvitationReady({ name, onViewTrip }: { name: string; onViewTrip: () => void }) {
  return (
    <section className={styles.arrivalWelcome} aria-labelledby="arrival-welcome-title">
      <div className={styles.arrivalMedia}>
        <Image
          src="/moments/cape-beach.jpg"
          alt="A quiet beach and shoreline used as prototype trip cover photography"
          fill
          priority
          sizes="(min-width: 1100px) 45rem, 100vw"
        />
        <div className={styles.arrivalWash} />
      </div>
      <div className={styles.arrivalBrand} aria-label="Commons">
        <span><CommonsMark /></span>
        <strong>Commons</strong>
      </div>
      <div className={styles.arrivalTrip}>
        <span>Welcome to your trip, {name}.</span>
        <h1 id="arrival-welcome-title">Family – Fall Break</h1>
        <p>October 8–13, 2026 · Santa Fe, New Mexico</p>
      </div>
      <footer className={styles.arrivalFooter}>
        <button type="button" onClick={onViewTrip}>View the trip<Arrow /></button>
        <button type="button">Chat with Commons</button>
      </footer>
    </section>
  );
}

function TripEntry({ returning = false }: { returning?: boolean }) {
  return (
    <section className={styles.screen}>
      <span className={styles.kicker}>Inside Family – Fall Break</span>
      <h1>The trip is open.</h1>
      <p className={styles.lede}>You can view the plan now. Add what you know whenever it’s useful.</p>
      <div className={styles.tripPreview}>
        <span>Next</span>
        <strong>Thursday arrival</strong>
        <small>Your travel details are not added yet</small>
      </div>
      <button className={styles.primary} type="button">View the plan<Arrow /></button>
      {returning ? <ReturningTripQuestion /> : <TripWelcomeQuestion />}
    </section>
  );
}

function SignupFlow({ step, setStep, mode, setMode }: { step: number; setStep: (value: number) => void; mode: OnboardingPrototypeMode; setMode: (value: OnboardingPrototypeMode) => void }) {
  const submit = (next: number) => (event: FormEvent) => {
    event.preventDefault();
    setStep(next);
  };

  if (step === 0 && mode === "email") {
    return <EmailFallback context="signup" onBack={() => setMode("phone")} onContinue={() => setStep(2)} />;
  }

  if (step === 0) {
    return (
      <form className={styles.screen} onSubmit={submit(1)}>
        <span className={styles.kicker}>Create your account</span>
        <h1>Your events start here.</h1>
        <p className={styles.lede}>Enter your first name and mobile number. We’ll text a code that signs you in.</p>
        <div className={styles.formFields}>
          <label>
            <span>First name</span>
            <input defaultValue="Casey" autoComplete="given-name" />
          </label>
          <label>
            <span>Mobile number</span>
            <div className={styles.phoneField}><b>+1</b><input defaultValue="513 884 4929" inputMode="tel" autoComplete="tel" /></div>
          </label>
        </div>
        <PrimaryButton>Send verification code</PrimaryButton>
        <button className={styles.textButton} type="button" onClick={() => setMode("email")}>Use email instead</button>
        <p className={styles.boundary}>The code signs you in. It does not turn on trip messages or marketing texts.</p>
      </form>
    );
  }

  if (step === 1) {
    return (
      <form className={styles.screen} onSubmit={submit(2)}>
        <button className={styles.back} type="button" onClick={() => setStep(0)}>← Change number</button>
        <span className={styles.kicker}>Verify mobile number</span>
        <h1>Enter the code we sent.</h1>
        <p className={styles.lede}>Sent to +1 513 884 4929. The code expires in 10 minutes.</p>
        <label className={styles.codeField}>
          <span>6-digit code</span>
          <input defaultValue="482103" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        </label>
        <PrimaryButton>Verify and sign in</PrimaryButton>
        <button className={styles.textButton} type="button">Send another code</button>
      </form>
    );
  }

  return (
    <section className={styles.screen}>
      <span className={styles.kicker}>Signed in</span>
      <h1>Welcome, Casey.</h1>
      <p className={styles.lede}>Your account is ready. Start an event or begin a conversation with Commons.</p>
      <div className={styles.summaryList}>
        <div><span>First name</span><strong>Casey</strong><small>Confirmed</small></div>
        <div><span>Mobile number</span><strong>+1 513 884 4929</strong><em><Check /> Verified</em></div>
      </div>
      <button className={styles.primary} type="button">Start an event<Arrow /></button>
      <button className={styles.secondary} type="button">Chat with Commons</button>
      <p className={styles.boundary}>Chat opens in Commons. Creating an event makes you an organizer of that event.</p>
      <ProfileWelcomeQuestion name="Casey" />
    </section>
  );
}

function ReferralFlow({ step, setStep, mode, setMode }: { step: number; setStep: (value: number) => void; mode: OnboardingPrototypeMode; setMode: (value: OnboardingPrototypeMode) => void }) {
  if (step === 1 && mode === "email") {
    return <EmailFallback context="referral" onBack={() => setMode("phone")} onContinue={() => setStep(3)} />;
  }

  if (step === 0) {
    return (
      <section className={styles.screen}>
        <span className={styles.kicker}>Invited by Casey</span>
        <h1>Plan with Commons.</h1>
        <p className={styles.lede}>Casey shared one of their beta invitations. Accept it to create your own events.</p>
        <div className={styles.invitationNote}>
          <span className={styles.avatar}>C</span>
          <p>“I’ve been using this for our trips. Thought you’d like it too.”</p>
        </div>
        <button className={styles.primary} type="button" onClick={() => setStep(1)}>Accept invitation<Arrow /></button>
        <p className={styles.boundary}>This adds beta event-creation access. It does not add you to Casey’s trips.</p>
      </section>
    );
  }

  if (step === 1) {
    return (
      <form className={styles.screen} onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
        <button className={styles.back} type="button" onClick={() => setStep(0)}>← Back to invitation</button>
        <span className={styles.kicker}>Create your account</span>
        <h1>Your events start here.</h1>
        <p className={styles.lede}>Enter your first name and mobile number. We’ll text a code that signs you in.</p>
        <div className={styles.formFields}>
          <label>
            <span>First name</span>
            <input defaultValue="Maya" autoComplete="given-name" />
          </label>
          <label>
            <span>Mobile number</span>
            <div className={styles.phoneField}><b>+1</b><input defaultValue="303 555 0182" inputMode="tel" autoComplete="tel" /></div>
          </label>
        </div>
        <PrimaryButton>Send verification code</PrimaryButton>
        <button className={styles.textButton} type="button" onClick={() => setMode("email")}>Use email instead</button>
      </form>
    );
  }

  if (step === 2) {
    return (
      <form className={styles.screen} onSubmit={(event) => { event.preventDefault(); setStep(3); }}>
        <button className={styles.back} type="button" onClick={() => setStep(1)}>← Change details</button>
        <span className={styles.kicker}>Sign in by text</span>
        <h1>Enter the code we sent.</h1>
        <p className={styles.lede}>Sent to +1 303 555 0182. Casey’s beta invitation stays attached.</p>
        <label className={styles.codeField}>
          <span>6-digit code</span>
          <input defaultValue="482103" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        </label>
        <PrimaryButton>Verify and accept invitation</PrimaryButton>
        <button className={styles.textButton} type="button">Send another code</button>
      </form>
    );
  }

  return (
    <section className={styles.screen}>
      <span className={styles.kicker}>Beta access added</span>
      <h1>Welcome, Maya.</h1>
      <p className={styles.lede}>You can create an event when you’re ready. No trip or organizer role was added.</p>
      <div className={styles.summaryList}>
        <div><span>Invited by</span><strong>Casey</strong><small>Friend referral</small></div>
        <div><span>Event creation</span><strong>Available</strong><em><Check /> Beta access</em></div>
      </div>
      <button className={styles.primary} type="button">Start an event<Arrow /></button>
      <button className={styles.secondary} type="button">Chat with Commons</button>
      <p className={styles.boundary}>Chat opens in Commons. SMS can become another way to continue it later.</p>
      <ProfileWelcomeQuestion name="Maya" />
    </section>
  );
}

function InviteeFlow({ step, setStep, mode, setMode }: { step: number; setStep: (value: number) => void; mode: OnboardingPrototypeMode; setMode: (value: OnboardingPrototypeMode) => void }) {
  if (step === 1 && mode === "email") {
    return <EmailFallback context="invitee" onBack={() => setMode("phone")} onContinue={() => setStep(3)} />;
  }

  if (step === 0) {
    return (
      <section className={styles.screen}>
        <span className={styles.kicker}>Invited by Casey</span>
        <h1>Family – Fall Break</h1>
        <p className={styles.eventFacts}>October 8–13, 2026 · Santa Fe, New Mexico</p>
        <div className={styles.invitationNote}>
          <span className={styles.avatar}>C</span>
          <p>“Sam is excited for fly fishing. Add your travel details whenever you know them.”</p>
        </div>
        <button className={styles.primary} type="button" onClick={() => setStep(1)}>Continue to the trip<Arrow /></button>
        <p className={styles.boundary}>Family – Fall Break stays attached while you confirm who is joining.</p>
      </section>
    );
  }

  if (step === 1) {
    return (
      <form className={styles.screen} onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
        <button className={styles.back} type="button" onClick={() => setStep(0)}>← Back to invitation</button>
        <span className={styles.kicker}>Confirm your invitation</span>
        <h1>What should the group call you?</h1>
        <p className={styles.lede}>Confirm your first name and mobile number. That’s all we need before opening the trip.</p>
        <div className={styles.formFields}>
          <label>
            <span>First name</span>
            <input defaultValue="Robin" autoComplete="given-name" />
          </label>
          <label>
            <span>Mobile number</span>
            <div className={styles.phoneField}><b>+1</b><input defaultValue="513 555 0148" inputMode="tel" autoComplete="tel" /></div>
          </label>
        </div>
        <PrimaryButton>Send verification code</PrimaryButton>
        <button className={styles.textButton} type="button" onClick={() => setMode("email")}>Use email instead</button>
        <p className={styles.boundary}>The SMS code confirms this number and signs you in. It does not turn on trip messages or marketing texts.</p>
      </form>
    );
  }

  if (step === 2) {
    return (
      <form className={styles.screen} onSubmit={(event) => { event.preventDefault(); setStep(3); }}>
        <button className={styles.back} type="button" onClick={() => setStep(1)}>← Change details</button>
        <span className={styles.kicker}>Sign in by text</span>
        <h1>Enter the code we sent.</h1>
        <p className={styles.lede}>Sent to +1 513 555 0148. Family – Fall Break stays attached while you sign in.</p>
        <label className={styles.codeField}>
          <span>6-digit code</span>
          <input defaultValue="482103" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        </label>
        <PrimaryButton>Verify and continue</PrimaryButton>
        <button className={styles.textButton} type="button">Send another code</button>
      </form>
    );
  }

  if (step === 3) {
    return <InvitationReady name="Robin" onViewTrip={() => setStep(4)} />;
  }

  if (step === 4) {
    return <TripEntry />;
  }

  return null;
}

function ReturningFlow({ step, setStep }: { step: number; setStep: (value: number) => void }) {
  if (step === 0) {
    return (
      <section className={styles.screen}>
        <span className={styles.kicker}>Invited by Robin</span>
        <h1>Family – Fall Break</h1>
        <p className={styles.eventFacts}>October 8–13, 2026 · Santa Fe, New Mexico</p>
        <div className={styles.invitationNote}>
          <span className={styles.avatar}>E</span>
          <p>“Sam is excited for fly fishing. Add your travel details whenever you know them.”</p>
        </div>
        <button className={styles.primary} type="button" onClick={() => setStep(1)}>Open Family – Fall Break<Arrow /></button>
      </section>
    );
  }

  if (step === 1) {
    return <InvitationReady name="Casey" onViewTrip={() => setStep(2)} />;
  }

  if (step === 2) {
    return <TripEntry returning />;
  }

  return null;
}

export function ProfileOnboardingPrototype({
  initialState,
}: {
  initialState: { scenario: Scenario; step: number; mode: OnboardingPrototypeMode };
}) {
  const [scenario, setScenario] = useState<Scenario>(initialState.scenario);
  const [stepByScenario, setStepByScenario] = useState<Record<Scenario, number>>({ signup: 0, referral: 0, invitee: 0, returning: 0, [initialState.scenario]: initialState.step });
  const [mode, setMode] = useState<OnboardingPrototypeMode>(initialState.mode);
  const previewRef = useRef<HTMLElement>(null);
  const step = stepByScenario[scenario];
  const arrivalActive = (scenario === "invitee" && step === 3) || (scenario === "returning" && step === 1);

  useEffect(() => {
    const query = onboardingPrototypeQuery({ scenario, step, mode });
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);
  }, [scenario, step, mode]);

  const setStep = (value: number) => {
    setMode("phone");
    setStepByScenario((current) => ({ ...current, [scenario]: value }));
  };
  const reset = () => {
    setMode("phone");
    setStepByScenario({ signup: 0, referral: 0, invitee: 0, returning: 0 });
  };
  const selectScenario = (value: Scenario) => {
    setMode("phone");
    setScenario(value);
    requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: "start" }));
  };

  return (
    <main className={styles.shell}>
      <PrototypeHeader onReset={reset} />
      <div className={styles.layout}>
        <aside className={styles.reviewMap}>
          <div>
            <span className={styles.kicker}>Proposed build</span>
            <h2>Reusable profiles, built in stages.</h2>
            <p>Review the four entry paths we intend to build now. Managed-traveler claims remain in the backlog.</p>
          </div>
          <nav aria-label="Prototype scenarios" className={styles.scenarioNav}>
            {(Object.keys(scenarioDetails) as Scenario[]).map((key) => (
              <button key={key} type="button" aria-current={scenario === key ? "page" : undefined} onClick={() => selectScenario(key)}>
                <span>{scenarioDetails[key].label}</span>
                <small>{scenarioDetails[key].note}</small>
              </button>
            ))}
          </nav>
          <ol className={styles.stageList}>
            {buildStages.map(([number, title, note]) => (
              <li key={number}><span>{number}</span><p><strong>{title}</strong><small>{note}</small></p></li>
            ))}
          </ol>
        </aside>
        <section ref={previewRef} className={styles.preview} aria-label={`${scenarioDetails[scenario].label} prototype`}>
          <div className={styles.previewMeta}>
            <div><span>Live flow</span><strong>{scenarioDetails[scenario].label}</strong></div>
            <span>{step + 1} of {scenarioDetails[scenario].steps}</span>
          </div>
          <div data-prototype-state={`${scenario}-${step}-${mode}`} className={`${styles.appSurface} ${arrivalActive ? styles.appSurfaceArrival : ""}`}>
            {!arrivalActive ? <AppBar label={scenario === "invitee" || scenario === "returning" ? "Family – Fall Break" : "Commons"} /> : null}
            {scenario === "signup" ? <SignupFlow step={step} setStep={setStep} mode={mode} setMode={setMode} /> : null}
            {scenario === "referral" ? <ReferralFlow step={step} setStep={setStep} mode={mode} setMode={setMode} /> : null}
            {scenario === "invitee" ? <InviteeFlow step={step} setStep={setStep} mode={mode} setMode={setMode} /> : null}
            {scenario === "returning" ? <ReturningFlow step={step} setStep={setStep} /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
