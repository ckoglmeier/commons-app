import { isPosthogExcluded } from '@/lib/posthog-exclusions';
import { NextResponse } from 'next/server';
import { getCommonsAuthIdentity } from '@/lib/supabase/server';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  try {
    const identity = await getCommonsAuthIdentity();
    const excluded = isPosthogExcluded(identity?.email);
    return NextResponse.json({ excluded, identity: identity && !excluded ? { id: identity.authUserId, name: identity.displayName ?? null, email: identity.email ?? null } : null }, { headers });
  } catch {
    return NextResponse.json({ error: 'Identity unavailable.' }, { status: 503, headers });
  }
}
