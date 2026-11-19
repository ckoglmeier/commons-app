import { notFound } from 'next/navigation';
import { CoordinatorOnboardingPrototype } from '@/components/coordinator-onboarding-prototype';
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <CoordinatorOnboardingPrototype />;
}
