// Lane layout and cell painting for the bottom-up graph. Newest commit sits at the bottom; history grows upwards.
import type { GraphCommit, Snapshot } from '../types'
import { mergedBranchName } from './git'

export const DEFAULT = 0x01000000
const DIM = 0x7c8594
const FAINT = 0x4a5160
const TRUNK = 0x22d3ee
const HEAD_ROW = 0x14283a
const GOOD = 0x4ade80
const WARN = 0xfbbf24
const BAD = 0xf87171
const INK = 0x0b0f17

const U = 1, D = 2, L = 4, R = 8
const BOX: Record<number, string> = {
  [U]: '│', [D]: '│', [U | D]: '│', [L]: '─', [R]: '─', [L | R]: '─',
  [D | R]: '╭', [D | L]: '╮', [U | R]: '╰', [U | L]: '╯',
  [U | D | R]: '├', [U | D | L]: '┤', [D | L | R]: '┬', [U | L | R]: '┴', [U | D | L | R]: '┼',
}

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

/** A grid of [codePoint, fg, bg] cells. */
export class Canvas {
  readonly cp: Uint32Array
  readonly fg: Uint32Array
  readonly bg: Uint32Array
  readonly mask: Uint8Array
  constructor(readonly w: number, readonly h: number) {
    const n = w * h
    this.cp = new Uint32Array(n).fill(32)
    this.fg = new Uint32Array(n).fill(DEFAULT)
    this.bg = new Uint32Array(n).fill(DEFAULT)
    this.mask = new Uint8Array(n)
  }
  in(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }
  set(x: number, y: number, ch: string | number, fg?: number, bg?: number) {
    if (!this.in(x, y)) return
    const i = y * this.w + x
    this.cp[i] = typeof ch === 'number' ? ch : safe(ch.codePointAt(0) ?? 32)
    if (fg !== undefined) this.fg[i] = fg
    if (bg !== undefined) this.bg[i] = bg
  }
  line(x: number, y: number, bits: number, fg: number) {
    if (!this.in(x, y)) return
    const i = y * this.w + x
    this.mask[i] |= bits
    this.cp[i] = (BOX[this.mask[i]] ?? ' ').codePointAt(0)!
    this.fg[i] = fg
  }
  fillBg(y: number, x0: number, x1: number, bg: number) {
    for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.bg[y * this.w + x] = bg
  }
  /** Writes text from x, clipped at `max`; returns the column after it. */
  text(x: number, y: number, s: string, fg: number, bg?: number, max = this.w): number {
    for (const ch of s) {
      if (x >= max) break
      const c = ch.codePointAt(0)!
      if (c >= 0x300 && c <= 0x36f) continue
      this.set(x++, y, safe(c), fg, bg)
    }
    return x
  }
  /** Standard padded base64 of the little-endian [cp, fg, bg] triplets. */
  encode(): string {
    const n = this.w * this.h
    const words = new Uint32Array(n * 3)
    for (let i = 0; i < n; i++) {
      words[i * 3] = this.cp[i]
      words[i * 3 + 1] = this.fg[i]
      words[i * 3 + 2] = this.bg[i]
    }
    return base64(new Uint8Array(words.buffer))
  }
}

/** Keeps a cell to one printable, width-1 BMP character. */
function safe(c: number): number {
  if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return 32
  if (c > 0xffff) return 0x3f
  const wide =
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0xd800 && c <= 0xdfff) || (c >= 0x200b && c <= 0x200f)
  return wide ? 0x3f : c
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64[n >> 18] + B64[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '='
  }
  return out
}

function age(sec: number, now: number): string {
  const d = Math.max(0, Math.round(now / 1000 - sec))
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d`
  if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo`
  return `${Math.floor(d / (86400 * 365))}y`
}

function clock(ms: number): string {
  const t = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
}

