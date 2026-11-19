import type { ReactNode } from "react";
import type { ItineraryPollSnapshot } from "@commons/contracts";
import { EditableProse } from "./editable-prose";
import { itineraryMessageContent, type ItineraryMessageSource } from "@/lib/itinerary-message";
import { ItineraryDocument } from "./itinerary-document";
export function ItineraryMessage({ data, children, onPrompt, onTitleChange, onOpeningChange, onItineraryChange, disabled = false, textLimits, allowLegacy = false }: { data: ItineraryMessageSource; allowLegacy?: boolean; children?: ReactNode; textLimits?: {title:number;note:number;day:number}; disabled?: boolean; onTitleChange?: (title:string)=>void; onOpeningChange?: (opening:string)=>void; onItineraryChange?: (itinerary:ItineraryPollSnapshot)=>void; onPrompt?: (prompt: string) => void }) {
  const message = itineraryMessageContent(data, allowLegacy);
  if (!message) return null;
  // Preserve list semantics in Safari when the shared outline hides its markers.
  // eslint-disable-next-line jsx-a11y/no-redundant-roles
  return <section className="itinerary-message" aria-label="Itinerary message"><h2>{onTitleChange ? <EditableProse label="Itinerary title" value={message.itinerary.title} maxLength={120} disabled={disabled} onChange={onTitleChange} /> : message.itinerary.title}</h2>{onOpeningChange ? <EditableProse label="Opening for the group" value={message.opening.join("\n\n")} maxLength={1500} disabled={disabled} onChange={onOpeningChange} /> : message.opening.map((paragraph,index)=><p key={index}>{paragraph}</p>)}{children ?? <ItineraryDocument itinerary={message.itinerary} showTitle={false} onChange={onItineraryChange} editingMode="text" textLimits={textLimits} disabled={disabled} />}{message.questions.length ? <ul className="itinerary-message-questions" role="list">{message.questions.map(question=><li key={question.id}>{onPrompt ? <button type="button" className="cm-action" onClick={()=>onPrompt(question.prompt)}>{question.prompt}</button> : question.prompt}</li>)}</ul> : null}{message.links.map(link=><p key={link.url}><a href={link.url}>{link.label}</a></p>)}{onItineraryChange ? <EditableProse label="Closing for the group" value={message.closing} maxLength={1000} disabled={disabled} onChange={closing=>onItineraryChange({...message.itinerary,closing})} /> : message.closing ? <p>{message.closing}</p> : null}</section>;
}
