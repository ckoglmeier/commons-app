/** Version of the bundled policy templates. Whoever runs a copy can link to their own policies instead (see lib/instance.ts). */
export const LEGAL_VERSION = '2026-11-19.oss';
export const LEGAL_EFFECTIVE_DATE = process.env.COMMONS_POLICY_EFFECTIVE_DATE?.trim() || 'the date this copy was set up';
