'use client';
import { useEffect, useRef } from 'react';
import { BudgetCaptureSchema, captureInputs } from './budget-capture';
import type { BudgetInputs } from './budget-calculations';
export function budgetCaptureAllowed() {
  try {
    return typeof window !== 'undefined'
      && ['www.commons.travel', 'commons.travel'].includes(location.hostname)
      && navigator.doNotTrack !== '1'
      && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
      && localStorage.getItem('commons:analytics:opt-out') !== 'true'
      && !document.querySelector('[data-analytics-exclude="true"]');
  } catch { return false; }
}
export function useBudgetCapture(inputs: BudgetInputs, destination: string | undefined, edited: boolean, lodgingEdited: boolean, enabled: boolean) {
  const identity = useRef<string | null>(null);
  const revision = useRef(0);
  const last = useRef('');
  const serialized = JSON.stringify(captureInputs(inputs));
  useEffect(() => {
    if (!enabled || !edited || !destination || !budgetCaptureAllowed() || last.current === serialized || revision.current >= 120) return;
    const timer = setTimeout(() => {
      if (!budgetCaptureAllowed()) return;
      identity.current ??= crypto.randomUUID();
      const input = BudgetCaptureSchema.safeParse({ id: identity.current, revision: revision.current + 1, destination, lodgingEdited, inputs: JSON.parse(serialized) });
      if (!input.success) return;
      revision.current++;
      last.current = serialized;
      void fetch('/api/v1/marketing/budget/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data), credentials: 'omit', keepalive: true }).catch(() => { /* An estimate remains usable if collection fails. */ });
    }, 2500);
    return () => clearTimeout(timer);
  }, [serialized, destination, edited, lodgingEdited, enabled]);
}
