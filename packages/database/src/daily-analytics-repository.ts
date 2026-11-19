import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { hashNormalizedEmail } from "./tokens";
import {
  commons,
  expenses,
  feedbackSubmissions,
  invitations,
  itineraryItems,
  messages,
  moments,
  operatorNotificationDeliveries,
  people,
  pollResponses,
  polls,
  productAnalyticsEvents,
  stays,
  eventCreationAccess,
  type OperatorNotificationPayload,
} from "./schema";

export type DailyAnalyticsReport = Extract<OperatorNotificationPayload, { kind: "daily_analytics" }> ["report"] & {
  /** Free-beta funnel, from saved records only. Absent on reports queued before it existed. */
  funnel?: FreeBetaFunnel;
};

/**
 * Free-beta funnel for one report window. Every count comes from committed rows (never clicks). Each trip or person is
 * counted once ever per metric, on the day its first qualifying record was saved, so a retry or reload cannot add to it.
 * Excluded everywhere: the public sample trip, QA-named trips (/^QA(\s|[—:-])/i) and trips created by internal accounts.
 *   - tripsCreated: trips whose commons row was created in the window.
 *   - tripsWithSharedArtifact: first published poll OR first invitation with a recorded send time (an invitation only
 *     queued or failed does not count); `viaPoll`/`viaInvitation` count which came first.
 *   - tripsWithParticipantAction: first poll response (member or link respondent who is not an active organizer),
 *     expense, or Plan item by a non-organizer. Plan items record only an arranger, so a Plan item counts when its
 *     arranger is an active non-organizer member. tripsWithOrganizerAction is the same for organizers (their own
 *     expenses, Plan items arranged, and poll responses), reported separately.
 *   - tripsWithOrganizerReturn: first organizer page_view on a later UTC day than the trip's creation (first-party
 *     product_analytics_events by auth user; browsers that block first-party analytics cannot be measured).
 *   - originalOrganizerRepeatCreators: creators of a trip created in the window who created an earlier trip.
 *   - participantOriginatedTrips: trips created in the window whose creator was an earlier non-organizer member of
 *     another trip and had not organized or created any earlier trip.
 * Invitations sent never count toward an activated group.
 */
export type FreeBetaFunnel = {
  tripsCreated: number;
  tripsWithSharedArtifact: number;
  tripsWithSharedArtifactViaPoll: number;
  tripsWithSharedArtifactViaInvitation: number;
  tripsWithParticipantAction: number;
  tripsWithOrganizerAction: number;
  tripsWithOrganizerReturn: number;
  originalOrganizerRepeatCreators: number;
  participantOriginatedTrips: number;
  /** Committed outcomes recorded by the server (outcome-telemetry.ts), internal accounts excluded, by event name. */
  outcomes?: Record<string, number>;
  /** Sanitized failures by operation (operation_failed rows), internal accounts excluded. */
  failures?: Record<string, number>;
};

/** Server outcome and failure counts for the window. One row per outcome already (deterministic ids); internal excluded. */
export async function loadServerOutcomeCounts(window: { startsAt: Date; endsAt: Date }, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db.select({ name: productAnalyticsEvents.eventName, operation: sql<string | null>`${productAnalyticsEvents.properties}->>'operation'`, total: count() })
      .from(productAnalyticsEvents)
      // Both markers: the server path and properties.source = "server", which the browser route strips (events route).
      .where(and(eq(productAnalyticsEvents.pagePath, "/server/outcome"), sql`${productAnalyticsEvents.properties}->>'source' = 'server'`, gte(productAnalyticsEvents.occurredAt, window.startsAt), lt(productAnalyticsEvents.occurredAt, window.endsAt),
        sql`coalesce(${productAnalyticsEvents.properties}->>'internal', 'false') <> 'true'`))
      .groupBy(productAnalyticsEvents.eventName, sql`${productAnalyticsEvents.properties}->>'operation'`);
    const outcomes: Record<string, number> = {}, failures: Record<string, number> = {};
    for (const row of rows) {
      if (row.name === "operation_failed") failures[row.operation ?? "unknown"] = (failures[row.operation ?? "unknown"] ?? 0) + Number(row.total);
      else outcomes[row.name] = (outcomes[row.name] ?? 0) + Number(row.total);
    }
    return { outcomes, failures };
  } finally { await database.close(); }
}

const PUBLIC_SAMPLE_SLUG = "cape-cod-couples-week";

