import { EvidenceRecordSchema, IndicativePriceSchema, InventoryProviderOutputSchema, InventoryRequestSchema,
  type InventoryProviderOutput, type VerificationProvider } from "@commons/contracts";
import { assessInventoryObservation, verifyInventoryEvidence } from "./discovery";

// Entirely synthetic. These identities, prices, source text and results have never been fetched.
export const DISCOVERY_FIXTURE_NOW = "2026-09-07T12:00:00.000Z";
export const DISCOVERY_FIXTURE_PERSON = "00000000-0000-4000-8000-000000000001";
export const discoveryFixtureRequest = InventoryRequestSchema.parse({
  provider: "Example Lodging", target: { kind: "property", key: "example-house", name: "Example House" },
  startsOn: "2027-06-11", endsOn: "2027-06-14", startLocalTime: "16:00", endLocalTime: "10:00", timezone: "America/Denver",
  party: { participantIds: [DISCOVERY_FIXTURE_PERSON], adults: 1, childAges: [], units: 1 },
  duration: { amount: 3, unit: "nights" }, essentialComponents: ["whole house"],
  dependencies: [{ componentId: "lodging-choice", version: 1 }],
});
export const discoveryFixtureIndicativePrice = IndicativePriceSchema.parse({
  kind: "indicative_price", price: { amount: "400", currency: "USD", basis: "per_night", taxes: "unknown", fees: "unknown", coversAllRequestedComponents: null },
  assumptions: { dates: "Summer weekdays", occupancy: "1 unit", duration: "Per night", components: ["whole house"] },
  asOf: DISCOVERY_FIXTURE_NOW, validUntil: null, availability: "not_checked",
});
export const discoveryFixtureEvidence = EvidenceRecordSchema.parse({
  id: "00000000-0000-4000-8000-000000000002", eventId: "00000000-0000-4000-8000-000000000003",
  suppliedByPersonId: DISCOVERY_FIXTURE_PERSON, contentHash: "0".repeat(64), receivedAt: DISCOVERY_FIXTURE_NOW, trust: "untrusted_data",
  normalizedUrl: "https://example.com/house", indicativePrice: discoveryFixtureIndicativePrice,
  source: { channel: "web", externalId: "fixture-house-v1", kind: "public_link", label: "Synthetic lodging source",
    url: "https://example.com/house", documentId: null, originalText: "Illustrative house, USD 400 per night. Taxes and fees unknown.",
    statementKind: "publisher_claim", attributedTo: "Example publisher", publishedAt: null, audience: "event" },
});

export function createFixtureVerificationProvider(overrides: Partial<InventoryProviderOutput> = {}): VerificationProvider {
  return { id: "fixture.inventory", version: "1", mode: "fixture", async verify({ request }) {
    return InventoryProviderOutputSchema.parse({ checkedRequest: request, availability: "available", bookingMechanism: "request_to_book",
      price: { amount: "1200", currency: "USD", basis: "total", taxes: "excluded", fees: "unknown", coversAllRequestedComponents: true },
      restrictions: { minimumNights: 3, maximumParty: 4, minimumAge: null, notes: [] },
      checkedAt: DISCOVERY_FIXTURE_NOW, validUntil: "2026-09-07T13:00:00.000Z",
      capture: { sourceUrl: "https://example.com/house", originalText: "Synthetic response: available for this request, USD 1200 before taxes; fees unknown. Request to book. Minimum 3 nights, maximum 4 people.", kind: "inventory_response" },
      ...overrides });
  } };
}

export async function buildDiscoveryFixtureExample() {
  const result = await verifyInventoryEvidence({ evidence: discoveryFixtureEvidence, request: discoveryFixtureRequest,
    provider: createFixtureVerificationProvider(), now: () => new Date(DISCOVERY_FIXTURE_NOW),
    extractor: { providerId: "fixture", modelId: "deterministic", version: "1", async extract() {
      return { claims: [{ field: "price", value: "The full price is still unknown.", quote: "USD 1200 before taxes; fees unknown" }] };
    } },
  });
  if (!result.observation) throw new Error("Fixture failed");
  return { notice: "Synthetic fixture. No live inventory checked.", evidence: discoveryFixtureEvidence,
    observation: result.observation,
    assessment: assessInventoryObservation(result.observation, discoveryFixtureRequest, new Date(DISCOVERY_FIXTURE_NOW)),
    afterDateChange: assessInventoryObservation(result.observation, { ...discoveryFixtureRequest, startsOn: "2027-06-12" }, new Date(DISCOVERY_FIXTURE_NOW)),
  };
}
