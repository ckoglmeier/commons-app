/**
 * Settings for whoever runs this copy of Commons. All optional; the legal templates fall back to neutral wording.
 * COMMONS_INSTANCE_OWNER_NAME, COMMONS_INSTANCE_CONTACT_EMAIL, COMMONS_INSTANCE_JURISDICTION, COMMONS_TERMS_URL, COMMONS_PRIVACY_URL.
 */
type Env = Record<string, string | undefined>;

export type InstanceSettings = {
  ownerName: string;
  contactEmail: string | null;
  jurisdiction: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
};

const httpsUrl = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try { const url = new URL(trimmed); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
};

export function instanceSettings(env: Env = process.env): InstanceSettings {
  const email = env.COMMONS_INSTANCE_CONTACT_EMAIL?.trim();
  return {
    ownerName: env.COMMONS_INSTANCE_OWNER_NAME?.trim() || "The person who runs this copy",
    contactEmail: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    jurisdiction: env.COMMONS_INSTANCE_JURISDICTION?.trim() || null,
    termsUrl: httpsUrl(env.COMMONS_TERMS_URL),
    privacyUrl: httpsUrl(env.COMMONS_PRIVACY_URL),
  };
}

/** Fills a policy template's {owner}, {contactSentence} and {jurisdictionSentence} tokens. */
export function fillPolicyText(text: string, settings: InstanceSettings) {
  const contactSentence = settings.contactEmail ? `Contact ${settings.ownerName} at ${settings.contactEmail}.` : `Contact ${settings.ownerName} through the trip organizer who invited you.`;
  const jurisdictionSentence = settings.jurisdiction ? `The laws of ${settings.jurisdiction} govern these terms, except where the law where you live gives you mandatory protections.` : "The laws where the person running this copy is based govern these terms, except where the law where you live gives you mandatory protections.";
  const owner = settings.ownerName;
  const midSentence = owner.replace(/^The /, "the ");
  return text
    .replaceAll("{contactSentence}", contactSentence)
    .replaceAll("{jurisdictionSentence}", jurisdictionSentence)
    .replace(/(^|[.!?]\s+)\{owner\}/g, (_match, lead: string) => `${lead}${owner}`)
    .replaceAll("{owner}", midSentence);
}
