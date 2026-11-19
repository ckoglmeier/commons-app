"use client";

import { useState } from "react";
import styles from "./launch.module.css";

export function FilmPlayer({ title, file }: { title: string; file: string }) {
  const [vertical, setVertical] = useState(false);
  const [failed, setFailed] = useState(false);
  const stem = `/launch-media/${file}${vertical ? "-vertical" : ""}`;
  return (
    <>
      <div className={styles.formats} role="group" aria-label={`${title} format`}>
        {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={vertical === value} onClick={() => { setVertical(value); setFailed(false); }}>{value ? "Vertical" : "Landscape"}</button>)}
      </div>
      {/* Original review exports have no supplied caption tracks. Preserve their audio and on-screen copy. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video key={stem} className={styles.video} data-vertical={vertical} controls playsInline preload="none" poster={`${stem}.jpg`} aria-label={`${title}, ${vertical ? "vertical" : "landscape"}`} onError={() => setFailed(true)} onPlay={event => { document.querySelectorAll("video").forEach(video => { if (video !== event.currentTarget) video.pause(); }); }}>
        <source src={`${stem}.mp4`} type="video/mp4" />
        Your browser cannot play this video. Use the link below to open it.
      </video>
      {failed && <p role="status">The video couldn’t load. Try opening the video file below.</p>}
      <a className={styles.fileLink} href={`${stem}.mp4`} rel="nofollow">Open {vertical ? "vertical" : "landscape"} video file</a>
    </>
  );
}
