'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { updatePosthogRoute } from '@/lib/posthog-client';

export function PosthogAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    void updatePosthogRoute();
    const observer = new MutationObserver(() => { void updatePosthogRoute(); });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-analytics-exclude'], childList: true, subtree: true });
    return () => { observer.disconnect(); };
  }, [pathname]);
  return null;
}
