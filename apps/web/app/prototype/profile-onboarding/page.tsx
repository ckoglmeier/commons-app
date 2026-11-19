import type { Metadata } from "next";
import { parseOnboardingPrototypeState } from "@/lib/onboarding-prototype-state";
import { ProfileOnboardingPrototype } from "./profile-onboarding-prototype";

export const metadata: Metadata = {
  title: "Profile onboarding prototype — Commons",
  description: "A review prototype for reusable traveler profiles and progressive onboarding.",
  robots: { index: false, follow: false },
};

export default async function ProfileOnboardingPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string | string[]; step?: string | string[]; mode?: string | string[] }>;
}) {
  const initialState = parseOnboardingPrototypeState(await searchParams);
  return <ProfileOnboardingPrototype initialState={initialState} />;
}
