import { mapCities } from "@/lib/server/map-city-catalog";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  if (query.length > 120) return Response.json({ error: "Enter a shorter city name." }, { status: 400, headers });
  try { return Response.json({ matches: await mapCities(query) }, { headers }); }
  catch { return Response.json({ error: "City lookup is unavailable. Your places remain in the list." }, { status: 503, headers }); }
}
