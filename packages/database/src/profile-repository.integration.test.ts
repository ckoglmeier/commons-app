import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  getManagedTravelerProfile,
  TravelerProfileAccessError,
  updateManagedTravelerProfile,
} from "./profile-repository";
import { commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("only the traveler or an explicitly assigned manager can maintain an attributed traveler profile", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const managerId = randomUUID();
  const otherOrganizerId = randomUUID();
  const travelerId = randomUUID();
  const commonsId = randomUUID();
  const slug = `profile-${randomUUID().slice(0, 8)}`;
  try {
    await database.db.insert(people).values([
      { id: managerId, displayName: "Assigned Parent" },
      { id: otherOrganizerId, displayName: "Other Organizer" },
      { id: travelerId, displayName: "Managed Child" },
    ]);
    await database.db.insert(commons).values({ id: commonsId, slug, name: "Profile Test", timezone: "America/Denver", createdByPersonId: managerId });
    await database.db.insert(memberships).values([
      { commonsId, personId: managerId, role: "organizer", status: "active", joinedAt: new Date(), accessMode: "account" },
      { commonsId, personId: otherOrganizerId, role: "organizer", status: "active", joinedAt: new Date(), accessMode: "account" },
      { commonsId, personId: travelerId, role: "member", status: "active", joinedAt: new Date(), accessMode: "managed", managedByPersonIds: [managerId] },
    ]);

    const updated = await updateManagedTravelerProfile(slug, travelerId, managerId, {
      usualOriginLabel: "DEN",
      dietaryPreferences: "No peanuts",
      accessibilityNeeds: "Quiet boarding time",
      lodgingPreferences: "Bed near a parent",
      transportationPreferences: "Booster seat",
      sharedPreferenceKeys: ["dietaryPreferences", "transportationPreferences"],
    }, databaseUrl);
    assert.equal(updated.dietaryPreferences, "No peanuts");
    assert.deepEqual(updated.suppliedBy.dietaryPreferences, { personId: managerId, displayName: "Assigned Parent" });
    assert.deepEqual(updated.sharedPreferenceKeys, ["dietaryPreferences", "transportationPreferences"]);
    assert.deepEqual((await getManagedTravelerProfile(slug, travelerId, managerId, databaseUrl))?.suppliedBy.transportationPreferences, {
      personId: managerId,
      displayName: "Assigned Parent",
    });
    const self = await getManagedTravelerProfile(slug, managerId, managerId, databaseUrl);
    assert.equal(self?.personId, managerId);

    await assert.rejects(
      () => getManagedTravelerProfile(slug, travelerId, otherOrganizerId, databaseUrl),
      (error) => error instanceof TravelerProfileAccessError,
    );
    await assert.rejects(
      () => updateManagedTravelerProfile(slug, travelerId, otherOrganizerId, { dietaryPreferences: "Changed" }, databaseUrl),
      (error) => error instanceof TravelerProfileAccessError,
    );
  } finally {
    await database.db.delete(commons).where(inArray(commons.id, [commonsId]));
    await database.db.delete(people).where(inArray(people.id, [managerId, otherOrganizerId, travelerId]));
    await database.close();
  }
});

test("explicit same-person reuse preserves managed dietary preferences across trips without copying sharing or trip answers", {skip:!run}, async()=>{
  const {createEventCreationDraft,commitEventCreationDraft}=await import("./event-creation-repository");
  const {getCommonsSnapshot}=await import("./pilot-repository");
  const {eq}=await import("drizzle-orm");
  const databaseUrl=process.env.TEST_DATABASE_URL!;const db=createDatabase(databaseUrl);
  const manager=randomUUID(),other=randomUUID(),child=randomUUID(),source=randomUUID();const tripIds:string[]=[source];
  try {
    await db.db.insert(people).values([{id:manager,displayName:"Assigned manager"},{id:other,displayName:"Other organizer"},{id:child,displayName:"Managed traveler"}]);
    await db.db.insert(commons).values({id:source,slug:`reuse-${source}`,name:"Family travel",timezone:"America/Denver",createdByPersonId:manager});
    await db.db.insert(memberships).values([{commonsId:source,personId:manager,role:"organizer",status:"active"},{commonsId:source,personId:other,role:"organizer",status:"active"},{commonsId:source,personId:child,status:"active",role:"member",accessMode:"managed",managedByPersonIds:[manager],attendanceState:"attending",sharedPreferenceKeys:["dietaryPreferences"]}]);
    await updateManagedTravelerProfile(`reuse-${source}`,child,manager,{dietaryPreferences:"Vegetarian",transportationPreferences:"Booster seat"},databaseUrl);
    const create=async(actorPersonId:string)=>{
      const options={databaseUrl,actorPersonId};const draft=await createEventCreationDraft({sourceKind:"prior_event",sourceEventId:source,timezone:"America/Denver"},options);
      assert.ok(draft.people.some(person=>person.personId===child));
      const result=await commitEventCreationDraft(draft.id,{commandId:randomUUID(),expectedVersion:draft.version},options);tripIds.push(result.eventId);return result;
    };
    const next=await create(manager);
    const profile=await getManagedTravelerProfile(next.slug,child,manager,databaseUrl);
    assert.equal(profile?.dietaryPreferences,"Vegetarian");assert.equal(profile?.transportationPreferences,"Booster seat");assert.deepEqual(profile?.sharedPreferenceKeys,[],"sharing is chosen per trip");
    assert.equal((await getManagedTravelerProfile(next.slug,child,manager,databaseUrl))?.dietaryPreferences,"Vegetarian","reopening reads persisted profile");
    const [member]=await db.db.select().from(memberships).where(eq(memberships.commonsId,next.eventId));
    assert.ok(member);
    const snapshot=await getCommonsSnapshot(next.slug,{databaseUrl,actorPersonId:manager});
    assert.equal(snapshot?.participants.find(person=>person.id===child)?.accessMode,"managed");
    assert.deepEqual(snapshot?.participants.find(person=>person.id===child)?.sharedPreferences,{});
    await assert.rejects(getManagedTravelerProfile(next.slug,child,other,databaseUrl),TravelerProfileAccessError);
    const unrelated=await create(other);
    await assert.rejects(getManagedTravelerProfile(unrelated.slug,child,other,databaseUrl),TravelerProfileAccessError,"being another organizer on the source trip does not make someone a private profile manager");
    const rows=await db.db.select().from(memberships).where(eq(memberships.personId,child));
    assert.equal(rows.find(row=>row.commonsId===next.eventId)?.attendanceState,"helping","the new-trip default is used instead of copying source attendance");
  }finally{await db.db.delete(commons).where(inArray(commons.id,tripIds));await db.db.delete(people).where(inArray(people.id,[manager,other,child]));await db.close();}
});
