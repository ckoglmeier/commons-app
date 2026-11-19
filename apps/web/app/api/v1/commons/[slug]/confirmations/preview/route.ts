import { ConfirmationDraftSchema, ConfirmationPreviewResponseSchema, type ConfirmationDraft } from "@commons/contracts";
import { parseConfirmationText } from "@commons/domain";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  getCommonsDataMode,
  loadCommonsSnapshot,
  loadCommonsConfirmationImport,
} from "@/lib/server/commons";
import { UploadTooLargeError, readBoundedFormData } from "@/lib/import/read-bounded-form-data";
import { readUploadedFile } from "@/lib/import/read-uploaded-file";
import { beginConfirmationIntake, finishConfirmationIntake } from "@commons/database";
import { authenticatedConfirmationIntakeOptions } from "@/lib/server/commons";
import { confirmationIntakeEnabled, parseIntakeBytes } from "@/lib/server/confirmation-intake";
import { gateUsage } from "@/lib/server/beta-completion";
import { storeCommonsConfirmationAsset, createCommonsConfirmationUploadToken } from "@/lib/supabase/admin";
import { identifyConfirmationFile } from "@/lib/import/confirmation-file";

function emptyConfirmationDraft(kind: ConfirmationDraft["kind"], sourceLabel: string, warning: string) {
  return ConfirmationDraftSchema.parse({
    kind,
    sourceLabel,
    name: null,
    address: null,
    startsOn: null,
    endsOn: null,
    startTime: null,
    endTime: null,
    route: null,
    note: null,
    confirmationCode: null,
    totalCents: null,
    currency: "USD",
    includesTaxesAndFees: null,
    travelSegments: [],
    warnings: [warning],
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (getCommonsDataMode(slug) !== "database") {
      return NextResponse.json({ error: "Sign in to a trip to upload a confirmation." }, { status: 403 });
    }
    const snapshot = await loadCommonsSnapshot(slug);
    if (!snapshot) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
    const form = await readBoundedFormData(request);
    const file = form.get("file");
    const expectedKindValue = form.get("expectedKind");
    const expectedKind = expectedKindValue === "stay" || expectedKindValue === "flight" || expectedKindValue === "car_rental"
      ? expectedKindValue
      : null;
    if (!expectedKind) {
      return NextResponse.json({ error: "Choose where this confirmation belongs." }, { status: 400 });
    }
    if (!(file instanceof File) || !file.size) {
      return NextResponse.json({ error: "Choose a confirmation file." }, { status: 400 });
    }
    const { bytes, mimeType, extension } = await identifyConfirmationFile(file);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `${slug}/${snapshot.currentActor.id}/${digest}.${extension}`;
    const existing = await loadCommonsConfirmationImport(slug, storagePath);
    if (existing) return NextResponse.json({ error: "This confirmation is already saved. Open the existing record to make corrections.", existing }, { status: 409 });
    const usage = await gateUsage(snapshot.commons.id, "extraction_call", { dedupeKey: digest });
    if (!usage.proceed) return NextResponse.json({ error: "Reading confirmations is paused for this trip. You can add the details by hand." }, { status: 429 });
    if (confirmationIntakeEnabled()) {
      const options = await authenticatedConfirmationIntakeOptions();
      const started = await beginConfirmationIntake(slug, { digest, kind: expectedKind, storagePath, fileName: file.name.slice(0,180), mimeType }, options);
      if (!started.claimed && started.intake.status === "awaiting_review" && started.intake.draft) return NextResponse.json(ConfirmationPreviewResponseSchema.parse({ intakeId: started.intake.id, intakeVersion: started.intake.revision, alreadyUploaded: true, draft: started.intake.draft, upload: { storagePath, token: "already-stored", mimeType } }), { headers: { "Cache-Control": "private, no-store" } });
      if (!started.claimed) return NextResponse.json({ error: "This confirmation is already processing. Open your travel review shortly.", intakeId: started.intake.id }, { status: 409 });
      try {
        await storeCommonsConfirmationAsset(storagePath,bytes,mimeType);
        const draft = await parseIntakeBytes(bytes,mimeType,expectedKind,file.name.slice(0,180));
        const intake = await finishConfirmationIntake(slug,started.intake.id,started.intake.revision,{draft},options);
        return NextResponse.json(ConfirmationPreviewResponseSchema.parse({ intakeId: intake.id, intakeVersion: intake.revision, alreadyUploaded: true, draft, upload: { storagePath, token: "already-stored", mimeType } }), { headers: { "Cache-Control": "private, no-store" } });
      } catch (error) { await finishConfirmationIntake(slug,started.intake.id,started.intake.revision,{errorCode:"processing_failed_retry_same_file"},options).catch(()=>undefined); throw error; }
    }
    // Images remain private evidence with manual fields until an explicitly
    // consented extraction provider is approved. No uploaded data leaves Commons.
    const source = mimeType.startsWith("image/") ? { text: "" } : await readUploadedFile(new File([bytes], `confirmation.${extension}`, { type: mimeType }));
    const sourceLabel = file.name.slice(0, 180);
    const parsed = source.text.trim() ? parseConfirmationText({ text: source.text, sourceLabel }) : null;
    const draft: ConfirmationDraft = !parsed
      ? emptyConfirmationDraft(expectedKind, sourceLabel, "No readable text was found. Add the booking details below.")
      : parsed.kind !== expectedKind
        ? emptyConfirmationDraft(expectedKind, sourceLabel, `This confirmation looks like ${parsed.kind === "car_rental" ? "a car rental" : parsed.kind === "stay" ? "a stay" : "a flight"}. Add the booking details below.`)
        : parsed;
    const token = await createCommonsConfirmationUploadToken(storagePath);
    return NextResponse.json(ConfirmationPreviewResponseSchema.parse({
      draft,
      upload: { storagePath, token, mimeType },
    }));
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: "Your sign-in expired. Refresh and try again." }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "This confirmation belongs to another trip." }, { status: 403 });
    if (error instanceof UploadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error("Commons confirmation preview failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "That confirmation could not be read." }, { status: 400 });
  }
}
