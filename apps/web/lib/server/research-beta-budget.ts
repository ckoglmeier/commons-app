import "server-only";
import {createHash} from "node:crypto";
import { reserveResearchBetaSpend, settleResearchBetaSpend, ResearchBetaLimitError } from "@commons/database";
import { CoordinatorProviderError } from "./coordinator-errors";
import { isCommonsOperatorRequest } from "./operator-accounts";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";

/** Production research only: persistent conservative accounting, never the QA $35 ledger.
 * One provider call reserves all remaining approval; uncertain billing stops later work.
 * No prompts, keys, URLs or response bodies enter the append-only operator audit ledger. */
export function researchBetaFetch(actorPersonId: string, fetcher: typeof fetch = fetch, options: {
  enabled?: boolean; databaseUrl?: string; prepaidKeySha256?: string;
  reserve?: typeof reserveResearchBetaSpend; settle?: typeof settleResearchBetaSpend; limitExempt?: () => Promise<boolean>;
} = {}): typeof fetch {
  const enabled=options.enabled ?? readCommonsRuntimeEnvironment().COMMONS_RESEARCH_BETA_ENABLED === "true";
  if (!enabled) return fetcher;
  return async (input,init)=> {
    const href=String(input instanceof Request ? input.url : input), body=JSON.parse(String(init?.body ?? "null"));
    const perplexity=href==="https://api.perplexity.ai/v1/agent", openai=href==="https://api.openai.com/v1/chat/completions";
    const tavily=href==="https://api.tavily.com/search" || href==="https://api.tavily.com/extract";
    if (init?.method!=="POST" || !body || (!perplexity&&!openai&&!tavily) || body.stream) throw new CoordinatorProviderError("provider_failed");
    if(perplexity) {
      const pin=options.prepaidKeySha256 ?? readCommonsRuntimeEnvironment().COMMONS_RESEARCH_BETA_PREPAID_KEY_SHA256;
      const key=new Headers(init?.headers).get("authorization")?.replace(/^Bearer /,"") ?? "";
      if(!pin || createHash("sha256").update(key).digest("hex")!==pin) throw new CoordinatorProviderError("provider_not_configured");
    }
    const bytes=Buffer.byteLength(String(init.body)), maxOutput=body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
    if (bytes>192000 || (!tavily && (!Number.isSafeInteger(maxOutput) || maxOutput<1 || maxOutput>6000)) ||
      (perplexity && (body.model!=="openai/gpt-6.1-sol" || body.max_tool_calls>4 || body.max_steps>4)) ||
      (openai && !["gpt-6.1-sol","gpt-6.1-terra","gpt-6-luna","gpt-4.1-mini"].includes(body.model)) ||
      (tavily && (href.endsWith("/search") ? body.search_depth!=="basic" : !Array.isArray(body.urls) || body.urls.length>3 || body.extract_depth!=="basic"))) throw new CoordinatorProviderError("provider_failed");
    // Sol upper-rate estimate by UTF-8 bytes, framing and maximum output; no cache discount.
    const minimum=perplexity ? 850000 : tavily ? 16000 : Math.ceil((bytes+4096)*5+maxOutput*20);
    // An operator isn't held to the shared allowance. The checks above on this one call still apply; this spend isn't in the allowance's ledger.
    if(await (options.limitExempt??isCommonsOperatorRequest)().catch(()=>false)) return fetcher(input,{...init,redirect:"error"});
    let reservation:string;
    try { reservation=await (options.reserve??reserveResearchBetaSpend)(actorPersonId,minimum,options.databaseUrl); }
    catch(error) { if(error instanceof ResearchBetaLimitError) throw new CoordinatorProviderError("research_limited"); throw error; }
    const response=await fetcher(input,{...init,redirect:"error"});
    // Failed/unknown/aborted requests keep their reservation even if usage says zero.
    if (!response.ok) return response;
    const reader=response.clone().body?.getReader(); let size=0; const chunks:Uint8Array[]=[];
    try {
      if(!reader) return response;
      for(;;) {const {done,value}=await reader.read();if(done) break;size+=value.byteLength;if(size>1_000_000) return response;chunks.push(value);}
      const result=JSON.parse(Buffer.concat(chunks).toString("utf8")), usage=result.usage;
      let cost:number|undefined;
      if (perplexity && result.status==="completed" && /^openai\/gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(result.model ?? "") && usage?.cost?.currency==="USD") cost=usage.cost.total_cost;
      else if(openai && result.choices?.[0]?.finish_reason==="stop" && Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens>=0 && Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens>=0) cost=(usage.prompt_tokens*2.5+usage.completion_tokens*10)/1e6;
      // Oct23 official PAYG $0.008/credit; basic search or <=3 basic extracts <=1 credit.
      // Charge that ceiling even for free/keyless/empty results, never assume a free credit.
      else if(tavily) cost=.008;
      if(typeof cost==="number" && Number.isFinite(cost) && cost>=0 && !result.error) {
        await (options.settle??settleResearchBetaSpend)(reservation,actorPersonId,Math.ceil(cost*2*1e6),options.databaseUrl);
      }
    } catch { /* Unknown charge/failed settlement retains the whole reservation. */ }
    finally { void reader?.cancel().catch(()=>{}); }
    return response;
  };
}
