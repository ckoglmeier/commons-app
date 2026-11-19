import { coverSketchUrl, type CoverSketchContext } from "@/lib/cover-sketch";

/** Decorative illustration; the adjacent event text supplies the identity. */
export function CoverSketch({ context }: { context: CoverSketchContext }) {
  return <span className="cover-sketch" aria-hidden="true" style={{ backgroundImage: `url("${coverSketchUrl(context)}")` }} />;
}
