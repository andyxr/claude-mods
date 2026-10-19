// SVG painting for the surfaces that draw vectors (desktop, mobile): the same bottom-up graph as graph.ts, with curves,
// hover tooltips, and the arrival glow and ticker fade run by SMIL so no redraw timer is needed.
// The whole history is drawn and the pane scrolls over it; it is cut into stacked pieces, as one Svg holds at most MAX_SVG
// characters and MAX_H pixels.
import type { GraphCommit, Snapshot } from '../types'
import { BAD, DIM, FADE_MS, FAINT, GLOW_MS, HEAD_ROW, INK, age, badges, glowOf, headColor, headline, layout, mix, nodeKind, ticker, worktree } from './model'

/** The engine sizes a remote pane in monospace cells; roughly this many CSS pixels each. */
export const CELL_W = 8
export const CELL_H = 18
/** The Svg element refuses markup longer than this. */
export const MAX_SVG = 131072
/** The desktop drops an Svg taller (or wider) than this many CSS px, with no word of it. */
export const MAX_H = 4096

/** One Svg of the stack, `height` CSS pixels tall. */
export type Piece = { svg: string; height: number }

const ROW = 26
const LANE = 16
const PAD = 12
const TICK = 18
const BAR = 26
const LINE = 20
const CHUNK = Math.floor(MAX_H / ROW)
const BG = 0x0d1117
const FG = 0xe5e7eb

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
/** A width estimate for laying out runs side by side; there is nothing to measure text with here. */
const textW = (s: string, px: number) => [...s].length * px
const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
const STYLE =
  `.row:hover .hit{fill:#ffffff0d}.m{font-family:${MONO}}` +
  `.h{font-size:11px;fill:${hex(DIM)}}.s{font-size:12px;fill:${hex(FG)}}.s.b{fill:#fff;font-weight:600}` +
  `.a{font-size:11px;fill:${hex(FAINT)};text-anchor:end}.t{font-size:11px;font-weight:600}.f{font-size:12px;white-space:pre}`

/**
 * A document showing rows `y` to `y + h` of a drawing laid out `w` wide.
 * The frame is held to the pane's width, so it can come out narrower than `w`: `slice` then clips the right edge, where
 * the default would shrink the drawing and open bands above and below it, gaps between the pieces.
 */
