import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { useMapCity } from "./use-map-city";
import { createHookRenderer } from "../lib/test-support/hook-harness";

test("city lookup is opt-in, ignores late old-city responses, and requires choosing ambiguous cities", async () => {
  const original = globalThis.fetch, requests: string[] = [];
  let releaseOld: (response: Response) => void = () => {};
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url.includes("Old")) return new Promise<Response>(resolve => { releaseOld = resolve; });
    return Response.json({ matches: [{ id: "nm", label: "Santa Fe, New Mexico", latitude: 35.69, longitude: -105.94 }, { id: "ar", label: "Santa Fe, Argentina", latitude: -31.63, longitude: -60.7 }] });
  }) as typeof fetch;
  let state: ReturnType<typeof useMapCity>;
  function Probe({ destination, enabled }: { destination: string; enabled: boolean }) { state = useMapCity(destination, enabled); return null; }
  const renderer = createHookRenderer({ expand: [Probe] });
  // Let the mocked fetch and its JSON body settle on any Node version, not a fixed count of microtasks.
  const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 0)); renderer.flush(); } };
  const cityId = () => state?.city?.id;
  try {
    renderer.render(createElement(Probe, { destination: "Old", enabled: false }));
    assert.equal(requests.length, 0);
    renderer.render(createElement(Probe, { destination: "Old", enabled: true }));
    renderer.render(createElement(Probe, { destination: "Santa Fe", enabled: true })); await flush();
    assert.equal(state!.city, null); assert.equal(state!.matches.length, 2);
    state!.choose(state!.matches[0]); renderer.flush(); assert.equal(cityId(), "nm");
    releaseOld(Response.json({ matches: [{ id: "old", label: "Old city", latitude: 0, longitude: 0 }] })); await flush();
    assert.equal(cityId(), "nm");
    renderer.render(createElement(Probe, { destination: "Other", enabled: true }));
    assert.equal(state!.city, null, "the previous trip city cannot frame a different reported destination");
  } finally { renderer.unmount(); globalThis.fetch = original; }
});
