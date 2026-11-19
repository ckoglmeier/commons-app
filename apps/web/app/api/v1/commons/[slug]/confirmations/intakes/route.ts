import { NextResponse } from "next/server";
import { z } from "zod";
import { ConfirmationDraftSchema } from "@commons/contracts";
import { reviseConfirmationIntake } from "@commons/database";
import { readBoundedJson } from "@/lib/bounded-json";
import { legacyCoordinatorErrorResponse } from "@/lib/server/coordinator-errors";
import { authenticatedConfirmationIntakeOptions } from "@/lib/server/commons";
import { authenticatedIntakes, confirmationIntakeEnabled } from "@/lib/server/confirmation-intake";
const headers={"Cache-Control":"private, no-store"};
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){try{const {slug}=await params;return NextResponse.json({enabled:confirmationIntakeEnabled(),intakes:await authenticatedIntakes(slug)},{headers});}catch(error){return legacyCoordinatorErrorResponse(error);}}
export async function PATCH(request:Request,{params}:{params:Promise<{slug:string}>}){try{if(!confirmationIntakeEnabled())return NextResponse.json({error:"Confirmation review is unavailable."},{status:403});const input=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive(),draft:ConfirmationDraftSchema.nullable()}).strict().parse(await readBoundedJson(request,12_000));const {slug}=await params;return NextResponse.json(await reviseConfirmationIntake(slug,input.id,input.expectedRevision,input.draft,await authenticatedConfirmationIntakeOptions()),{headers});}catch(error){return legacyCoordinatorErrorResponse(error);}}
