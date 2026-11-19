import { createImportPreviewHandler } from "@/lib/import/preview-route";
import { readBoundedFormData } from "@/lib/import/read-bounded-form-data";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";

export const runtime = "nodejs";

export const POST = createImportPreviewHandler({
  authenticate: async () => Boolean(await getCommonsAuthIdentity()),
  readForm: readBoundedFormData,
});
