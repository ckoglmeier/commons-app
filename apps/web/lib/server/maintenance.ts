import "server-only";
import { completePhotoDeletion, expireEventDraftSources, getPhotoDeletionCounts, leasePhotoDeletion } from "@commons/database";
import { deleteCommonsPhotoObject } from "@/lib/supabase/admin";

export async function runCommonsMaintenance(limit = 20) {
  const expiredSources = await expireEventDraftSources();
  let deleted = 0;
  for (let index = 0; index < limit; index++) {
    const job = await leasePhotoDeletion();
    if (!job) break;
    try {
      await deleteCommonsPhotoObject(job.storagePath);
      if (await completePhotoDeletion(job.id, job.leaseAttempt, true)) deleted++;
    } catch {
      await completePhotoDeletion(job.id, job.leaseAttempt, false);
    }
  }
  const outstanding = await getPhotoDeletionCounts();
  if (outstanding.some(row => row.status === "failed")) console.error("Commons photo deletion requires operator retry.", { outstanding });
  return { expiredSources, deleted, outstanding };
}
