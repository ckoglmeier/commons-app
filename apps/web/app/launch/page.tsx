import type { Metadata } from "next";
import Link from "next/link";
import { CommonsWordmark } from "@commons/ui";
import { FilmPlayer } from "./film-player";
import styles from "./launch.module.css";

export const metadata: Metadata = {
  title: "Launch films · Commons",
  description: "Commons launch films for feedback.",
  robots: { index: false, follow: false, noarchive: true },
  openGraph: { title: "Launch films · Commons", description: "Commons launch films for feedback." },
};

const films = [
  { id: "core", title: "The full story", duration: "1:26", file: "commons-launch-core-20260926" },
  { id: "short", title: "The 15-second version", duration: "0:15", file: "commons-launch-15s" },
];

export default function LaunchPage() {
  return (
    <>
      <header className="global-nav global-nav--index">
        <Link className="brand-lockup" href="/" aria-label="Commons homepage"><CommonsWordmark /></Link>
      </header>
      <main className={styles.page} aria-label="Launch films">
        <nav className={styles.jumpLinks} aria-label="Choose a film">
          {films.map(film => <a key={film.id} href={`#${film.id}`}>{film.title}</a>)}
        </nav>
        {films.map(film => (
          <section key={film.id} id={film.id} className={styles.film} aria-labelledby={`${film.id}-title`}>
            <div className={styles.heading}><h2 id={`${film.id}-title`}>{film.title}</h2><span>{film.duration}</span></div>
            <FilmPlayer title={film.title} file={film.file} />
          </section>
        ))}
      </main>
    </>
  );
}
