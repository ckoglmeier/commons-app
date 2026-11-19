export const PROVISIONAL_TITLE_FALLBACK = "New conversation";
const MAX_TITLE = 60;

/**
 * A safe initial topic heading: first sentence of the first line, collapsed
 * whitespace, cut at a word boundary, no trailing punctuation. The full spoken
 * or typed sentence never becomes the permanent heading; a generated title
 * replaces this once (see completeCoordinatorTurn).
 */
export function provisionalTitle(text: string, fallback = PROVISIONAL_TITLE_FALLBACK) {
  const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "";
  const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstLine;
  const collapsed = sentence.replace(/\s+/g, " ").trim();
  let title = collapsed;
  if (title.length > MAX_TITLE) {
    const window = title.slice(0, MAX_TITLE + 1), space = window.lastIndexOf(" ");
    title = space > 20 ? window.slice(0, space) : window.slice(0, MAX_TITLE);
  }
  title = title.replace(/[\s.,;:!?…-]+$/, "").trim();
  return title || fallback;
}
