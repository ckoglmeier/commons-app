type Search = Record<string, string | string[] | undefined>;

export function askPath(slug: string, search: Search = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  }
  const serialized = query.toString();
  return `/c/${encodeURIComponent(slug)}/ask${serialized ? `?${serialized}` : ""}`;
}

export function askNavigationHref(slug: string, role: string, recipesAvailable: boolean) {
  return role === "organizer" && recipesAvailable ? askPath(slug) : undefined;
}

export function askEntryHref(slug: string, canAskGroup: boolean, recipesAvailable: boolean, coordinatorAvailable = true) {
  if (!canAskGroup) return undefined;
  // Free trips ask the group through the standalone poll editor, never through Coordinator.
  // A beta trip (direct goals, no Coordinator) opens Ask the group, which offers the general poll editor and the guided asks.
  if (!coordinatorAvailable) return recipesAvailable ? askPath(slug) : `/c/${encodeURIComponent(slug)}/polls/new`;
  return recipesAvailable ? askPath(slug) : `/c/${encodeURIComponent(slug)}/coordinator?ask=1`;
}
