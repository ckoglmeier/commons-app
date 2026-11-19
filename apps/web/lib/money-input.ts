export function normalizeMoneyInput(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
}

export function parseMoneyInput(value: string) {
  const normalized = normalizeMoneyInput(value);
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
