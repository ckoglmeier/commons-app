import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";

// Also shown for a trip someone can't open, so the second line stays literal about both cases.
export default function NotFound() {
  return (
    <main className="entry-shell">
      <section className="entry-card">
        <Link className="entry-brand" href="/trips">
          <CommonsWordmark />
        </Link>
        <div className="entry-copy">
          <span className="view-kicker">404</span>
          <h1>Someone said they’d handle this page. Nobody did.</h1>
          <p>Check the link. If it’s a trip, ask your organizer for access.</p>
        </div>
        <Link className="join-primary" href="/trips">Go to your trips</Link>
      </section>
    </main>
  );
}
