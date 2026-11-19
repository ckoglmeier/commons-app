import { and, desc, eq } from "drizzle-orm";
import { ConfirmationDraftSchema, type ConfirmationDraft } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { commons, confirmationDocuments, confirmationIntakes, memberships } from "./schema";
type Options={actorPersonId:string;databaseUrl?:string;now?:Date};
async function owner(tx:CommandTransaction,identifier:string,options:Options){
  const [trip]=await tx.select().from(commons).where(isCommonsId(identifier)?eq(commons.id,identifier):eq(commons.slug,identifier)).for("update");
  const [member]=trip?await tx.select().from(memberships).where(and(eq(memberships.commonsId,trip.id),eq(memberships.personId,options.actorPersonId),eq(memberships.status,"active"))):[];
  if(!trip||!member)throw new CommandAccessError();return trip;
}
async function transact<T>(options:Options,fn:(tx:CommandTransaction)=>Promise<T>){const db=createDatabase(options.databaseUrl);try{return await db.db.transaction(fn);}finally{await db.close();}}
export async function beginConfirmationIntake(identifier:string,input:{digest:string;kind:ConfirmationDraft["kind"];storagePath:string;fileName:string;mimeType:string},options:Options){
  return transact(options,async tx=>{const trip=await owner(tx,identifier,options),now=options.now??new Date();
    if(!/^[a-f0-9]{64}$/.test(input.digest)||!input.storagePath.startsWith(`${trip.slug}/${options.actorPersonId}/`)||input.fileName.length>180)throw new CommandAccessError();
    const [existing]=await tx.select().from(confirmationIntakes).where(and(eq(confirmationIntakes.commonsId,trip.id),eq(confirmationIntakes.ownerPersonId,options.actorPersonId),eq(confirmationIntakes.digest,input.digest),eq(confirmationIntakes.kind,input.kind)));
    if(existing){if(existing.status==="failed"||existing.status==="cancelled"||existing.status==="processing"&&existing.leaseUntil<=now){const [retry]=await tx.update(confirmationIntakes).set({status:"processing",revision:existing.revision+1,errorCode:null,leaseUntil:new Date(now.getTime()+120_000),updatedAt:now}).where(eq(confirmationIntakes.id,existing.id)).returning();return{intake:retry,claimed:true};}return{intake:existing,claimed:false};}
    const [intake]=await tx.insert(confirmationIntakes).values({commonsId:trip.id,ownerPersonId:options.actorPersonId,...input,leaseUntil:new Date(now.getTime()+120_000),createdAt:now,updatedAt:now}).returning();return{intake,claimed:true};
  });
}
export async function finishConfirmationIntake(identifier:string,id:string,expectedRevision:number,result:{draft:ConfirmationDraft}|{errorCode:string},options:Options){
  return transact(options,async tx=>{const trip=await owner(tx,identifier,options);const [intake]=await tx.select().from(confirmationIntakes).where(and(eq(confirmationIntakes.id,id),eq(confirmationIntakes.commonsId,trip.id),eq(confirmationIntakes.ownerPersonId,options.actorPersonId))).for("update");
    if(!intake)throw new CommandAccessError();if(intake.revision!==expectedRevision||intake.status!=="processing")throw new CommandConflictError();
    const [saved]=await tx.update(confirmationIntakes).set("draft"in result?{draft:ConfirmationDraftSchema.parse(result.draft),status:"awaiting_review",errorCode:null,updatedAt:options.now??new Date()}:{status:"failed",errorCode:result.errorCode.slice(0,120),updatedAt:options.now??new Date()}).where(eq(confirmationIntakes.id,id)).returning();return saved;
  });
}
export async function listConfirmationIntakes(identifier:string,options:Options){return transact(options,async tx=>{const trip=await owner(tx,identifier,options);const rows=await tx.select().from(confirmationIntakes).where(and(eq(confirmationIntakes.commonsId,trip.id),eq(confirmationIntakes.ownerPersonId,options.actorPersonId))).orderBy(desc(confirmationIntakes.updatedAt)).limit(20);
  for(const r of rows)if(r.status==="awaiting_review"){const [doc]=await tx.select().from(confirmationDocuments).where(and(eq(confirmationDocuments.commonsId,trip.id),eq(confirmationDocuments.ownerPersonId,options.actorPersonId),eq(confirmationDocuments.storagePath,r.storagePath)));if(doc){await tx.update(confirmationIntakes).set({status:"saved",updatedAt:options.now??new Date()}).where(eq(confirmationIntakes.id,r.id));r.status="saved";}}
  return rows;
});}
export async function reviseConfirmationIntake(identifier:string,id:string,expectedRevision:number,draft:ConfirmationDraft|null,options:Options){return transact(options,async tx=>{const trip=await owner(tx,identifier,options);const [r]=await tx.select().from(confirmationIntakes).where(and(eq(confirmationIntakes.id,id),eq(confirmationIntakes.commonsId,trip.id),eq(confirmationIntakes.ownerPersonId,options.actorPersonId))).for("update");if(!r)throw new CommandAccessError();if(r.revision!==expectedRevision||r.status!=="awaiting_review")throw new CommandConflictError();const [saved]=await tx.update(confirmationIntakes).set({draft:draft?ConfirmationDraftSchema.parse(draft):r.draft,status:draft?"awaiting_review":"cancelled",revision:r.revision+1,updatedAt:options.now??new Date()}).where(eq(confirmationIntakes.id,id)).returning();return saved;});}

/** Saving reviewed facts consumes the private artifact atomically; a stale tab cannot apply it. */
export async function consumeConfirmationIntake(tx:CommandTransaction,tripId:string,personId:string,document:import("@commons/contracts").ConfirmationDocumentInput){
  if(!document.intakeId)return;
  const [row]=await tx.select().from(confirmationIntakes).where(and(eq(confirmationIntakes.id,document.intakeId),eq(confirmationIntakes.commonsId,tripId),eq(confirmationIntakes.ownerPersonId,personId))).for("update");
  if(!row||row.storagePath!==document.storagePath)throw new CommandAccessError();
  if(row.status!=="awaiting_review"||row.revision!==document.intakeVersion)throw new CommandConflictError();
  await tx.update(confirmationIntakes).set({status:"saved",updatedAt:new Date()}).where(eq(confirmationIntakes.id,row.id));
}
