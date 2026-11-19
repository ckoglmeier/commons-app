"use client";
import Link from "next/link";
import { useState } from "react";
import { CommonsWordmark, CoordinatorMark } from "@commons/ui";
import { coordinatorPersonalities, type CoordinatorPersonalityId } from "@commons/contracts";
import { personalityExamples, personalityScenario } from "@/lib/coordinator-personality-examples";
import "./coordinator-review.css";
import "./coordinator-personalities-prototype.css";

export function CoordinatorPersonalitiesPrototype() {
  const [mode, setMode] = useState<"compare" | "meet">("compare");
  const [order, setOrder] = useState<CoordinatorPersonalityId[]>([]);
  const [favorite, setFavorite] = useState<CoordinatorPersonalityId | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<CoordinatorPersonalityId>("commons");
  const [preference, setPreference] = useState<"none" | "calm" | "shared" | "explore">("none");
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState("");
  const [descriptionsSeen, setDescriptionsSeen] = useState(false);
  const [priorExposure, setPriorExposure] = useState(false);
  const person = coordinatorPersonalities.find(item => item.id === selected)!;
  const recommended = preference === "calm" ? "joan" : preference === "shared" ? "becky" : preference === "explore" ? "miles" : null;
  function startComparison() {
    const next: CoordinatorPersonalityId[] = coordinatorPersonalities.map(item => item.id);
    for (let index = next.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [next[index], next[other]] = [next[other], next[index]];
    }
    setPriorExposure(descriptionsSeen); setOrder(next); setFavorite(null); setRevealed(false); setReason("");
  }
  function exportFeedback() {
    const data = { specificationVersion: 1, fixture: "parallel-afternoon-v1", condition: "authored_same_plan",
      descriptionsSeenBeforeComparison: priorExposure, comparisonOrder: order, blindFavorite: favorite, identityRevealed: revealed, selectedAfterReveal: selected, statedPreference: preference, reason };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "commons-personality-feedback.json"; anchor.click();
    URL.revokeObjectURL(url); setNotice("Feedback downloaded. Nothing was sent.");
  }
  return <div className="personality-review">
    <header className="personality-brand"><CommonsWordmark /><span>Coordinator exploration</span></header>
    <main>
      <p className="view-kicker">LOCAL DESIGN REVIEW</p>
      <h1>A coordinator that feels right for your group.</h1>
      <p>Same Commons. Same tools and care with your plans. A different way of working through the next decision.</p>
      <p className="review-caption">Authored examples, not a live conversation. Choices here are local to this preview and don’t change a trip.</p>
      <p><Link href="/prototype/coordinator-onboarding/">Try coordinator onboarding and Workspace →</Link></p>
      <nav className="personality-actions" aria-label="Explore coordinators">
        <button className="cm-action" aria-pressed={mode === "compare"} onClick={() => setMode("compare")}>Compare voices</button>
        <button className="cm-action" aria-pressed={mode === "meet"} onClick={() => { setDescriptionsSeen(true); setMode("meet"); }}>Meet the coordinators</button>
      </nav>
      {mode === "compare" ? <section aria-labelledby="compare-title">
        <h2 id="compare-title">Start with the reply.</h2>
        <p>Compare four replies with names hidden, including the current Commons style. Every reply uses the same facts and proposes the same plan.</p>
        <div className="personality-brief"><h3>{personalityScenario.title}</h3><p>{personalityScenario.brief}</p><details><summary>See the plan held constant</summary><p>{personalityScenario.sharedPlan}</p></details></div>
        {!order.length ? <button className="cm-action cm-action--primary" onClick={startComparison}>Start comparison</button> : <>
          <fieldset className="personality-samples"><legend>Which reply would you prefer to work with?</legend>
            {order.map((id, index) => <label key={id} className="personality-sample"><span className="personality-choice"><input type="radio" name="blind-favorite" value={id} checked={favorite === id} disabled={revealed} onChange={() => setFavorite(id)} /><strong>{revealed ? coordinatorPersonalities.find(item => item.id === id)!.name : `Reply ${String.fromCharCode(65 + index)}`}</strong>{favorite === id ? <span>Your choice</span> : null}</span><span>{personalityExamples[id]}</span></label>)}
          </fieldset>
          <label className="personality-note">What made that reply work for you?<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} rows={3} /></label>
          <div className="personality-actions"><button className="cm-action cm-action--primary" disabled={!favorite || revealed} onClick={() => setRevealed(true)}>Reveal coordinators</button><button className="cm-action" onClick={startComparison}>Start over</button></div>
          {revealed ? <p role="status">Your preferred reply was {coordinatorPersonalities.find(item => item.id === favorite)!.name}. Meet the coordinators to compare that reaction with their descriptions.</p> : null}
        </>}
      </section> : <section aria-labelledby="meet-title">
        <h2 id="meet-title">Meet your Commons coordinator.</h2>
        {dismissed ? <><p>You’re keeping the current Commons style in this preview.</p><button className="cm-action" onClick={() => setDismissed(false)}>Explore the options</button></> : <>
          <p>Joan, Becky, and Miles are AI coordinator styles. Each can help with the same planning work. Choosing a style never changes who can approve a decision.</p>
          <label className="personality-note">What would help your group? <span className="review-caption">Optional</span><select value={preference} onChange={event => setPreference(event.target.value as typeof preference)}><option value="none">No preference yet</option><option value="calm">A calm, manageable next step</option><option value="shared">Energy around a shared moment</option><option value="explore">A clear recommendation and alternatives</option></select></label>
          {recommended ? <p className="personality-recommendation">Start with {coordinatorPersonalities.find(item => item.id === recommended)!.name}: you asked for {preference === "calm" ? "a calm next step" : preference === "shared" ? "a shared moment" : "a clear recommendation and alternatives"}. You can choose any style.</p> : null}
          <fieldset className="personality-roster"><legend>Choose a style to preview</legend>{coordinatorPersonalities.map(item => <label key={item.id} className="personality-sample"><span className="personality-choice"><input type="radio" name="coordinator" checked={selected === item.id} onChange={() => setSelected(item.id)} /><strong>{item.name}</strong>{recommended === item.id ? <span>Suggested fit</span> : null}</span><span>{item.description}</span><span className="review-caption">{item.habit}</span></label>)}</fieldset>
          <section className="personality-selected" aria-label="Selected coordinator example"><CoordinatorMark /><div><h3>{person.name} · AI coordinator</h3><p>{personalityExamples[selected]}</p><p className="review-caption">Example reply · Nothing is saved to a trip.</p></div></section>
          <button className="cm-action" onClick={() => { setDismissed(true); setSelected("commons"); setNotice("Kept the current Commons style in this preview."); }}>Keep Commons for now</button>
        </>}
      </section>}
      <footer className="personality-footer"><button className="cm-action" disabled={!revealed} onClick={exportFeedback}>Download comparison feedback</button><p className="review-caption">Complete the comparison and reveal the names first. Feedback stays in your browser until you download it. No trip data is used.</p><p role="status">{notice}</p></footer>
    </main>
  </div>;
}
