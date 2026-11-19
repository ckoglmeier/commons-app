"use client";
import { useRef, useState, type DragEvent, type PointerEvent } from "react";
/** Drag only the handle so text selection and editing remain ordinary text interactions. */
export function useItinerarySectionReorder(move:(source:string,target:string)=>void, disabled=false) {
  const dragged=useRef<string|null>(null), pointer=useRef<string|null>(null), [over,setOver]=useState<string|null>(null);
  const finish=(target:string|null)=>{const source=dragged.current??pointer.current;if(!disabled && source && target && source!==target) move(source,target);dragged.current=null;pointer.current=null;setOver(null);};
  return {
    sectionProps:(id:string)=>({"data-itinerary-section":id,"data-drop-target":over===id,onDragOver:(event:DragEvent)=>{if(!disabled && dragged.current){event.preventDefault();event.dataTransfer.dropEffect="move";setOver(id);}},onDrop:(event:DragEvent)=>{if(dragged.current){event.preventDefault();finish(id);}}}),
    handleProps:(id:string)=>({draggable:!disabled,disabled,onDragStart:(event:DragEvent)=>{if(disabled){event.preventDefault();return;}dragged.current=id;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id);},onDragEnd:()=>finish(null),
      onPointerDown:(event:PointerEvent<HTMLButtonElement>)=>{if(disabled || event.pointerType==="mouse")return;pointer.current=id;event.currentTarget.setPointerCapture(event.pointerId);},
      onPointerMove:(event:PointerEvent<HTMLButtonElement>)=>{if(!pointer.current)return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-itinerary-section]");setOver(target?.getAttribute("data-itinerary-section")??null);},
      onPointerUp:(event:PointerEvent<HTMLButtonElement>)=>{if(!pointer.current)return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest("[data-itinerary-section]");finish(target?.getAttribute("data-itinerary-section")??null);},onPointerCancel:()=>finish(null)}),
  };
}
export function reorderSections<T>(values:T[],source:string,target:string,id:(value:T)=>string):T[] {
  const from=values.findIndex(value=>id(value)===source),to=values.findIndex(value=>id(value)===target);
  if(from<0 || to<0 || from===to)return values;
  const next=[...values], [section]=next.splice(from,1);next.splice(to,0,section);return next;
}
