import { notFound, redirect } from "next/navigation";

export default function RecipeCoordinatorPrototypePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  redirect("/prototype/goals");
}
