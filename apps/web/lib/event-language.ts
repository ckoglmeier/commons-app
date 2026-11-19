export function wholePlanTitle(startsOn: string | null, endsOn: string | null) {
  return startsOn && endsOn && startsOn !== endsOn
    ? "The whole trip."
    : "The whole event.";
}
