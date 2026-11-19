"use client";
import { useLayoutEffect, useRef } from "react";
/** Text remains the document; the native textarea preserves selection and keyboard access. */
export function EditableProse({label,value,onChange,maxLength,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;maxLength:number;disabled?:boolean}) {
  const ref=useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(()=>{
    const input=ref.current; if(!input) return;
    const fit=()=>{if(!input.clientWidth)return;input.style.height="auto";input.style.height=`${Math.max(44,input.scrollHeight+2)}px`;};
    fit();
    // Work stays mounted while hidden. Refit when it opens or its column reflows.
    if(typeof ResizeObserver==="undefined")return;
    let width=input.clientWidth;
    const observer=new ResizeObserver(()=>{const next=input.clientWidth;if(next!==width){width=next;fit();}});
    observer.observe(input);
    return ()=>observer.disconnect();
  },[value]);
  return <textarea ref={ref} className="itinerary-editable-prose" aria-label={label} value={value} maxLength={maxLength} rows={1} disabled={disabled} onChange={event=>onChange(event.target.value)} />;
}
