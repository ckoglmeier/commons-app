/** Isolated synthetic state. This module has no application commands or services. */
export const STORAGE_KEY = "commons.recipe-coordinator.prototype.v1";
export const SAMPLE_GOAL = "Reach a strong date-and-place fit for our seven-person wine-country trip, with a few useful rounds";
export const goalMatchesSample = (task: Task) => task.goal.trim() === SAMPLE_GOAL;
export const people = ["Robin", "Maya", "Jules", "Dev", "Priya", "Nico", "Tess"];
export const sampleAnswers = people.map(name => ({ name,
  firstDate: name === "Maya" ? "Maybe" : "Yes",
  secondDate: ["Robin", "Jules", "Dev"].includes(name) ? "Yes" : ["Priya", "Nico"].includes(name) ? "Maybe" : "No",
  sonoma: ["Robin", "Jules", "Dev", "Priya"].includes(name) ? "Top choice" : name === "Maya" ? "Could go" : "Interested",
  napa: ["Maya", "Jules"].includes(name) ? "Top choice" : ["Robin", "Dev", "Tess"].includes(name) ? "Interested" : name === "Priya" ? "Could go" : "Not interested",
  firstCombination: true, secondCombination: ["Robin", "Jules", "Dev"].includes(name),
  dinner: ["Robin", "Maya"].includes(name) ? "Keep dinner flexible" : "A casual group dinner",
  need: name === "Maya" ? "I can’t take Thursday off. I could arrive Friday evening." : null,
}));
export type Destination = "main" | "recipe";
export type Pane = "tasks" | "conversation" | "work";
export type Question = { id: string; prompt: string; kind: "dates" | "interest" | "combination" | "choice" | "text"; required: boolean; options: string[] };
export type Round = { id: string; number: number; title: string; message: string; questions: Question[]; shared: boolean; coverage: 0 | 3 | 7 };
export type Turn = { id: string; who: "Robin" | "Commons"; text: string };
export type Task = { id: "wine-country-fit"; goal: string; rounds: Round[]; turns: Turn[]; needResolution: string; decision: { option: string; resolution: string; roundId: string } | null; applied: boolean };
export type DemoState = { version: 1; ready: boolean; selected: Destination; pane: Pane; drafts: Record<Destination, string>; mainTurns: Turn[]; task: Task | null; quick: Round | null; inspectedRound: string | null };
const turn = (who: Turn["who"], text: string): Turn => ({ id: crypto.randomUUID(), who, text });
const optionDates = ["May 14–16, 2027 · Friday–Sunday", "May 20–22, 2027 · Thursday–Saturday"];
export function makeRound(number = 1): Round {
  return { id: crypto.randomUUID(), number, title: number === 1 ? "A wine-country weekend that works" : "Confirm our date and place", message: number === 1 ? "Let’s find a wine-country weekend that works for the seven of us. Please mark your date availability and destination interest. Tell Robin about any constraint we should account for." : "Sonoma and May 14–16 look promising from our first round. Could you make that combination? Maya could join Friday evening; no Thursday travel would be expected. This is still planning, not an RSVP.", shared: false, coverage: 0,
    questions: number === 1 ? [
      { id: crypto.randomUUID(), kind: "dates", prompt: "Which dates could you do?", required: true, options: [...optionDates] },
      { id: crypto.randomUUID(), kind: "interest", prompt: "How interested are you in each destination?", required: true, options: ["Sonoma", "Napa"] },
    ] : [{ id: crypto.randomUUID(), kind: "combination", prompt: "Select every combination that works for you.", required: true, options: ["May 14–16, 2027 · Sonoma", "May 20–22, 2027 · Napa"] }] };
}
export function initialDemo(): DemoState {
  return { version: 1, ready: false, selected: "main", pane: "conversation", drafts: { main: "", recipe: "" }, mainTurns: [{ id: "welcome", who: "Commons", text: "What would you like to work on for wine country? A Goal keeps the outcome, its conversation and every round together. A quick poll stays here." }], task: null, quick: null, inspectedRound: null };
}
export function currentRound(state: DemoState): Round | null { return state.selected === "recipe" ? state.task?.rounds.at(-1) ?? null : state.quick; }
export function taskStatus(task: Task): string { return !goalMatchesSample(task) ? "Goal changed · needs review" : task.applied ? "Completed" : task.decision ? "Decision reviewed" : task.rounds.at(-1)?.coverage ? "Review answers" : task.rounds.at(-1)?.shared ? "Waiting for responses" : "Draft"; }
export function fixtureCompatible(round: Round): boolean {
  const expected = round.title === "Friday dinner" ? { title: "Friday dinner", message: "For Friday dinner, which would you prefer? This is a quick preference check, not a reservation.", questions: [{ prompt: "Friday dinner preference", kind: "choice", required: true, options: ["A casual group dinner", "Keep dinner flexible"] }] } : makeRound(round.number);
  const projection = (item: Pick<Round, "title" | "message" | "questions">) => ({ title: item.title, message: item.message, questions: item.questions.map(question => ({ prompt: question.prompt, kind: question.kind, required: question.required, options: question.options })) });
  return JSON.stringify(projection(round)) === JSON.stringify(projection(expected as Pick<Round, "title" | "message" | "questions">));
}
export type Action =
  | { type: "restore"; state?: DemoState }
  | { type: "reset" }
  | { type: "select"; destination: Destination }
  | { type: "pane"; pane: Pane }
  | { type: "start-recipe" }
  | { type: "quick-poll" }
  | { type: "draft"; text: string }
  | { type: "send"; text: string }
  | { type: "goal"; text: string }
  | { type: "edit-round"; round: Round }
  | { type: "share" }
  | { type: "responses"; count: 3 | 7 }
  | { type: "follow-up" }
  | { type: "inspect"; roundId: string | null }
  | { type: "resolve-need"; text: string }
  | { type: "approve"; option: string }
  | { type: "apply-trip" };
