import { ItineraryPollSnapshotSchema, type ItineraryPollSnapshot, type ItineraryPollItem, type PollWorkingData, type PollWorkingDraft, type PollQuestion, type PollDetail } from "@commons/contracts";

export function itineraryQuestion(questions: Array<PollQuestion | PollWorkingData["questions"][number]>) {
  return questions.find((question): question is Extract<PollQuestion, { kind: "choice" }> & { itinerary: ItineraryPollSnapshot } => question.kind === "choice" && Boolean(question.itinerary));
}

export function newItineraryItem(title = "New activity", id: string = crypto.randomUUID()): ItineraryPollItem {
  return { id, time: "", title, details: "", venue: "", kind: /lunch|dinner|breakfast/i.test(title) ? "meal" : /drive|depart|arriv|land|check.out/i.test(title) ? "transport" : "activity", status: "tentative" };
}

export function newItineraryDraft(title: string, id: () => string = () => crypto.randomUUID()): PollWorkingData {
  return {
    title, intro: null, ballotMode: "transparent", presentationVersion: 2,
    communication: { heading: title, paragraphs: ["Here’s our proposed itinerary. Let us know what works for you and what you’d change."], links: [] },
    questions: [{ id: id(), kind: "choice", prompt: "Suggestions and preferences for the itinerary", required: false, selectionMode: "single",
      options: [],
      itinerary: { title, feedbackMode: "pieces", days: [{ id: id(), label: "Day 1", description:"", items: [] }], otherIdeas: [] },
    }],
  };
}

const weekdayHeading = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*[:–—,(-].*|\s+(?:\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*)?$/i;
const dayHeading = /^(?:Day\s+\d+)(?:\s*[:–—,-].*)?$/i;
const clock = String.raw`\d{1,2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?`;
const timedLine = new RegExp(String.raw`^(${clock}(?:\s*(?:/|[-–—]|or)\s*${clock})*)(?:\s*[:–—-]\s+|\s+)(.+)$`, "i");
const onlyTime = new RegExp(String.raw`^${clock}(?:\s*(?:/|[-–—]|or)\s*${clock})*$`, "i");
const cleanHeading = (line: string) => line.replace(/^#{1,6}\s+/, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
function isDayHeading(line: string) {
  const plain = cleanHeading(line);
  return weekdayHeading.test(plain) || dayHeading.test(plain) || /^#{1,2}\s+/.test(line);
}

/** Recognize structured schedules before a chat textarea can truncate a clipboard paste. */
export function isItineraryPaste(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.some(isDayHeading) && lines.filter(line => /^(?:[-*•]\s+|\|)/.test(line) || timedLine.test(cleanHeading(line)) || onlyTime.test(line)).length >= 2;
}

/** Import Markdown or rendered clipboard text without inference or shifting supplied dates/times. */
export function parseItineraryText(text: string, title: string, id: () => string = () => crypto.randomUUID()): ItineraryPollSnapshot {
  const days: ItineraryPollSnapshot["days"] = [], otherIdeas: ItineraryPollSnapshot["otherIdeas"] = [];
  let day: ItineraryPollSnapshot["days"][number] | undefined, item: ItineraryPollItem | undefined;
  let ideas = false, pendingTime = "", preamble = "";
  const lines = text.split(/\r?\n/);
  const hasHeadings = lines.some(line => isDayHeading(line.trim()));
  const ensureDay = () => day ?? (day = { id: id(), label: "Itinerary", description: "", items: [] }, days.push(day), day);
  const addItem = (label: string, time = "") => {
    item = { ...newItineraryItem(label, id()), time }; ensureDay().items.push(item);
  };
  for (const raw of lines) {
    const line = raw.trim(), plain = cleanHeading(line);
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;
    if (pendingTime && (isDayHeading(line) || /^(?:Other ideas(?: if they fit)?|Optional (?:ideas|activities)|Ideas if they fit):?$/i.test(plain))) throw new Error("Add the activity after each time before starting another day or optional ideas.");
    if (/^(?:Other ideas(?: if they fit)?|Optional (?:ideas|activities)|Ideas if they fit):?$/i.test(plain)) { ideas = true; item = undefined; continue; }
    if (isDayHeading(line)) {
      ideas = false; pendingTime = "";
      day = { id: id(), label: plain, description: preamble, items: [] }; preamble = "";
      days.push(day); item = undefined; continue;
    }
    if (ideas) {
      const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
      if (bullet || /^#{3,}\s+/.test(line) || !otherIdeas.length) otherIdeas.push({ id: id(), title: cleanHeading(bullet?.[1] ?? line), details: "" });
      else { const idea = otherIdeas.at(-1)!; idea.details += `${idea.details ? "\n\n" : ""}${raw}`; }
      continue;
    }
    const cells = line.startsWith("|") ? line.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()) : line.includes("\t") ? line.split(/\t+/).map(cell => cell.trim()) : null;
    if (cells && (/^time$/i.test(cells[0]) || cells.every(cell => /^:?-+:?$/.test(cell)))) continue;
    // Some rich-text tables copy each cell on its own line.
    if (/^(?:Time|Plan)$/i.test(line)) continue;
    if (cells && cells.length >= 2) { addItem(cells.slice(1).join(" · "), cells[0]); continue; }
    if (pendingTime) { addItem(plain, pendingTime); pendingTime = ""; continue; }
    if (onlyTime.test(plain) && /[:apm–—/-]|\bor\b/i.test(plain)) { pendingTime = plain; continue; }
    const timed = plain.match(timedLine);
    if (timed && /[:apm–—/-]|\bor\b/i.test(timed[1])) { addItem(timed[2], timed[1]); continue; }
    if (/^#{3,}\s+/.test(line)) { addItem(plain); continue; }
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) addItem(bullet[1]);
    else if (item) item.details += `${item.details ? "\n\n" : ""}${raw}`;
    else if (day) day.description += `${day.description ? "\n\n" : ""}${raw}`;
    else if (hasHeadings) preamble += `${preamble ? "\n\n" : ""}${raw}`;
    else addItem(plain);
  }
  if (pendingTime) throw new Error("Add the activity after the last time, then review the itinerary again.");
  if (!days.some(entry => entry.items.length)) throw new Error("Add day headings and activities, then review the itinerary again.");
  const parsed = ItineraryPollSnapshotSchema.safeParse({ title, days, otherIdeas });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.path.includes("label")) throw new Error("A day heading is too long. Keep each heading under 100 characters and put its notes on the next line.");
    if (issue.path.includes("title")) throw new Error("An activity title is too long. Put its description on the next line, or separate activities with times or bullets.");
    throw new Error("This itinerary is too large to import in one draft. Use up to 21 days and 100 activities, with shorter notes.");
  }
  return parsed.data;
}

