import { createInquiryRouteHandler } from "@/lib/beta/inquiry-route";
import { inquiryRouteDeps } from "@/lib/server/beta-completion";

export const maxDuration = 30;

// Partner and DMO inquiries. 404 unless COMMONS_BETA_REWORK_ENABLED is on. The marketing pages post here; see docs/BETA-COMPLETION-STATUS.md.
export const POST = createInquiryRouteHandler(inquiryRouteDeps);
