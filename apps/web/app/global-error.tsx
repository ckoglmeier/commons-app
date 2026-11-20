"use client";

import "@commons/ui/tokens.css";
import "./globals.css";
import { CommonsWordmark } from "@commons/ui";

// Replaces the root layout when it fails, so it renders its own document and needs nothing the layout provides.
// The error's own text never reaches the page; the digest matches the server log.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <html lang="en">
      <body style={{ fontFamily: "\"Helvetica Neue\", Arial, sans-serif" }}>
        <title>Something went wrong — Commons</title>
        <main className="entry-shell">
          <section className="entry-card">
            <a className="entry-brand" href="/trips">
              <CommonsWordmark />
            </a>
            <div className="entry-copy">
              <span className="view-kicker">Something went wrong</span>
              <h1>This page didn’t load.</h1>
              <p>Try again in a moment. If it keeps happening, tell the person who runs this copy of Commons.</p>
            </div>
            <p className="entry-footnote">Run this copy? The server log has the details. The usual causes are a database that can’t be reached or hasn’t been set up.</p>
            {digest ? <p className="entry-footnote">Reference: {digest}</p> : null}
            <button className="join-primary" type="button" onClick={() => retry()}>Try again</button>
            <a className="sheet-secondary" href="/trips">Go to your trips</a>
          </section>
        </main>
      </body>
    </html>
  );
}