export async function loadFreeBetaFunnel(window: { startsAt: Date; endsAt: Date }, options: { databaseUrl?: string; excludedEmails?: readonly string[] } = {}): Promise<FreeBetaFunnel> {
  const database = createDatabase(options.databaseUrl);
  try {
    const hashes = [...new Set((options.excludedEmails ?? []).map(email => email.trim().toLowerCase()).filter(email => email.includes("@")))].map(hashNormalizedEmail);
    const excludedPeople = hashes.length
      ? sql`select person_id from identities where kind = 'email' and normalized_hash in (${sql.join(hashes.map(hash => sql`${hash}`), sql`, `)})`
      : sql`select null::uuid as person_id where false`;
    const starts = window.startsAt.toISOString(), ends = window.endsAt.toISOString();
    const result = await database.db.execute(sql`
      with excluded_people as (${excludedPeople}),
      eligible as (
        select c.id, c.slug, c.created_at, c.created_by_person_id from commons c
        where c.slug <> ${PUBLIC_SAMPLE_SLUG}
          and c.name !~* '^QA([[:space:]]|[—:-])'
          and (c.created_by_person_id is null or c.created_by_person_id not in (select person_id from excluded_people))
      ),
      active_organizers as (
        select m.commons_id, m.person_id from memberships m where m.role = 'organizer' and m.status = 'active'
      ),
      active_members as (
        select m.commons_id, m.person_id from memberships m where m.role = 'member' and m.status = 'active'
      ),
      poll_first as (select p.commons_id, min(p.created_at) at_ from polls p group by p.commons_id),
      invite_first as (select i.commons_id, min(i.sent_at) at_ from invitations i where i.sent_at is not null group by i.commons_id),
      shared as (
        select e.id, p.at_ poll_at, i.at_ invite_at, least(p.at_, i.at_) first_at
        from eligible e left join poll_first p on p.commons_id = e.id left join invite_first i on i.commons_id = e.id
        where p.at_ is not null or i.at_ is not null
      ),
      actions as (
        select pl.commons_id, pr.submitted_at at_,
          (pr.respondent_person_id is null or not exists (select 1 from active_organizers o where o.commons_id = pl.commons_id and o.person_id = pr.respondent_person_id)) as by_participant
        from poll_responses pr join polls pl on pl.id = pr.poll_id
        union all
        select x.commons_id, x.created_at,
          not exists (select 1 from active_organizers o where o.commons_id = x.commons_id and o.person_id = x.created_by_person_id)
        from expenses x where x.created_by_person_id is not null
          and (exists (select 1 from active_organizers o where o.commons_id = x.commons_id and o.person_id = x.created_by_person_id)
            or exists (select 1 from active_members o where o.commons_id = x.commons_id and o.person_id = x.created_by_person_id))
        union all
        select it.commons_id, it.created_at,
          not exists (select 1 from active_organizers o where o.commons_id = it.commons_id and o.person_id = it.arranger_person_id)
        from itinerary_items it where it.arranger_person_id is not null
          and (exists (select 1 from active_organizers o where o.commons_id = it.commons_id and o.person_id = it.arranger_person_id)
            or exists (select 1 from active_members o where o.commons_id = it.commons_id and o.person_id = it.arranger_person_id))
      ),
      first_action as (
        select a.commons_id, a.by_participant, min(a.at_) first_at from actions a
        where a.commons_id in (select id from eligible) group by a.commons_id, a.by_participant
      ),
      organizer_return as (
        select e.id, min(ev.occurred_at) first_at
        from eligible e
        join active_organizers o on o.commons_id = e.id
        join people pe on pe.id = o.person_id and pe.auth_user_id is not null
        join product_analytics_events ev on ev.auth_user_id = pe.auth_user_id::text
          and ev.event_name = 'page_view' and (ev.commons_slug = e.slug or ev.commons_slug = e.id::text)
          and (ev.occurred_at at time zone 'UTC')::date > (e.created_at at time zone 'UTC')::date
        group by e.id
      ),
      created_now as (
        select * from eligible e where e.created_at >= ${starts}::timestamptz and e.created_at < ${ends}::timestamptz
      )
      select
        (select count(*) from created_now)::int as trips_created,
        (select count(*) from shared where first_at >= ${starts}::timestamptz and first_at < ${ends}::timestamptz)::int as shared,
        (select count(*) from shared where first_at >= ${starts}::timestamptz and first_at < ${ends}::timestamptz and poll_at is not null and (invite_at is null or poll_at <= invite_at))::int as via_poll,
        (select count(*) from shared where first_at >= ${starts}::timestamptz and first_at < ${ends}::timestamptz and invite_at is not null and (poll_at is null or invite_at < poll_at))::int as via_invitation,
        (select count(*) from first_action where by_participant and first_at >= ${starts}::timestamptz and first_at < ${ends}::timestamptz)::int as participant_action,
        (select count(*) from first_action where not by_participant and first_at >= ${starts}::timestamptz and first_at < ${ends}::timestamptz)::int as organizer_action,
        (select count(*) from organizer_return where first_at >= ${starts}::timestamptz and first_at < ${ends}::timestamptz)::int as organizer_return,
        (select count(distinct c.created_by_person_id) from created_now c where c.created_by_person_id is not null
          and exists (select 1 from eligible earlier where earlier.created_by_person_id = c.created_by_person_id and earlier.created_at < c.created_at))::int as repeat_creators,
        (select count(*) from created_now c where c.created_by_person_id is not null
          and exists (select 1 from memberships m join eligible earlier on earlier.id = m.commons_id
            where m.person_id = c.created_by_person_id and m.role = 'member' and m.status = 'active' and earlier.created_at < c.created_at and m.created_at < c.created_at)
          and not exists (select 1 from eligible earlier where earlier.created_by_person_id = c.created_by_person_id and earlier.created_at < c.created_at)
          and not exists (select 1 from memberships m join eligible earlier on earlier.id = m.commons_id
            where m.person_id = c.created_by_person_id and m.role = 'organizer' and earlier.created_at < c.created_at and earlier.id <> c.id)
        )::int as participant_originated
    `);
    const row = (result as unknown as Array<Record<string, number | string>>)[0] ?? {};
    const n = (key: string) => Number(row[key] ?? 0);
    return {
      tripsCreated: n("trips_created"),
      tripsWithSharedArtifact: n("shared"),
      tripsWithSharedArtifactViaPoll: n("via_poll"),
      tripsWithSharedArtifactViaInvitation: n("via_invitation"),
      tripsWithParticipantAction: n("participant_action"),
      tripsWithOrganizerAction: n("organizer_action"),
      tripsWithOrganizerReturn: n("organizer_return"),
      originalOrganizerRepeatCreators: n("repeat_creators"),
      participantOriginatedTrips: n("participant_originated"),
    };
  } finally {
    await database.close();
  }
}

