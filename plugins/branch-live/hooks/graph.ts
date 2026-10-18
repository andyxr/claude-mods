// Cell painting for the terminal's bottom-up graph. Newest commit sits at the bottom; history grows upwards.
import type { Snapshot } from '../types'
import { DEFAULT, DIM, FADE_MS, FAINT, HEAD_ROW, INK, age, badges, glowOf, headColor, headline, layout, mix, nodeKind, ticker, worktree } from './model'
import type { NodeKind } from './model'

export { DEFAULT }

const U = 1, D = 2, L = 4, R = 8
const BOX: Record<number, string> = {
  [U]: '│', [D]: '│', [U | D]: '│', [L]: '─', [R]: '─', [L | R]: '─',
  [D | R]: '╭', [D | L]: '╮', [U | R]: '╰', [U | L]: '╯',
  [U | D | R]: '├', [U | D | L]: '┤', [D | L | R]: '┬', [U | L | R]: '┴', [U | D | L | R]: '┼',
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

const GLYPH: Record<NodeKind, string> = { head: '◉', merge: '◆', fresh: '✦', commit: '●' }

/** Paints the whole pane: graph growing up from the bottom, event ticker, then the HEAD status bar. */
export function paint(snap: Snapshot, w: number, h: number, now: number): Canvas {
  const cv = new Canvas(w, h)
  const head = snap.head
  const hc = headColor(head)

  // Footer: the current branch and commit, at the very bottom.
  const footer = 3
  const fy = h - footer
  for (let x = 0; x < w; x++) cv.set(x, fy, '▁', hc)
  let x = 0
  const by = h - 2
  cv.fillBg(by, 0, w, mix(hc, 0, 0.82))
  for (const s of headline(head)) x = s.chip ? cv.text(x, by, s.text, INK, s.color) : cv.text(x, by, s.text, s.color)
  let tx = 1
  for (const s of worktree(head)) tx = cv.text(tx, h - 1, s.text, s.color)

  // Event ticker, newest just above the footer.
  const evs = ticker(snap.events, Math.min(3, h - footer - 6))
  evs.forEach((ev, i) => {
    const y = fy - evs.length + i
    const fade = Math.min(1, (now - ev.at) / FADE_MS)
    const ex = cv.text(1, y, ev.clock + ' ', mix(DIM, FAINT, fade))
    const gx = cv.text(ex, y, ev.glyph + ' ', mix(ev.color, FAINT, fade * 0.7))
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
    const glow = glowOf(snap.fresh[c.hash], now)
    const kind = nodeKind(c, head.oid, glow)
    const isHead = kind === 'head'
    const rowBg = isHead ? HEAD_ROW : glow > 0 ? mix(0x000000, n.color, glow * 0.45) : undefined
    if (rowBg !== undefined) cv.fillBg(y, 0, w, rowBg)
    cv.set(nx, y, GLYPH[kind], glow > 0 ? mix(n.color, 0xffffff, glow * 0.6) : n.color)

    // Label: ref badges, short hash, subject, age right-aligned.
    let lx = gw + 1
    const right = w - 1
    const when = age(c.time, now)
    const textMax = right - when.length - 1
    for (const b of badges(c, head)) {
      if (lx >= textMax - 4) break
      const label = ` ${b.text} `
      lx = (b.kind === 'remote' ? cv.text(lx, y, label, b.color, mix(b.color, 0, 0.75), textMax) : cv.text(lx, y, label, INK, b.color, textMax)) + 1
    }
    lx = cv.text(lx, y, c.hash.slice(0, 7) + ' ', DIM, rowBg, textMax)
    cv.text(lx, y, c.subject, isHead || glow > 0 ? 0xffffff : DEFAULT, rowBg, textMax)
    cv.text(right - when.length + 1, y, when, FAINT, rowBg)
  }

  // Older history continues above the window.
  if (snap.commits.length > visible.length && yOf(visible.length - 1) > 0) cv.text(gw + 1, 0, `↑ ${snap.commits.length - visible.length}+ older`, FAINT)
  return cv
}
