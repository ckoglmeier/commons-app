import type { CoordinatorThread, PollWorkingData, PollProperty } from "@commons/contracts";
import { lodgingCost } from "@commons/domain";
/** Shared price estimates are useful here; private contacts and booking references are not. */
function pollContextText(text: string) {
  return text.replace(/https?:\/\/\S+/gi, "[link omitted]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email omitted]")
    .replace(/(?:\+?\d[\d ().-]{8,}\d)/g, value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "[phone or identifier omitted]")
    .replace(/\b(?:confirmation|booking|reservation|record locator|pnr|ticket|account|loyalty)\s*(?:code|number|reference|ref|id|#)?\s*[:#=]?\s*[A-Z0-9-]{4,}\b/gi, "[booking reference omitted]");
}
/** Only explicitly referenced topic data, never old drafting instructions or imports.
 * Canonical trip facts remain separate and take precedence over this packet. */
export function pollTopicPacket(request: string, turns: CoordinatorThread["turns"], threadId: string | null) {
  if (!/\b(?:above|earlier|these|those|that|same|discussed|options|lodging|hotels?|dinner|cost|price|breakdown|table|total|per.person)\b/i.test(request)) return [];
  const topic = /\b(?:lodging|hotels?|rooms?|stays?)\b/i.test(request) ? /\b(?:lodging|hotels?|rooms?|beds?|night|travelers?)\b/i : /\b(?:dinner|restaurants?|tavern|bistro|meal)\b/i.test(request) ? /\b(?:dinner|restaurants?|tavern|bistro|eat|meal)\b/i : /\b(?:dinner|restaurant|tavern|bistro|eat|meal|lodging|hotel|rooms?|beds?|nights?|travelers?)\b/i;
  const relevant=turns.filter(turn => turn.threadId === threadId && (!turn.status || turn.status === "completed") && !turn.workspace?.itineraryInstruction && !turn.workspace?.proposal && !turn.workspace?.tripProposal && topic.test(turn.userText + " " + turn.assistantText) && !/^(?:Source:|Imported|Attached|<)/i.test(turn.userText));
  // Keep bounded human rate sources through discussion and artifact receipts;
  // later model arithmetic is never a replacement source for those prices.
  const rates=relevant.filter(turn=>/\$[\d,.]+\s*(?:per\s+|\/)\s*(?:room|person|group)/i.test(turn.userText)).slice(-3);
  const names=suppliedLodgingRates(rates.map(turn=>turn.userText),"USD").map(row=>row.name);
  const quantitySources=new Map<keyof Quantities,CoordinatorThread["turns"][number]>();
  for(const turn of [...relevant].reverse()) {
    const quantities=lodgingQuantities([turn.userText],names);
    for(const key of ["rooms","nights","travelers"] as const) if(quantities[key] !== null && !quantitySources.has(key)) quantitySources.set(key,turn);
    if(lodgingCorrection(turn.userText) && Object.values(quantities).every(value=>value===null)) break;
  }
  const correction=relevant.findLast(turn=>lodgingCorrection(turn.userText));
  const selected=new Set([...rates,...quantitySources.values(),...(correction ? [correction] : [])]);
  const room=6-selected.size;
  if(room>0) for(const turn of relevant.filter(turn=>!selected.has(turn)).slice(-room)) selected.add(turn);
  return relevant.filter(turn=>selected.has(turn)).map(turn => ({turnId:turn.id, human:pollContextText(turn.userText).slice(0,1800), discussion:pollContextText(turn.assistantText).slice(0,1200)}));
}
const numberWords: Record<string,number> = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
type Quantities = {rooms:number|null;nights:number|null;travelers:number|null};
const quantityPattern = new RegExp(`\\b(\\d{1,3}|${Object.keys(numberWords).join("|")})\\s+(rooms?|nights?|travelers?|people|persons?|adults?|guests?)\\b`,"ig");
const lodgingCorrection = (text:string) => !/[?$]|\b(?:if|maybe|perhaps|could|would|should|available|capacity|sleeps|maximum|has|offers|dinner|lunch|breakfast)\b/i.test(text) && /\b(?:actually|instead|correction|change|update|no longer|only|fewer|more)\b/i.test(text) && /\b(?:rooms?|nights?|travelers?|people|adults?|guests?|us|coming|group|party)\b/i.test(text) && new RegExp(`\\b(?:\\d+|${Object.keys(numberWords).join("|")}|fewer|more|no longer)\\b`,"i").test(text);

/** Only group/stay assumptions and explicit changes are quantities. Property
 * inventory, meal headcounts, questions and hypothetical occupancy are not. */
function lodgingQuantityState(texts:string[], names:string[]) {
  const result:Quantities={rooms:null,nights:null,travelers:null};
  let unresolvedCorrection=false;
  for(const text of texts) {
   let parsed=false;
   let unvalidatedCount=false;
   const correction=lodgingCorrection(text);
   for(const clause of text.replace(new RegExp(`\\b(rooms|nights|travelers|adults|people|guests)\\s*:\\s*(\\d{1,3}|${Object.keys(numberWords).join("|")})\\b`,"ig"),"$2 $1").split(/[.!;\n:]/)) {
    if (/[$?]|\b(?:if|maybe|perhaps|could|would|should|not|never|available|capacity|sleeps|maximum|up to|has|offers|dinner|lunch|breakfast)\b/i.test(clause)) continue;
    if(names.some(name=>clause.toLowerCase().includes(name.toLowerCase()))) continue;
    if(correction && new RegExp(`\\b(?:\\d+|${Object.keys(numberWords).join("|")}|fewer|more)\\b`,"i").test(clause.replace(quantityPattern,""))) unvalidatedCount=true;
    const matches=[...clause.matchAll(quantityPattern)];
    if (!matches.length) continue;
    const remainder=clause.replace(quantityPattern,"").replace(/\b(?:and|for|now|actually|instead|group|party|rooms|nights|travelers|people|persons|adults|guests)\b/ig,"").replace(/[\s,/()—–-]/g,"");
    const scoped=/\b(?:lodging|(?:our|the) (?:group|party|trip|stay)|we (?:are|have|need|will|want)|use|allow|plan for|count on)\b/i.test(clause);
    if(remainder && !scoped) continue;
    for(const match of matches) {
      const value=numberWords[match[1].toLowerCase()] ?? Number(match[1]);
      if(!Number.isInteger(value)||value<=0||value>999) continue;
      const key=/^room/i.test(match[2]) ? "rooms" : /^night/i.test(match[2]) ? "nights" : "travelers";
      result[key]=value;
      parsed=true;
    }
   }
   // A relevant correction that this bounded parser cannot validate invalidates
   // prior assumptions. Never confidently return stale model-free totals.
   if(correction && (!parsed || unvalidatedCount)) {Object.assign(result,{rooms:null,nights:null,travelers:null});unresolvedCorrection=true;}
   if(Object.values(result).every(value=>value!==null)) unresolvedCorrection=false;
  }
  return {quantities:result,unresolvedCorrection};
}
function lodgingQuantities(texts:string[], names:string[]):Quantities {
  return lodgingQuantityState(texts,names).quantities;
}

/** Parse explicit supplied rates, not arbitrary dollar amounts. A record may
 * use prose, bullets, a label separator, or slash notation. */
function suppliedLodgingRates(texts:string[],currency:string) {
  return texts.flatMap(text=>{
    let previousEnd=0;
    return [...text.matchAll(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:per\s+|\/)\s*(room|person|group)\s*(?:per\s+|\/)\s*(night|stay)\b/ig)].flatMap(match=>{
      const prefix=text.slice(previousEnd,match.index);previousEnd=match.index+match[0].length;
      let supplied=prefix.split(/[;\n]|[.!?]\s+/).at(-1)?.trim() ?? "";
      supplied=supplied.replace(/^[\s\S]*\b(?:choices|options)\s*(?:for[^:]{0,120})?:\s*/i,"")
        .replace(/^(?:before taxes(?: and fees)?|taxes and fees unknown|excluding taxes(?: and fees)?)\s*[,—-]\s*/i,"")
        .replace(/^[\s,*•-]*(?:\d+[.)]\s*)?(?:and\s+|we are comparing\s+|compare\s+)?/i,"");
      const name=supplied.split(/\s+[—–-]\s+|:\s*|\s+(?:with|has|offers|at|estimated)\b/i)[0].trim();
      const details=supplied.slice(name.length).replace(/^\s*(?:[—–:-]|with|has|offers)\s*/i,"").replace(/\s*(?:at|estimated|estimate|rate)\s*[:=]?\s*$/i,"").trim();
      const cents=Math.round(Number(match[1].replace(/,/g,""))*100);
      if(name.length<2 || name.length>160 || !Number.isSafeInteger(cents) || cents<0 || cents>100_000_000) return [];
      const pricing:PollProperty["pricing"]={basis:match[2].toLowerCase()==="person" ? "per_person" : match[2].toLowerCase()==="group" ? "total" : "per_room",period:match[3].toLowerCase()==="night" ? "nightly" : "stay",currency,minCents:cents,maxCents:cents,fees:"unknown"};
      return [{name,details:details.slice(0,240),pricing}];
    });
  });
}
export function lodgingEstimates(texts: string[], currency = "USD") {
  const rates=suppliedLodgingRates(texts,currency);
  const {quantities,unresolvedCorrection}=lodgingQuantityState(texts,rates.map(row=>row.name));
  const values=rates.map(({name,details,pricing})=>{
    const estimate = lodgingCost(pricing,quantities);
    const beds=details.split(/[,;.]/).find(part=>/\b(?:beds?|queen|king|twin|suite)\b/i.test(part))?.trim() ?? "";
    const boundedBeds=beds.slice(0,Math.max(0,180-estimate.compactDescription.length-2));
    return {name,pricing,quantities,unresolvedCorrection,...estimate,pollDescription:`${boundedBeds ? `${boundedBeds}. ` : ""}${estimate.compactDescription}`,description:`${details ? `${details}. ` : ""}${estimate.description}`};
  });
  return values.filter((value,index)=>values.findLastIndex(other=>other.name.toLowerCase()===value.name.toLowerCase())===index);
}
export function groundLodgingPoll(data: PollWorkingData, estimates: ReturnType<typeof lodgingEstimates>) {
  return {...data,questions:data.questions.map(question=>question.kind!=="choice" ? question : {...question,options:question.options.map(option=>{
    const estimate=estimates.find(row=>option.label.toLowerCase()===row.name.toLowerCase());
    return estimate ? {...option,description:estimate.pollDescription,...(option.property ? {property:{...option.property,pricing:estimate.pricing}} : {})} : option;
  })})};
}

