import "server-only";

import { randomInt } from "node:crypto";
import { writingSmokeCases, writingSmokeChecks } from "../writing-smoke-contract";

export const writingSmokeChallenger = "google/gemini-3.6-flash";

export type WritingSmokeResult = { title: string; label: "A" | "B"; text: string; checks: string[] };

async function complete(apiKey: string, model: string, brief: string, signal?: AbortSignal) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-OpenRouter-Title": "Commons private writing smoke" },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 500,
      provider: { require_parameters: true, data_collection: "deny", zdr: true },
      messages: [
        { role: "system", content: "You write concise, warm product copy for Commons, a group-trip planning app. Never claim Commons can book, pay, send a message, change a plan, access a calendar, or take action outside an explicit human step. Return only the requested copy; no preamble or explanation." },
        { role: "user", content: brief },
      ],
    }),
  });
  if (!response.ok) throw new Error("The writing comparison could not be completed.");
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("The writing comparison returned no usable draft.");
  return text.trim();
}

/** Fixed, de-identified provider smoke. It never reads or writes Commons data. */
export async function runWritingSmoke(input: { apiKey?: string; baseline?: string; signal?: AbortSignal }) {
  if (!input.apiKey?.trim() || !input.baseline?.trim()) throw new Error("Writing comparison is not connected.");
  const models: Record<"A" | "B", string> = randomInt(2) === 0
    ? { A: input.baseline, B: writingSmokeChallenger }
    : { A: writingSmokeChallenger, B: input.baseline };
  const results: WritingSmokeResult[] = [];
  for (const [title, brief] of writingSmokeCases) {
    for (const label of ["A", "B"] as const) {
      const text = await complete(input.apiKey, models[label], brief, input.signal);
      results.push({ title, label, text, checks: writingSmokeChecks(text, title) });
    }
  }
  return { results, models };
}
