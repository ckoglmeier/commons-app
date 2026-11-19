export type TransportAnswers = {
  drivers: { arrival: number | null; wineries: number | null; return: number | null };
  luggagePieces: number | null;
};
export const unknownTransportAnswers: TransportAnswers = { drivers: { arrival: null, wineries: null, return: null }, luggagePieces: null };
export const transportAnswerLabels = [
  ["arrival", "Drivers for the airport arrival"], ["wineries", "Sober drivers for winery day"], ["return", "Drivers for the return to the airport"],
] as const;
export function sameTransportAnswers(a: TransportAnswers, b: TransportAnswers) {
  return a.luggagePieces === b.luggagePieces && transportAnswerLabels.every(([key]) => a.drivers[key] === b.drivers[key]);
}
export function transportAnswerSummary(answers: TransportAnswers) {
  const count = (value: number | null) => value === null ? "Not sure yet" : String(value);
  return [...transportAnswerLabels.map(([key, label]) => `${label}: ${count(answers.drivers[key])}`), `Bags for the group: ${count(answers.luggagePieces)}`].join(". ");
}
