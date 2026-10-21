export type Lem = {
  x: number
  /** Row of the feet; the sprite is four rows tall. */
  y: number
  vy: number
  dx: number
  state: 'walk' | 'fall' | 'splat'
  t: number
}

export type World = { lems: Lem[]; tick: number; lost: number; seed: number }

export type Geom = {
  width: number
  height: number
  /** First column of the cliff. */
  cliffX: number
  /** Row of the cliff's grass; lemmings walk on the row above it. */
  top: number
  /** Rows of bodies at the foot of the cliff, fractional. */
  pile: number
}

// Four rows for a lemming plus one of air above the cliff.
export const SKY = 5

export const geom = (width: number, height: number, fill: number): Geom => {
  const cliffX = width - Math.max(4, Math.round(width / 3))
  const top = Math.min(SKY, height - 1)
  const pile = Math.max(0, Math.min(1, fill)) * (height - top)
  return { width, height, cliffX, top, pile }
}

/** Row a falling lemming's body stops on: the one just above the pile. */
export const landing = (g: Geom) => Math.max(g.top - 1, g.height - Math.ceil(g.pile) - 1)

const rand = (seed: number) => {
  const s = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0
  return { seed: s, value: s / 2 ** 32 }
}

export const newWorld = (seed: number): World => ({ lems: [], tick: 0, lost: 0, seed: seed >>> 0 })

export const spawn = (w: World, g: Geom): World => {
  const r = rand(w.seed)
  const lem: Lem = { x: g.width - 1, y: g.top - 1, vy: 0, dx: 0.08 + r.value * 0.35, state: 'walk', t: 0 }
  return { ...w, seed: r.seed, lems: [...w.lems, lem] }
}

const WALK = 0.34
const GRAVITY = 0.12
const TERMINAL = 1.1
const SPLAT_TICKS = 8

export const step = (w: World, g: Geom): World => {
  let lost = w.lost
  const floor = landing(g)
  const lems: Lem[] = []
  for (const l of w.lems) {
    const t = l.t + 1
    if (l.state === 'walk') {
      const x = l.x - WALK
      lems.push(x < g.cliffX ? { ...l, x, t, state: 'fall', vy: 0 } : { ...l, x, t })
    } else if (l.state === 'fall') {
      const vy = Math.min(TERMINAL, l.vy + GRAVITY)
      const y = l.y + vy
      const x = Math.max(0, l.x - l.dx)
      if (y >= floor) {
        lost++
        lems.push({ ...l, x, y: floor, vy: 0, t: 0, state: 'splat' })
      } else lems.push({ ...l, x, y, vy, t })
    } else if (t < SPLAT_TICKS) lems.push({ ...l, t })
  }
  return { ...w, lems, lost, tick: w.tick + 1 }
}
