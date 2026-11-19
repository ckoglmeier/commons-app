import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvironmentAliases } from "./environment-aliases";

test("Supabase Marketplace names fill the Commons names", () => {
  const env: Record<string, string | undefined> = {
    POSTGRES_URL: "postgres://pooled.example.test/db", POSTGRES_URL_NON_POOLING: "postgres://direct.example.test/db",
    SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key", SUPABASE_SECRET_KEY: "secret-key",
  };
  assert.deepEqual(applyEnvironmentAliases(env).sort(), ["DATABASE_DIRECT_URL", "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  assert.equal(env.DATABASE_URL, "postgres://pooled.example.test/db");
  assert.equal(env.DATABASE_DIRECT_URL, "postgres://direct.example.test/db");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "https://project.supabase.co");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "anon-key");
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "secret-key");
});

test("Commons's own names win, and nothing is filled from empty values", () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: "postgres://mine.example.test/db", POSTGRES_URL: "postgres://other.example.test/db", SUPABASE_URL: "  " };
  applyEnvironmentAliases(env);
  assert.equal(env.DATABASE_URL, "postgres://mine.example.test/db");
  assert.equal(env.DATABASE_DIRECT_URL, "postgres://mine.example.test/db", "migrations fall back to the pooled URL");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, undefined);
});
