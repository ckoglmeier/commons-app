"use client";

import type { CommonsParticipant, CommonsSummary } from "@commons/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { AvatarStack } from "./avatar-stack";
import { CoverSketch } from "./cover-sketch";
import { ChevronRightIcon, MoreIcon } from "./icons";
import { ResilientCoverImage } from "./resilient-cover-image";

/**
 * Presentational trip identity for the persistent rail and the compact Menu.
 * It performs no fetching and infers no permissions: an action appears only when its callback or href is supplied.
 */
export function TripIdentity({ placement, commons, meta, coverImage, participants, openPeople, openCoverPicker, openSettings, demo, onAction }: {
  placement: "rail" | "menu";
  commons: CommonsSummary;
  meta: string;
  coverImage: string | null;
  participants: CommonsParticipant[];
  openPeople?: () => void;
  openCoverPicker?: () => void;
  openSettings?: () => void;
  demo?: boolean;
  onAction?: () => void;
}) {
  const [dimensions, setDimensions] = useState<{ src: string; width: number; height: number } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const aspectRatio = coverImage && dimensions?.src === coverImage ? `${dimensions.width} / ${dimensions.height}` : undefined;
  const travelers = `${participants.length} ${participants.length === 1 ? "traveler" : "travelers"}`;
  const hasOptions = Boolean(openCoverPicker || openSettings);

  useEffect(() => {
    if (!optionsOpen) return;
    function closeFromOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOptionsOpen(false);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape" || !root.current?.contains(document.activeElement)) return;
      event.stopPropagation();
      setOptionsOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => { document.removeEventListener("pointerdown", closeFromOutside); document.removeEventListener("keydown", closeFromKeyboard); };
  }, [optionsOpen]);

  function act(action: () => void) {
    setOptionsOpen(false);
    onAction?.();
    action();
  }

  return (
    <div className="trip-identity" data-placement={placement} ref={root}>
      <div className="trip-identity__media" style={aspectRatio ? { aspectRatio } : undefined}>
        <CoverSketch context={commons} />
        <ResilientCoverImage
          className="trip-identity__photo"
          src={coverImage}
          alt={`${commons.name} trip cover`}
          sizes={placement === "rail" ? "12rem" : "(min-width: 30rem) 24rem, 100vw"}
          onDimensions={size => { if (coverImage) setDimensions({ src: coverImage, ...size }); }}
        />
      </div>
      <div className="trip-identity__text">
        {demo ? <span className="trip-identity__demo">[DEMO]</span> : null}
        <p className="trip-identity__name">{commons.name}</p>
        {meta ? <p className="trip-identity__meta">{meta}</p> : null}
      </div>
      <div className="trip-identity__row">
        {openPeople ? (
          <button className="trip-identity__people" type="button" aria-haspopup="dialog" aria-label={`People: ${travelers}`} onClick={() => act(openPeople)}>
            <AvatarStack participants={participants} compact />
            <span>{travelers}</span>
            <ChevronRightIcon />
          </button>
        ) : (
          <div className="trip-identity__people trip-identity__people--static">
            <AvatarStack participants={participants} compact />
            <span>{travelers}</span>
          </div>
        )}
        {hasOptions ? (
          <button ref={trigger} className="trip-identity__options-toggle" type="button" aria-expanded={optionsOpen} aria-controls={optionsId} aria-label="Trip options" onClick={() => setOptionsOpen(open => !open)}>
            <MoreIcon />
          </button>
        ) : null}
      </div>
      {hasOptions && optionsOpen ? (
        <div className="trip-identity__options" id={optionsId} role="group" aria-label="Trip options">
          {openCoverPicker ? <button type="button" aria-haspopup="dialog" onClick={() => act(openCoverPicker)}>{coverImage ? "Change cover" : "Add cover"}</button> : null}
          {openSettings ? <button type="button" aria-haspopup="dialog" onClick={() => act(openSettings)}>Trip settings</button> : null}
        </div>
      ) : null}
    </div>
  );
}
