import { notFound } from "next/navigation";
import { CommonsApp } from "@/components/commons-app";
import { pilotSnapshot } from "@/lib/pilot-fixture";

// Real event shell with synthetic UI identity. Browser feedback saves must be mocked.
// This grants no session or server authority and is unavailable in production.
export default function FeedbackReview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CommonsApp initialSnapshot={pilotSnapshot} dataMode="demo" signedIn showArrival={false} />;
}
