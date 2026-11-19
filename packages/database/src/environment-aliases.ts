/**
 * Commons reads its own setting names. The Vercel Marketplace integrations set different ones; this fills each Commons name from the
 * integration's name when the Commons name is empty, so a one-click deploy needs no copying. An explicit Commons value always wins.
 */
export const ENVIRONMENT_ALIASES: Record<string, readonly string[]> = {
  DATABASE_URL: ["POSTGRES_URL", "POSTGRES_PRISMA_URL", "SUPABASE_DATABASE_URL"],
  DATABASE_DIRECT_URL: ["POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED"],
  NEXT_PUBLIC_SUPABASE_URL: ["SUPABASE_URL"],
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
  SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SECRET_KEY"],
};

type Env = Record<string, string | undefined>;

/** Returns the Commons names that were filled, without exposing any value. Mutates `env` (process.env by default). */
export function applyEnvironmentAliases(env: Env = process.env as Env): string[] {
  const filled: string[] = [];
  for (const [name, aliases] of Object.entries(ENVIRONMENT_ALIASES)) {
    if (env[name]?.trim()) continue;
    const source = aliases.find(alias => env[alias]?.trim());
    if (source) { env[name] = env[source]!.trim(); filled.push(name); }
  }
  // The pooled URL can stand in for migrations when no direct URL is given (slower, but it works on a fresh deploy).
  if (!env.DATABASE_DIRECT_URL?.trim() && env.DATABASE_URL?.trim()) { env.DATABASE_DIRECT_URL = env.DATABASE_URL.trim(); filled.push("DATABASE_DIRECT_URL"); }
  return filled;
}
