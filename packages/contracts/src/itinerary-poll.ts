import { z } from "zod";

export const itineraryDecisionLabels = ["This looks great", "I’m generally supportive, but I have changes", "This doesn’t work for me"] as const;

export const ItineraryPollItemSchema = z.object({
  id: z.string().uuid(), planItemId: z.string().uuid().optional(),
  time: z.string().trim().max(80), title: z.string().trim().min(1).max(160), details: z.string().max(4000),
  kind: z.enum(["activity", "meal", "transport", "open"]), venue: z.string().trim().max(160), status: z.enum(["tentative", "confirmed"]),
  choices: z.object({ question: z.string().trim().min(1).max(240), options: z.array(z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(160),
    // Reviewed public facts only: a reference price/unknown note and a public source link.
    details: z.string().max(300).optional(), url: z.string().url().regex(/^https:\/\//i).max(2048).optional() })).min(2).max(8) }).optional(),
});

/** A reviewed projection; private source text and organizer conversation never belong here. */
export const ItineraryPollSnapshotSchema = z.object({
  title: z.string().trim().min(1).max(120),
  feedbackMode: z.literal("pieces").optional(),
  closing: z.string().max(1000).optional(),
  days: z.array(z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(100), description:z.string().max(4000).default(""), items: z.array(ItineraryPollItemSchema).max(40) })).min(1).max(21),
  otherIdeas: z.array(z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(160), details: z.string().max(1000) })).max(20),
}).superRefine((value, context) => {
  const ids = [...value.days.map(day => day.id), ...value.days.flatMap(day => day.items.map(item => item.id)), ...value.otherIdeas.map(idea => idea.id)];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Each itinerary day and item needs its own identity." });
  if (value.days.flatMap(day => day.items).length > 100) context.addIssue({ code: "custom", message: "Keep this itinerary to 100 items." });
  if (value.days.flatMap(day => day.items).some(item => item.choices && new Set(item.choices.options.map(option => option.label.toLowerCase())).size !== item.choices.options.length)) context.addIssue({ code: "custom", message: "Voting choices need distinct labels." });
  const choiceIds = value.days.flatMap(day => day.items.flatMap(item => item.choices?.options.map(option => option.id) ?? []));
  if (new Set([...ids, ...choiceIds]).size !== ids.length + choiceIds.length) context.addIssue({ code: "custom", message: "Voting choices need unique identities." });
});
export const ItineraryPollFeedbackSchema = z.object({
  comments: z.array(z.object({ id: z.string().uuid(), itemId: z.string().uuid().nullable(), text: z.string().trim().min(1).max(1000) })).max(100),
  interests: z.array(z.object({ itemId: z.string().uuid(), choice: z.enum(["yes", "no"]) })).max(20),
  votes: z.array(z.object({ itemId: z.string().uuid(), optionId: z.string().uuid() })).max(100).optional(),
});
export type ItineraryPollSnapshot = z.infer<typeof ItineraryPollSnapshotSchema>;
export type ItineraryPollItem = z.infer<typeof ItineraryPollItemSchema>;
export type ItineraryPollFeedback = z.infer<typeof ItineraryPollFeedbackSchema>;

export function itineraryFeedbackError(snapshot: ItineraryPollSnapshot | undefined, feedback: ItineraryPollFeedback | undefined) {
  if (!feedback) return null;
  if (!snapshot) return "Itinerary feedback needs an itinerary question.";
  const itemIds = new Set([...snapshot.days.flatMap(day => day.items.map(item => item.id)), ...snapshot.otherIdeas.map(idea => idea.id)]);
  const ideaIds = new Set(snapshot.otherIdeas.map(idea => idea.id));
  if (feedback.comments.some(comment => comment.itemId !== null && !itemIds.has(comment.itemId))) return "That itinerary item is not in this published version.";
  if (feedback.interests.some(interest => !ideaIds.has(interest.itemId))) return "Choose interest only for the optional ideas in this version.";
  if (new Set(feedback.comments.map(comment => comment.id)).size !== feedback.comments.length) return "Each comment needs its own identity.";
  if (new Set(feedback.interests.map(interest => interest.itemId)).size !== feedback.interests.length) return "Choose one response per optional idea.";
  if (new Set(feedback.votes?.map(vote => vote.itemId)).size !== (feedback.votes?.length ?? 0)) return "Choose one option per itinerary stop.";
  if (feedback.votes?.some(vote => !snapshot.days.flatMap(day => day.items).some(item => item.id === vote.itemId && item.choices?.options.some(option => option.id === vote.optionId)))) return "That voting option is not in this published itinerary version.";
  return null;
}
