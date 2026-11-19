"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Upload } from "tus-js-client";
import { getSupabaseAuthConfig } from "./config";
import { getCommonsAuthCookieOptions } from "./session";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getSupabaseAuthConfig();
  browserClient = createBrowserClient(url, publishableKey, {
    cookieOptions: getCommonsAuthCookieOptions(window.location.hostname),
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  });
  return browserClient;
}

const resumableUploadThreshold = 6 * 1024 * 1024;

function resumableStorageEndpoint(supabaseUrl: string) {
  const endpoint = new URL(supabaseUrl);
  if (endpoint.hostname.endsWith(".supabase.co")) {
    endpoint.hostname = endpoint.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  endpoint.pathname = "/storage/v1/upload/resumable";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export async function uploadCommonsPhoto(storagePath: string, photo: Blob) {
  const supabase = getSupabaseBrowserClient();
  if (photo.size <= resumableUploadThreshold) {
    const [slug, filename] = storagePath.split("/");
    const id = filename?.replace(/\.[^.]+$/, "");
    let response: Response;
    try {
      response = await fetch(`/api/v1/commons/${slug}/moments/upload-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, mimeType: photo.type }),
      });
    } catch {
      throw new Error("Couldn’t connect to upload the photo. Check your connection and try again.");
    }
    const payload = await response.json().catch(() => null) as {
      storagePath?: string;
      token?: string;
      error?: string;
    } | null;
    if (!response.ok || !payload?.token || payload.storagePath !== storagePath) {
      throw new Error(payload?.error ?? "Photo upload is temporarily unavailable. Try again shortly.");
    }
    const { error } = await supabase.storage
      .from("commons-moments")
      .uploadToSignedUrl(storagePath, payload.token, photo, {
        contentType: photo.type,
        upsert: false,
      });
    if (error) {
      console.error("Commons signed photo upload failed", {
        message: error.message,
        name: error.name,
      });
      throw new Error("Photo didn’t finish uploading. Check your connection and try again.");
    }
    return;
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    throw sessionError ?? new Error("Sign in again to add this photo.");
  }
  const { url } = getSupabaseAuthConfig();

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(photo, {
      endpoint: resumableStorageEndpoint(url),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "commons-moments",
        objectName: storagePath,
        contentType: photo.type,
        cacheControl: "3600",
      },
      chunkSize: resumableUploadThreshold,
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

type CoverUploadSlot = {
  storagePath: string;
  token: string;
};

async function uploadCoverObject(slot: CoverUploadSlot, photo: Blob) {
  const supabase = getSupabaseBrowserClient();
  if (photo.size <= resumableUploadThreshold) {
    const { error } = await supabase.storage
      .from("commons-moments")
      .uploadToSignedUrl(slot.storagePath, slot.token, photo, {
        contentType: photo.type,
        upsert: false,
      });
    if (error) throw new Error("Cover photo didn’t finish uploading. Check your connection and try again.");
    return;
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) throw sessionError ?? new Error("Sign in again to add this cover.");
  const { url } = getSupabaseAuthConfig();
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(photo, {
      endpoint: resumableStorageEndpoint(url),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${session.access_token}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "commons-moments",
        objectName: slot.storagePath,
        contentType: photo.type,
        cacheControl: "3600",
      },
      chunkSize: resumableUploadThreshold,
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export async function uploadCommonsCover(slug: string, id: string, original: Blob, card: Blob) {
  let response: Response;
  try {
    response = await fetch(`/api/v1/commons/${slug}/cover-image/upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, mimeType: original.type }),
    });
  } catch {
    throw new Error("Couldn’t connect to upload the cover. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => null) as {
    original?: CoverUploadSlot;
    card?: CoverUploadSlot;
    error?: string;
  } | null;
  if (!response.ok || !payload?.original || !payload.card) {
    throw new Error(payload?.error ?? "Cover upload is temporarily unavailable. Try again shortly.");
  }
  await uploadCoverObject(payload.original, original);
  try {
    await uploadCoverObject(payload.card, card);
  } catch (error) {
    await getSupabaseBrowserClient().storage.from("commons-moments").remove([payload.original.storagePath]);
    throw error;
  }
  return { originalStoragePath: payload.original.storagePath, cardStoragePath: payload.card.storagePath };
}

export async function uploadCommonsConfirmation(
  slot: { storagePath: string; token: string; mimeType?: string },
  file: File,
) {
  const { error } = await getSupabaseBrowserClient().storage
    .from("commons-confirmations")
    .uploadToSignedUrl(slot.storagePath, slot.token, file, {
      contentType: slot.mimeType ?? "application/pdf",
      upsert: false,
    });
  if (error) throw new Error("Confirmation didn’t finish uploading. Your trip is unchanged. Try again.");
}
