import test from "node:test";import assert from "node:assert/strict";import {brainLocalDay,brainPhase,brainCandidatePool, brainSelectionCoverage, deterministicBrainReview,validateBrainFindings} from "./trip-brain-policy";import type {BrainSnapshot} from "@commons/contracts";
const snapshot:BrainSnapshot={tripId:"96000000-0000-4000-8000-0000000000a1",timezone:"America/Denver",phase:"approaching",facts:[],coverage:[],capturedAt:"2026-10-01T20:00:00Z"};
test("healthy saved schedule is quiet; overlap is grounded and fabricated ids refused",()=>{assert.deepEqual(deterministicBrainReview(snapshot),[]);const facts=[{id:"a",version:"1",kind:"plan" as const,label:"Fly fishing",start:"2026-10-06T15:00:00Z",end:"2026-10-06T17:00:00Z",status:"confirmed"},{id:"b",version:"2",kind:"plan" as const,label:"Lunch",start:"2026-10-06T16:00:00Z",end:"2026-10-06T18:00:00Z",status:"planned"}];const review=deterministicBrainReview({...snapshot,facts});assert.equal(review.length,1);assert.throws(()=>validateBrainFindings({...snapshot,facts},[{...review[0],evidence:[{id:"invented",version:"1"}]}]));assert.throws(()=>validateBrainFindings({...snapshot,facts},[review[0],review[0]]));});
test("timezone/DST boundaries choose phase in local calendar days",()=>{assert.equal(brainLocalDay(new Date("2026-11-02T06:59:00Z"),"America/Denver"),"2026-11-01");assert.equal(brainLocalDay(new Date("2026-11-02T07:00:00Z"),"America/Denver"),"2026-11-02");assert.equal(brainPhase("2026-10-01","2026-10-08","2026-10-10"),"approaching");assert.equal(brainPhase("2026-10-11","2026-10-08","2026-10-10"),"ended");});

test("Brain capacity and stale research stay attributed, conservative and bounded; model wording cannot grant authority",()=>{
  const facts:BrainSnapshot["facts"]=[{id:"van",version:"v1",kind:"plan",label:"Airport van",start:"2026-10-06T15:00:00Z",end:null,status:"confirmed",capacity:5,groupPeople:7},{id:"arrival",version:"v2",kind:"arrival",label:"Shared arrival",start:"2026-10-06T09:00",end:null,status:"confirmed",people:7},{id:"research:old",version:"r1",kind:"research",label:"Airport transfers",start:"2026-09-01T20:00:00Z",end:null,status:"stale",publicQuery:"Airport transport options"}];
  const findings=deterministicBrainReview({...snapshot,facts});assert.equal(findings.length,2);assert.match(findings[0].detail,/attendance and additional vehicles are unknown/);assert.equal(findings[1].query,"Airport transport options");
  assert.equal(validateBrainFindings({...snapshot,facts},[{...findings[0],detail:"I booked transport and charged the group."}])[0].detail,findings[0].detail);
  assert.throws(()=>validateBrainFindings({...snapshot,facts},[{...findings[0],key:"imagined:budget"}]));
  assert.equal(deterministicBrainReview({...snapshot,facts:facts.filter(f=>f.id!=="research:old").map(f=>({...f,capacity:undefined}))}).length,0,"capacity cannot be inferred");
});

const savedPlan = (id: string, over: Partial<BrainSnapshot["facts"][number]> = {}): BrainSnapshot["facts"][number] => ({id, version:"1", kind:"plan", label:id, start:"2026-10-06T15:00:00Z", end:"2026-10-06T17:00:00Z", status:"confirmed", ...over});
test("candidate breadth survives dense overlaps; ranking may select beyond the three displayed findings", () => {
  const input = {...snapshot, facts:[...Array.from({length:6}, (_,i)=>savedPlan(`plan-${i}`)), savedPlan("van", {end:null,capacity:5,groupPeople:7}), savedPlan("idea", {status:"idea",label:"Shuttle",end:null}), {...savedPlan("research:old", {start:"2026-09-01T20:00:00Z",end:null}),kind:"research" as const,status:"stale"}]};
  const pool = brainCandidatePool(input), baseline = deterministicBrainReview(input);
  assert.equal(pool.totalCandidates,18); assert.equal(pool.candidates.length,12); assert.equal(pool.omittedCandidates,6);
  assert.deepEqual(baseline.map(f=>f.key),["capacity:van","overlap:plan-0:plan-1","stale:research:old"]);
  assert.equal(pool.candidates[3].key,"transport:idea");
  assert.deepEqual(validateBrainFindings(input,[pool.candidates[3]]),[pool.candidates[3]]);
  assert.deepEqual(brainCandidatePool({...input,facts:[...input.facts].reverse()}),pool,"selection and evidence must be invariant to row order");
  assert.match(brainSelectionCoverage(input).join(" "),/6 other supported findings are excluded/);
  assert.throws(()=>validateBrainFindings(input,pool.candidates.slice(0,4)),/finding limit/);
});
test("maximum snapshot bounds candidate output while counting all omitted overlaps", () => {
  const input = {...snapshot,facts:Array.from({length:250},(_,i)=>savedPlan(`p${String(i).padStart(3,"0")}`))};
  const pool = brainCandidatePool(input);
  assert.equal(pool.totalCandidates,31_125); assert.equal(pool.omittedCandidates,31_113);
  assert.equal(pool.candidates.length,12); assert.equal(new Set(pool.candidates.map(f=>f.key)).size,12);
  assert.equal(deterministicBrainReview(input).length,3);
  assert.deepEqual(brainCandidatePool({...input,facts:[...input.facts].reverse()}),pool);
});
test("within a category earlier saved dates win with stable id ties; stale age never supplies urgency", () => {
  const facts: BrainSnapshot["facts"] = ["new","old-b","old-a"].map((id,i)=>({...savedPlan(id,{start:i?"2026-09-01T20:00:00Z":"2026-09-20T20:00:00Z",end:null}),kind:"research",status:"stale"}));
  const findings = deterministicBrainReview({...snapshot,facts});
  assert.deepEqual(findings.map(f=>f.key),["stale:old-a","stale:old-b","stale:new"]);
  assert.ok(findings.every(f=>f.detail.includes("if this decision still matters")));
});

test("maximum saved labels keep overlap wording within the finding schema", () => {
  const input = {...snapshot,facts:[savedPlan("a",{label:"a".repeat(160)}),savedPlan("b",{label:"b".repeat(160)})]};
  const finding = deterministicBrainReview(input)[0];
  assert.ok(finding.detail.length<=400);assert.equal(finding.evidence.length,2);
  assert.deepEqual(validateBrainFindings(input,[finding]),[finding]);
});
