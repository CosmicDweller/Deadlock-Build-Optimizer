import { useState } from 'react'

interface Props {
  src: string
  alt: string
  className?: string
}

/**
 * Hero/item art hotlinked from the official Deadlock CDN. The URLs come
 * from the API export rather than being constructed, since filenames follow
 * internal codenames (Abrams is `hero_atlas` but his art is `bull_sm.webp`).
 *
 * Art is decorative here — every icon sits next to its own name — so a
 * missing or blocked image unmounts rather than leaving a broken-image box,
 * and the surrounding layout reserves no space for it.
 */
export function GameIcon({ src, alt, className }: Props) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
