// Git reading, adapted from brancher's packages/core/src/git.ts and infer/mergeMessage.ts.
import type { GraphCommit, RepoEvent, WorkTree } from '../types'

export type Run = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

const FIELD = '\x00'
const RECORD = '\x1e'

export async function git(run: Run, args: string[]): Promise<string> {
  const r = await run(['git', ...args])
  if (r.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`)
  return r.stdout
}

/** One line per ref tip; a cheap fingerprint of the graph's shape. */
export async function readRefs(run: Run): Promise<Map<string, string>> {
  const out = await git(run, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags'])
  const refs = new Map<string, string>()
  for (const line of out.split('\n')) {
    if (!line) continue
    const [ref, hash, symref] = line.split(FIELD)
    if (symref) continue // e.g. refs/remotes/origin/HEAD
    refs.set(ref.slice('refs/'.length), hash)
  }
  return refs
}

export async function readCommits(run: Run, limit: number, refs: Map<string, string>): Promise<GraphCommit[]> {
  const format = ['%H', '%P', '%an', '%ct', '%s'].join('%x00') + '%x1e'
  const out = await git(run, ['log', 'HEAD', '--branches', '--remotes', '--tags', '--topo-order', `-n${limit}`, `--format=${format}`])
  const byHash = new Map<string, string[]>()
  for (const [ref, hash] of refs) byHash.set(hash, [...(byHash.get(hash) ?? []), ref])
  const commits: GraphCommit[] = []
  for (const raw of out.split(RECORD)) {
    const rec = raw.replace(/^\s+/, '')
    if (!rec) continue
    const [hash, parents, author, ct, subject = ''] = rec.split(FIELD)
    commits.push({ hash, parents: parents ? parents.split(' ') : [], author, time: Number(ct), subject, refs: byHash.get(hash) ?? [] })
  }
  return commits
}

export function parseStatus(out: string): WorkTree {
  const w: WorkTree = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const v = line.slice(13).trim()
      w.oid = v === '(initial)' ? null : v
    } else if (line.startsWith('# branch.head ')) {
      const v = line.slice(14).trim()
      w.branch = v === '(detached)' ? null : v
    } else if (line.startsWith('# branch.upstream ')) {
      w.upstream = line.slice(18).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) [w.ahead, w.behind] = [Number(m[1]), Number(m[2])]
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') w.staged++
      if (line[3] !== '.') w.unstaged++
    } else if (line.startsWith('u ')) {
      w.conflicted++
    } else if (line.startsWith('? ')) {
      w.untracked++
    }
  }
  return w
}

const quoted = /'([^']+)'/g

function stripRemote(name: string): string {
  const m = name.match(/^(?:origin|upstream)\/(.+)$/)
  return m ? m[1] : name
}

/** The branch a merge commit brought in, from its subject (git, GitHub, GitLab, Bitbucket). */
export function mergedBranchName(subject: string): string | undefined {
  let m: RegExpMatchArray | null
  if ((m = subject.match(/^Merge pull request #\d+ from [^/\s]+\/(\S+)/))) return m[1]
  if ((m = subject.match(/^Merged in (\S+)/))) return m[1]
  if ((m = subject.match(/^Merge (?:remote-tracking )?(?:branch|branches) (.+)$/))) {
    const body = m[1].replace(/\s+into\s+'?[^']+'?\s*$/, '').replace(/\s+of\s+\S+$/, '')
    const names = [...body.matchAll(quoted)].map(q => stripRemote(q[1]))
    return names[0]
  }
  return undefined
}

const short = (ref: string) => ref.replace(/^(heads|tags)\//, '').replace(/^remotes\//, '')

/** What changed between two ref sets, phrased for the event ticker. */
export function diffRefs(
  before: Map<string, string>,
  after: Map<string, string>,
  commits: Map<string, { parents: string[]; subject: string }>,
  at: number,
): RepoEvent[] {
  const events: RepoEvent[] = []
  for (const [ref, hash] of after) {
    const old = before.get(ref)
    if (old === hash) continue
    const name = short(ref)
    const isTag = ref.startsWith('tags/')
    const isRemote = ref.startsWith('remotes/')
    if (!old) {
      events.push({ kind: isTag ? 'tag' : 'branch', text: isTag ? `tag ${name}` : isRemote ? `${name} appeared` : `branch ${name} created`, at })
      continue
    }
    const c = commits.get(hash)
    if (c && c.parents.length > 1 && c.parents.includes(old)) {
      events.push({ kind: 'merge', text: `merge into ${name}: ${c.subject}`, at })
    } else if (c && c.parents[0] === old) {
      events.push({ kind: 'commit', text: `${name}: ${c.subject}`, at })
    } else if (isRemote) {
      events.push({ kind: 'move', text: `${name} updated`, at })
    } else {
      events.push({ kind: 'move', text: `${name} moved to ${hash.slice(0, 7)}`, at })
    }
  }
  for (const ref of before.keys()) {
    if (!after.has(ref)) events.push({ kind: 'delete', text: `${short(ref)} deleted`, at })
  }
  return events
}
