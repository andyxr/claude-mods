export type Point = { x: number; y: number }
export type Invader = Point & { kind: 0 | 1 | 2 }
export type Boom = Point & { ttl: number }
export type Status = 'ready' | 'running' | 'paused' | 'over'

export type Game = {
  width: number
  height: number
  player: number
  invaders: Invader[]
  dir: 1 | -1
  shot: Point | null
  bombs: Point[]
  booms: Boom[]
  score: number
  lives: number
  wave: number
  status: Status
  seed: number
  tick: number
  frame: number
  hurt: number
  total: number
}

export const POINTS = [30, 20, 10] as const
const BOMB_EVERY = 3
const HURT_TICKS = 20
const BOOM_TICKS = 6

const nextSeed = (seed: number) => (Math.imul(seed, 1664525) + 1013904223) >>> 0

function formation(width: number, height: number): Invader[] {
  const cols = Math.max(1, Math.min(8, Math.floor((width - 3) / 2)))
  const rows = Math.max(1, Math.min(5, height - 8))
  const left = Math.floor((width - (cols * 2 - 1)) / 2)
  const out: Invader[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push({ x: left + c * 2, y: 1 + r, kind: r === 0 ? 0 : r < 3 ? 1 : 2 })
  return out
}

export function newGame(width: number, height: number, seed: number): Game {
  const invaders = formation(width, height)
  return {
    width, height, player: Math.floor(width / 2), invaders, dir: 1, shot: null, bombs: [], booms: [],
    score: 0, lives: 3, wave: 1, status: 'ready', seed, tick: 0, frame: 0, hurt: 0, total: invaders.length,
  }
}

const start = (game: Game): Game => (game.status === 'ready' ? { ...game, status: 'running' } : game)

export function move(game: Game, dx: -1 | 1): Game {
  if (game.status !== 'running' && game.status !== 'ready') return game
  return start({ ...game, player: Math.max(0, Math.min(game.width - 1, game.player + dx)) })
}

export function fire(game: Game): Game {
  if (game.status !== 'running' && game.status !== 'ready') return game
  if (game.shot) return start(game)
  return start({ ...game, shot: { x: game.player, y: game.height - 2 } })
}

export function togglePause(game: Game): Game {
  if (game.status === 'running') return { ...game, status: 'paused' }
  if (game.status === 'paused') return { ...game, status: 'running' }
  return game
}

/** Ticks between formation steps: slow when full, quicker as it thins and with each wave. */
export function marchEvery(game: Game) {
  return Math.max(1, Math.round(1 + (game.invaders.length / game.total) * 14) - (game.wave - 1))
}

function hitInvader(game: Game, shot: Point) {
  const i = game.invaders.findIndex(v => v.x === shot.x && v.y === shot.y)
  if (i < 0) return false
  const [dead] = game.invaders.splice(i, 1)
  game.score += POINTS[dead!.kind]
  game.booms.push({ x: dead!.x, y: dead!.y, ttl: BOOM_TICKS })
  game.shot = null
  return true
}

export function step(game: Game): Game {
  if (game.status !== 'running') return game
  const g: Game = { ...game, invaders: game.invaders.map(v => ({ ...v })), bombs: game.bombs.map(b => ({ ...b })), shot: game.shot && { ...game.shot } }
  g.tick++
  g.hurt = Math.max(0, g.hurt - 1)
  g.booms = g.booms.map(b => ({ ...b, ttl: b.ttl - 1 })).filter(b => b.ttl > 0)

  if (g.shot) {
    g.shot.y--
    if (g.shot.y < 0) g.shot = null
    else hitInvader(g, g.shot)
  }

  if (g.tick % marchEvery(g) === 0 && g.invaders.length) {
    const edge = g.invaders.some(v => v.x + g.dir < 0 || v.x + g.dir >= g.width)
    for (const v of g.invaders) edge ? v.y++ : (v.x += g.dir)
    if (edge) g.dir = g.dir === 1 ? -1 : 1
    g.frame++
    if (g.shot) hitInvader(g, g.shot)
  }

  if (g.tick % BOMB_EVERY === 0) {
    for (const b of g.bombs) b.y++
    g.bombs = g.bombs.filter(b => b.y < g.height)
  }

  const bottom = g.height - 1
  const struck = g.bombs.some(b => b.y === bottom && b.x === g.player)
  if (struck && g.hurt === 0) {
    g.lives--
    g.hurt = HURT_TICKS
    g.bombs = []
    g.booms.push({ x: g.player, y: bottom, ttl: BOOM_TICKS * 2 })
    if (g.lives <= 0) return { ...g, status: 'over' }
  }

  if (g.invaders.some(v => v.y >= bottom)) return { ...g, status: 'over' }

  g.seed = nextSeed(g.seed)
  const chance = 0.04 + g.wave * 0.01
  if (g.invaders.length && (g.seed % 1000) / 1000 < chance && g.bombs.length < 2 + g.wave) {
    g.seed = nextSeed(g.seed)
    const shooter = g.invaders[g.seed % g.invaders.length]!
    const lowest = g.invaders.filter(v => v.x === shooter.x).reduce((a, b) => (b.y > a.y ? b : a))
    g.bombs.push({ x: lowest.x, y: lowest.y + 1 })
  }

  if (!g.invaders.length) {
    const invaders = formation(g.width, g.height)
    return { ...g, invaders, total: invaders.length, wave: g.wave + 1, dir: 1, shot: null, bombs: [], tick: 0 }
  }
  return g
}

export type Cell = { kind: 'invader'; invader: Invader } | { kind: 'player' | 'shot' | 'bomb' | 'boom' } | null

/** Each cell's contents, later layers drawn over earlier ones. */
export function grid(game: Game): Cell[][] {
  const rows: Cell[][] = Array.from({ length: game.height }, () => Array<Cell>(game.width).fill(null))
  const put = (p: Point, cell: Cell) => { if (rows[p.y] && p.x >= 0 && p.x < game.width) rows[p.y]![p.x] = cell }
  for (const v of game.invaders) put(v, { kind: 'invader', invader: v })
  for (const b of game.bombs) put(b, { kind: 'bomb' })
  if (game.shot) put(game.shot, { kind: 'shot' })
  if (game.status !== 'over' || game.lives > 0) put({ x: game.player, y: game.height - 1 }, { kind: 'player' })
  for (const b of game.booms) put(b, { kind: 'boom' })
  return rows
}
