"use client";

import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";

// Shown when a page fails on the server or in the browser. The error's own text never reaches the page:
// in production it is generic anyway, and in development it can carry a driver's query. The digest matches the server log.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <main className="entry-shell">
      <title>Something went wrong — Commons</title>
      <section className="entry-card">
        <Link className="entry-brand" href="/trips">
          <CommonsWordmark />
        </Link>
        <div className="entry-copy">
          <span className="view-kicker">Something went wrong</span>
          <h1>This page didn’t load.</h1>
          <p>Try again in a moment. If it keeps happening, tell the person who runs this copy of Commons.</p>
        </div>
        <p className="entry-footnote">Run this copy? The server log has the details. The usual causes are a database that can’t be reached or hasn’t been set up.</p>
        {digest ? <p className="entry-footnote">Reference: {digest}</p> : null}
        <button className="join-primary" type="button" onClick={() => retry()}>Try again</button>
        <Link className="sheet-secondary" href="/trips">Go to your trips</Link>
      </section>
    </main>
  );
}
