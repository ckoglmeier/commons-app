import { PlanImportPreviewSchema, type PlanImportSourceKind } from "@commons/contracts";
import { parsePlanImportText } from "@commons/domain";
import { NextResponse } from "next/server";
import { UploadTooLargeError } from "./read-bounded-form-data";
import { readUploadedFile } from "./read-uploaded-file";

const maxTextLength = 2_000_000;

type ImportPreviewDependencies = {
  authenticate: () => Promise<boolean>;
  readForm: (request: Request) => Promise<FormData>;
};

export function createImportPreviewHandler({
  authenticate,
  readForm,
}: ImportPreviewDependencies) {
  return async function importPreview(request: Request) {
    try {
      if (!await authenticate()) {
        return NextResponse.json({ error: "Sign in to import a plan." }, { status: 401 });
      }

      const form = await readForm(request);
      const startsOn = String(form.get("startsOn") ?? "");
      const endsOn = String(form.get("endsOn") ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
        return NextResponse.json({ error: "Add the trip dates before importing a plan." }, { status: 400 });
      }

      const sourceMode = String(form.get("sourceMode") ?? "paste");
      let source: { text: string; sourceKind: PlanImportSourceKind; sourceLabel: string };
      if (sourceMode === "file") {
        const file = form.get("file");
        if (!(file instanceof File) || !file.size) throw new Error("Choose a file to import.");
        source = await readUploadedFile(file);
      } else {
        const text = String(form.get("text") ?? "").slice(0, maxTextLength);
        if (!text.trim()) throw new Error("Paste some trip notes first.");
        source = {
          text,
          sourceKind: /^(from|to|subject):/im.test(text) ? "email_export" : "pasted_notes",
          sourceLabel: /^(from|to|subject):/im.test(text) ? "Pasted email" : "Pasted notes",
        };
      }

      const preview = parsePlanImportText({ ...source, startsOn, endsOn });
      return NextResponse.json({ preview: PlanImportPreviewSchema.parse(preview) });
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        return NextResponse.json({ error: error.message }, { status: 413 });
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "That plan could not be read." },
        { status: 400 },
      );
    }
  };
}
