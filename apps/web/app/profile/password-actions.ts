"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentSignInMethod } from "@/lib/server/sign-in-method";

export type ChangePasswordState = { status?: "done" | "error"; message?: string };

/** Change your own password. Only on copies that sign in with passwords (D81). */
export async function changeOwnPassword(_previous: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  if (await currentSignInMethod() !== "password") return { status: "error", message: "Not available." };
  const parsed = z.string().min(8).max(200).safeParse(formData.get("password"));
  if (!parsed.success) return { status: "error", message: "Use a password of at least 8 characters." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  return error ? { status: "error", message: "Password not changed. Sign in again and retry." } : { status: "done", message: "Password changed." };
}
