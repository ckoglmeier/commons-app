import { coordinatorErrorCatalog } from "@commons/contracts";
import { readBoundedJson } from "@/lib/bounded-json";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommandAccessError, CommandConflictError, CoordinatorTurnError } from "@commons/database";
import { CommonsAuthenticationRequiredError } from "@/lib/server/commons";
import { authenticatedPersonalHistory, personalCoordinatorQuestion } from "@/lib/server/personal-coordinator";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";
export const dynamic="force-dynamic";
function failure(error:unknown) {
  if (error instanceof CoordinatorTurnError) { const entry = coordinatorErrorCatalog[error.code]; return NextResponse.json({error:entry.userMessage, code:error.code}, {status:entry.httpStatus, headers:{"Cache-Control":"private, no-store"}}); }
  const status=error instanceof CommonsAuthenticationRequiredError?401:error instanceof CommandAccessError?404:error instanceof CommandConflictError?409:(error instanceof ZodError || error instanceof SyntaxError)?400:503;
  return NextResponse.json({error:status===401?"Sign in again to open your personal conversation.":status===404?"Conversation unavailable.":status===409?"This request cannot be started again. Check your saved conversation before retrying.":status===400?"Check your message and try again.":"Commons could not finish this reply. Your saved question is kept; try again."},{status,headers:{"Cache-Control":"private, no-store"}});
}
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}) {try{return NextResponse.json({turns:await authenticatedPersonalHistory((await params).slug)},{headers:{"Cache-Control":"private, no-store"}});}catch(error){return failure(error);}}
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;try{return NextResponse.json({turn:await personalCoordinatorQuestion((await params).slug,await readBoundedJson(request, 12_000))},{headers:{"Cache-Control":"private, no-store"}});}catch(error){return failure(error);}}
