import { BrainDispositionRequestSchema } from "@commons/contracts";
import { brainState, disposeBrainRecommendation, runDeterministicBrainReview, updateBrainSettings, CoordinatorTurnError } from "@commons/database";
import { authenticatedGoalOptions } from "./polls";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";
export const tripBrainEnabled=()=>readCommonsRuntimeEnvironment().COMMONS_TRIP_BRAIN_ENABLED === "true";
async function options(slug:string){return {...await authenticatedGoalOptions(slug),enabled:tripBrainEnabled(),researchAvailable:false};}
export async function authenticatedBrain(slug:string){if(!tripBrainEnabled())return null;return brainState(slug,await options(slug));}
export async function authenticatedBrainOperation(slug:string,raw:unknown){if(!tripBrainEnabled())throw new CoordinatorTurnError("invalid_request");const input=raw as Record<string,unknown>,scope=await options(slug);if(input.op === "settings")return updateBrainSettings(slug,{commandId:input.commandId,optedIn:input.optedIn,paused:input.paused},scope);if(input.op === "review")return runDeterministicBrainReview(slug,scope);return disposeBrainRecommendation(slug,BrainDispositionRequestSchema.parse(raw),scope);}