const GLOW_MS = 6000
const EVENT_GLYPH: Record<string, [string, number]> = {
  commit: ['●', GOOD], merge: ['◆', 0xc084fc], branch: ['⑂', TRUNK], delete: ['✕', BAD], switch: ['⇄', WARN], move: ['↻', DIM], tag: ['◈', WARN],
}

/** Paints the whole pane: graph growing up from the bottom, event ticker, then the HEAD status bar. */
export function paint(snap: Snapshot, w: number, h: number, now: number): Canvas {
  const cv = new Canvas(w, h)
  const head = snap.head
  const headColor = head.branch ? branchColor(head.branch) : WARN

  // Footer: the current branch and commit, at the very bottom.
  const footer = 3
  const fy = h - footer
  for (let x = 0; x < w; x++) cv.set(x, fy, '▁', headColor)
  let x = 0
  const by = h - 2
  cv.fillBg(by, 0, w, mix(headColor, 0, 0.82))
  x = cv.text(x, by, ` ⎇ ${head.branch ?? 'detached HEAD'} `, INK, headColor)
  x = cv.text(x, by, ` ◉ ${head.oid ? head.oid.slice(0, 7) : 'no commits'} `, headColor, mix(headColor, 0, 0.82))
  if (head.upstream) {
    x = cv.text(x, by, ` → ${head.upstream}`, DIM)
    if (head.ahead) x = cv.text(x + 1, by, `⇡${head.ahead}`, GOOD)
    if (head.behind) x = cv.text(x + 1, by, `⇣${head.behind}`, WARN)
    if (!head.ahead && !head.behind) x = cv.text(x + 1, by, '≡', DIM)
  }
  const ty = h - 1
  const clean = !head.staged && !head.unstaged && !head.untracked && !head.conflicted
  if (clean) cv.text(1, ty, '✓ working tree clean', GOOD)
  else {
    let tx = 1
    if (head.conflicted) tx = cv.text(tx, ty, `✕ ${head.conflicted} conflicted  `, BAD)
    if (head.staged) tx = cv.text(tx, ty, `✚ ${head.staged} staged  `, GOOD)
    if (head.unstaged) tx = cv.text(tx, ty, `✎ ${head.unstaged} modified  `, WARN)
    if (head.untracked) tx = cv.text(tx, ty, `? ${head.untracked} untracked`, DIM)
  }

  // Event ticker, newest just above the footer.
  const evRows = Math.min(3, snap.events.length, Math.max(0, h - footer - 6))
  const evs = snap.events.slice(-evRows)
  evs.forEach((ev, i) => {
    const y = fy - evs.length + i
    const fade = Math.min(1, (now - ev.at) / 20000)
    const [glyph, col] = EVENT_GLYPH[ev.kind] ?? ['•', DIM]
    const ex = cv.text(1, y, clock(ev.at) + ' ', mix(DIM, FAINT, fade))
    const gx = cv.text(ex, y, glyph + ' ', mix(col, FAINT, fade * 0.7))
    cv.text(gx, y, ev.text, mix(0xe5e7eb, DIM, fade), undefined, w - 1)
  })

  const gh = fy - evs.length - (evs.length ? 1 : 0)
  if (snap.error) {
    cv.text(1, Math.max(0, gh - 2), snap.error, BAD, undefined, w - 1)
    return cv
  }
  if (!snap.commits.length || gh < 1) return cv

  const visible = snap.commits.slice(0, Math.ceil(gh / 2))
  const lay = layout(visible, head.oid)
  const maxLanes = Math.max(1, Math.min(lay.lanes, Math.floor((w * 0.4 - 1) / 2)))
  const gw = 1 + maxLanes * 2
  const yOf = (i: number) => gh - 1 - i * 2
  const xOf = (lane: number) => (lane < maxLanes ? 1 + lane * 2 : -1)

  const hline = (y: number, xa: number, xb: number, from: number, to: number, color: number) => {
    // A turn on row y: leaves column xa going `from`, arrives at xb going `to`.
    if (xa === xb) return cv.line(xa, y, U | D, color)
    const dir = xb > xa ? R : L
    const back = dir === R ? L : R
    cv.line(xa, y, from | dir, color)
    for (let xx = Math.min(xa, xb) + 1; xx < Math.max(xa, xb); xx++) cv.line(xx, y, L | R, color)
    cv.line(xb, y, to | back, color)
  }
  const clipX = (v: number) => (v < 0 ? gw - 1 : v)

  for (const e of lay.edges) {
    const yc = yOf(e.child)
    const xc = clipX(xOf(e.childLane))
    const xl = clipX(xOf(e.lane))
    const pi = lay.rowOf.get(e.parent)
    const pn = pi === undefined ? undefined : lay.nodes[pi]
    const yA = yc - 1
    if (yA < 0) continue
    if (pn) {
      const yp = yOf(pn.idx)
      const xp = clipX(xOf(pn.lane))
      const yB = yp + 1
      if (yA === yB) {
        hline(yA, xc, xp, D, U, e.color)
        continue
      }
      hline(yA, xc, xl, D, U, e.color)
      for (let y = yA - 1; y > yB; y--) cv.line(xl, y, U | D, e.color)
      hline(yB, xl, xp, D, U, e.color)
    } else {
      hline(yA, xc, xl, D, U, e.color)
      for (let y = yA - 1; y >= 0; y--) cv.line(xl, y, U | D, e.color)
    }
  }

  for (const n of lay.nodes) {
    const c = visible[n.idx]
    const y = yOf(n.idx)
    if (y < 0) continue
    const nx = clipX(xOf(n.lane))
    const isHead = c.hash === head.oid
    const born = snap.fresh[c.hash]
    const glow = born ? Math.max(0, 1 - (now - born) / GLOW_MS) : 0
    const rowBg = isHead ? HEAD_ROW : glow > 0 ? mix(0x000000, n.color, glow * 0.45) : undefined
    if (rowBg !== undefined) cv.fillBg(y, 0, w, rowBg)
    const glyph = isHead ? '◉' : c.parents.length > 1 ? '◆' : glow > 0 ? '✦' : '●'
    cv.set(nx, y, glyph, glow > 0 ? mix(n.color, 0xffffff, glow * 0.6) : n.color)

    // Label: ref badges, short hash, subject, age right-aligned.
    let lx = gw + 1
    const right = w - 1
    const when = age(c.time, now)
    const textMax = right - when.length - 1
    if (isHead) lx = cv.text(lx, y, head.branch ? ' HEAD ' : ' HEAD (detached) ', INK, WARN, textMax) + 1
    for (const ref of c.refs) {
      if (lx >= textMax - 4) break
      const isTag = ref.startsWith('tags/')
      const isRemote = ref.startsWith('remotes/')
      const name = ref.replace(/^(heads|tags|remotes)\//, '')
      const col = isTag ? WARN : branchColor(name.replace(/^[^/]+\//, isRemote ? '' : '$&'))
      const label = isTag ? ` ◈ ${name} ` : ` ${name} `
      lx = isRemote ? cv.text(lx, y, label, col, mix(col, 0, 0.75), textMax) + 1 : cv.text(lx, y, label, INK, col, textMax) + 1
    }
    lx = cv.text(lx, y, c.hash.slice(0, 7) + ' ', DIM, rowBg, textMax)
    cv.text(lx, y, c.subject, isHead || glow > 0 ? 0xffffff : DEFAULT, rowBg, textMax)
    cv.text(right - when.length + 1, y, when, FAINT, rowBg)
  }

  // Older history continues above the window.
  if (snap.commits.length > visible.length && yOf(visible.length - 1) > 0) cv.text(gw + 1, 0, `↑ ${snap.commits.length - visible.length}+ older`, FAINT)
  return cv
}
