import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  auditEvents,
  commons,
  expenses as expensesTable,
  expenseShares,
  identities,
  invitations,
  itineraryItems,
  memberships,
  messages,
  participation,
  people,
  processedCommands,
  proposalEvidence,
  proposals,
} from "./schema";

const commonsId = "10000000-0000-4000-8000-000000000001";
const proposalId = "20000000-0000-4000-8000-000000000001";
const personIds = {
  Casey: "30000000-0000-4000-8000-000000000001",
  Robin: "31000000-0000-4000-8000-000000000002",
  Maya: "31000000-0000-4000-8000-000000000003",
  Ben: "31000000-0000-4000-8000-000000000004",
  Jess: "31000000-0000-4000-8000-000000000005",
  Aaron: "31000000-0000-4000-8000-000000000006",
  Priya: "31000000-0000-4000-8000-000000000007",
  Dev: "31000000-0000-4000-8000-000000000008",
} as const;

const peopleByKey = {
  Casey: "Casey Rivera",
  Robin: "Robin Rivera",
  Maya: "Maya Kim",
  Ben: "Ben Kim",
  Jess: "Jess Parker",
  Aaron: "Aaron Parker",
  Priya: "Priya Shah",
  Dev: "Dev Shah",
} as const;

const sourceMessages = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    actor: "Maya" as const,
    body: "Could we do one dinner out on Thursday?",
    occurredAt: "2027-06-10T12:42:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    actor: "Ben" as const,
    body: "I’m in. Somewhere relaxed, around $75 a person would be ideal.",
    occurredAt: "2027-06-10T12:45:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    actor: "Jess" as const,
    body: "Seafood works for us. 7:30 is best.",
    occurredAt: "2027-06-10T12:47:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000004",
    actor: "Casey" as const,
    body: "C Salt at 7:30? Looks like they can seat eight.",
    occurredAt: "2027-06-10T12:51:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000005",
    actor: "Priya" as const,
    body: "Works for us. I like that it’s close to the house.",
    occurredAt: "2027-06-10T12:54:00.000Z",
  },
];

const baseItinerary = [
  ["Arrivals + house check-in", "2027-07-18T19:00:00.000Z", "Falmouth house", "everyone", "confirmed", "Arrival windows shared by all 8 travelers"],
  ["Tacos at the house", "2027-07-18T22:30:00.000Z", "Falmouth house", "everyone", "planned", "Maya volunteered for the first grocery run"],
  ["Beach morning", "2027-07-19T13:30:00.000Z", "Old Silver Beach", "everyone", "planned", "Beach parking still needs one car"],
  ["Welcome cookout", "2027-07-19T21:00:00.000Z", "Falmouth house", "everyone", "planned", "Ben has the grill list"],
  ["Old Silver Beach", "2027-07-20T14:00:00.000Z", "Old Silver Beach", "everyone", "planned", "Leave the house at 9:35 AM"],
  ["Mini golf", "2027-07-20T20:00:00.000Z", "Falmouth", "individual", "planned", "5 interested · walk-in plan"],
  ["Group dinner", "2027-07-20T22:30:00.000Z", "Falmouth house", "everyone", "planned", "Cook at the house"],
  ["Woods Hole aquarium", "2027-07-21T14:30:00.000Z", "Woods Hole", "everyone", "planned", "Rain plan from the group conversation"],
  ["Open afternoon", "2027-07-21T18:30:00.000Z", null, "individual", "planned", "Nothing scheduled"],
  ["Dinner at the house", "2027-07-21T23:00:00.000Z", "Falmouth house", "everyone", "planned", "Priya and Dev are cooking"],
  ["Old Silver Beach", "2027-07-22T17:30:00.000Z", "Old Silver Beach", "subgroup", "planned", "Maya, Ben, Jess, and Aaron are in"],
  ["Shining Sea bike trail", "2027-07-22T17:30:00.000Z", "Shining Sea Bikeway", "subgroup", "planned", "Bikes reserved for Casey and Robin"],
  ["Falmouth stroll", "2027-07-22T17:30:00.000Z", "Main Street, Falmouth", "subgroup", "planned", "Priya and Dev are keeping it easy"],
  ["Whale watching", "2027-07-24T13:30:00.000Z", "Barnstable Harbor", "everyone", "planned", "Maya recorded the Saturday confirmation"],
  ["Beach + tide pools", "2027-07-23T13:00:00.000Z", "Falmouth", "everyone", "planned", "Morning together · afternoon open"],
  ["Sunset sail", "2027-07-23T20:30:00.000Z", "Falmouth Harbor", "individual", "planned", "4 interested · not reserved"],
  ["Last-night lobster boil", "2027-07-24T23:00:00.000Z", "Falmouth house", "everyone", "planned", "Aaron owns the shopping list"],
  ["Departures", "2027-07-25T14:00:00.000Z", "Falmouth house", "everyone", "planned", "Departure times still need 3 people"],
] as const;

