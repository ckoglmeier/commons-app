import { ConfirmationDraftSchema, type ConfirmationDraft } from "@commons/contracts";
import { beginConfirmationIntake, finishConfirmationIntake, listConfirmationIntakes } from "@commons/database";
import { parseConfirmationText } from "@commons/domain";
import { authenticatedConfirmationIntakeOptions } from "./commons";
import { downloadCommonsConfirmationAsset } from "@/lib/supabase/admin";
import { readUploadedFile } from "@/lib/import/read-uploaded-file";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";
export const confirmationIntakeEnabled = () => readCommonsRuntimeEnvironment().COMMONS_CONFIRMATION_INTAKE_ENABLED === "true";
export async function parseIntakeBytes(bytes: Uint8Array, mimeType: string, kind: ConfirmationDraft["kind"], sourceLabel: string): Promise<ConfirmationDraft> {
  const source = mimeType.startsWith("image/") ? { text: "" } : await readUploadedFile(new File([Uint8Array.from(bytes)], sourceLabel, {type:mimeType}));
  const parsed=source.text.trim()?parseConfirmationText({text:source.text,sourceLabel}):null;
  return parsed?.kind === kind ? parsed : ConfirmationDraftSchema.parse({kind,sourceLabel,name:null,address:null,startsOn:null,endsOn:null,startTime:null,endTime:null,route:null,note:null,confirmationCode:null,totalCents:null,currency:"USD",includesTaxesAndFees:null,travelSegments:[],warnings:[parsed?"This file appears to belong to a different booking type. Enter the details below.":"No readable text was found. Add the booking details below."]});
}
export async function authenticatedIntakes(slug: string) {
  if (!confirmationIntakeEnabled()) return [];
  const options=await authenticatedConfirmationIntakeOptions();
  const rows=await listConfirmationIntakes(slug,options);
  for(const row of rows) if(row.status === "processing" && row.leaseUntil.getTime()<=Date.now()) {
    const retry=await beginConfirmationIntake(slug,{digest:row.digest,kind:row.kind,storagePath:row.storagePath,fileName:row.fileName,mimeType:row.mimeType},options);
    if(!retry.claimed)continue;
    try{const asset=await downloadCommonsConfirmationAsset(row.storagePath);if(!asset)throw new Error("upload_incomplete");const draft=await parseIntakeBytes(new Uint8Array(await asset.arrayBuffer()),row.mimeType,row.kind,row.fileName);await finishConfirmationIntake(slug,row.id,retry.intake.revision,{draft},options);}catch{await finishConfirmationIntake(slug,row.id,retry.intake.revision,{errorCode:"processing_failed_retry_same_file"},options);}
  }
  return listConfirmationIntakes(slug,options);
}
