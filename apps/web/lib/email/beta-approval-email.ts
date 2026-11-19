const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** No refund promise, and no brief text. Links only to the person's own saved draft identity. */
export function renderBetaApprovalEmail(origin: string, resumeDraftId: string | null) {
  const base = new URL(origin);
  if (!["https:", "http:"].includes(base.protocol)) throw new Error("Invalid site URL.");
  const next = resumeDraftId && DRAFT_ID.test(resumeDraftId) ? `/new?draft=${resumeDraftId}` : "/new";
  const url = new URL("/sign-in", base);
  url.search = new URLSearchParams({ intent: "create", next }).toString();
  const href = url.toString().replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return {
    subject: "Your Commons trip is ready for the group",
    text: `You're approved to invite your group. Your private trip is saved.\n\nContinue your trip: ${url}\n\nCommons is $20 per trip when you first invite your group. Nothing has been charged or sent to your travelers.`,
    html: `<!doctype html><html lang="en"><body><main><h1>Bring your group together.</h1><p>You're approved to invite your group. Your private trip is saved.</p><p><a href="${href}">Continue your trip</a></p><p>Commons is $20 per trip when you first invite your group. Nothing has been charged or sent to your travelers.</p></main></body></html>`,
  };
}
