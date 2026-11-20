import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "./config";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { safeAuthNext } from "@/lib/auth-flow";

export function isSupabaseAdminConfigured() {
  return Boolean(readCommonsRuntimeEnvironment().SUPABASE_SERVICE_ROLE_KEY);
}

function createSupabaseAdminClient(requiredFor: string) {
  const serviceRoleKey = readCommonsRuntimeEnvironment().SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY is required ${requiredFor}.`);
  }
  const { url } = getSupabaseAuthConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function createCommonsPhotoUploadToken(storagePath: string) {
  const supabase = createSupabaseAdminClient("to upload a Commons photo");
  const { data, error } = await supabase.storage
    .from("commons-moments")
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data.token) {
    throw new Error(error?.message ?? "Commons could not prepare the photo upload.");
  }
  return data.token;
}

export async function createCommonsConfirmationUploadToken(storagePath: string) {
  const supabase = createSupabaseAdminClient("to upload a confirmation PDF");
  const { data, error } = await supabase.storage
    .from("commons-confirmations")
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data.token) {
    throw new Error(error?.message ?? "Commons could not prepare the confirmation upload.");
  }
  return data.token;
}

export async function downloadCommonsConfirmationAsset(storagePath: string) {
  const supabase = createSupabaseAdminClient("to read a private confirmation PDF");
  const { data, error } = await supabase.storage.from("commons-confirmations").download(storagePath);
  if (error || !data) return null;
  return data;
}

export async function downloadCommonsPhotoAsset(storagePath: string) {
  const supabase = createSupabaseAdminClient("to read a scoped Commons cover");
  const { data, error } = await supabase.storage.from("commons-moments").download(storagePath);
  if (error || !data) return null;
  return data;
}

export async function removeCommonsPhotoAssets(storagePaths: string[]) {
  if (!storagePaths.length) return;
  const supabase = createSupabaseAdminClient("to replace a Commons cover");
  const { error } = await supabase.storage.from("commons-moments").remove(storagePaths);
  if (error) throw new Error(error.message);
}

export async function storeCommonsPhotoAsset(storagePath: string, bytes: Uint8Array, mimeType: string) {
  const supabase = createSupabaseAdminClient("to cache a Commons cover card");
  const { error } = await supabase.storage.from("commons-moments").upload(storagePath, bytes, {
    cacheControl: "31536000",
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

export async function deleteCommonsPhotoObject(storagePath: string) {
  const supabase = createSupabaseAdminClient("to remove a deleted Commons photo");
  const { error } = await supabase.storage.from("commons-moments").remove([storagePath]);
  if (error) throw new Error("Photo storage deletion failed.");
}

export async function createPasswordlessEntryUrl(
  email: string,
  next: string,
  origin: string,
  intent: "sign-in" | "create" | "invited" | "access" = "sign-in",
) {
  const proof = await createPasswordlessEmailProof(email, `${origin}${safeAuthNext(next)}`);
  const confirmationUrl = new URL("/auth/confirm", origin);
  confirmationUrl.searchParams.set("token_hash", proof.tokenHash);
  confirmationUrl.searchParams.set("type", proof.type);
  confirmationUrl.searchParams.set("next", safeAuthNext(next));
  confirmationUrl.searchParams.set("intent", intent);
  return confirmationUrl.toString();
}

export async function createPasswordlessEmailProof(email: string, redirectTo: string) {
  const supabase = createSupabaseAdminClient("to create an authenticated email link");
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: email.trim().toLowerCase(),
    options: { redirectTo },
  });

  if (error || !data.properties.hashed_token) {
    throw new Error(error?.message ?? "Commons could not create a sign-in link.");
  }

  const type = data.properties.verification_type;
  if (type !== "magiclink" && type !== "signup") throw new Error("Unsupported sign-in proof.");
  return { tokenHash: data.properties.hashed_token, type, authUserId: data.user.id };
}

export async function getSupabaseAuthUserEmail(authUserId: string) {
  const supabase = createSupabaseAdminClient("to resolve a digest recipient");
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error || !data.user.email) {
    throw new Error(error?.message ?? "The digest recipient has no email address.");
  }
  return data.user.email;
}

export async function getSupabaseVerifiedAuthUserEmail(authUserId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient("to resolve a poll recipient");
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error) throw new Error("Poll recipient identity lookup failed.");
  return data.user?.email_confirmed_at && data.user.email ? data.user.email : null;
}

export async function storeCommonsConfirmationAsset(storagePath: string, bytes: Uint8Array, mimeType: string) {
  const supabase = createSupabaseAdminClient("to store a private confirmation");
  const { error } = await supabase.storage.from("commons-confirmations").upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (error && error.message !== "The resource already exists" && !error.message.toLowerCase().includes("duplicate")) throw new Error("The confirmation could not be stored. Retry this same file.");
}

/*
 * Password accounts, for copies with no email set up (D81). Accounts are created already confirmed, since there is no email to confirm
 * them with; who may create one is decided first by lib/server/instance-access.ts.
 */
export type PasswordAccountResult = "created" | "exists";

export async function createConfirmedPasswordAccount(email: string, password: string): Promise<PasswordAccountResult> {
  const supabase = createSupabaseAdminClient("to create an account without email");
  const { error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return "created";
  if (error.status === 422 || /already (been )?registered|already exists/i.test(error.message)) return "exists";
  throw new Error("Commons could not create the account.");
}

async function findAuthUserIdByEmail(email: string) {
  const supabase = createSupabaseAdminClient("to find an account");
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Commons could not look up accounts.");
    const match = data.users.find(user => user.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** The instance admin sets a new password for someone who forgot theirs. Returns false when no account has that email. */
export async function setPasswordForEmail(email: string, password: string) {
  const authUserId = await findAuthUserIdByEmail(email);
  if (!authUserId) return false;
  const supabase = createSupabaseAdminClient("to reset a password");
  const { error } = await supabase.auth.admin.updateUserById(authUserId, { password });
  if (error) throw new Error("Commons could not set the password.");
  return true;
}
