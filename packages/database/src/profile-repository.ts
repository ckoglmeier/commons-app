import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client";
import { commons, conversationDigestDeliveries, conversationDigestItems, memberships, people, travelerProfiles } from "./schema";

const PreferenceTextSchema = z.string().trim().max(500).nullable().optional();
const ProfileUpdateSchema = z.object({
  usualOriginLabel: z.string().trim().max(160).nullable().optional(),
  dietaryPreferences: PreferenceTextSchema,
  accessibilityNeeds: PreferenceTextSchema,
  lodgingPreferences: PreferenceTextSchema,
  transportationPreferences: PreferenceTextSchema,
  dailyDigestEnabled: z.boolean().optional(),
  sharedPreferenceKeys: z.array(z.enum(["usualOriginLabel", "dietaryPreferences", "accessibilityNeeds", "lodgingPreferences", "transportationPreferences"])).max(5).optional(),
}).refine((value) => Object.keys(value).length > 0, "Choose a profile detail to update.");

export type TravelerProfileAttribution = { personId: string; displayName: string } | null;

export type TravelerProfile = {
  personId: string;
  displayName: string;
  usualOriginLabel: string | null;
  dietaryPreferences: string | null;
  accessibilityNeeds: string | null;
  lodgingPreferences: string | null;
  transportationPreferences: string | null;
  suppliedBy: {
    usualOriginLabel: TravelerProfileAttribution;
    dietaryPreferences: TravelerProfileAttribution;
    accessibilityNeeds: TravelerProfileAttribution;
    lodgingPreferences: TravelerProfileAttribution;
    transportationPreferences: TravelerProfileAttribution;
  };
  dailyDigestEnabled: boolean;
  sharedPreferenceKeys?: string[];
};

export class TravelerProfileAccessError extends Error {
  constructor() {
    super("Only this traveler or an explicitly assigned manager can view or change this private profile.");
    this.name = "TravelerProfileAccessError";
  }
}

async function assertManagedTravelerAccess(slug: string, personId: string, actorPersonId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [target] = await database.db
      .select({ authUserId: people.authUserId, commonsId: memberships.commonsId, accessMode: memberships.accessMode, managedByPersonIds: memberships.managedByPersonIds })
      .from(memberships)
      .innerJoin(commons, eq(commons.id, memberships.commonsId))
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(and(eq(commons.slug, slug), eq(memberships.personId, personId), inArray(memberships.status, ["active", "invited"])))
      .limit(1);
    if (!target || (personId !== actorPersonId && (target.authUserId || target.accessMode !== "managed" || !target.managedByPersonIds?.includes(actorPersonId)))) {
      throw new TravelerProfileAccessError();
    }
    const [manager] = await database.db
      .select({ personId: memberships.personId })
      .from(memberships)
      .where(and(eq(memberships.commonsId, target.commonsId), eq(memberships.personId, actorPersonId), eq(memberships.status, "active")))
      .limit(1);
    if (!manager) throw new TravelerProfileAccessError();
    return target.commonsId;
  } finally {
    await database.close();
  }
}

