export function isSupabaseAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

type PilotActorEnvironment = {
  COMMONS_PILOT_ACTOR_ID?: string;
  NODE_ENV?: "development" | "production" | "test";
  VERCEL?: string;
  VERCEL_ENV?: string;
};

export function getLocalDevelopmentPilotActorId(
  environment: PilotActorEnvironment = process.env,
) {
  const actorPersonId = environment.COMMONS_PILOT_ACTOR_ID?.trim();
  const isVercel = Boolean(environment.VERCEL || environment.VERCEL_ENV);
  if (!actorPersonId || environment.NODE_ENV !== "development" || isVercel) {
    return null;
  }
  return actorPersonId;
}

export function getSupabaseAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase Auth is not configured.");
  }
  return { url, publishableKey };
}
