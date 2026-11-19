"use client";
import { useCallback, useEffect, useState } from "react";
import { PollDetailSchema, type PollDetail } from "@commons/contracts";
import { itineraryResults } from "@/lib/itinerary-workshop";

export function ItineraryFeedbackResults({ slug, pollId, initialPoll, showHeading = true }: { slug: string; pollId: string; initialPoll?: PollDetail; showHeading?:boolean }) {
  const [poll, setPoll] = useState(initialPoll), [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/v1/commons/${slug}/polls/${pollId}`, { cache: "no-store", signal });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Poll results could not load.");
      if (!signal?.aborted) { setPoll(PollDetailSchema.parse(payload.poll)); setError(""); }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Poll results could not load."); }
  }, [slug, pollId]);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetches authoritative external state; setters run after the request.
    if (!initialPoll) void refresh(controller.signal);
    const onFocus = () => void refresh(controller.signal);
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [refresh, initialPoll]);
  const results = poll ? itineraryResults(poll) : null;
  return <section className="itinerary-feedback-results" aria-label="Poll results">{showHeading ? <h2>Poll results</h2> : null}
    <button className="cm-action" onClick={() => void refresh()}>Refresh results</button>
    {error ? <p role="alert">{error}</p> : null}
    {!results ? <p role="status">{error ? "Results are unavailable." : "Loading results…"}</p> : <>
      <p>{results.responses.length} {results.responses.length === 1 ? "person has" : "people have"} responded.</p>
      {poll?.identityBound && poll.audienceReview ? <p>{Math.max(0, poll.audienceReview.personIds.length + poll.audienceReview.guestEmails.length - results.responses.length)} haven’t responded.</p> : null}
      {results.question.itinerary.feedbackMode !== "pieces" ? <section><h3>The whole itinerary</h3>{results.decisions.map(decision => <div key={decision.id}><strong>{decision.people.length} · {decision.label}</strong><p>{decision.people.join(", ") || "No responses yet"}</p></div>)}</section> : null}
      {results.choices.map(choice => <section key={choice.id}><h3>{choice.question}</h3>{choice.options.map(option => <div key={option.id}><strong>{option.label}</strong><p>{option.people.length} {option.people.length === 1 ? "preference" : "preferences"}{option.people.length ? ` · ${option.people.join(", ")}` : ""}</p></div>)}</section>)}
      <section><h3>Comments and suggestions</h3>{results.comments.length ? <ul>{results.comments.map(comment => <li key={`${comment.name}:${comment.id}`}><strong>{comment.name}</strong>{comment.itemId ? <p>{results.question.itinerary.days.flatMap(day => day.items).find(item => item.id === comment.itemId)?.title ?? results.question.itinerary.otherIdeas.find(item => item.id === comment.itemId)?.title}</p> : null}<p>{comment.text}</p></li>)}</ul> : <p>No comments yet.</p>}</section>
      {results.ideas.length ? <section><h3>Other ideas</h3>{results.ideas.map(idea => <div key={idea.id}><strong>{idea.title}</strong><p>{idea.interested.length} interested{idea.interested.length ? ` · ${idea.interested.join(", ")}` : ""}</p><p>{idea.declined.length} not interested{idea.declined.length ? ` · ${idea.declined.join(", ")}` : ""}</p></div>)}</section> : null}
      {poll?.superseded ? <p role="status">These responses belong to the previous version.</p> : null}
    </>}
  </section>;
}
