import { authorHue } from '../../../shared/format'

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')

/** Local avatar: the author's initials on a colour derived from their email. No network. */
export const avatarColor = (email: string): string => `hsl(${authorHue(email)} 45% 36%)`

export function Avatar({ name, email, size = 36 }: { name: string; email: string; size?: number }) {
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
