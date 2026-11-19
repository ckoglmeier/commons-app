import type { CommonsState, CoordinatorGoal, CoordinatorTask, NextStepDescriptor, TripTask } from "@commons/contracts";
import { travelNextStepDescriptor, type CoordinatorNextStep } from "./coordinator-next-steps";

function planningAction(goal: CoordinatorGoal) {
  const planning = goal.planning;
  return planning?.action ?? (planning?.stage === "draft" ? "continue_draft" : planning?.stage === "decide" ? "review_answers" : ["decided", "applied"].includes(planning?.stage ?? "") ? "review_outcome" : planning?.stage === "closed" ? "view_round" : "wait");
}
function goalNeedsAction(goal: CoordinatorGoal) {
  if (!goal.ownedByMe || ["completed", "failed", "cancelled"].includes(goal.lifecycle)) return false;
  return goal.planning ? planningAction(goal) !== "wait" : ["waiting_for_input", "waiting_for_approval"].includes(goal.lifecycle);
}
const planningActionLabel = { continue_draft: "Continue draft", close_voting: "Close voting and review", review_answers: "Review answers", review_outcome: "Review goal outcome", view_round: "View round", wait: "View goal" };

export type CoordinatorActionItem = {
  id: string; title: string; detail: string; action: string;
  target: { kind: "task" | "poll" | "poll_results" | "proposal" | "travel" | "todo" | "travel_item"; id: string };
  descriptor?: NextStepDescriptor;
};

/** Channel-neutral, saved-state prompts for Overview and future messaging adapters.
 * Inputs must already be permission-filtered for this trip and person. Never infer a task from chat prose.
 */
export function coordinatorActionItems({ tripId, personId, organizer, state, goals = [], legacyTasks = [], travel, tripTasks = [], today }: {
  tripId: string; personId: string; organizer: boolean; state: CommonsState;
  goals?: readonly CoordinatorGoal[]; legacyTasks?: readonly CoordinatorTask[]; travel?: CoordinatorNextStep; tripTasks?: readonly TripTask[]; today?: string;
}): CoordinatorActionItem[] {
  if (state.commonsId !== tripId) return [];
  const items: CoordinatorActionItem[] = [];
  for (const task of [...tripTasks].filter(task=>task.ownerPersonId === personId && !task.completed).sort((a,b)=>(a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.id.localeCompare(b.id))) {
    items.push({id:`todo:${task.id}`,title:task.title,detail:`${task.suggestedByCommons ? "Suggested by Commons" : "Assigned to you"}${task.dueOn ? ` · Due ${task.dueOn}` : ""}`,action:"Open to-do",target:{kind:"todo",id:task.id}});
  }
  const hasReminder = (id: string) => {
    const travelItem=state.travelPlans?.find(item=>item.id===id);
    const title=travelItem?.kind === "transport" ? `Check pickup time: ${travelItem.route}`.slice(0,160).toLowerCase() : null;
    return tripTasks.some(task=>task.itemKind === "travel" && task.itemId === id || task.suggestionKey === `missing-time:${id}` || title && task.title.trim().toLowerCase() === title);
  };
  if (organizer) {
    for (const goal of goals.filter(goalNeedsAction).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.goalId.localeCompare(b.goalId))) {
      items.push({ id:`task:${goal.goalId}`, title:goal.title,
        detail:goal.planning?.nextAction || goal.waitDetail || (goal.lifecycle === "waiting_for_input" ? "This task needs your answer before it can continue." : "This task is waiting for your review."),
        action:goal.planning ? planningActionLabel[planningAction(goal)] : goal.lifecycle === "waiting_for_input" ? "Answer task" : "Review task", target:{kind:"task",id:goal.threadId},
        descriptor:{id:`task:${goal.goalId}`,scope:{tripId,personId,audience:"organizers"},reason:goal.lifecycle,evidence:[{id:goal.goalId,version:`${goal.revision}:${goal.updatedAt}`}],eligibility:"actionable",target:{kind:"task",id:goal.goalId},capability:{action:"open_task",available:true,reason:null},completion:"goal_deliverable"},
      });
    }
    for (const task of legacyTasks.filter(task => task.ownedByMe && task.status === "needs_input")) {
      items.push({ id: `legacy:${task.taskId}`, title: task.title, detail: task.needsInput || "This task needs your answer before it can continue.", action: "Answer task", target: { kind: "task", id: task.threadId } });
    }
    for (const proposal of state.proposals.filter(proposal=>proposal.status === "proposed")) {
      items.push({id:`proposal:${proposal.id}`,title:proposal.title,detail:proposal.summary || "A proposed change is waiting for your review.",action:"Review proposal",target:{kind:"proposal",id:proposal.id}});
    }
  }
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
  // These are the same suggested to-dos in Overview, Coordinator and messaging adapters.
  // Resolve them from saved state; never infer booking status or write Plan from a reminder.
  if (organizer && today) for (const item of (state.travelPlans ?? []).filter(item=>
    item.kind === "transport" && item.visibility !== "private" && item.date >= today && !item.time && !hasReminder(item.id),
  ).slice(0,2)) items.push({id:`missing-time:${item.id}`,title:`Check pickup time: ${item.route}`.slice(0,160),detail:"Your transport has a saved day but no pickup time.",action:"View transport details",target:{kind:"travel_item",id:item.id}});
  return [...new Map(items.map(item=>[item.id,item])).values()];
}
