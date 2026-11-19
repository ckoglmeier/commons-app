export const writingSmokeCases = [
  ["Invite note", "Write a short, warm personal note an organizer can include with a beta invitation. The recipient is joining one group trip. Make the invitation feel optional and practical; ask them to use the same email address to sign in. Do not claim that Commons will make bookings, send messages automatically, or manage their calendar."],
  ["First question", "Turn this organizer request into participant-facing copy: ‘We need to pick one of two October weekends. No one has committed yet. I want everyone to say which dates work before we choose.’ Write a concise group message and a poll question. Include the two options exactly as October 10–12 and October 17–19. Say clearly that the poll is not a booking or commitment."],
  ["Recommendation", "Draft a Commons coordinator message for an agreeable group that has not expressed a lodging preference. Recommend a next step without inventing a hotel, price, availability, consensus, or booking. Explain what the organizer should confirm before the group decides. Keep it warm and decisive, under 100 words."],
  ["Share poll", "Write an email-ready note that shares a published group poll. It must say the recipient can answer from the Commons trip page, the response is not a booking or commitment, and the organizer will review the results. Use a placeholder link written exactly as [Open the poll]. Keep it under 90 words."],
] as const;

const unsupportedAction = /\b(?:i|we|commons) (?:booked|sent|invited|scheduled|changed|updated|reserved)\b|\bautomatically\b|\bcalendar\b/i;

export function writingSmokeChecks(text: string, title: string) {
  const checks = [unsupportedAction.test(text) ? "Needs review: unsupported action claim" : "Pass: no unsupported action claim"];
  if (title === "First question") checks.push(text.includes("October 10–12") && text.includes("October 17–19") ? "Pass: date options preserved" : "Needs review: date options changed");
  if (title === "Share poll") checks.push(text.includes("[Open the poll]") ? "Pass: link placeholder preserved" : "Needs review: link placeholder missing");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (title === "Recommendation") checks.push(words <= 100 ? "Pass: under 100 words" : "Needs review: over 100 words");
  if (title === "Share poll") checks.push(words <= 90 ? "Pass: under 90 words" : "Needs review: over 90 words");
  return checks;
}
