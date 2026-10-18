export type Point = { x: number; y: number }
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Snake = [Point, ...Point[]]
export type Status = 'ready' | 'running' | 'paused' | 'over'

export type Game = {
  width: number
  height: number
  snake: Snake
  dir: Dir
  queued: Dir[]
  food: Point
  score: number
  status: Status
  seed: number
}

const DELTA: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

const nextSeed = (seed: number) => (Math.imul(seed, 1664525) + 1013904223) >>> 0

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

export function placeFood(width: number, height: number, snake: Snake, seed: number) {
  const free: Point[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (!snake.some(p => p.x === x && p.y === y)) free.push({ x, y })
  const next = nextSeed(seed)
  return { food: free[next % free.length] ?? snake[0], seed: next }
}

export function newGame(width: number, height: number, seed: number): Game {
  const cy = Math.floor(height / 2)
  const cx = Math.floor(width / 2)
  const snake: Snake = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ]
  const placed = placeFood(width, height, snake, seed)
  return { width, height, snake, dir: 'right', queued: [], food: placed.food, score: 0, status: 'ready', seed: placed.seed }
}

export function turn(game: Game, dir: Dir): Game {
  if (game.status === 'over' || game.status === 'paused') return game
  const last = game.queued[game.queued.length - 1] ?? game.dir
  if (dir === last || dir === OPPOSITE[last] || game.queued.length >= 3) return game.status === 'ready' ? { ...game, status: 'running' } : game
  return { ...game, queued: [...game.queued, dir], status: 'running' }
}

export function togglePause(game: Game): Game {
  if (game.status === 'running') return { ...game, status: 'paused' }
  if (game.status === 'paused') return { ...game, status: 'running' }
  return game
}

export function step(game: Game): Game {
  if (game.status !== 'running') return game
  const [dir = game.dir, ...queued] = game.queued
  const d = DELTA[dir]
  const head = { x: game.snake[0].x + d.x, y: game.snake[0].y + d.y }
  const eats = same(head, game.food)
  const body = eats ? game.snake : game.snake.slice(0, -1)
  const hitsWall = head.x < 0 || head.y < 0 || head.x >= game.width || head.y >= game.height
  if (hitsWall || body.some(p => same(p, head))) return { ...game, dir, queued, status: 'over' }
  const snake: Snake = [head, ...body]
  if (!eats) return { ...game, snake, dir, queued }
  if (snake.length === game.width * game.height) return { ...game, snake, dir, queued, score: game.score + 1, status: 'over' }
  const placed = placeFood(game.width, game.height, snake, game.seed)
  return { ...game, snake, dir, queued, score: game.score + 1, food: placed.food, seed: placed.seed }
}

export type Cell = number | 'food' | null

/** Each cell's contents: the snake segment's index (0 = head), food, or empty. */
export function grid(game: Game): Cell[][] {
  const rows: Cell[][] = Array.from({ length: game.height }, () => Array<Cell>(game.width).fill(null))
  rows[game.food.y]![game.food.x] = 'food'
  for (let i = game.snake.length - 1; i >= 0; i--) {
    const p = game.snake[i]!
    if (rows[p.y]) rows[p.y]![p.x] = i
  }
  return rows
}

export function speedMs(score: number) {
  return Math.max(60, 150 - score * 4)
}