export async function getTravelerProfile(personId: string, databaseUrl?: string): Promise<TravelerProfile | null> {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db
      .select({
        personId: people.id,
        displayName: people.displayName,
        usualOriginLabel: travelerProfiles.usualOriginLabel,
        usualOriginSuppliedByPersonId: travelerProfiles.usualOriginSuppliedByPersonId,
        dietaryPreferences: travelerProfiles.dietaryPreferences,
        dietaryPreferencesSuppliedByPersonId: travelerProfiles.dietaryPreferencesSuppliedByPersonId,
        accessibilityNeeds: travelerProfiles.accessibilityNeeds,
        accessibilityNeedsSuppliedByPersonId: travelerProfiles.accessibilityNeedsSuppliedByPersonId,
        lodgingPreferences: travelerProfiles.lodgingPreferences,
        lodgingPreferencesSuppliedByPersonId: travelerProfiles.lodgingPreferencesSuppliedByPersonId,
        transportationPreferences: travelerProfiles.transportationPreferences,
        transportationPreferencesSuppliedByPersonId: travelerProfiles.transportationPreferencesSuppliedByPersonId,
        dailyDigestEnabled: travelerProfiles.dailyDigestEnabled,
      })
      .from(people)
      .leftJoin(travelerProfiles, eq(travelerProfiles.personId, people.id))
      .where(eq(people.id, personId))
      .limit(1);
    if (!row) return null;
    const supplierIds = [...new Set([
      row.usualOriginSuppliedByPersonId,
      row.dietaryPreferencesSuppliedByPersonId,
      row.accessibilityNeedsSuppliedByPersonId,
      row.lodgingPreferencesSuppliedByPersonId,
      row.transportationPreferencesSuppliedByPersonId,
    ].filter((value): value is string => Boolean(value)))];
    const suppliers = supplierIds.length
      ? await database.db.select({ personId: people.id, displayName: people.displayName }).from(people).where(inArray(people.id, supplierIds))
      : [];
    const supplierById = new Map(suppliers.map((supplier) => [supplier.personId, supplier]));
    const attribution = (supplierId: string | null) => supplierId ? supplierById.get(supplierId) ?? null : null;
    return {
      personId: row.personId,
      displayName: row.displayName,
      usualOriginLabel: row.usualOriginLabel,
      dietaryPreferences: row.dietaryPreferences,
      accessibilityNeeds: row.accessibilityNeeds,
      lodgingPreferences: row.lodgingPreferences,
      transportationPreferences: row.transportationPreferences,
      suppliedBy: {
        usualOriginLabel: attribution(row.usualOriginSuppliedByPersonId),
        dietaryPreferences: attribution(row.dietaryPreferencesSuppliedByPersonId),
        accessibilityNeeds: attribution(row.accessibilityNeedsSuppliedByPersonId),
        lodgingPreferences: attribution(row.lodgingPreferencesSuppliedByPersonId),
        transportationPreferences: attribution(row.transportationPreferencesSuppliedByPersonId),
      },
      dailyDigestEnabled: row.dailyDigestEnabled ?? true,
    };
  } finally {
    await database.close();
  }
}

export async function updateTravelerProfile(personId: string, input: unknown, databaseUrl?: string, suppliedByPersonId = personId): Promise<TravelerProfile> {
  const update = ProfileUpdateSchema.parse(input);
  const database = createDatabase(databaseUrl);
  try {
    const now = new Date();
    const preferenceChanges = {
      ...(update.usualOriginLabel !== undefined ? { usualOriginLabel: update.usualOriginLabel || null, usualOriginSuppliedByPersonId: update.usualOriginLabel ? suppliedByPersonId : null } : {}),
      ...(update.dietaryPreferences !== undefined ? { dietaryPreferences: update.dietaryPreferences || null, dietaryPreferencesSuppliedByPersonId: update.dietaryPreferences ? suppliedByPersonId : null } : {}),
      ...(update.accessibilityNeeds !== undefined ? { accessibilityNeeds: update.accessibilityNeeds || null, accessibilityNeedsSuppliedByPersonId: update.accessibilityNeeds ? suppliedByPersonId : null } : {}),
      ...(update.lodgingPreferences !== undefined ? { lodgingPreferences: update.lodgingPreferences || null, lodgingPreferencesSuppliedByPersonId: update.lodgingPreferences ? suppliedByPersonId : null } : {}),
      ...(update.transportationPreferences !== undefined ? { transportationPreferences: update.transportationPreferences || null, transportationPreferencesSuppliedByPersonId: update.transportationPreferences ? suppliedByPersonId : null } : {}),
    };
    const values = { personId, ...preferenceChanges, ...(update.dailyDigestEnabled !== undefined ? { dailyDigestEnabled: update.dailyDigestEnabled } : {}) };
    const changes = { ...preferenceChanges, ...(update.dailyDigestEnabled !== undefined ? { dailyDigestEnabled: update.dailyDigestEnabled } : {}), updatedAt: now };
    await database.db.transaction(async (transaction) => {
      const [owner] = await transaction.select({authUserId: people.authUserId}).from(people)
        .where(eq(people.id, personId)).for("update").limit(1);
      if (suppliedByPersonId !== personId && owner?.authUserId) throw new TravelerProfileAccessError();
      await transaction.insert(travelerProfiles).values(values).onConflictDoUpdate({ target: travelerProfiles.personId, set: changes });
      if (update.dailyDigestEnabled === false) {
        await transaction.delete(conversationDigestItems).where(and(eq(conversationDigestItems.recipientPersonId, personId), isNull(conversationDigestItems.deliveryId)));
        await transaction.update(conversationDigestDeliveries).set({ status: "cancelled", leaseExpiresAt: null, errorCode: null, updatedAt: now }).where(and(
          eq(conversationDigestDeliveries.recipientPersonId, personId),
          inArray(conversationDigestDeliveries.status, ["queued", "failed", "leased"]),
        ));
      }
    });
  } finally {
    await database.close();
  }
  const profile = await getTravelerProfile(personId, databaseUrl);
  if (!profile) throw new Error("Traveler profile not found.");
  return profile;
}

