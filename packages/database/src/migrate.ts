import postgres from "postgres";
import { runDatabaseMigrations } from "./migration-state";

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping database migrations in Vercel ${process.env.VERCEL_ENV}.`);
  process.exit(0);
}

const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;

if (!directUrl) {
  throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required to run migrations.");
}

const client = postgres(directUrl, { max: 1, prepare: false, connect_timeout: 10 });

try {
  const state = await runDatabaseMigrations(client, "./migrations");
  console.log(`Database migration state: ${state}.`);
} finally {
  await client.end();
}
