import { redirect } from "next/navigation";
import { askPath } from "@/lib/ask-route";

type Search = Record<string, string | string[] | undefined>;

export default async function LegacyRecipesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  redirect(askPath(slug, await searchParams));
}
