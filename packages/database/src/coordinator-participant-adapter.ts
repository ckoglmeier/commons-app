import { and, eq } from "drizzle-orm";
import { InboundParticipantEventSchema, isGoalTerminal } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { projectGoalEventInTransaction, type GoalOptions } from "./coordinator-goal-repository";
import { commons, coordinatorGoals, coordinatorGoalReports, coordinatorGoalSteps, coordinatorOutreach, coordinatorOutreachMessages, memberships } from "./schema";
/** Synthetic-only, correlated participant adapter. There is deliberately no provider webhook or delivery route. */
export async function approveSyntheticOutreach(identifier:string,input:{outreachId:string;expectedRevision:number},options:GoalOptions){
  if(!options.syntheticParticipants)throw new CommandAccessError();const db=createDatabase(options.databaseUrl);try{return await db.db.transaction(async tx=>{
    const trip=await requireTripOrganizer(tx,identifier,options.actorPersonId),now=options.now??new Date();
    const [outreach]=await tx.select().from(coordinatorOutreach).where(and(eq(coordinatorOutreach.id,input.outreachId),eq(coordinatorOutreach.commonsId,trip))).for("update");if(!outreach)throw new CommandAccessError();
    const [goal]=await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,outreach.goalId));const [step]=await tx.select().from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.id,outreach.stepId));
    if(goal.createdByPersonId!==options.actorPersonId)throw new CommandAccessError();if(goal.revision!==input.expectedRevision||step.goalRevision!==goal.revision||isGoalTerminal(goal.lifecycle)||outreach.expiresAt<=now)throw new CommandConflictError();
    const [recipient]=await tx.select().from(memberships).where(and(eq(memberships.commonsId,trip),eq(memberships.personId,outreach.recipientPersonId),eq(memberships.status,"active")));if(!recipient)throw new CommandAccessError();
    const [optOut]=await tx.select().from(coordinatorOutreach).where(and(eq(coordinatorOutreach.recipientPersonId,outreach.recipientPersonId),eq(coordinatorOutreach.status,"opted_out"))).limit(1);if(optOut)throw new CommandAccessError();
    if(outreach.status === "sent")return {sent:true,synthetic:true,address:outreach.conversationAddress};if(outreach.status!=="awaiting_approval")throw new CommandConflictError();
    await tx.insert(coordinatorOutreachMessages).values({outreachId:outreach.id,commonsId:trip,direction:"outbound",providerMessageId:`synthetic-send:${outreach.id}`,body:outreach.sendSnapshot.text,occurredAt:now}).onConflictDoNothing();
    await tx.update(coordinatorOutreach).set({status:"sent",approvedByPersonId:options.actorPersonId,approvedAt:now,updatedAt:now}).where(eq(coordinatorOutreach.id,outreach.id));
    await tx.update(coordinatorGoals).set({lifecycle:"waiting_for_event",waitDetail:"Waiting for a synthetic participant reply; no real message was sent.",updatedAt:now}).where(eq(coordinatorGoals.id,goal.id));return{sent:true,synthetic:true,address:outreach.conversationAddress};
  });}finally{await db.close();}
}
export async function ingestSyntheticParticipantReply(tripId:string,recipientPersonId:string,raw:unknown,options:GoalOptions){
  if(!options.syntheticParticipants)throw new CommandAccessError();const event=InboundParticipantEventSchema.parse(raw),db=createDatabase(options.databaseUrl);try{return await db.db.transaction(async tx=>{
    await tx.select().from(commons).where(eq(commons.id,tripId)).for("update");
    const [outreach]=await tx.select().from(coordinatorOutreach).where(and(eq(coordinatorOutreach.conversationAddress,event.conversationAddress),eq(coordinatorOutreach.commonsId,tripId),eq(coordinatorOutreach.recipientPersonId,recipientPersonId))).for("update");if(!outreach)throw new CommandAccessError();
    const [member]=await tx.select().from(memberships).where(and(eq(memberships.commonsId,tripId),eq(memberships.personId,recipientPersonId),eq(memberships.status,"active")));if(!member)throw new CommandAccessError();
    const [goal]=await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id,outreach.goalId));const [step]=await tx.select().from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.id,outreach.stepId));
    const [prior]=await tx.select().from(coordinatorOutreachMessages).where(and(eq(coordinatorOutreachMessages.outreachId,outreach.id),eq(coordinatorOutreachMessages.providerMessageId,event.providerMessageId)));if(prior){if(prior.body!==event.body)throw new CommandConflictError();return{replayed:true,late:prior.late};}
    const now=options.now??new Date(),late=outreach.status!=="sent"||outreach.expiresAt<=now||step.goalRevision!==goal.revision||isGoalTerminal(goal.lifecycle);
    await tx.insert(coordinatorOutreachMessages).values({outreachId:outreach.id,commonsId:tripId,direction:"inbound",providerMessageId:event.providerMessageId,body:event.body,late,occurredAt:new Date(event.receivedAt)});
    if(/^\s*(stop|unsubscribe|opt\s*out)\s*[.!]?\s*$/i.test(event.body))await tx.update(coordinatorOutreach).set({status:"opted_out",updatedAt:now}).where(eq(coordinatorOutreach.id,outreach.id));
    else if(!late)await tx.update(coordinatorOutreach).set({status:"replied",updatedAt:now}).where(eq(coordinatorOutreach.id,outreach.id));
    if(late)await tx.insert(coordinatorGoalReports).values({commonsId:tripId,goalId:goal.id,mainThreadId:goal.mainThreadId,goalRevision:step.goalRevision,kind:"late_reply",discriminator:event.providerMessageId,headline:`${goal.title}: a reply arrived after collection stopped.`,detail:"The private reply was retained once; it did not restart work or change trip facts.",sources:[],createdAt:now}).onConflictDoNothing();
    await projectGoalEventInTransaction(tx,tripId,outreach.id,now);return{replayed:false,late};
  });}finally{await db.close();}
}
export async function syntheticParticipantCoordinatorContext(tripId:string,recipientPersonId:string,address:string,options:GoalOptions){
  if(!options.syntheticParticipants)throw new CommandAccessError();const db=createDatabase(options.databaseUrl);try{const [row]=await db.db.select().from(coordinatorOutreach).where(and(eq(coordinatorOutreach.commonsId,tripId),eq(coordinatorOutreach.recipientPersonId,recipientPersonId),eq(coordinatorOutreach.conversationAddress,address)));const [member]=await db.db.select().from(memberships).where(and(eq(memberships.commonsId,tripId),eq(memberships.personId,recipientPersonId),eq(memberships.status,"active")));if(!row||!member)throw new CommandAccessError();return{identity:"Commons Coordinator",purpose:row.sendSnapshot.question,scope:"This participant's reply to the one approved question; no organizer task context or private records of other people.",delivery:"synthetic only"};}finally{await db.close();}
}
