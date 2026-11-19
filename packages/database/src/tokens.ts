import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const protectedTokenVersion = "v1";
const defaultTokenBytes = 24;

export type RecoverableOpaqueToken = {
  token: string;
  tokenHash: string;
  protectedToken: string;
};

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashNormalizedEmail(value: string) {
  return hashOpaqueToken(value.trim().toLowerCase());
}

export function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw new Error("Phone numbers must use E.164 format.");
  }
  return compact;
}

export function hashNormalizedPhone(value: string) {
  return hashOpaqueToken(normalizePhone(value));
}

export function generateOpaqueToken(bytes = defaultTokenBytes) {
  return randomBytes(bytes).toString("base64url");
}

export function expiresAfterDays(days: number, now = new Date()) {
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

export function isTokenExpired(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() <= now.getTime();
}

export function readTokenProtectionKey(encoded = process.env.COMMONS_INVITATION_TOKEN_KEY) {
  if (!encoded) {
    throw new Error("COMMONS_INVITATION_TOKEN_KEY is required for recoverable private links.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("COMMONS_INVITATION_TOKEN_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function protectOpaqueToken(value: string, key = readTokenProtectionKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    protectedTokenVersion,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function revealOpaqueToken(value: string, key = readTokenProtectionKey()) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== protectedTokenVersion || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored private token is unavailable. Rotate the private link.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function revealLegacyOrProtectedOpaqueToken(
  value: string,
  key = readTokenProtectionKey(),
) {
  return value.startsWith(`${protectedTokenVersion}.`)
    ? revealOpaqueToken(value, key)
    : value;
}

export function mintRecoverableOpaqueToken(
  key = readTokenProtectionKey(),
): RecoverableOpaqueToken {
  const token = generateOpaqueToken();
  return {
    token,
    tokenHash: hashOpaqueToken(token),
    protectedToken: protectOpaqueToken(token, key),
  };
}

export function revokedOpaqueTokenHash() {
  return hashOpaqueToken(generateOpaqueToken());
}
