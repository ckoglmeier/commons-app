"use client";
import { useEffect, useState } from "react";
type Intake = {id:string;commonsId:string;ownerPersonId:string;kind:string;revision:number;status:string;draft?:{travelSegments?:Array<{kind:string}>}|null};
/** Overview and the trip tasks read the same private intake state before suggesting arrival work. */
export function useTripTaskIntakes(slug:string, enabled:boolean) {
  const [intakes,setIntakes]=useState<Intake[]>([]);
  const [intakeState,setIntakeState]=useState<"loaded"|"unavailable">(enabled ? "unavailable" : "loaded");
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const load=()=>{void fetch(`/api/v1/commons/${slug}/confirmations/intakes`,{cache:"no-store"}).then(async response=>{
      if(!response.ok)throw new Error("unavailable");
      const body=await response.json();
      if(!Array.isArray(body.intakes))throw new Error("unavailable");
      if(active){setIntakes(body.intakes);setIntakeState("loaded");}
    }).catch(()=>{if(active)setIntakeState("unavailable");});};
    load();const timer=window.setInterval(load,15000);window.addEventListener("focus",load);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",load);};
  },[slug,enabled]);
  return {intakes,setIntakes,intakeState,setIntakeState};
}
