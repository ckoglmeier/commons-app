import { NextResponse } from "next/server";
import { z } from "zod";
import { ConfirmationDraftSchema } from "@commons/contracts";
import { reviseConfirmationIntake } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { CommandAccessError, CommandConflictError } from "@commons/database";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { authenticatedConfirmationIntakeOptions } from "@/lib/server/commons";
import { authenticatedIntakes, confirmationIntakeEnabled } from "@/lib/server/confirmation-intake";
const headers={"Cache-Control":"private, no-store"};
function failure(error:unknown){
  const [status,message]=error instanceof CommonsAuthenticationRequiredError?[401,"Your sign-in expired. Refresh and try again."]:error instanceof CommonsMembershipRequiredError?[403,"You are not part of this trip."]:error instanceof CommandAccessError?[404,"That confirmation is not available."]:error instanceof CommandConflictError?[409,"This confirmation changed. Reopen it and try again."]:error instanceof z.ZodError||error instanceof SyntaxError?[400,"Check the confirmation and try again."]:[500,"Confirmation review could not be loaded or saved. Try again."];
  return NextResponse.json({error:message},{status,headers});
}
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){try{const {slug}=await params;return NextResponse.json({enabled:confirmationIntakeEnabled(),intakes:await authenticatedIntakes(slug)},{headers});}catch(error){return failure(error);}}
export async function PATCH(request:Request,{params}:{params:Promise<{slug:string}>}){try{if(!confirmationIntakeEnabled())return NextResponse.json({error:"Confirmation review is unavailable."},{status:403});const input=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive(),draft:ConfirmationDraftSchema.nullable()}).strict().parse(await readBoundedJson(request,12_000));const {slug}=await params;return NextResponse.json(await reviseConfirmationIntake(slug,input.id,input.expectedRevision,input.draft,await authenticatedConfirmationIntakeOptions()),{headers});}catch(error){return failure(error);}}
