import { notFound } from "next/navigation";
import GoalsPrototype from "../recipe-coordinator/recipe-coordinator-prototype";

export default function GoalsPrototypePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <GoalsPrototype />;
}
