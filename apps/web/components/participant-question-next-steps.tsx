"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { RecipientParticipantQuestion } from "@commons/contracts";

/** The signed-in traveler's open questions, in Home's next steps. A failed read renders nothing: Home shows no error for an optional surface. */
export function ParticipantQuestionNextSteps({ slug }: { slug: string }) {
  const [questions, setQuestions] = useState<RecipientParticipantQuestion[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/questions`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { questions?: RecipientParticipantQuestion[] };
        if (live && Array.isArray(body.questions)) setQuestions(body.questions);
      } catch { /* Nothing to show. */ }
    })();
    return () => { live = false; };
  }, [slug]);
  const waiting = questions.filter(item => item.state === "waiting" && item.canAnswer);
  if (!waiting.length) return null;
  return <ul className="home-next-steps__list">{waiting.map(item => <li key={item.questionId}>
    <Link className="home-next-step" href={`/c/${slug}/questions/${item.questionId}`}>
      <strong>{item.askedBy} asked you a question</strong><span>{item.question}</span>
      <small>Answer by <time dateTime={item.expiresAt} suppressHydrationWarning>{new Date(item.expiresAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></small>
    </Link>
  </li>)}</ul>;
}
