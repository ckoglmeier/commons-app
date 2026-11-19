import { BudgetCaptureSchema, budgetCaptureProperties } from './budget-capture';
import { readBoundedJson } from '../../bounded-json';
import { analyticsOriginAllowed } from '../../analytics-origin';
export function budgetCaptureHandler(options: {
  enabled: () => boolean;
  save: (input: { id: string; destination: string; revision: number; properties: ReturnType<typeof budgetCaptureProperties> }) => Promise<{ saved: boolean; limited: boolean }>;
}) {
  return async (request: Request) => {
    if (!options.enabled()) return new Response(null, { status: 404 });
    if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return new Response(null, { status: 204 });
    const origin = request.headers.get('origin');
    if (!origin || !analyticsOriginAllowed(origin, request.url) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response(null, { status: 403 });
    let raw: unknown;
    try { raw = await readBoundedJson(request, 16384); }
    catch { return Response.json({ error: 'Invalid estimate.' }, { status: 400 }); }
    const input = BudgetCaptureSchema.safeParse(raw);
    if (!input.success) return Response.json({ error: 'Invalid estimate.' }, { status: 400 });
    try {
      const value = input.data;
      const result = await options.save({ id: value.id, destination: value.destination, revision: value.revision, properties: budgetCaptureProperties(value) });
      return Response.json(result, { status: result.limited ? 429 : 202, headers: { 'Cache-Control': 'no-store' } });
    } catch { return Response.json({ saved: false }, { status: 503 }); }
  };
}
