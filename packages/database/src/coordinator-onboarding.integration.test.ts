import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { createDatabase } from './client';
import { createEventCreationDraft, changeSetupCoordinator, finishSetupCoordinator, commitEventCreationDraft } from './event-creation-repository';
import { coordinatorPreferencesForTrip } from './coordinator-repository';
import { people, commons, coordinatorTurns, coordinatorThreads, memberships } from './schema';
test('private setup, approval handoff, replay, and organizer personality authorization', { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== '1' }, async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!;
    const database = createDatabase(databaseUrl);
    const actors = await database.db.insert(people).values([{ displayName: 'Setup owner' }, { displayName: 'Co-organizer' }, { displayName: 'Traveler' }]).returning();
    const owner = { databaseUrl, actorPersonId: actors[0].id };
    let eventId: string | undefined;
    try {
        let draft = await createEventCreationDraft({ sourceKind: 'description', title: 'Test next step', timezone: 'America/Denver' }, owner);
        const message = { action: 'message', expectedVersion: draft.version, commandId: randomUUID(), prompt: 'What next?' };
        await assert.rejects(changeSetupCoordinator(draft.id, message, { ...owner, actorPersonId: actors[1].id }));
        const reserved = await changeSetupCoordinator(draft.id, message, owner);
        draft = reserved.draft;
        assert.equal((await changeSetupCoordinator(draft.id, message, owner)).replayed, true);
        await assert.rejects(changeSetupCoordinator(draft.id, { ...message, prompt: 'changed' }, owner));
        await assert.rejects(commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, owner));
        draft = await finishSetupCoordinator(draft.id, message.commandId, draft.version, 'First, choose dates.', owner);
        await assert.rejects(finishSetupCoordinator(draft.id, message.commandId, draft.version - 1, 'stale', owner));
        const configured = await changeSetupCoordinator(draft.id, { action: 'configure', expectedVersion: draft.version, personality: { id: 'joan', specificationVersion: 1 }, startingPoint: 'Choose dates' }, owner);
        draft = configured.draft;
        assert.equal((await database.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, draft.id))).length, 0);
        const approval = { commandId: randomUUID(), expectedVersion: draft.version };
        const result = await commitEventCreationDraft(draft.id, approval, owner);
        eventId = result.eventId;
        assert.equal(result.coordinatorThreadId, draft.id);
        assert.equal(result.unsentInvitationCount, 0);
        await database.db.update(coordinatorThreads).set({ title: 'Renamed', lastCommandFingerprint: 'renamed' }).where(eq(coordinatorThreads.id, draft.id));
        assert.equal((await commitEventCreationDraft(draft.id, approval, owner)).coordinatorThreadId, draft.id);
        const turns = await database.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, eventId));
        assert.equal(turns.length, 1);
        assert.equal(turns[0].organizerShared, true);
        assert.equal(turns[0].workspace?.personality, 'commons');
        await database.db.insert(memberships).values([{ commonsId: eventId, personId: actors[1].id, role: 'organizer', status: 'active' }, { commonsId: eventId, personId: actors[2].id, role: 'member', status: 'active' }]);
        const other = { ...owner, actorPersonId: actors[1].id };
        const current = await coordinatorPreferencesForTrip(result.slug, owner);
        assert.equal(current.settings.personality.id, 'joan');
        assert.equal(current.dismissed, true);
        assert.equal((await coordinatorPreferencesForTrip(result.slug, other)).dismissed, false);
        const mutation = { action: 'personality', commandId: randomUUID(), expectedVersion: current.settings.version, personality: { id: 'miles', specificationVersion: 1 } };
        await assert.rejects(coordinatorPreferencesForTrip(result.slug, { ...owner, actorPersonId: actors[2].id }, mutation));
        const changed = await coordinatorPreferencesForTrip(result.slug, other, mutation);
        assert.equal(changed.settings.personality.id, 'miles');
        assert.equal((await coordinatorPreferencesForTrip(result.slug, other, mutation)).settings.version, changed.settings.version);
        await assert.rejects(coordinatorPreferencesForTrip(result.slug, owner, { ...mutation, commandId: randomUUID() }));
        await coordinatorPreferencesForTrip(result.slug, other, { action: 'dismiss' });
        assert.equal((await coordinatorPreferencesForTrip(result.slug, other)).dismissed, true);
        await database.db.update(memberships).set({ status: 'removed' }).where(eq(memberships.personId, actors[1].id));
        await assert.rejects(coordinatorPreferencesForTrip(result.slug, other));
    }
    finally {
        if (eventId)
            await database.db.delete(commons).where(eq(commons.id, eventId));
        await database.db.delete(people).where(inArray(people.id, actors.map(a => a.id)));
        await database.close();
    }
});
test('skipping a starting topic keeps setup history private and ordinary creation unchanged', { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== '1' }, async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!;
    const database = createDatabase(databaseUrl);
    const [actor] = await database.db.insert(people).values({ displayName: 'Skip setup QA' }).returning();
    const options = { databaseUrl, actorPersonId: actor.id };
    let eventId: string | undefined;
    try {
        let draft = await createEventCreationDraft({ sourceKind: 'description', title: 'Skip help trip', timezone: 'UTC' }, options);
        const commandId = randomUUID();
        draft = (await changeSetupCoordinator(draft.id, { action: 'message', commandId, expectedVersion: draft.version, prompt: 'Private setup question' }, options)).draft;
        draft = await finishSetupCoordinator(draft.id, commandId, draft.version, 'Private setup reply', options);
        const result = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, options);
        eventId = result.eventId;
        assert.equal(result.coordinatorThreadId, null);
        assert.equal((await database.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, eventId))).length, 0);
        assert.equal((await database.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, eventId))).length, 0);
        assert.equal((await coordinatorPreferencesForTrip(result.slug, options)).settings.personality.id, 'commons');
    }
    finally {
        if (eventId)
            await database.db.delete(commons).where(eq(commons.id, eventId));
        await database.db.delete(people).where(eq(people.id, actor.id));
        await database.close();
    }
});
