import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type CommonsDatabase = ReturnType<typeof createDatabase>;

type ManagedResource<T> = {
  value: T;
  release: () => Promise<void>;
};

export function createResourceRegistry<T extends { close: () => Promise<void> }>(
  factory: (key: string) => T,
) {
  const shared = new Map<string, T>();
  return {
    acquire(key: string, reuse: boolean): ManagedResource<T> {
      if (!reuse) {
        const value = factory(key);
        return { value, release: () => value.close() };
      }
      let value = shared.get(key);
      if (!value) {
        value = factory(key);
        shared.set(key, value);
      }
      return { value, release: async () => undefined };
    },
    async closeShared() {
      const resources = [...shared.values()];
      shared.clear();
      await Promise.all(resources.map((resource) => resource.close()));
    },
    sharedCount() {
      return shared.size;
    },
  };
}

function createPostgresResource(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

const databaseResources = createResourceRegistry(createPostgresResource);

export function shouldReuseDatabaseClient(environment: NodeJS.ProcessEnv = process.env) {
  return Boolean(environment.VERCEL || environment.VERCEL_ENV === "production");
}

export function createDatabase(
  databaseUrl = process.env.DATABASE_URL,
  options: { reuse?: boolean } = {},
) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a Commons database client.");
  }
  const resource = databaseResources.acquire(
    databaseUrl,
    options.reuse ?? shouldReuseDatabaseClient(),
  );
  return {
    db: resource.value.db,
    close: resource.release,
  };
}

export async function closeSharedDatabaseClients() {
  await databaseResources.closeShared();
}
