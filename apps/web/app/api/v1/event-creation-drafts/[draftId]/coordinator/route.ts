import { posthogAiObserver } from '@/lib/server/posthog-ai';
import { NextResponse } from 'next/server';
import { SetupCoordinatorRequestSchema } from '@commons/contracts';
import { readBoundedJson } from '@/lib/bounded-json';
import { reserveAuthenticatedSetupCoordinator, finishAuthenticatedSetupCoordinator, currentAccountHasPilotCapabilities } from '@/lib/server/event-creation';
import { capabilityUnavailableResponse } from '@/lib/server/trip-capabilities';
import { eventCreationErrorResponse } from '@/lib/server/event-creation-response';
import { coordinatorPersonalitiesEnabled, readCommonsRuntimeEnvironment } from '@/lib/server/runtime-environment';
import { converseWithCoordinator } from '@/lib/server/coordinator-review-inference';
import { coordinatorInferencePolicy } from '@/lib/server/coordinator-inference-policy';
export const maxDuration = 60;
export async function POST(request: Request, { params }: {
    params: Promise<{
        draftId: string;
    }>;
}) {
    try {
        const environment = readCommonsRuntimeEnvironment();
        if (environment.COMMONS_COORDINATOR_ONBOARDING_ENABLED !== 'true')
            return NextResponse.json({ error: 'Coordinator setup is unavailable.' }, { status: 404 });
        // Free beta: setup chat is a pilot capability, checked on the server for the signed-in account (trip-capabilities.ts).
        if (!(await currentAccountHasPilotCapabilities()))
            return capabilityUnavailableResponse();
        const { draftId } = await params, input = SetupCoordinatorRequestSchema.parse(await readBoundedJson(request, 5000));
        // The same inference policy as the trip coordinator: setup advice is the escalation (advisory) model of the active policy.
        // With personalities paused, setup advice uses the conversation model and the Commons voice.
        const personalities = coordinatorPersonalitiesEnabled(environment);
        const policy = coordinatorInferencePolicy(environment), setupModel = policy ? policy.modelId(personalities ? policy.models.escalation : policy.models.conversation) : null;
        if (input.action === 'message' && (!policy || !setupModel))
            return NextResponse.json({ error: 'Your coordinator is not connected. You can continue setup directly.' }, { status: 503 });
        const { draft, replayed } = await reserveAuthenticatedSetupCoordinator(draftId, input);
        if (input.action !== 'message' || replayed)
            return NextResponse.json({ draft }, { headers: { 'Cache-Control': 'private, no-store' } });
        const telemetry = await posthogAiObserver(request, 'setup', draftId);
        let reply: string;
        try {
            const result = await converseWithCoordinator(null, input.prompt, { telemetry, apiKey: policy!.apiKey, transport: policy!.transport, model: setupModel!, providerPolicy: environment.COMMONS_COORDINATOR_PROVIDER_POLICY, ...(personalities ? { personality: draft.coordinator.personality } : {}) }, request.signal, fetch, { tripContext: { description: draft.description, name: draft.proposedName, startsOn: draft.startsOn, endsOn: draft.endsOn, location: draft.locationName, brief: draft.brief }, conversation: draft.coordinator.turns.filter(turn => turn.reply !== null).flatMap(turn => [{ role: 'user', text: turn.prompt }, { role: 'assistant', text: turn.reply! }]), priorPolls: [] });
            reply = result.reply;
        }
        catch {
            reply = 'Commons couldn’t complete this reply. Your setup is unchanged. You can continue directly or try another message.';
        }
        return NextResponse.json({ draft: await finishAuthenticatedSetupCoordinator(draftId, input.commandId, draft.version, reply) }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    catch (error) {
        const response = eventCreationErrorResponse(error);
        response.headers.set("Cache-Control", "private, no-store");
        return response;
    }
}
