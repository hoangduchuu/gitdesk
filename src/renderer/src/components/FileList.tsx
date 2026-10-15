import { useState, type CSSProperties, type ReactNode } from 'react'
import { buildFileTree, type TreeNode } from '../../../shared/file-tree'
import { splitPath } from '../../../shared/format'
import type { ChangeKind, ConflictKind } from '../../../shared/model'
import { useFileViewMode } from '../hooks/useFileViewMode'
import { ChangeIcon, iconKindFor } from './ChangeIcon'
import { FileIcon, FolderIcon } from './FileIcon'

export interface FileListItem {
  key: string
  path: string
  origPath?: string
  kind: ChangeKind | ConflictKind
}

interface Props<T extends FileListItem> {
  files: readonly T[]
  selectedKey?: string | null
  onOpen: (file: T) => void
  actions?: (file: T) => ReactNode
  empty?: string
}

const INDENT = 14
const BASE_PADDING = 12
/** Files line up under their folder's name, past the chevron. */
const FILE_OFFSET = 14

/** File list shown as a folder tree (default, like VS Code) or as plain paths. */
export function FileList<T extends FileListItem>(props: Props<T>) {
  const mode = useFileViewMode()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const { files, empty } = props

  if (files.length === 0) return empty ? <p className="file-empty">{empty}</p> : null

  const toggle = (path: string): void =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <ul className="file-list">
      {mode === 'path'
        ? files.map((file) => <FileRow key={file.key} {...props} file={file} label={<FilePath path={file.path} />} depth={0} />)
        : renderTree(buildFileTree(files), 0, props, collapsed, toggle)}
    </ul>
  )
}

function renderTree<T extends FileListItem>(
  nodes: ReadonlyArray<TreeNode<T>>,
  depth: number,
  props: Props<T>,
  collapsed: ReadonlySet<string>,
  toggle: (path: string) => void
): ReactNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') {
      return [
        <FileRow
          key={node.item.key}
          {...props}
          file={node.item}
          label={<span className="file-name">{node.name}</span>}
          depth={depth}
        />
      ]
    }
    const isOpen = !collapsed.has(node.path)
    return [
      <li
        key={`dir:${node.path}`}
        className="file-row folder-row"
        style={{ paddingLeft: BASE_PADDING + depth * INDENT } as CSSProperties}
        onClick={() => toggle(node.path)}
        title={node.path}
        aria-expanded={isOpen}
      >
        <svg className={`chevron${isOpen ? ' open' : ''}`} viewBox="0 0 16 16" aria-hidden>
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        <FolderIcon name={node.name} open={isOpen} />
        <span className="folder-name">{node.name}</span>
      </li>,
      ...(isOpen ? renderTree(node.children, depth + 1, props, collapsed, toggle) : [])
    ]
  })
}

function FileRow<T extends FileListItem>({
  file,
  label,
  depth,
  selectedKey,
  onOpen,
  actions
}: Props<T> & { file: T; label: ReactNode; depth: number }) {
  return (
    <li
      className={`file-row${file.key === selectedKey ? ' selected' : ''}`}
      style={{ paddingLeft: BASE_PADDING + depth * INDENT + (depth > 0 ? FILE_OFFSET : 0) } as CSSProperties}
      onClick={() => onOpen(file)}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
    >
      <span className="file-kind">
        <ChangeIcon kind={iconKindFor(file.kind)} />
      </span>
      <FileIcon path={file.path} />
      {label}
      {actions && (
        <span className="file-actions" onClick={(event) => event.stopPropagation()}>
          {actions(file)}
        </span>
      )}
    </li>
  )
}

/** Folder dimmed, file name emphasised, as in GitKraken's path view. */
function FilePath({ path }: { path: string }) {
  const { dir, name } = splitPath(path)
  return (
    <span className="file-path">
      {dir && <span className="file-dir">{dir}</span>}
      <span className="file-name">{name}</span>
    </span>
  )
}
