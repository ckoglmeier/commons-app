import { coverSketchId, coverSketchIds, type CoverSketchId } from "@/lib/cover-sketch";

/*
 * The covers bundled with open source Commons: the twelve drawings in public/covers. The rest of the Commons cover library is reserved and
 * not included (see NOTICE.md).
 */
export type LocalArtwork = { key: string; src: string; title: string };

const TITLES: Record<CoverSketchId, string> = {
  mountains: "Snowy mountains",
  hills: "Rolling hills and a trail",
  coast: "A coast and the sea",
  lake: "A quiet lake",
  forest: "A forest and a cabin",
  desert: "Desert and canyons",
  countryside: "Countryside and vineyards",
  city: "A city skyline",
  table: "A shared table",
  garden: "A garden picnic",
  celebration: "A celebration",
  together: "Friends together",
};

const art = (id: CoverSketchId): LocalArtwork => ({ key: `cover:${id}:v1`, src: `/covers/${id}.svg`, title: TITLES[id] });

/** Every bundled cover, in a stable order. */
export const commonsCoverArtwork: LocalArtwork[] = coverSketchIds.map(art);

/** Presentation-only default from what the trip already shows (name and place). Explicitly selected covers always win at the call site. */
export function suggestTripCover(input: { locationNames?: readonly string[] | null; locationName?: string | null; title?: string | null }): LocalArtwork | null {
  const location = input.locationNames?.length ? input.locationNames.join(" ") : input.locationName ?? null;
  if (!input.title && !location) return null;
  return art(coverSketchId({ name: input.title ?? "", locationName: location }));
}