type DailyAnalyticsWindow = {
  periodKey: string;
  startsAt: Date;
  endsAt: Date;
};

const REPORT_TIMEZONE = "America/Denver";

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) };
}

function timezoneOffsetAt(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - date.getTime();
}

function localMidnightUtc(year: number, month: number, day: number) {
  const wallClock = Date.UTC(year, month - 1, day);
  let instant = new Date(wallClock - timezoneOffsetAt(new Date(wallClock)));
  // Re-read the offset after conversion so daylight-saving transitions use the
  // offset that applies at local midnight, not at the temporary UTC value.
  instant = new Date(wallClock - timezoneOffsetAt(instant));
  return instant;
}

export function dailyAnalyticsWindow(now = new Date()): DailyAnalyticsWindow {
  const today = localDateParts(now);
  const localTodayStart = localMidnightUtc(today.year, today.month, today.day);
  const yesterdayAtNoonUtc = new Date(localTodayStart.getTime() - 12 * 60 * 60 * 1000);
  const yesterday = localDateParts(yesterdayAtNoonUtc);
  const startsAt = localMidnightUtc(yesterday.year, yesterday.month, yesterday.day);
  return {
    periodKey: `${String(yesterday.year).padStart(4, "0")}-${String(yesterday.month).padStart(2, "0")}-${String(yesterday.day).padStart(2, "0")}`,
    startsAt,
    endsAt: localTodayStart,
  };
}

const resultCount = (row: { total: number | string } | undefined) => Number(row?.total ?? 0);

