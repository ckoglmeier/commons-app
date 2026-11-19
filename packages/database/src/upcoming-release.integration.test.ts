import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, people, memberships, travelPlans, processedCommands, tripTasks } from "./schema";
import { upsertCommonsFlightBooking, upsertCommonsTravelPlan, getCommonsSnapshot, updateCommonsTravelPlanSharing, addCommonsItineraryItem, updateCommonsItineraryItem } from "./pilot-repository";
import { listTripTasks, saveTripTask } from "./trip-task-repository";
import { loadCoordinatorTripContext } from "./coordinator-context-repository";
import { beginPersonalCoordinatorTurn } from "./personal-coordinator-repository";
import { beginCoordinatorTurn } from "./coordinator-turn-repository";
import { addCommonsPerson, inviteManagedTraveler, getCommonsPeople } from "./onboarding-repository";
import { invitations, invitationDeliveryAttempts } from "./schema";
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

test("People Add atomically queues email, preserves invitation/attendance boundaries, and never resends on duplicate add", {skip}, async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!, db = createDatabase(databaseUrl);
    const owner = randomUUID(), member = randomUUID(), trip = randomUUID(), slug = `auto-invite-${trip}`;
    const options = {databaseUrl,actorPersonId:owner,queueDelivery:true};
    const personIds: string[] = [owner,member];
    try {
        await db.db.insert(people).values([{id:owner,displayName:"Synthetic organizer"},{id:member,displayName:"Synthetic member"}]);
        await db.db.insert(commons).values({id:trip,slug,name:"Automatic invitation QA",timezone:"UTC",createdByPersonId:owner});
        await db.db.insert(memberships).values([{commonsId:trip,personId:owner,role:"organizer",status:"active"},{commonsId:trip,personId:member,role:"member",status:"active"}]);
        const input = {displayName:"Synthetic invited traveler",email:`auto-${trip}@example.com`,role:"member",accessMode:"account"};
        const added = await addCommonsPerson(slug,input,options);
        assert.ok("deliveryAttemptId" in added && added.deliveryAttemptId);
        const [invitation] = await db.db.select().from(invitations).where(eq(invitations.commonsId,trip));
        personIds.push(invitation.provisionalPersonId!);
        assert.equal(invitation.deliveryState,"queued");
        const roster = await getCommonsPeople(slug,options);
        const invited = roster!.people.find(person=>person.personId===invitation.provisionalPersonId)!;
        assert.equal(invited.membershipStatus,"invited");
        const [membership] = await db.db.select().from(memberships).where(eq(memberships.personId,invitation.provisionalPersonId!));
        assert.equal(membership.attendanceState,"helping");
        await assert.rejects(addCommonsPerson(slug,input,options),/already belongs/);
        assert.equal((await db.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.commonsId,trip))).length,1);
        await assert.rejects(addCommonsPerson(slug,{...input,email:`denied-${trip}@example.com`},{...options,actorPersonId:member}));
        const organizer = await addCommonsPerson(slug,{...input,role:"organizer",displayName:"Synthetic invited organizer",email:`organizer-${trip}@example.com`},options);
        assert.equal(organizer.deliveryAttemptId,null,"organizer invitations require an explicit Send action");
        const organizerInvitation = (await db.db.select().from(invitations).where(eq(invitations.commonsId,trip))).find(invite=>invite.id === organizer.invitationId)!;
        personIds.push(organizerInvitation.provisionalPersonId!);
        assert.equal(organizerInvitation.deliveryState,"not_sent");
        assert.equal((await db.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.commonsId,trip))).length,1);
        const managed = await addCommonsPerson(slug,{displayName:"Synthetic managed traveler",accessMode:"managed",role:"member"},options);
        assert.ok(managed.personId);personIds.push(managed.personId);
        assert.equal((await db.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.commonsId,trip))).length,1,"no email address means no delivery");
        const claim = {displayName:"Synthetic managed traveler",email:`claim-${trip}@example.com`,message:null};
        const offered = await inviteManagedTraveler(slug,managed.personId,claim,options);
        assert.ok(offered.deliveryAttemptId);
        const replay = await inviteManagedTraveler(slug,managed.personId,claim,options);
        assert.equal(replay.deliveryAttemptId,null,"an already queued invitation is not sent again");
        assert.equal((await db.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.commonsId,trip))).length,2);
    } finally { await db.db.delete(commons).where(eq(commons.id,trip));await db.db.delete(people).where(inArray(people.id,personIds));await db.close(); }
});
test("release journey: invited flight companions, private fields, tentative van, assigned task, day-only activity and saved context", { skip }, async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!, db = createDatabase(databaseUrl), ids = [randomUUID(), randomUUID(), randomUUID()], id = randomUUID(), slug = `release-${id}`, options = { databaseUrl, actorPersonId: ids[0] };
    try {
        await db.db.insert(people).values(ids.map((id, i) => ({ id, displayName: ["Robin Synthetic", "Invited Synthetic", "Other Synthetic"][i] })));
        await db.db.insert(commons).values({ id, slug, name: "Release journey", timezone: "America/Los_Angeles", createdByPersonId: ids[0] });
        await db.db.insert(memberships).values(ids.map((personId, i) => ({ commonsId: id, personId, role: i === 0 ? "organizer" as const : "member" as const, status: i === 1 ? "invited" as const : "active" as const })));
        const flight = { commandId: randomUUID(), legs: [{ kind: "arrival", date: "2026-11-05", time: "13:12", route: "DEN → SFO", connections: [{ origin: "DEN", destination: "SFO", departureDate: "2026-11-05", departureTime: "11:30", departureTimezone: "America/Denver", arrivalDate: "2026-11-05", arrivalTime: "13:12", arrivalTimezone: "America/Los_Angeles", flightNumber: "QA 12" }] }], includedPersonIds: ids.slice(0, 2), note: "Private note", confirmationCode: "SECRET", totalCents: 99999 };
        const first = (await upsertCommonsFlightBooking(slug, flight, options))!.state.travelPlans![0];
        assert.equal(first.visibility, "basic");
        const shared = (await getCommonsSnapshot(slug, { ...options, actorPersonId: ids[2] }))!.state.travelPlans![0];
        assert.equal(shared.totalCents, undefined);
        assert.equal(shared.confirmationCode, undefined);
        assert.equal(shared.note, "");
        await assert.rejects(updateCommonsTravelPlanSharing(slug, { commandId: randomUUID(), travelPlanId: first.id, visibility: "private" }, options), /Flights share/);
        // Existing private flags no longer hide flight basics, while legacy cost stays stored and private.
        await db.db.update(travelPlans).set({visibility:"private",totalCents:99999}).where(eq(travelPlans.id,first.id));
        await upsertCommonsFlightBooking(slug, { ...flight, commandId: randomUUID(), totalCents:null }, options);
        const refreshed=(await getCommonsSnapshot(slug, { ...options, actorPersonId: ids[2] }))!.state.travelPlans!;
        assert.equal(refreshed.length,1);assert.equal(refreshed[0].visibility,"basic");assert.equal(refreshed[0].totalCents,undefined);assert.equal(refreshed[0].confirmationCode,undefined);
        assert.equal((await db.db.select().from(travelPlans).where(eq(travelPlans.id,first.id)))[0].totalCents,99999);
        const baseContext = await loadCoordinatorTripContext(id, options);
        assert.equal(baseContext.logistics.length, 1);
        const own = await loadCoordinatorTripContext(id, { ...options, includeOwnTravel: true });
        assert.equal(own.logistics[0].value.connections?.[0].arrivalTime, "13:12");
        assert.equal(own.logistics[0].value.route, "DEN → SFO");
        assert.ok(!JSON.stringify(own).includes("SECRET"));
        const vanInput = { commandId: randomUUID(), kind: "transport", date: "2026-11-05", time: null, route: "Shared van from SFO to Sonoma Lodge", includedPersonIds: ids.slice(0, 2), companionPersonId: null, status: "considering", note: "Arrange after the flight" };
        const van = (await upsertCommonsTravelPlan(slug, vanInput, options))!.state.travelPlans!.find(item => item.kind === "transport")!;
        assert.equal(van.status, "considering");
        assert.equal(van.time, undefined);
        assert.equal(van.driverPersonId, undefined);
        assert.equal(van.visibility, "basic");
        const taskInput = { commandId: randomUUID(), id: randomUUID(), expectedVersion: 0, title: "Arrange airport van", ownerPersonId: ids[1], dueOn: null, completed: false, itemKind: "travel", itemId: van.id };
        const task = await saveTripTask(slug, taskInput, options);
        assert.deepEqual(await saveTripTask(slug, taskInput, options), task);
        const assignedContext = await loadCoordinatorTripContext(id, { ...options, includeOwnTravel: true });
        assert.equal(assignedContext.tasks[0].value.ownerPersonId, ids[1]);
        assert.equal(assignedContext.tasks[0].value.itemId, van.id);
        assert.equal(assignedContext.logistics.find(fact => fact.value.kind === "transport")?.value.localTime, null);
        await assert.rejects(listTripTasks(slug, { ...options, actorPersonId: ids[1] }), /active participant/);
        await saveTripTask(slug, { ...taskInput, commandId: randomUUID(), id: randomUUID(), itemId: first.id, completed:true }, options);
        await saveTripTask(slug, { ...taskInput, commandId: randomUUID(), expectedVersion: task.version, completed: true }, options);
        assert.equal((await db.db.select().from(travelPlans).where(eq(travelPlans.id, van.id)))[0].status, "considering");
        assert.equal((await listTripTasks(slug, options)).find(row=>row.id===task.id)!.completed, true);
        await assert.rejects(saveTripTask(slug, { ...taskInput, commandId: randomUUID() }, options), /Refresh/);
        const member = (await db.db.select().from(memberships).where(eq(memberships.personId, ids[1])))[0];
        assert.equal(member.status, "invited");
        assert.notEqual(member.attendanceState, "attending");
        const activity = { commandId: randomUUID(), title: "Lunch", date: "2026-11-05", time: null, status: "confirmed", participantScope: "everyone", occurredAt: new Date().toISOString() };
        const item = (await addCommonsItineraryItem(slug, activity, options))!.state.itinerary[0];
        assert.equal(item.startsAt, null);
        assert.equal(item.scheduledDate, "2026-11-05");
        assert.equal(item.status, "confirmed");
        assert.equal((await loadCoordinatorTripContext(id, options)).plans[0].value.scheduledDate, "2026-11-05");
        const revised = (await updateCommonsItineraryItem(slug, item.id, { ...activity, commandId: randomUUID(), date: null, status: undefined }, options))!.state.itinerary[0];
        assert.equal(revised.id, item.id);
        assert.equal(revised.status, "confirmed");
        await assert.rejects(db.db.transaction(async (tx) => { await tx.execute(sql `set local role authenticated`); await tx.select().from(tripTasks); }), error => String((error as {
            cause?: {
                code?: string;
            };
        }).cause?.code) === "42501");
    }
    finally {
        await db.db.delete(commons).where(eq(commons.id, id));
        await db.db.delete(people).where(inArray(people.id, ids));
        await db.close();
    }
});
test("freeform to-dos preserve receipts, ownership, optional links and later editing without running actions", {skip}, async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!, db = createDatabase(databaseUrl);
    const owner = randomUUID(), member = randomUUID(), invited = randomUUID(), trip = randomUUID(), slug = `todos-${trip}`;
    const options = {databaseUrl,actorPersonId:owner};
    try {
        await db.db.insert(people).values([{id:owner,displayName:"Organizer"},{id:member,displayName:"Member"},{id:invited,displayName:"Invitee"}]);
        await db.db.insert(commons).values({id:trip,slug,name:"Simple to-dos",timezone:"UTC",createdByPersonId:owner});
        await db.db.insert(memberships).values([{commonsId:trip,personId:owner,role:"organizer",status:"active"},{commonsId:trip,personId:member,role:"member",status:"active"},{commonsId:trip,personId:invited,role:"member",status:"invited"}]);
        const input = {commandId:randomUUID(),id:randomUUID(),expectedVersion:0,title:"Bring sunscreen",ownerPersonId:member,dueOn:null,completed:false};
        const todo = await saveTripTask(slug,input,options);
        assert.equal(todo.itemId,null); assert.equal(todo.itemKind,null); assert.equal(todo.itemTitle,null);
        assert.deepEqual(await saveTripTask(slug,input,options),todo);
        assert.deepEqual(await listTripTasks(slug,{...options,actorPersonId:member}),[todo]);
        const context = await loadCoordinatorTripContext(trip,options);
        assert.equal(context.tasks[0].value.title,"Bring sunscreen"); assert.equal(context.tasks[0].value.itemId,null);
        assert.equal(context.plans.length,0); assert.equal(context.logistics.length,0);
        const ownInput={...input,commandId:randomUUID(),id:randomUUID(),title:"Pack charger"};
        const own=await saveTripTask(slug,ownInput,{...options,actorPersonId:member});
        assert.deepEqual(await saveTripTask(slug,ownInput,{...options,actorPersonId:member}),own);
        const revised=await saveTripTask(slug,{...ownInput,commandId:randomUUID(),expectedVersion:own.version,title:"Pack phone charger"},{...options,actorPersonId:member});
        assert.equal(revised.title,"Pack phone charger");
        await assert.rejects(saveTripTask(slug,{...ownInput,commandId:randomUUID(),id:randomUUID(),ownerPersonId:owner},{...options,actorPersonId:member}));
        await assert.rejects(saveTripTask(slug,{...ownInput,commandId:randomUUID(),expectedVersion:revised.version,ownerPersonId:owner},{...options,actorPersonId:member}));
        const organizerOnly=await saveTripTask(slug,{...input,commandId:randomUUID(),id:randomUUID(),ownerPersonId:owner},options);
        await assert.rejects(saveTripTask(slug,{...input,commandId:randomUUID(),id:organizerOnly.id,expectedVersion:organizerOnly.version},{...options,actorPersonId:member}));
        await assert.rejects(saveTripTask(slug,{...input,commandId:randomUUID(),itemKind:"travel"},options),/both/);
        const done = await saveTripTask(slug,{...input,commandId:randomUUID(),expectedVersion:todo.version,completed:true}, {...options,actorPersonId:member});
        assert.equal(done.completed,true);
        const reopened = await saveTripTask(slug,{...input,commandId:randomUUID(),expectedVersion:done.version,completed:false,ownerPersonId:invited,dueOn:"2027-05-14"},options);
        assert.equal(reopened.itemId,null);
        await assert.rejects(listTripTasks(slug,{...options,actorPersonId:invited}));
        await assert.rejects(saveTripTask(slug,{...input,commandId:randomUUID(),expectedVersion:todo.version},options));
        const [membership] = await db.db.select().from(memberships).where(eq(memberships.personId,invited));
        assert.equal(membership.status,"invited"); assert.notEqual(membership.attendanceState,"attending");
        await assert.rejects(db.db.insert(tripTasks).values({id:randomUUID(),commonsId:trip,createdByPersonId:owner,ownerPersonId:owner,title:"Invalid half-link",itemKind:"travel"}));
    } finally {await db.db.delete(commons).where(eq(commons.id,trip));await db.db.delete(people).where(inArray(people.id,[owner,member,invited]));await db.close();}
});
test("100 rolling-hour slots are shared by organizer and personal Coordinator entry points", { skip }, async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!, db = createDatabase(databaseUrl), owner = randomUUID(), member = randomUUID(), trip = randomUUID(), slug = `quota-${trip}`, now = new Date();
    try {
        await db.db.insert(people).values([{ id: owner, displayName: "Organizer" }, { id: member, displayName: "Traveler" }]);
        await db.db.insert(commons).values({ id: trip, slug, name: "Quota", timezone: "UTC", createdByPersonId: owner });
        await db.db.insert(memberships).values([{ commonsId: trip, personId: owner, role: "organizer", status: "active" }, { commonsId: trip, personId: member, role: "member", status: "active" }]);
        await db.db.insert(processedCommands).values(Array.from({ length: 99 }, () => ({ commonsId: trip, commandId: randomUUID(), processedAt: now, result: { kind: "poll_inference" } })));
        const command = { commandId: randomUUID(), text: "My arrival?" };
        await beginPersonalCoordinatorTurn(trip, command, { databaseUrl, actorPersonId: member, now });
        await beginPersonalCoordinatorTurn(trip, command, { databaseUrl, actorPersonId: member, now });
        await assert.rejects(beginCoordinatorTurn(trip, { commandId: randomUUID(), text: "What next?", inputMode: "text", target: { kind: "new", threadId: randomUUID() } }, { databaseUrl, actorPersonId: owner, provisionalTitle: "Question", now }), error => (error as {
            code: string;
        }).code === "rate_limited");
        await beginPersonalCoordinatorTurn(trip, { commandId: randomUUID(), text: "Later" }, { databaseUrl, actorPersonId: member, now: new Date(now.getTime() + 3600001) });
    }
    finally {
        await db.db.delete(commons).where(eq(commons.id, trip));
        await db.db.delete(people).where(inArray(people.id, [owner, member]));
        await db.close();
    }
});
