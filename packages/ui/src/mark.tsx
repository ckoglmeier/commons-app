import type { SVGProps } from "react";
import { commonsBirdViewBox } from "./brand";

import { SeasonalBrandPaths } from "./seasonal-brand";

export function CommonsMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox={commonsBirdViewBox} aria-hidden="true" {...props}>
      <SeasonalBrandPaths />
    </svg>
  );
}

/** The bird and complete wordmark remain separate, conventional letterforms. */
export function CommonsWordmark() {
  return (
    <strong className="cm-wordmark" aria-label="Commons">
      <CommonsMark /><span aria-hidden="true">Commons</span>
    </strong>
  );
}

export function CoordinatorMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M12 1.9c.65 6.5 3.6 9.45 10.1 10.1-6.5.65-9.45 3.6-10.1 10.1C11.35 15.6 8.4 12.65 1.9 12 8.4 11.35 11.35 8.4 12 1.9Z"
        fill="currentColor"
      />
    </svg>
  );
}
