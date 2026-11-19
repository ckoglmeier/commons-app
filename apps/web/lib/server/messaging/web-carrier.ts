import { randomUUID } from "node:crypto";
import { isWebAddress } from "@commons/database";
import { ProviderSendError, type MessagingProvider, type SendOutcome, type SendRequest } from "./provider";

/*
 * Carries messages to a person's thread in Commons. "Sending" only marks the stored message as out: nothing leaves Commons, no SMS is spent, and it
 * works whatever the SMS provider setting is. It refuses anything that is not a web address, so a phone number can never be routed here by mistake.
 */
export const webCarrier: MessagingProvider = {
  name: "web",
  synthetic: true,
  handlesOptOutReplies: false,
  supportsMedia: false,
  sendReadiness: () => ({ ready: true }),
  verifyWebhook: () => false,
  parseInbound: () => null,
  parseStatus: () => null,
  async send(request: SendRequest): Promise<SendOutcome> {
    if (!isWebAddress(request.to)) throw new ProviderSendError("Only web addresses go to a thread in Commons.", "not_a_web_address", false);
    return { providerMessageId: `WEB-${randomUUID()}`, status: "accepted" };
  },
  ack: () => new Response(null, { status: 204 }),
};

/** The carrier for one stored message: its own provider name decides, never the address alone. */
export const carrierFor = (providerName: string, fallback: MessagingProvider) => providerName === webCarrier.name ? webCarrier : fallback;
