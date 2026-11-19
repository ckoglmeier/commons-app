"use client";

import { createContext, useContext, type ReactNode } from "react";
import { feedbackMailto } from "@/lib/feedback-contact";

/*
 * Feedback is a plain email to whoever runs this copy of Commons (instanceSettings().contactEmail). The address is read on the server and passed
 * down by the root layout, so no client code reads the environment. With no contact email set there is no feedback entry at all.
 */
const FeedbackEmailContext = createContext<string | null>(null);

export function FeedbackEmailProvider({ email, children }: { email: string | null; children: ReactNode }) {
  return <FeedbackEmailContext.Provider value={email}>{children}</FeedbackEmailContext.Provider>;
}

export function useFeedbackEmail() {
  return useContext(FeedbackEmailContext);
}

/** The feedback link for the current page. Call it from a click handler so the path is read in the browser, never during render. */
export function feedbackHref(email: string) {
  return feedbackMailto(email, { pagePath: typeof window === "undefined" ? "/" : window.location.pathname + window.location.search });
}
