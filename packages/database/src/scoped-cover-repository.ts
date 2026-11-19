import { PollPublicIdSchema } from "@commons/contracts";
import { and, eq, ne } from "drizzle-orm";
import { pollViewerAccess, type PollViewer } from "./poll-access";
import { createDatabase } from "./client";
import { commons, invitations, polls } from "./schema";
import { readTripInviteGate } from "./trip-activation-repository";
import { hashOpaqueToken } from "./tokens";

export type ScopedCoverAsset = { storagePath: string; mimeType: string };

export async function getPublicPollCoverAssetByPublicId(publicId: string, databaseUrl?: string, viewer?: PollViewer): Promise<ScopedCoverAsset | null> {
  const normalized = PollPublicIdSchema.safeParse(publicId.toLowerCase());
  if (!normalized.success) return null;
  const database = createDatabase(databaseUrl);
  try {
    const [asset] = await database.db.select({
      storagePath: commons.coverOriginalStoragePath,
      mimeType: commons.coverMimeType,
      commonsId: polls.commonsId,
      createdByPersonId: polls.createdByPersonId,
      audience: polls.audience,
    }).from(polls)
      .innerJoin(commons, eq(polls.commonsId, commons.id))
      .where(and(eq(polls.publicId, normalized.data), ne(polls.status, "revoked")))
      .limit(1);
    if (!asset || !(await pollViewerAccess(database.db, asset, viewer)).allowed) return null;
    return asset.storagePath && asset.mimeType ? { storagePath: asset.storagePath, mimeType: asset.mimeType } : null;
  } finally {
    await database.close();
  }
}

export async function getInvitationCoverAssetByToken(token: string, databaseUrl?: string): Promise<ScopedCoverAsset | null> {
  const database = createDatabase(databaseUrl);
  try {
    const [asset] = await database.db.select({
      commonsId: commons.id,
      storagePath: commons.coverOriginalStoragePath,
      mimeType: commons.coverMimeType,
    }).from(invitations)
      .innerJoin(commons, eq(invitations.commonsId, commons.id))
      .where(and(eq(invitations.tokenHash, hashOpaqueToken(token)), eq(invitations.status, "pending")))
      .limit(1);
    if (asset && !(await readTripInviteGate(database.db, asset.commonsId)).mayEnter) return null;
    return asset?.storagePath && asset.mimeType ? { storagePath: asset.storagePath, mimeType: asset.mimeType } : null;
  } finally {
    await database.close();
  }
}
