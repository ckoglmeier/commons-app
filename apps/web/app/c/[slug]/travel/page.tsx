import { redirect } from "next/navigation";
import { commonsViewPath } from "@/lib/commons-route";

// Logistics retains authentication and membership checks.
export default async function TravelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(commonsViewPath(slug, "logistics"));
}