const doc = (w: number, y: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 ${y} ${w} ${h}" preserveAspectRatio="xMinYMin slice" overflow="hidden" font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">` +
  `<style>${STYLE}</style><rect x="0" y="${y}" width="${w}" height="${h}" fill="${hex(BG)}"/>${body}</svg>`

/** Up from (xc, yc) to (xp, yp): turns into lane xl just above the child, runs up it, turns into the parent's lane just below the parent. */
function edgePath(xc: number, yc: number, xl: number, xp: number, yp: number): string {
  const h = ROW / 2
  if (yc - yp <= ROW) return xc === xp ? `M${xc} ${yc}V${yp}` : `M${xc} ${yc}C${xc} ${yc - h} ${xp} ${yp + h} ${xp} ${yp}`
  let d = `M${xc} ${yc}`
  let y = yc
  if (xc !== xl) {
    d += `C${xc} ${yc - h} ${xl} ${yc - h} ${xl} ${yc - ROW}`
    y = yc - ROW
  }
  const turn = xl !== xp ? yp + ROW : yp
  if (turn < y) d += `V${turn}`
  if (xl !== xp) d += `C${xl} ${yp + h} ${xp} ${yp + h} ${xp} ${yp}`
  return d
}

function stamp(sec: number): string {
  const t = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

/** The ticker and the HEAD bar, the piece under the graph. */
export function status(snap: Snapshot, w: number, now: number): Piece {
  const head = snap.head
  const hc = headColor(head)
  const o: string[] = []
  const evs = ticker(snap.events, 3)
  const tickH = evs.length ? evs.length * TICK + 6 : 0
  const fy = tickH
  const h = tickH + 2 + BAR + LINE

  evs.forEach((ev, i) => {
    const y = 4 + i * TICK + 12
    o.push(`<g><animate attributeName="opacity" from="1" to="0.35" dur="${secs(FADE_MS)}" begin="${secs(-(now - ev.at))}" fill="freeze"/>`)
    o.push(`<text x="${PAD}" y="${y}" class="m h">${esc(ev.clock)}</text>`)
    o.push(`<text x="${PAD + 64}" y="${y}" class="s" style="fill:${hex(ev.color)}">${esc(ev.glyph)}</text>`)
    o.push(`<text x="${PAD + 82}" y="${y}" class="s">${esc(ev.text)}</text></g>`)
  })

  o.push(`<rect x="0" y="${fy}" width="${w}" height="2" fill="${hex(hc)}"/>`)
  o.push(`<rect x="0" y="${fy + 2}" width="${w}" height="${BAR}" fill="${hex(mix(hc, BG, 0.82))}"/>`)
  let x = 0
  const by = fy + 2 + BAR / 2 + 4
  for (const s of headline(head)) {
    const sw = textW(s.text, 7.2)
    if (s.chip) {
      o.push(`<rect x="${x}" y="${fy + 2}" width="${sw}" height="${BAR}" fill="${hex(s.color)}"/>`)
      o.push(`<text x="${x}" y="${by}" class="m f" fill="${hex(INK)}" font-weight="600">${esc(s.text)}</text>`)
    } else o.push(`<text x="${x}" y="${by}" class="m f" fill="${hex(s.color)}">${esc(s.text)}</text>`)
    x += sw
  }
  x = PAD
  for (const s of worktree(head)) {
    o.push(`<text x="${x}" y="${fy + 2 + BAR + 14}" class="m f" fill="${hex(s.color)}">${esc(s.text)}</text>`)
    x += textW(s.text, 7.2)
  }
  return { svg: doc(w, 0, h, o.join('')), height: h }
}

/**
 * Every loaded commit, newest on the bottom row, at least `minH` tall so a short history sits on the status bar.
 * Cut into pieces top to bottom, each a window over one drawing, so the lanes run on across the joins.
 */
export function graph(snap: Snapshot, w: number, minH: number, now: number): Piece[] {
  if (snap.error) {
    const h = Math.min(MAX_H, Math.max(ROW * 2, minH))
    return [{ svg: doc(w, 0, h, `<text x="${PAD}" y="${h - 16}" class="s" style="fill:${hex(BAD)}">${esc(snap.error)}</text>`), height: h }]
  }
  const H = Math.max(snap.commits.length * ROW, minH)
  if (!snap.commits.length) return H > 0 ? [{ svg: doc(w, 0, Math.min(H, MAX_H), ''), height: Math.min(H, MAX_H) }] : []
  const items = draw(snap, w, H, now)
  for (let rows = CHUNK; ; rows = Math.max(1, Math.floor(rows / 2))) {
    const pieces: Piece[] = []
    // Cut from the bottom, so the joins fall between rows; the top piece takes what is left over.
    for (let b = H; b > 0; b -= rows * ROW) {
      const a = Math.max(0, b - rows * ROW)
      const body = items.filter(it => it.y1 > a && it.y0 < b).map(it => it.svg).join('')
      pieces.unshift({ svg: doc(w, a, b - a, body), height: b - a })
    }
    if (rows === 1 || pieces.every(p => p.svg.length <= MAX_SVG)) return pieces
  }
}

type Item = { y0: number; y1: number; svg: string }

function draw(snap: Snapshot, w: number, H: number, now: number): Item[] {
  const head = snap.head
  const commits: GraphCommit[] = snap.commits
  const items: Item[] = []
  const lay = layout(commits, head.oid)
  const maxLanes = Math.max(1, Math.min(lay.lanes, Math.floor((w * 0.4 - PAD) / LANE)))
  const gw = PAD + maxLanes * LANE
  const xOf = (lane: number) => PAD + Math.min(lane, maxLanes - 1) * LANE
  const yOf = (i: number) => H - ROW / 2 - i * ROW
  const ageW = 40
  const labelW = Math.max(0, w - gw - ageW - PAD)
  // Label coordinates are local to a viewport that clips them, the row's middle at MID.
  const MID = ROW / 2

  // Rows first (backgrounds, hover targets, labels), so the lanes and nodes sit on top.
  for (const n of lay.nodes) {
    const c = commits[n.idx]!
    const y = yOf(n.idx)
    const born = snap.fresh[c.hash]
    const glow = glowOf(born, now)
    const kind = nodeKind(c, head.oid, glow)
    const o: string[] = []
    o.push(`<g class="row"><title>${esc(`${c.hash}\n${c.author} · ${stamp(c.time)}\n${c.subject}`)}</title>`)
    o.push(`<rect class="hit" x="0" y="${y - ROW / 2}" width="${w}" height="${ROW}" fill="transparent"/>`)
    if (kind === 'head') o.push(`<rect x="0" y="${y - ROW / 2}" width="${w}" height="${ROW}" fill="${hex(HEAD_ROW)}"/>`)
    else if (glow > 0) {
      o.push(`<rect x="0" y="${y - ROW / 2}" width="${w}" height="${ROW}" fill="${hex(n.color)}" opacity="0">`)
      o.push(`<animate attributeName="opacity" from="0.35" to="0" dur="${secs(GLOW_MS)}" begin="${secs(-(now - born!))}" fill="freeze"/></rect>`)
    }
    o.push(`<svg x="${gw}" y="${y - MID}" width="${labelW}" height="${ROW}">`)
    let lx = 6
    for (const b of badges(c, head)) {
      const bw = textW(b.text, 6.6) + 10
      const remote = b.kind === 'remote'
      o.push(`<rect x="${lx}" y="${MID - 8}" width="${bw}" height="16" rx="3" fill="${hex(remote ? mix(b.color, BG, 0.8) : b.color)}"${remote ? ` stroke="${hex(b.color)}"` : ''}/>`)
      o.push(`<text x="${lx + 5}" y="${MID + 4}" class="t" fill="${hex(remote ? b.color : INK)}">${esc(b.text)}</text>`)
      lx += bw + 5
    }
    o.push(`<text x="${lx}" y="${MID + 4}" class="m h">${c.hash.slice(0, 7)}</text>`)
    // The viewport hides what the row cannot show; a subject longer than any pane is cut so it does not cost markup.
    o.push(`<text x="${lx + 58}" y="${MID + 4}" class="s${kind === 'head' || glow > 0 ? ' b' : ''}">${esc(c.subject.slice(0, 200))}</text></svg>`)
    o.push(`<text x="${w - PAD}" y="${y + 4}" class="a">${age(c.time, now)}</text></g>`)
    items.push({ y0: y - ROW / 2, y1: y + ROW / 2, svg: o.join('') })
  }

  for (const e of lay.edges) {
    const yc = yOf(e.child)
    const xc = xOf(e.childLane)
    const xl = xOf(e.lane)
    const pi = lay.rowOf.get(e.parent)
    const pn = pi === undefined ? undefined : lay.nodes[pi]
    // A parent past the loaded history: the lane runs off the top.
    const yp = pn ? yOf(pn.idx) : 0
    const d = edgePath(xc, yc, xl, pn ? xOf(pn.lane) : xl, yp)
    items.push({ y0: yp, y1: yc, svg: `<path d="${d}" fill="none" stroke="${hex(e.color)}" stroke-width="2" stroke-linecap="round"/>` })
  }

  for (const n of lay.nodes) {
    const c = commits[n.idx]!
    const x = xOf(n.lane)
    const y = yOf(n.idx)
    const born = snap.fresh[c.hash]
    const col = hex(n.color)
    let svg: string
    switch (nodeKind(c, head.oid, glowOf(born, now))) {
      case 'head':
        svg = `<circle cx="${x}" cy="${y}" r="8" fill="none" stroke="${col}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="4.5" fill="${col}"/>`
        break
      case 'merge':
        svg = `<path d="M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z" fill="${col}" stroke="${hex(BG)}" stroke-width="1.5"/>`
        break
      case 'fresh': {
        const pulse = `dur="1.5s" begin="${secs(-(now - born!))}" repeatCount="${Math.ceil(GLOW_MS / 1500)}"`
        svg =
          `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="${col}" stroke-width="2" opacity="0">` +
          `<animate attributeName="r" from="5" to="13" ${pulse}/><animate attributeName="opacity" from="0.9" to="0" ${pulse}/></circle>` +
          `<circle cx="${x}" cy="${y}" r="5" fill="${hex(mix(n.color, 0xffffff, 0.5))}" stroke="${hex(BG)}" stroke-width="1.5"/>`
        break
      }
      default:
        svg = `<circle cx="${x}" cy="${y}" r="4.5" fill="${col}" stroke="${hex(BG)}" stroke-width="1.5"/>`
    }
    items.push({ y0: y - 13, y1: y + 13, svg })
  }
  return items
}

/** What the drawing says, for a reader that cannot see it. */
export function describe(snap: Snapshot): string {
  if (snap.error) return snap.error
  const head = snap.head
  const at = head.oid ? head.oid.slice(0, 7) : 'no commits'
  const latest = snap.commits.find(c => c.hash === head.oid)?.subject
  return `Git graph: ${head.branch ?? 'detached HEAD'} at ${at}${latest ? `, "${latest}"` : ''}; ${snap.commits.length} commits loaded.`
}

/** What the status bar says, for a reader that cannot see it. */
export const describeStatus = (snap: Snapshot) => [...headline(snap.head), ...worktree(snap.head)].map(s => s.text.trim()).filter(Boolean).join(' · ')
