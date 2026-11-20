"use server";

import { z } from "zod";
import { currentPersonIsInstanceAdmin } from "@/lib/server/instance-access";
import { currentSignInMethod } from "@/lib/server/sign-in-method";
import { setPasswordForEmail } from "@/lib/supabase/admin";

export type ResetPasswordState = { status?: "done" | "error"; message?: string };

const ResetSchema = z.object({ email: z.email(), password: z.string().min(8).max(200) });

/** The instance admin sets a temporary password for someone who forgot theirs. Only on copies that sign in with passwords (D81). */
export async function resetPersonPassword(_previous: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  if (await currentSignInMethod() !== "password" || !await currentPersonIsInstanceAdmin()) return { status: "error", message: "Not available." };
  const parsed = ResetSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { status: "error", message: "Enter their email and a password of at least 8 characters." };
  try {
    const found = await setPasswordForEmail(parsed.data.email, parsed.data.password);
    return found
      ? { status: "done", message: "Password set. Share it with them privately; they can change it on their Profile." }
      : { status: "error", message: "No account uses that email." };
  } catch {
    return { status: "error", message: "Password not set. Try again." };
  }
}
