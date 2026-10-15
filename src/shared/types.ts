export type RefKind = 'head' | 'branch' | 'remote' | 'tag'

export interface Ref {
  name: string
  kind: RefKind
}

export interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** Unix seconds */
  authorTime: number
  refs: Ref[]
  subject: string
  /** Message after the subject line; empty when there is none. */
  body: string
}

export interface RepoInfo {
  path: string
  name: string
  head: string | null
}

/** A line segment inside one graph row, in lane (column) units. */
export interface GraphSegment {
  from: number
  to: number
  /** Lane whose colour the segment uses. */
  color: number
}

/** Anything that can be laid out in the graph: a commit, a stash or the WIP node. */
export interface GraphItem {
  hash: string
  parents: readonly string[]
}

export interface GraphRow<T extends GraphItem = GraphItem> {
  node: T
  column: number
  /** Segments from the row's top edge to its vertical middle. */
  top: GraphSegment[]
  /** Segments from the row's vertical middle to its bottom edge. */
  bottom: GraphSegment[]
  /** Lanes needed to draw this row. */
  width: number
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
