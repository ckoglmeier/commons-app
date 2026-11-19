import { notFound } from "next/navigation";
import { HomeReview } from "./review";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <HomeReview />;
}
