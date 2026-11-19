import {NextResponse} from "next/server";
import {readBoundedJson} from "@/lib/bounded-json";
import {legacyCoordinatorErrorResponse} from "@/lib/server/coordinator-errors";
import {authenticatedBrain,authenticatedBrainOperation} from "@/lib/server/trip-brain-service";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";
const headers={"Cache-Control":"private, no-store"};
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){try{const {slug}=await params;return NextResponse.json(await authenticatedBrain(slug),{headers});}catch(error){return legacyCoordinatorErrorResponse(error);}}
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}){ const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;try{const {slug}=await params;return NextResponse.json(await authenticatedBrainOperation(slug,await readBoundedJson(request,4000)),{headers});}catch(error){return legacyCoordinatorErrorResponse(error);}}