function append(state: DemoState, ...turns: Turn[]): DemoState { return state.selected === "recipe" && state.task ? { ...state, task: { ...state.task, turns: [...state.task.turns, ...turns] } } : { ...state, mainTurns: [...state.mainTurns, ...turns] }; }
function replaceRound(state: DemoState, round: Round): DemoState { return state.selected === "recipe" && state.task ? { ...state, task: { ...state.task, rounds: state.task.rounds.map(item => item.id === round.id ? round : item) } } : { ...state, quick: round }; }
export function demoReducer(state: DemoState, action: Action): DemoState {
  const round = currentRound(state);
  switch (action.type) {
    case "restore": return { ...(action.state ?? state), ready: true };
    case "reset": return { ...initialDemo(), ready: true };
    case "pane": return { ...state, pane: action.pane };
    case "select": return action.destination === "recipe" && !state.task ? state : { ...state, selected: action.destination, pane: "conversation", inspectedRound: null };
    case "start-recipe": return { ...state, selected: "recipe", pane: "work", inspectedRound: null, task: state.task ?? { id: "wine-country-fit", goal: "Reach a strong date-and-place fit for our seven-person wine-country trip, with a few useful rounds", rounds: [makeRound()], turns: [turn("Robin", "Set our goal: a date-and-place combination that works for the group, with stated constraints handled and organizer approval."), turn("Commons", "Goal set in one focused conversation. I recommend dates and destination interest together as the smallest useful next ask. A few useful questions now may avoid extra rounds; the goal is a strong fit, not simply fewer questions. The proposed group message is in Work. Nothing has been shared.")], needResolution: "", decision: null, applied: false } };
    case "quick-poll": {
      if (state.quick) return { ...state, selected: "main", pane: "work", inspectedRound: null };
      const quick: Round = { id: crypto.randomUUID(), number: 1, title: "Friday dinner", message: "For Friday dinner, which would you prefer? This is a quick preference check, not a reservation.", questions: [{ id: crypto.randomUUID(), kind: "choice", prompt: "Friday dinner preference", required: true, options: ["A casual group dinner", "Keep dinner flexible"] }], shared: false, coverage: 0 };
      return { ...state, selected: "main", pane: "work", quick, inspectedRound: null, mainTurns: [...state.mainTurns, turn("Robin", "Prepare a quick poll about Friday dinner."), turn("Commons", "The private quick poll is in Work. It stays in this conversation; no goal was created.")] };
    }
    case "draft": return { ...state, drafts: { ...state.drafts, [state.selected]: action.text } };
    case "goal": return state.task ? { ...state, task: { ...state.task, goal: action.text.slice(0, 180) } } : state;
    case "edit-round": return round && !round.shared && action.round.id === round.id ? replaceRound(state, action.round) : state;
    case "share": return round && !round.shared && roundError(round) === null ? append(replaceRound(state, { ...round, shared: true }), turn("Commons", `Demo round ${round.number} shared with seven synthetic invitees. No link or notification was sent. The questions are now a fixed snapshot; use Demo controls to load sample answers.`)) : state;
    case "responses": return round?.shared && fixtureCompatible(round) && round.coverage < action.count ? append(replaceRound(state, { ...round, coverage: action.count }), turn("Commons", action.count === 3 ? "Three of seven sample responses are available. Four people have not answered; silence is not agreement. Review the partial evidence in Work." : state.selected === "recipe" && round.number === 1 ? "All seven sample responses are available. The first date and Sonoma are promising independently, not yet a confirmed combination. Maya cannot travel on Thursday. A focused follow-up can check the combination and that constraint." : "All seven sample responses are available. Review the exact answers and any stated need in Work; a poll is input, not a decision.")) : state;
    case "follow-up": {
      if (!state.task || state.selected !== "recipe" || !round?.shared || !fixtureCompatible(round) || round.coverage !== 7 || round.number !== 1 || state.task.decision) return state;
      return append({ ...state, pane: "work", inspectedRound: null, task: { ...state.task, rounds: [...state.task.rounds, makeRound(2)] } }, turn("Robin", "Prepare a follow-up to check the date-and-place fit."), turn("Commons", "Round 2 is a new private draft in the same goal. Round 1 remains evidence, and none of its votes were copied. Review the proposed Friday-arrival accommodation before sharing."));
    }
    case "inspect": return { ...state, inspectedRound: action.roundId, pane: "work" };
    case "resolve-need": return state.task && !state.task.decision ? { ...state, task: { ...state.task, needResolution: action.text } } : state;
    case "approve": {
      if (state.task && !goalMatchesSample(state.task)) return state;
      if (state.selected !== "recipe" || !state.task || state.task.decision || !round?.shared || !fixtureCompatible(round) || round.number < 2 || round.coverage !== 7 || !state.task.needResolution.trim() || round.questions.find(question => question.kind === "combination")?.options[0] !== action.option) return state;
      return append({ ...state, task: { ...state.task, decision: { option: action.option, resolution: state.task.needResolution.trim(), roundId: round.id } } }, turn("Robin", `Reviewed decision: ${action.option}.`), turn("Commons", "Robin recorded the demo decision and Maya’s accommodation. The trip has not changed. The separate Update demo trip control names the fields it would change."));
    }
    case "apply-trip": {
      if (state.task && !goalMatchesSample(state.task)) return state;
      if (!state.task?.decision || state.task.applied) return state;
      return { ...state, task: { ...state.task, applied: true, turns: [...state.task.turns, turn("Commons", "Demo trip dates and location updated from the reviewed decision. Nothing was booked, paid for or sent.")] }, mainTurns: [...state.mainTurns, turn("Commons", `The date-and-location goal is complete: ${state.task.decision.option}. Robin reviewed the decision and updated only the demo trip. The goal retains both rounds and Maya’s accommodation.`)] };
    }
    case "send": {
      const text = action.text.trim();
      if (!text) return state;
      const normalized = text.toLocaleLowerCase().replace(/[?.!]/g, "").trim();
      if (["pick a date and location", "start date and location recipe", "resume date and location"].includes(normalized)) return demoReducer({ ...state, drafts: { ...state.drafts, [state.selected]: "" } }, { type: "start-recipe" });
      if (normalized === "prepare a quick poll") return demoReducer({ ...state, drafts: { ...state.drafts, [state.selected]: "" } }, { type: "quick-poll" });
      let response = "This preview supports only the example prompts shown below. No AI is connected and nothing changed. You can edit the draft directly in Work.";
      let pane = state.pane;
      if (normalized === "where are we") response = state.selected === "recipe" && state.task ? `${taskStatus(state.task)} · ${state.task.goal}. ${state.task.applied ? "The decision and both rounds are in Work." : state.task.decision ? "The reviewed decision is ready for a separate demo trip update." : round?.coverage ? `${round.coverage} of seven sample answers. Review the evidence before deciding.` : round?.shared ? "Waiting for sample answers; load them explicitly with Demo controls." : "The proposed questions are private in Work."}` : state.task ? `The goal is ${taskStatus(state.task).toLocaleLowerCase()}. Open the goal to resume its conversation and evidence. Your quick poll stays here.` : "No goal has started. Choose the date-and-location goal, or prepare a quick poll in this conversation.";
      if (normalized === "show the questions") { pane = "work"; response = round ? "Opened this conversation’s working material. No questions were changed or shared." : "There is no working draft here yet. Choose the goal or quick poll starter."; }
      if (normalized === "why another round") response = "Round 1 measured dates and destination interest separately. It cannot prove the combination works for the same people. The follow-up asks directly about date-and-place feasibility, with Maya’s Thursday-travel need visible.";
      if (normalized === "ask dates only" && round && !round.shared) {
        const dates = round.questions.filter(question => question.kind === "dates");
        if (dates.length) { state = replaceRound(state, { ...round, questions: dates }); response = "The private draft now asks only about dates. Destination fit will remain open; review the draft before sharing."; pane = "work"; }
        else response = "This draft has no separate date-availability question. Nothing changed; edit the questions in Work.";
      }
      return append({ ...state, pane, drafts: { ...state.drafts, [state.selected]: "" } }, turn("Robin", text), turn("Commons", response));
    }
  }
}
export function roundError(round: Round): string | null {
  if (!round.title.trim() || !round.message.trim()) return "Add a title and a group message.";
  if (!round.questions.length) return "Keep at least one question.";
  if (round.questions.some(question => !question.prompt.trim() || question.kind !== "text" && (question.options.length < 2 || question.options.some(option => !option.trim())))) return "Give each question a prompt and at least two complete options.";
  if (round.questions.some(question => new Set(question.options.map(option => option.trim().toLocaleLowerCase())).size !== question.options.length)) return "Each option in a question must be different.";
  return null;
}
export function restoreDemo(raw: string | null): DemoState | undefined {
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as DemoState;
    if (value.version !== 1 || !["main", "recipe"].includes(value.selected) || !["tasks", "conversation", "work"].includes(value.pane) || !value.drafts || typeof value.drafts.main !== "string" || typeof value.drafts.recipe !== "string" || !Array.isArray(value.mainTurns)) return;
    const validRound = (round: Round) => typeof round.id === "string" && typeof round.title === "string" && typeof round.message === "string" && typeof round.shared === "boolean" && [0, 3, 7].includes(round.coverage) && Array.isArray(round.questions) && round.questions.every(question => typeof question.id === "string" && typeof question.prompt === "string" && ["dates", "interest", "combination", "choice", "text"].includes(question.kind) && Array.isArray(question.options) && question.options.every(option => typeof option === "string"));
    if (value.quick && !validRound(value.quick) || value.task && (value.task.id !== "wine-country-fit" || typeof value.task.goal !== "string" || typeof value.task.needResolution !== "string" || !Array.isArray(value.task.rounds) || !value.task.rounds.length || !value.task.rounds.every(validRound) || !Array.isArray(value.task.turns))) return;
    return value;
  } catch { return; }
}
