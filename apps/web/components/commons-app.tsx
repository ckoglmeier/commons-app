"use client";
import { TripContextSheet } from "./trip-context-sheet";
import { TimeInput } from "./time-input";
import { TripMapView } from "./trip-map";
import { BetaMoneyWrapUp } from "./beta-money-wrap-up";
import { TripQuickAddSheet, type QuickAddInput } from "./trip-quick-add";
import { TripStaysView } from "./trip-stays-view";
import { TripTravelView } from "./trip-travel-view";
import type { DecisionHandoff } from "@/lib/decision-handoff";

import { TripItemDetail } from "./trip-item-detail";
import { PlanLocationLink } from "./plan-location-link";
import { activityExpenseConversion } from "@/lib/activity-expense";

import { planTemplateFor } from "@commons/domain";
import { itineraryDurationMinutes, itineraryEndTime, formatDuration } from "@commons/contracts";
import { FlightBookingFields, blankFlightConnection, type FlightLegReview } from "./flight-booking-fields";
import type { ConfirmationDocumentInput } from "@commons/contracts";
import { CoverSketch } from "./cover-sketch";
import { ActivityArrangerField, ActivityArrangerLine } from "./activity-arranger";
import { PlanPeopleField } from "./plan-people-field";
import { CommonsMark, CommonsWordmark } from "@commons/ui";
import {
    CommonsSnapshotSchema,
    CommonsStateSchema,
    StaySchema,
    TravelPlanSchema,
    ConfirmationPreviewResponseSchema,
    LinkPreviewSchema,
    type CommonsParticipant,
    type CommonsSnapshot,
    type CommonsState,
    type ConfirmationDraft,
    type CommonsSummary,
    type Expense,
    type Moment,
    type LinkPreview,
    type Reimbursement,
    type Stay,
    type TravelPlan,
} from "@commons/contracts";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { TripTasks } from "./trip-tasks";
import { NewExperienceSetting } from "./new-experience-setting";
import { GoingAction, PlanStageBanner, StageLockedPage } from "./trip-stage-gate";
import Link from "next/link";
import { TripApplicationShell } from "./trip-application-shell";
import { TripIdentity } from "./trip-identity";
import { activityReceipt, addedRecord, sameText, stableCommandId, stayReceipt, travelReceipt, type PlanReceipt } from "@/lib/plan-receipt";
import { type DragEvent, type FormEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPhotoArchive } from "@/lib/photo-archive";
import { calculateBudgetForecastAdjustment, calculateExpectedPlanCosts, calculateExpectedStayCosts, calculateExpectedTravelCosts, calculateExpectedTripCost } from "@/lib/expected-trip-cost";
import { PlacesField } from "./places-field";
import { AvatarStack } from "./avatar-stack";
import { LocationTimezoneField } from "./location-timezone-field";
import { MealTypeField, MealTypeLine, MealReservationFields } from "./meal-fields";
import { LogisticsAddMenu, type LogisticsAddKind } from "./logistics-add-menu";
import { mergeTravelPlans } from "@/lib/merge-travel-plans";
import { publicDemoTravelPlans } from "@/lib/public-demo-travel";
import { appendPublicDemoStay, publicDemoStays } from "@/lib/public-demo-stays";
import { currencyLedger } from "@/lib/currency-ledger";
import { SUPPORTED_CURRENCIES, currencyLabel, currencySymbol } from "@commons/contracts";
import { normalizeMoneyInput, parseMoneyInput } from "@/lib/money-input";
import { planDays, selectedPlanDay, tripDays, type DayOption } from "@/lib/plan-days";
import { planAudienceValue, type PlanAudience } from "@/lib/plan-audience";
import { commonsPath, commonsViewPath, commonsTravelPath, eventLocation, parsePlanSection, planSectionPath, PUBLIC_DEMO_COMMONS_ID, visiblePlanSection, type EventView, type PlanSection } from "@/lib/commons-route";
import { trackProductEvent } from "@/lib/product-analytics";
import { getSupabaseBrowserClient, uploadCommonsConfirmation, uploadCommonsCover, uploadCommonsPhoto } from "@/lib/supabase/browser";
import { createCoverCardImage, rasterizeCoverDrawing } from "@/lib/cover-image";
import { hasTripStarted, isPostTrip } from "@/lib/trip-phase";
import { PeopleSheet } from "./people-sheet";
import { InlineEditor } from "./inline-editor";
import { EventDaySelector } from "./event-day-selector";
import { HomeDashboard, type TextMessagingChannel } from "./home-dashboard";
import { ModalLayer } from "./modal-layer";
import { EventAttendancePanel } from "./event-attendance";
import { ResilientCoverImage } from "./resilient-cover-image";
import {
    CalendarIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CloseIcon,
    DownloadIcon,
    EditIcon,
    FileTextIcon,
    ImageIcon,
    InfoIcon,
    LinkIcon,
    LockIcon,
    MessageIcon,
    PinIcon,
    PlusIcon,
    QuestionIcon,
    ReceiptIcon,
    RouteIcon,
    ShareIcon,
    UsersIcon,
    WalletIcon
} from "./icons";
type Tab = EventView;
type Sheet = "trip-context" | "add-item" | "item-detail" | "add-receipt" | "expense" | "add-expense" | "edit-expense" | "payment" | "add-payment" | "edit-payment" | "close-expenses" | "reopen-expenses" | "money-settings" | "add-plan" | "add-meal" | "edit-plan" | "cover" | "edit-trip-details" | "add-stay" | "edit-stay" | "add-flight" | "add-rental" | "moment" | "edit-moment" | "photo-mapping" | "travel" | "people" | null;
type ParticipationChoice = "in" | "maybe" | "skip";

const initialPilotParticipation: Record<string, ParticipationChoice> = {
  "50000000-0000-4000-8000-000000000011": "maybe",
  "50000000-0000-4000-8000-000000000012": "maybe",
};





type PendingPhoto = {
  id: string;
  assetUrl: string;
  fileName: string;
  lastModified: number;
};

type AddExpenseInput = {
  currency: string;
  title: string;
  amountCents: number;
  paidByPersonId: string;
  occurredOn: string;
  category: string;
  itineraryItemId: string | null;
  stayId: string | null;
  travelPlanId: string | null;
  splitMethod: "equal" | "exact";
  balanceMode: "allocated" | "tracking_only" | "budget_only";
  confirmationCode?: string;
  shares: Expense["shares"];
  note?: string;
};

type PaymentInput = {
  currency: string;
  fromPersonId: string;
  toPersonId: string;
  amountCents: number;
  occurredOn: string;
};

type AddPlanInput = {
  mealType?: import("@commons/contracts").MealType | null;
  mealReservation?: import("@commons/contracts").MealReservation | null;
  status?: "idea" | "planned" | "confirmed" | "cancelled";
  durationMinutes?: number | null;
  arrangerPersonId?: string | null;
  expectedArrangerPersonId?: string | null;
  title: string;
  date: string | null;
  time: string | null;
  location: string;
  note: string;
  expectedCostCurrency?: string;
  expectedCostCents: number | null;
  expectedCostBasis: "total" | "per_person";
  expectedParticipantIds: string[];
  participantScope: PlanAudience;
  sourceUrl: string | null;
};

type EditPlanInput = Omit<AddPlanInput, "participantScope"> & {
  participantScope: PlanAudience;
};

type TripDetailsInput = {
  currency: string;
  timezone?: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  locationName: string | null;
  locationNames: string[];
  balancesDisabled: boolean;
};

type StayInput = {
  timezone: string | null;
  name: string;
  address: string;
  startsOn: string;
  endsOn: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: Stay["status"];
  includedPersonIds: string[];
  bookingUrl: string | null;
  pollId: string | null;
  confirmationCode: string | null;
  totalCents: number | null;
  roomPriceCents?: number | null;
  roomCount?: number | null;
  currency: string;
  costSource: Stay["costSource"] | null;
  includesTaxesAndFees: boolean | null;
  details: string | null;
  confirmationDocument?: ConfirmationDocumentInput;
};

type PendingConfirmation = {
  file: File | null;
  intakeId?: string;
  intakeVersion?: number;
  alreadyUploaded?: boolean;
  draft: ConfirmationDraft;
  upload: { storagePath: string; token: string; mimeType?: ConfirmationDocumentInput["mimeType"] };
};

type MappingSuggestion = {
  itineraryItemId: string | null;
  confidence: number;
  reason: string;
};

