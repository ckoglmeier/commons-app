"use client";

import { useRouter } from "next/navigation";
import { PhoneVerification } from "@/components/phone-verification";

export function AccountPhoneForm({ next }: { next: string }) {
  const router = useRouter();
  return <PhoneVerification onVerified={() => { router.push(next); router.refresh(); }} />;
}
