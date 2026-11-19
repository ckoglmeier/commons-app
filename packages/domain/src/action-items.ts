import type { CommonsState, NextStepDescriptor, TripTask } from "@commons/contracts";
import { travelNextStepDescriptor, type CoordinatorNextStep } from "./coordinator-next-steps";

export type ActionItem = {
  id: string; title: string; detail: string; action: string;
  target: { kind: "poll" | "poll_results" | "travel" | "todo" | "travel_item"; id: string };
  descriptor?: NextStepDescriptor;
};

/** Channel-neutral, saved-state prompts for Overview and messaging.
 * Inputs must already be permission-filtered for this trip and person. Never infer a task from chat prose.
 */
export function actionItems({ tripId, personId, organizer, state, travel, tripTasks = [], today }: {
  tripId: string; personId: string; organizer: boolean; state: CommonsState;
  travel?: CoordinatorNextStep; tripTasks?: readonly TripTask[]; today?: string;
}): ActionItem[] {
  if (state.commonsId !== tripId) return [];
  const items: ActionItem[] = [];
  for (const task of [...tripTasks].filter(task=>task.ownerPersonId === personId && !task.completed).sort((a,b)=>(a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.id.localeCompare(b.id))) {
    items.push({id:`todo:${task.id}`,title:task.title,detail:`${task.suggestedByCommons ? "Suggested by Commons" : "Assigned to you"}${task.dueOn ? ` · Due ${task.dueOn}` : ""}`,action:"Open to-do",target:{kind:"todo",id:task.id}});
  }
  const hasReminder = (id: string) => {
    const travelItem=state.travelPlans?.find(item=>item.id===id);
    const title=travelItem?.kind === "transport" ? `Check pickup time: ${travelItem.route}`.slice(0,160).toLowerCase() : null;
    return tripTasks.some(task=>task.itemKind === "travel" && task.itemId === id || task.suggestionKey === `missing-time:${id}` || title && task.title.trim().toLowerCase() === title);
  };
  for (const poll of state.pollRequests ?? []) if (organizer && poll.canManage && poll.itinerary && !poll.superseded) {
    // The published poll is the durable source for this suggested action.
    // No duplicate human Task or execution goal is created.
    items.push({id:`poll-results:${poll.id}`,title:"Review the poll results",detail:poll.title,action:"Review results",target:{kind:"poll_results",id:poll.id}});
  } else if(poll.status === "open" && !poll.responded && !poll.superseded) {
    items.push({id:`poll:${poll.id}`,title:poll.title,detail:"Your response is still needed.",action:"Answer poll",target:{kind:"poll",id:poll.id}});
  }
  if (travel?.commonsId === tripId && travel.personId === personId && travel.eligibility === "actionable" && !(travel.reason === "arrival_time_missing" && travel.target.planId && hasReminder(travel.target.planId))) {
    const title = travel.reason === "arrival_review" ? "Check your arrival details" : travel.reason === "arrival_intake_failed" ? "Your confirmation needs attention" : travel.reason === "arrival_time_missing" ? "What time will you arrive?" : "How are you getting there?";
    items.push({id:travel.id,title,detail:travel.reason === "arrival_review" ? "Your uploaded confirmation is ready for your private review." : travel.reason === "arrival_intake_failed" ? "The upload couldn’t finish. Review it or enter your details." : travel.reason === "arrival_time_missing" ? "Your arrival is saved without a time." : "No arrival details are saved for you yet.",action:travel.target.canEdit ? "Add or review details" : "View arrival details",target:{kind:"travel",id:travel.id},descriptor:travelNextStepDescriptor(travel)});
  }
  // These are the same suggested to-dos in Overview and messaging.
  // Resolve them from saved state; never infer booking status or write Plan from a reminder.
  if (organizer && today) for (const item of (state.travelPlans ?? []).filter(item=>
    item.kind === "transport" && item.visibility !== "private" && item.date >= today && !item.time && !hasReminder(item.id),
  ).slice(0,2)) items.push({id:`missing-time:${item.id}`,title:`Check pickup time: ${item.route}`.slice(0,160),detail:"Your transport has a saved day but no pickup time.",action:"View transport details",target:{kind:"travel_item",id:item.id}});
  return [...new Map(items.map(item=>[item.id,item])).values()];
}
