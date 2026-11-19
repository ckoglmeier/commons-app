type PollPresentationOrigin = { selection: string; dismissal: number };

/** Presentation permission only; receipt/history remain available regardless. */
export function mayPresentPollResult(origin: PollPresentationOrigin | undefined, current: PollPresentationOrigin) {
  return Boolean(origin && origin.selection === current.selection && origin.dismissal === current.dismissal);
}
