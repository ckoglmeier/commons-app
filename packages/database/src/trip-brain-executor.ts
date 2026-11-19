import { BrainExecutionSchema, type BrainFinding, type BrainSnapshot } from "@commons/contracts";
import { brainCandidatePool } from "@commons/domain";
import { beginBrainReview, finishBrainReview, type BrainOptions } from "./trip-brain-repository";

/** Provider-neutral one-call adapter. No tools, escalation, recursive work or repair calls. */
export type BrainModelAdapter = (request: {
  model: string; promptVersion: "brain-select-v1"; snapshot: BrainSnapshot; candidates: BrainFinding[];
  maxOutputTokens: number; signal: AbortSignal;
}) => Promise<{ findingKeys: unknown; inputTokens: number; outputTokens: number }>;
export type BrainModelPolicy = {
  enabled: boolean; model: string; worstCaseCents: number; monthlyTripCents: number; monthlyGlobalCents: number;
  inputCentsPerMillion: number; outputCentsPerMillion: number;
};
const INPUT_CHARS = 24_000, OUTPUT_TOKENS = 800, TIMEOUT_MS = 30_000;
/** One reservation precedes inference, and settlement/revalidation precedes publication. Not wired to production scheduling. */
export async function runBoundedBrainReview(identifier: string, options: BrainOptions, policy: BrainModelPolicy, adapter: BrainModelAdapter) {
  if (!policy.enabled) return { dispatched: false, reason: "model_disabled" };
  if (!policy.model.trim() || policy.model.length > 120 || ![policy.inputCentsPerMillion,policy.outputCentsPerMillion].every(n=>Number.isSafeInteger(n)&&n>=0) || !Number.isSafeInteger(policy.worstCaseCents) || policy.worstCaseCents <= 0) throw new Error("Invalid bounded review policy");
  // UTF-8 bytes conservatively bound tokens. No model/version pricing is assumed by code.
  const worstTokens = INPUT_CHARS * 4 + 4000;
  const expectedReserve = Math.ceil((worstTokens * policy.inputCentsPerMillion + OUTPUT_TOKENS * policy.outputCentsPerMillion)/1_000_000);
  if (policy.worstCaseCents < expectedReserve) throw new Error("Review reservation does not cover its bounded request");
  const start = await beginBrainReview(identifier,{worstCaseCents:policy.worstCaseCents,modelPolicy:"bounded-model-v1",monthlyTripCents:policy.monthlyTripCents,monthlyGlobalCents:policy.monthlyGlobalCents},options);
  if (!start.dispatched) return start;
  const at=Date.now(),candidates=brainCandidatePool(start.snapshot).candidates,signal=AbortSignal.timeout(TIMEOUT_MS);
  let findings:unknown=null, spend:number|null=null, inputTokens:number|null=null, outputTokens:number|null=null;
  let error: "provider_failed" | "invalid_usage" | "invalid_output" | null=null;
  try {
    if(JSON.stringify({snapshot:start.snapshot,candidates}).length>INPUT_CHARS){spend=0;throw new Error("Input exceeds bound before dispatch");}
    // Race the signal as well as passing it: an adapter which ignores cancellation cannot keep a reservation open.
    const abort = new Promise<never>((_,reject)=>signal.addEventListener("abort",()=>reject(new Error("Review timed out")),{once:true}));
    const result=await Promise.race([adapter({model:policy.model,promptVersion:"brain-select-v1",snapshot:start.snapshot,candidates,maxOutputTokens:OUTPUT_TOKENS,signal}),abort]);
    if(![result.inputTokens,result.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)||result.inputTokens>worstTokens||result.outputTokens>OUTPUT_TOKENS){error="invalid_usage";throw new Error("Invalid usage");}
    inputTokens=result.inputTokens;outputTokens=result.outputTokens;
    const cost=Math.ceil((inputTokens*policy.inputCentsPerMillion+outputTokens*policy.outputCentsPerMillion)/1_000_000);
    if(cost>policy.worstCaseCents){error="invalid_usage";throw new Error("Usage exceeded reservation");}
    spend=cost;
    if(!Array.isArray(result.findingKeys)||result.findingKeys.length>3||new Set(result.findingKeys).size!==result.findingKeys.length||result.findingKeys.some(key=>!candidates.some(candidate=>candidate.key===key))){error="invalid_output";throw new Error("Invalid findings");}
    findings=result.findingKeys.map(key=>candidates.find(candidate=>candidate.key===key)!);
  } catch { error??="provider_failed"; }
  const execution=BrainExecutionSchema.parse({model:policy.model,promptVersion:"brain-select-v1",inputTokens,outputTokens,latencyMs:Date.now()-at,error});
  // Invalid output fails closed and is not repaired with another paid call. Unknown usage consumes the reservation.
  return finishBrainReview(start.reviewId,findings,spend,options,execution);
}
