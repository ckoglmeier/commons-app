import "server-only";
import { attachBigQuestionPoll, decideBigQuestion, markTripGoing, readBigQuestions, saveTripBrief, setTripExperience, tripHasPaidHelp } from "@commons/database";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { authenticatedCommonsRepositoryOptions } from "./commons";
import { commonsDatabaseUrl } from "./runtime-environment";

/** docs/TRIP-STAGES-DIRECTION.md. Everything here follows the master flag; with it off, every trip behaves as before. */
export function tripStagesEnabled() { return betaReworkEnabled(); }

async function options() {
  const resolved = await authenticatedCommonsRepositoryOptions();
  if (!resolved) throw new Error("Commons database persistence is not configured.");
  return resolved;
}

export async function loadBigQuestions(slug: string) { return readBigQuestions(slug, await options()); }
export async function linkBigQuestionPoll(slug: string, input: unknown) { return attachBigQuestionPoll(slug, input, await options()); }
export async function decideTripQuestion(slug: string, input: unknown) { return decideBigQuestion(slug, input, await options()); }
export async function saveBrief(slug: string, input: unknown) { return saveTripBrief(slug, input, await options()); }
export async function changeTripExperience(slug: string, input: unknown) { return setTripExperience(slug, input, await options()); }
export async function declareTripGoing(slug: string) { return markTripGoing(slug, await options()); }

/** Whether AI poll help is unlocked. With the flag off nothing is held back, so behavior matches main. */
export async function pollHelpUnlocked(slug: string) {
  if (!betaReworkEnabled()) return true;
  const url = commonsDatabaseUrl();
  return url ? tripHasPaidHelp(slug, url) : false;
}
