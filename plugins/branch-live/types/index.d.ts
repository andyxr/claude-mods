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
  /** The uncommitted files, as `git status` lists them, at most MAX_FILES. */
  files: WorkFile[]
  /** How many files `git status` listed, past MAX_FILES too. */
  changed: number
}

/** One uncommitted file: `xy` is porcelain v2's index and worktree letters (`.` unchanged), `??` untracked. */
export type WorkFile = { path: string; xy: string; from?: string }

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
