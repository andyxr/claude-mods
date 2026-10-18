export type GraphCommit = {
  hash: string
  parents: string[]
  author: string
  time: number
  subject: string
  /** Ref names pointing here: `heads/x`, `remotes/origin/x`, `tags/v1`. */
  refs: string[]
}

export type WorkTree = {
  branch: string | null
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

export type RepoEvent = { text: string; kind: 'commit' | 'merge' | 'branch' | 'delete' | 'switch' | 'move' | 'tag'; at: number }

export type Snapshot = {
  error: string | null
  root: string | null
  head: WorkTree
  commits: GraphCommit[]
  /** Commit hash -> ms when it first appeared, for the arrival glow. */
  fresh: Record<string, number>
  events: RepoEvent[]
}

declare module 'claude-code' {
  interface PluginState {
    'branch-live': { snap: Snapshot; now: number }
  }
}
