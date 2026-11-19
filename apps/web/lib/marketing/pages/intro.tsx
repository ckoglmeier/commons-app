import Image from 'next/image';
import type { ReactNode } from 'react';
import css from './pages.module.css';
export function IllustratedIntro({ children, image, imageAlt = '' }: { children: ReactNode; image?: string; imageAlt?: string }) {
  return <div className={`${css.intro} ${image ? '' : css.introPlain}`}><div className={css.introCopy}>{children}</div>{image && <div className={css.artwork}><Image src={image} alt={imageAlt} width={720} height={480} sizes="(min-width: 760px) 460px, 100vw" priority /></div>}</div>;
}