function formatTravelTime(value: string | null | undefined) {
  if (!value) return "Time not added";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function travelPlanInitials(plan: TravelPlan) {
  if (plan.personName.includes(" + ")) {
    return plan.personName.split(" + ").map((name) => name[0]).join("");
  }
  return plan.personName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("");
}

function parseTravelTime(value: string) {
  const match = /^(\d{1,2}):(\d{2}) ([AP])M$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minutes = Number(match[2]);
  if (hour < 1 || hour > 12 || minutes > 59) return null;
  const hour24 = (hour % 12) + (match[3] === "P" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${match[2]}`;
}

function travelPlansFromConversation(
  commons: CommonsSummary,
  messages: CommonsState["messages"],
  participants: CommonsParticipant[],
): TravelPlan[] {
  const latest = new Map<string, TravelPlan>();
  for (const message of messages) {
    if (message.actorType !== "human") continue;
    const match = /^My (arrival|departure)(?: on (\d{4}-\d{2}-\d{2}))?(?: with ([^:]+))?: (.+) at (\d{1,2}:\d{2} [AP]M)(?:\. (.+))?$/.exec(message.body);
    if (!match) continue;
    const time = parseTravelTime(match[5]);
    if (!time) continue;
    const kind = match[1] as TravelPlan["kind"];
    const companion = match[3]
      ? participants.find((participant) => participant.displayName === match[3])
      : null;
    const personIds = [message.actorId, ...(companion ? [companion.id] : [])];
    const date = match[2] ?? (kind === "arrival" ? commons.startsOn : commons.endsOn);
    if (!date) continue;
    latest.set(`${message.actorId}-${kind}`, {
      id: `travel-message-${message.id}`,
      personId: message.actorId,
      personIds,
      personName: companion
        ? `${message.actorName.split(" ")[0]} + ${companion.displayName.split(" ")[0]}`
        : message.actorName,
      kind,
      date,
      route: match[4],
      time,
      note: match[6] || "Shared in the group conversation",
      sourceLabel: `Shared by ${message.actorName.split(" ")[0]}`,
    });
  }
  return [...latest.values()];
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function localDateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localTimeValue(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}

function localDateTimeToIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(guess));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(
    parts.find((part) => part.type === type)?.value ?? 0,
  );
  const representedAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
  );
  return new Date(guess - (representedAsUtc - guess)).toISOString();
}

function sortItinerary(items: CommonsState["itinerary"]) {
  return [...items].sort((first, second) => {
    if (!first.startsAt && !second.startsAt) return first.title.localeCompare(second.title);
    if (!first.startsAt) return -1;
    if (!second.startsAt) return 1;
    return new Date(first.startsAt).valueOf() - new Date(second.startsAt).valueOf();
  });
}

function formatTripDates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "Dates to be decided";
  if (startsOn && !endsOn) return `Starts ${formatDayHeading(startsOn)}`;
  if (!startsOn && endsOn) return `Ends ${formatDayHeading(endsOn)}`;
  const start = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(start);
  if (sameMonth) {
    return `${startLabel}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${startLabel}–${endLabel}`;
}

function formatDayHeading(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function equalExpenseShares(amountCents: number, personIds: string[]) {
  if (!personIds.length) return [];
  const base = Math.floor(amountCents / personIds.length);
  const remainder = amountCents - base * personIds.length;
  return personIds.map((personId, index) => ({
    personId,
    amountCents: base + (index < remainder ? 1 : 0),
  }));
}

function momentFileName(moment: Moment, index?: number) {
  const stem = moment.caption
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 54) || "moment";
  const extension = moment.assetUrl.match(/\.(jpe?g|png|webp|gif|heic)(?:\?|$)/i)?.[1]?.replace("jpeg", "jpg") ?? "jpg";
  return `${index === undefined ? "" : `${String(index + 1).padStart(2, "0")}-`}${stem}.${extension}`;
}

function downloadAsset(assetUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = assetUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function captionFromFileName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!stem || /^(img|image|photo|dsc)[ -]?\d+$/i.test(stem)) return "Untitled photo";
  return `${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
}

function inferPhotoMapping(
  photo: PendingPhoto,
  itinerary: CommonsState["itinerary"],
  timeZone: string,
  learnedEventId: string | null,
): MappingSuggestion {
  const normalizedName = photo.fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const filenameMatch = itinerary
    .map((item) => {
      const tokens = `${item.title} ${item.location ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4);
      return { item, score: tokens.filter((token) => normalizedName.includes(token)).length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (filenameMatch) {
    return {
      itineraryItemId: filenameMatch.item.id,
      confidence: Math.min(94, 80 + filenameMatch.score * 6),
      reason: `The file name lines up with ${filenameMatch.item.title}.`,
    };
  }

  const photoDate = localDateKey(new Date(photo.lastModified).toISOString(), timeZone);
  const sameDayItems = itinerary.filter((item) => item.startsAt && localDateKey(item.startsAt, timeZone) === photoDate);
  if (sameDayItems.length === 1) {
    return {
      itineraryItemId: sameDayItems[0].id,
      confidence: 84,
      reason: `The photo date matches the day of ${sameDayItems[0].title}.`,
    };
  }

  if (learnedEventId && itinerary.some((item) => item.id === learnedEventId)) {
    const learnedEvent = itinerary.find((item) => item.id === learnedEventId)!;
    return {
      itineraryItemId: learnedEvent.id,
      confidence: 72,
      reason: `Based on your last correction, Commons is trying ${learnedEvent.title} next.`,
    };
  }

  return {
    itineraryItemId: null,
    confidence: 0,
    reason: "No clear match yet.",
  };
}

async function preparePhotoFiles(files: File[]): Promise<PendingPhoto[]> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  return Promise.all(imageFiles.map((file) => new Promise<PendingPhoto>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        assetUrl: reader.result,
        fileName: file.name,
        lastModified: file.lastModified || Date.now(),
      });
    };
    reader.readAsDataURL(file);
  })));
}

function participantFirstNames(participants: CommonsParticipant[]) {
  return new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  }).format(participants.map((participant) => participant.displayName.split(" ")[0]));
}

function tripPlaces(commons: CommonsSummary) {
  return commons.locationNames?.length
    ? commons.locationNames
    : commons.locationName ? [commons.locationName] : [];
}

function formatTripPlaces(commons: CommonsSummary) {
  const places = tripPlaces(commons);
  if (places.length < 3) return places.join(" → ");
  return `${places[0]} → ${places[1]} +${places.length - 2}`;
}

function participantsForItem(
  item: CommonsState["itinerary"][number],
  participants: CommonsParticipant[],
) {
  return [...new Set([...(item.participantIds ?? []), ...(item.participantScope === "subgroup" ? item.expectedParticipantIds ?? [] : [])])].flatMap((personId) => {
    const participant = participants.find((entry) => entry.id === personId);
    return participant ? [participant] : [];
  });
}

export function SubgroupDetails({
  item,
  participants,
}: {
  item: CommonsState["itinerary"][number];
  participants: CommonsParticipant[];
}) {
  if (item.participantScope !== "subgroup") return null;
  const going = participantsForItem(item, participants);

  return (
    <div className="subgroup-details">
      <div className="event-participants">
        {going.length ? (
          <AvatarStack participants={going} compact />
        ) : (
          <span className="event-participants__icon"><UsersIcon /></span>
        )}
        <p>
          <strong>{going.length ? `${going.length} ${(item.participantIds ?? []).length === going.length ? "going" : "included"}` : "Participants not confirmed"}</strong>
          {going.length ? <small>{participantFirstNames(going)}</small> : null}
        </p>
      </div>
    </div>
  );
}

function TripArrival({
  coverImage,
  commons,
  close,
}: {
  coverImage: string | null;
  commons: CommonsSummary;
  close: () => void;
}) {
  const arrivalRef = useRef<HTMLElement>(null);
  const tripMeta = [formatTripDates(commons.startsOn, commons.endsOn), formatTripPlaces(commons)]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    arrivalRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [close]);

  return (
    <section ref={arrivalRef} className="trip-arrival" role="dialog" aria-modal="true" aria-labelledby="trip-arrival-title" tabIndex={-1}>
      <div className="trip-arrival__media">
        <CoverSketch context={commons} />
        <ResilientCoverImage
          className="trip-arrival__photo"
          src={coverImage}
          alt={`${commons.name} trip cover`}
          priority
          sizes="100vw"
        />
        <div className="trip-arrival__wash" />
      </div>
      <div className="trip-arrival__brand" aria-label="Commons">
        <CommonsWordmark />
      </div>
      <div className="trip-arrival__identity">
        <span>Welcome to your trip.</span>
        <strong id="trip-arrival-title">{commons.name}</strong>
        <p>{tripMeta}</p>
      </div>
      <footer className="trip-arrival__footer">
        <div />
        <button id="trip-arrival-enter" type="button" onClick={close}>
          <span>View the trip</span>
          <ChevronRightIcon />
        </button>
      </footer>
    </section>
  );
}

function TripDetailsEditorSheet({ experience, commons, close, save, inline = false, sampleOnly = false }: {
  /** Organizer, on a saved trip: the per-trip experience setting. */
  experience?: { slug: string; enabled: boolean };
  inline?: boolean;
  sampleOnly?: boolean;
  commons: CommonsSummary;
  close: () => void;
  save: (input: TripDetailsInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(commons.name);
  const [timezone, setTimezone] = useState(commons.timezone);
  const [currency, setCurrency] = useState(commons.currency ?? "USD");
  const [locationNames, setLocationNames] = useState([...tripPlaces(commons), ""].join("\n"));
  const balancesDisabled = commons.balancesDisabled ?? false;
  const [startsOn, setStartsOn] = useState(commons.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(commons.endsOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    if (startsOn && endsOn && endsOn < startsOn) {
      setError("The end date must be on or after the start date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({
        title: title.trim(),
        timezone,
        currency,
        locationName: locationNames.split("\n").map((place) => place.trim()).filter(Boolean)[0] ?? null,
        locationNames: locationNames.split("\n").map((place) => place.trim()).filter(Boolean),
        balancesDisabled,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Event details not updated. Try again.");
      setBusy(false);
    }
  }

  return <EditorSurface close={close} inline={inline}>
    <section className="sheet trip-details-editor" role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby="trip-details-editor-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><span className="people-sheet-mark"><EditIcon /></span><span><small>Logistics</small><strong>Edit event</strong></span></div><button type="button" onClick={close} aria-label={inline ? "Cancel event editor" : "Close event editor"}>{inline ? "Cancel" : <CloseIcon />}</button></header>
      <h2 id="trip-details-editor-title">Trip settings</h2>
      {sampleOnly ? <p className="event-logistics-note">Sample only. Changes reset when you reload.</p> : null}
      <form className="trip-details-form" onSubmit={submit}>
        <label className="field"><span>Event name</span><input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <PlacesField value={locationNames} onChange={setLocationNames} />
        <div className="field-pair"><label className="field"><span>Start date <small>Optional</small></span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="field"><span>End date <small>Optional</small></span><input type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div>
        <LocationTimezoneField value={timezone} onChange={setTimezone} initialQuery={commons.locationName ?? ""} />
        <label className="field"><span>Trip currency</span><select value={currency} onChange={event => setCurrency(event.target.value)}>{!SUPPORTED_CURRENCIES.some(option => option.code === currency) ? <option value={currency} disabled>{currency} (saved currency)</option> : null}{SUPPORTED_CURRENCIES.map(option => <option key={option.code} value={option.code}>{currencyLabel(option.code)}</option>)}</select><small>Used for new costs. Existing costs keep their saved currency.</small></label>
        <button className="sheet-primary" type="submit" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save event details"}</button>
      </form>
      {experience ? <NewExperienceSetting slug={experience.slug} enabled={experience.enabled} /> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  </EditorSurface>;
}

function ConfirmationUploadControl({
  commonsSlug,
  expectedKind,
  intakeId,
  currentFileName,
  warnings,
  onReady,
  review,
  onReviewSaved,
}: {
  review?: ConfirmationDraft;
  onReviewSaved?: (revision: number) => void;
  commonsSlug: string;
  expectedKind: ConfirmationDraft["kind"];
  intakeId?:string|null;
  currentFileName?: string;
  warnings?: string[];
  onReady: (pending: PendingConfirmation) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existingTravel, setExistingTravel] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const ready = useRef(onReady), reviewSaved = useRef(onReviewSaved);
  const intake = useRef<{id:string; revision:number; fingerprint:string} | null>(null);
  const [intakeReady, setIntakeReady] = useState(false);
  useEffect(() => { ready.current = onReady; reviewSaved.current = onReviewSaved; });
  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/commons/${commonsSlug}/confirmations/intakes`, {cache:"no-store"}).then(async response => {
      if(!response.ok)throw new Error("Your saved confirmation review could not load. Refresh before uploading another file.");
      const body = await response.json() as {intakes:Array<{id:string; revision:number; kind:string;status:string;draft:ConfirmationDraft|null;storagePath:string;mimeType:ConfirmationDocumentInput["mimeType"]}>};
      const saved = body.intakes.find(row => row.kind === expectedKind && row.status === "awaiting_review" && row.draft && (!intakeId || row.id === intakeId));
      if(active && saved?.draft){intake.current={id:saved.id,revision:saved.revision,fingerprint:JSON.stringify(saved.draft)};ready.current({file:null,intakeId:saved.id,intakeVersion:saved.revision,alreadyUploaded:true,draft:saved.draft,upload:{storagePath:saved.storagePath,token:"already-stored",mimeType:saved.mimeType}});setIntakeReady(true);}
      if(active && body.intakes.some(row=>row.kind===expectedKind && row.status==="processing"))setError("Your confirmation is processing. Reopen this review shortly; you do not need another upload.");
    }).catch(cause => { if(active)setError(cause instanceof Error?cause.message:"Your review could not load."); });
    return () => {active=false;};
  },[commonsSlug,expectedKind,intakeId]);
  const reviewText = review ? JSON.stringify(review) : "";
  useEffect(() => {
    if(!intakeReady || !intake.current || !reviewText || intake.current.fingerprint === reviewText)return;
    const timer=window.setTimeout(()=>{
      const current=intake.current;if(!current)return;
      void fetch(`/api/v1/commons/${commonsSlug}/confirmations/intakes`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:current.id,expectedRevision:current.revision,draft:JSON.parse(reviewText)})}).then(async response=>{
        if(!response.ok)throw new Error("This review changed elsewhere or could not save. Refresh before saving trip details. Your fields stay here.");
        const saved=await response.json() as {revision:number};current.revision=saved.revision;current.fingerprint=reviewText;reviewSaved.current?.(saved.revision);
      }).catch(cause=>setError(cause instanceof Error?cause.message:"Review could not save."));
    },750);
    return ()=>window.clearTimeout(timer);
  },[intakeReady,reviewText,commonsSlug]);

  async function preview(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setExistingTravel(false);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("expectedKind", expectedKind);
      const response = await fetch(`/api/v1/commons/${commonsSlug}/confirmations/preview`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        setExistingTravel(Boolean((payload as { existing?: { travelPlanId?: string } } | null)?.existing?.travelPlanId));
        throw new Error((payload as { error?: string } | null)?.error ?? "That confirmation could not be read.");
      }
      const parsed = ConfirmationPreviewResponseSchema.parse(payload);
      setLocalPreview(URL.createObjectURL(new Blob([file], { type: parsed.upload.mimeType ?? "application/pdf" })));
      if(parsed.intakeId && parsed.intakeVersion){intake.current={id:parsed.intakeId,revision:parsed.intakeVersion,fingerprint:JSON.stringify(parsed.draft)};setIntakeReady(true);}
      onReady({ file, draft: parsed.draft, upload: parsed.upload, intakeId:parsed.intakeId, intakeVersion:parsed.intakeVersion, alreadyUploaded:parsed.alreadyUploaded });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That confirmation could not be read.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return <section className="confirmation-upload" aria-label="Confirmation file">
    <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.txt,.eml" onChange={(event) => void preview(event.target.files?.[0])} />
    <div><span className="confirmation-upload-mark"><FileTextIcon /></span><p><strong>{currentFileName ? "Confirmation ready" : "Add confirmation"}</strong><small>{currentFileName ?? "PDF or email: review extracted details. Images: attach and enter details."}</small></p></div>
    <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Reading…" : currentFileName ? "Replace file" : "Choose file"}</button>
    {warnings?.length ? <ul className="confirmation-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {existingTravel ? <Link href={commonsTravelPath(commonsSlug)}>Open saved travel</Link> : null}
    {localPreview ? <a className="confirmation-document-link" href={localPreview} target="_blank" rel="noreferrer">Open selected file</a> : null}
  </section>;
}

function StayEditorSheet({
  stay,
  commons,
  participants,
  close,
  save,
  remove,
  linkedExpense,
  recordExpense,
  openLinkedExpense,
  confirmationUploadEnabled,
  inline = false,
  sampleOnly = false,
  initialStatus,
}: {
  /** Preset when an organizer is confirming a poll's chosen option; still saved only by Save stay. */
  initialStatus?: Stay["status"];
  stay?: Stay;
  commons: CommonsSummary;
  participants: CommonsParticipant[];
  close: () => void;
  save: (input: StayInput) => Promise<void>;
  remove?: () => Promise<void>;
  linkedExpense?: Expense;
  recordExpense?: () => void;
  openLinkedExpense?: () => void;
  confirmationUploadEnabled: boolean;
  inline?: boolean;
  sampleOnly?: boolean;
}) {
  const defaultPersonIds = participants.map((participant) => participant.id);
  const [name, setName] = useState(stay?.name ?? "");
  const [address, setAddress] = useState(stay?.address ?? "");
  const [startsOn, setStartsOn] = useState(stay?.startsOn ?? commons.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(stay?.endsOn ?? commons.endsOn ?? commons.startsOn ?? "");
  const [stayTimezone, setStayTimezone] = useState(stay?.timezone ?? commons.timezone);
  const [checkInTime, setCheckInTime] = useState(stay?.checkInTime ?? "");
  const [checkOutTime, setCheckOutTime] = useState(stay?.checkOutTime ?? "");
  const [status, setStatus] = useState<Stay["status"]>(initialStatus ?? stay?.status ?? "planned");
  const [includedPersonIds, setIncludedPersonIds] = useState(stay?.includedPersonIds ?? defaultPersonIds);
  const bookingUrl = stay?.bookingUrl ?? null;
  const [confirmationCode, setConfirmationCode] = useState(stay?.confirmationCode ?? "");
  const [totalCost, setTotalCost] = useState(stay?.totalCents ? (stay.totalCents / 100).toFixed(2) : "");
  // Hotels quote per room; the group total follows only once the rooms are known.
  const [priceBasis, setPriceBasis] = useState<"stay" | "room">(stay?.roomPriceCents ? "room" : "stay");
  const [roomPrice, setRoomPrice] = useState(stay?.roomPriceCents ? (stay.roomPriceCents / 100).toFixed(2) : "");
  const [roomCount, setRoomCount] = useState(stay?.roomCount ? String(stay.roomCount) : "");
  const [currency, setCurrency] = useState(stay?.currency ?? commons.currency ?? "USD");
  const [costSource, setCostSource] = useState<NonNullable<Stay["costSource"]>>(stay?.costSource ?? "estimate");
  const [taxesAndFees, setTaxesAndFees] = useState(stay?.includesTaxesAndFees === true ? "included" : stay?.includesTaxesAndFees === false ? "not_included" : "unknown");
  const [details, setDetails] = useState(stay?.details ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmationUploaded, setConfirmationUploaded] = useState(false);

  function togglePerson(personId: string) {
    setIncludedPersonIds((current) => current.includes(personId)
      ? current.filter((id) => id !== personId)
      : [...current, personId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim() || (!address.trim() && status !== "considering") || !startsOn || !endsOn) return;
    if (endsOn < startsOn) {
      setError("Check-out must be on or after check-in.");
      return;
    }
    if (!includedPersonIds.length) {
      setError("Include at least one traveler.");
      return;
    }
    const roomPriceCents = priceBasis === "room" && roomPrice ? parseMoneyInput(roomPrice) : null;
    const rooms = priceBasis === "room" && roomCount ? Number(roomCount) : null;
    if (priceBasis === "room" && roomPrice && !roomPriceCents) { setError("Enter a valid price per room."); return; }
    if (rooms !== null && (!Number.isInteger(rooms) || rooms < 1 || rooms > 50)) { setError("Enter between 1 and 50 rooms, or leave it blank."); return; }
    const totalCents = priceBasis === "room" ? roomPriceCents && rooms ? roomPriceCents * rooms : null : totalCost ? parseMoneyInput(totalCost) : null;
    if (priceBasis === "stay" && totalCost && !totalCents) {
      setError("Enter a valid stay cost.");
      return;
    }
    const priced = Boolean(totalCents || roomPriceCents);
    setBusy(true);
    setError("");
    try {
      if (pendingConfirmation && !confirmationUploaded) {
        if (pendingConfirmation.file) await uploadCommonsConfirmation(pendingConfirmation.upload, pendingConfirmation.file);
        else if (!pendingConfirmation.alreadyUploaded) throw new Error("Reopen your confirmation review before saving.");
        setConfirmationUploaded(true);
      }
      await save({
        name: name.trim(), address: address.trim(), startsOn, endsOn,
        timezone: stayTimezone || null, checkInTime: checkInTime || null, checkOutTime: checkOutTime || null,
        status, includedPersonIds, bookingUrl,
        pollId: stay?.pollId ?? null,
        confirmationCode: confirmationCode.trim() || null,
        totalCents,
        roomPriceCents: roomPriceCents ?? null,
        roomCount: roomPriceCents ? rooms : null,
        currency,
        costSource: totalCents ? costSource : null,
        includesTaxesAndFees: priced ? taxesAndFees === "included" ? true : taxesAndFees === "not_included" ? false : null : null,
        details: details.trim() || null,
        ...(pendingConfirmation ? { confirmationDocument: { storagePath: pendingConfirmation.upload.storagePath, fileName: pendingConfirmation.draft.sourceLabel, mimeType: pendingConfirmation.upload.mimeType ?? "application/pdf" as const, ...(pendingConfirmation.intakeId ? { intakeId: pendingConfirmation.intakeId, intakeVersion: pendingConfirmation.intakeVersion } : {}) } } : {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stay not saved. Try again.");
      setBusy(false);
    }
  }

  async function removeStay() {
    if (!remove || busy) return;
    setBusy(true);
    setError("");
    try {
      await remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stay not removed. Try again.");
      setBusy(false);
    }
  }

  return <EditorSurface close={close} inline={inline}>
    <section className="sheet stay-editor-sheet logistics-editor-sheet" role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby="stay-editor-title">
      <div className="sheet-handle" />
      <header className="sheet-header logistics-editor-header"><div><span className="people-sheet-mark"><PinIcon /></span><h2 id="stay-editor-title">{stay ? "Edit stay" : "Add stay"}</h2></div><button type="button" onClick={close} aria-label={inline ? "Cancel stay editor" : "Close stay editor"}>{inline ? "Cancel" : <CloseIcon />}</button></header>
      {sampleOnly ? <p className="event-logistics-note">Sample only. Changes reset when you reload.</p> : null}
      <form className="stay-editor-form" onSubmit={submit}>
        {confirmationUploadEnabled ? <ConfirmationUploadControl commonsSlug={commons.slug} expectedKind="stay" review={pendingConfirmation ? {...pendingConfirmation.draft, name:name || null, address:address || null, startsOn:startsOn || null, endsOn:endsOn || null, startTime:checkInTime || null, endTime:checkOutTime || null, confirmationCode:confirmationCode || null, totalCents:totalCost ? Math.round(Number(totalCost)*100) : null, currency} : undefined} onReviewSaved={revision=>setPendingConfirmation(value=>value?{...value,intakeVersion:revision}:value)} currentFileName={pendingConfirmation?.draft.sourceLabel ?? stay?.confirmationDocumentFileName} warnings={pendingConfirmation?.draft.warnings} onReady={(pending) => {
          setPendingConfirmation(pending);
          setConfirmationUploaded(Boolean(pending.alreadyUploaded));
          const { draft } = pending;
          setCurrency(draft.currency);
          if (draft.name) setName(draft.name);
          if (draft.address) setAddress(draft.address);
          if (draft.startsOn) setStartsOn(draft.startsOn);
          if (draft.endsOn) setEndsOn(draft.endsOn);
          if (draft.startTime) setCheckInTime(draft.startTime);
          if (draft.endTime) setCheckOutTime(draft.endTime);
          if (draft.confirmationCode) setConfirmationCode(draft.confirmationCode);
          if (draft.totalCents) { setTotalCost((draft.totalCents / 100).toFixed(2)); setCostSource("confirmation"); }
          if (draft.includesTaxesAndFees !== null) setTaxesAndFees(draft.includesTaxesAndFees ? "included" : "not_included");
          setStatus("confirmed");
          }} /> : null}
        <label className="field"><span>Property name</span><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="The Inn by Sea Island" /></label>
        <label className="field"><span>Address{status === "considering" ? <small> Optional while considering</small> : null}</span><input required={status !== "considering"} maxLength={240} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="100 Salt Marsh Drive" /></label>
        <label className="field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as Stay["status"])}><option value="considering">Considering</option><option value="planned">Planned</option><option value="confirmed">Confirmed</option></select></label>
        <div className="field-pair"><label className="field"><span>Check-in</span><input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="field"><span>Check-out</span><input required type="date" min={startsOn || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div>
        <fieldset className="stay-travelers"><legend>Who is staying here?</legend><div>{participants.map((participant) => <label key={participant.id}><input type="checkbox" aria-label={`Include ${participant.displayName}`} checked={includedPersonIds.includes(participant.id)} onChange={() => togglePerson(participant.id)} /><span><strong>{participant.displayName}</strong><small>{participant.accessMode === "managed" ? "Managed traveler" : participant.membershipStatus === "active" ? "Joined" : "Invited · attendance not confirmed"}</small></span></label>)}</div></fieldset>
        <details className="entry-more-details"><summary>More details</summary>
        <LocationTimezoneField label="Lodging timezone" initialQuery={address} value={stayTimezone} onChange={setStayTimezone} />
        <div className="field-pair"><label className="field"><span>Check-in time <small>Optional</small></span><TimeInput value={checkInTime} onChange={(event) => setCheckInTime(event.target.value)} /></label><label className="field"><span>Check-out time <small>Optional</small></span><TimeInput value={checkOutTime} onChange={(event) => setCheckOutTime(event.target.value)} /></label></div>
        <fieldset className="stay-cost-fields"><legend>Stay cost <small>Optional</small></legend>
          <label className="field"><span>Price is for</span><select value={priceBasis} onChange={(event) => setPriceBasis(event.target.value as "stay" | "room")}><option value="stay">The whole stay</option><option value="room">Each room, all nights</option></select></label>
          {priceBasis === "stay" ? <div className="field-pair">
            <label className="field"><span>Total</span><span className="money-input"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={totalCost} onChange={(event) => setTotalCost(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Total stay cost in ${currency}`} /></span></label>
          </div> : <div className="field-pair">
            <label className="field"><span>Price per room</span><span className="money-input"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={roomPrice} onChange={(event) => setRoomPrice(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Price per room for all nights in ${currency}`} /></span></label>
            <label className="field"><span>Rooms <small>Optional</small></span><input value={roomCount} onChange={(event) => setRoomCount(event.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="Not decided" /></label>
          </div>}
          {priceBasis === "room" && roomPrice && parseMoneyInput(roomPrice) ? <p className="stay-cost-note">{roomCount && Number(roomCount) >= 1
            ? `Group total: ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(parseMoneyInput(roomPrice)! * Number(roomCount) / 100)} for ${roomCount} ${Number(roomCount) === 1 ? "room" : "rooms"}.`
            : "Add the number of rooms to see a group total. Until then, options compare per room."}</p> : null}
          {(priceBasis === "stay" && totalCost) || (priceBasis === "room" && roomPrice) ? <>
            <label className="field"><span>What is this amount?</span><select value={costSource} onChange={(event) => setCostSource(event.target.value as NonNullable<Stay["costSource"]>)}>{costSource === "expense" ? <option value="expense">Linked expense</option> : null}<option value="estimate">Estimate</option><option value="confirmation">From confirmation</option></select></label>
            <label className="field"><span>Taxes and fees</span><select value={taxesAndFees} onChange={(event) => setTaxesAndFees(event.target.value)}><option value="unknown">Not sure</option><option value="included">Included</option><option value="not_included">Not included</option></select></label>
            <p className="stay-cost-note">Planning amount only. This does not record a payment or add an expense.</p>
          </> : null}
        </fieldset>
        <label className="field"><span>Confirmation number <small>Optional</small></span><input maxLength={120} value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} /></label>
        {stay?.confirmationDocumentUrl && !pendingConfirmation ? <a className="confirmation-document-link" href={stay.confirmationDocumentUrl} target="_blank" rel="noreferrer"><FileTextIcon /> Open confirmation</a> : null}
        <label className="field"><span>Details <small>Optional</small></span><textarea maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Room setup, cancellation date, or another shared detail" /></label>
        </details>
        <button className="sheet-primary" type="submit" disabled={busy || !name.trim() || (!address.trim() && status !== "considering") || !startsOn || !endsOn || !includedPersonIds.length}>{busy ? "Saving…" : stay ? "Save stay" : "Add stay"}</button>
      </form>
      {stay && remove ? <div className="stay-delete">{confirmDelete ? <div><p>Remove {stay.name} from the trip? Linked expenses and polls stay intact.</p><button type="button" onClick={() => void removeStay()} disabled={busy}>Remove stay</button><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep stay</button></div> : <button type="button" onClick={() => setConfirmDelete(true)}>Remove stay</button>}</div> : null}
      {stay?.totalCents && linkedExpense && openLinkedExpense ? <div className="stay-expense-link"><p><strong>Recorded for reimbursement</strong><span>{formatMoney(linkedExpense.amountCents, linkedExpense.currency)} · Paid by {linkedExpense.paidByName}</span></p><button type="button" onClick={openLinkedExpense}>View expense</button></div> : null}
      {stay?.totalCents && !linkedExpense && recordExpense ? <div className="stay-expense-link"><p><strong>No expense recorded</strong><span>Record the cost in Money to split it and use it for reimbursement.</span></p><button type="button" onClick={recordExpense}>Record as expense</button></div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  </EditorSurface>;
}


function EditorSurface({ inline, close, children }: { inline?: boolean; close: () => void; children: ReactNode }) {
  return inline ? <InlineEditor>{children}</InlineEditor> : <ModalLayer close={close}>{children}</ModalLayer>;
}


function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="section-heading">
      <h3>{title}</h3>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}


export function HomeView(props: {
  coverImage?: string | null;
  decidingStage?: boolean;
  openItem?: (id: string) => void; canAskGroup?: boolean; addPhotos?: () => void; openPhotos?: () => void; photoCount?: number;
  state: CommonsState; commons: CommonsSummary; participants: CommonsParticipant[]; currentActorId: string; activityParticipation: Record<string, ParticipationChoice>;
  travelUploadAvailable?: boolean;
  confirmationIntakeEnabled?: boolean;
  addPlan: (kind?: LogisticsAddKind) => void; addTravelPlans: (step?: import("@commons/domain").NextStep) => void;
  goToPlan: (date?: string) => void; goToMoney: () => void; goToChoiceDay: () => void; copyAddress: (address: string, label?: string) => void;
  openTripDetails: () => void; openStay: (id: string) => void; addReceipt?: () => void;
  openTodo?: (id: string) => void; tasksPanel?: React.ReactNode; tripLetter?: boolean; textMessaging?: TextMessagingChannel;
}) {
  return <HomeDashboard {...props} addReceipt={props.addReceipt ?? props.goToMoney} />;
}

function EventMomentPreview({
  moments,
  openMoments,
}: {
  moments: Moment[];
  openMoments: () => void;
}) {
  if (!moments.length) return null;
  return (
    <button className="event-moment-preview" onClick={openMoments} aria-label={`See ${moments.length} ${moments.length === 1 ? "photo" : "photos"} linked to this plan`}>
      <span className="event-moment-thumbnails" aria-hidden="true">
        {moments.slice(0, 3).map((moment) => (
          <span key={moment.id}><Image src={moment.assetUrl} alt="" fill sizes="2.25rem" unoptimized /></span>
        ))}
      </span>
      <span className="event-moment-copy"><strong>{moments.length} {moments.length === 1 ? "photo" : "photos"}</strong><small>Linked by Commons</small></span>
      <ChevronRightIcon />
    </button>
  );
}

function PlanSourceLink({ sourceUrl }: { sourceUrl: string }) {
  let source = "source";
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
    source = hostname === "alltrails.com" || hostname.endsWith(".alltrails.com")
      ? "AllTrails"
      : hostname.split(".")[0];
  } catch {
    // The contract validates persisted URLs; keep a safe generic label for older data.
  }
  return <a className="plan-source-link" href={sourceUrl} target="_blank" rel="noreferrer"><LinkIcon /> View on {source}</a>;
}

function PlanCostLine({
  item,
  expenses,
}: {
  item: CommonsState["itinerary"][number];
  expenses: Expense[];
}) {
  const recorded = new Map<string, number>();
  expenses.filter(expense => expense.itineraryItemId === item.id && expense.balanceMode !== "budget_only")
    .forEach(expense => recorded.set(expense.currency, (recorded.get(expense.currency) ?? 0) + expense.amountCents));
  const expectedCount = item.expectedParticipantIds?.length ?? 0;
  const expectedTotalCents = item.expectedCostCents
    ? item.expectedCostBasis === "per_person" ? item.expectedCostCents * expectedCount : item.expectedCostCents
    : 0;
  if (!expectedTotalCents && !recorded.size) return null;
  return (
    <p className="plan-cost-line">
      {item.expectedCostCents && item.expectedCostBasis === "per_person" ? <span>Estimated {formatMoney(item.expectedCostCents, item.expectedCostCurrency ?? "USD")} per person · {expectedCount} expected · {formatMoney(expectedTotalCents, item.expectedCostCurrency ?? "USD")} total</span> : null}
      {item.expectedCostCents && item.expectedCostBasis !== "per_person" ? <span>Estimated {formatMoney(expectedTotalCents, item.expectedCostCurrency ?? "USD")} total</span> : null}
      {[...recorded].map(([currency, amount]) => <span key={currency}>{formatMoney(amount, currency)} recorded</span>)}
    </p>
  );
}

function AttendanceControl({
  title,
  participation,
  respond,
  ask = false,
}: {
  title: string;
  participation?: ParticipationChoice;
  respond: (response: ParticipationChoice) => void;
  ask?: boolean;
}) {
  return (
    <div className={`attendance-response${ask ? " attendance-response--prompted" : ""}`}>
      {ask ? <strong>Are you attending?</strong> : null}
      <div className="participation-control" aria-label={`Your participation in ${title}`}>
        {(["in", "maybe", "skip"] as const).map((response) => (
          <button key={response} aria-pressed={participation === response} className={participation === response ? "active" : ""} onClick={() => respond(response)}>
            {response === "in" ? "I’m in" : response === "maybe" ? "Maybe" : "Skip"}
          </button>
        ))}
      </div>
    </div>
  );
}

function TravelPlansCard({
  kind,
  plans,
  participantCount,
  open,
  href,
  selectedDate,
}: {
  kind: TravelPlan["kind"];
  plans: TravelPlan[];
  participantCount: number;
  open: () => void;
  href?: string;
  selectedDate?: string;
}) {
  const label = kind === "arrival" ? "Arrivals" : kind === "departure" ? "Departures" : kind === "transport" ? "Transport" : "Rental cars";
  const coveredCount = new Set(plans.flatMap((plan) => plan.personIds ?? [plan.personId])).size;
  return (
    <section className="travel-plans-card" data-walkthrough-target={kind === "arrival" ? "travel" : undefined} aria-labelledby={`travel-plans-${kind}`}>
      <header>
        <span><RouteIcon /></span>
        <div><h4 id={`travel-plans-${kind}`}>{label}</h4></div>
        <b>{coveredCount} of {participantCount}</b>
      </header>
      {plans.length ? (
        <div className="travel-plan-preview">
          {[...plans].sort((first, second) => (first.time ?? "99:99").localeCompare(second.time ?? "99:99")).slice(0, 3).map((plan) => (
            <div key={plan.id}>
              <span aria-hidden="true">{travelPlanInitials(plan)}</span>
              <p><strong>{plan.personName}</strong><small>{plan.kind === "car_rental" && plan.returnDate && selectedDate === plan.returnDate ? `Return · ${formatDayHeading(plan.returnDate)}` : `${plan.kind === "car_rental" ? "Pick-up · " : ""}${formatDayHeading(plan.date)}`} · {plan.route}</small></p>
              <time>{formatTravelTime(plan.kind === "car_rental" && selectedDate === plan.returnDate ? plan.returnTime : plan.time)}</time>
            </div>
          ))}
        </div>
      ) : <p className="travel-plan-empty">No one has shared plans for this day yet.</p>}
      {href ? <Link className="travel-add-another" href={href}>Manage travel <ChevronRightIcon /></Link> : <button type="button" onClick={open}>{plans.length ? "View or add yours" : "Add your plans"}<ChevronRightIcon /></button>}
    </section>
  );
}

export function PlanView({
  section = "schedule",
  openItem,
  canSchedule,
  state,
  commons,
  days,
  seededPilot,
  selectedDay,
  setSelectedDay,
  activityParticipation,
  respondToActivity,
  openMoments,
  travelPlans,
  openTravelPlans,
  participantCount,
  participants,
  addPlan,
  editPlan,
  scheduleIdea,
  canEditPlan,
  openStay,
  askGroupPath,
  askHref,
  sectionNavigation,
}: {
  sectionNavigation?: ReactNode;
  /** The organizer's Ask the group entry (the poll editor); absent for travelers. */
  askHref?: string;
  /** Organizers on a saved trip: the private poll draft for selected shared ideas (/polls/new?activityIds=). */
  askGroupPath?: (activityIds: string[]) => string;
  section?: "schedule" | "travel" | "ideas";
  openItem: (id: string) => void;
  canSchedule: boolean;
  state: CommonsState;
  commons: CommonsSummary;
  days: DayOption[];
  seededPilot: boolean;
  selectedDay: string;
  setSelectedDay: (day: string) => void;
  activityParticipation: Record<string, ParticipationChoice>;
  respondToActivity: (itemId: string, response: ParticipationChoice) => void;
  openMoments: () => void;
  travelPlans: TravelPlan[];
  openTravelPlans: (kind: TravelPlan["kind"]) => void;
  participantCount: number;
  participants: CommonsParticipant[];
  addPlan: (kind?: LogisticsAddKind) => void;
  editPlan: (itemId: string) => void;
  scheduleIdea: (itemId: string, day: string) => void;
  canEditPlan: boolean;
  openStay: (stayId: string) => void;
  openTripDetails: () => void;
}) {
  const [draggedIdeaId, setDraggedIdeaId] = useState<string | null>(null);
  // Ideas chosen for an Ask the group poll; nothing is saved or shared by choosing them.
  const [askIds, setAskIds] = useState<Set<string>>(() => new Set());
  // A link to undated ideas lands on No day yet, even when it is empty.
  useEffect(() => {
    if (section !== "ideas") return;
    const heading = document.getElementById("plan-ideas-title");
    heading?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [section]);
  const [ideaDropDay, setIdeaDropDay] = useState<string | null>(null);
  const ideas = state.itinerary.filter((item) => !item.startsAt && !item.scheduledDate && item.status !== "cancelled");
  const scheduledItems = state.itinerary.filter((item) => (item.startsAt || item.scheduledDate) && item.status !== "cancelled");
  const selectedDayOption = selectedPlanDay(days, selectedDay) ?? days[0] ?? null;
  const selectedIndex = days.findIndex(day => day.id === selectedDayOption?.id);
  const items = selectedDayOption
    ? scheduledItems.filter((item) => (item.scheduledDate ?? (item.startsAt ? localDateKey(item.startsAt, commons.timezone) : null)) === selectedDayOption.id)
    : [];
  const isChoiceDay = seededPilot && selectedDayOption?.id === "2027-07-22";
  const dayTravelPlans = travelPlans.filter(plan => plan.date === selectedDayOption?.id || (plan.kind === "car_rental" && plan.returnDate === selectedDayOption?.id));
  const travelKinds = [...new Set(dayTravelPlans.map(plan => plan.kind))];
  const dayStays = selectedDayOption
    ? (state.stays ?? []).filter((stay) => stay.status !== "considering" && stay.startsOn <= selectedDayOption.id && stay.endsOn >= selectedDayOption.id)
    : [];
  const timeGroups = [...items.filter(item => !item.startsAt).map(item => [item]), ...[...new Set(items.filter(item => item.startsAt).map(item => item.startsAt))].map(startsAt => items.filter(item => item.startsAt === startsAt))];
  const isInteractiveAttendance = (item: CommonsState["itinerary"][number]) =>
    item.participantScope === "optional";
  const dayNote = selectedDayOption?.outsideTrip ? "Outside trip dates" : selectedIndex < 0
    ? "Dates not set"
    : isChoiceDay
      ? "Choose your own afternoon"
      : items.length > 1
        ? `${items.length} plans`
      : selectedIndex === 0
        ? "First day"
        : selectedIndex === days.length - 1
          ? "Last day"
          : "Open to shape";

  function beginIdeaDrag(event: DragEvent<HTMLElement>, ideaId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-commons-plan-idea", ideaId);
    setDraggedIdeaId(ideaId);
  }

  function allowIdeaDrop(event: DragEvent<HTMLElement>, day: string) {
    if (!draggedIdeaId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIdeaDropDay(day);
  }

  function dropIdea(event: DragEvent<HTMLElement>, day: string) {
    if (!draggedIdeaId) return;
    event.preventDefault();
    const ideaId = event.dataTransfer.getData("application/x-commons-plan-idea") || draggedIdeaId;
    setDraggedIdeaId(null);
    setIdeaDropDay(null);
    if (ideas.some((idea) => idea.id === ideaId)) scheduleIdea(ideaId, day);
  }

  const ideasSection = ideas.length ? (
    <section className="plan-ideas" aria-labelledby="plan-ideas-title">
      <div className="section-heading"><h3 id="plan-ideas-title">No day yet</h3><span>{draggedIdeaId ? "Drop on a day" : `${ideas.length} not scheduled`}</span></div>
      <div className="plan-idea-list">
        {ideas.map((idea) => (
          <article
            key={idea.id}
            className={`plan-idea-card${draggedIdeaId === idea.id ? " plan-idea-card--dragging" : ""}`}
            draggable={canSchedule}
            onDragStart={(event) => beginIdeaDrag(event, idea.id)}
            onDragEnd={() => { setDraggedIdeaId(null); setIdeaDropDay(null); }}
          >
            <span className="plan-idea-mark" aria-hidden="true"><MessageIcon /></span>
            <div className="plan-idea-card__copy">
              <small>{idea.participantScope === "everyone" ? "For everyone" : idea.participantScope === "optional" ? "Whoever wants to join" : `For ${participantFirstNames(participantsForItem(idea, participants)) || "specific people"}`}</small>
              <h4><button className="plan-detail-title" type="button" onClick={() => openItem(idea.id)}>{idea.title}</button></h4>
              {idea.location ? <PlanLocationLink location={idea.location} /> : null}
              {idea.sourceUrl ? <PlanSourceLink sourceUrl={idea.sourceUrl} /> : null}
              <MealTypeLine type={idea.mealType} />
              <ActivityArrangerLine item={idea} />
              <PlanCostLine item={idea} expenses={state.expenses} />
              {itineraryDurationMinutes(idea) !== null ? <p className="plan-item-note">{formatDuration(itineraryDurationMinutes(idea)!)}</p> : null}
              {idea.note ? <p>{idea.note}</p> : null}
              <span>{idea.provenanceLabel}</span>
              {askGroupPath && idea.participantScope === "everyone" ? <label className="plan-idea-ask"><input type="checkbox" checked={askIds.has(idea.id)}
                onChange={event => setAskIds(current => { const next = new Set(current); if (event.target.checked) next.add(idea.id); else next.delete(idea.id); return next; })} /> Include in a poll</label> : null}
            </div>
            {canEditPlan ? <div className="plan-idea-card__actions">{canSchedule ? <button className="plan-idea-schedule" type="button" onClick={() => scheduleIdea(idea.id, selectedDayOption?.id ?? "")} aria-label={`Add ${idea.title} to schedule`}><CalendarIcon /> Add to schedule</button> : null}<button className="plan-edit-action" type="button" onClick={() => editPlan(idea.id)} aria-label={`Edit ${idea.title}`} title="Edit activity"><EditIcon /></button></div> : null}
          </article>
        ))}
      </div>
      {askGroupPath && ideas.filter(idea => idea.participantScope === "everyone").length >= 2 ? <div className="plan-ideas-ask">
        {[...askIds].filter(id => ideas.some(idea => idea.id === id)).length >= 2
          ? <a className="cm-action cm-action--primary" href={askGroupPath([...askIds].filter(id => ideas.some(idea => idea.id === id)))}>Ask the group about these ({[...askIds].filter(id => ideas.some(idea => idea.id === id)).length})</a>
          : <span className="event-logistics-note">Choose two or more ideas to ask the group which they’d do.</span>}
        <p className="event-logistics-note">This starts a private poll draft. You review it before sharing; nothing is scheduled or booked.</p>
      </div> : null}
    </section>
  ) : section === "ideas" ? (
    <section className="plan-ideas plan-ideas--empty" aria-labelledby="plan-ideas-title">
      <div className="section-heading"><h3 id="plan-ideas-title">No day yet</h3><span>0 not scheduled</span></div>
      <p className="event-logistics-note">No activities without a day.</p>
    </section>
  ) : null;

  return (
    <div className={`product-view plan-view${section === "ideas" ? " plan-view--ideas" : ""}${selectedDayOption ? "" : " plan-view--undated"}`}>
      <div className="view-intro view-intro--with-action event-page-header">
        <div><h2>{planTemplateFor(commons.templateKey).planSections.activities.label}</h2><p>{scheduledItems.length} with a day{ideas.length ? ` · ${ideas.length} without a day` : ""}.</p></div>
        <div className="plan-actions">{!seededPilot && askHref ? <Link className="view-secondary-action" href={askHref}><QuestionIcon /> Ask the group</Link> : null}<LogisticsAddMenu canAddStay={canSchedule} choose={addPlan} /></div>
      </div>
      {sectionNavigation}
      {days.length ? <EventDaySelector days={days} selected={selectedDayOption?.id ?? ""} select={setSelectedDay} label="Trip days" dragging={Boolean(draggedIdeaId)} dropDay={ideaDropDay} allowDrop={allowIdeaDrop} leaveDrop={id => setIdeaDropDay(current => current === id ? null : current)} drop={dropIdea} /> : null}
      {ideasSection}
      {selectedDayOption ? <div className="plan-day-content">
        <div className="plan-day-title">
          <b className="plan-date-folio" aria-hidden="true">{selectedDayOption.date}</b>
          <div><span>{dayNote}</span><h3>{formatDayHeading(selectedDayOption.id)}</h3></div>
        </div>

        {travelKinds.map(travelKind => (
          <TravelPlansCard
            key={travelKind}
            kind={travelKind}
            plans={dayTravelPlans.filter(plan => plan.kind === travelKind)}
            selectedDate={selectedDayOption.id}
            participantCount={participantCount}
            open={() => openTravelPlans(travelKind)}
            href={commonsTravelPath(commons.id)}
          />
        ))}

        {dayStays.length ? <section className="plan-day-stays" aria-label="Stays for this day">{dayStays.map((stay) => {
          const dayLabel = selectedDayOption.id === stay.startsOn ? "Check-in" : selectedDayOption.id === stay.endsOn ? "Check-out" : "Staying here";
          const time = selectedDayOption.id === stay.startsOn ? stay.checkInTime : selectedDayOption.id === stay.endsOn ? stay.checkOutTime : undefined;
          return <button type="button" key={stay.id} onClick={() => openStay(stay.id)}><span><PinIcon /></span><p><small>{dayLabel}{time ? ` · ${formatTravelTime(time)}` : ""}</small><strong>{stay.name}</strong><em>{stay.status[0].toUpperCase() + stay.status.slice(1)} · {stay.includedPersonIds.length} travelers</em></p><ChevronRightIcon /></button>;
        })}</section> : null}

        <div className="timeline" aria-label="Itinerary">
        {items.length === 0 && !dayStays.length ? (
          <div className="empty-day"><RouteIcon /><h3>No plans yet.</h3></div>
        ) : null}
        {state.itinerary.length === 0 && planTemplateFor(commons.templateKey).planSections.outline.length ? <div className="plan-outline"><p>A rough outline to start from</p><ul>{planTemplateFor(commons.templateKey).planSections.outline.map(line => <li key={line}>{line}</li>)}</ul></div> : null}
        {timeGroups.map((group) => group.length > 1 ? (
          <div className="parallel-block" key={group[0].startsAt} data-walkthrough-target={isChoiceDay ? "parallel-plans" : undefined}>
            <div className="timeline-time"><time>{group[0].startsAt ? formatTime(group[0].startsAt, commons.timezone) : "Time not set"}</time><i /></div>
            <div><span className="parallel-label">The group is splitting up</span>
              {group.map((item) => {
                const participation = activityParticipation[item.id] ?? "maybe";
                const eventMoments = state.moments.filter((moment) => moment.itineraryItemId === item.id);
                return (
                  <article key={item.id} className="parallel-item">
                    <span>{item.participantScope === "optional" ? "Optional" : item.participantScope === "everyone" ? "Everyone" : "Subgroup"}</span>
                    <h4><button className="plan-detail-title" type="button" onClick={() => openItem(item.id)}>{item.title}</button></h4>
                    {item.location ? <PlanLocationLink location={item.location} /> : null}
                    {item.sourceUrl ? <PlanSourceLink sourceUrl={item.sourceUrl} /> : null}
                    <MealTypeLine type={item.mealType} />
                    <ActivityArrangerLine item={item} />
                    <PlanCostLine item={item} expenses={state.expenses} />
                    {itineraryDurationMinutes(item) !== null ? <p className="plan-item-note">{formatDuration(itineraryDurationMinutes(item)!)}</p> : null}
                    <p>{item.provenanceLabel}</p>
                    {item.note ? <p className="plan-item-note">{item.note}</p> : null}
                    {canEditPlan ? <button className="plan-edit-action" type="button" onClick={() => editPlan(item.id)} aria-label={`Edit ${item.title}`} title="Edit plan"><EditIcon /></button> : null}
                    <SubgroupDetails item={item} participants={participants} />
                    <EventMomentPreview moments={eventMoments} openMoments={openMoments} />
                    {isInteractiveAttendance(item) ? (
                      <AttendanceControl title={item.title} participation={participation} respond={(response) => respondToActivity(item.id, response)} />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <article className="timeline-item" key={group[0].id}>
            <div className="timeline-time"><time>{group[0].startsAt ? formatTime(group[0].startsAt, commons.timezone) : "Time not set"}</time><i /></div>
            <div className="timeline-copy">
              <span>{group[0].participantScope === "everyone" ? "Everyone" : group[0].participantScope === "optional" ? "Optional" : "Subgroup"}</span>
              <h4><button className="plan-detail-title" type="button" onClick={() => openItem(group[0].id)}>{group[0].title}</button></h4>
              {group[0].location ? <PlanLocationLink location={group[0].location} /> : null}
              {group[0].sourceUrl ? <PlanSourceLink sourceUrl={group[0].sourceUrl} /> : null}
              <MealTypeLine type={group[0].mealType} />
              <ActivityArrangerLine item={group[0]} />
              <PlanCostLine item={group[0]} expenses={state.expenses} />
              {itineraryDurationMinutes(group[0]) !== null ? <p className="plan-item-note">{formatDuration(itineraryDurationMinutes(group[0])!)}</p> : null}
              <p>{group[0].provenanceLabel}</p>
              {group[0].note ? <p className="plan-item-note">{group[0].note}</p> : null}
              {canEditPlan ? <button className="plan-edit-action" type="button" onClick={() => editPlan(group[0].id)} aria-label={`Edit ${group[0].title}`} title="Edit plan"><EditIcon /></button> : null}
              <SubgroupDetails item={group[0]} participants={participants} />
              <EventMomentPreview moments={state.moments.filter((moment) => moment.itineraryItemId === group[0].id)} openMoments={openMoments} />
              {isInteractiveAttendance(group[0]) ? <AttendanceControl ask title={group[0].title} participation={activityParticipation[group[0].id]} respond={(response) => respondToActivity(group[0].id, response)} /> : null}
            </div>
          </article>
        ))}
        </div>
      </div> : <div className="plan-day-content"><div className="empty-day"><CalendarIcon /><h3>No scheduled plans.</h3></div>{state.itinerary.length === 0 && planTemplateFor(commons.templateKey).planSections.outline.length ? <div className="plan-outline"><p>A rough outline to start from</p><ul>{planTemplateFor(commons.templateKey).planSections.outline.map(line => <li key={line}>{line}</li>)}</ul></div> : null}</div>}
    </div>
  );
}

import "./trip-workspace-refinements.css";
import "./trip-journal.css";
import { commonsCoverArtwork, suggestTripCover, type LocalArtwork } from "@/lib/covers";
import { TripBudgetPanel } from "./trip-budget-panel";
import type { BudgetInputs } from "@/lib/budget/budget-calculations";

type MoneyViewProps = Omit<Parameters<typeof MoneyCurrencySection>[0], "currency" | "primary" | "showCurrencyLabel">;

export function MoneyView(props: MoneyViewProps) {
  const { state, commons, participants, openMoneySettings, addExpense, expensesClosedAt } = props;
  const tripCurrency = commons.currency ?? "USD";
  const currencies = [...new Set([
    tripCurrency,
    ...(props.worksheet ? [props.worksheet.currency] : []),
    ...(state.targetBudgetCents !== undefined ? [state.targetBudgetCurrency ?? "USD"] : []),
    ...state.itinerary.filter(row => row.expectedCostCents).map(row => row.expectedCostCurrency ?? "USD"),
    ...state.expenses.map(row => row.currency),
    ...(commons.balancesDisabled ? [] : state.reimbursements.map(row => row.currency)),
    ...(state.stays ?? []).filter(row => row.totalCents).map(row => row.currency ?? "USD"),
    ...(state.travelPlans ?? []).filter(row => row.visibility === "all" && row.totalCents).map(row => row.currency ?? "USD"),
  ])].sort((a, b) => a === tripCurrency ? -1 : b === tripCurrency ? 1 : a.localeCompare(b));
  const recorded = state.expenses.filter(expense => expense.balanceMode !== "budget_only");
  const active = participants.filter(person => person.membershipStatus === "active");
  const closed = Boolean(expensesClosedAt) || (active.length > 0 && active.every(person => person.expensesCompleteAt));
  return <div className="product-view money-page">
    <div className="view-intro view-intro--with-action event-page-header"><div><h2>Money</h2><p>{recorded.length ? `${recorded.length} ${recorded.length === 1 ? "expense" : "expenses"} recorded.` : "Start with an estimate or a shared expense."}</p>{openMoneySettings ? <button className="money-settings-link" type="button" onClick={openMoneySettings}><span>Money settings</span><small>{commons.balancesDisabled ? "Family trip · Balances off" : "Balances on"}</small><ChevronRightIcon /></button> : null}</div><div className="money-actions"><a className="view-secondary-action" href={`/c/${commons.id}/money/summary`} target="_blank" rel="noopener noreferrer">Trip ledger<span className="sr-only"> (opens in a new tab)</span></a>{closed ? null : <button className="view-primary-action" type="button" onClick={() => addExpense(tripCurrency)}><PlusIcon /> Add expense</button>}</div></div>
    {currencies.map(currency => <MoneyCurrencySection key={currency} {...props} currency={currency} primary={currency === tripCurrency} showCurrencyLabel={currencies.length > 1} />)}
  </div>;
}

function MoneyCurrencySection({
  openItem,
  state,
  commons,
  participants,
  postTrip,
  currentActorId,
  openExpense,
  openPayment,
  recordPayment,
  markExpensesComplete,
  closeExpenses,
  reopenExpenses,
  expensesClosedAt,
  expensesClosedByName,
  saveTargetBudget,
  currency,
  primary,
  worksheet,
  budgetEditor,
  showCurrencyLabel,
}: {
  showCurrencyLabel: boolean;
  budgetEditor?: (targetControl: ReactNode) => ReactNode;
  worksheet?: BudgetInputs | null;
  openItem: (kind: "plan" | "stay", id: string) => void;
  state: CommonsState;
  commons: CommonsSummary;
  participants: CommonsParticipant[];
  tripStarted: boolean;
  postTrip: boolean;
  currentActorId: string;
  openExpense: (expenseId: string) => void;
  openPayment: (paymentId: string) => void;
  addExpense: (currency: string) => void;
  openMoneySettings?: () => void;
  recordPayment: (currency: string) => void;
  markExpensesComplete: () => Promise<void>;
  closeExpenses: () => void;
  reopenExpenses: () => void;
  expensesClosedAt: string | null;
  expensesClosedByName: string | null;
  saveTargetBudget: (amountCents: number | null, currency: string) => Promise<void>;
  currency: string;
  primary: boolean;
}) {
  const [showBalances, setShowBalances] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [savingTarget, setSavingTarget] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(() => !state.expenses.some(row => row.currency === currency && row.balanceMode !== "budget_only"));
  const [targetDraft, setTargetDraft] = useState(state.targetBudgetCents ? (state.targetBudgetCents / 100).toFixed(2) : "");
  const targetCurrency = state.targetBudgetCents !== undefined ? state.targetBudgetCurrency ?? "USD" : commons.currency ?? "USD";
  const money = (cents: number) => formatMoney(cents, currency);
  const { expenses, actualExpenses, reimbursements, balances, transfers } = currencyLedger(state, currency, participants.map(person => person.id), commons.balancesDisabled);
  const budgetOnlyExpenses = expenses.filter((expense) => expense.balanceMode === "budget_only");
  const budgetPlanIds = new Set(budgetOnlyExpenses.flatMap((expense) => expense.itineraryItemId ? [expense.itineraryItemId] : []));
  const budgetStayIds = new Set(budgetOnlyExpenses.flatMap((expense) => expense.stayId ? [expense.stayId] : []));
  const budgetTravelIds = new Set(budgetOnlyExpenses.flatMap((expense) => expense.travelPlanId ? [expense.travelPlanId] : []));
  const tripCost = calculateExpectedTripCost(state.itinerary, expenses, state.stays ?? [], state.travelPlans ?? [], currency, worksheet);
  const worksheetForecast = calculateBudgetForecastAdjustment(state.itinerary, expenses, state.stays ?? [], state.travelPlans ?? [], currency, worksheet);
  const plannedCostsById = new Map(calculateExpectedPlanCosts(state.itinerary, expenses, currency).map((cost) => [cost.planId, cost]));
  const plannedCostItems = state.itinerary.flatMap((item) => {
    const cost = plannedCostsById.get(item.id);
    return cost && !budgetPlanIds.has(item.id) ? [{ item, ...cost }] : [];
  });
  const stayCostsById = new Map(calculateExpectedStayCosts(state.stays ?? [], expenses, currency).map((cost) => [cost.stayId, cost]));
  const plannedStayCosts = (state.stays ?? []).flatMap((stay) => {
    const cost = stayCostsById.get(stay.id);
    return cost && !budgetStayIds.has(stay.id) ? [{ stay, ...cost }] : [];
  });
  const travelCostsById = new Map(calculateExpectedTravelCosts(state.travelPlans ?? [], expenses, currency).map((cost) => [cost.travelPlanId, cost]));
  const plannedTravelCosts = (state.travelPlans ?? []).flatMap((travelPlan) => {
    const cost = travelCostsById.get(travelPlan.id);
    return cost && !budgetTravelIds.has(travelPlan.id) ? [{ travelPlan, ...cost }] : [];
  });
  const plannedCostCount = plannedCostItems.length + plannedStayCosts.length + plannedTravelCosts.length + budgetOnlyExpenses.length;
  const participantName = (personId: string) =>
    participants.find((participant) => participant.id === personId)?.displayName ?? "Unknown participant";
  const currentBalance = balances.find((balance) => balance.personId === currentActorId);
  const total = tripCost.recordedCents;
  const totalReimbursed = reimbursements.reduce((sum, reimbursement) => sum + reimbursement.amountCents, 0);
  const visibleExpenses = showAllExpenses ? actualExpenses : actualExpenses.slice(0, 8);
  const balanceLabel = !currentBalance?.netCents
    ? "Settled up"
    : currentBalance.netCents < 0
      ? "You owe"
      : "You get back";
  const balanceAmount = Math.abs(currentBalance?.netCents ?? 0);
  const activeParticipants = participants.filter((participant) => participant.membershipStatus === "active");
  const completedParticipants = activeParticipants.filter((participant) => participant.expensesCompleteAt);
  const currentParticipant = activeParticipants.find((participant) => participant.id === currentActorId);
  const currentParticipantComplete = Boolean(currentParticipant?.expensesCompleteAt);
  const closedByOrganizer = Boolean(expensesClosedAt);
  const expensesClosed = closedByOrganizer || (activeParticipants.length > 0 && completedParticipants.length === activeParticipants.length);
  const currentParticipantIsOrganizer = currentParticipant?.role === "organizer";
  const budgetDifference = currency !== targetCurrency || state.targetBudgetCents === undefined
    ? null
    : state.targetBudgetCents - tripCost.expectedTotalCents;
  const budgetStatus = budgetDifference === null
    ? null
    : budgetDifference === 0
      ? "On target"
      : `${money(Math.abs(budgetDifference))} ${budgetDifference > 0 ? "under target" : "over target"}`;

  const targetControl = primary && currentParticipantIsOrganizer ? (
    <form className="target-budget-form" onSubmit={event => {
      event.preventDefault();
      const cents = targetDraft ? parseMoneyInput(targetDraft) : null;
      if (targetDraft && !cents) return;
      setSavingTarget(true);
      void saveTargetBudget(cents, targetCurrency).catch(() => {}).finally(() => setSavingTarget(false));
    }}>
      <label><span>Spending target <small>Optional · {targetCurrency}</small></span><span className="money-input"><b aria-hidden="true">{currencySymbol(targetCurrency)}</b><input value={targetDraft} onChange={event => setTargetDraft(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Optional trip budget target in ${targetCurrency}`} /></span></label>
      <small className="target-budget-form__hint">A limit to compare with the forecast. Leave blank to remove it.</small>
      <button type="submit" disabled={savingTarget}>{savingTarget ? "Saving…" : "Save target"}</button>
    </form>
  ) : null;

  const forecast = (
      <details className="money-plan-column money-plan-column--compact money-plan-column--secondary" open={planExpanded} onToggle={(event) => setPlanExpanded(event.currentTarget.open)}>
        <summary><span><strong>Cost forecast</strong><small>{budgetStatus ?? (plannedCostCount ? `${plannedCostCount} planned ${plannedCostCount === 1 ? "cost" : "costs"}` : "Your budget and planned costs")}</small></span><span><strong>{money(tripCost.expectedTotalCents)}</strong></span><ChevronRightIcon /></summary>
        <div className="money-plan-column__contents">
        <section className="expected-cost-panel" aria-label="Expected trip cost">
          <div className="forecast-saved-context"><span>Recorded spending <strong>{money(tripCost.recordedCents)}</strong></span><span>Still expected <strong>{money(tripCost.expectedTotalCents - tripCost.recordedCents)}</strong></span></div>
          {worksheetForecast.additionalCents > 0 ? <div className="forecast-budget-breakdown"><p>Your budget adds {money(worksheetForecast.additionalCents)} for costs not yet covered by plans or expenses.</p><dl>{worksheetForecast.categories.filter(row => row.remainingCents > 0).map(row => <div key={row.key}><dt>{row.label}</dt><dd>{money(row.remainingCents)}</dd></div>)}</dl></div> : null}

          {currency === targetCurrency && state.targetBudgetCents !== undefined ? <div className="expected-cost-target"><span>Spending target</span><b>{money(state.targetBudgetCents)}</b></div> : null}
          {budgetStatus ? <div className="expected-cost-difference"><span>Difference</span><b>{budgetStatus}</b></div> : null}

        </section>
        {plannedCostCount ? <section className="planned-cost-section" aria-labelledby={`planned-cost-title-${currency}`}>
          <SectionHeading title="Planned costs" detail={`${plannedCostCount} ${plannedCostCount === 1 ? "item" : "items"}`} />
          <h3 id={`planned-cost-title-${currency}`} className="sr-only">Budgeted and planned items</h3>
          <div className="planned-cost-ledger">
            {plannedCostItems.map(({ item, estimatedCents, recordedCents, remainingExpectedCents }) => {
              const expectedCount = item.expectedParticipantIds?.length ?? 0;
              const estimateDetail = `${item.startsAt ? "Scheduled" : "Idea"} · ${item.expectedCostBasis === "per_person"
                ? `${money(item.expectedCostCents!)} per person × ${expectedCount} expected`
                : "Total estimate"}`;
              const coverageDetail = recordedCents === 0
                ? "Still expected"
                : remainingExpectedCents > 0
                  ? `${money(remainingExpectedCents)} still expected · ${money(recordedCents)} recorded`
                  : `Covered by ${money(recordedCents)} recorded`;
              return <article key={item.id} aria-label={`${item.title}, ${money(estimatedCents)} estimated`}>
                <span className="planned-cost-mark"><CalendarIcon /></span>
                <span><button className="plan-detail-title" type="button" onClick={() => openItem("plan", item.id)}>{item.title}</button><small>{estimateDetail}</small></span>
                <span><strong>{money(estimatedCents)}</strong><small>{coverageDetail}</small></span>
              </article>;
            })}
            {plannedStayCosts.map(({ stay, estimatedCents, recordedCents, remainingExpectedCents }) => {
              const source = stay.costSource === "confirmation" ? "From confirmation" : stay.costSource === "expense" ? "Linked expense" : "Estimate";
              const coverageDetail = recordedCents === 0
                ? "Still expected"
                : remainingExpectedCents > 0
                  ? `${money(remainingExpectedCents)} still expected · ${money(recordedCents)} recorded`
                  : `Covered by ${money(recordedCents)} recorded`;
              return <article key={stay.id} aria-label={`${stay.name}, ${money(estimatedCents)} planned`}>
                <span className="planned-cost-mark"><PinIcon /></span>
                <span><button className="plan-detail-title" type="button" onClick={() => openItem("stay", stay.id)}>{stay.name}</button><small>Stay · {source}</small></span>
                <span><strong>{money(estimatedCents)}</strong><small>{coverageDetail}</small></span>
              </article>;
            })}
            {plannedTravelCosts.map(({ travelPlan, estimatedCents, recordedCents, remainingExpectedCents }) => {
              const coverageDetail = recordedCents === 0
                ? "Still expected"
                : remainingExpectedCents > 0
                  ? `${money(remainingExpectedCents)} still expected · ${money(recordedCents)} recorded`
                  : `Covered by ${money(recordedCents)} recorded`;
              return <article key={travelPlan.id} aria-label={`${travelPlan.provider || "Travel"}, ${money(estimatedCents)} planned`}>
                <span className="planned-cost-mark"><RouteIcon /></span>
                <span><strong>{travelPlan.provider || (travelPlan.kind === "car_rental" ? "Rental car" : "Travel")}</strong><small>Travel · Shared estimate</small></span>
                <span><strong>{money(estimatedCents)}</strong><small>{coverageDetail}</small></span>
              </article>;
            })}
            {budgetOnlyExpenses.map((expense) => <article key={expense.id}><button type="button" onClick={() => openExpense(expense.id)} aria-label={`Review ${expense.title}, ${money(expense.amountCents)} budgeted`}><span className="planned-cost-mark"><ReceiptIcon /></span><span><strong>{expense.title}</strong><small>Budget · Not recorded as spent</small></span><span><strong>{money(expense.amountCents)}</strong><small>Still expected</small></span><ChevronRightIcon /></button></article>)}
          </div>
        </section> : null}
        </div>
        {primary && budgetEditor ? <details className="money-budget-editor"><summary>{currentParticipantIsOrganizer ? "Edit estimates" : "View estimates"}</summary>{budgetEditor(targetControl)}</details> : null}
      </details>
  );
  return (
    <section className={`money-view money-currency-section${actualExpenses.length === 0 ? " money-currency-section--estimating" : ""}`} aria-label={currencyLabel(currency)}>
      <div className="money-currency-heading"><span className={showCurrencyLabel ? "money-currency-label" : "sr-only"}>{currencyLabel(currency)}</span>{actualExpenses.length && !commons.balancesDisabled ? <button className="view-secondary-action" type="button" onClick={() => recordPayment(currency)}><CheckIcon /> Record payment</button> : null}</div>
      {actualExpenses.length === 0 ? forecast : null}
      {(actualExpenses.length || reimbursements.length) && !commons.balancesDisabled ? <section className="balance-panel">
        <span>Your balance</span><strong><small>{balanceLabel}</small><b>{money(balanceAmount)}</b></strong><p>{balanceAmount ? "Includes recorded expenses (including needs-review and disputed records) and reimbursements." : "You’re settled."}</p><button aria-expanded={showBalances} onClick={() => setShowBalances((visible) => !visible)}>{showBalances ? "Hide breakdown" : "Review balances"}</button>
        {showBalances ? (
          <div className="balance-breakdown">
            {transfers.length ? transfers.map((transfer) => (
              <div key={`${transfer.fromPersonId}-${transfer.toPersonId}`}><span>{participantName(transfer.fromPersonId)} → {participantName(transfer.toPersonId)}</span><strong>{money(transfer.amountCents)}</strong><small>From the current ledger</small></div>
            )) : <div><span>Everyone</span><strong>{money(0)}</strong><small>No balances left.</small></div>}
          </div>
        ) : null}
      </section> : null}
      {actualExpenses.length ? <div className={`money-summary${commons.balancesDisabled ? " money-summary--tracking" : ""}`}><div><span>Group spending</span><strong>{money(total)}</strong></div>{commons.balancesDisabled ? <div><span>Family trip</span><strong>No balances</strong></div> : <div><span>Your share</span><strong>{money(currentBalance?.shareCents ?? 0)}</strong></div>}</div> : null}
      {primary && postTrip && state.expenses.some(expense => expense.balanceMode !== "budget_only") && !commons.balancesDisabled ? <section className={`expense-close-panel${expensesClosed ? " expense-close-panel--closed" : ""}`} aria-labelledby="expense-close-title">
        <div className="expense-close-copy">
          <span className="expense-close-icon"><CheckIcon /></span>
          <div>
            <span>{expensesClosed ? "Expenses closed" : "Expenses open"}</span>
            <h3 id="expense-close-title">{expensesClosed ? closedByOrganizer ? "Expenses are closed." : "Everyone added their expenses." : "Confirm you’ve added everything."}</h3>
            <p>{expensesClosed ? closedByOrganizer ? `${expensesClosedByName ?? "An organizer"} closed the ledger so the group can settle.` : "Everyone confirmed. The ledger is closed so the group can settle." : `${completedParticipants.length} of ${activeParticipants.length} travelers confirmed.`}</p>
          </div>
        </div>
        <div className="expense-close-people" aria-label={`${completedParticipants.length} of ${activeParticipants.length} travelers confirmed`}>
          {activeParticipants.map((participant) => <span key={participant.id} className={participant.expensesCompleteAt ? "complete" : ""} title={`${participant.displayName}${participant.expensesCompleteAt ? " confirmed" : " has not confirmed"}`}>{participant.expensesCompleteAt ? <CheckIcon /> : participant.initials}</span>)}
        </div>
        <div className="expense-close-action">
          {expensesClosed ? currentParticipantIsOrganizer ? <button type="button" onClick={reopenExpenses}>Reopen expenses</button> : <span><CheckIcon /> Expenses are closed</span> : <>{currentParticipantComplete ? <span><CheckIcon /> You’ve added everything</span> : <button type="button" onClick={() => void markExpensesComplete()}><CheckIcon /> I’ve added everything</button>}{currentParticipantIsOrganizer ? <button className="expense-close-organizer" type="button" onClick={closeExpenses}>Close expenses</button> : null}</>}
        </div>
      </section> : null}
      <div className="money-ledger-column">
      <section className="expense-section" data-walkthrough-target="money">
        {actualExpenses.length > 0 ? <SectionHeading title="Expenses" detail={`${actualExpenses.length} recorded`} /> : null}
        {actualExpenses.length ? <div className="expense-ledger">
          {visibleExpenses.map((expense) => {
            const yourShare = expense.shares.find((share) => share.personId === currentActorId);
            const payerName = expense.paidByName.split(" ")[0];
            const expenseScope = commons.balancesDisabled
              ? `${payerName} paid`
              : expense.balanceMode === "tracking_only"
                ? `${payerName} paid · No balance allocation`
                : `${payerName} paid · ${expense.shares.length} of ${participants.length} included`;
            const personalScope = commons.balancesDisabled
              ? null
              : expense.balanceMode === "tracking_only"
                ? "No balance allocation"
                : yourShare
                  ? `Your share ${money(yourShare.amountCents)}`
                  : "Not your expense";
            return (
              <button key={expense.id} onClick={() => openExpense(expense.id)} aria-label={`Review ${expense.title}, ${money(expense.amountCents)}`}>
                <span className="expense-initial">{expense.paidByName[0]}</span>
                <span><strong>{expense.title}</strong><small>{expenseScope}</small></span>
                <span><strong>{money(expense.amountCents)}</strong>{personalScope ? <small className={expense.balanceMode === "tracking_only" || !yourShare ? "quiet" : ""}>{personalScope}</small> : null}</span>
                <ChevronRightIcon />
              </button>
            );
          })}
        </div> : primary ? <div className="money-empty-expenses"><h3>No expenses yet</h3><p>When someone pays, add the expense to track spending and split the cost.</p></div> : <p>No recorded expenses in {currency}.</p>}
        {actualExpenses.length > 8 ? <button className="ledger-more" onClick={() => setShowAllExpenses((visible) => !visible)}>{showAllExpenses ? "Show recent expenses" : `Show all ${actualExpenses.length} expenses`}</button> : null}
      </section>
      {reimbursements.length && !commons.balancesDisabled ? (
        <section className="reimbursement-section" aria-labelledby={`reimbursements-title-${currency}`}>
          <button className="payment-history-toggle" type="button" aria-expanded={showPaymentHistory} aria-controls={`payment-history-list-${currency}`} onClick={() => setShowPaymentHistory((visible) => !visible)}>
            <span><small>Payments</small><strong id={`reimbursements-title-${currency}`}>Payment history</strong></span>
            <span><small>{reimbursements.length} {reimbursements.length === 1 ? "payment" : "payments"}</small><strong>{money(totalReimbursed)}</strong></span>
            <ChevronRightIcon />
          </button>
          {showPaymentHistory ? (
            <div className="reimbursement-list" id={`payment-history-list-${currency}`}>
              {reimbursements.map((reimbursement) => (
                <button key={reimbursement.id} type="button" onClick={() => openPayment(reimbursement.id)} aria-label={`Review ${reimbursement.fromPersonName}'s ${money(reimbursement.amountCents)} payment to ${reimbursement.toPersonName}`}><span><CheckIcon /></span><p><strong>{reimbursement.fromPersonName.split(" ")[0]} paid {reimbursement.toPersonName.split(" ")[0]}</strong><small>{money(reimbursement.amountCents)} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${reimbursement.occurredOn}T12:00:00Z`))}</small></p><ChevronRightIcon /></button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      </div>
      {actualExpenses.length > 0 ? forecast : null}
    </section>
  );
}

function MomentsView({
  notify,
  localMoments,
  startPhotoUpload,
  openMoment,
  moveMoment,
  commonsSlug,
  days,
  moments,
  timeZone,
}: {
  notify: (message: string) => void;
  localMoments: Moment[];
  startPhotoUpload: (files: File[]) => void;
  openMoment: (moment: Moment) => void;
  moveMoment: (moment: Moment, day: string) => Promise<void>;
  commonsSlug: string;
  days: DayOption[];
  moments: Moment[];
  timeZone: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [draggedMomentId, setDraggedMomentId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [photoDay, setPhotoDay] = useState("all");
  const archivedMoments = [
    ...moments,
    ...localMoments,
  ].sort(
    (a, b) => {
      const aUnsorted = a.dateStatus === "unconfirmed";
      const bUnsorted = b.dateStatus === "unconfirmed";
      if (aUnsorted !== bUnsorted) return aUnsorted ? 1 : -1;
      return new Date(a.occurredAt).valueOf() - new Date(b.occurredAt).valueOf();
    },
  );
  const importedArchive = archivedMoments.length > 0;
  const matchedMomentCount = archivedMoments.filter((moment) => moment.itineraryItemId).length;
  const downloadableMoments = archivedMoments;
  const momentsByDay = archivedMoments.reduce<Array<{ key: string; label: string; moments: Moment[] }>>(
    (groups, moment) => {
      const unsorted = moment.dateStatus === "unconfirmed";
      const key = unsorted ? "unsorted" : localDateKey(moment.occurredAt, timeZone);
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.moments.push(moment);
        return groups;
      }
      groups.push({
        key,
        label: unsorted ? "Unsorted" : new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone,
        }).format(new Date(moment.occurredAt)),
        moments: [moment],
      });
      return groups;
    },
    [],
  );

  function choosePhotos(files: FileList | null) {
    if (!files?.length) return;
    const photos = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!photos.length) {
      notify("Choose photos to add.");
      return;
    }
    startPhotoUpload(photos);
  }

  function beginPhotoDrag(event: DragEvent<HTMLElement>, moment: Moment) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", moment.id);
    setDraggedMomentId(moment.id);
  }

  function allowPhotoDrop(event: DragEvent<HTMLElement>, day: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropDay(day);
  }

  function dropPhoto(event: DragEvent<HTMLElement>, day: string) {
    event.preventDefault();
    const momentId = event.dataTransfer.getData("text/plain") || draggedMomentId;
    const moment = archivedMoments.find((entry) => entry.id === momentId);
    setDraggedMomentId(null);
    setDropDay(null);
    if (!moment) return;
    void moveMoment(moment, day).catch((error) => {
      notify(error instanceof Error ? error.message : "Photo not moved. Try again.");
    });
  }

  async function downloadAll() {
    if (!downloadableMoments.length || archiveBusy) return;
    setArchiveBusy(true);
    try {
      const files = await Promise.all(downloadableMoments.map(async (moment, index) => {
        const response = await fetch(moment.assetUrl);
        if (!response.ok) throw new Error(`Could not download ${moment.caption}.`);
        const blob = await response.blob();
        const fallbackName = momentFileName(moment, index).replace(/\.[^.]+$/, "");
        const extension = blob.type === "image/png"
          ? "png"
          : blob.type === "image/webp"
            ? "webp"
            : blob.type === "image/gif"
              ? "gif"
              : "jpg";
        return {
          name: `${fallbackName}.${extension}`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      }));
      const archive = createPhotoArchive(files);
      const archiveUrl = URL.createObjectURL(archive);
      downloadAsset(archiveUrl, `${commonsSlug}-photos.zip`);
      window.setTimeout(() => URL.revokeObjectURL(archiveUrl), 1_000);
      notify(`${files.length} ${files.length === 1 ? "photo" : "photos"} ready.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Photos not downloaded. Try again.");
    } finally {
      setArchiveBusy(false);
    }
  }

  function renderMomentCard(moment: Moment, className = "") {
    return (
      <article
        className={`moment-card ${className}${draggedMomentId === moment.id ? " moment-card--dragging" : ""}`}
        draggable
        key={moment.id}
        onDragStart={(event) => beginPhotoDrag(event, moment)}
        onDragEnd={() => { setDraggedMomentId(null); setDropDay(null); }}
      >
        <button className="moment-card__open" type="button" onClick={() => openMoment(moment)} aria-label={`Open ${moment.caption}`}>
          <div className="moment-card__image"><Image src={moment.assetUrl} alt={moment.altText} fill sizes="(max-width: 899px) 50vw, 18rem" unoptimized /></div>
          <div><span>{moment.itineraryItemTitle ?? moment.sourceLabel}</span><strong>{moment.caption}</strong>{moment.addedByName ? <small>Shared by {moment.addedByName.split(" ")[0]}{moment.eventMatch ? " · linked by Commons" : ""}</small> : null}</div>
        </button>
        <a className="moment-card__download" href={moment.assetUrl} download={momentFileName(moment)} aria-label={`Download ${moment.caption}`} title="Download photo"><DownloadIcon /></a>
      </article>
    );
  }

  return (
    <div className="product-view moments-view">
      <div className="view-intro view-intro--with-action event-page-header">
        <div><h2>Photos</h2><p>{archivedMoments.length} {archivedMoments.length === 1 ? "photo" : "photos"} · {importedArchive ? `${matchedMomentCount} linked to ${matchedMomentCount === 1 ? "a trip plan" : "trip plans"}.` : "Share photos from the trip."}</p></div>
        <div className="photo-actions">
          {downloadableMoments.length ? <button className="photo-download-all" onClick={downloadAll} disabled={archiveBusy}><DownloadIcon /><span>{archiveBusy ? "Preparing…" : "Download all"}</span></button> : null}
          <button className="photo-add-action" onClick={() => inputRef.current?.click()}><PlusIcon /><span>Add photos</span></button>
        </div>
        <input ref={inputRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => { choosePhotos(event.target.files); event.target.value = ""; }} />
      </div>

      {importedArchive ? null : (
        <section className="moments-start">
          <span><ImageIcon /></span>
          <div><strong>Add the first photo</strong><p>Add the house, a throwback, or a plan.</p></div>
          <button onClick={() => inputRef.current?.click()}>Choose photo</button>
        </section>
      )}

      {importedArchive ? (
        <section className="moment-archive" aria-labelledby="moment-archive-title" data-walkthrough-target="moments">
          <SectionHeading title="Trip photos" detail={`${archivedMoments.length} ${archivedMoments.length === 1 ? "photo" : "photos"}`} />
          <h3 id="moment-archive-title" className="sr-only">Chronological trip archive</h3>
          <EventDaySelector days={[{ id: "all", day: "All", date: "" }, ...days, ...momentsByDay.filter(group => group.key !== "unsorted" && !days.some(day => day.id === group.key)).map(group => ({ id: group.key, day: group.label, date: "", outsideTrip: true })), { id: "unsorted", day: "Unsorted", date: "" }]} selected={photoDay} select={setPhotoDay} label="Photo days" dragging={Boolean(draggedMomentId)} dropDay={dropDay} allowDrop={(event, id) => { if (id !== "all") allowPhotoDrop(event, id); }} leaveDrop={id => setDropDay(current => current === id ? null : current)} drop={(event, id) => { if (id !== "all") dropPhoto(event, id); }} />
          <div className="moment-days">
            {photoDay !== "all" && !momentsByDay.some(group => group.key === photoDay) ? <p>No photos for this day yet. Add photos or choose another day.</p> : null}
            {momentsByDay.filter(group => photoDay === "all" || group.key === photoDay).map((group) => (
              <section
                className={`moment-day${dropDay === group.key ? " moment-day--drop-target" : ""}`}
                key={group.key}
                aria-labelledby={`moment-day-${group.key}`}
                onDragEnter={(event) => allowPhotoDrop(event, group.key)}
                onDragOver={(event) => allowPhotoDrop(event, group.key)}
                onDragLeave={() => setDropDay((current) => current === group.key ? null : current)}
                onDrop={(event) => dropPhoto(event, group.key)}
              >
                <header><h3 id={`moment-day-${group.key}`}>{group.label}</h3><span>{group.moments.length} {group.moments.length === 1 ? "photo" : "photos"}</span></header>
                <div className={`moments-grid moments-grid--archive moments-grid--count-${Math.min(group.moments.length, 4)}`}>
                  {group.moments.map((moment, index) => (
                    renderMomentCard(moment, `moment-card--archive ${group.moments.length > 2 && index === 0 ? "moment-card--hero" : ""} ${group.moments.length > 3 && index === group.moments.length - 1 ? "moment-card--wide" : ""}`)
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

    </div>
  );
}

function PhotoMappingSheet({
  initialActivityId,
  photos,
  itinerary,
  timeZone,
  actorId,
  actorName,
  close,
  addMoment,
  notify,
  persistent,
}: {
  initialActivityId?: string | null;
  photos: PendingPhoto[];
  itinerary: CommonsState["itinerary"];
  timeZone: string;
  actorId: string;
  actorName: string;
  close: () => void;
  addMoment: (moment: Moment) => Promise<Moment>;
  notify: (message: string) => void;
  persistent: boolean;
}) {
  const firstSuggestion = inferPhotoMapping(photos[0], itinerary, timeZone, null);
  const [index, setIndex] = useState(0);
  const [learnedEventId, setLearnedEventId] = useState<string | null>(initialActivityId ?? null);
  const [selectedEventId, setSelectedEventId] = useState(initialActivityId && itinerary.some(item => item.id === initialActivityId && item.status !== "cancelled") ? initialActivityId : firstSuggestion.itineraryItemId ?? "");
  const [caption, setCaption] = useState(captionFromFileName(photos[0].fileName));
  const [rememberChoice, setRememberChoice] = useState(true);
  const [addedCount, setAddedCount] = useState(0);
  const [mappedCount, setMappedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentPhoto = photos[index];
  const suggestion = inferPhotoMapping(currentPhoto, itinerary, timeZone, learnedEventId);
  const selectedEvent = itinerary.find((item) => item.id === selectedEventId && item.status !== "cancelled");
  const suggestedEvent = itinerary.find((item) => item.id === suggestion.itineraryItemId);
  const corrected = selectedEventId !== (suggestion.itineraryItemId ?? "");
  const progress = ((index + 1) / photos.length) * 100;

  function finish(nextAddedCount: number, nextMappedCount: number) {
    close();
    notify(`${nextAddedCount} ${nextAddedCount === 1 ? "photo" : "photos"} added · ${nextMappedCount} linked.`);
  }

  function advance(nextLearnedEventId: string | null, nextAddedCount: number, nextMappedCount: number) {
    if (index === photos.length - 1) {
      finish(nextAddedCount, nextMappedCount);
      return;
    }
    const nextIndex = index + 1;
    const nextPhoto = photos[nextIndex];
    const nextSuggestion = inferPhotoMapping(nextPhoto, itinerary, timeZone, nextLearnedEventId);
    setLearnedEventId(nextLearnedEventId);
    setIndex(nextIndex);
    setSelectedEventId(nextLearnedEventId ?? nextSuggestion.itineraryItemId ?? "");
    setCaption(captionFromFileName(nextPhoto.fileName));
    setRememberChoice(true);
  }

  async function addCurrentPhoto() {
    if (busy) return;
    setBusy(true);
    setError("");
    const nextAddedCount = addedCount + 1;
    const nextMappedCount = mappedCount + (selectedEvent ? 1 : 0);
    const acceptedSuggestion = Boolean(selectedEvent && selectedEvent.id === suggestion.itineraryItemId);
    const finalCaption = caption.trim() || "Untitled photo";
    const occurredAt = selectedEvent?.startsAt ?? new Date(currentPhoto.lastModified).toISOString();
    try {
      await addMoment({
      id: `local-${currentPhoto.id}`,
      kind: "photo",
      assetUrl: currentPhoto.assetUrl,
      caption: finalCaption,
      altText: `Photo added by ${actorName}: ${finalCaption}`,
      occurredAt,
      addedByPersonId: actorId,
      addedByName: actorName,
      sourceLabel: persistent ? `Added by ${actorName}` : "Added from this device · This session",
      dateStatus: selectedEvent?.startsAt ? "confirmed" : "unconfirmed",
      itineraryItemId: selectedEvent?.id,
      itineraryItemTitle: selectedEvent?.title,
      eventMatch: selectedEvent
        ? {
            source: acceptedSuggestion ? "automatic" : "manual",
            confidence: acceptedSuggestion ? suggestion.confidence : 100,
            reason: acceptedSuggestion
              ? `${suggestion.reason} Confirmed by ${actorName}.`
              : `Corrected to ${selectedEvent.title} by ${actorName} during upload.`,
          }
        : undefined,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Photo not added. Try again.");
      setBusy(false);
      return;
    }
    setAddedCount(nextAddedCount);
    setMappedCount(nextMappedCount);
    const nextLearnedEventId = rememberChoice && selectedEvent ? selectedEvent.id : learnedEventId;
    advance(nextLearnedEventId, nextAddedCount, nextMappedCount);
    setBusy(false);
  }

  function skipCurrentPhoto() {
    advance(learnedEventId, addedCount, mappedCount);
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet photo-mapping-sheet" role="dialog" aria-modal="true" aria-labelledby="photo-mapping-title">
        <div className="sheet-handle" />
        <h2 className="sr-only" id="photo-mapping-title">Link photos to the trip plan</h2>
        <header className="sheet-header">
          <div><span className="commons-mark-box"><CommonsMark /></span><span><small>Photo match</small><strong>Photo {index + 1} of {photos.length}</strong></span></div>
          <button onClick={close} aria-label="Close photo mapping"><CloseIcon /></button>
        </header>
        <div className="photo-map-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <div className="photo-map-layout">
          <div className="photo-map-preview"><Image src={currentPhoto.assetUrl} alt="Photo waiting to be added" fill sizes="(max-width: 899px) 100vw, 22rem" unoptimized /></div>
          <div className="photo-map-controls">
            <div className={`photo-map-suggestion${corrected ? " photo-map-suggestion--corrected" : ""}`}>
              <span><CommonsMark /></span>
              <p>
                <small>{corrected ? "Changed" : suggestedEvent ? "Suggested match" : "No match"}</small>
                <strong>{corrected ? selectedEvent?.title ?? "Outside the plan" : suggestedEvent?.title ?? "Choose where this belongs"}</strong>
                <em>{corrected ? `Changed from ${suggestedEvent?.title ?? "no match"}.` : suggestion.reason}</em>
              </p>
              {suggestion.confidence > 0 && !corrected ? <b>{suggestion.confidence}%</b> : null}
            </div>

            <label className="photo-map-field">
              <span>Caption</span>
              <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Friday crew" />
            </label>
            <label className="photo-map-field">
              <span>Where does this belong?</span>
              <select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}>
                <option value="">Keep outside the plan</option>
                {itinerary.filter((item) => item.status !== "cancelled").map((item) => (
                  <option value={item.id} key={item.id}>{item.startsAt ? formatDayHeading(localDateKey(item.startsAt, timeZone)) : "Idea"} · {item.title}</option>
                ))}
              </select>
            </label>

            {selectedEvent ? (
              <div className="photo-map-learning">
                <input id="photo-map-learn" type="checkbox" checked={rememberChoice} onChange={(event) => setRememberChoice(event.target.checked)} />
                <label htmlFor="photo-map-learn"><strong>Use for remaining photos</strong><small>Apply this plan to similar photos in this upload.</small></label>
              </div>
            ) : null}
          </div>
        </div>
        <div className="sheet-actions photo-map-actions">
          <button type="button" onClick={skipCurrentPhoto} disabled={busy}>Skip</button>
          <button type="button" onClick={() => void addCurrentPhoto()} disabled={busy}>{busy ? "Adding…" : index === photos.length - 1 ? "Add photo" : "Add + next"}</button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <p className="sheet-footnote">{persistent ? "Everyone on this trip can see added photos." : "These photos stay in this browser session."}</p>
      </section>
    </ModalLayer>
  );
}

function CoverPickerSheet({
  moments,
  localMoments,
  coverImage,
  coverSourceMomentId,
  close,
  selectCover,
  uploadCover,
  notify,
}: {
  moments: Moment[];
  localMoments: Moment[];
  coverImage: string | null;
  coverSourceMomentId: string | null;
  close: () => void;
  selectCover: (moment: Moment) => Promise<void>;
  uploadCover: (file: File) => Promise<void>;
  notify: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function chooseArtwork(art: LocalArtwork) {
    if (busyId) return;
    setBusyId(art.key); setError("");
    try {
      const response = await fetch(art.src);
      if (!response.ok) throw new Error("That cover couldn’t be loaded. Try another.");
      const fetched = await response.blob();
      // Bundled covers are SVG drawings; covers are saved as raster images.
      const blob = fetched.type === "image/svg+xml" || art.src.endsWith(".svg") ? await rasterizeCoverDrawing(fetched) : fetched;
      await uploadCover(new File([blob], blob.type === "image/png" ? "commons-cover.png" : "commons-cover.webp", { type: blob.type || "image/webp" }));
      close(); notify("Cover updated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cover not updated. Try again."); setBusyId(null); }
  }
  const choices = [
    ...localMoments,
    ...moments,
  ];

  async function choose(moment: Moment) {
    if (busyId) return;
    setBusyId(moment.id);
    setError("");
    try {
      await selectCover(moment);
      close();
      notify("Cover updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Cover not updated. Try again.");
      setBusyId(null);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      notify("Choose a JPG, PNG, or WebP photo.");
      return;
    }
    setBusyId("upload");
    setError("");
    void uploadCover(file).then(() => {
      close();
      notify("Cover updated.");
    }).catch((saveError) => {
      setError(saveError instanceof Error ? saveError.message : "Cover not updated. Try again.");
      setBusyId(null);
    });
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet cover-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="cover-picker-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><ImageIcon /></span><span><small>Trip cover</small><strong>Choose a cover</strong></span></div><button onClick={close} aria-label="Close cover picker"><CloseIcon /></button></header>
        <h2 id="cover-picker-title">Trip cover</h2>
        <p className="sheet-summary">Choose a trip photo, upload your own, or use a Commons cover.</p>
        <details className="commons-cover-library">
          <summary>Browse Commons covers</summary>
          <div className="cover-choice-grid">{commonsCoverArtwork.map(art => <button key={art.key} type="button" className="cover-choice" disabled={Boolean(busyId)} onClick={() => void chooseArtwork(art)}><span className="cover-choice__image"><Image src={art.src} alt="" fill sizes="(max-width: 899px) 45vw, 15rem" /></span><span className="cover-choice__copy"><strong>{art.title}</strong><small>{busyId === art.key ? "Saving…" : "Use this cover"}</small></span></button>)}</div>
        </details>
        {choices.length ? (
          <div className="cover-choice-grid">
            {choices.map((moment) => {
              const current = coverSourceMomentId === moment.id || coverImage === moment.assetUrl;
              return (
                <button type="button" className={`cover-choice${current ? " cover-choice--current" : ""}`} key={moment.id} onClick={() => void choose(moment)} aria-pressed={current} disabled={Boolean(busyId)}>
                  <span className="cover-choice__image"><Image src={moment.assetUrl} alt={moment.altText} fill sizes="(max-width: 899px) 45vw, 15rem" unoptimized /></span>
                  <span className="cover-choice__copy"><strong>{moment.caption}</strong><small>{busyId === moment.id ? "Saving…" : current ? "Current cover" : "Use as cover"}</small></span>
                  {current ? <span className="cover-choice__check"><CheckIcon /></span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cover-picker-empty"><ImageIcon /><p><strong>No trip photos yet</strong><br />Choose a Commons cover or upload your own.</p></div>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="cover-upload-divider"><span>Use another photo</span></div>
        <button className="cover-upload-action" type="button" disabled={Boolean(busyId)} onClick={() => inputRef.current?.click()}><PlusIcon /> {busyId === "upload" ? "Uploading…" : "Upload a cover photo"}</button>

        <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={(event) => upload(event.target.files?.[0])} />
      </section>
    </ModalLayer>
  );
}

function MomentViewerSheet({
  moment,
  close,
  edit,
  openItem,
}: {
  moment: Moment;
  close: () => void;
  edit: () => void;
  openItem?: () => void;
}) {
  return (
    <ModalLayer close={close}>
      <section className="sheet moment-viewer-sheet" role="dialog" aria-modal="true" aria-labelledby="moment-viewer-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><ImageIcon /></span><span><small>Photo</small><strong>{moment.itineraryItemTitle ?? "From the trip"}</strong></span></div><button onClick={close} aria-label="Close photo"><CloseIcon /></button></header>
        <div className="moment-viewer-image"><Image src={moment.assetUrl} alt={moment.altText} fill sizes="(max-width: 899px) 100vw, 52rem" unoptimized /></div>
        <div className="moment-viewer-copy">
          <span>{moment.sourceLabel}</span>
          <h2 id="moment-viewer-title">{moment.caption}</h2>
          {moment.addedByName ? <p>Shared by {moment.addedByName}{moment.eventMatch ? " · Linked to this plan by Commons" : ""}</p> : null}
        </div>
        <div className="moment-viewer-actions">
          {openItem ? <button className="moment-viewer-edit" type="button" onClick={openItem}>View activity details</button> : null}
          <a className="moment-viewer-download" href={moment.assetUrl} download={momentFileName(moment)}><DownloadIcon /> Download</a>
          <button className="moment-viewer-edit" type="button" onClick={edit}>Edit photo</button>
        </div>
      </section>
    </ModalLayer>
  );
}

function MomentEditorSheet({
  moment,
  days,
  itinerary,
  timeZone,
  close,
  save,
  remove,
}: {
  moment: Moment;
  days: DayOption[];
  itinerary: CommonsState["itinerary"];
  timeZone: string;
  close: () => void;
  save: (caption: string, itineraryItemId: string | null, occurredOn: string | null) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [caption, setCaption] = useState(moment.caption);
  const [itineraryItemId, setItineraryItemId] = useState(moment.itineraryItemId ?? "");
  const [occurredOn, setOccurredOn] = useState(
    moment.dateStatus === "unconfirmed" ? "" : localDateKey(moment.occurredAt, timeZone),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  return (
    <ModalLayer close={close}>
      <section className="sheet photo-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="photo-editor-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><ImageIcon /></span><span><small>Photo</small><strong>Edit details</strong></span></div><button onClick={close} aria-label="Close photo editor"><CloseIcon /></button></header>
        <h2 id="photo-editor-title">Edit photo.</h2>
        <div className="photo-editor-preview"><Image src={moment.assetUrl} alt={moment.altText} fill sizes="(max-width: 899px) 100vw, 26rem" unoptimized /></div>
        <form className="photo-editor-form" onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void save(caption, itineraryItemId || null, occurredOn || null).catch((saveError) => {
            setError(saveError instanceof Error ? saveError.message : "Photo not updated. Try again.");
            setBusy(false);
          });
        }}>
          <label className="field"><span>Caption</span><input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={160} required /></label>
          <label className="field"><span>Day <small>Optional</small></span><select value={occurredOn} onChange={(event) => {
            const nextDay = event.target.value;
            setOccurredOn(nextDay);
            const linkedItem = itinerary.find((item) => item.id === itineraryItemId);
            if (linkedItem?.startsAt && localDateKey(linkedItem.startsAt, timeZone) !== nextDay) setItineraryItemId("");
          }}><option value="">Unsorted</option>{days.map((day) => <option key={day.id} value={day.id}>{formatDayHeading(day.id)}</option>)}</select></label>
          <label className="field"><span>Trip plan <small>Optional</small></span><select value={itineraryItemId} onChange={(event) => {
            const nextItemId = event.target.value;
            setItineraryItemId(nextItemId);
            const nextItem = itinerary.find((item) => item.id === nextItemId);
            if (nextItem?.startsAt) setOccurredOn(localDateKey(nextItem.startsAt, timeZone));
          }}><option value="">Not linked to a plan</option>{itinerary.filter((item) => item.startsAt).map((item) => <option key={item.id} value={item.id}>{formatDayHeading(localDateKey(item.startsAt!, timeZone))} · {item.title}</option>)}</select></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sheet-primary" type="submit" disabled={busy || !caption.trim()}>{busy ? "Saving…" : "Save photo"}</button>
        </form>
        <section className="delete-photo-section">
          {!confirmDelete ? (
            <button className="delete-photo-action" type="button" onClick={() => { setDeleteError(""); setConfirmDelete(true); }}>Delete photo</button>
          ) : (
            <div className="delete-photo-confirm" role="alert">
              <strong>Delete this photo?</strong>
              <p>It will be removed from Photos and any linked trip plan.</p>
              {deleteError ? <p className="delete-photo-error">{deleteError}</p> : null}
              <div><button type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteError(""); }}>Keep photo</button><button type="button" disabled={deleting} onClick={() => { setDeleting(true); setDeleteError(""); void remove().catch((removeError) => { setDeleteError(removeError instanceof Error ? removeError.message : "Photo not deleted. Try again."); setDeleting(false); }); }}>{deleting ? "Deleting…" : "Delete photo"}</button></div>
            </div>
          )}
        </section>
      </section>
    </ModalLayer>
  );
}

function MoneySettingsSheet({
  balancesDisabled,
  currency,
  allocatedExpenseCount,
  close,
  save,
}: {
  balancesDisabled: boolean;
  currency: string;
  allocatedExpenseCount: number;
  close: () => void;
  save: (disabled: boolean, currency: string) => Promise<void>;
}) {
  const [nextBalancesDisabled, setNextBalancesDisabled] = useState(balancesDisabled);
  const nextCurrency = currency;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hidesExistingBalances = !balancesDisabled && nextBalancesDisabled && allocatedExpenseCount > 0;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await save(nextBalancesDisabled, nextCurrency);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Money settings not updated. Try again.");
      setBusy(false);
    }
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet money-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="money-settings-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><WalletIcon /></span><span><small>Money</small><strong>Money settings</strong></span></div><button onClick={close} aria-label="Close money settings"><CloseIcon /></button></header>
        <h2 id="money-settings-title">Spending and balances</h2>

        <label className={`money-family-setting${nextBalancesDisabled ? " money-family-setting--selected" : ""}`}>
          <input type="checkbox" aria-label="This is a family trip" checked={nextBalancesDisabled} onChange={(event) => setNextBalancesDisabled(event.target.checked)} />
          <span><strong>This is a family trip</strong><small>Track spending and receipts without shares, reimbursements, or who owes whom.</small></span>
        </label>

        {hidesExistingBalances ? <div className="money-settings-warning" role="note"><InfoIcon /><p><strong>{allocatedExpenseCount} recorded {allocatedExpenseCount === 1 ? "expense has" : "expenses have"} balances.</strong><span>Turning this on hides those balances. The expenses and splits stay saved, and they return if balances are turned on again.</span></p></div> : null}
        {!nextBalancesDisabled ? <p className="money-settings-current">Recorded expenses can be split between travelers. Commons calculates who owes whom but does not move money.</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="sheet-actions money-settings-actions">
          <button type="button" disabled={busy} onClick={close}>Cancel</button>
          <button type="button" disabled={busy || !/^[A-Z]{3}$/.test(nextCurrency) || (nextBalancesDisabled === balancesDisabled && nextCurrency === currency)} onClick={() => void submit()}>{busy ? "Saving…" : hidesExistingBalances ? "Turn balances off" : "Save money settings"}</button>
        </div>
      </section>
    </ModalLayer>
  );
}

export function ExpenseEditorSheet({
  receiptEntry = false,
  participants,
  itinerary,
  stays,
  travelPlans,
  balancesDisabled,
  timeZone,
  currentActorId,
  defaultDate,
  defaultCurrency = "USD",
  expense,
  startAsRecorded = false,
  defaultStay,
  defaultTravel,
  defaultPlan,
  defaultPlanCostCents,
  close,
  save,
}: {
  receiptEntry?: boolean;
  participants: CommonsParticipant[];
  itinerary: CommonsState["itinerary"];
  stays: Stay[];
  travelPlans: TravelPlan[];
  balancesDisabled: boolean;
  timeZone: string;
  currentActorId: string;
  defaultDate: string;
  defaultCurrency?: string;
  expense?: Expense;
  startAsRecorded?: boolean;
  defaultStay?: Stay;
  defaultTravel?: TravelPlan;
  defaultPlan?: CommonsState["itinerary"][number];
  defaultPlanCostCents?: number;
  close: () => void;
  save: (input: AddExpenseInput) => Promise<void>;
}) {
  const currency = expense?.currency ?? defaultPlan?.expectedCostCurrency ?? defaultStay?.currency ?? defaultTravel?.currency ?? defaultCurrency;
  const money = (cents: number) => formatMoney(cents, currency);
  const editing = Boolean(expense);
  const defaultStayParticipantIds = defaultStay?.includedPersonIds.filter((personId) => participants.some((participant) => participant.id === personId)) ?? [];
  const defaultPlanParticipantIds = defaultPlan?.participantScope === "everyone" ? participants.map(person => person.id) : [...new Set([...(defaultPlan?.expectedParticipantIds ?? []), ...(defaultPlan?.participantIds ?? [])])].filter(id => participants.some(person => person.id === id));
  const initialIncludedIds = defaultPlan && defaultPlanParticipantIds.length ? defaultPlanParticipantIds : startAsRecorded
    ? participants.map((participant) => participant.id)
    : expense?.shares.map((share) => share.personId) ?? (defaultStayParticipantIds.length ? defaultStayParticipantIds : participants.map((participant) => participant.id));
  const initialSplitMethod: AddExpenseInput["splitMethod"] = expense?.splitMethod === "equal" ? "equal" : expense ? "exact" : "equal";
  const [title, setTitle] = useState(expense?.title ?? defaultPlan?.title ?? (defaultStay ? `${defaultStay.name} lodging` : defaultTravel ? defaultTravel.kind === "car_rental" ? "Car rental" : "Flights" : ""));
  const [amount, setAmount] = useState(expense ? (expense.amountCents / 100).toFixed(2) : defaultPlanCostCents ? (defaultPlanCostCents / 100).toFixed(2) : defaultStay?.totalCents ? (defaultStay.totalCents / 100).toFixed(2) : defaultTravel?.totalCents ? (defaultTravel.totalCents / 100).toFixed(2) : "");
  const [paidByPersonId, setPaidByPersonId] = useState(expense?.paidByPersonId ?? currentActorId);
  const [occurredOn, setOccurredOn] = useState(expense?.occurredOn ?? defaultPlan?.scheduledDate ?? (defaultPlan?.startsAt ? localDateKey(defaultPlan.startsAt, timeZone) : undefined) ?? defaultStay?.startsOn ?? defaultTravel?.date ?? defaultDate);
  const [category, setCategory] = useState(expense?.category === "Golf" ? "Activity" : expense?.category ?? (defaultPlan ? defaultPlan.mealType ? "Food & drink" : "Activity" : defaultStay ? "Lodging" : defaultTravel ? "Transportation" : "Other"));
  const [linkedPlan, setLinkedPlan] = useState(expense?.stayId
    ? `stay:${expense.stayId}` : expense?.travelPlanId ? `travel:${expense.travelPlanId}` : expense?.itineraryItemId ? `plan:${expense.itineraryItemId}` : defaultPlan ? `plan:${defaultPlan.id}` : defaultStay ? `stay:${defaultStay.id}` : defaultTravel ? `travel:${defaultTravel.id}` : "");
  const [splitMethod, setSplitMethod] = useState<AddExpenseInput["splitMethod"]>(initialSplitMethod);
  const initialRecordedMode: AddExpenseInput["balanceMode"] = balancesDisabled ? "tracking_only" : expense?.balanceMode === "tracking_only" ? "tracking_only" : "allocated";
  const [recordedBalanceMode, setRecordedBalanceMode] = useState<"allocated" | "tracking_only">(initialRecordedMode === "tracking_only" ? "tracking_only" : "allocated");
  const [balanceMode, setBalanceMode] = useState<AddExpenseInput["balanceMode"]>(startAsRecorded ? initialRecordedMode : expense?.balanceMode === "budget_only" ? "budget_only" : initialRecordedMode);
  const confirmationCode = expense?.confirmationCode ?? defaultStay?.confirmationCode ?? defaultTravel?.confirmationCode ?? "";
  const [includedIds, setIncludedIds] = useState<string[]>(initialIncludedIds);
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>(
    Object.fromEntries(expense?.shares.map((share) => [share.personId, (share.amountCents / 100).toFixed(2)]) ?? []),
  );
  const [note, setNote] = useState(expense?.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const amountCents = parseMoneyInput(amount) ?? 0;
  const equalShares = equalExpenseShares(amountCents, includedIds);
  const exactShares = includedIds.map((personId) => ({
    personId,
    amountCents: parseMoneyInput(exactAmounts[personId] ?? "") ?? 0,
  }));
  const shares = balanceMode !== "allocated"
    ? [{ personId: paidByPersonId, amountCents: 0 }]
    : splitMethod === "equal" ? equalShares : exactShares;
  const allocatedCents = shares.reduce((sum, share) => sum + share.amountCents, 0);
  const remainingCents = amountCents - allocatedCents;

  function chooseSplit(method: AddExpenseInput["splitMethod"]) {
    setSplitMethod(method);
    setError("");
    if (method === "exact" && !Object.keys(exactAmounts).length) {
      setExactAmounts(Object.fromEntries(
        equalShares.map((share) => [share.personId, (share.amountCents / 100).toFixed(2)]),
      ));
    }
  }

  function toggleParticipant(personId: string) {
    setIncludedIds((current) => current.includes(personId)
      ? current.filter((id) => id !== personId)
      : [...current, personId]);
    setError("");
  }

  function chooseExpenseStatus(status: "budget" | "recorded") {
    setBalanceMode(status === "budget" ? "budget_only" : balancesDisabled ? "tracking_only" : recordedBalanceMode);
    setError("");
  }

  function chooseBalanceMode(mode: "allocated" | "tracking_only") {
    setRecordedBalanceMode(mode);
    setBalanceMode(mode);
    setError("");
  }

  async function submit() {
    const parsedAmount = parseMoneyInput(amount);
    if (!title.trim() || !parsedAmount) {
      setError("Add a description and a valid amount.");
      return;
    }
    if (balanceMode === "allocated" && !includedIds.length) {
      setError("Include at least one person in the split.");
      return;
    }
    if (balanceMode === "allocated" && splitMethod === "exact" && remainingCents !== 0) {
      setError(`Custom amounts must total ${money(parsedAmount)}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({
        title: title.trim(),
        amountCents: parsedAmount,
        currency,
        paidByPersonId,
        occurredOn,
        category,
        itineraryItemId: linkedPlan.startsWith("plan:") ? linkedPlan.slice(5) : null,
        stayId: linkedPlan.startsWith("stay:") ? linkedPlan.slice(5) : null,
        travelPlanId: linkedPlan.startsWith("travel:") ? linkedPlan.slice(7) : null,
        splitMethod,
        balanceMode,
        confirmationCode: confirmationCode.trim() || undefined,
        shares,
        note: note.trim() || undefined,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Expense not ${editing ? "updated" : "added"}. Try again.`);
      setBusy(false);
    }
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet add-expense-sheet" role="dialog" aria-modal="true" aria-labelledby="expense-editor-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><ReceiptIcon /></span><span><small>Shared ledger</small><strong>{editing ? "Edit expense" : "Add expense"}</strong></span></div><button onClick={close} aria-label={`Close ${editing ? "edit" : "add"} expense`}><CloseIcon /></button></header>
        <h2 id="expense-editor-title">{editing ? startAsRecorded ? `Record ${expense?.title}` : `Edit ${expense?.title}` : "Add a trip cost"}</h2>
        <p className="sheet-summary">{editing ? startAsRecorded ? "Confirm who paid and whether this should create balances." : "Update the cost, payer, or balance details." : defaultPlan ? `Add a cost for ${defaultPlan.title}. Confirm the amount and who paid. Saving links the expense to this plan.` : defaultStay ? `Confirm the cost for ${defaultStay.name}.` : defaultTravel ? "Confirm the travel cost." : "Record what was paid and how to share it."}</p>
        {receiptEntry ? <p className="sheet-summary">Receipt uploads aren’t available here yet. Enter the details below.</p> : null}
        {(defaultStay?.confirmationDocumentFileName || defaultTravel?.confirmationDocumentFileName) ? <p className="expense-receipt-note"><ReceiptIcon /> The original confirmation will be attached as private receipt evidence.</p> : null}


        <form className="add-expense-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="expense-form-grid">
            <label className="field field--wide"><span>Description</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dinner at Southern Soul" maxLength={120} required /></label>
            <label className="field"><span>Amount</span><span className="money-input"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={amount} onChange={(event) => setAmount(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Expense amount in ${currency}`} required /></span></label>

            <label className="field"><span>Paid by</span><select value={paidByPersonId} onChange={(event) => setPaidByPersonId(event.target.value)}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.displayName}</option>)}</select></label>


          </div>

          {balanceMode === "allocated" ? <>
          <fieldset className="expense-participants">
            <legend>Who was included?</legend>
            <div>
              {participants.map((participant) => {
                const checked = includedIds.includes(participant.id);
                const share = shares.find((entry) => entry.personId === participant.id);
                return (
                  <label key={participant.id} className={checked ? "included" : ""}>
                    <input type="checkbox" checked={checked} onChange={() => toggleParticipant(participant.id)} />
                    <span className="expense-person-avatar">{participant.initials}</span>
                    <strong>{participant.displayName}</strong>
                    {checked && splitMethod === "exact" ? (
                      <span className="participant-amount"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={exactAmounts[participant.id] ?? ""} onChange={(event) => setExactAmounts((current) => ({ ...current, [participant.id]: normalizeMoneyInput(event.target.value) }))} inputMode="decimal" aria-label={`${participant.displayName} share in ${currency}`} placeholder="0.00" /></span>
                    ) : <em>{checked && share ? money(share.amountCents) : money(0)}</em>}
                  </label>
                );
              })}
            </div>
            <p className={remainingCents === 0 ? "balanced" : ""}><span>{includedIds.length} of {participants.length} included</span><strong>{splitMethod === "equal" ? "Split evenly" : remainingCents === 0 ? "Amounts match" : `${money(Math.abs(remainingCents))} ${remainingCents > 0 ? "left" : "over"}`}</strong></p>
          </fieldset></> : null}

          <details className="expense-advanced">
            <summary>Advanced</summary>
            <div className="expense-form-grid">
            <label className="field"><span>Date</span><input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></label>
            <label className="field"><span>Category</span><select value={category} onChange={(event) => { setCategory(event.target.value); if (event.target.value === "Groceries") setLinkedPlan(""); }}><option>Food &amp; drink</option><option>Groceries</option><option>Lodging</option><option>Transportation</option><option>Activity</option><option>Other</option></select></label>
            <label className="field field--wide"><span>Trip record <small>Optional</small></span><select disabled={category === "Groceries"} value={linkedPlan} onChange={(event) => setLinkedPlan(event.target.value)}><option value="">Not linked to a record</option><optgroup label="Plans">{itinerary.map((item) => <option key={item.id} value={`plan:${item.id}`}>{item.startsAt ? `${formatDayHeading(localDateKey(item.startsAt, timeZone))} · ` : "Idea · "}{item.title}</option>)}</optgroup>{stays.length ? <optgroup label="Stays">{stays.map((stay) => <option key={stay.id} value={`stay:${stay.id}`}>{stay.name}</option>)}</optgroup> : null}{travelPlans.length ? <optgroup label="Your travel plans">{travelPlans.filter((plan) => plan.personId === currentActorId).map((plan) => <option key={plan.id} value={`travel:${plan.id}`}>{plan.provider || (plan.kind === "car_rental" ? "Rental car" : plan.kind === "arrival" ? "Arrival" : "Departure")} · {formatDayHeading(plan.date)}</option>)}</optgroup> : null}</select></label>
            </div>
          <fieldset className="expense-split-fieldset"><legend>Is this planned or already paid?</legend><div className="expense-split-toggle"><button type="button" aria-pressed={balanceMode === "budget_only"} className={balanceMode === "budget_only" ? "active" : ""} onClick={() => chooseExpenseStatus("budget")}>Budget</button><button type="button" aria-pressed={balanceMode !== "budget_only"} className={balanceMode !== "budget_only" ? "active" : ""} onClick={() => chooseExpenseStatus("recorded")}>Recorded</button></div><p className="expense-mode-help">{balanceMode === "budget_only" ? "Adds a planned cost. It will not appear as actual spending." : "Records the cost and payer as actual spending."}</p></fieldset>

          {balanceMode !== "budget_only" && !balancesDisabled ? <fieldset className="expense-split-fieldset"><legend>Should this create balances?</legend><div className="expense-split-toggle"><button type="button" aria-pressed={balanceMode === "tracking_only"} className={balanceMode === "tracking_only" ? "active" : ""} onClick={() => chooseBalanceMode("tracking_only")}>No allocation</button><button type="button" aria-pressed={balanceMode === "allocated"} className={balanceMode === "allocated" ? "active" : ""} onClick={() => chooseBalanceMode("allocated")}>Allocate balances</button></div><p className="expense-mode-help">{balanceMode === "tracking_only" ? "Keeps the payer and receipt without calculating who owes whom." : "Splits the expense between the included travelers."}</p></fieldset> : null}

          {balanceMode === "allocated" ? <><fieldset className="expense-split-fieldset">
            <legend>How should it be split?</legend>
            <div className="expense-split-toggle">
              <button type="button" aria-pressed={splitMethod === "equal"} className={splitMethod === "equal" ? "active" : ""} onClick={() => chooseSplit("equal")}>Equally</button>
              <button type="button" aria-pressed={splitMethod === "exact"} className={splitMethod === "exact" ? "active" : ""} onClick={() => chooseSplit("exact")}>Custom amounts</button>
            </div>
          </fieldset>

</> : null}
          <label className="field expense-note-field"><span>Note <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anything the group should know" maxLength={500} /></label>
          </details>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sheet-primary" type="submit" disabled={busy}>{busy ? editing ? "Saving…" : "Adding…" : <><CheckIcon /> {editing ? startAsRecorded ? "Record expense" : "Save changes" : balanceMode === "budget_only" ? "Add planned cost" : "Record expense"}</>}</button>
        </form>
        <p className="sheet-footnote">{balanceMode === "budget_only" ? "This adds a planned cost. It does not record spending." : balanceMode === "tracking_only" ? "This records spending without balances." : "This records the shared split."} Commons does not charge or pay anyone.</p>
      </section>
    </ModalLayer>
  );
}

function PaymentEditorSheet({
  participants,
  currentActorId,
  defaultDate,
  defaultCurrency = "USD",
  payment,
  close,
  save,
}: {
  participants: CommonsParticipant[];
  currentActorId: string;
  defaultDate: string;
  defaultCurrency?: string;
  payment?: Reimbursement;
  close: () => void;
  save: (input: PaymentInput) => Promise<void>;
}) {
  const currency = payment?.currency ?? defaultCurrency;
  const editing = Boolean(payment);
  const initialSenderId = payment?.fromPersonId ?? currentActorId;
  const initialRecipientId = payment?.toPersonId ?? participants.find((participant) => participant.id !== initialSenderId)?.id ?? "";
  const [fromPersonId, setFromPersonId] = useState(initialSenderId);
  const [toPersonId, setToPersonId] = useState(initialRecipientId);
  const [amount, setAmount] = useState(payment ? (payment.amountCents / 100).toFixed(2) : "");
  const [occurredOn, setOccurredOn] = useState(payment?.occurredOn ?? defaultDate);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function changeSender(nextSenderId: string) {
    setFromPersonId(nextSenderId);
    if (toPersonId === nextSenderId) {
      setToPersonId(participants.find((participant) => participant.id !== nextSenderId)?.id ?? "");
    }
    setError("");
  }

  async function submit() {
    const amountCents = parseMoneyInput(amount);
    if (!fromPersonId || !toPersonId || fromPersonId === toPersonId || !amountCents) {
      setError("Choose two people and add a valid amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({ currency, fromPersonId, toPersonId, amountCents, occurredOn });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Payment not ${editing ? "updated" : "recorded"}. Try again.`);
      setBusy(false);
    }
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet add-expense-sheet payment-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="payment-editor-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><WalletIcon /></span><span><small>Shared ledger</small><strong>{editing ? "Edit payment" : "Record payment"}</strong></span></div><button onClick={close} aria-label={`Close ${editing ? "edit" : "record"} payment`}><CloseIcon /></button></header>
        <h2 id="payment-editor-title">{editing ? "Update this payment." : "Who paid whom?"}</h2>
        <p className="sheet-summary">Record money the group moved outside Commons.</p>

        <form className="add-expense-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="expense-form-grid payment-form-grid">
            <label className="field"><span>Paid by</span><select value={fromPersonId} onChange={(event) => changeSender(event.target.value)}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.displayName}</option>)}</select></label>
            <label className="field"><span>Paid to</span><select value={toPersonId} onChange={(event) => { setToPersonId(event.target.value); setError(""); }}>{participants.filter((participant) => participant.id !== fromPersonId).map((participant) => <option key={participant.id} value={participant.id}>{participant.displayName}</option>)}</select></label>
            <label className="field"><span>Amount</span><span className="money-input"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={amount} onChange={(event) => setAmount(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Payment amount in ${currency}`} required /></span></label>
            <label className="field"><span>Date</span><input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sheet-primary" type="submit" disabled={busy}>{busy ? editing ? "Saving…" : "Recording…" : <><CheckIcon /> {editing ? "Save changes" : "Record payment"}</>}</button>
        </form>
        <p className="sheet-footnote">This updates the group’s balances. Commons does not move money.</p>
      </section>
    </ModalLayer>
  );
}

function PaymentSheet({
  payment,
  close,
  edit,
  remove,
}: {
  payment: Reimbursement;
  close: () => void;
  edit: () => void;
  remove: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  return (
    <ModalLayer close={close}>
      <section className="sheet expense-sheet payment-sheet" role="dialog" aria-modal="true" aria-labelledby="payment-sheet-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><WalletIcon /></span><span><small>Shared ledger</small><strong>Payment detail</strong></span></div><button onClick={close} aria-label="Close payment"><CloseIcon /></button></header>
        <div className="expense-sheet-amount"><span>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${payment.occurredOn}T12:00:00Z`))}</span><strong>{formatMoney(payment.amountCents, payment.currency)}</strong></div>
        <h2 id="payment-sheet-title">{payment.fromPersonName.split(" ")[0]} paid {payment.toPersonName.split(" ")[0]}</h2>
        <p className="sheet-summary">{payment.fromPersonName} paid {payment.toPersonName} outside Commons.</p>
        <dl className="expense-record">
          <div><dt>Paid by</dt><dd>{payment.fromPersonName}</dd></div>
          <div><dt>Paid to</dt><dd>{payment.toPersonName}</dd></div>
          <div><dt>Source</dt><dd>{payment.sourceLabel}</dd></div>
        </dl>
        <div className="sheet-actions expense-detail-actions">
          <button type="button" onClick={close}>Done</button>
          <button type="button" onClick={edit}><WalletIcon /> Edit payment</button>
        </div>
        <section className="delete-expense-section">
          {!confirmDelete ? (
            <button className="delete-expense-action" type="button" onClick={() => setConfirmDelete(true)}>Delete payment</button>
          ) : (
            <div className="delete-expense-confirm" role="alert">
              <strong>Delete this payment?</strong>
              <p>This removes {formatMoney(payment.amountCents, payment.currency)} from the ledger and recalculates everyone’s balance.</p>
              {deleteError ? <p className="delete-expense-error">{deleteError}</p> : null}
              <div><button type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteError(""); }}>Keep payment</button><button type="button" disabled={deleting} onClick={() => { setDeleting(true); setDeleteError(""); void remove().catch((error) => { setDeleteError(error instanceof Error ? error.message : "Payment not deleted. Try again."); setDeleting(false); }); }}>{deleting ? "Deleting…" : "Delete payment"}</button></div>
            </div>
          )}
        </section>
        <p className="sheet-footnote">This is a shared record. Commons did not move the money.</p>
      </section>
    </ModalLayer>
  );
}

function ExpenseLedgerStatusSheet({
  mode,
  confirmedCount,
  participantCount,
  close,
  save,
}: {
  mode: "close" | "reopen";
  confirmedCount: number;
  participantCount: number;
  close: () => void;
  save: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closing = mode === "close";

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await save();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Expenses not ${closing ? "closed" : "reopened"}. Try again.`);
      setBusy(false);
    }
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet expense-status-sheet" role="dialog" aria-modal="true" aria-labelledby="expense-status-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><ReceiptIcon /></span><span><small>Shared ledger</small><strong>{closing ? "Close expenses" : "Reopen expenses"}</strong></span></div><button onClick={close} aria-label={`Close ${closing ? "close" : "reopen"} expenses dialog`}><CloseIcon /></button></header>
        <h2 id="expense-status-title">{closing ? "Close expenses for the group?" : "Add another expense?"}</h2>
        <p className="sheet-summary">{closing ? `${confirmedCount} of ${participantCount} travelers have confirmed. Closing now stops new expenses until an organizer reopens the ledger.` : "Reopening lets people add expenses again. Individual confirmations will reset and balances may change."}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="sheet-actions expense-status-actions">
          <button type="button" disabled={busy} onClick={close}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? closing ? "Closing…" : "Reopening…" : closing ? "Close expenses" : "Reopen expenses"}</button>
        </div>
        <p className="sheet-footnote">Commons will keep the expense and payment history.</p>
      </section>
    </ModalLayer>
  );
}

function ExpenseSheet({
  expense,
  participants,
  itinerary,
  balancesDisabled,
  close,
  edit,
  markRecorded,
  remove,
}: {
  expense: Expense;
  participants: CommonsParticipant[];
  itinerary: CommonsState["itinerary"];
  balancesDisabled: boolean;
  close: () => void;
  edit: () => void;
  markRecorded: () => void;
  remove: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteConfirmationRef = useRef<HTMLDivElement>(null);
  const keepExpenseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => {
      deleteConfirmationRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
      keepExpenseRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);
  const includedIds = new Set(expense.shares.map((share) => share.personId));
  const included = expense.shares.map((share) => ({
    ...share,
    participant: participants.find((participant) => participant.id === share.personId),
  }));
  const excluded = participants.filter((participant) => !includedIds.has(participant.id));
  const splitLabel = expense.balanceMode === "budget_only"
    ? "Budget · planned cost"
    : expense.balanceMode === "tracking_only"
      ? "Recorded · no balance allocation"
    : expense.splitMethod === "equal"
      ? "Split equally among the included people"
      : expense.splitMethod === "exact"
        ? "Exact participant amount"
        : expense.splitMethod === "percentage"
          ? "Split by percentage"
          : "Split by shares";
  const linkedPlan = itinerary.find((item) => item.id === expense.itineraryItemId);
  const showAllocation = expense.balanceMode !== "budget_only" && !balancesDisabled;
  const expenseSummary = expense.balanceMode === "budget_only"
    ? "Planned cost only. It has not been recorded as spent."
    : balancesDisabled
      ? `${expense.paidByName} paid.`
      : `${expense.paidByName} paid. ${splitLabel}.`;

  return (
    <ModalLayer close={close}>
      <section className="sheet expense-sheet" role="dialog" aria-modal="true" aria-labelledby="expense-sheet-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><ReceiptIcon /></span><span><small>{expense.category}</small><strong>Expense detail</strong></span></div><button onClick={close} aria-label="Close expense"><CloseIcon /></button></header>
        <div className="expense-sheet-amount"><span>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${expense.occurredOn}T12:00:00Z`))}</span><strong>{formatMoney(expense.amountCents, expense.currency)}</strong></div>
        <h2 id="expense-sheet-title">{expense.title}</h2>
        <p className="sheet-summary">{expenseSummary}</p>

        {showAllocation ? <section className="expense-people" aria-labelledby="included-title">
          <div className="section-heading"><h3 id="included-title">Included</h3><span>{included.length} of {participants.length}</span></div>
          <div>
            {included.map(({ personId, amountCents, participant }) => (
              <div key={personId}><span className="expense-person-avatar">{participant?.initials ?? "?"}</span><p><strong>{participant?.displayName ?? "Unknown participant"}</strong><small>{personId === expense.paidByPersonId ? "Paid and participated" : "Participated"}</small></p><b>{formatMoney(amountCents, expense.currency)}</b></div>
            ))}
          </div>
        </section> : null}

        {showAllocation && excluded.length ? (
          <section className="expense-excluded" aria-labelledby="excluded-title">
            <div className="section-heading"><h3 id="excluded-title">Not included</h3><span>{excluded.length}</span></div>
            <p>{excluded.map((participant) => participant.displayName.split(" ")[0]).join(", ")} {excluded.length === 1 ? "owes" : "owe"} {formatMoney(0, expense.currency)} for this expense.</p>
          </section>
        ) : null}

        <dl className="expense-record">
          {linkedPlan ? <div><dt>Trip plan</dt><dd>{linkedPlan.title}</dd></div> : null}
          {expense.confirmationCode ? <div><dt>Confirmation</dt><dd className="confirmation-value"><span>{expense.confirmationCode}</span><button type="button" onClick={() => void navigator.clipboard.writeText(expense.confirmationCode!)}>Copy</button></dd></div> : null}
          {!balancesDisabled ? <div><dt>Split</dt><dd>{splitLabel}</dd></div> : null}
          <div><dt>Receipt</dt><dd>{expense.receiptUrl ? <a href={expense.receiptUrl} target="_blank" rel="noreferrer">Open {expense.receiptFileName ?? "confirmation PDF"}</a> : expense.receiptStatus === "attached" ? "Attached · private to uploader" : expense.receiptStatus === "not_expected" ? "Not expected" : "Not attached"}</dd></div>
          <div><dt>Status</dt><dd>{expense.status === "confirmed" ? "Confirmed" : expense.status === "draft" ? "Needs review" : "Disputed"}</dd></div>
          <div><dt>Source</dt><dd>{expense.sourceLabel}</dd></div>
        </dl>
        {expense.note ? <div className="expense-note"><InfoIcon /><p><strong>Note</strong><br />{expense.note}</p></div> : null}
        <div className="sheet-actions expense-detail-actions">
          <button type="button" onClick={expense.balanceMode === "budget_only" ? edit : close}>{expense.balanceMode === "budget_only" ? "Edit planned cost" : "Done"}</button>
          <button type="button" onClick={expense.balanceMode === "budget_only" ? markRecorded : edit}><ReceiptIcon /> {expense.balanceMode === "budget_only" ? "Mark as recorded" : "Edit expense"}</button>
        </div>
        <section className="delete-expense-section">
          {!confirmDelete ? (
            <button className="delete-expense-action" type="button" onClick={() => setConfirmDelete(true)}>Delete expense</button>
          ) : (
            <div ref={deleteConfirmationRef} className="delete-expense-confirm" role="alert">
              <strong>Delete {expense.title}?</strong>
              <p>{balancesDisabled ? `This removes ${formatMoney(expense.amountCents, expense.currency)} from recorded trip spending.` : `This removes ${formatMoney(expense.amountCents, expense.currency)} from the shared ledger and recalculates everyone’s balance.`}</p>
              {deleteError ? <p className="delete-expense-error">{deleteError}</p> : null}
              <div><button ref={keepExpenseRef} type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteError(""); }}>Keep expense</button><button type="button" disabled={deleting} onClick={() => { setDeleting(true); setDeleteError(""); void remove().catch((error) => { setDeleteError(error instanceof Error ? error.message : "Expense not deleted. Try again."); setDeleting(false); }); }}>{deleting ? "Deleting…" : "Delete expense"}</button></div>
            </div>
          )}
        </section>
        <p className="sheet-footnote">This is a shared record. Commons has not charged or paid anyone.</p>
      </section>
    </ModalLayer>
  );
}

function ExpectedPlanCostFields({
  amount,
  currency,
  basis,
  expectedParticipantIds,
  confirmedParticipantIds = [],
  fixedPeople = false,
  participants,
  setAmount,
  setBasis,
  setExpectedParticipantIds,
}: {
  amount: string;
  currency: string;
  basis: AddPlanInput["expectedCostBasis"];
  expectedParticipantIds: string[];
  confirmedParticipantIds?: string[];
  fixedPeople?: boolean;
  participants: CommonsParticipant[];
  setAmount: (value: string) => void;
  setBasis: (value: AddPlanInput["expectedCostBasis"]) => void;
  setExpectedParticipantIds: (value: string[]) => void;
}) {
  const amountCents = parseMoneyInput(amount) ?? 0;
  const expectedTotalCents = basis === "per_person" ? amountCents * expectedParticipantIds.length : amountCents;
  const toggleParticipant = (personId: string) => {
    if (confirmedParticipantIds.includes(personId)) return;
    setExpectedParticipantIds(expectedParticipantIds.includes(personId)
      ? expectedParticipantIds.filter((id) => id !== personId)
      : [...expectedParticipantIds, personId]);
  };

  return (
    <section className="expected-plan-cost" aria-labelledby="expected-plan-cost-title">
      <div className="expected-plan-cost__heading"><strong id="expected-plan-cost-title">Estimated cost</strong><small>Optional</small></div>
      <label className="field"><span>Amount</span><span className="money-input"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={amount} onChange={(event) => setAmount(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Estimated activity cost in ${currency}`} /></span></label>
      <fieldset className="plan-cost-basis">
        <legend>Cost is</legend>
        <div>
          <button type="button" aria-pressed={basis === "total"} className={basis === "total" ? "active" : ""} onClick={() => setBasis("total")}>Total</button>
          <button type="button" aria-pressed={basis === "per_person"} className={basis === "per_person" ? "active" : ""} onClick={() => setBasis("per_person")}>Per person</button>
        </div>
      </fieldset>
      {basis === "per_person" && fixedPeople ? <p className="expected-plan-cost__total">{formatMoney(amountCents, currency)} × {expectedParticipantIds.length} included = {formatMoney(expectedTotalCents, currency)} estimated total</p> : basis === "per_person" ? (
        <fieldset className="plan-expected-participants">
          <legend>Who might attend?</legend>
          <div>
            {participants.map((participant) => {
              const confirmed = confirmedParticipantIds.includes(participant.id);
              const checked = expectedParticipantIds.includes(participant.id) || confirmed;
              return <label key={participant.id} className={checked ? "included" : ""}><input type="checkbox" checked={checked} disabled={confirmed} onChange={() => toggleParticipant(participant.id)} /><span>{participant.initials}</span><strong>{participant.displayName}</strong><em>{confirmed ? "Attending" : checked ? "Expected" : "Not included"}</em></label>;
            })}
          </div>
          <p><span>Planning estimate only. Travelers can confirm later.</span>{amountCents && expectedParticipantIds.length ? <strong>{formatMoney(amountCents, currency)} × {expectedParticipantIds.length} = {formatMoney(expectedTotalCents, currency)}</strong> : null}</p>
        </fieldset>
      ) : amountCents ? <p className="expected-plan-cost__total">{formatMoney(expectedTotalCents, currency)} expected total</p> : null}
    </section>
  );
}

function PlanDurationField({ value, setValue, date, time, timeZone }: {
  value: string;
  setValue: (value: string) => void;
  date: string | null;
  time: string;
  timeZone: string;
}) {
  const presets = ["30", "60", "90", "120", "180"];
  const [custom, setCustom] = useState(Boolean(value && !presets.includes(value)));
  const minutes = Number(value);
  const end = date && time && Number.isInteger(minutes) && minutes > 0 && minutes <= 10080
    ? itineraryEndTime(localDateTimeToIso(date, time, timeZone), minutes)
    : undefined;
  const endDay = end ? localDateKey(end, timeZone) : null;
  return <div>
    <label className="field"><span>Duration</span><select value={custom ? "custom" : value} onChange={(event) => {
      const next = event.target.value;
      setCustom(next === "custom");
      if (next !== "custom") setValue(next);
    }}>
      {presets.map((preset) => <option key={preset} value={preset}>{formatDuration(Number(preset))}</option>)}
      <option value="custom">Custom duration</option>
      <option value="">Not set</option>
    </select></label>
    {custom ? <label className="field"><span>Duration in minutes</span><input type="number" inputMode="numeric" min={1} max={10080} step={1} value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. 75" /></label> : null}
    {date ? <p className="plan-item-note" aria-live="polite">{end ? `Ends at ${formatTime(end, timeZone)}${endDay !== date ? ` · ${formatDayHeading(endDay!)}` : ""}` : "No end time set"}</p> : null}
  </div>;
}

function AddPlanSheet({
  meal = false,
  commonsSlug,
  timeZone,
  defaultDate,
  currency = "USD",
  participants,
  currentActorId,
  persistent,
  close,
  save,
}: {
  meal?: boolean;
  commonsSlug: string;
  timeZone: string;
  /** Asking first posts a group message, so it is offered only while group messages are on. */
  days: DayOption[];
  defaultDate: string;
  currency?: string;
  participants: CommonsParticipant[];
  currentActorId: string;
  persistent: boolean;
  close: () => void;
  save: (input: AddPlanInput) => Promise<void>;
}) {
  const [mealType, setMealType] = useState<import("@commons/contracts").MealType>("restaurant");
  const [reservationNumber, setReservationNumber] = useState("");
  const [reservationNote, setReservationNote] = useState("");
  const [title, setTitle] = useState("");
  const [arrangerPersonId, setArrangerPersonId] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [status, setStatus] = useState<NonNullable<AddPlanInput["status"]>>("planned");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [expectedCost, setExpectedCost] = useState("");
  const [expectedCostBasis, setExpectedCostBasis] = useState<AddPlanInput["expectedCostBasis"]>("total");
  const [expectedParticipantIds, setExpectedParticipantIds] = useState<string[]>([]);
  const [participantScope, setParticipantScope] = useState<AddPlanInput["participantScope"]>("everyone");
  const [linkInput, setLinkInput] = useState("");
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"add" | "ask" | null>(null);
  const justMe = participantScope === "self";
  const planExpectedParticipantIds = justMe ? [currentActorId] : expectedParticipantIds;

  async function previewLink() {
    if (!linkInput.trim() || previewBusy) return;
    setPreviewBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${commonsSlug}/links/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: linkInput.trim() }),
      });
      const payload = await response.json() as { preview?: unknown; error?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.error ?? "That link could not be previewed.");
      const preview = LinkPreviewSchema.parse(payload.preview);
      setLinkPreview(preview);
      if (!preview.existingItem) {
        setTitle(preview.title);
        if (!meal || mealType === "restaurant") setLocation(preview.location ?? "");
        setNote(preview.description ?? "");
      }
    } catch (previewError) {
      setLinkPreview(null);
      setError(previewError instanceof Error ? previewError.message : "That link could not be previewed. Try again.");
    } finally {
      setPreviewBusy(false);
    }
  }

  function removeLink() {
    setLinkInput("");
    setLinkPreview(null);
    setError("");
  }

  function submit() {
    if (!title.trim() || (scheduled && !date) || busy) return;
    if (participantScope === "subgroup" && !expectedParticipantIds.length) {
      setError("Choose at least one person for this plan.");
      return;
    }
    if (linkInput.trim() && !linkPreview) {
      setError("Use the link first so Commons can attach it to this plan.");
      return;
    }
    const durationMinutes = duration.trim() ? Number(duration) : null;
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080)) {
      setError("Enter a duration between 1 and 10,080 whole minutes, or leave it blank.");
      return;
    }
    const expectedCostCents = expectedCost ? parseMoneyInput(expectedCost) : null;
    if (expectedCost && !expectedCostCents) {
      setError("Add a valid estimated cost or leave it blank.");
      return;
    }
    if (expectedCostCents && expectedCostBasis === "per_person" && !planExpectedParticipantIds.length) {
      setError("Choose at least one traveler for the per-person estimate.");
      return;
    }
    setBusy("add");
    setError("");
    void save({
      title: title.trim(),
      ...(meal ? { mealType, ...(mealType === "restaurant" && (reservationNumber.trim() || reservationNote.trim()) ? { mealReservation: { number: reservationNumber.trim(), note: reservationNote.trim() } } : {}) } : {}),
      durationMinutes,
      date: scheduled ? date : null,
      time: scheduled ? time || null : null,
      status,
      location: meal && mealType === "home" ? "" : location.trim(),
      note: note.trim(),
      expectedCostCents,
      expectedCostCurrency: currency,
      expectedCostBasis,
      expectedParticipantIds: planExpectedParticipantIds,
      participantScope,
      sourceUrl: linkPreview?.url ?? null,
      arrangerPersonId,
    }).catch((saveError) => {
      setError(saveError instanceof Error ? saveError.message : "Plan not shared. Try again.");
      setBusy(null);
    });
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet add-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="add-plan-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><CalendarIcon /></span><span><small>Plan</small><strong>{meal ? "Add meal" : "Add something"}</strong></span></div><button onClick={close} aria-label="Close add plan"><CloseIcon /></button></header>
        <h2 id="add-plan-title">{meal ? "What’s the meal?" : "What are you considering?"}</h2>
        <p className="sheet-summary">Add what you know. A day, time and confirmation can be added separately.</p>
        <form className="add-plan-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {meal ? <MealTypeField value={mealType} onChange={setMealType} disabled={previewBusy} /> : null}
          <section className="plan-link-import" aria-labelledby="plan-link-import-title">
            <div><span className="plan-link-import__mark"><LinkIcon /></span><p><strong id="plan-link-import-title">{meal ? mealType === "home" ? "Add a recipe or other link" : "Add a restaurant website" : "Add something you found"}</strong><small>{meal ? "Optional. Review imported details before saving." : "Paste a hike, restaurant, map, or other link."}</small></p></div>
            {linkPreview ? (
              <div className={`plan-link-preview${linkPreview.existingItem ? " plan-link-preview--duplicate" : ""}`}>
                <p><small>{linkPreview.siteName} · {linkPreview.kind}</small><strong>{linkPreview.title}</strong>{linkPreview.existingItem ? <span>Already saved as {linkPreview.existingItem.status === "idea" ? "an idea" : "a plan"}: {linkPreview.existingItem.title}</span> : linkPreview.detailStatus === "link_only" ? <span>Commons couldn’t read this page. Check the title and add any useful details below.</span> : <span>Details added below. Review them before saving.</span>}</p>
                <button type="button" onClick={removeLink}>{linkPreview.existingItem ? "Use another link" : "Remove"}</button>
              </div>
            ) : (
              <div className="plan-link-import__controls">
                <label className="field"><span>Link</span><input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder={meal ? "https://…" : "https://www.alltrails.com/…"} maxLength={2048} /></label>
                <button type="button" disabled={!linkInput.trim() || previewBusy} onClick={() => void previewLink()}>{previewBusy ? "Reading…" : "Use link"}</button>
              </div>
            )}
          </section>
          <label className="field"><span>{meal ? "Meal" : "Activity"}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={meal ? mealType === "restaurant" ? "Dinner at The Shed" : "Taco night at the house" : "Fly fishing lesson"} maxLength={120} required /></label>
          {meal && mealType === "restaurant" ? <MealReservationFields number={reservationNumber} note={reservationNote} setNumber={setReservationNumber} setNote={setReservationNote} /> : null}
          <label className="field"><span>Confirmation</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="planned">Tentative</option><option value="confirmed">Confirmed</option></select></label>
          <fieldset className="plan-timing-choice">
            <legend>Timing</legend>
            <div>
              <label htmlFor="plan-timing-idea"><span className="sr-only">No day set</span><input id="plan-timing-idea" type="radio" name="plan-timing" checked={!scheduled} onChange={() => setScheduled(false)} /><span aria-hidden="true"><strong>No day yet</strong><small>No day set</small></span></label>
              <label htmlFor="plan-timing-scheduled"><span className="sr-only">Scheduled, add a day and time</span><input id="plan-timing-scheduled" type="radio" name="plan-timing" checked={scheduled} onChange={() => setScheduled(true)} /><span aria-hidden="true"><strong>Scheduled</strong><small>Choose a day; time is optional</small></span></label>
            </div>
          </fieldset>
          {scheduled ? <div className="add-plan-grid">
            <label className="field"><span>Day</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            <label className="field"><span>Start time <small>Optional</small></span><TimeInput value={time} onChange={(event) => setTime(event.target.value)} /></label>
          </div> : null}
          <PlanDurationField value={duration} setValue={setDuration} date={scheduled ? date : null} time={time} timeZone={timeZone} />
          {!meal || mealType !== "home" ? <label className="field"><span>Location <small>Optional</small></span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={meal ? "Restaurant name or address" : "Waquoit Bay Reserve"} maxLength={160} /></label> : null}
          <ExpectedPlanCostFields currency={currency} fixedPeople={participantScope === "subgroup"} amount={expectedCost} basis={expectedCostBasis} expectedParticipantIds={planExpectedParticipantIds} confirmedParticipantIds={justMe ? [currentActorId] : []} participants={justMe ? participants.filter((person) => person.id === currentActorId) : participants} setAmount={setExpectedCost} setBasis={setExpectedCostBasis} setExpectedParticipantIds={setExpectedParticipantIds} />
          <div className="field-pair">
            <ActivityArrangerField value={arrangerPersonId} onChange={setArrangerPersonId} participants={participants} />
            <label className="field"><span>Who’s it for?</span><select value={participantScope} onChange={(event) => { if (participantScope === "subgroup" && event.target.value !== "subgroup" && expectedCostBasis === "total") setExpectedParticipantIds([]); setParticipantScope(event.target.value as AddPlanInput["participantScope"]); }}><option value="everyone">Everyone</option><option value="optional">Whoever wants to join</option><option value="self">Just me</option><option value="subgroup">Specific people</option></select></label>
          </div>
          {participantScope === "subgroup" ? <PlanPeopleField participants={participants} selectedIds={expectedParticipantIds} onChange={(ids) => { setExpectedParticipantIds(ids); setError(""); }} /> : null}
          {justMe ? <p className="edit-plan-scope">Only you will be listed as going. The group can still see this plan.</p> : null}
          <label className="field"><span>Details <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={meal && mealType === "home" ? "Menu, ingredients or what to bring" : "What the group should know"} maxLength={500} /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sheet-primary" type="submit" disabled={!title.trim() || Boolean(linkPreview?.existingItem) || (scheduled && !date) || Boolean(busy)}>{busy === "add" ? "Adding…" : <><CheckIcon /> {meal ? "Add meal" : "Add activity"}</>}</button>
        </form>
        <p className="sheet-footnote">{persistent ? "Everyone on this trip can see ideas and scheduled plans." : "Changes to this demo stay on your device."}</p>
      </section>
    </ModalLayer>
  );
}

function EditPlanSheet({
  item,
  days,
  participants,
  currentActorId,
  timeZone,
  initialDate,
  close,
  save,
  remove,
  persistent,
}: {
  item: CommonsState["itinerary"][number];
  days: DayOption[];
  participants: CommonsParticipant[];
  currentActorId: string;
  timeZone: string;
  initialDate?: string | null;
  close: () => void;
  save: (input: EditPlanInput) => Promise<void>;
  remove: () => Promise<void>;
  persistent: boolean;
}) {
  const [mealType, setMealType] = useState(item.mealType ?? null);
  const [reservationNumber, setReservationNumber] = useState(item.mealReservation?.number ?? "");
  const [reservationNote, setReservationNote] = useState(item.mealReservation?.note ?? "");
  const [title, setTitle] = useState(item.title);
  const [originalArrangerPersonId] = useState(item.arrangerPersonId ?? null);
  const [arrangerPersonId, setArrangerPersonId] = useState<string | null>(item.arrangerPersonId ?? null);
  const [scheduled, setScheduled] = useState(Boolean(item.startsAt || item.scheduledDate || initialDate));
  const [date, setDate] = useState(item.startsAt ? localDateKey(item.startsAt, timeZone) : (item.scheduledDate ?? initialDate ?? days[0]?.id ?? ""));
  const [time, setTime] = useState(item.startsAt ? localTimeValue(item.startsAt, timeZone) : "");
  const [status, setStatus] = useState(item.status);
  const [duration, setDuration] = useState(String(itineraryDurationMinutes(item) ?? ""));
  const [location, setLocation] = useState(item.location ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const [expectedCost, setExpectedCost] = useState(item.expectedCostCents ? (item.expectedCostCents / 100).toFixed(2) : "");
  const [expectedCostBasis, setExpectedCostBasis] = useState<AddPlanInput["expectedCostBasis"]>(item.expectedCostBasis ?? "total");
  const [expectedParticipantIds, setExpectedParticipantIds] = useState<string[]>(item.expectedParticipantIds ?? item.participantIds ?? []);
  const [participantScope, setParticipantScope] = useState<EditPlanInput["participantScope"]>(() => planAudienceValue(item, currentActorId));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const justMe = participantScope === "self";
  const planExpectedParticipantIds = justMe ? [currentActorId] : expectedParticipantIds;

  function submit() {
    if (!title.trim() || (scheduled && !date) || busy) return;
    const durationMinutes = duration.trim() ? Number(duration) : null;
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080)) {
      setError("Enter a duration between 1 and 10,080 whole minutes, or leave it blank.");
      return;
    }
    if (participantScope === "subgroup" && !expectedParticipantIds.length) {
      setError("Choose at least one person for this plan.");
      return;
    }
    const expectedCostCents = expectedCost ? parseMoneyInput(expectedCost) : null;
    if (expectedCost && !expectedCostCents) {
      setError("Add a valid estimated cost or leave it blank.");
      return;
    }
    if (expectedCostCents && expectedCostBasis === "per_person" && !planExpectedParticipantIds.length) {
      setError("Choose at least one traveler for the per-person estimate.");
      return;
    }
    setBusy(true);
    setError("");
    void save({
      title: title.trim(),
      durationMinutes,
      date: scheduled ? date : null,
      time: scheduled ? time || null : null,
      status,
      location: mealType === "home" ? item.mealType === "home" ? item.location ?? "" : "" : location.trim(),
      note: note.trim(),
      expectedCostCents,
      expectedCostCurrency: item.expectedCostCurrency ?? "USD",
      expectedCostBasis,
      expectedParticipantIds: planExpectedParticipantIds,
      participantScope,
      sourceUrl: item.sourceUrl ?? null,
      ...(item.mealType ? { mealType, ...(mealType === "restaurant" ? { mealReservation: { number: reservationNumber.trim(), note: reservationNote.trim() } } : {}) } : {}),
      ...(arrangerPersonId !== originalArrangerPersonId ? { arrangerPersonId, expectedArrangerPersonId: originalArrangerPersonId } : {}),
    }).catch((saveError) => {
      setError(saveError instanceof Error ? saveError.message : "Plan not updated. Try again.");
      setBusy(false);
    });
  }

  return (
    <ModalLayer close={close}>
      <section className="sheet edit-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-plan-title">
        <div className="sheet-handle" />
        <header className="sheet-header"><div><span className="expense-sheet-mark"><CalendarIcon /></span><span><small>Plan</small><strong>{item.mealType ? "Edit meal" : "Edit activity"}</strong></span></div><button onClick={close} aria-label="Close edit plan"><CloseIcon /></button></header>
        <h2 id="edit-plan-title">Edit {item.title}</h2>
        <p className="sheet-summary">Update what the group will see in the shared plan.</p>
        <form className="edit-plan-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {mealType ? <MealTypeField value={mealType} onChange={setMealType} /> : null}
          <label className="field"><span>{mealType ? "Meal" : "Activity"}</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
          {mealType === "restaurant" ? <MealReservationFields number={reservationNumber} note={reservationNote} setNumber={setReservationNumber} setNote={setReservationNote} /> : null}
          <label className="field"><span>Confirmation</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="idea">Tentative</option><option value="planned">Planned</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label>
          <fieldset className="plan-timing-choice">
            <legend>Timing</legend>
            <div>
              <label htmlFor="edit-plan-timing-idea"><span className="sr-only">Idea, no day set</span><input id="edit-plan-timing-idea" type="radio" name="edit-plan-timing" checked={!scheduled} onChange={() => setScheduled(false)} /><span aria-hidden="true"><strong>No day yet</strong><small>No day set</small></span></label>
              <label htmlFor="edit-plan-timing-scheduled"><span className="sr-only">Scheduled, add a day and time</span><input id="edit-plan-timing-scheduled" type="radio" name="edit-plan-timing" checked={scheduled} onChange={() => setScheduled(true)} /><span aria-hidden="true"><strong>Scheduled</strong><small>Choose a day; time is optional</small></span></label>
            </div>
          </fieldset>
          {scheduled ? <div className="add-plan-grid">
            <label className="field"><span>Day</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
            <label className="field"><span>Time <small>Optional</small></span><TimeInput value={time} onChange={(event) => setTime(event.target.value)} /></label>
          </div> : null}
          <PlanDurationField value={duration} setValue={setDuration} date={scheduled ? date : null} time={time} timeZone={timeZone} />
          {mealType !== "home" ? <label className="field"><span>Location <small>Optional</small></span><input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} /></label> : null}
          <ExpectedPlanCostFields currency={item.expectedCostCurrency ?? "USD"} fixedPeople={participantScope === "subgroup"} amount={expectedCost} basis={expectedCostBasis} expectedParticipantIds={planExpectedParticipantIds} confirmedParticipantIds={justMe ? [currentActorId] : item.participantIds ?? []} participants={justMe ? participants.filter((person) => person.id === currentActorId) : participants} setAmount={setExpectedCost} setBasis={setExpectedCostBasis} setExpectedParticipantIds={setExpectedParticipantIds} />
          <div className="field-pair">
            <ActivityArrangerField value={arrangerPersonId} onChange={setArrangerPersonId} participants={participants} previousName={item.arrangerName} />
            <label className="field"><span>Who’s it for?</span><select value={participantScope} onChange={(event) => { if (participantScope === "subgroup" && event.target.value !== "subgroup" && expectedCostBasis === "total") setExpectedParticipantIds(item.respondedParticipantIds ?? item.participantIds ?? []); setParticipantScope(event.target.value as EditPlanInput["participantScope"]); }}><option value="everyone">Everyone</option><option value="optional">Whoever wants to join</option><option value="self">Just me</option><option value="subgroup">Specific people</option></select></label>
          </div>
          {justMe ? <p className="edit-plan-scope">Only you will be listed as going. The group can still see this plan.</p> : null}
          {participantScope === "subgroup" ? <PlanPeopleField participants={participants} selectedIds={expectedParticipantIds} protectedIds={item.respondedParticipantIds ?? item.participantIds ?? []} onChange={(ids) => { setExpectedParticipantIds(ids); setError(""); }} /> : null}
          <label className="field"><span>Details <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What the group should know" maxLength={500} /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sheet-primary" type="submit" disabled={!title.trim() || (scheduled && !date) || busy}>{busy ? "Saving…" : <><CheckIcon /> Save changes</>}</button>
        </form>

        <section className="delete-plan-section">
          {!confirmDelete ? (
            <button className="delete-plan-action" type="button" onClick={() => setConfirmDelete(true)}>Delete plan</button>
          ) : (
            <div className="delete-plan-confirm" role="alert">
              <strong id="delete-plan-title">Delete {item.title}?</strong>
              <p>{item.startsAt ? `This removes it from ${formatDayHeading(localDateKey(item.startsAt, timeZone))} at ${formatTime(item.startsAt, timeZone)}.` : "This removes the idea from the shared plan."} Linked photos stay in Photos.</p>
              {deleteError ? <p className="form-error">{deleteError}</p> : null}
              <div><button type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteError(""); }}>Keep plan</button><button type="button" disabled={deleting} onClick={() => { setDeleting(true); setDeleteError(""); void remove().catch((removeError) => { setDeleteError(removeError instanceof Error ? removeError.message : "Plan not deleted. Try again."); setDeleting(false); }); }}>{deleting ? "Deleting…" : `Delete ${item.title}`}</button></div>
            </div>
          )}
        </section>
        <p className="sheet-footnote">{persistent ? "Everyone on this trip can see these changes." : "Changes stay in this browser session."}</p>
      </section>
    </ModalLayer>
  );
}

export function TravelPlansSheet({
  commonsSlug,
  kind,
  defaultDate,
  defaultCurrency = "USD",
  returnDefaultDate,
  plans,
  allPlans,
  participants,
  currentActorId,
  currentActorName,
  close,
  save,
  saveBooking,
  updateSharing,
  remove,
  linkedExpense,
  recordExpense,
  openLinkedExpense,
  confirmationUploadEnabled,
  inline = false,
  selectedRentalPlanId,
  initialIntakeId,
  sampleOnly = false,
}: {
  commonsSlug: string;
  kind: TravelPlan["kind"];
  defaultDate: string;
  defaultCurrency?: string;
  returnDefaultDate: string;
  plans: TravelPlan[];
  allPlans: TravelPlan[];
  participants: CommonsParticipant[];
  currentActorId: string;
  currentActorName: string;
  close: () => void;
  save: (input: { kind: TravelPlan["kind"]; travelPlanId: string | null; date: string; route: string; time: string | null; note: string; companionPersonId: string; includedPersonIds: string[]; driverPersonId: string | null; provider: string; vehicle: string; returnDate: string | null; returnTime: string | null; status: "considering" | "booked" | "confirmed"; confirmationCode: string; totalCents: number | null; currency?: string; confirmationDocument?: ConfirmationDocumentInput }) => Promise<void>;
  saveBooking: (input: { legs: FlightLegReview[]; expectedPlanVersions?: Array<{ id: string; version: string }>; removeLegKinds: Array<"arrival" | "departure">; includedPersonIds: string[]; note: string; confirmationCode: string; totalCents: number | null; currency?: string; confirmationDocument?: ConfirmationDocumentInput }) => Promise<TravelPlan[] | void>;
  updateSharing: (travelPlanId: string, visibility: "private" | "basic" | "all", expectedVersion?: string) => Promise<TravelPlan[] | void>;
  remove: (travelPlanId: string) => Promise<void>;
  linkedExpense?: Expense;
  recordExpense?: () => void;
  openLinkedExpense?: () => void;
  confirmationUploadEnabled: boolean;
  inline?: boolean;
  selectedRentalPlanId: string | null;
  initialIntakeId?:string|null;
  sampleOnly?: boolean;
}) {
  const isGround = kind === "car_rental" || kind === "transport";
  const existing = isGround
    ? plans.find((plan) => plan.id === selectedRentalPlanId && plan.personId === currentActorId)
    : plans.find((plan) => plan.personId === currentActorId && plan.kind === kind) ?? plans.find((plan) => plan.personId === currentActorId);
  const hasOtherPlanForKinds = (personId: string, kinds: Set<TravelPlan["kind"]>) => allPlans.some((plan) => {
    if (!kinds.has(plan.kind) || plan.personId === currentActorId) return false;
    return (plan.personIds ?? [plan.personId]).includes(personId);
  });
  const existingVisibility = existing?.visibility ?? "private";
  const [route, setRoute] = useState(existing?.route ?? "");
  const [date, setDate] = useState(existing?.date ?? defaultDate);
  const [time, setTime] = useState(existing?.time ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [includedPersonIds, setIncludedPersonIds] = useState<string[]>(
    existing?.personIds ?? (hasOtherPlanForKinds(currentActorId, new Set([kind])) ? [] : [currentActorId]),
  );
  const ownedFlightPlans = allPlans.filter((plan) => plan.personId === currentActorId && !["car_rental", "transport"].includes(plan.kind));
  const [flightSegments, setFlightSegments] = useState<FlightLegReview[]>(
    isGround ? [] : ownedFlightPlans.length
      ? (["arrival", "departure"] as const).flatMap((flightKind) => {
        const plan = ownedFlightPlans.find((candidate) => candidate.kind === flightKind);
        return plan ? [{ kind: flightKind, date: plan.date, route: plan.route, time: plan.time ?? "", connections: plan.connections }] : [];
      })
      : [
        { kind: "arrival", date: defaultDate, route: "", time: "", connections: [blankFlightConnection()] },
      ],
  );
  const [removedFlightKinds, setRemovedFlightKinds] = useState<Array<"arrival" | "departure">>([]);
  const [driverPersonId, setDriverPersonId] = useState(existing?.driverPersonId ?? (kind === "transport" ? "" : currentActorId));
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [vehicle, setVehicle] = useState(existing?.vehicle ?? "");
  const [returnDate, setReturnDate] = useState(existing?.returnDate ?? "");
  const [returnTime, setReturnTime] = useState(existing?.returnTime ?? "");
  const [rentalStatus, setRentalStatus] = useState<"considering" | "booked" | "confirmed">(existing?.status ?? (kind === "transport" ? "considering" : "confirmed"));
  const [confirmationCode, setConfirmationCode] = useState(existing?.confirmationCode ?? "");
  const bookingCostPlan = isGround ? existing : ownedFlightPlans.find(plan => plan.totalCents);
  const [totalCost, setTotalCost] = useState(bookingCostPlan?.totalCents ? (bookingCostPlan.totalCents / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(bookingCostPlan?.currency ?? defaultCurrency);
  const [reviewedReplacement, setReviewedReplacement] = useState(false);
  const [expectedPlanVersions, setExpectedPlanVersions] = useState(ownedFlightPlans.map(plan => ({ id: plan.id, version: plan.version ?? "" })));
  const [sharingOpen, setSharingOpen] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmationUploaded, setConfirmationUploaded] = useState(false);
  const hasAnotherPlan = (personId: string) => {
    const kindsToReview = flightSegments.length > 1
      ? new Set(flightSegments.map((segment) => segment.kind))
      : new Set([kind]);
    return hasOtherPlanForKinds(personId, kindsToReview);
  };
  const reviewedSegments = isGround ? [] : flightSegments;
  const segmentsReady = isGround || reviewedSegments.every((segment) => segment.date && segment.route.trim() && segment.time);

  function toggleTraveler(personId: string) {
    setIncludedPersonIds((current) => {
      const next = current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId];
      if (personId === driverPersonId && !next.includes(personId)) setDriverPersonId(next[0] ?? "");
      return next;
    });
    setError("");
  }


  function removeFlightHome() {
    setFlightSegments((current) => current.filter((item) => item.kind !== "departure"));
    if (ownedFlightPlans.some((plan) => plan.kind === "departure")) setRemovedFlightKinds(["departure"]);
  }

  async function shareSavedPlan(visibility: "private" | "basic" | "all") {
    if (!existing) return;
    if (busy) throw new Error("Wait for the booking save to finish before sharing.");
    const expected = expectedPlanVersions.find(plan => plan.id === existing.id)?.version ?? existing.version;
    const saved = await updateSharing(existing.id, visibility, expected);
    const updated = saved?.find(plan => plan.id === existing.id);
    if (updated) setExpectedPlanVersions(current => current.map(plan => plan.id === updated.id ? { id: updated.id, version: updated.version ?? "" } : plan));
  }

  return (
    <EditorSurface close={close} inline={inline}>
      <section className="sheet travel-plans-sheet logistics-editor-sheet" role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby="travel-plans-title">
        <div className="sheet-handle" />
        <header className="sheet-header logistics-editor-header"><div><span className="expense-sheet-mark"><RouteIcon /></span><h2 id="travel-plans-title">{existing ? "Edit" : "Add"} {isGround ? "transport" : "flights"}</h2></div><button type="button" onClick={close} aria-label={inline ? "Cancel travel plans" : "Close travel plans"}>{inline ? "Cancel" : <CloseIcon />}</button></header>

        <form className="travel-plan-form" onSubmit={(event) => {
          event.preventDefault();
          const totalCents = isGround && totalCost ? parseMoneyInput(totalCost) : null;
          if (isGround && totalCost && !totalCents) { setError("Enter a valid travel cost."); return; }
          if (!includedPersonIds.length) { setError("Choose at least one traveler."); return; }
          if (!segmentsReady) { setError("Review the route, date, and time for each flight."); return; }
          if (pendingConfirmation && ownedFlightPlans.length && !isGround && !reviewedReplacement) { setError("Review the replacement of your saved flights first."); return; }
          setBusy(true);
          setError("");
          void (async () => {
            if (pendingConfirmation && !confirmationUploaded) {
              if (pendingConfirmation.file) await uploadCommonsConfirmation(pendingConfirmation.upload, pendingConfirmation.file);
        else if (!pendingConfirmation.alreadyUploaded) throw new Error("Reopen your confirmation review before saving.");
              setConfirmationUploaded(true);
            }
            if (isGround) {
              await save({ kind, travelPlanId: existing?.id ?? null, date, route: route.trim(), time: time || null, note: note.trim(), companionPersonId: includedPersonIds.find((personId) => personId !== currentActorId) ?? "", includedPersonIds, driverPersonId: driverPersonId || null, provider: provider.trim(), vehicle: vehicle.trim(), returnDate: returnDate || null, returnTime: returnTime || null, status: rentalStatus, confirmationCode: confirmationCode.trim(), totalCents, currency,
                ...(pendingConfirmation ? { confirmationDocument: { storagePath: pendingConfirmation.upload.storagePath, fileName: pendingConfirmation.draft.sourceLabel, mimeType: pendingConfirmation.upload.mimeType ?? "application/pdf" as const, ...(pendingConfirmation.intakeId ? { intakeId: pendingConfirmation.intakeId, intakeVersion: pendingConfirmation.intakeVersion } : {}) } } : {}),
              });
            } else {
              const savedPlans = await saveBooking({
                legs: reviewedSegments.map((segment) => ({ ...segment, route: segment.route.trim() })),
                expectedPlanVersions,
                currency,
                removeLegKinds: removedFlightKinds,
                includedPersonIds,
                note: note.trim(),
                confirmationCode: confirmationCode.trim(),
                totalCents,
                ...(pendingConfirmation ? { confirmationDocument: { storagePath: pendingConfirmation.upload.storagePath, fileName: pendingConfirmation.draft.sourceLabel, mimeType: pendingConfirmation.upload.mimeType ?? "application/pdf" as const, ...(pendingConfirmation.intakeId ? { intakeId: pendingConfirmation.intakeId, intakeVersion: pendingConfirmation.intakeVersion } : {}) } } : {}),
              });
              if (savedPlans) setExpectedPlanVersions(savedPlans.filter(plan => plan.personId === currentActorId && !["car_rental", "transport"].includes(plan.kind)).map(plan => ({ id: plan.id, version: plan.version ?? "" })));
            }
          })()
            .then(() => { setBusy(false); setPendingConfirmation(null); close(); })
            .catch((saveError) => { setError(saveError instanceof Error ? saveError.message : "Travel plan not saved. Try again."); setBusy(false); });
        }}>
          <p className="logistics-editor-owner">{currentActorName}</p>
          {sampleOnly ? <p className="event-logistics-note">Sample only. Changes reset when you reload.</p> : null}
          {confirmationUploadEnabled && kind !== "transport" ? <ConfirmationUploadControl intakeId={initialIntakeId} commonsSlug={commonsSlug} expectedKind={isGround ? "car_rental" : "flight"} review={pendingConfirmation ? {...pendingConfirmation.draft, startsOn:date || null, endsOn:returnDate || null, startTime:time || null, endTime:returnTime || null, route:route || null, note:note || null, name:isGround ? provider || null : pendingConfirmation.draft.name, confirmationCode:confirmationCode || null, totalCents:totalCost ? Math.round(Number(totalCost)*100) : null, currency, travelSegments:flightSegments.map(segment=>({...segment,date:segment.date || null,route:segment.route || null,time:segment.time || null,departureTime:null,arrivalTime:null}))} : undefined} onReviewSaved={revision=>setPendingConfirmation(value=>value?{...value,intakeVersion:revision}:value)} currentFileName={pendingConfirmation?.draft.sourceLabel ?? existing?.confirmationDocumentFileName} warnings={pendingConfirmation?.draft.warnings} onReady={(pending) => {
            setPendingConfirmation(pending);
            setConfirmationUploaded(Boolean(pending.alreadyUploaded));
            setReviewedReplacement(false);
            const { draft } = pending;
            setCurrency(draft.currency);
            const importedSegments = draft.travelSegments?.map((segment) => ({
              kind: segment.kind,
              date: segment.date ?? "",
              route: segment.route ?? "",
              time: segment.time ?? "",
              connections: segment.connections,
            })) ?? [];
            if (!isGround) {
              setFlightSegments(importedSegments.length ? importedSegments : [{ kind: "arrival", date: "", route: "", time: "" }]);
              const importedKinds = new Set(importedSegments.map((segment) => segment.kind));
              setIncludedPersonIds((current) => current.filter((personId) => !hasOtherPlanForKinds(personId, importedKinds)));
            }
            const segment = importedSegments.find((candidate) => candidate.kind === kind);
            setRoute(segment?.route ?? draft.route ?? "");
            setDate(segment?.date ?? draft.startsOn ?? "");
            setTime(segment?.time ?? draft.startTime ?? "");
            setNote(draft.note ?? "");
            if (isGround) {
              setProvider(draft.name ?? "");
              setVehicle(draft.note ?? "");
              setReturnDate(draft.endsOn ?? "");
              setReturnTime(draft.endTime ?? "");
            }
            setConfirmationCode(draft.confirmationCode ?? "");
            setTotalCost(draft.totalCents ? (draft.totalCents / 100).toFixed(2) : "");
          }} /> : null}
          {!isGround && pendingConfirmation ? <div className="confirmation-round-trip"><CheckIcon /><span><strong>{flightSegments.length ? `${flightSegments.length} flight ${flightSegments.length === 1 ? "plan" : "plans"} found` : "Confirmation attached"}</strong><small>Review every route and time here. Flight costs belong in Money.</small></span></div> : null}
          {isGround ? <>
            <div className="travel-form-grid">
              <label className="field"><span>Provider <small>Optional</small></span><input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="National" maxLength={120} /></label>
              <label className="field"><span>Vehicle or class <small>Optional</small></span><input value={vehicle} onChange={(event) => setVehicle(event.target.value)} placeholder="Standard SUV" maxLength={120} /></label>
            </div>
            <label className="field"><span>Status</span><select value={rentalStatus} onChange={(event) => setRentalStatus(event.target.value as typeof rentalStatus)}><option value="considering">Tentative</option><option value="booked">Booked</option><option value="confirmed">Confirmed</option></select></label>
            <fieldset className="travelers-field"><legend>Included travelers</legend>{participants.map((participant) => <label key={participant.id}><input type="checkbox" checked={includedPersonIds.includes(participant.id)} onChange={() => toggleTraveler(participant.id)} /><span>{participant.displayName}{participant.membershipStatus === "invited" ? " · Invited · attendance not confirmed" : ""}</span></label>)}</fieldset>
            <label className="field"><span>Driver <small>Optional for transport</small></span><select value={driverPersonId} onChange={(event) => setDriverPersonId(event.target.value)} required={kind === "car_rental"}><option value="">Not assigned</option>{participants.filter((participant) => includedPersonIds.includes(participant.id)).map((participant) => <option key={participant.id} value={participant.id}>{participant.displayName}</option>)}</select></label>
          </> : <fieldset className="travelers-field"><legend>Travelers on this booking</legend>{participants.map((participant) => { const unavailable = hasAnotherPlan(participant.id); return <label key={participant.id} className={unavailable ? "disabled" : undefined}><input type="checkbox" checked={includedPersonIds.includes(participant.id)} disabled={unavailable} onChange={() => toggleTraveler(participant.id)} /><span>{participant.displayName}{participant.membershipStatus === "invited" ? " · Invited · attendance not confirmed" : ""}{unavailable ? " · already has a plan" : ""}</span></label>; })}</fieldset>}
          {!isGround ? <FlightBookingFields legs={flightSegments} onChange={setFlightSegments} removeHome={removeFlightHome} addHome={() => { setFlightSegments(current => [...current, { kind: "departure", date: returnDefaultDate, route: "", time: "", connections: [blankFlightConnection()] }]); setRemovedFlightKinds([]); }} /> : <><label className="field"><span>Pick-up → drop-off</span><input value={route} onChange={(event) => setRoute(event.target.value)} placeholder="SNA Airport → SNA Airport" maxLength={120} required /></label><div className="travel-form-grid"><label className="field"><span>Pick-up date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="field"><span>Pick-up time <small>Optional</small></span><TimeInput value={time} onChange={(event) => setTime(event.target.value)} /></label></div></>}
          {isGround ? <div className="travel-form-grid"><label className="field"><span>Return date <small>Optional for transport</small></span><input type="date" value={returnDate} min={date} onChange={(event) => setReturnDate(event.target.value)} required={kind === "car_rental"} /></label><label className="field"><span>Return time <small>Optional</small></span><TimeInput value={returnTime} onChange={(event) => setReturnTime(event.target.value)} /></label></div> : null}
          <label className="field"><span>Coordination note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Need a ride" maxLength={120} /></label>
          {isGround ? <>
          <label className="field"><span>Total cost <small>Optional · private until you share it</small></span><span className="money-input"><b aria-hidden="true">{currencySymbol(currency)}</b><input value={totalCost} onChange={(event) => setTotalCost(normalizeMoneyInput(event.target.value))} inputMode="decimal" placeholder="0.00" aria-label={`Total travel cost in ${currency}`} /></span></label>
          <p className="expense-mode-help">Planning amount only. This does not add an expense or reimbursement.</p>
          </> : <p className="expense-mode-help">Flights are shared with the trip. Add flight costs separately as an expense in Money.</p>}
          <label className="field"><span>Confirmation number <small>Optional</small></span><input value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} placeholder={isGround ? "Rental confirmation" : "Flight confirmation"} maxLength={120} autoComplete="off" /></label>
          {(existing?.confirmationDocumentUrl || bookingCostPlan?.confirmationDocumentUrl) && !pendingConfirmation ? <a className="confirmation-document-link" href={existing?.confirmationDocumentUrl ?? bookingCostPlan?.confirmationDocumentUrl} target="_blank" rel="noreferrer"><FileTextIcon /> Open confirmation</a> : null}
          <div className="travel-private-note"><LockIcon /><span><strong>{!isGround ? "Flight details shared with the trip" : existingVisibility !== "private" || kind === "transport" ? "Basic details shared with the trip" : "Private"}</strong><small>{!isGround ? "Travelers, route, dates, times and flight connections are shared. Confirmation numbers and original files stay private." : existingVisibility === "all" ? "Saving updates the note and cost the group can see. Confirmation numbers stay private." : "Costs, confirmation numbers and original files stay private unless you share the cost."}</small></span></div>
          {pendingConfirmation?.draft.travelerNames?.length ? <p className="expense-mode-help">Names on confirmation: {pendingConfirmation.draft.travelerNames.join(", ")}. Check the travelers selected above.</p> : null}
          {pendingConfirmation && ownedFlightPlans.length && !isGround ? <label className="travel-replacement-review"><input type="checkbox" checked={reviewedReplacement} onChange={event => setReviewedReplacement(event.target.checked)} /><span>Replace the reviewed flight details below. Flight details are shared with the trip.</span></label> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="sheet-primary" type="submit" disabled={!includedPersonIds.length || !segmentsReady || (isGround && (!date || !route.trim() || (kind === "car_rental" && (!returnDate || !driverPersonId)))) || busy || sharingBusy}>{busy ? "Saving…" : <><CheckIcon /> Save {isGround ? "transport" : "flight booking"}</>}</button>
        </form>
        {existing && isGround ? (
          <section className="travel-sharing" aria-labelledby="travel-sharing-title">
            {!isGround ? <p className="expense-mode-help">Sharing and removal below apply only to {existing.kind === "arrival" ? "getting there" : "heading home"}. Edit the other plan to change its sharing separately.</p> : null}
            <div><span className="travel-sharing-mark"><ShareIcon /></span><p><strong id="travel-sharing-title">{existingVisibility === "private" ? "Share with the group" : "Sharing with the group"}</strong><small>{existingVisibility === "all" ? "Route, timing, note, and cost are shared." : existingVisibility === "basic" ? "Traveler, route, date, and time are shared." : "Choose exactly what everyone can see."}</small></p></div>
            {!sharingOpen ? (
              <button type="button" onClick={() => setSharingOpen(true)}>{existingVisibility === "private" ? "Share" : "Change sharing"}</button>
            ) : (
              <div className="travel-sharing-options">
                <button type="button" disabled={sharingBusy} onClick={() => { setSharingBusy(true); setError(""); void shareSavedPlan("basic").then(() => { setSharingBusy(false); setSharingOpen(false); }).catch((shareError) => { setError(shareError instanceof Error ? shareError.message : "Sharing not changed. Try again."); setSharingBusy(false); }); }}><strong>Share basic info</strong><small>Traveler, route, date, and time</small></button>
                <button type="button" disabled={sharingBusy} onClick={() => { setSharingBusy(true); setError(""); void shareSavedPlan("all").then(() => { setSharingBusy(false); setSharingOpen(false); }).catch((shareError) => { setError(shareError instanceof Error ? shareError.message : "Sharing not changed. Try again."); setSharingBusy(false); }); }}><strong>Share all info (including cost)</strong><small>Also shares the coordination note</small></button>
                {existingVisibility !== "private" ? <button className="travel-sharing-private" type="button" disabled={sharingBusy} onClick={() => { setSharingBusy(true); setError(""); void shareSavedPlan("private").then(() => { setSharingBusy(false); setSharingOpen(false); }).catch((shareError) => { setError(shareError instanceof Error ? shareError.message : "Sharing not changed. Try again."); setSharingBusy(false); }); }}>Make private again</button> : null}
              </div>
            )}
          </section>
        ) : null}
        {isGround && existing?.totalCents && linkedExpense && openLinkedExpense ? <div className="stay-expense-link"><p><strong>Recorded for reimbursement</strong><span>{formatMoney(linkedExpense.amountCents, linkedExpense.currency)} · Confirmation PDF attached</span></p><button type="button" onClick={openLinkedExpense}>View expense</button></div> : null}
        {isGround && existing?.totalCents && !linkedExpense && recordExpense ? <div className="stay-expense-link"><p><strong>No expense recorded</strong><span>Review the payer and split before adding it to Money.</span></p><button type="button" onClick={recordExpense}>Record as expense</button></div> : null}
        {existing ? <div className="stay-delete">{confirmDelete ? <div><p>Remove this {["car_rental", "transport"].includes(existing.kind) ? "rental" : `${existing.kind} plan`}? Linked expenses remain recorded.</p><button type="button" onClick={() => { setBusy(true); setError(""); void remove(existing.id).catch((removeError) => { setError(removeError instanceof Error ? removeError.message : "Travel plan not removed. Try again."); setBusy(false); }); }} disabled={busy}>Remove travel plan</button><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep plan</button></div> : <button type="button" onClick={() => setConfirmDelete(true)}>Remove travel plan</button>}</div> : null}
      </section>
    </EditorSurface>
  );
}

export function CommonsApp({
  tripStagesOn = false,
  initialSnapshot,
  dataMode,
  signedIn,
  showArrival = true,
  openTravelExpense,
  decisionHandoff = null,
  decisionHandoffUnavailable = false,
  initialView = "home",
  confirmationIntakeEnabled = false,
  initialPlanSection = "schedule",
  initialItem,
  tripMapEnabled = true,
  tripLetterEnabled = false,
  textMessagingEnabled = false,
  betaMapEnabled = false,
  betaCompletion,
}: {
  /** Master flag for the two trip stages (docs/TRIP-STAGES-DIRECTION.md). Off: navigation and Trip are as before. */
  tripStagesOn?: boolean;
  initialSnapshot: CommonsSnapshot;
  dataMode: "database" | "demo";
  signedIn: boolean;
  showArrival?: boolean;
  openTravelExpense?: string;
  decisionHandoff?: DecisionHandoff | null;
  decisionHandoffUnavailable?: boolean;
  initialView?: EventView;
  initialPlanSection?: PlanSection;
  initialItem?: { kind: "plan" | "stay"; id: string };
  /** Plan → Map for stays and activities. */
  tripMapEnabled?: boolean;
  /** This trip is on the new experience: DESIGN.md "The trip letter". */
  tripLetterEnabled?: boolean;
  /** A provider is chosen and sending isn't disabled. */
  /** Where a traveler can talk with Commons from this trip: messages in Commons ("web"), texting ("sms"), or neither. */
  textMessagingEnabled?: TextMessagingChannel;
  /** Beta rework map wording and Open stay. Off: the map reads exactly as before. */
  betaMapEnabled?: boolean;
  /** Sub-features for the Money wrap-up. Undefined (trip not on the new experience) renders nothing new. */
  betaCompletion?: { paymentReports: boolean; closure: boolean; recap: boolean; successor: boolean };
  confirmationIntakeEnabled?: boolean;
}) {
  const [planSection, setPlanSection] = useState<PlanSection>(initialPlanSection === "map" && !tripMapEnabled ? "schedule" : initialPlanSection);
  // Persistent shell: in-session places to return to. Exact selections live in the URL; these only remember where you were.
  const lastPlanSection = useRef<PlanSection>(initialView === "logistics" ? "travel" : initialPlanSection);
  const [mapOrigin, setMapOrigin] = useState<"schedule" | "travel">(initialView === "logistics" ? "travel" : "schedule");
  const [quickAdd, setQuickAdd] = useState<"activity" | "stay" | null>(null);
  const [confirmingStayId, setConfirmingStayId] = useState<string | null>(null);
  const [detailRef, setDetailRef] = useState(initialItem);
  const [photoActivityId, setPhotoActivityId] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const seededPilot = initialSnapshot.commons.slug === "cape-cod-couples-week";
  const [travelIntakeId,setTravelIntakeId]=useState<string|null>(null);
  const [participants, setParticipants] = useState(initialSnapshot.participants);
  const [savedWorksheet, setSavedWorksheet] = useState<BudgetInputs | null>(null);
  const [commonsSummary, setCommonsSummary] = useState(initialSnapshot.commons);
  const tripStarted = hasTripStarted(commonsSummary);
  const postTrip = isPostTrip(commonsSummary);
  const [savedState, setState] = useState<CommonsState>(initialSnapshot.state);
  const [sampleStays, setSampleStays] = useState<Stay[] | null>(null);
  const [sampleTravelPlans, setSampleTravelPlans] = useState<TravelPlan[] | null>(null);
  const sampleStayRecords = dataMode === "demo" && commonsSummary.id === PUBLIC_DEMO_COMMONS_ID ? sampleStays ?? publicDemoStays(commonsSummary, participants, savedState.stays ?? []) : null;
  const state: CommonsState = { ...savedState, ...(sampleStayRecords ? { stays: sampleStayRecords } : {}), ...(sampleTravelPlans ? { travelPlans: sampleTravelPlans } : {}) };
  const days = planDays(commonsSummary.startsOn, commonsSummary.endsOn, [...state.itinerary.flatMap(item => item.scheduledDate ? [item.scheduledDate] : item.startsAt ? [localDateKey(item.startsAt, commonsSummary.timezone)] : []), ...(state.travelPlans ?? []).flatMap(plan => [plan.date, ...(plan.returnDate ? [plan.returnDate] : [])])]);
  const defaultDay = seededPilot ? "2027-07-22" : days[0]?.id ?? "";
  // Start the renamed public sample fresh; older browser copies contain its old cast.
  // Other demo state and real, database-backed events keep their existing behavior.
  const storageKey = `commons:trip:${initialSnapshot.commons.slug}:${seededPilot ? "v5" : "v4"}`;
  const coverStorageKey = `commons:trip:${initialSnapshot.commons.slug}:cover:v1`;
  const [loadedDemoStorageKey, setLoadedDemoStorageKey] = useState<string | null>(null);
  const [expenseCompletionByPerson, setExpenseCompletionByPerson] = useState<Record<string, string | null>>(() => Object.fromEntries(participants.map((participant) => [participant.id, participant.expensesCompleteAt ?? null])));
  const [moneyStatus, setMoneyStatus] = useState({
    expensesClosedAt: initialSnapshot.commons.expensesClosedAt ?? null,
    expensesClosedByPersonId: initialSnapshot.commons.expensesClosedByPersonId ?? null,
    expensesClosedByName: initialSnapshot.commons.expensesClosedByName ?? null,
  });
  const router = useRouter();
  const tripStage = tripStagesOn ? initialSnapshot.commons.stage ?? "going" : null;
  const [tab, setActiveTab] = useState<Tab>(initialView);
  const [arrivalOpen, setArrivalOpen] = useState(showArrival);
  const validTravelExpense = initialSnapshot.state.travelPlans?.find(plan => plan.id === openTravelExpense && plan.personId === initialSnapshot.currentActor.id);
  const [, setPeopleRevision] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(initialItem ? "item-detail" : decisionHandoff ? decisionHandoff.action === "dates" ? "edit-trip-details" : decisionHandoff.action === "stay" ? "add-stay" : decisionHandoff.planId ? "edit-plan" : "add-plan" : validTravelExpense ? "add-expense" : null);
  useEffect(() => {
    if (sheet || !decisionHandoff) return;
    // Once saved/cancelled, refresh must not reopen the original handoff editor.
    const url = new URL(window.location.href);
    url.searchParams.delete("decisionPoll"); url.searchParams.delete("decisionAction");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [sheet, decisionHandoff]);
  // Trip details always open as their own sheet; Travel no longer repeats them.
  const inlineLogisticsEditing = false;
  const backgroundInert = arrivalOpen || Boolean(sheet && !inlineLogisticsEditing);
  const setTab = useCallback((requested: Tab) => {
    const next = requested;
    // The rail returns to where you were: Plan keeps its last section.
    const section = next === "logistics" ? "travel" : lastPlanSection.current;
    setActiveTab(next === "plan" && visiblePlanSection(section) === "travel" ? "logistics" : next);
    if (next === "plan" || next === "logistics") setPlanSection(section);
    setSheet(null);
    setArrivalOpen(false);
    const path = next === "plan" || next === "logistics" ? planSectionPath(initialSnapshot.commons.id, section)
      : commonsViewPath(initialSnapshot.commons.id, next);
    if (window.location.pathname + window.location.search !== path) window.history.pushState(null, "", path);
  }, [initialSnapshot.commons.id, setSheet]);
  const openLogistics = () => { setSheet(null); setTab("logistics"); };
  // Stays saved from the map stay on the map: Travel & stays omits considered stays.
  const openStays = () => { setSheet(null); setActiveTab("plan"); setPlanSection("stays"); window.history.pushState(null, "", planSectionPath(initialSnapshot.commons.id, "stays")); };
  // Stays saved from the map stay on the map; elsewhere they open Stays.
  // Saving a stay keeps your place; the receipt offers View in Plan.
  const afterStaySave = () => setSheet(null);
  const routeSearch = useSearchParams()?.toString() ?? "";
  const lastRouteSearch = useRef(routeSearch);
  useEffect(() => {
    // Next Link navigation and native History API writes share the same URL
    // subscription. Initial hydration must not reopen a dismissed dialog.
    if (routeSearch === lastRouteSearch.current) return;
    lastRouteSearch.current = routeSearch;
    const restore = () => { const search = new URLSearchParams(routeSearch);
      setActiveTab(eventLocation(search)); setPlanSection(parsePlanSection(search.get("section"), tripMapEnabled));
      const kind = search.get("item"), id = search.get("itemId");
      setDetailRef(id && (kind === "plan" || kind === "stay") ? {kind, id} : undefined);
      setArrivalOpen(false); setSheet(id && (kind === "plan" || kind === "stay") ? "item-detail" : null);
    };
    restore();
  }, [routeSearch, tripMapEnabled]);
  // Restore the exact item targeted by a saved task link once after hydration.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    const search = new URLSearchParams(window.location.search), travelId = search.get("travelId");
    const plan = travelPlans.find(item => item.id === travelId);
    if (plan) { setTravelKind(plan.kind); setSelectedTravelPlanId(plan.id); setSheet("travel"); }
    else if (search.get("add") === "thing") setSheet("add-plan");
    else if (search.get("add") === "meal") setSheet("add-meal");
    else if (search.get("add") === "stay" && canManageStays) setSheet("add-stay");
    else if (search.get("confirmStay")) {
      // From a poll decision: review the chosen option as the trip's stay. Nothing saves until Save stay.
      const id = search.get("confirmStay");
      if (canManageStays && (state.stays ?? []).some(stay => stay.id === id && stay.status === "considering")) { setConfirmingStayId(id); setSelectedStayId(id); setSheet("edit-stay"); }
      search.delete("confirmStay");
      window.history.replaceState(null, "", `${window.location.pathname}?${search.toString()}`);
    }
    else if (search.get("add") === "flight") { setTravelKind("arrival"); setSelectedTravelPlanId(null); setSheet("add-flight"); }
    else if (search.get("add") === "transport") { setTravelKind("transport"); setSelectedTravelPlanId(""); setSheet("add-rental"); }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => { commandIds.current.clear(); }, [sheet, quickAdd]);
  useEffect(() => { if (tab === "plan" || tab === "logistics") lastPlanSection.current = tab === "logistics" ? "travel" : planSection; }, [tab, planSection]);
  function choosePlanSection(section: PlanSection) {
    if (section === "map") setMapOrigin(tab === "logistics" ? "travel" : visiblePlanSection(planSection) ?? mapOrigin);
    setPlanSection(section); setActiveTab(section === "travel" ? "logistics" : "plan"); setSheet(null);
    window.history.pushState(null, "", planSectionPath(initialSnapshot.commons.id, section));
  }
  function openItem(kind: "plan" | "stay", id: string) {
    setDetailRef({ kind, id }); setSheet("item-detail");
    const url = new URL(window.location.href); url.searchParams.set("item", kind); url.searchParams.set("itemId", id);
    window.history.pushState(null, "", url.pathname + url.search);
  }
  function closeItem() {
    setSheet(null); const url = new URL(window.location.href); url.searchParams.delete("item"); url.searchParams.delete("itemId");
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  /** Shows a saved record where it actually lives in Plan: its section, its day (or No day yet), and its details. */
  function viewReceipt(receipt: PlanReceipt) {
    setPlanReceipt(null);
    if (receipt.day && receipt.kind === "activity") setSelectedDay(receipt.day);
    // The URL drives section, item and details through the same restore path as Back/Forward.
    window.history.pushState(null, "", receipt.href);
  }
  function addActivityPhotos(id: string | null = null) { setPhotoActivityId(id); photoInput.current?.click(); }
  // Each page keeps its reading position for this session; a first visit starts at the top.
  const pageKey = tab === "plan" || tab === "logistics" ? `plan:${tab === "logistics" ? "travel" : visiblePlanSection(planSection) ?? "map"}` : tab;
  const pageScroll = useRef(new Map<string, number>());
  const currentPageKey = useRef(pageKey);
  useEffect(() => {
    let frame = 0;
    const remember = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => pageScroll.current.set(currentPageKey.current, window.scrollY)); };
    window.addEventListener("scroll", remember, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", remember); };
  }, []);
  useLayoutEffect(() => {
    if (currentPageKey.current === pageKey) return;
    currentPageKey.current = pageKey;
    document.getElementById("workspace-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: pageScroll.current.get(pageKey) ?? 0, behavior: "instant" });
  }, [pageKey]);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [startExpenseAsRecorded, setStartExpenseAsRecorded] = useState(false);
  const [expensePlanId, setExpensePlanId] = useState<string | null>(null);
  const [moneyEntryCurrency, setMoneyEntryCurrency] = useState<string | undefined>(undefined);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [selectedMoment, setSelectedMoment] = useState<Moment | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(decisionHandoff?.planId ?? null);
  const [selectedStayId, setSelectedStayId] = useState<string | null>(null);
  const [selectedTravelPlanId, setSelectedTravelPlanId] = useState<string | null>(validTravelExpense?.id ?? null);
  const [planScheduleDate, setPlanScheduleDate] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const [travelKind, setTravelKind] = useState<TravelPlan["kind"]>("arrival");
  const travelPlans = sampleTravelPlans ?? mergeTravelPlans(
    mergeTravelPlans(
      dataMode === "demo" ? publicDemoTravelPlans(commonsSummary, participants) : [],
      travelPlansFromConversation(commonsSummary, state.messages, participants),
    ),
    state.travelPlans ?? [],
  );
  const [activityParticipation, setActivityParticipation] = useState<Record<string, ParticipationChoice>>({
    ...(seededPilot ? initialPilotParticipation : {}),
    ...initialSnapshot.state.participation,
  });
  const [localMoments, setLocalMoments] = useState<Moment[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [coverImage, setCoverImage] = useState<string | null>(
    initialSnapshot.commons.coverImageUrl ?? (seededPilot ? "/moments/cape-beach.jpg" : null),
  );
  const displayedCoverImage = coverImage ?? suggestTripCover({ ...commonsSummary, title: commonsSummary.name })?.src ?? null;
  const [coverStorageReady, setCoverStorageReady] = useState(dataMode !== "demo");
  const [toast, setToast] = useState("");
  // Persistent shell: the last canonical save, with an exact way to see it in Plan. Never set for drafts or failures.
  const [planReceipt, setPlanReceipt] = useState<PlanReceipt | null>(null);
  const commandIds = useRef(new Map<string, { fingerprint: string; id: string }>());

  useEffect(() => {
    trackProductEvent("trip_tab_viewed", {
      commonsSlug: initialSnapshot.commons.slug,
      // role and sample separate organizer, participant and public-sample activity in reports.
      properties: { tab, mode: dataMode, demo: seededPilot, sample: seededPilot, role: initialSnapshot.currentActor.role === "organizer" ? "organizer" : "participant" },
    });
  }, [dataMode, initialSnapshot.commons.slug, initialSnapshot.currentActor.role, seededPilot, tab]);

  useEffect(() => {
    if (dataMode !== "demo") return;
    const saved = window.localStorage.getItem(storageKey);
    const timer = window.setTimeout(() => {
      if (saved) {
        try {
          const restored = CommonsStateSchema.parse(JSON.parse(saved));
          setState(restored);
          setActivityParticipation(restored.participation);
        } catch {
          window.localStorage.removeItem(storageKey);
        }
      }
      setLoadedDemoStorageKey(storageKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dataMode, storageKey]);

  useEffect(() => {
    if (dataMode !== "demo" || loadedDemoStorageKey !== storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(savedState));
  }, [dataMode, loadedDemoStorageKey, savedState, storageKey]);

  useEffect(() => {
    if (dataMode !== "demo") return;
    const savedCover = window.localStorage.getItem(coverStorageKey);
    const timer = window.setTimeout(() => {
      if (savedCover !== null) setCoverImage(savedCover || null);
      setCoverStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [coverStorageKey, dataMode]);

  useEffect(() => {
    if (dataMode !== "demo" || !coverStorageReady) return;
    try {
      window.localStorage.setItem(coverStorageKey, coverImage ?? "");
    } catch {
      // Keep the selected cover for this session if browser storage is full.
    }
  }, [coverImage, coverStorageKey, coverStorageReady, dataMode]);

  useEffect(() => {
    if (dataMode !== "database") return;
    let cancelled = false;

    async function refreshTripState() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/v1/commons/${initialSnapshot.commons.slug}/state`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = await response.json();
        const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
        if (!cancelled) {
          setState(snapshot.state);
          setCommonsSummary(snapshot.commons);
          setParticipants(snapshot.participants);
          setActivityParticipation(snapshot.state.participation);
          setExpenseCompletionByPerson(Object.fromEntries(snapshot.participants.map((participant) => [participant.id, participant.expensesCompleteAt ?? null])));
          setMoneyStatus({
            expensesClosedAt: snapshot.commons.expensesClosedAt ?? null,
            expensesClosedByPersonId: snapshot.commons.expensesClosedByPersonId ?? null,
            expensesClosedByName: snapshot.commons.expensesClosedByName ?? null,
          });
        }
      } catch {
        // Keep the most recent committed state visible when refresh is unavailable.
      }
    }

    const interval = window.setInterval(refreshTripState, 10_000);
    window.addEventListener("focus", refreshTripState);
    window.addEventListener("commons:trip-state-changed", refreshTripState);
    document.addEventListener("visibilitychange", refreshTripState);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshTripState);
      window.removeEventListener("commons:trip-state-changed", refreshTripState);
      document.removeEventListener("visibilitychange", refreshTripState);
    };
  }, [dataMode, initialSnapshot.commons.slug]);

  const closeArrival = useCallback(() => {
    setArrivalOpen(false);
    trackProductEvent("trip_arrival_entered", { commonsSlug: initialSnapshot.commons.slug });
  }, [initialSnapshot.commons.slug]);

  const refreshPeople = useCallback(async () => {
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/state`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setParticipants(CommonsSnapshotSchema.parse(payload.snapshot).participants);
  }, [initialSnapshot.commons.slug]);

  const selectedExpense = state.expenses.find((expense) => expense.id === selectedExpenseId);
  const selectedPayment = state.reimbursements.find((payment) => payment.id === selectedPaymentId);
  const selectedPlan = state.itinerary.find((item) => item.id === selectedPlanId);
  const expensePlan = state.itinerary.find(item => item.id === expensePlanId);
  const expensePlanConversion = expensePlan ? activityExpenseConversion(expensePlan, state.expenses) : undefined;
  const selectedStay = state.stays?.find((stay) => stay.id === selectedStayId);
  const selectedStayExpense = selectedStay ? state.expenses.find((expense) => expense.stayId === selectedStay.id) : undefined;
  const selectedTravelPlan = travelPlans.find((plan) => plan.id === selectedTravelPlanId);
  const currentTravelPlan = (travelKind === "car_rental" || travelKind === "transport")
    ? selectedTravelPlanId === ""
      ? undefined
      : travelPlans.find((plan) => plan.id === selectedTravelPlanId && plan.personId === initialSnapshot.currentActor.id)
        ?? travelPlans.find((plan) => plan.kind === "car_rental" && plan.personId === initialSnapshot.currentActor.id)
    : travelPlans.find((plan) => plan.kind === travelKind && plan.personId === initialSnapshot.currentActor.id);
  const currentTravelExpense = currentTravelPlan ? state.expenses.find((expense) => expense.travelPlanId === currentTravelPlan.id) : undefined;
  const moneyParticipants = participants.map((participant) => ({
    ...participant,
    expensesCompleteAt: expenseCompletionByPerson[participant.id] ?? null,
  }));
  const activeMoneyParticipants = moneyParticipants.filter(
    (participant) => participant.membershipStatus === "active" && participant.accessMode !== "managed",
  );
  const activePlanParticipants = participants.filter((participant) => participant.membershipStatus === "active");
  const expenseHandoffOpened = useRef(false);
  useEffect(() => {
    if (expenseHandoffOpened.current || (dataMode === "demo" && !coverStorageReady)) return;
    const search = new URLSearchParams(window.location.search);
    if (search.get("convertExpense") !== "1" || search.get("item") !== "plan") return;
    expenseHandoffOpened.current = true;
    const item = state.itinerary.find(item => item.id === search.get("itemId"));
    if (item) convertActivityToExpense(item);
    else notify("That activity is no longer available. Open Money to review the saved costs.");
    const url = new URL(window.location.href); url.searchParams.delete("convertExpense");
    // Consuming this handoff changes the URL, not the open expense review.
    lastRouteSearch.current = url.searchParams.toString();
    window.history.replaceState(null, "", url.pathname + url.search);
    // This is a one-time navigation handoff; changes after it must not reopen the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverStorageReady]);
  const ledgerOpen = !moneyStatus.expensesClosedAt && !(activeMoneyParticipants.length && activeMoneyParticipants.every(person => person.expensesCompleteAt));
  function convertActivityToExpense(item: CommonsState["itinerary"][number]) {
    if (!ledgerOpen) { notify("Expenses are closed. Reopen the ledger in Money before recording this cost."); return; }
    const conversion = activityExpenseConversion(item, state.expenses) ?? (item.mealType ? { currency: item.expectedCostCurrency ?? commonsSummary.currency ?? "USD", expenseId: undefined } : undefined);
    if (!conversion) { notify("There is no remaining estimate to convert for this activity."); return; }
    setDetailRef({ kind: "plan", id: item.id });
    setExpensePlanId(item.id);
    setMoneyEntryCurrency(conversion.currency);
    setSelectedStayId(null); setSelectedTravelPlanId(null);
    setStartExpenseAsRecorded(true);
    setSelectedExpenseId(conversion.expenseId ?? null);
    setSheet(conversion.expenseId ? "edit-expense" : "add-expense");
  }
  const canManageTrip = dataMode === "database" && participants.some(person => person.id === initialSnapshot.currentActor.id && person.role === "organizer");
  const previewBasics = dataMode === "demo" && initialSnapshot.commons.id === PUBLIC_DEMO_COMMONS_ID;
  const canEditBasics = canManageTrip || previewBasics;
  const canManageStays = canManageTrip || previewBasics;
  const completedExpenseCount = activeMoneyParticipants.filter((participant) => participant.expensesCompleteAt).length;
  const actorInitials = participants.find((participant) => participant.id === initialSnapshot.currentActor.id)?.initials ?? initialSnapshot.currentActor.displayName.slice(0, 2).toUpperCase();
  const travelEditor = ["travel", "add-flight", "add-rental"].includes(sheet ?? "") ? <TravelPlansSheet defaultCurrency={commonsSummary.currency ?? "USD"} initialIntakeId={travelIntakeId} sampleOnly={previewBasics} key={sheet === "travel" ? `${(travelKind === "car_rental" || travelKind === "transport") ? "rental" : "flights"}:${(travelKind === "car_rental" || travelKind === "transport") ? selectedTravelPlanId ?? "new" : "mine"}` : sheet} commonsSlug={initialSnapshot.commons.slug} kind={travelKind} defaultDate={(travelKind === "departure" ? commonsSummary.endsOn : travelKind === "transport" && tab === "plan" && days.some(day => day.id === selectedDay) ? selectedDay : commonsSummary.startsOn) ?? new Date().toISOString().slice(0, 10)} returnDefaultDate={commonsSummary.endsOn ?? ""} plans={(travelKind === "car_rental" || travelKind === "transport") ? travelPlans.filter((plan) => plan.kind === travelKind) : travelPlans.filter((plan) => (plan.kind === "arrival" || plan.kind === "departure"))} allPlans={travelPlans} participants={participants} currentActorId={initialSnapshot.currentActor.id} currentActorName={initialSnapshot.currentActor.displayName} close={() => setSheet(null)} save={saveTravelPlan} saveBooking={saveFlightBooking} updateSharing={updateTravelPlanSharing} remove={deleteTravelPlan} linkedExpense={currentTravelExpense} recordExpense={currentTravelPlan?.totalCents ? () => { setSelectedTravelPlanId(currentTravelPlan.id); setSheet("add-expense"); } : undefined} openLinkedExpense={currentTravelExpense ? () => { setSelectedExpenseId(currentTravelExpense.id); setTab("money"); setSheet("expense"); } : undefined} confirmationUploadEnabled={dataMode === "database"} selectedRentalPlanId={selectedTravelPlanId ?? currentTravelPlan?.id ?? null} /> : null;
  const basicsEditor = sheet === "edit-trip-details" && canEditBasics ? <TripDetailsEditorSheet experience={canManageTrip && dataMode === "database" ? { slug: initialSnapshot.commons.id, enabled: tripStagesOn } : undefined} inline={false} sampleOnly={previewBasics} commons={commonsSummary} close={() => setSheet(null)} save={saveTripDetails} /> : null;
  const newStayEditor = sheet === "add-stay" && canManageStays ? <StayEditorSheet sampleOnly={previewBasics} commons={commonsSummary} participants={participants} close={() => setSheet(null)} save={addStay} confirmationUploadEnabled={dataMode === "database"} /> : null;
  const existingStayEditor = sheet === "edit-stay" && canManageStays && selectedStay ? <StayEditorSheet sampleOnly={previewBasics} key={selectedStay.id} initialStatus={confirmingStayId === selectedStay.id ? "planned" : undefined} stay={selectedStay} commons={commonsSummary} participants={participants} close={() => { setSelectedStayId(null); setConfirmingStayId(null); setSheet(null); }} save={updateStay} remove={deleteStay} linkedExpense={selectedStayExpense} recordExpense={dataMode === "database" ? () => setSheet("add-expense") : undefined} openLinkedExpense={selectedStayExpense ? () => { setSelectedExpenseId(selectedStayExpense.id); setSelectedStayId(null); setTab("money"); setSheet("expense"); } : undefined} confirmationUploadEnabled={dataMode === "database"} /> : null;
  async function startPhotoUpload(files: File[]) {
    try {
      const photos = await preparePhotoFiles(files);
      if (!photos.length) {
        notify("Choose photos to add.");
        return;
      }
      trackProductEvent("photo_upload_started", {
        commonsSlug: initialSnapshot.commons.slug,
        properties: { count: photos.length, mode: dataMode },
      });
      setPendingPhotos(photos);
      setSheet("photo-mapping");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Photos not added. Try different files.");
    }
  }


  function chooseTripAdd(kind?: LogisticsAddKind) {
    // Bookings are held for "We're going"; the locked page says so, and ideas stay open.
    if (!kind) { setSheet("add-item"); return; }
    // Signed-in trips capture ideas and stay options with quick add; the sample keeps its forms.
    if (kind === "thing") { if (dataMode === "database") { setSheet(null); setQuickAdd("activity"); } else setSheet("add-plan"); }
    else if (kind === "meal") setSheet("add-meal");
    else if (kind === "stay") { if (dataMode === "database" && canManageTrip) { setSheet(null); setQuickAdd("stay"); } else setSheet("add-stay"); }
    else { setTravelKind(kind === "flight" ? "arrival" : "transport"); setSelectedTravelPlanId(kind === "transport" ? "" : null); setSheet(kind === "flight" ? "add-flight" : "add-rental"); }
  }
  // Trip carries polls and the ordinary to-do list.
  const tripHome = {
    openTodo: () => { const panel = document.getElementById("trip-todos"); panel?.scrollIntoView({ block: "start" }); panel?.focus({ preventScroll: true }); },
    tasksPanel: dataMode === "database" ? <><TripTasks showSuggestions={false} slug={initialSnapshot.commons.id} actorId={initialSnapshot.currentActor.id} context={{ people: participants, state: { ...state, travelPlans }, commons: commonsSummary, organizer: canManageTrip, confirmationIntakeEnabled }} onOpenPollResults={id => router.push(`${commonsPath(initialSnapshot.commons.id)}/polls/${id}`)} /></> : undefined,
  };
  const overviewView = () => <HomeView coverImage={displayedCoverImage} {...tripHome} tripLetter={tripLetterEnabled} decidingStage={tripStage === "deciding" && canManageTrip} textMessaging={textMessagingEnabled} addPhotos={() => addActivityPhotos()} openPhotos={() => setTab("moments")} photoCount={state.moments.length + localMoments.length} openItem={id => openItem("plan", id)} canAskGroup={canManageTrip} confirmationIntakeEnabled={confirmationIntakeEnabled} travelUploadAvailable={dataMode === "database"} addReceipt={() => { setMoneyEntryCurrency(undefined); setSelectedStayId(null); setSelectedTravelPlanId(null); setSheet("add-receipt"); }} state={state} commons={commonsSummary} participants={participants} currentActorId={initialSnapshot.currentActor.id} activityParticipation={activityParticipation} copyAddress={copyAddress} openTripDetails={() => { trackProductEvent("trip_details_opened", { commonsSlug: initialSnapshot.commons.slug, properties: { source: "home_stays" } }); openStays(); }} openStay={stayId => openItem("stay", stayId)} addPlan={chooseTripAdd} addTravelPlans={step => {
        openLogistics();
        if(!step || step.reason === "arrival_processing" || !step.target.canEdit)return;
        setTravelIntakeId(step?.intakeId ?? null);setTravelKind("arrival");setSelectedTravelPlanId(step?.target.planId ?? null);setSheet(step?.target.planId ? "travel" : "add-flight");
      }} goToPlan={(date) => { setTab("plan"); setSelectedDay(date ?? defaultDay); }} goToMoney={() => setTab("money")} goToChoiceDay={() => { setTab("plan"); setSelectedDay(seededPilot ? "2027-07-22" : days[1]?.id ?? defaultDay); }} />
;
  const visibleSection = tab === "logistics" ? "travel" : tab === "plan" ? visiblePlanSection(planSection) : null;
  const sectionLink = (section: PlanSection, label: ReactNode, className?: string) => <Link key={section} className={className} href={planSectionPath(initialSnapshot.commons.id, section)}
    aria-current={(section === "map" ? tab === "plan" && planSection === "map" : visibleSection === section) ? "page" : undefined}
    onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); choosePlanSection(section); } }}>{label}</Link>;
  // Two sections; Map shows either one's places and is an action, not a third section.
  const contextNavigation = tab === "plan" || tab === "logistics" ? <div className="plan-sections-bar">
    <nav className="plan-sections" aria-label="Plan sections">{sectionLink("schedule", planTemplateFor(initialSnapshot.commons.templateKey).planSections.activities.label)}{sectionLink("travel", planTemplateFor(initialSnapshot.commons.templateKey).planSections.travel.label)}</nav>
    {tripMapEnabled ? sectionLink("map", <>{tripStage === "deciding" ? <LockIcon /> : <PinIcon />} Map</>, "cm-action plan-map-action") : null}
  </div>
    // Photos is contextual under Trip, with an obvious way back.
    : tab === "moments" && !tripStage ? <p className="context-return"><Link href={commonsViewPath(initialSnapshot.commons.id, "home")} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setTab("home"); } }}><ChevronLeftIcon /> Back to Trip</Link></p>
    : null;
  const view = tab === "home" ? overviewView()
    : tripStage === "deciding" && tab === "money" ? <div className="product-view"><TripBudgetPanel tripId={initialSnapshot.commons.id} destinationName={commonsSummary.locationName ?? undefined} startsOn={commonsSummary.startsOn} endsOn={commonsSummary.endsOn} travelerCount={participants.length} currency={commonsSummary.currency} templateKey={commonsSummary.templateKey} canEdit={canManageTrip} persistent={dataMode === "database"} onSaved={setSavedWorksheet} goingSlot={canManageTrip ? <GoingAction slug={initialSnapshot.commons.id} lead="Ready to go? Track shared expenses, split costs and record repayments." /> : undefined} /></div>
    : tripStage === "deciding" && tab === "moments" ? <StageLockedPage slug={initialSnapshot.commons.id} kind="photos" />
    : tripStage === "deciding" && tab === "plan" && planSection === "map" ? <StageLockedPage slug={initialSnapshot.commons.id} kind="map" />
    : tab === "plan" && planSection === "map" && tripMapEnabled
      ? <TripMapView key={mapOrigin} initialKind={mapOrigin === "travel" ? "stay" : "activity"} commons={commonsSummary} stays={state.stays ?? []} itinerary={state.itinerary}
          transport={travelPlans.filter(plan => plan.kind === "transport" || plan.kind === "car_rental")}
          travelPath={planSectionPath(initialSnapshot.commons.id, "travel")}
          canEditStays={dataMode === "database" && canManageTrip} canEditActivities={dataMode === "database" && participants.some(person => person.id === initialSnapshot.currentActor.id)}
          savePin={savePlacePin} editStay={id => { setSelectedStayId(id); setSheet("edit-stay"); }} honestLocationNotes={betaMapEnabled} openStay={betaMapEnabled ? id => openItem("stay", id) : undefined} openActivity={id => openItem("plan", id)}
          addMenu={<LogisticsAddMenu canAddStay={canManageStays} disabled={Boolean(sheet)} choose={chooseTripAdd} />} />
    : tab === "logistics" || (tab === "plan" && planSection === "stays")
      ? <div className="product-view trip-travel-stays-view">
          <div className="view-intro event-logistics-intro event-page-header"><div><h2>{planTemplateFor(initialSnapshot.commons.templateKey).planSections.travel.label}</h2><p>Where everyone stays and how they get around.</p></div>
            <LogisticsAddMenu canAddStay={canManageStays} disabled={Boolean(sheet)} choose={chooseTripAdd} /></div>
          {contextNavigation}
          <TripStaysView commons={commonsSummary} participants={participants} stays={state.stays ?? []} itinerary={state.itinerary} canEditStays={canManageStays}
          saveNote={saveStayOptionNote}
          canAskGroup={dataMode === "database" && canManageTrip} editorOpen={Boolean(sheet)}
          editStay={id => { setSelectedStayId(id); setSheet("edit-stay"); }} openStay={id => openItem("stay", id)}
          addOption={() => setQuickAdd("stay")} copyAddress={copyAddress} mapPath={tripMapEnabled ? planSectionPath(initialSnapshot.commons.id, "map") : undefined} />
          <TripTravelView commons={commonsSummary} participants={participants} travelPlans={travelPlans} actorId={initialSnapshot.currentActor.id}
          canAskGroup={dataMode === "database" && canManageTrip} editorOpen={Boolean(sheet)} choose={chooseTripAdd}
          editTravel={plan => { setTravelKind(plan.kind); setSelectedTravelPlanId(plan.id); setSheet("travel"); }} />
        </div>
    : tab === "plan"
      ? <>{tripStage === "deciding" ? <PlanStageBanner slug={initialSnapshot.commons.id} /> : null}<PlanView sectionNavigation={contextNavigation} section={planSection === "map" || planSection === "stays" ? "schedule" : planSection} openItem={id => openItem("plan", id)} canSchedule={canManageTrip || previewBasics} state={{...state, moments: [...state.moments, ...localMoments]}} commons={commonsSummary} days={days} seededPilot={seededPilot} selectedDay={selectedDay} setSelectedDay={setSelectedDay} activityParticipation={activityParticipation} respondToActivity={respondToActivity} openMoments={() => setTab("moments")} travelPlans={travelPlans} openTravelPlans={(kind) => { setTravelKind(kind); setSheet("travel"); }} participantCount={participants.length} participants={participants} addPlan={chooseTripAdd} editPlan={(itemId) => { setPlanScheduleDate(null); setSelectedPlanId(itemId); setSheet("edit-plan"); }} scheduleIdea={(itemId, day) => { setPlanScheduleDate(day); setSelectedPlanId(itemId); setSheet("edit-plan"); }} canEditPlan openStay={stayId => openItem("stay", stayId)} openTripDetails={() => { trackProductEvent("trip_details_opened", { commonsSlug: initialSnapshot.commons.slug, properties: { source: "plan" } }); openLogistics(); }} askHref={tripStage === "deciding" || !canManageTrip ? undefined : `${commonsPath(initialSnapshot.commons.id)}/polls/new`} askGroupPath={dataMode === "database" && canManageTrip ? ids => `${commonsPath(initialSnapshot.commons.id)}/polls/new?activityIds=${ids.map(encodeURIComponent).join(",")}` : undefined} /></>
      : tab === "money"
        ? <><MoneyView budgetEditor={targetControl => <TripBudgetPanel targetControl={targetControl} embedded tripId={initialSnapshot.commons.id} destinationName={commonsSummary.locationName ?? undefined} startsOn={commonsSummary.startsOn} endsOn={commonsSummary.endsOn} travelerCount={participants.length} currency={commonsSummary.currency} templateKey={commonsSummary.templateKey} canEdit={canManageTrip} persistent={dataMode === "database"} onSaved={setSavedWorksheet} />} worksheet={savedWorksheet} openItem={openItem} state={state} commons={commonsSummary} participants={activeMoneyParticipants} tripStarted={tripStarted} postTrip={postTrip} currentActorId={initialSnapshot.currentActor.id} openExpense={(expenseId) => { setStartExpenseAsRecorded(false); setSelectedExpenseId(expenseId); setSheet("expense"); }} openPayment={(paymentId) => { setSelectedPaymentId(paymentId); setSheet("payment"); }} addExpense={(currency) => { setMoneyEntryCurrency(currency); setSelectedStayId(null); setSelectedTravelPlanId(null); setSheet("add-expense"); }} openMoneySettings={canManageTrip ? () => setSheet("money-settings") : undefined} recordPayment={(currency) => { setMoneyEntryCurrency(currency); setSheet("add-payment"); }} markExpensesComplete={markExpensesComplete} closeExpenses={() => setSheet("close-expenses")} reopenExpenses={() => setSheet("reopen-expenses")} expensesClosedAt={moneyStatus.expensesClosedAt} expensesClosedByName={moneyStatus.expensesClosedByName} saveTargetBudget={saveTargetBudget} />

          {betaCompletion && dataMode === "database" && (betaCompletion.paymentReports || betaCompletion.closure || betaCompletion.recap || betaCompletion.successor)
            ? <BetaMoneyWrapUp slug={initialSnapshot.commons.slug} currentActorId={initialSnapshot.currentActor.id} isOrganizer={canManageTrip} participants={activeMoneyParticipants}
                state={state} moments={state.moments.map(moment => ({ id: moment.id, caption: moment.caption }))} defaultCurrency={commonsSummary.currency ?? "USD"}
                balancesDisabled={commonsSummary.balancesDisabled ?? false} ledgerClosed={!ledgerOpen} endsOn={commonsSummary.endsOn} features={betaCompletion} onState={setState} />
            : null}</>
        : <MomentsView notify={notify} localMoments={localMoments} startPhotoUpload={files => { setPhotoActivityId(null); void startPhotoUpload(files); }} openMoment={(moment) => { setSelectedMoment(moment); setSheet("moment"); }} moveMoment={moveMomentToDay} commonsSlug={initialSnapshot.commons.slug} days={tripDays(commonsSummary.startsOn, commonsSummary.endsOn)} moments={state.moments} timeZone={commonsSummary.timezone} />;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3400);
  }

  function applyMoneySnapshot(snapshot: CommonsSnapshot) {
    setState(snapshot.state);
    setCommonsSummary(snapshot.commons);
    setExpenseCompletionByPerson(Object.fromEntries(snapshot.participants.map((participant) => [participant.id, participant.expensesCompleteAt ?? null])));
    setMoneyStatus({
      expensesClosedAt: snapshot.commons.expensesClosedAt ?? null,
      expensesClosedByPersonId: snapshot.commons.expensesClosedByPersonId ?? null,
      expensesClosedByName: snapshot.commons.expensesClosedByName ?? null,
    });
  }

  async function copyAddress(address: string, label = "Address") {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = address;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.append(textArea);
        textArea.select();
        const copied = document.execCommand("copy");
        textArea.remove();
        if (!copied) throw new Error("Copy unavailable");
      }
      notify(`${label} copied.`);
    } catch {
      notify(`Couldn’t copy the ${label.toLowerCase()}.`);
    }
  }


  function closePhotoMapping() {
    setPendingPhotos([]);
    setSheet(null);
  }

  async function persistNewMoment(moment: Moment, sourcePhoto?: Blob) {
    if (dataMode === "demo") {
      setLocalMoments((current) => [...current, moment]);
      trackProductEvent("photo_added", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: dataMode } });
      return moment;
    }
    let blob: Blob;
    if (sourcePhoto) {
      blob = sourcePhoto;
    } else {
      const assetResponse = await fetch(moment.assetUrl);
      blob = await assetResponse.blob();
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type)) {
      throw new Error("Choose a JPG, PNG, or WebP photo.");
    }
    if (blob.size > 50 * 1024 * 1024) {
      throw new Error("This photo is over 50 MB. Choose a smaller copy and try again.");
    }

    const id = crypto.randomUUID();
    const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
    const storagePath = `${initialSnapshot.commons.slug}/${id}.${extension}`;
    // Without Supabase (local development) there is no storage client; cleanup of a half-added photo is skipped.
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? getSupabaseBrowserClient() : null;
    await uploadCommonsPhoto(storagePath, blob);

    let response: Response;
    try {
      response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/moments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            id,
            storagePath,
            mimeType: blob.type,
            caption: moment.caption,
            altText: moment.altText,
            occurredAt: moment.occurredAt,
            dateStatus: moment.dateStatus ?? "confirmed",
            itineraryItemId: moment.itineraryItemId ?? null,
            eventMatchSource: moment.eventMatch?.source ?? null,
            eventMatchConfidence: moment.eventMatch?.confidence ?? null,
            eventMatchReason: moment.eventMatch?.reason ?? null,
          }),
        },
      );
    } catch {
      await supabase?.storage.from("commons-moments").remove([storagePath]);
      throw new Error("Photo not added. Your other photos are still here. Try again.");
    }

    const responseText = await response.text();
    let payload: { error?: string; snapshot?: unknown; momentId?: string } | null = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      await supabase?.storage.from("commons-moments").remove([storagePath]);
      throw new Error(payload?.error ?? "Photo not added. Your other photos are still here. Try again.");
    }
    if (!payload?.snapshot || !payload.momentId) {
      throw new Error("Photo was added but could not be loaded. Refresh the page.");
    }
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    const savedMoment = snapshot.state.moments.find((entry) => entry.id === payload.momentId);
    if (!savedMoment) throw new Error("Photo was uploaded but could not be loaded. Refresh the page.");
    setState(snapshot.state);
    setCoverImage(snapshot.commons.coverImageUrl);
    trackProductEvent("photo_added", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: dataMode } });
    return savedMoment;
  }

  async function useUploadedCover(file: File) {
    await persistCover(file, null);
  }

  async function saveCover(moment: Moment) {
    if (dataMode === "demo") {
      setCoverImage(moment.assetUrl);
      return;
    }
    const assetResponse = await fetch(moment.assetUrl);
    if (!assetResponse.ok) throw new Error("That trip photo could not be loaded. Try again.");
    await persistCover(await assetResponse.blob(), moment.id);
  }

  async function persistCover(photo: Blob, sourceMomentId: string | null) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) throw new Error("Choose a JPG, PNG, or WebP cover photo.");
    if (photo.size > 50 * 1024 * 1024) throw new Error("The cover photo is over 50 MB. Choose a smaller copy.");
    if (dataMode === "demo") {
      setCoverImage(URL.createObjectURL(photo));
      return;
    }
    const id = crypto.randomUUID();
    const card = await createCoverCardImage(photo);
    const paths = await uploadCommonsCover(initialSnapshot.commons.slug, id, photo, card);
    let response: Response;
    try {
      response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/cover`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), ...paths, mimeType: photo.type, sourceMomentId }),
        },
      );
    } catch {
      throw new Error("Couldn’t confirm the cover update. Refresh the trip before trying again.");
    }
    const payload = await response.json().catch(() => null) as { error?: string; snapshot?: unknown } | null;
    if (!response.ok) {
      await getSupabaseBrowserClient().storage.from("commons-moments").remove([paths.originalStoragePath, paths.cardStoragePath]);
      throw new Error(payload?.error ?? "Cover not updated. Try again.");
    }
    const snapshot = CommonsSnapshotSchema.parse(payload?.snapshot);
    setCommonsSummary(snapshot.commons);
    setState(snapshot.state);
    setCoverImage(snapshot.commons.coverImageUrl);
  }

  async function saveTripDetails(input: TripDetailsInput) {
    if (dataMode === "demo") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      // Sample review only: no shared-state command, analytics, or persistent write.
      setCommonsSummary(previous => ({ ...previous, name: input.title, timezone: input.timezone ?? previous.timezone, startsOn: input.startsOn, endsOn: input.endsOn, locationName: input.locationName, locationNames: input.locationNames, balancesDisabled: input.balancesDisabled, currency: input.currency }));
      if (!tripDays(input.startsOn, input.endsOn).some(day => day.id === selectedDay)) {
        setSelectedDay(tripDays(input.startsOn, input.endsOn)[0]?.id ?? "");
      }
      setSheet(null);
      notify("Sample updated. Changes reset when you reload.");
      return;
    }
    const response = await fetch(
      `/api/v1/commons/${initialSnapshot.commons.slug}/details`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), ...input, currency: input.currency !== (commonsSummary.currency ?? "USD") ? input.currency : undefined, expectedCurrency: commonsSummary.currency ?? "USD" }),
      },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Trip details not updated. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setCommonsSummary(snapshot.commons);
    setState(snapshot.state);
    if (!selectedDay || !tripDays(snapshot.commons.startsOn, snapshot.commons.endsOn).some((day) => day.id === selectedDay)) {
      setSelectedDay(tripDays(snapshot.commons.startsOn, snapshot.commons.endsOn)[0]?.id ?? "");
    }
    setSheet(null);
    trackProductEvent("trip_details_updated", { commonsSlug: initialSnapshot.commons.slug });
    notify("Trip details updated.");
  }

  async function saveMoneySettings(balancesDisabled: boolean, currency: string) {
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/money-settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            currency,
            expectedCurrency: commonsSummary.currency ?? "USD",
            expectedBalancesDisabled: commonsSummary.balancesDisabled ?? false,
            balancesDisabled,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Money settings not updated. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setCommonsSummary(snapshot.commons);
      setState(snapshot.state);
    } else {
      setCommonsSummary((current) => ({ ...current, balancesDisabled, currency }));
    }
    setMoneyEntryCurrency(undefined);
    setSheet(null);
    trackProductEvent("money_settings_updated", { commonsSlug: initialSnapshot.commons.slug, properties: { balancesDisabled, mode: dataMode } });
    notify(`Money settings saved. New costs default to ${currency}.`);
  }

  async function savePlacePin(kind: "stay" | "activity", id: string, pin: import("@commons/contracts").PlacePin | null) {
    if (dataMode === "demo") throw new Error("This sample cannot be edited.");
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/places/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), kind, id, pin }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Location not saved. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setState(snapshot.state);
  }

  async function lookUpPlaceLink(url: string) {
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/links/preview`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    const payload = await response.json() as { preview?: unknown; error?: string };
    if (!response.ok || !payload.preview) throw new Error(payload.error ?? "That link couldn’t be read.");
    return LinkPreviewSchema.parse(payload.preview);
  }

  async function readPlaceFile(file: File) {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/links/file`, { method: "POST", body: form });
    const payload = await response.json() as { hints?: { title: string | null; url: string | null; readable: boolean }; error?: string };
    if (!response.ok || !payload.hints) throw new Error(payload.error ?? "That file couldn’t be read. Add the name instead.");
    return payload.hints;
  }

  /** One activity idea (no day or time) or one stay option (considering).
   * The command id belongs to the open sheet, so a retry cannot add it twice. */
  async function quickAddPlace(kind: "activity" | "stay", input: QuickAddInput) {
    const pin = input.pin ? { latitude: input.pin.latitude, longitude: input.pin.longitude, precision: "exact" as const, source: input.pin.source } : undefined;
    const body = kind === "activity"
      ? { commandId: input.commandId, title: input.name, date: null, time: null, status: "idea", location: input.address || undefined,
        participantScope: "everyone", expectedParticipantIds: [], sourceUrl: input.url, pin, occurredAt: new Date().toISOString() }
      : { commandId: input.commandId, name: input.name, address: input.address, startsOn: input.startsOn, endsOn: input.endsOn,
        status: "considering", includedPersonIds: participants.map(person => person.id), bookingUrl: input.url, pollId: null,
        confirmationCode: null, details: null, pin };
    const before = new Set(kind === "activity" ? state.itinerary.map(item => item.id) : (state.stays ?? []).map(stay => stay.id));
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/${kind === "activity" ? "itinerary" : "stays"}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Not added. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setCommonsSummary(snapshot.commons);
    setState(snapshot.state);
    trackProductEvent(kind === "activity" ? "plan_added" : "stay_added", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: "quick_add" } });
    if (kind === "activity") {
      const added = addedRecord(before, snapshot.state.itinerary, item => sameText(item.title, input.name));
      if (added) setPlanReceipt(activityReceipt(initialSnapshot.commons.id, added, commonsSummary.timezone));
      return added?.id ?? null;
    }
    const added = addedRecord(before, snapshot.state.stays ?? [], stay => sameText(stay.name, input.name));
    if (added) setPlanReceipt(stayReceipt(initialSnapshot.commons.id, added));
    return added?.id ?? null;
  }

  /** Notes on an option being considered. Sends the option's saved fields
   * unchanged; booked stays keep their private details in the full editor. */
  async function saveStayOptionNote(stay: Stay, note: string) {
    if (dataMode !== "database" || stay.status !== "considering") throw new Error("Edit this stay to change its notes.");
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/stays/${stay.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), name: stay.name, address: stay.address, startsOn: stay.startsOn, endsOn: stay.endsOn,
        timezone: stay.timezone ?? null, checkInTime: stay.checkInTime ?? null, checkOutTime: stay.checkOutTime ?? null, status: stay.status,
        includedPersonIds: stay.includedPersonIds, bookingUrl: stay.bookingUrl ?? null, pollId: stay.pollId ?? null, confirmationCode: stay.confirmationCode ?? null,
        totalCents: stay.totalCents ?? null, roomPriceCents: stay.roomPriceCents ?? null, roomCount: stay.roomCount ?? null,
        currency: stay.currency ?? commonsSummary.currency ?? "USD", costSource: stay.costSource ?? null,
        includesTaxesAndFees: stay.includesTaxesAndFees ?? null, details: note || null }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Note not saved. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setState(snapshot.state);
  }

  async function addStay(input: StayInput) {
    if (dataMode === "demo") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      const added = StaySchema.parse({ ...Object.fromEntries(Object.entries(input).filter(([, value]) => value != null)), id: crypto.randomUUID(), sourceLabel: `Sample stay · added by ${initialSnapshot.currentActor.displayName}` });
      setSampleStays(appendPublicDemoStay(commonsSummary, participants, state.stays ?? [], added));
      setCommonsSummary(current => ({ ...current, lodging: undefined }));
      setSheet(null);
      notify("Sample stay added. Changes reset when you reload.");
      return;
    }
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/stays`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: stableCommandId(commandIds.current, "add-stay", input), ...input }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Stay not added. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    const addedStay = addedRecord(new Set((state.stays ?? []).map(stay => stay.id)), snapshot.state.stays ?? [], stay => sameText(stay.name, input.name));
    setCommonsSummary(snapshot.commons);
    setState(snapshot.state);
    if (addedStay) setPlanReceipt(stayReceipt(initialSnapshot.commons.id, addedStay));
    afterStaySave();
    trackProductEvent("stay_added", { commonsSlug: initialSnapshot.commons.slug, properties: { status: input.status } });
    notify(`${input.name} added.`);
  }

  async function updateStay(input: StayInput) {
    if (!selectedStay) throw new Error("That stay is no longer available.");
    if (dataMode === "demo") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      const updated = StaySchema.parse({ ...Object.fromEntries(Object.entries(input).filter(([, value]) => value != null)), id: selectedStay.id, sourceLabel: selectedStay.sourceLabel });
      setSampleStays((state.stays ?? []).map(stay => stay.id === selectedStay.id ? updated : stay));
      setSelectedStayId(null);
      setSheet(null);
      notify("Sample stay updated. Changes reset when you reload.");
      return;
    }
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/stays/${selectedStay.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), ...input }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Stay not updated. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setCommonsSummary(snapshot.commons);
    setState(snapshot.state);
    setSelectedStayId(null);
    setConfirmingStayId(null);
    afterStaySave();
    trackProductEvent("stay_updated", { commonsSlug: initialSnapshot.commons.slug, properties: { status: input.status } });
    notify(`${input.name} updated.`);
  }

  async function deleteStay() {
    if (!selectedStay) throw new Error("That stay is no longer available.");
    if (dataMode === "demo") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      setSampleStays((state.stays ?? []).filter(stay => stay.id !== selectedStay.id));
      setSelectedStayId(null);
      setSheet(null);
      notify("Sample stay removed. Changes reset when you reload.");
      return;
    }
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/stays/${selectedStay.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID() }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Stay not removed. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setCommonsSummary(snapshot.commons);
    setState(snapshot.state);
    setSelectedStayId(null);
    openLogistics();
    trackProductEvent("stay_removed", { commonsSlug: initialSnapshot.commons.slug });
    notify(`${selectedStay.name} removed.`);
  }

  async function persistMomentDetails(
    moment: Moment,
    caption: string,
    itineraryItemId: string | null,
    occurredOn: string | null,
  ) {
    const item = itineraryItemId
      ? state.itinerary.find((entry) => entry.id === itineraryItemId)
      : undefined;
    const updatedMoment: Moment = {
      ...moment,
      caption: caption.trim(),
      occurredAt: item?.startsAt ?? (occurredOn
        ? localDateTimeToIso(occurredOn, "12:00", initialSnapshot.commons.timezone)
        : moment.occurredAt),
      dateStatus: item || occurredOn ? "confirmed" : "unconfirmed",
      itineraryItemId: item?.id,
      itineraryItemTitle: item?.title,
      eventMatch: item ? {
        source: "manual",
        confidence: 100,
        reason: `Linked by ${initialSnapshot.currentActor.displayName}`,
      } : undefined,
    };
    const isLocal = localMoments.some((entry) => entry.id === moment.id);

    if (isLocal) {
      setLocalMoments((current) => current.map((entry) => entry.id === updatedMoment.id ? updatedMoment : entry));
    } else if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/moments/${moment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            caption: updatedMoment.caption,
            occurredOn,
            itineraryItemId,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Photo not updated. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      const savedMoment = snapshot.state.moments.find((entry) => entry.id === moment.id);
      setState(snapshot.state);
      setCoverImage(snapshot.commons.coverImageUrl);
      if (selectedMoment?.id === moment.id) setSelectedMoment(savedMoment ?? null);
      return savedMoment ?? updatedMoment;
    } else {
      setState((current) => ({
        ...current,
        moments: current.moments.map((entry) => entry.id === updatedMoment.id ? updatedMoment : entry),
      }));
    }
    if (selectedMoment?.id === moment.id) setSelectedMoment(updatedMoment);
    return updatedMoment;
  }

  async function updateMoment(caption: string, itineraryItemId: string | null, occurredOn: string | null) {
    if (!selectedMoment) return;
    await persistMomentDetails(selectedMoment, caption, itineraryItemId, occurredOn);
    setSheet("moment");
    notify("Photo updated.");
  }

  async function moveMomentToDay(moment: Moment, day: string) {
    const linkedItem = moment.itineraryItemId
      ? state.itinerary.find((item) => item.id === moment.itineraryItemId)
      : undefined;
    const itineraryItemId = linkedItem?.startsAt && day !== "unsorted" && localDateKey(linkedItem.startsAt, initialSnapshot.commons.timezone) === day
      ? linkedItem.id
      : null;
    await persistMomentDetails(
      moment,
      moment.caption,
      itineraryItemId,
      day === "unsorted" ? null : day,
    );
    notify(day === "unsorted" ? "Photo moved to Unsorted." : `Photo moved to ${formatDayHeading(day)}.`);
  }

  async function deleteMoment() {
    if (!selectedMoment) return;
    const moment = selectedMoment;
    const isLocal = localMoments.some((entry) => entry.id === moment.id);

    if (isLocal) {
      setLocalMoments((current) => current.filter((entry) => entry.id !== moment.id));
      if (coverImage === moment.assetUrl) setCoverImage(null);
    } else if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/moments/${moment.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Photo not deleted. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      applyMoneySnapshot(snapshot);
      setCoverImage(snapshot.commons.coverImageUrl);
    } else {
      setState((current) => ({
        ...current,
        moments: current.moments.filter((entry) => entry.id !== moment.id),
      }));
      if (coverImage === moment.assetUrl) setCoverImage(null);
    }
    setSelectedMoment(null);
    setSheet(null);
    notify("Photo deleted.");
  }

  async function respondToActivity(itemId: string, response: ParticipationChoice) {
    const item = state.itinerary.find((entry) => entry.id === itemId);
    if (dataMode === "database") {
      const request = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/itinerary/${itemId}/participation`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            response,
            occurredAt: new Date().toISOString(),
          }),
        },
      );
      const payload = await request.json();
      if (!request.ok) {
        notify(payload.error ?? "Response not saved. Try again.");
        return;
      }
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
      setActivityParticipation(snapshot.state.participation);
      notify(response === "in" ? `You’re in for ${item?.title ?? "this activity"}.` : response === "maybe" ? `Marked maybe for ${item?.title ?? "this activity"}.` : `Marked skip for ${item?.title ?? "this activity"}.`);
      return;
    }
    const actorId = initialSnapshot.currentActor.id;
    const actorFirstName = initialSnapshot.currentActor.displayName.split(" ")[0];
    const commandId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    setActivityParticipation((current) => {
      const next = { ...current, [itemId]: response };
      if (response === "in" && item) {
        state.itinerary.forEach((entry) => {
          if (entry.id !== itemId && entry.startsAt === item.startsAt) next[entry.id] = "skip";
        });
      }
      return next;
    });
    if (item) {
      setState((current) => {
        const participation = { ...current.participation, [itemId]: response };
        if (response === "in") {
          current.itinerary.forEach((entry) => {
            if (entry.id !== itemId && entry.startsAt === item.startsAt) participation[entry.id] = "skip";
          });
        }
        return {
          ...current,
          participation,
          itinerary: current.itinerary.map((entry) => {
            const sameTime = entry.startsAt === item.startsAt;
            const participantIds = entry.participantIds ?? [];
            const actorWasGoing = participantIds.includes(actorId);
            const actorIsJoining = entry.id === itemId && response === "in";
            if (!sameTime && entry.id !== itemId) return entry;
            if (actorIsJoining) {
              return {
                ...entry,
                participantIds: [actorId, ...participantIds.filter((personId) => personId !== actorId)],
                respondedParticipantIds: [actorId, ...(entry.respondedParticipantIds ?? participantIds).filter((personId) => personId !== actorId)],
                expectedParticipantIds: [actorId, ...(entry.expectedParticipantIds ?? []).filter((personId) => personId !== actorId)],
                provenanceLabel: `${actorFirstName} joined in Commons`,
              };
            }
            if (entry.id === itemId) {
              return {
                ...entry,
                participantIds: participantIds.filter((personId) => personId !== actorId),
                expectedParticipantIds: response === "maybe"
                  ? [actorId, ...(entry.expectedParticipantIds ?? []).filter((personId) => personId !== actorId)]
                  : (entry.expectedParticipantIds ?? []).filter((personId) => personId !== actorId),
                respondedParticipantIds: response === "maybe" ? [actorId, ...(entry.respondedParticipantIds ?? participantIds).filter((id) => id !== actorId)] : (entry.respondedParticipantIds ?? participantIds).filter((id) => id !== actorId),
                provenanceLabel: response === "maybe"
                  ? `${actorFirstName} marked maybe in Commons`
                  : `${actorFirstName} skipped in Commons`,
              };
            }
            if (response === "in" && actorWasGoing) {
              return {
                ...entry,
                participantIds: participantIds.filter((personId) => personId !== actorId),
                expectedParticipantIds: (entry.expectedParticipantIds ?? []).filter((personId) => personId !== actorId),
                provenanceLabel: `${actorFirstName} moved to ${item.title}`,
                respondedParticipantIds: (entry.respondedParticipantIds ?? participantIds).filter((id) => id !== actorId),
              };
            }
            return entry;
          }),
          auditEvents: [...current.auditEvents, {
            id: crypto.randomUUID(),
            commandId,
            actorId,
            action: "participation.updated",
            targetId: itemId,
            occurredAt,
            summary: `${initialSnapshot.currentActor.displayName} responded ${response} to ${item.title}`,
          }],
          processedCommandIds: [...current.processedCommandIds, commandId],
        };
      });
    }
    notify(response === "in" ? `You’re in for ${item?.title ?? "this activity"}.` : response === "maybe" ? `Marked maybe for ${item?.title ?? "this activity"}.` : `Marked skip for ${item?.title ?? "this activity"}.`);
  }

  async function saveTargetBudget(amountCents: number | null, currency: string) {
    if (dataMode === "demo") {
      setState((current) => ({ ...current, targetBudgetCents: amountCents ?? undefined, targetBudgetCurrency: currency }));
      return;
    }
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/target-budget`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), amountCents, currency }),
    });
    const payload = await response.json() as { snapshot?: CommonsSnapshot; error?: string };
    if (!response.ok || !payload.snapshot) {
      notify(payload.error ?? "Target budget not saved. Try again.");
      throw new Error(payload.error ?? "Target budget not saved.");
    }
    applyMoneySnapshot(payload.snapshot);
    notify(amountCents === null ? "Target budget removed." : "Target budget saved.");
  }

  async function saveTravelPlan(input: { kind: TravelPlan["kind"]; travelPlanId: string | null; date: string; route: string; time: string | null; note: string; companionPersonId: string; includedPersonIds: string[]; driverPersonId: string | null; provider: string; vehicle: string; returnDate: string | null; returnTime: string | null; status: "considering" | "booked" | "confirmed"; confirmationCode: string; totalCents: number | null; currency?: string; confirmationDocument?: ConfirmationDocumentInput }) {
    const kind = input.kind;
    const companions = participants.filter((participant) => input.includedPersonIds.includes(participant.id));
    const companionConflict = companions.find((companion) => travelPlans.some((plan) => {
      if (plan.kind !== kind) return false;
      if (plan.personId === initialSnapshot.currentActor.id) return false;
      const personIds = plan.personIds ?? [plan.personId];
      return personIds.includes(companion.id);
    }));
    if (companionConflict && (kind === "arrival" || kind === "departure")) {
      throw new Error(`${companionConflict.displayName.split(" ")[0]} already has a ${kind} plan. Ask them to update it first.`);
    }
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/travel-plans`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: stableCommandId(commandIds.current, `travel:${kind}:${input.travelPlanId ?? "new"}`, input),
            travelPlanId: input.travelPlanId,
            kind,
            date: input.date,
            route: input.route,
            time: input.time,
            note: input.note,
            companionPersonId: input.companionPersonId || null,
            includedPersonIds: input.includedPersonIds,
            driverPersonId: input.driverPersonId,
            provider: input.provider || null,
            vehicle: input.vehicle || null,
            returnDate: input.returnDate,
            returnTime: input.returnTime,
            status: input.status,
            confirmationCode: input.confirmationCode || null,
            totalCents: input.totalCents,
            currency: input.currency ?? "USD",
            confirmationDocument: input.confirmationDocument,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Travel plan not saved. Try again.");
      }
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      const addedTravel = input.travelPlanId ? null : addedRecord(new Set((state.travelPlans ?? []).map(plan => plan.id)), snapshot.state.travelPlans ?? [], plan => plan.kind === kind && plan.date === input.date && sameText(plan.route, input.route));
      setState(snapshot.state);
      if (addedTravel) setPlanReceipt(travelReceipt(initialSnapshot.commons.id, addedTravel));
      if (kind === "car_rental") {
        const ownedRentals = snapshot.state.travelPlans?.filter((plan) => plan.kind === "car_rental" && plan.personId === initialSnapshot.currentActor.id) ?? [];
        const savedRental = ownedRentals.find((plan) => plan.id === input.travelPlanId)
          ?? ownedRentals.filter((plan) => plan.date === input.date && plan.route === input.route).at(-1);
        if (savedRental) setSelectedTravelPlanId(savedRental.id);
      }
    } else {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      const existing = travelPlans.find(plan => plan.id === input.travelPlanId && plan.personId === initialSnapshot.currentActor.id);
      const saved = TravelPlanSchema.parse({
        id: existing?.id ?? crypto.randomUUID(), personId: initialSnapshot.currentActor.id,
        personIds: input.includedPersonIds, personName: companions.map(person => person.displayName).join(" + "),
        kind, date: input.date, route: input.route, time: input.time || undefined, note: input.note,
        provider: input.provider || undefined, vehicle: input.vehicle || undefined,
        driverPersonId: input.driverPersonId || undefined, driverName: participants.find(person => person.id === input.driverPersonId)?.displayName,
        returnDate: input.returnDate || undefined, returnTime: input.returnTime || undefined, status: input.status,
        confirmationCode: input.confirmationCode || undefined, totalCents: input.totalCents ?? undefined, currency: input.currency ?? "USD",
        visibility: existing?.visibility ?? (input.kind === "transport" ? "basic" : "private"), sourceLabel: `Sample travel · added by ${initialSnapshot.currentActor.displayName}`,
      });
      setSampleTravelPlans(mergeTravelPlans(travelPlans, [saved]));
      if (kind === "car_rental") setSelectedTravelPlanId(saved.id);
      notify("Sample travel saved. Changes reset when you reload.");
      return;
    }
    notify(input.kind === "transport" ? "Transport saved as shared trip details." : "Travel plan saved.");
  }

  async function saveFlightBooking(input: { legs: FlightLegReview[]; expectedPlanVersions?: Array<{ id: string; version: string }>; removeLegKinds: Array<"arrival" | "departure">; includedPersonIds: string[]; note: string; confirmationCode: string; totalCents: number | null; currency?: string; confirmationDocument?: ConfirmationDocumentInput }) {
    if (dataMode !== "database") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      if (travelPlans.some(plan => plan.personId !== initialSnapshot.currentActor.id && input.legs.some(leg => leg.kind === plan.kind) && (plan.personIds ?? [plan.personId]).some(id => input.includedPersonIds.includes(id)))) throw new Error("One of these travelers already has a flight plan. Ask its owner to update it first.");
      const saved = input.legs.map((leg, index) => {
        const existing = travelPlans.find(plan => plan.personId === initialSnapshot.currentActor.id && plan.kind === leg.kind);
        return TravelPlanSchema.parse({
          ...leg, id: existing?.id ?? crypto.randomUUID(), time: leg.time || undefined,
          personId: initialSnapshot.currentActor.id, personIds: input.includedPersonIds,
          personName: participants.filter(person => input.includedPersonIds.includes(person.id)).map(person => person.displayName).join(" + "),
          note: input.note, confirmationCode: input.confirmationCode || undefined,
          totalCents: index === 0 ? input.totalCents ?? undefined : undefined, currency: input.currency ?? "USD",
          visibility: existing?.visibility ?? "basic", sourceLabel: `Sample flight · added by ${initialSnapshot.currentActor.displayName}`,
        });
      });
      const retained = travelPlans.filter(plan => plan.personId !== initialSnapshot.currentActor.id || (plan.kind === "car_rental" || plan.kind === "transport") || !input.removeLegKinds.includes(plan.kind));
      const updated = mergeTravelPlans(retained, saved);
      setSampleTravelPlans(updated);
      notify("Sample flights saved. Changes reset when you reload.");
      return updated;
    }
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/travel-plans`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), ...input, confirmationCode: input.confirmationCode || null, currency: input.currency ?? "USD" }),
    });
    const payload = await response.json() as { snapshot?: CommonsSnapshot; error?: string };
    if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Flight booking not saved. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setState(snapshot.state);
    notify(input.legs.length === 2 ? "Round-trip flight booking saved." : "Flight booking saved.");
    return snapshot.state.travelPlans;
  }

  async function updateTravelPlanSharing(travelPlanId: string, visibility: "private" | "basic" | "all", expectedVersion?: string) {
    if (dataMode !== "database") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      const updated = travelPlans.map(plan => plan.id === travelPlanId && plan.personId === initialSnapshot.currentActor.id ? { ...plan, visibility } : plan);
      setSampleTravelPlans(updated);
      notify("Sample sharing updated. Changes reset when you reload.");
      return updated;
    }
    const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/travel-plans`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), travelPlanId, visibility, expectedVersion }),
    });
    const payload = await response.json() as { snapshot?: CommonsSnapshot; error?: string };
    if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Sharing not changed. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    setState(snapshot.state);
    notify(visibility === "private" ? "Travel plan is private again." : visibility === "basic" ? "Basic travel info shared." : "Travel info and cost shared.");
    return snapshot.state.travelPlans;
  }

  async function deleteTravelPlan(travelPlanId: string) {
    if (dataMode !== "database") {
      if (!previewBasics) throw new Error("This sample cannot be edited.");
      setSampleTravelPlans(travelPlans.filter(plan => plan.id !== travelPlanId || plan.personId !== initialSnapshot.currentActor.id));
    } else {
      const response = await fetch(`/api/v1/commons/${initialSnapshot.commons.slug}/travel-plans`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), travelPlanId }),
      });
      const payload = await response.json() as { snapshot?: CommonsSnapshot; error?: string };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "Travel plan not removed. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
    }
    setSelectedTravelPlanId(null);
    setSheet(null);
    notify("Travel plan removed.");
  }

  async function savePlan(input: AddPlanInput) {
    const startsAt = input.date && input.time
      ? localDateTimeToIso(input.date, input.time, initialSnapshot.commons.timezone)
      : null;
    if (dataMode === "demo") {
      const firstName = initialSnapshot.currentActor.displayName.split(" ")[0];
      const newItem: CommonsState["itinerary"][number] = {
        id: crypto.randomUUID(),
        title: input.title,
        mealType: input.mealType ?? undefined,
        mealReservation: input.mealReservation ?? undefined,
        startsAt,
        durationMinutes: input.durationMinutes,
        endsAt: itineraryEndTime(startsAt, input.durationMinutes ?? null),
        arrangerPersonId: input.arrangerPersonId ?? undefined,
        arrangerName: participants.find((person) => person.id === input.arrangerPersonId)?.displayName,
        arrangerActive: input.arrangerPersonId ? true : undefined,
        location: input.location || undefined,
        note: input.note || undefined,
        expectedCostCents: input.expectedCostCents ?? undefined,
        expectedCostCurrency: input.expectedCostCurrency ?? "USD",
        expectedCostBasis: input.expectedCostBasis,
        expectedParticipantIds: input.participantScope === "self" ? [initialSnapshot.currentActor.id] : input.expectedParticipantIds,
        participantScope: input.participantScope === "self" ? "subgroup" : input.participantScope,
        participantIds: input.participantScope === "self" ? [initialSnapshot.currentActor.id] : undefined,
        status: input.status ?? (input.date ? "planned" : "idea"),
        scheduledDate: input.date,
        sourceUrl: input.sourceUrl ?? undefined,
        provenanceLabel: input.sourceUrl
          ? `${firstName} shared this from ${new URL(input.sourceUrl).hostname.replace(/^www\./, "")}`
          : `${firstName} added this in Commons`,
      };
      setState((current) => ({
        ...current,
        itinerary: sortItinerary([...current.itinerary, newItem]),
        participation: input.participantScope === "self" ? { ...current.participation, [newItem.id]: "in" } : current.participation,
      }));
      if (input.participantScope === "self") setActivityParticipation((current) => ({ ...current, [newItem.id]: "in" }));
      if (input.date) setSelectedDay(input.date);
      setSheet(null);
      trackProductEvent("plan_added", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: dataMode, scope: input.participantScope } });
      notify(startsAt ? `${input.title} added to the plan.` : `${input.title} added as an idea.`);
      return;
    }

    const response = await fetch(
      `/api/v1/commons/${initialSnapshot.commons.slug}/itinerary`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: stableCommandId(commandIds.current, "add-plan", input),
          ...input,
          occurredAt: new Date().toISOString(),
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Plan not added. Try again.");
    const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
    const added = addedRecord(new Set(state.itinerary.map(item => item.id)), snapshot.state.itinerary, item => sameText(item.title, input.title));
    setState(snapshot.state);
    setActivityParticipation(snapshot.state.participation);
    // Keep your place; the receipt offers View in Plan instead of moving the day.
    setPlanReceipt(added ? activityReceipt(initialSnapshot.commons.id, added, commonsSummary.timezone) : null);
    setSheet(null);
    trackProductEvent("plan_added", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: dataMode, scope: input.participantScope } });
    notify(startsAt ? `${input.title} added to the plan.` : `${input.title} added as an idea.`);
  }

  async function updatePlan(input: EditPlanInput) {
    if (!selectedPlan) throw new Error("Choose a plan to edit.");
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/itinerary/${selectedPlan.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            ...input,
            occurredAt: new Date().toISOString(),
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Plan not updated. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
      setActivityParticipation(snapshot.state.participation);
      if (input.date) setSelectedDay(input.date);
      setSelectedPlanId(null);
      setPlanScheduleDate(null);
      setSheet(null);
      notify(`${input.title} updated.`);
      return;
    }
    if (input.participantScope === "self" && (selectedPlan.participantIds ?? []).some((id) => id !== initialSnapshot.currentActor.id)) {
      throw new Error("Other travelers have responded to this plan. Add a separate plan for just you.");
    }
    if (input.participantScope === "subgroup" && (selectedPlan.respondedParticipantIds ?? selectedPlan.participantIds ?? []).some((id) => !input.expectedParticipantIds.includes(id))) {
      throw new Error("Someone has responded to this plan. Reopen it to keep their response, or add a separate plan.");
    }
    const startsAt = input.date && input.time
      ? localDateTimeToIso(input.date, input.time, initialSnapshot.commons.timezone)
      : null;
    const durationMinutes = input.durationMinutes === undefined ? itineraryDurationMinutes(selectedPlan) : input.durationMinutes;
    const endsAt = itineraryEndTime(startsAt, durationMinutes);
    const actorFirstName = initialSnapshot.currentActor.displayName.split(" ")[0];
    const commandId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();

    setState((current) => ({
      ...current,
      participation: input.participantScope === "self" ? { ...current.participation, [selectedPlan.id]: "in" } : current.participation,
      itinerary: current.itinerary.map((item) => item.id === selectedPlan.id ? {
        ...item,
        title: input.title,
        mealType: input.mealType === undefined ? item.mealType : input.mealType ?? undefined,
        mealReservation: input.mealReservation === undefined ? item.mealReservation : input.mealReservation ?? undefined,
        startsAt,
        endsAt,
        durationMinutes,
        ...(input.arrangerPersonId !== undefined ? {
          arrangerPersonId: input.arrangerPersonId ?? undefined,
          arrangerName: participants.find((person) => person.id === input.arrangerPersonId)?.displayName,
          arrangerActive: input.arrangerPersonId ? true : undefined,
        } : {}),
        location: input.location || undefined,
        note: input.note || undefined,
        expectedCostCents: input.expectedCostCents ?? undefined,
        expectedCostCurrency: input.expectedCostCurrency ?? "USD",
        expectedCostBasis: input.expectedCostBasis,
        expectedParticipantIds: input.participantScope === "self" ? [initialSnapshot.currentActor.id] : input.expectedParticipantIds,
        participantScope: input.participantScope === "self" ? "subgroup" : input.participantScope,
        status: input.status ?? item.status,
        scheduledDate: input.date,
        participantIds: input.participantScope === "self" ? [initialSnapshot.currentActor.id] : item.participantIds,
        provenanceLabel: `${actorFirstName} updated this in Commons`,
      } : item),
      moments: current.moments.map((moment) => moment.itineraryItemId === selectedPlan.id ? {
        ...moment,
        itineraryItemTitle: input.title,
      } : moment),
      auditEvents: [...current.auditEvents, {
        id: crypto.randomUUID(),
        commandId,
        actorId: initialSnapshot.currentActor.id,
        action: "itinerary.updated",
        targetId: selectedPlan.id,
        occurredAt,
        summary: `${initialSnapshot.currentActor.displayName} updated ${input.title}`,
      }],
      processedCommandIds: [...current.processedCommandIds, commandId],
    }));
    if (input.participantScope === "self") setActivityParticipation((current) => ({ ...current, [selectedPlan.id]: "in" }));
    setLocalMoments((current) => current.map((moment) => moment.itineraryItemId === selectedPlan.id ? {
      ...moment,
      itineraryItemTitle: input.title,
    } : moment));
    setState((current) => ({ ...current, itinerary: sortItinerary(current.itinerary) }));
    if (input.date) setSelectedDay(input.date);
    setSelectedPlanId(null);
    setPlanScheduleDate(null);
    setExpensePlanId(null);
    if (expensePlan) closeItem(); else setSheet(null);
    notify(`${input.title} updated.`);
  }

  async function deletePlan() {
    if (!selectedPlan) return;
    const deletedPlan = selectedPlan;
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/itinerary/${deletedPlan.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Plan not deleted. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
      setActivityParticipation(snapshot.state.participation);
      setSelectedPlanId(null);
      setSheet(null);
      notify(`${deletedPlan.title} removed from the plan.`);
      return;
    }
    const commandId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();

    setState((current) => {
      const participation = { ...current.participation };
      delete participation[deletedPlan.id];
      return {
        ...current,
        itinerary: current.itinerary.filter((item) => item.id !== deletedPlan.id),
        participation,
        moments: current.moments.map((moment) => moment.itineraryItemId === deletedPlan.id ? {
          ...moment,
          itineraryItemId: undefined,
          itineraryItemTitle: undefined,
          eventMatch: undefined,
        } : moment),
        auditEvents: [...current.auditEvents, {
          id: crypto.randomUUID(),
          commandId,
          actorId: initialSnapshot.currentActor.id,
          action: "itinerary.deleted",
          targetId: deletedPlan.id,
          occurredAt,
          summary: `${initialSnapshot.currentActor.displayName} deleted ${deletedPlan.title}`,
        }],
        processedCommandIds: [...current.processedCommandIds, commandId],
      };
    });
    setLocalMoments((current) => current.map((moment) => moment.itineraryItemId === deletedPlan.id ? {
      ...moment,
      itineraryItemId: undefined,
      itineraryItemTitle: undefined,
      eventMatch: undefined,
    } : moment));
    setActivityParticipation((current) => {
      const next = { ...current };
      delete next[deletedPlan.id];
      return next;
    });
    setSelectedPlanId(null);
    setSheet(null);
    notify(`${deletedPlan.title} removed from the plan.`);
  }

  async function addExpense(input: AddExpenseInput) {
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/expenses`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            ...input,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Expense not added. Try again.");
      }
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      applyMoneySnapshot(snapshot);
    } else {
      const payer = participants.find(
        (participant) => participant.id === input.paidByPersonId,
      );
      if (!payer) throw new Error("Choose someone on this trip as the payer.");
      const expense: Expense = {
        id: crypto.randomUUID(),
        title: input.title,
        amountCents: input.amountCents,
        currency: input.currency,
        paidByPersonId: input.paidByPersonId,
        paidByName: payer.displayName,
        occurredOn: input.occurredOn,
        category: input.category,
        itineraryItemId: input.itineraryItemId ?? undefined,
        stayId: input.stayId ?? undefined,
        travelPlanId: input.travelPlanId ?? undefined,
        status: "confirmed",
        splitMethod: input.splitMethod,
        balanceMode: input.balanceMode,
        confirmationCode: input.confirmationCode,
        receiptStatus: "not_attached",
        sourceLabel: `Added in Commons by ${initialSnapshot.currentActor.displayName}`,
        note: input.note,
        shares: input.shares,
      };
      setState((current) => ({
        ...current,
        expenses: [expense, ...current.expenses],
      }));
      setExpenseCompletionByPerson((current) => ({
        ...current,
        [initialSnapshot.currentActor.id]: null,
      }));
    }
    setSelectedStayId(null);
    setSelectedTravelPlanId(null);
    setExpensePlanId(null);
    if (expensePlan) closeItem(); else setSheet(null);
    trackProductEvent("expense_added", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: dataMode, splitMethod: input.splitMethod, participantCount: input.shares.length } });
    notify("Expense added to the group ledger.");
  }

  async function updateExpense(input: AddExpenseInput) {
    const expense = state.expenses.find((entry) => entry.id === selectedExpenseId);
    if (!expense) throw new Error("Expense not found. Close this editor and try again.");

    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/expenses/${expense.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), ...input }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Expense not updated. Try again.");
      }
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
    } else {
      const payer = participants.find(
        (participant) => participant.id === input.paidByPersonId,
      );
      if (!payer) throw new Error("Choose someone on this trip as the payer.");
      const originalSource = expense.sourceLabel.replace(/ · Updated by .+$/, "");
      setState((current) => ({
        ...current,
        expenses: current.expenses.map((entry) => entry.id === expense.id ? {
          ...entry,
          ...input,
          itineraryItemId: input.itineraryItemId ?? undefined,
          stayId: input.stayId ?? undefined,
          travelPlanId: input.travelPlanId ?? undefined,
          paidByName: payer.displayName,
          sourceLabel: `${originalSource} · Updated by ${initialSnapshot.currentActor.displayName}`,
        } : entry),
      }));
    }
    setExpensePlanId(null);
    if (expensePlan) closeItem(); else setSheet(null);
    notify(`${input.title} updated.`);
  }

  async function deleteExpense() {
    const expense = state.expenses.find((entry) => entry.id === selectedExpenseId);
    if (!expense) throw new Error("Expense not found. Close this detail and try again.");

    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/expenses/${expense.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Expense not deleted. Try again.");
      }
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
    } else {
      setState((current) => ({
        ...current,
        expenses: current.expenses.filter((entry) => entry.id !== expense.id),
      }));
    }
    setSelectedExpenseId(null);
    setSheet(null);
    notify(`${expense.title} deleted.`);
  }

  async function addPayment(input: PaymentInput) {
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/reimbursements`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), ...input }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Payment not recorded. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
    } else {
      const sender = participants.find((participant) => participant.id === input.fromPersonId);
      const recipient = participants.find((participant) => participant.id === input.toPersonId);
      if (!sender || !recipient) throw new Error("Choose two people on this trip.");
      const payment: Reimbursement = {
        id: crypto.randomUUID(),
        fromPersonId: sender.id,
        fromPersonName: sender.displayName,
        toPersonId: recipient.id,
        toPersonName: recipient.displayName,
        amountCents: input.amountCents,
        currency: input.currency,
        occurredOn: input.occurredOn,
        sourceLabel: `Recorded in Commons by ${initialSnapshot.currentActor.displayName}`,
      };
      setState((current) => ({
        ...current,
        reimbursements: [payment, ...current.reimbursements],
      }));
    }
    setSheet(null);
    trackProductEvent("payment_recorded", { commonsSlug: initialSnapshot.commons.slug, properties: { mode: dataMode } });
    notify("Payment recorded. Balances updated.");
  }

  async function updatePayment(input: PaymentInput) {
    const payment = state.reimbursements.find((entry) => entry.id === selectedPaymentId);
    if (!payment) throw new Error("Payment not found. Close this editor and try again.");
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/reimbursements/${payment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), ...input }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Payment not updated. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
    } else {
      const sender = participants.find((participant) => participant.id === input.fromPersonId);
      const recipient = participants.find((participant) => participant.id === input.toPersonId);
      if (!sender || !recipient) throw new Error("Choose two people on this trip.");
      const originalSource = payment.sourceLabel.replace(/ · Updated by .+$/, "");
      setState((current) => ({
        ...current,
        reimbursements: current.reimbursements.map((entry) => entry.id === payment.id ? {
          ...entry,
          ...input,
          fromPersonName: sender.displayName,
          toPersonName: recipient.displayName,
          sourceLabel: `${originalSource} · Updated by ${initialSnapshot.currentActor.displayName}`,
        } : entry),
      }));
    }
    setSheet(null);
    notify("Payment updated. Balances recalculated.");
  }

  async function deletePayment() {
    const payment = state.reimbursements.find((entry) => entry.id === selectedPaymentId);
    if (!payment) throw new Error("Payment not found. Close this detail and try again.");
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/reimbursements/${payment.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Payment not deleted. Try again.");
      const snapshot = CommonsSnapshotSchema.parse(payload.snapshot);
      setState(snapshot.state);
    } else {
      setState((current) => ({
        ...current,
        reimbursements: current.reimbursements.filter((entry) => entry.id !== payment.id),
      }));
    }
    setSelectedPaymentId(null);
    setSheet(null);
    notify("Payment deleted. Balances recalculated.");
  }

  async function updateExpensesComplete(scope: "self" | "group") {
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/money-status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID(), scope }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Expense status not updated. Try again.");
      applyMoneySnapshot(CommonsSnapshotSchema.parse(payload.snapshot));
    } else if (scope === "group") {
      const now = new Date().toISOString();
      setMoneyStatus({
        expensesClosedAt: now,
        expensesClosedByPersonId: initialSnapshot.currentActor.id,
        expensesClosedByName: initialSnapshot.currentActor.displayName,
      });
    } else {
      setExpenseCompletionByPerson((current) => ({
        ...current,
        [initialSnapshot.currentActor.id]: new Date().toISOString(),
      }));
    }
    setSheet(null);
    trackProductEvent(scope === "group" ? "expenses_closed" : "expenses_marked_complete", {
      commonsSlug: initialSnapshot.commons.slug,
      properties: { mode: dataMode },
    });
    notify(scope === "group" ? "Expenses closed for the group." : "You marked your expenses complete.");
  }

  async function markExpensesComplete() {
    await updateExpensesComplete("self");
  }

  async function closeExpensesForGroup() {
    await updateExpensesComplete("group");
  }

  async function reopenExpensesForGroup() {
    if (dataMode === "database") {
      const response = await fetch(
        `/api/v1/commons/${initialSnapshot.commons.slug}/money-status`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Expenses not reopened. Try again.");
      applyMoneySnapshot(CommonsSnapshotSchema.parse(payload.snapshot));
    } else {
      setExpenseCompletionByPerson(Object.fromEntries(participants.map((participant) => [participant.id, null])));
      setMoneyStatus({ expensesClosedAt: null, expensesClosedByPersonId: null, expensesClosedByName: null });
    }
    setSheet(null);
    trackProductEvent("expenses_reopened", {
      commonsSlug: initialSnapshot.commons.slug,
      properties: { mode: dataMode },
    });
    notify("Expenses reopened. The group can add to the ledger again.");
  }

  const detailItem = detailRef?.kind === "plan" ? state.itinerary.find(item => item.id === detailRef.id) : undefined;
  const detailStay = detailRef?.kind === "stay" ? state.stays?.find(stay => stay.id === detailRef.id) : undefined;
  return (
    <div className={`commons-shell commons-shell--persistent${arrivalOpen ? " commons-shell--arrival" : ""}`}>
      <TripApplicationShell tripStage={tripStage} commonsId={initialSnapshot.commons.id} view={tab} navigate={setTab} tripName={commonsSummary.name} inert={backgroundInert}
        account={{ signedIn, actorName: initialSnapshot.currentActor.displayName, actorInitials, roleLabel: canManageTrip ? "Organizer" : "Traveler", signInHref: `/sign-in?next=${encodeURIComponent(commonsPath(initialSnapshot.commons.id))}` }}
        identity={(placement, closeMenu) => <TripIdentity placement={placement} onAction={closeMenu} commons={commonsSummary} meta={[formatTripDates(commonsSummary.startsOn, commonsSummary.endsOn), formatTripPlaces(commonsSummary)].filter(Boolean).join(" · ")} coverImage={displayedCoverImage} participants={participants}
          openPeople={() => { trackProductEvent("people_opened", { commonsSlug: initialSnapshot.commons.slug }); setSheet("people"); }} openCoverPicker={() => setSheet("cover")}
          openSettings={canEditBasics ? () => setSheet("edit-trip-details") : undefined} openContext={canManageTrip && dataMode === "database" ? () => setSheet("trip-context") : undefined}
          demo={seededPilot} />}>
          <div className="trip-shell-page">
              {decisionHandoff ? <p className="decision-return"><a href={`${commonsPath(initialSnapshot.commons.id)}/polls/${decisionHandoff.pollId}`}>Back to decision</a></p> : null}
              {decisionHandoffUnavailable ? <p role="status">Couldn’t open those details. Nothing changed. Try opening the poll again.</p> : null}
              {(tab === "plan" && planSection === "map") || tab === "moments" ? contextNavigation : null}
              {view}
          </div>
        </TripApplicationShell>
      {arrivalOpen ? <TripArrival coverImage={displayedCoverImage} commons={commonsSummary} close={closeArrival} /> : null}
      <input className="sr-only" aria-label="Choose trip photos" ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void startPhotoUpload(files); }} />
      {sheet === "item-detail" ? detailItem || detailStay ? <TripItemDetail commons={commonsSummary} item={detailItem} stay={detailStay} close={closeItem} edit={detailItem ? () => { setSelectedPlanId(detailItem.id); setPlanScheduleDate(null); setSheet("edit-plan"); } : canManageStays && detailStay ? () => { setSelectedStayId(detailStay.id); setSheet("edit-stay"); } : undefined} addPhotos={detailItem ? () => addActivityPhotos(detailItem.id) : undefined} convertToExpense={detailItem && ledgerOpen && (detailItem.mealType || activityExpenseConversion(detailItem, state.expenses)) ? () => convertActivityToExpense(detailItem) : undefined} photoCount={detailItem ? [...state.moments, ...localMoments].filter(photo => photo.itineraryItemId === detailItem.id).length : 0} viewPhotos={() => setTab("moments")} /> : <ModalLayer close={closeItem}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="item-missing"><h2 id="item-missing">Item unavailable</h2><button type="button" className="sheet-secondary" onClick={closeItem}>Close</button></section></ModalLayer> : null}
      {sheet === "add-item" ? <ModalLayer close={() => setSheet(null)}><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-item-title"><header className="sheet-header"><h2 id="add-item-title">Add to trip</h2><button type="button" onClick={() => setSheet(null)}>Close</button></header><LogisticsAddMenu canAddStay={canManageStays} choose={chooseTripAdd} /></section></ModalLayer> : null}
      {sheet === "add-plan" || sheet === "add-meal" ? <AddPlanSheet key={sheet} meal={sheet === "add-meal"} currency={commonsSummary.currency ?? "USD"} timeZone={initialSnapshot.commons.timezone} commonsSlug={initialSnapshot.commons.slug} days={days} defaultDate={selectedDay} participants={activePlanParticipants} currentActorId={initialSnapshot.currentActor.id} persistent={dataMode === "database"} close={() => setSheet(null)} save={savePlan} /> : null}
      {sheet === "edit-plan" && selectedPlan ? <EditPlanSheet key={`${selectedPlan.id}:${planScheduleDate ?? "edit"}`} item={selectedPlan} days={days} participants={activePlanParticipants} currentActorId={initialSnapshot.currentActor.id} timeZone={initialSnapshot.commons.timezone} initialDate={planScheduleDate} close={() => { setPlanScheduleDate(null); setSheet(null); }} save={updatePlan} remove={deletePlan} persistent={dataMode === "database"} /> : null}
      {travelEditor}
      {sheet === "expense" && selectedExpense ? <ExpenseSheet expense={selectedExpense} participants={activeMoneyParticipants} itinerary={state.itinerary} balancesDisabled={commonsSummary.balancesDisabled ?? false} close={() => setSheet(null)} edit={() => { setStartExpenseAsRecorded(false); setSheet("edit-expense"); }} markRecorded={() => { setStartExpenseAsRecorded(true); setSheet("edit-expense"); }} remove={deleteExpense} /> : null}
      {sheet === "add-expense" || sheet === "add-receipt" ? <ExpenseEditorSheet defaultCurrency={moneyEntryCurrency ?? commonsSummary.currency ?? "USD"} receiptEntry={sheet === "add-receipt"} startAsRecorded={sheet === "add-receipt" || Boolean(expensePlan)} key={`new-expense:${expensePlan?.id ?? selectedStay?.id ?? selectedTravelPlan?.id ?? "general"}`} defaultPlan={expensePlan} defaultPlanCostCents={expensePlanConversion?.amountCents} defaultStay={selectedStay} defaultTravel={selectedTravelPlan} participants={activeMoneyParticipants} itinerary={state.itinerary} stays={state.stays ?? []} travelPlans={travelPlans} balancesDisabled={commonsSummary.balancesDisabled ?? false} timeZone={initialSnapshot.commons.timezone} currentActorId={initialSnapshot.currentActor.id} defaultDate={localDateKey(new Date().toISOString(), commonsSummary.timezone)} close={() => { setSelectedStayId(null); setSelectedTravelPlanId(null); setExpensePlanId(null); setSheet(expensePlan ? "item-detail" : null); }} save={addExpense} /> : null}
      {sheet === "edit-expense" && selectedExpense ? <ExpenseEditorSheet key={`${selectedExpense.id}:${startExpenseAsRecorded ? "record" : "edit"}`} expense={selectedExpense} startAsRecorded={startExpenseAsRecorded} participants={activeMoneyParticipants} itinerary={state.itinerary} stays={state.stays ?? []} travelPlans={travelPlans} balancesDisabled={commonsSummary.balancesDisabled ?? false} timeZone={initialSnapshot.commons.timezone} currentActorId={initialSnapshot.currentActor.id} defaultDate={selectedExpense.occurredOn} close={() => { setExpensePlanId(null); setSheet(expensePlan ? "item-detail" : "expense"); }} save={updateExpense} /> : null}
      {sheet === "money-settings" && canManageTrip ? <MoneySettingsSheet currency={commonsSummary.currency ?? "USD"} balancesDisabled={commonsSummary.balancesDisabled ?? false} allocatedExpenseCount={state.expenses.filter((expense) => expense.balanceMode === "allocated").length} close={() => setSheet(null)} save={saveMoneySettings} /> : null}
      {sheet === "payment" && selectedPayment ? <PaymentSheet payment={selectedPayment} close={() => setSheet(null)} edit={() => setSheet("edit-payment")} remove={deletePayment} /> : null}
      {sheet === "add-payment" ? <PaymentEditorSheet defaultCurrency={moneyEntryCurrency ?? commonsSummary.currency ?? "USD"} key="new-payment" participants={activeMoneyParticipants} currentActorId={initialSnapshot.currentActor.id} defaultDate={(initialSnapshot.commons.status === "planning" ? initialSnapshot.commons.startsOn : initialSnapshot.commons.endsOn) ?? initialSnapshot.commons.startsOn ?? initialSnapshot.commons.endsOn ?? new Date().toISOString().slice(0, 10)} close={() => setSheet(null)} save={addPayment} /> : null}
      {sheet === "edit-payment" && selectedPayment ? <PaymentEditorSheet key={selectedPayment.id} payment={selectedPayment} participants={activeMoneyParticipants} currentActorId={initialSnapshot.currentActor.id} defaultDate={selectedPayment.occurredOn} close={() => setSheet("payment")} save={updatePayment} /> : null}
      {postTrip && sheet === "close-expenses" ? <ExpenseLedgerStatusSheet mode="close" confirmedCount={completedExpenseCount} participantCount={activeMoneyParticipants.length} close={() => setSheet(null)} save={closeExpensesForGroup} /> : null}
      {postTrip && sheet === "reopen-expenses" ? <ExpenseLedgerStatusSheet mode="reopen" confirmedCount={completedExpenseCount} participantCount={activeMoneyParticipants.length} close={() => setSheet(null)} save={reopenExpensesForGroup} /> : null}
      {sheet === "cover" ? <CoverPickerSheet moments={state.moments} localMoments={localMoments} coverImage={displayedCoverImage} coverSourceMomentId={commonsSummary.coverSourceMomentId ?? null} close={() => setSheet(null)} selectCover={saveCover} uploadCover={useUploadedCover} notify={notify} /> : null}
      {basicsEditor}
      {newStayEditor}
      {quickAdd && dataMode === "database" ? <TripQuickAddSheet key={quickAdd} kind={quickAdd} commons={commonsSummary} stays={state.stays ?? []} itinerary={state.itinerary}
        lookUp={lookUpPlaceLink} readFile={readPlaceFile} save={input => quickAddPlace(quickAdd, input)}
        addDetails={id => { const kind = quickAdd; setQuickAdd(null); if (kind === "stay") { setSelectedStayId(id); setSheet("edit-stay"); } else openItem("plan", id); }}
        useFullForm={() => { const kind = quickAdd; setQuickAdd(null); setSheet(kind === "stay" ? "add-stay" : "add-plan"); }}
        close={() => setQuickAdd(null)} /> : null}
      {existingStayEditor}
      {sheet === "moment" && selectedMoment ? <MomentViewerSheet moment={selectedMoment} openItem={selectedMoment.itineraryItemId ? () => openItem("plan", selectedMoment.itineraryItemId!) : undefined} close={() => setSheet(null)} edit={() => setSheet("edit-moment")} /> : null}
      {sheet === "edit-moment" && selectedMoment ? <MomentEditorSheet moment={selectedMoment} days={days} itinerary={state.itinerary} timeZone={initialSnapshot.commons.timezone} close={() => setSheet("moment")} save={updateMoment} remove={deleteMoment} /> : null}
      {sheet === "photo-mapping" && pendingPhotos.length ? <PhotoMappingSheet initialActivityId={photoActivityId} photos={pendingPhotos} itinerary={state.itinerary} timeZone={initialSnapshot.commons.timezone} actorId={initialSnapshot.currentActor.id} actorName={initialSnapshot.currentActor.displayName} close={closePhotoMapping} addMoment={persistNewMoment} notify={notify} persistent={dataMode === "database"} /> : null}
      {sheet === "trip-context" && canManageTrip ? <TripContextSheet tripId={initialSnapshot.commons.id} close={() => setSheet(null)} /> : null}
      {sheet === "people" ? <PeopleSheet decidingStage={tripStage === "deciding"} slug={initialSnapshot.commons.slug} tripName={commonsSummary.name} tripStatus={commonsSummary.status} participants={participants} currentPersonId={initialSnapshot.currentActor.id} canManage={canManageTrip} persistent={dataMode === "database"} onPeopleChanged={refreshPeople} attendance={dataMode === "database" ? <EventAttendancePanel key={`${commonsSummary.id}:${commonsSummary.startsOn}:${commonsSummary.endsOn}`} eventId={commonsSummary.id} onSaved={() => setPeopleRevision(value => value + 1)} /> : undefined} close={() => { setSheet(null); setPeopleRevision(value => value + 1); }} /> : null}
      {planReceipt && !sheet && !quickAdd ? <section className="plan-receipt" role="status" aria-label="Saved to Plan">
        <CheckIcon /><p><strong>{planReceipt.title}</strong><span>{planReceipt.status} · Saved to Plan</span></p>
        <div className="plan-receipt-actions"><Link className="cm-action" href={planReceipt.href} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); viewReceipt(planReceipt); } }}>View in Plan</Link>
        <button type="button" className="cm-action cm-action--quiet" onClick={() => setPlanReceipt(null)}>Dismiss</button></div>
      </section> : null}
      <div className={`toast${toast && !(planReceipt && !sheet && !quickAdd) ? " toast--visible" : ""}${sheet ? " toast--behind-sheet" : ""}`} role="status" aria-live="polite"><CheckIcon />{toast}</div>
    </div>
  );
}
