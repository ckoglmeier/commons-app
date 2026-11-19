/** What a pasted PDF or image can suggest for a new idea: never stored, never sent elsewhere. */
export type PlaceFileHints = { title: string | null; url: string | null; readable: boolean };

export function placeHintsFromText(text: string, fileName: string): PlaceFileHints {
  const url = text.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0]?.replace(/[.,;:]+$/, "") ?? null;
  const title = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim())
    .find(line => line.length >= 3 && line.length <= 120 && !/https?:\/\//i.test(line) && /\p{L}/u.test(line)) ?? fileTitle(fileName);
  return { title, url, readable: Boolean(text.trim()) };
}

export function fileTitle(fileName: string) {
  const name = fileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  // Camera and screenshot names are not place names.
  return name && !/^(img|image|screenshot|screen shot|photo|scan|document|download)\b/i.test(name) && /\p{L}{3}/u.test(name) ? name.slice(0, 120) : null;
}
