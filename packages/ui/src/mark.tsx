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
