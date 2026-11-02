import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  /** Current width of the pane this handle resizes, in pixels. */
  value: number
  min: number
  max: number
  /** Dragging right grows the pane (sidebar) or shrinks it (details on the right). */
  direction: 1 | -1
  label: string
  /** Width restored by double-clicking the handle. */
  reset: number
  onChange: (width: number) => void
}

const STEP = 16

/** Vertical drag handle between panes; also resizable with the arrow keys. */
export function Splitter({ value, min, max, direction, label, reset, onChange }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const clamp = (width: number): number => Math.min(max, Math.max(min, Math.round(width)))

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { x: event.clientX, width: value }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (start.current) onChange(clamp(start.current.width + direction * (event.clientX - start.current.x)))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowRight' ? STEP : event.key === 'ArrowLeft' ? -STEP : 0
    if (delta === 0) return
    event.preventDefault()
    onChange(clamp(value + direction * delta))
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(reset)}
    />
  )
}
