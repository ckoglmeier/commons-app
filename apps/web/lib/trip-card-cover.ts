import type { CommonsSummary } from "@commons/contracts";

type TripCardCover = Pick<CommonsSummary, "coverCardImageUrl" | "coverImageUrl" | "slug">;

export function tripCardCoverUrl(commons: TripCardCover) {
  const storedUrl = commons.coverCardImageUrl ?? commons.coverImageUrl;
  if (!storedUrl) return null;
  const coverRoute = `/api/v1/commons/${commons.slug}/cover-image`;
  if (storedUrl.startsWith(coverRoute)) {
    const url = new URL(storedUrl, "https://commons.invalid");
    url.searchParams.set("variant", "card");
    return `${url.pathname}${url.search}`;
  }
  const momentPrefix = `/api/v1/commons/${commons.slug}/moments/`;
  if (storedUrl.startsWith(momentPrefix)) {
    const momentId = storedUrl.slice(momentPrefix.length).split(/[/?#]/, 1)[0];
    return momentId
      ? `${coverRoute}?variant=card&v=${encodeURIComponent(momentId)}`
      : null;
  }
  return null;
}
