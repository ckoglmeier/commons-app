import { PollPublicIdSchema } from "@commons/contracts";

export function normalizePollPublicId(value: string) {
  const result = PollPublicIdSchema.safeParse(value.toLowerCase());
  return result.success ? result.data : null;
}

export function publicPollPath(value: string) {
  const publicId = normalizePollPublicId(value);
  if (!publicId) throw new Error("Invalid poll public ID.");
  return `/c/poll/${publicId}`;
}
