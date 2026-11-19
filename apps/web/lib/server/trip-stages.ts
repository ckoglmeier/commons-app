import "server-only";
import { attachBigQuestionPoll, decideBigQuestion, markTripGoing, readBigQuestions, saveTripBrief, setTripExperience } from "@commons/database";
import { authenticatedCommonsRepositoryOptions } from "./commons";

/** docs/TRIP-STAGES-DIRECTION.md. */

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
