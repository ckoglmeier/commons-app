import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { pathToFileURL } from "node:url";

export async function bootstrapTestDatabase(databaseUrl: string) {
  if (process.env.NODE_ENV === "production") throw new Error("The disposable test bootstrap cannot run in production.");
  const database = createDatabase(databaseUrl);
  try {
    await database.db.execute(sql`
      DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
      END
      $role$
    `);
    await database.db.execute(sql`CREATE SCHEMA IF NOT EXISTS auth`);
    await database.db.execute(sql`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$
    `);
    await database.db.execute(sql`CREATE SCHEMA IF NOT EXISTS storage`);
    await database.db.execute(sql`
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean DEFAULT false NOT NULL,
        file_size_limit bigint,
        allowed_mime_types text[]
      )
    `);
    await database.db.execute(sql`
      CREATE TABLE IF NOT EXISTS storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text NOT NULL,
        name text NOT NULL
      )
    `);
    await database.db.execute(sql`ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`);
    await database.db.execute(sql`GRANT USAGE ON SCHEMA auth, storage, public TO authenticated, anon`);
    await database.db.execute(sql`GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated`);
    await database.db.execute(sql`
      CREATE OR REPLACE FUNCTION storage.foldername(name text)
      RETURNS text[]
      LANGUAGE sql
      IMMUTABLE
      AS 'SELECT string_to_array(name, ''/'')'
    `);
    console.log("Disposable database compatibility layer ready.");
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrl = process.env.DATABASE_DIRECT_URL;
  if (!databaseUrl) throw new Error("DATABASE_DIRECT_URL is required to bootstrap the disposable test database.");
  if (process.env.COMMONS_RESET_TEST_DATABASE === "true") {
    const hostname = new URL(databaseUrl).hostname;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
      throw new Error("Refusing to reset a database that is not local.");
    }
    if (process.env.NODE_ENV === "production") throw new Error("Cannot reset a production database.");
    const resetClient = postgres(databaseUrl, { max: 1 });
    try {
      await resetClient`DROP SCHEMA IF EXISTS public CASCADE`;
      await resetClient`DROP SCHEMA IF EXISTS drizzle, auth, storage CASCADE`;
      await resetClient`CREATE SCHEMA public`;
    } finally { await resetClient.end(); }
  }
  await bootstrapTestDatabase(databaseUrl);
}
