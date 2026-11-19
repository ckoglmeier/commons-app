import { feedbackPagePath } from "@commons/contracts";

export const feedbackContactEmail = "support@updates.commons.travel";

export function feedbackScreenshotEmail(input: { message: string; pagePath: string; feedbackId?: string }) {
  const reference = input.feedbackId ? `Feedback reference: ${input.feedbackId}\n` : "";
  const body = `${reference}Page: ${feedbackPagePath(input.pagePath)}\n\n${input.message.trim()}\n\n[Attach your screenshot before sending.]`;
  return `mailto:${feedbackContactEmail}?subject=${encodeURIComponent("Commons bug screenshot")}&body=${encodeURIComponent(body)}`;
}