export async function getManagedTravelerProfile(slug: string, personId: string, actorPersonId: string, databaseUrl?: string) {
  const commonsId = await assertManagedTravelerAccess(slug, personId, actorPersonId, databaseUrl);
  const profile = await getTravelerProfile(personId, databaseUrl);
  if (!profile) return null;
  const database = createDatabase(databaseUrl);
  try {
    const [membership] = await database.db.select({ sharedPreferenceKeys: memberships.sharedPreferenceKeys }).from(memberships)
      .where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, personId))).limit(1);
    return { ...profile, sharedPreferenceKeys: membership?.sharedPreferenceKeys ?? [] };
  } finally {
    await database.close();
  }
}

export async function updateManagedTravelerProfile(slug: string, personId: string, actorPersonId: string, input: unknown, databaseUrl?: string) {
  const commonsId = await assertManagedTravelerAccess(slug, personId, actorPersonId, databaseUrl);
  const update = ProfileUpdateSchema.parse(input);
  if (update.sharedPreferenceKeys !== undefined) {
    const database = createDatabase(databaseUrl);
    try {
      await database.db.transaction(async transaction => {
        // Membership timestamps are admitted source versions. Serialize these
        // sharing changes with workflow validation/CAS and recheck access after
        // acquiring the parent lock, rather than relying on the earlier read.
        const [event] = await transaction.select({ id: commons.id }).from(commons)
          .where(eq(commons.id, commonsId)).for("update").limit(1);
        const [target] = await transaction.select({ status: memberships.status, accessMode: memberships.accessMode, managedByPersonIds: memberships.managedByPersonIds }).from(memberships)
          .where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, personId))).limit(1);
        const [manager] = await transaction.select({ status: memberships.status }).from(memberships)
          .where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, actorPersonId))).limit(1);
        const [owner] = await transaction.select({authUserId: people.authUserId}).from(people)
          .where(eq(people.id, personId)).for("update").limit(1);
        if (!event || !owner || !target || !["active", "invited"].includes(target.status) || manager?.status !== "active"
          || actorPersonId !== personId && (owner.authUserId || target.accessMode !== "managed" || !target.managedByPersonIds?.includes(actorPersonId))) throw new TravelerProfileAccessError();
        await transaction.update(memberships).set({ sharedPreferenceKeys: update.sharedPreferenceKeys, updatedAt: new Date() })
          .where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, personId)));
      });
    } finally {
      await database.close();
    }
  }
  const profileUpdate = { ...update };
  delete profileUpdate.sharedPreferenceKeys;
  if (Object.keys(profileUpdate).length) await updateTravelerProfile(personId, profileUpdate, databaseUrl, actorPersonId);
  const profile = await getManagedTravelerProfile(slug, personId, actorPersonId, databaseUrl);
  if (!profile) throw new Error("Traveler profile not found.");
  return profile;
}
