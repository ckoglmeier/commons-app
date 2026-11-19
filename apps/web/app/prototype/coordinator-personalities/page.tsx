import { notFound } from "next/navigation";
import { CoordinatorPersonalitiesPrototype } from "@/components/coordinator-personalities-prototype";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CoordinatorPersonalitiesPrototype />;
}
