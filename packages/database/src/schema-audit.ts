import postgres from "postgres";
import {
  readSchemaContract,
  schemaContractFingerprint,
  schemaContractSummary,
} from "./schema-contract";
import { CANONICAL_SCHEMA_FINGERPRINT } from "./migration-state";

const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
// Database-free preview projects can compile the app without production access.
// Production and local audits still require a database and fail closed below.
if (!databaseUrl && process.env.VERCEL_ENV === "preview") {
  console.log("Skipping schema audit in database-free Vercel preview.");
  process.exit(0);
}
if (!databaseUrl) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required to audit the database schema.");

const client = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

try {
  const contract = await readSchemaContract(client);
  const fingerprint = schemaContractFingerprint(contract);
  console.log(`Commons schema fingerprint: ${fingerprint}`);
  console.log(`Commons schema inventory: ${JSON.stringify(schemaContractSummary(contract))}`);
  if (
    process.env.COMMONS_SCHEMA_AUDIT_EXPECT_CANONICAL === "true"
    && process.env.VERCEL_ENV !== "preview"
    && fingerprint !== CANONICAL_SCHEMA_FINGERPRINT
  ) {
    throw new Error(
      `Expected canonical schema fingerprint ${CANONICAL_SCHEMA_FINGERPRINT}, received ${fingerprint}.`,
    );
  }
  if (process.env.COMMONS_SCHEMA_AUDIT_DETAILS === "true") {
    for (const [section, rows] of Object.entries(contract)) {
      for (const row of rows) {
        console.log(`Commons schema contract ${section}: ${JSON.stringify(row)}`);
      }
    }
  }
} finally {
  await client.end();
}
