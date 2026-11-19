import type { Stay } from "@commons/contracts";
export const compareStayIds = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"];
export function compareStayFixtures(personId: string): Stay[] {
  const base = { address: "Edinburgh, Scotland", startsOn: "2027-07-18", endsOn: "2027-07-21", status: "considering" as const, includedPersonIds: [personId], currency: "GBP", sourceLabel: "Organizer’s saved option · synthetic test data" };
  return [
    { ...base, id: compareStayIds[0], name: "Old Town apartment with a very long property name for our Scotland and Sweden group", totalCents: 96000, costSource: "estimate", includesTaxesAndFees: true, bookingUrl: "https://example.com/stays/apartment", details: "Two bedrooms, stairs to the entrance. Cancellation terms need checking.", confirmationCode: "PRIVATE-CODE-MUST-NOT-RENDER", confirmationDocumentUrl: "https://private.example/document" },
    { ...base, id: compareStayIds[1], name: "New Town hotel", roomPriceCents: 54000, bookingUrl: "https://example.com/stays/hotel", details: "Room count, bed setup and accessible rooms need checking." },
    { ...base, id: compareStayIds[2], name: "Garden guesthouse", startsOn: "2027-07-19", endsOn: "2027-07-22", currency: "EUR", bookingUrl: "javascript:alert('untrusted')" },
  ];
}
