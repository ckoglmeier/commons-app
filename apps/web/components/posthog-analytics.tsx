'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { updatePosthogRoute, refreshPosthogIdentity } from '@/lib/posthog-client';

export function PosthogAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    void updatePosthogRoute();
    const refresh = () => { void refreshPosthogIdentity().then(updatePosthogRoute); };
    window.addEventListener("focus", refresh);
    const observer = new MutationObserver(() => { void updatePosthogRoute(); });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-analytics-exclude'], childList: true, subtree: true });
    return () => { observer.disconnect(); window.removeEventListener("focus", refresh); };
  }, [pathname]);
  return null;
}
