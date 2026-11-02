import { useState, type DragEvent, type HTMLAttributes } from 'react'
import { canDropBranch, type DragBranch } from '../../shared/branch-drag'

const MIME = 'application/x-gitdesk-branch'

/** The branch being dragged. A browser hides drag data until the drop, so hover checks use this. */
let dragged: DragBranch | null = null

export type BranchDrop = (source: DragBranch, target: DragBranch, event: DragEvent) => void

/**
 * Make an element a draggable branch that other branches can be dropped on. `over` is true
 * while a droppable branch hovers it. Without `onDrop` the element is plain.
 */
export function useBranchDnd(branch: DragBranch, onDrop: BranchDrop | undefined): { props: HTMLAttributes<HTMLElement>; over: boolean } {
  const [over, setOver] = useState(false)
  if (onDrop === undefined) return { props: {}, over: false }

  const accepts = (): boolean => dragged !== null && canDropBranch(dragged, branch)
  const hover = (event: DragEvent): void => {
    if (!accepts()) return
    event.preventDefault() // marks this element as a valid drop target
    event.dataTransfer.dropEffect = 'move'
    setOver(true)
  }

  return {
    over,
    props: {
      draggable: true,
      onDragStart: (event) => {
        dragged = branch
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(MIME, branch.name) // some engines refuse to start a drag without data
      },
      onDragEnd: () => {
        dragged = null
        setOver(false)
      },
      onDragEnter: hover,
      onDragOver: hover,
      onDragLeave: (event) => {
        // Moving onto a child element also leaves the parent; only a real exit clears the highlight.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (event) => {
        setOver(false)
        if (dragged === null || !canDropBranch(dragged, branch)) return
        event.preventDefault()
        onDrop(dragged, branch, event)
        dragged = null
      }
    }
  }
}
