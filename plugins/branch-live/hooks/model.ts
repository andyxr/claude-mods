// What both painters draw from: lane layout, branch colors, and the footer, ticker and badge content.
// The terminal paints it into cells (graph.ts), the other surfaces into SVG (svg.ts).
import type { GraphCommit, RepoEvent, WorkTree } from '../types'
import { mergedBranchName } from './git'

export const DEFAULT = 0x01000000
export const DIM = 0x7c8594
export const FAINT = 0x4a5160
export const TRUNK = 0x22d3ee
export const HEAD_ROW = 0x14283a
export const GOOD = 0x4ade80
export const WARN = 0xfbbf24
export const BAD = 0xf87171
export const INK = 0x0b0f17

function fnv(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hsl(h: number, s: number, l: number): number {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  return (f(0) << 16) | (f(8) << 8) | f(4)
}

const TRUNKS = new Set(['main', 'master', 'trunk', 'develop'])

/** Stable color per branch name (brancher's scheme): trunk cyan, others skip the cyan band. */
export function branchColor(name: string): number {
  if (TRUNKS.has(name.replace(/^[^/]+\//, '')) || TRUNKS.has(name)) return TRUNK
  let hue = fnv(name) % 300
  if (hue > 165) hue += 60
  return hsl(hue, 75, 62)
}

export function mix(a: number, b: number, t: number): number {
  const ch = (x: number, s: number) => (x >> s) & 0xff
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t)
  return (m(16) << 16) | (m(8) << 8) | m(0)
}

type Node = { idx: number; lane: number; color: number }
type Edge = { child: number; childLane: number; lane: number; parent: string; color: number }
export type Layout = { nodes: Node[]; edges: Edge[]; lanes: number; rowOf: Map<string, number> }

const branchOf = (c: GraphCommit) => {
  const head = c.refs.find(r => r.startsWith('heads/')) ?? c.refs.find(r => r.startsWith('remotes/'))
  return head?.replace(/^heads\//, '').replace(/^remotes\//, '')
}

/** git-graph style lane packing over commits listed newest first; `head` is pinned to lane 0. */
export function layout(commits: GraphCommit[], head: string | null): Layout {
  const cols: (string | null)[] = []
  const colColor: number[] = []
  const nodes: Node[] = []
  const edges: Edge[] = []
  const rowOf = new Map(commits.map((c, i) => [c.hash, i]))
  const free = (avoid = -1) => {
    const i = cols.findIndex((v, j) => v === null && j !== avoid)
    return i >= 0 ? i : cols.length
  }
  if (head && rowOf.has(head)) {
    cols[0] = head
    colColor[0] = -1
  }
  let lanes = 0
  commits.forEach((c, idx) => {
    const matches = cols.flatMap((v, j) => (v === c.hash ? [j] : []))
    let lane: number
    if (matches.length) {
      lane = matches[0]
      for (const m of matches.slice(1)) cols[m] = null
    } else {
      lane = free()
      colColor[lane] = -1
    }
    const name = branchOf(c)
    if (colColor[lane] === -1 || colColor[lane] === undefined) colColor[lane] = name ? branchColor(name) : branchColor(c.hash)
    const color = colColor[lane]
    nodes.push({ idx, lane, color })
    cols[lane] = c.parents[0] ?? null
    if (c.parents[0]) edges.push({ child: idx, childLane: lane, lane, parent: c.parents[0], color })
    const merged = mergedBranchName(c.subject)
    c.parents.slice(1).forEach(p => {
      let pl = cols.indexOf(p)
      if (pl < 0) {
        pl = free(lane)
        cols[pl] = p
        colColor[pl] = branchColor(merged ?? p)
      }
      edges.push({ child: idx, childLane: lane, lane: pl, parent: p, color: colColor[pl] })
    })
    lanes = Math.max(lanes, cols.length)
  })
  return { nodes, edges, lanes, rowOf }
}


export function age(sec: number, now: number): string {
  const d = Math.max(0, Math.round(now / 1000 - sec))
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo`
  return `${Math.floor(d / (86400 * 365))}y`
}

export function clock(ms: number): string {
  const t = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
}

export const GLOW_MS = 6000
export const EVENT_GLYPH: Record<string, [string, number]> = {
  commit: ['●', GOOD], merge: ['◆', 0xc084fc], branch: ['⑂', TRUNK], delete: ['✕', BAD], switch: ['⇄', WARN], move: ['↻', DIM], tag: ['◈', WARN],
}

export const FADE_MS = 20000

/** A run of footer text; a chip is drawn as INK on `color`, the rest as `color` on the bar. */
export type Seg = { text: string; color: number; chip?: boolean }

/** The bar: branch chip, HEAD commit, upstream and how far ahead or behind it. */
export function headline(head: WorkTree): Seg[] {
  const color = headColor(head)
  const segs: Seg[] = [
    { text: ` ⎇ ${head.branch ?? 'detached HEAD'} `, color, chip: true },
    { text: ` ◉ ${head.oid ? head.oid.slice(0, 7) : 'no commits'} `, color },
  ]
  if (head.upstream) {
    segs.push({ text: ` → ${head.upstream}`, color: DIM })
    if (head.ahead) segs.push({ text: ` ⇡${head.ahead}`, color: GOOD })
    if (head.behind) segs.push({ text: ` ⇣${head.behind}`, color: WARN })
    if (!head.ahead && !head.behind) segs.push({ text: ' ≡', color: DIM })
  }
  return segs
}

/** The line under the bar: what the working tree holds. */
export function worktree(head: WorkTree): Seg[] {
  if (!head.staged && !head.unstaged && !head.untracked && !head.conflicted) return [{ text: '✓ working tree clean', color: GOOD }]
  const segs: Seg[] = []
  if (head.conflicted) segs.push({ text: `✕ ${head.conflicted} conflicted  `, color: BAD })
  if (head.staged) segs.push({ text: `✚ ${head.staged} staged  `, color: GOOD })
  if (head.unstaged) segs.push({ text: `✎ ${head.unstaged} modified  `, color: WARN })
  if (head.untracked) segs.push({ text: `? ${head.untracked} untracked`, color: DIM })
  return segs
}

export const headColor = (head: WorkTree) => (head.branch ? branchColor(head.branch) : WARN)

export type TickerRow = { at: number; clock: string; glyph: string; color: number; text: string }

/** The newest `max` events, oldest first; each painter fades them by `at`. */
export function ticker(events: RepoEvent[], max: number): TickerRow[] {
  if (max <= 0) return []
  return events.slice(-max).map(ev => {
    const [glyph, color] = EVENT_GLYPH[ev.kind] ?? ['•', DIM]
    return { at: ev.at, clock: clock(ev.at), glyph, color, text: ev.text }
  })
}

export type Badge = { text: string; color: number; kind: 'head' | 'local' | 'remote' | 'tag' }

/** The labels before a commit's subject: HEAD first where it sits, then each ref. */
export function badges(c: GraphCommit, head: WorkTree): Badge[] {
  const out: Badge[] = c.hash === head.oid ? [{ text: head.branch ? 'HEAD' : 'HEAD (detached)', color: WARN, kind: 'head' }] : []
  return out.concat(c.refs.map((ref): Badge => {
    const kind = ref.startsWith('tags/') ? 'tag' : ref.startsWith('remotes/') ? 'remote' : 'local'
    const name = ref.replace(/^(heads|tags|remotes)\//, '')
    if (kind === 'tag') return { text: `◈ ${name}`, color: WARN, kind }
    return { text: name, color: branchColor(name.replace(/^[^/]+\//, kind === 'remote' ? '' : '$&')), kind }
  }))
}

export type NodeKind = 'head' | 'merge' | 'fresh' | 'commit'

export function nodeKind(c: GraphCommit, headOid: string | null, glow: number): NodeKind {
  return c.hash === headOid ? 'head' : c.parents.length > 1 ? 'merge' : glow > 0 ? 'fresh' : 'commit'
}

/** 1 the moment a commit arrives, down to 0 over GLOW_MS. */
export const glowOf = (born: number | undefined, now: number) => (born ? Math.max(0, 1 - (now - born) / GLOW_MS) : 0)
