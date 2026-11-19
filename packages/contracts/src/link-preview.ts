import { z } from "zod";

export const LinkPreviewKindSchema = z.enum([
  "activity",
  "restaurant",
  "lodging",
  "place",
  "link",
]);

export const LinkPreviewSchema = z.object({
  url: z.string().url().refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Preview links must use http or https.",
  ),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500).optional(),
  location: z.string().trim().min(1).max(160).optional(),
  siteName: z.string().trim().min(1).max(80),
  kind: LinkPreviewKindSchema,
  detailStatus: z.enum(["extracted", "link_only"]),
  /** A map position published by the page or carried in a maps link. */
  pin: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    source: z.enum(["map_link", "page"]),
  }).strict().optional(),
  existingItem: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["idea", "planned", "confirmed", "cancelled"]),
  }).optional(),
});

export type LinkPreview = z.infer<typeof LinkPreviewSchema>;
export type LinkPreviewKind = z.infer<typeof LinkPreviewKindSchema>;
