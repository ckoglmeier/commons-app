"use client";

import Image from "next/image";
import { useState } from "react";

export function ResilientCoverImage({
  src,
  alt,
  className,
  priority = false,
  sizes,
  onDimensions,
}: {
  src: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes: string;
  onDimensions?: (dimensions: { width: number; height: number }) => void;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!src || failedSource === src) return null;

  return (
    <Image
      className={className}
      src={src}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      unoptimized
      onLoad={event => {
        const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
        if (width > 0 && height > 0) onDimensions?.({ width, height });
      }}
      onError={() => setFailedSource(src)}
    />
  );
}
