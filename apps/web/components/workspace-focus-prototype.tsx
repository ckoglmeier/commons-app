"use client";

import { useState } from "react";
import { CoordinatorMark } from "@commons/ui";
import { GlobalNavigation } from "./global-navigation";
import "./workspace-focus-prototype.css";

export function WorkspaceFocusPrototype() {
  const [task, setTask] = useState<"hotel" | "fishing">("hotel");
  const [collapsed, setCollapsed] = useState(false);
  const [artifactCollapsed, setArtifactCollapsed] = useState(false);
  const [view, setView] = useState("conversation");
  const [intro, setIntro] = useState("We’ve chosen our weekend. Now let’s find a place that works for everyone.");
  const [note, setNote] = useState("Hi everyone! Here are two possibilities for our weekend. Nothing is held or booked. Choose every option that works for you.");
  const [prompts, setPrompts] = useState({ hotel: "", fishing: "" });
  const [messages, setMessages] = useState<{ task: string; text: string }[]>([]);
  const [subject, setSubject] = useState("Let’s choose our base");
  const [published, setPublished] = useState(false);
  const [reviewPoll, setReviewPoll] = useState(false);
  const [revise, setRevise] = useState(false);
  const [sharePreview, setSharePreview] = useState("");
  const [revision, setRevision] = useState(1);
  const [applied, setApplied] = useState(false);
  const title = task === "hotel" ? "Choose our hotel" : "Find a fly-fishing school";
  function select(next: "hotel" | "fishing") { setTask(next); setView("conversation"); }
  return <main className="focus-prototype">
    <GlobalNavigation accountInNavigation busy={false} onNavigate={href => { window.location.href = href; }} tab="workspace" setTab={() => {}} actorName="Organizer" actorInitials="O" signedIn commonsId="local-workspace-review" commonsSlug="local-workspace-review" canUseWorkspace />
    <div className="focus-mobile-tabs"><button aria-pressed={view === "board"} onClick={() => setView("board")}>Trip board</button><button aria-pressed={view === "conversation"} onClick={() => setView("conversation")}>Conversation</button><button aria-pressed={view === "artifact"} onClick={() => setView("artifact")}>{task === "hotel" ? (published ? "Share" : "Working draft") : "Research"}</button></div>
    <div className="focus-grid" data-collapsed={collapsed} data-artifact-collapsed={artifactCollapsed} data-view={view}>
      <nav className="focus-board" aria-label="Trip tasks"><header><strong>Trip board</strong><button aria-label={collapsed ? "Show Trip board" : "Hide Trip board"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "›" : "‹"}</button></header><div className="focus-task-list"><p>WORKING ON</p><button aria-pressed={task === "hotel"} onClick={() => select("hotel")}><strong>Choose our hotel</strong><span>{published ? "Published · Ready to share" : `Poll + message · Draft${revision > 1 ? ` v${revision}` : ""}`}</span></button><button aria-pressed={task === "fishing"} onClick={() => select("fishing")}><strong>Find a fly-fishing school</strong><span>Exploring options</span></button><p className="focus-demo-note">Local layout prototype<br />Changes stay in this page.</p></div></nav>
      <section className="focus-conversation" aria-label="Coordinator conversation"><header><span><CoordinatorMark aria-hidden="true" /> Your coordinator <small>Organizers only</small></span><h1>{title}</h1></header>
        <div className="focus-history" key={task}>
          <div className="focus-human"><small>Organizer</small><p>{task === "hotel" ? "Let’s choose a place for the weekend. A hotel in town or a house outside town?" : "Could we find a beginner-friendly fly-fishing lesson for Saturday?"}</p></div>
          <div className="focus-reply"><strong><CoordinatorMark aria-hidden="true" /> Commons</strong><p>{task === "hotel" ? "I’ve prepared a poll with both options and a short message to share. You can edit either in the draft pane while we work through the details here." : "Let’s keep the school search here. We’ll compare lesson formats, check what’s included, and prepare an inquiry once you have a favorite. The working notes are beside this conversation."}</p><button className="focus-inline-link" onClick={() => { setView("artifact"); setArtifactCollapsed(false); }}>{task === "hotel" ? "View poll draft →" : "View working notes →"}</button></div>
          {task === "hotel" && <div className="focus-reply"><p>Suggested introduction: “Let’s find a place that works for everyone.”</p><button disabled={applied || published} onClick={() => { setIntro("Let’s find a place that works for everyone."); setApplied(true); }}>{applied ? "Applied locally" : "Use this wording"}</button></div>}
          {messages.filter(message => message.task === task).map((message, index) => <div className="focus-human" key={index}><small>Organizer · Local preview</small><p>{message.text}</p></div>)}
        </div>
        <form className="focus-composer" onSubmit={event => { event.preventDefault(); if (!prompts[task].trim()) return; setMessages([...messages, { task, text: prompts[task] }]); setPrompts({ ...prompts, [task]: "" }); }}><div><textarea rows={1} aria-label="Message your coordinator" placeholder="Ask your coordinator…" value={prompts[task]} onChange={event => setPrompts({ ...prompts, [task]: event.target.value })} /><button aria-label="Add message to local preview" disabled={!prompts[task].trim()}>↑</button></div><small>Local preview · Messages are not sent to an AI or the group.</small></form>
      </section>
      <aside className="focus-artifact" aria-label="Working material"><header><button className="focus-artifact-toggle" aria-label={artifactCollapsed ? "Show work pane" : "Hide work pane"} aria-expanded={!artifactCollapsed} onClick={() => setArtifactCollapsed(!artifactCollapsed)}>{artifactCollapsed ? "‹" : "›"}</button><div><h2>{task === "hotel" ? (published ? "Share this" : "Working draft") : "Working notes"}</h2></div><small>Local preview</small></header>
        {task === "hotel" ? <>
          {published && <div className="focus-document">
            <strong>Poll published · Version {revision}</strong>
            <p>Where should we stay?</p>
            <p className="focus-footnote">Available to trip invitees. No message sent.<br />Prototype only: no real poll was published.</p>
            <button onClick={() => setReviewPoll(!reviewPoll)}>{reviewPoll ? "Hide poll" : "View poll"}</button>
            <button onClick={() => setRevise(true)}>Revise poll</button>
            {revise && <div className="focus-option" role="alert">
              <strong>Start a new version?</strong>
              <p>The old poll closes and its responses stay in history. Votes do not carry over. You’ll need to publish and share the new version.</p>
              <button onClick={() => { setPublished(false); setReviewPoll(false); setRevise(false); setSharePreview(""); setRevision(revision + 1); }}>Create new draft</button>
              <button onClick={() => setRevise(false)}>Keep published poll</button>
            </div>}
          </div>}
          {(!published || reviewPoll) && <div className="focus-document">
            <h3>Where should we stay?</h3>
            <label>Introduction<textarea readOnly={published} rows={3} value={intro} onChange={event => setIntro(event.target.value)} /></label>
            <h4>Which place works for you?</h4><p>Choose all that work</p>
            <div className="focus-option">A small hotel in town</div><div className="focus-option">A house outside town</div>
            <p className="focus-footnote">Nothing is held or booked.</p>
          </div>}
          <div className="focus-document">
            <h3>Message to share</h3>
            <p className="focus-footnote">{published ? "Edit your message for each share. The published poll and responses won’t change." : "Optional · Prepare this now; publishing does not send it."}</p>
            {published && <div className="focus-share-actions" aria-label="Share options">
              {["Copy for email", "Copy for text", "Copy link"].map(action => <button key={action} onClick={() => setSharePreview(action)}>{action}</button>)}
            </div>}
            {sharePreview && <div className="focus-option" role="status">
              <strong>{sharePreview} · Preview</strong>
              <p>{sharePreview === "Copy for email" ? subject + "\n\n" + note + "\n\n" + intro + "\n\nWhere should we stay?\n• A small hotel in town\n• A house outside town\nVote in Commons: [published poll link]" : sharePreview === "Copy for text" ? "Where should we stay? Choose what works for you: [published poll link]" : "[published poll link]"}</p>
              <p className="focus-footnote">Nothing copied. This layout prototype has no live poll link.</p>
            </div>}
            <label>Subject<input value={subject} onChange={event => setSubject(event.target.value)} /></label>
            <label>Personal note<textarea rows={4} value={note} onChange={event => setNote(event.target.value)} /></label>
            {!published && <><button className="focus-publish" onClick={() => { setPublished(true); setSharePreview(""); }}>This looks good, publish it</button><p className="focus-footnote">Makes the poll available to trip invitees. Sends nothing.<br />Local preview only.</p></>}
          </div>
        </> : <div className="focus-document"><h3>A first lesson, together</h3><p className="focus-footnote">Illustrative brief · No live research yet</p><h4>What we’re looking for</h4><p>A beginner-friendly Saturday lesson. A short session, with equipment provided, would be a useful starting point.</p><h4>Questions to settle</h4><ul><li>How many adults and children?</li><li>How far are we happy to travel?</li><li>What is the budget per person?</li></ul><h4>Research to gather</h4><p>Schools, lesson formats, source links, and availability to confirm will stay with this thread.</p><div className="focus-option"><strong>Next step</strong><p>Agree the brief in the conversation before comparing schools.</p></div><p className="focus-footnote">Nothing has been contacted or booked.</p></div>
        }
      </aside>
    </div>
  </main>;
}