export async function loadDailyAnalyticsReport(now = new Date(), databaseUrl?: string, options: { excludedEmails?: readonly string[] } = {}): Promise<DailyAnalyticsReport> {
  const database = createDatabase(databaseUrl);
  const window = dailyAnalyticsWindow(now);
  const within = <T>(column: T & { name: string }) => and(gte(column as never, window.startsAt), lt(column as never, window.endsAt));
  try {
    const [activePeople, sessions, pageViews, tripsCreated, peopleCreated, invitationsSent, invitationsAccepted, messageCount, pollsCreated, responseCount, planCount, stayCount, expenseCount, photoCount, feedbackCount, betaAccessCount, topEvents] = await Promise.all([
      database.db.select({ total: sql<number>`count(distinct ${productAnalyticsEvents.authUserId})` }).from(productAnalyticsEvents).where(and(within(productAnalyticsEvents.occurredAt), isNotNull(productAnalyticsEvents.authUserId))),
      database.db.select({ total: sql<number>`count(distinct ${productAnalyticsEvents.sessionId})` }).from(productAnalyticsEvents).where(within(productAnalyticsEvents.occurredAt)),
      database.db.select({ total: count() }).from(productAnalyticsEvents).where(and(within(productAnalyticsEvents.occurredAt), eq(productAnalyticsEvents.eventName, "page_view"))),
      database.db.select({ total: count() }).from(commons).where(within(commons.createdAt)),
      database.db.select({ total: count() }).from(people).where(within(people.createdAt)),
      database.db.select({ total: count() }).from(invitations).where(within(invitations.sentAt)),
      database.db.select({ total: count() }).from(invitations).where(within(invitations.acceptedAt)),
      database.db.select({ total: count() }).from(messages).where(within(messages.occurredAt)),
      database.db.select({ total: count() }).from(polls).where(within(polls.createdAt)),
      database.db.select({ total: count() }).from(pollResponses).where(within(pollResponses.submittedAt)),
      database.db.select({ total: count() }).from(itineraryItems).where(within(itineraryItems.createdAt)),
      database.db.select({ total: count() }).from(stays).where(within(stays.createdAt)),
      database.db.select({ total: count() }).from(expenses).where(within(expenses.createdAt)),
      database.db.select({ total: count() }).from(moments).where(within(moments.createdAt)),
      database.db.select({ total: count() }).from(feedbackSubmissions).where(within(feedbackSubmissions.createdAt)),
      database.db.select({ total: count() }).from(eventCreationAccess).where(within(eventCreationAccess.requestedAt)),
      database.db.select({ name: productAnalyticsEvents.eventName, total: count() }).from(productAnalyticsEvents)
        .where(within(productAnalyticsEvents.occurredAt)).groupBy(productAnalyticsEvents.eventName)
        .orderBy(desc(count())).limit(5),
    ]);
    const funnel = { ...await loadFreeBetaFunnel(window, { databaseUrl, excludedEmails: options.excludedEmails }), ...await loadServerOutcomeCounts(window, databaseUrl) };
    return {
      funnel,
      periodKey: window.periodKey,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      activePeople: resultCount(activePeople[0]),
      sessions: resultCount(sessions[0]),
      pageViews: resultCount(pageViews[0]),
      tripsCreated: resultCount(tripsCreated[0]),
      peopleCreated: resultCount(peopleCreated[0]),
      invitationsSent: resultCount(invitationsSent[0]),
      invitationsAccepted: resultCount(invitationsAccepted[0]),
      messages: resultCount(messageCount[0]),
      pollsCreated: resultCount(pollsCreated[0]),
      pollResponses: resultCount(responseCount[0]),
      plansAdded: resultCount(planCount[0]),
      staysAdded: resultCount(stayCount[0]),
      expensesAdded: resultCount(expenseCount[0]),
      photosAdded: resultCount(photoCount[0]),
      feedbackSubmitted: resultCount(feedbackCount[0]),
      betaAccessRequested: resultCount(betaAccessCount[0]),
      topEvents: topEvents.map(row => ({ name: row.name, count: Number(row.total) })),
    };
  } finally {
    await database.close();
  }
}

export async function queueDailyAnalyticsReport(now = new Date(), databaseUrl?: string, options: { excludedEmails?: readonly string[] } = {}) {
  const report = await loadDailyAnalyticsReport(now, databaseUrl, options);
  const database = createDatabase(databaseUrl);
  try {
    const [delivery] = await database.db.insert(operatorNotificationDeliveries).values({
      dedupeKey: `daily-analytics:${report.periodKey}`,
      payload: { kind: "daily_analytics", report } as OperatorNotificationPayload,
    }).onConflictDoNothing().returning({ id: operatorNotificationDeliveries.id });
    return { report, deliveryId: delivery?.id ?? null };
  } finally {
    await database.close();
  }
}