export function itineraryPublicationInput(draft: PollWorkingDraft, commandId: string, access: "invitees" | "link") {
  return { title: draft.data.title, intro: draft.data.intro, ballotMode: draft.data.ballotMode, questions: draft.data.questions,
    communication: draft.data.communication, commandId, draftId: draft.id, draftVersion: draft.version, publicationApproval: { approved: true as const, access } };
}

export function itineraryResults(poll: PollDetail) {
  const question = itineraryQuestion(poll.questions);
  if (!question) return null;
  const responses = poll.responses.flatMap(response => {
    const answer = response.answers?.find(answer => answer.questionId === question.id);
    return answer ? [{ ...response, answer }] : [];
  });
  return { question, responses,
    decisions: question.options.map(option => ({ ...option, people: responses.filter(response => response.answer.optionIds.includes(option.id)).map(response => response.respondentName) })),
    choices: question.itinerary.days.flatMap(day => day.items.filter(item => item.choices).map(item => ({ id: item.id, title: item.title, question: item.choices!.question, options: item.choices!.options.map(option => ({ ...option, people: responses.filter(response => response.answer.itineraryFeedback?.votes?.some(vote => vote.itemId === item.id && vote.optionId === option.id)).map(response => response.respondentName) })) }))),
    comments: responses.flatMap(response => (response.answer.itineraryFeedback?.comments ?? []).map(comment => ({ ...comment, name: response.respondentName }))),
    ideas: question.itinerary.otherIdeas.map(idea => ({ ...idea,
      interested: responses.filter(response => response.answer.itineraryFeedback?.interests.some(interest => interest.itemId === idea.id && interest.choice === "yes")).map(response => response.respondentName),
      declined: responses.filter(response => response.answer.itineraryFeedback?.interests.some(interest => interest.itemId === idea.id && interest.choice === "no")).map(response => response.respondentName),
    })),
  };
}
