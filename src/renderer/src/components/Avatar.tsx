import { useEffect, useState } from 'react'
import { authorHue } from '../../../shared/format'

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')

/** The author's initials on a colour derived from their email: no network. A picture, when given, replaces them. */
export const avatarColor = (email: string): string => `hsl(${authorHue(email)} 45% 36%)`

interface AvatarProps {
  name: string
  email: string
  size?: number
  /** A `data:` URI with the person's picture; the initials show without it or if it cannot be drawn. */
  src?: string | null
}

export function Avatar({ name, email, size = 36, src }: AvatarProps) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (src && !broken) {
    return <img className="avatar avatar-image" src={src} alt="" width={size} height={size} title={`${name} <${email}>`} onError={() => setBroken(true)} />
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: avatarColor(email), fontSize: Math.round(size * 0.38) }}
      title={`${name} <${email}>`}
    >
      {initials(name)}
    </span>
  )
}
