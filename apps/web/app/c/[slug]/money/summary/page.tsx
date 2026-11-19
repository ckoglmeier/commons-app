import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MoneySummaryView } from "@/components/money-summary";
import { loadMoneySummary } from "@/lib/server/money-summary";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { moneySummaryPath } from "@/lib/money-summary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trip ledger — Commons", robots: { index: false, follow: false } };

export default async function MoneySummaryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let summary;
  try {
    summary = await loadMoneySummary(slug);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(moneySummaryPath(slug))}`);
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (!summary) notFound();
  if (slug !== summary.tripId) redirect(moneySummaryPath(summary.tripId));
  return <MoneySummaryView summary={summary} />;
}
