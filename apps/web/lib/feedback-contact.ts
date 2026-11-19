import { feedbackPagePath } from "@commons/contracts";

/** A mailto link to whoever runs this copy of Commons, with the safe page path as context. No feedback is stored by the app. */
export function feedbackMailto(email: string, input: { pagePath: string }) {
  const body = `Page: ${feedbackPagePath(input.pagePath)}\n\n`;
  return `mailto:${email}?subject=${encodeURIComponent("Commons feedback")}&body=${encodeURIComponent(body)}`;
}
