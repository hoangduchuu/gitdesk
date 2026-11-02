export type ViewerKind = 'image' | 'audio' | 'video' | 'pdf'

const TYPES: Record<string, { kind: ViewerKind; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  jfif: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  avif: { kind: 'image', mime: 'image/avif' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  ico: { kind: 'image', mime: 'image/x-icon' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  oga: { kind: 'audio', mime: 'audio/ogg' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  flac: { kind: 'audio', mime: 'audio/flac' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  ogv: { kind: 'video', mime: 'video/ogg' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  pdf: { kind: 'pdf', mime: 'application/pdf' }
}

/** What viewer (if any) a file path should get, judged by its extension. */
export function viewerFor(path: string): { kind: ViewerKind; mime: string } | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || path.lastIndexOf('/') > dot) return null
  return TYPES[path.slice(dot + 1).toLowerCase()] ?? null
}

/** Binary content sent to the renderer: base64 so it survives IPC as plain JSON-safe data. */
export interface FileBlob {
  size: number
  /** Base64 of the first `MAX_BLOB_BYTES` bytes. */
  base64: string
  truncated: boolean
}

export interface FileSides {
  old: FileBlob | null
  new: FileBlob | null
}

export const MAX_BLOB_BYTES = 32 * 1024 * 1024

export const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Classic hex dump rows: offset, 16 bytes of hex, printable ASCII. */
export function hexDump(bytes: Uint8Array, limit = 4096): string[] {
  const rows: string[] = []
  const end = Math.min(bytes.length, limit)
  for (let i = 0; i < end; i += 16) {
    const chunk = bytes.subarray(i, Math.min(i + 16, end))
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ')
    const text = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    rows.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${text}`)
  }
  return rows
}
