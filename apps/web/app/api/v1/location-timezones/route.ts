import { locationTimezones } from "@/lib/server/location-timezone-catalog";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  if (query.length > 120) return Response.json({ error: "Enter a shorter city or airport name." }, { status: 400, headers });
  try { return Response.json({ matches: await locationTimezones(query) }, { headers }); }
  catch { return Response.json({ error: "Location search is unavailable. Enter the timezone below." }, { status: 503, headers }); }
}
