import { currentSignInMethod } from "@/lib/server/sign-in-method";
import { PasswordSignInForm } from "./password-sign-in-form";
import { SignInForm } from "./sign-in-form";

/** The right sign-in form for this copy: an emailed link when email is set up, a password when it isn't (D81). */
export async function EntryForm({ next, intent = "sign-in", submitLabel }: { next: string; intent?: "sign-in" | "create" | "invited"; submitLabel?: string }) {
  const method = await currentSignInMethod();
  if (method === "password") return <PasswordSignInForm next={next} intent={intent} />;
  return <SignInForm next={next} intent={intent} enabled={method !== "off"} submitLabel={method === "test" ? "Sign in as this test person" : submitLabel} />;
}
