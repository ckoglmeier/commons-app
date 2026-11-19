export type OnboardingPrototypeScenario = "signup" | "referral" | "invitee" | "returning";
export type OnboardingPrototypeMode = "phone" | "email";

export type OnboardingPrototypeState = {
  id: string;
  scenario: OnboardingPrototypeScenario;
  step: number;
  mode: OnboardingPrototypeMode;
  heading: string;
  primaryAction: string;
};

export const onboardingPrototypeSteps: Record<OnboardingPrototypeScenario, number> = {
  signup: 3,
  referral: 4,
  invitee: 5,
  returning: 3,
};

export const onboardingPrototypeStates: readonly OnboardingPrototypeState[] = [
  { id: "signup-identity", scenario: "signup", step: 0, mode: "phone", heading: "Your events start here.", primaryAction: "Send verification code" },
  { id: "signup-code", scenario: "signup", step: 1, mode: "phone", heading: "Enter the code we sent.", primaryAction: "Verify and sign in" },
  { id: "signup-email", scenario: "signup", step: 0, mode: "email", heading: "Use your email instead.", primaryAction: "Send sign-in link" },
  { id: "signup-ready", scenario: "signup", step: 2, mode: "phone", heading: "Welcome, Casey.", primaryAction: "Start an event" },
  { id: "referral-landing", scenario: "referral", step: 0, mode: "phone", heading: "Plan with Commons.", primaryAction: "Accept invitation" },
  { id: "referral-identity", scenario: "referral", step: 1, mode: "phone", heading: "Your events start here.", primaryAction: "Send verification code" },
  { id: "referral-code", scenario: "referral", step: 2, mode: "phone", heading: "Enter the code we sent.", primaryAction: "Verify and accept invitation" },
  { id: "referral-email", scenario: "referral", step: 1, mode: "email", heading: "Use your email instead.", primaryAction: "Send sign-in link" },
  { id: "referral-ready", scenario: "referral", step: 3, mode: "phone", heading: "Welcome, Maya.", primaryAction: "Start an event" },
  { id: "invite-landing", scenario: "invitee", step: 0, mode: "phone", heading: "Family – Fall Break", primaryAction: "Continue to the trip" },
  { id: "invite-identity", scenario: "invitee", step: 1, mode: "phone", heading: "What should the group call you?", primaryAction: "Send verification code" },
  { id: "invite-code", scenario: "invitee", step: 2, mode: "phone", heading: "Enter the code we sent.", primaryAction: "Verify and continue" },
  { id: "invite-email", scenario: "invitee", step: 1, mode: "email", heading: "Use your email instead.", primaryAction: "Send sign-in link" },
  { id: "invite-ready", scenario: "invitee", step: 3, mode: "phone", heading: "Family – Fall Break", primaryAction: "View the trip" },
  { id: "invite-entered", scenario: "invitee", step: 4, mode: "phone", heading: "The trip is open.", primaryAction: "View the plan" },
  { id: "returning-landing", scenario: "returning", step: 0, mode: "phone", heading: "Family – Fall Break", primaryAction: "Open Family – Fall Break" },
  { id: "returning-ready", scenario: "returning", step: 1, mode: "phone", heading: "Family – Fall Break", primaryAction: "View the trip" },
  { id: "returning-entered", scenario: "returning", step: 2, mode: "phone", heading: "The trip is open.", primaryAction: "View the plan" },
] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseOnboardingPrototypeState(params: {
  scenario?: string | string[];
  step?: string | string[];
  mode?: string | string[];
}): Pick<OnboardingPrototypeState, "scenario" | "step" | "mode"> {
  const rawScenario = first(params.scenario);
  const scenario: OnboardingPrototypeScenario =
    rawScenario === "referral" || rawScenario === "invitee" || rawScenario === "returning" ? rawScenario : "signup";
  const parsedStep = Number.parseInt(first(params.step) ?? "0", 10);
  const step = Number.isFinite(parsedStep)
    ? Math.min(Math.max(parsedStep, 0), onboardingPrototypeSteps[scenario] - 1)
    : 0;
  const mode: OnboardingPrototypeMode = first(params.mode) === "email" && (
    (scenario === "signup" && step === 0) ||
    (scenario === "referral" && step === 1) ||
    (scenario === "invitee" && step === 1)
  ) ? "email" : "phone";
  return { scenario, step, mode };
}

export function onboardingPrototypeQuery(state: Pick<OnboardingPrototypeState, "scenario" | "step" | "mode">) {
  const params = new URLSearchParams({ scenario: state.scenario, step: String(state.step) });
  if (state.mode === "email") params.set("mode", "email");
  return `?${params.toString()}`;
}
