import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { CommandAccessError, CommandConflictError } from '@commons/database';
import { authenticatedCoordinatorPreferences } from '@/lib/server/polls';
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from '@/lib/server/commons';
import { coordinatorPersonalitiesEnabled } from '@/lib/server/runtime-environment';
import { readBoundedJson } from '@/lib/bounded-json';
import { agentCapabilityBlock } from '@/lib/server/trip-capabilities';
const headers = { 'Cache-Control': 'private, no-store' };
async function handle(request: Request, params: Promise<{
    slug: string;
}>, write: boolean) {
    try {
        if (!coordinatorPersonalitiesEnabled())
            return NextResponse.json({ error: 'Coordinator settings unavailable.' }, { status: 404, headers });
        const { slug } = await params;
        const capabilityBlock = write ? await agentCapabilityBlock(slug) : null;
        if (capabilityBlock) return capabilityBlock;
        return NextResponse.json(await authenticatedCoordinatorPreferences(slug, write ? await readBoundedJson(request, 2000) : undefined), { headers });
    }
    catch (error) {
        const status = error instanceof CommonsAuthenticationRequiredError ? 401 : error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError ? 403 : error instanceof CommandConflictError ? 409 : error instanceof ZodError ? 400 : 503;
        return NextResponse.json({ error: status === 409 ? 'Coordinator settings changed. Reload before choosing again.' : 'Could not load or save coordinator settings.' }, { status, headers });
    }
}
export const GET = (request: Request, { params }: {
    params: Promise<{
        slug: string;
    }>;
}) => handle(request, params, false);
export const PATCH = (request: Request, { params }: {
    params: Promise<{
        slug: string;
    }>;
}) => handle(request, params, true);
