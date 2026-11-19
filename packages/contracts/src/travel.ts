import { z } from "zod";

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
// Source timezone labels are retained as supplied, not converted or guessed.
export const FlightConnectionSchema = z.object({
  origin: z.string().trim().min(1).max(80).nullable(),
  destination: z.string().trim().min(1).max(80).nullable(),
  departureDate: z.string().date().nullable(),
  departureTime: localTime,
  arrivalDate: z.string().date().nullable(),
  arrivalTime: localTime,
  departureTimezone: z.string().trim().min(1).max(60).nullable(),
  arrivalTimezone: z.string().trim().min(1).max(60).nullable(),
  flightNumber: z.string().trim().min(1).max(30).nullable(),
}).strict();
export type FlightConnection = z.infer<typeof FlightConnectionSchema>;

export const ConfirmationMimeTypeSchema = z.enum([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain", "message/rfc822",
]);
export const ConfirmationDocumentInputSchema = z.object({
  intakeId: z.string().uuid().optional(),
  intakeVersion: z.number().int().positive().optional(),
  storagePath: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(180),
  mimeType: ConfirmationMimeTypeSchema,
});
export type ConfirmationDocumentInput = z.infer<typeof ConfirmationDocumentInputSchema>;
