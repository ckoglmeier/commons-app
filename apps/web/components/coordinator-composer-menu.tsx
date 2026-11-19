"use client";
import { coordinatorTools } from "../lib/coordinator-tools";
import { useEffect, useRef, useState, type RefObject, type KeyboardEvent } from "react";

export const composerAddChoices = [
  { label: "Existing Itinerary", guidance: "Paste the itinerary here, then send it for review. This imports your text; it does not pull in saved Plan automatically." },
  { label: "Files", guidance: "" },
  { label: "ChatGPT or Claude messages", guidance: "Paste the messages here. Commons treats pasted material as source content to review." },
  { label: "Email Thread", guidance: "Paste the email thread here. Include only the trip details you want Commons to review." },
  { label: "Group Chat (SMS, WhatsApp, iMessage)", guidance: "Paste the group messages here. Commons can review pasted text; this does not connect to your messaging accounts." },
] as const;
export const composerHelpChoices = [
  { label: "Pick a date and location", request: "Help me pick dates and a location for this trip." },
  { label: "Find a place to stay", request: "Help me find a place to stay for this trip." },
  { label: "Coordinate transport", request: "Help me coordinate ground transport using the flights people have added to our trip." },
  { label: "Shape the itinerary", request: "Help me shape our itinerary using our saved trip details." },
  { label: "Walk me through my todos", request: "Walk me through my outstanding trip todos." },
] as const;
/** Guided recipes that replace the matching text-only help when recipes are available. Itinerary and todos keep their conversation-first paths. */
export const composerRecipeChoices = [
  { label: "Pick a date and location", path: "ask?new=dates_location" },
  { label: "Confirm who is coming", path: "ask?new=attendance" },
  { label: "Find a place to stay", path: "ask?new=lodging" },
  { label: "Collect food preferences", path: "ask?new=food_preferences" },
  { label: "Coordinate transport", path: "recipes/transport" },
] as const;
export const composerRecipeKeptHelp = composerHelpChoices.filter(choice => choice.label === "Shape the itinerary" || choice.label === "Walk me through my todos");
export function appendComposerHelp(text: string, request: string): string | null {
  const next = text ? `${text}\n\n${request}` : request;
  return next.length > 30000 ? null : next;
}
export function CoordinatorComposerMenu({ disabled, filesDisabled, buttonRef, onFiles, onPasteCategory, onHelp, onTool, searchAvailable = false, recipesBase, onRecipe }: {
  disabled: boolean; filesDisabled: boolean; buttonRef: RefObject<HTMLButtonElement | null>;
  onFiles: () => void; onPasteCategory: (guidance: string) => void; onHelp: (request: string) => void; onTool?: (command: string, guidance: string) => void;
  /** The trip path, such as /c/slug, when guided recipes are available. Absent, the menu is exactly the conversation-first one. */
  searchAvailable?: boolean; recipesBase?: string; onRecipe?: (href: string) => void;
}) {
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:16,bottom:64,maxHeight:400});
  const root=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null);
  const close=(focus=true)=>{setOpen(false);if(focus)requestAnimationFrame(()=>buttonRef.current?.focus());};
  useEffect(()=>{
    if(!open || typeof document==="undefined")return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close(false);};
    const resize=()=>close(false);
    document.addEventListener("pointerdown",outside);window.addEventListener("resize",resize);
    return ()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",resize);};
    // The menu owns dismissal; callbacks do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open]);
  const choose=(action:()=>void)=>{setOpen(false);action();};
  function keys(event:KeyboardEvent<HTMLDivElement>){
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key==="Tab"){event.preventDefault();close();return;}
    if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
    event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();
  }
  function toggle(){
    if(open){close();return;}const rect=buttonRef.current?.getBoundingClientRect();
    if(rect)setPosition({left:Math.max(16,Math.min(rect.left,window.innerWidth-356)),bottom:window.innerHeight-rect.top+8,maxHeight:Math.max(132,rect.top-24)});
    setOpen(true);
  }
  return <div ref={root} className="workspace-composer-menu">
    <button ref={buttonRef} type="button" className="workspace-composer-add cm-action" aria-label="Add sources or get help" aria-haspopup="menu" aria-expanded={open} aria-controls="workspace-composer-menu" disabled={disabled} onClick={toggle} onKeyDown={event=>{if(event.key==="ArrowDown"){event.preventDefault();toggle();}}}><span aria-hidden="true">+</span></button>
    {open ? <div id="workspace-composer-menu" ref={menu} tabIndex={-1} role="menu" aria-label="Add or get help" className="workspace-composer-menu-panel" style={position} onKeyDown={keys}>
      <div role="group" aria-label="Add"><h3>Add</h3>{composerAddChoices.map(choice=><button type="button" role="menuitem" key={choice.label} disabled={choice.label==="Files" && filesDisabled} onClick={()=>choose(()=>choice.label==="Files"?onFiles():onPasteCategory(choice.guidance))}>{choice.label}</button>)}</div>
      {onTool ? <div role="group" aria-label="Tools"><h3>Tools</h3>{coordinatorTools.filter(tool => tool.command !== "/search" || searchAvailable).map(tool => <button type="button" role="menuitem" key={tool.command} onClick={() => choose(() => onTool(tool.command, tool.guidance))}>{tool.label}</button>)}</div> : null}
      <div role="group" aria-label="Help me"><h3>Help me…</h3>{recipesBase&&onRecipe?<>{composerRecipeChoices.map(choice=><button type="button" role="menuitem" key={choice.label} onClick={()=>choose(()=>onRecipe(`${recipesBase}/${choice.path}`))}>{choice.label}</button>)}{composerRecipeKeptHelp.map(choice=><button type="button" role="menuitem" key={choice.label} onClick={()=>choose(()=>onHelp(choice.request))}>{choice.label}</button>)}<button type="button" role="menuitem" onClick={()=>choose(()=>onRecipe(`${recipesBase}/ask`))}>Ask the group</button></>:composerHelpChoices.map(choice=><button type="button" role="menuitem" key={choice.label} onClick={()=>choose(()=>onHelp(choice.request))}>{choice.label}</button>)}</div>
    </div> : null}
  </div>;
}