const subgroupParticipants: Record<number, Array<keyof typeof personIds>> = {
  11: ["Maya", "Ben", "Jess", "Aaron"],
  12: ["Casey", "Robin"],
  13: ["Priya", "Dev"],
};

const pilotExpenses = [
  {
    id: "80000000-0000-4000-8000-000000000001",
    title: "House rental",
    amountCents: 640000,
    paidBy: "Maya" as const,
    occurredOn: "2027-04-15",
    category: "Lodging",
    sourceLabel: "Imported from the planning spreadsheet",
    personKeys: Object.keys(personIds) as Array<keyof typeof personIds>,
  },
  {
    id: "80000000-0000-4000-8000-000000000002",
    title: "House groceries",
    amountCents: 42000,
    paidBy: "Ben" as const,
    occurredOn: "2027-07-17",
    category: "Food & drink",
    sourceLabel: "Added from Ben’s receipt",
    personKeys: Object.keys(personIds) as Array<keyof typeof personIds>,
  },
  {
    id: "80000000-0000-4000-8000-000000000003",
    title: "Bike rentals",
    amountCents: 38400,
    paidBy: "Casey" as const,
    occurredOn: "2027-07-12",
    category: "Activity",
    sourceLabel: "Added from Casey’s confirmation",
    note: "Only the 4 riders are included.",
    personKeys: ["Casey", "Robin", "Priya", "Dev"] as Array<keyof typeof personIds>,
  },
];

function identityHash(name: string) {
  return createHash("sha256").update(`commons-pilot:${name}`).digest("hex");
}