export function savedPollSchedule(plans: Array<{value:{title:string;scheduledDate?:string|null;startsAt:string|null}}>, timezone:string) {
 return plans.flatMap(plan=>{
  const date = plan.value.scheduledDate ?? (plan.value.startsAt ? new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(plan.value.startsAt)) : null);
  return date ? [{title:plan.value.title,date,weekday:new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`)),timezone}] : [];
 });
}
const WEEKDAY = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/ig;
const EVENT_KIND = /\b(?:breakfast|lunch|dinner|brunch|tasting|hike|hiking|tour|flight|arrival|departure|check.in|check.out|workshop|lesson|party|ceremony|reception|concert)\b/ig;
const normalizeTitle = (title:string) => title.toLowerCase().split(/\s+[—–]\s+/).at(-1)!.replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const containsPhrase = (text:string,phrase:string) => ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ")} `.includes(` ${phrase} `);
/** Match date assertions to their event clause. A generic meal reference may
 * refer to a saved meal; an unrelated Friday activity must not inherit the
 * Thursday dinner merely because both appear in one paragraph. */
export function pollScheduleStatus(data:PollWorkingData, schedule:ReturnType<typeof savedPollSchedule>, request=""):"matched"|"contradiction"|"ambiguous" {
 const texts=[data.title ?? "",data.intro ?? "",data.communication?.heading ?? "",...(data.communication?.paragraphs ?? []),...data.questions.flatMap(q=>[q.prompt,...(q.kind==="choice" ? q.options.flatMap(o=>[o.label,o.description ?? ""]) : [])])];
 const anchors=schedule.map(plan=>({...plan,anchor:normalizeTitle(plan.title),kinds:plan.title.match(EVENT_KIND) ?? []}));
 const requestNames=anchors.filter(plan=>containsPhrase(request,plan.anchor));
 const requestDays=[...new Set((request.match(WEEKDAY) ?? []).map(day=>day.toLowerCase()))];
 const outputDays=[...new Set(texts.flatMap(text=>text.match(WEEKDAY) ?? []).map(day=>day.toLowerCase()))];
 let ambiguous=false;
 const matches=texts.every(text=>{
  let previous:typeof anchors=[];
  return text.split(/[.!?;,\n]|\b(?:and|but|while|followed by|then)\b/i).every(clause=>{
   const exact=anchors.filter(plan=>containsPhrase(clause,plan.anchor));
   const kinds=clause.match(EVENT_KIND) ?? [];
   const generic=exact.length ? [] : anchors.filter(plan=>plan.kinds.some(kind=>kinds.some(found=>found.toLowerCase()===kind.toLowerCase())));
   let referenced=exact.length ? exact : generic;
   const weekdays=clause.match(WEEKDAY) ?? [];
   if(!exact.length && generic.length>1) {
    const named=generic.filter(plan=>requestNames.includes(plan));
    const days=requestDays.length===1 ? requestDays : weekdays.length ? weekdays.map(day=>day.toLowerCase()) : outputDays.length===1 ? outputDays : [];
    referenced=named.length ? named : days.length===1 ? generic.filter(plan=>plan.weekday.toLowerCase()===days[0]) : generic;
    if(!referenced.length) return false;
    if(referenced.length>1) {ambiguous=true;return true;}
   }
   // Only a bare date continuation carries its previous event. A new activity
   // or other prose resets scope rather than tainting the whole paragraph.
   if (!referenced.length && weekdays.length && !kinds.length && !clause.replace(WEEKDAY,"").replace(/\b(?:on|or|at|is|the|also|from|to|am|pm)\b/ig,"").replace(/[\s\d:/—–-]/g,"")) referenced=previous;
   previous=referenced;
   return !referenced.length || weekdays.every(day=>referenced.every(plan=>day.toLowerCase()===plan.weekday.toLowerCase()));
  });
 });
 return !matches ? "contradiction" : ambiguous ? "ambiguous" : "matched";
}
export function pollScheduleMatches(data:PollWorkingData, schedule:ReturnType<typeof savedPollSchedule>,request="") {
 return pollScheduleStatus(data,schedule,request)==="matched";
}
