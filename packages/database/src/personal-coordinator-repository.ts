import { reserveInference } from "./coordinator-turn-repository";
import { and, desc, eq, lt } from "drizzle-orm";
import { PersonalCoordinatorCommandSchema, type PersonalCoordinatorTurn } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, personalCoordinatorTurns } from "./schema";
import { isCommonsId } from "./commons-identifier";
import type { CommandTransaction } from "./event-command";
import { CommandAccessError, CommandConflictError } from "./event-command";

export type PersonalCoordinatorOptions = {databaseUrl?:string;actorPersonId:string;now?:Date};
async function scope(tx:CommandTransaction,identifier:string,options:PersonalCoordinatorOptions) {
  const [trip]=await tx.select({id:commons.id}).from(commons).where(isCommonsId(identifier)?eq(commons.id,identifier):eq(commons.slug,identifier)).for("update");
  if(!trip)throw new CommandAccessError();
  const [member]=await tx.select().from(memberships).where(and(eq(memberships.commonsId,trip.id),eq(memberships.personId,options.actorPersonId),eq(memberships.status,"active")));
  if(!member || member.accessMode === "managed")throw new CommandAccessError();
  return trip.id;
}
const publicTurn=(row:typeof personalCoordinatorTurns.$inferSelect):PersonalCoordinatorTurn=>({id:row.id,commandId:row.commandId,userText:row.userText,reply:row.reply,status:row.status,createdAt:row.createdAt.toISOString()});
export async function personalCoordinatorHistory(identifier:string,options:PersonalCoordinatorOptions) {
  const db=createDatabase(options.databaseUrl);try{return await db.db.transaction(async tx=>{
    const tripId=await scope(tx,identifier,options);
    // An abandoned inference is retryable, and its late worker loses permission to commit.
    const now=options.now??new Date();
    await tx.update(personalCoordinatorTurns).set({status:"failed",updatedAt:now}).where(and(eq(personalCoordinatorTurns.commonsId,tripId),eq(personalCoordinatorTurns.personId,options.actorPersonId),eq(personalCoordinatorTurns.status,"pending"),lt(personalCoordinatorTurns.updatedAt,new Date(now.getTime()-120000))));
    const rows=await tx.select().from(personalCoordinatorTurns).where(and(eq(personalCoordinatorTurns.commonsId,tripId),eq(personalCoordinatorTurns.personId,options.actorPersonId))).orderBy(desc(personalCoordinatorTurns.createdAt)).limit(40);
    return rows.reverse().map(publicTurn);
  });}finally{await db.close();}
}
export async function beginPersonalCoordinatorTurn(identifier:string,raw:unknown,options:PersonalCoordinatorOptions) {
  const command=PersonalCoordinatorCommandSchema.parse(raw),db=createDatabase(options.databaseUrl);
  try{return await db.db.transaction(async tx=>{
    const tripId=await scope(tx,identifier,options),now=options.now??new Date();
    const [old]=await tx.select().from(personalCoordinatorTurns).where(and(eq(personalCoordinatorTurns.commonsId,tripId),eq(personalCoordinatorTurns.personId,options.actorPersonId),eq(personalCoordinatorTurns.commandId,command.commandId))).for("update");
    if(old){
      if(old.userText!==command.text)throw new CommandConflictError();
      if(old.status === "completed" || old.status === "pending" && now.getTime()-old.updatedAt.getTime()<120000)return {tripId,turn:publicTurn(old),attempt:old.attempt,execute:false};
      if(old.attempt>=3)throw new CommandConflictError();
      await reserveInference(tx,tripId,options.actorPersonId,command.commandId,old.attempt+1,now);
      const [row]=await tx.update(personalCoordinatorTurns).set({status:"pending",attempt:old.attempt+1,updatedAt:now}).where(eq(personalCoordinatorTurns.id,old.id)).returning();
      return {tripId,turn:publicTurn(row),attempt:row.attempt,execute:true};
    }
    await reserveInference(tx,tripId,options.actorPersonId,command.commandId,1,now);
    const [row]=await tx.insert(personalCoordinatorTurns).values({commonsId:tripId,personId:options.actorPersonId,commandId:command.commandId,userText:command.text,status:"pending",createdAt:now,updatedAt:now}).returning();
    return {tripId,turn:publicTurn(row),attempt:row.attempt,execute:true};
  });}finally{await db.close();}
}
export async function finishPersonalCoordinatorTurn(identifier:string,input:{commandId:string;attempt:number;reply:string|null},options:PersonalCoordinatorOptions) {
  if(input.reply!==null && (!input.reply.trim() || input.reply.length>4000))throw new CommandConflictError();
  const db=createDatabase(options.databaseUrl);try{return await db.db.transaction(async tx=>{
    const tripId=await scope(tx,identifier,options);
    const [row]=await tx.update(personalCoordinatorTurns).set({status:input.reply===null?"failed":"completed",reply:input.reply,updatedAt:options.now??new Date()}).where(and(eq(personalCoordinatorTurns.commonsId,tripId),eq(personalCoordinatorTurns.personId,options.actorPersonId),eq(personalCoordinatorTurns.commandId,input.commandId),eq(personalCoordinatorTurns.attempt,input.attempt),eq(personalCoordinatorTurns.status,"pending"))).returning();
    if(!row)throw new CommandConflictError();return publicTurn(row);
  });}finally{await db.close();}
}