function itineraryId(index: number) {
  return `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export async function seedPilot() {
  const database = createDatabase();
  try {
    await database.db.transaction(async (transaction) => {
      // This is a deterministic demo reset. It replaces the former Austin pilot
      // while retaining the Commons row and Casey's claimed identity.
      await transaction.delete(auditEvents).where(eq(auditEvents.commonsId, commonsId));
      await transaction.delete(processedCommands).where(eq(processedCommands.commonsId, commonsId));
      await transaction.delete(expensesTable).where(eq(expensesTable.commonsId, commonsId));
      await transaction.delete(participation).where(
        eq(participation.itineraryItemId, itineraryId(1)),
      );
      await transaction.delete(itineraryItems).where(eq(itineraryItems.commonsId, commonsId));
      await transaction.delete(proposalEvidence).where(eq(proposalEvidence.proposalId, proposalId));
      await transaction.delete(proposals).where(eq(proposals.commonsId, commonsId));
      await transaction.delete(messages).where(eq(messages.commonsId, commonsId));
      await transaction.delete(invitations).where(eq(invitations.commonsId, commonsId));
      await transaction.delete(memberships).where(eq(memberships.commonsId, commonsId));

      for (const [key, displayName] of Object.entries(peopleByKey) as Array<[keyof typeof peopleByKey, string]>) {
        const id = personIds[key];
        await transaction
          .insert(people)
          .values({ id, displayName })
          .onConflictDoUpdate({
            target: people.id,
            set: { displayName, updatedAt: new Date() },
          });
        await transaction
          .insert(identities)
          .values({
            personId: id,
            kind: "phone",
            normalizedHash: identityHash(displayName),
            state: key === "Casey" ? "claimed" : "channel_verified",
            verifiedAt: new Date("2026-08-25T12:00:00.000Z"),
          })
          .onConflictDoNothing();
      }

      await transaction
        .insert(commons)
        .values({
          id: commonsId,
          slug: "cape-cod-couples-week",
          name: "Cape Cod Couples Week",
          startsOn: "2027-07-18",
          endsOn: "2027-07-25",
          locationName: "Falmouth, Massachusetts",
          coverImageUrl: "/moments/cape-beach.jpg",
          timezone: "America/New_York",
          status: "planning",
          createdByPersonId: personIds.Casey,
        })
        .onConflictDoUpdate({
          target: commons.id,
          set: {
            slug: "cape-cod-couples-week",
            name: "Cape Cod Couples Week",
            startsOn: "2027-07-18",
            endsOn: "2027-07-25",
            locationName: "Falmouth, Massachusetts",
            coverImageUrl: "/moments/cape-beach.jpg",
            timezone: "America/New_York",
            status: "planning",
            updatedAt: new Date(),
          },
        });

      let memberIndex = 0;
      for (const key of Object.keys(personIds) as Array<keyof typeof personIds>) {
        memberIndex += 1;
        await transaction.insert(memberships).values({
          id: `60000000-0000-4000-8000-${String(memberIndex).padStart(12, "0")}`,
          commonsId,
          personId: personIds[key],
          role: key === "Casey" ? "organizer" : "member",
          status: "active",
          joinedAt: new Date("2027-06-01T12:00:00.000Z"),
        });
      }

      for (const [index, message] of sourceMessages.entries()) {
        await transaction.insert(messages).values({
          id: message.id,
          commonsId,
          sequence: index + 1,
          actorPersonId: personIds[message.actor],
          actorName: peopleByKey[message.actor],
          actorType: "human",
          body: message.body,
          occurredAt: new Date(message.occurredAt),
          source: "channel",
          sourceEventId: `cape-cod-source-${index + 1}`,
        });
      }

      await transaction.insert(proposals).values({
        id: proposalId,
        commonsId,
        version: 1,
        status: "proposed",
        scope: "everyone",
        title: "Add C Salt dinner Thursday at 7:30 PM",
        summary:
          "A dinner out Thursday works for all four couples. C Salt matches the shared timing, price, and seafood preferences.",
        payload: {
          kind: "group_activity",
          title: "Dinner at C Salt",
          startsAt: "2027-07-22T23:30:00.000Z",
          endsAt: "2027-07-23T01:30:00.000Z",
          location: "C Salt Wine Bar",
          participantScope: "everyone",
        },
        expiresAt: new Date("2027-06-11T22:00:00.000Z"),
      });

      for (const [index, message] of sourceMessages.slice(0, 5).entries()) {
        await transaction.insert(proposalEvidence).values({
          id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          proposalId,
          messageId: message.id,
          excerpt: message.body,
          relevance: 100 - index * 5,
        });
      }

      let participationIndex = 0;
      for (const [arrayIndex, item] of baseItinerary.entries()) {
        const itemIndex = arrayIndex + 1;
        const [title, startsAt, locationName, audience, status, provenanceLabel] = item;
        await transaction.insert(itineraryItems).values({
          id: itineraryId(itemIndex),
          commonsId,
          title,
          startsAt: new Date(startsAt),
          timezone: "America/New_York",
          locationName,
          audience,
          status,
          provenanceLabel,
        });
        for (const personKey of subgroupParticipants[itemIndex] ?? []) {
          participationIndex += 1;
          await transaction.insert(participation).values({
            id: `82000000-0000-4000-8000-${String(participationIndex).padStart(12, "0")}`,
            itineraryItemId: itineraryId(itemIndex),
            personId: personIds[personKey],
            status: "in",
            source: "seeded group conversation",
          });
        }
      }

      let shareIndex = 0;
      for (const expense of pilotExpenses) {
        await transaction.insert(expensesTable).values({
          id: expense.id,
          commonsId,
          title: expense.title,
          amountCents: expense.amountCents,
          currency: "USD",
          paidByPersonId: personIds[expense.paidBy],
          createdByPersonId: personIds[expense.paidBy],
          occurredOn: expense.occurredOn,
          category: expense.category,
          status: "confirmed",
          splitMethod: "equal",
          receiptStatus: "attached",
          source: "import",
          sourceLabel: expense.sourceLabel,
          externalId: `cape-cod-${expense.id}`,
          note: "note" in expense ? expense.note : undefined,
        });
        const shareBase = Math.floor(expense.amountCents / expense.personKeys.length);
        const remainder = expense.amountCents - shareBase * expense.personKeys.length;
        for (const [index, personKey] of expense.personKeys.entries()) {
          shareIndex += 1;
          await transaction.insert(expenseShares).values({
            id: `81000000-0000-4000-8000-${String(shareIndex).padStart(12, "0")}`,
            expenseId: expense.id,
            personId: personIds[personKey],
            amountCents: shareBase + (index < remainder ? 1 : 0),
          });
        }
      }
    });
  } finally {
    await database.close();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/packages/database/src/seed-pilot.ts")) {
  await seedPilot();
  console.log(`Seeded Cape Cod Couples Week. Set COMMONS_PILOT_ACTOR_ID=${personIds.Casey}`);
}
