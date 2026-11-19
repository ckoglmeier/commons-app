import { z } from "zod";

/** Shared message only: never private conversation, respondent notes, or arbitrary HTML. */
export const PollCommunicationSchema = z.object({
  heading: z.string().trim().min(1).max(160),
  paragraphs: z.array(z.string().trim().min(1).max(1500)).min(1).max(12),
  links: z.array(z.object({
    label: z.string().trim().min(1).max(160),
    url: z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value), "Use an http or https link."),
  })).max(8),
});
export type PollCommunication = z.infer<typeof PollCommunicationSchema>;
