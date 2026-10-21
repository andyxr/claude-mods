import type { ClientModule } from 'claude-code'

import { geom, newWorld, spawn, step } from './sim'
import type { Geom, World } from './sim'

export type BoardProps = { used: number | null; window: number; compactAt: number | null }

type Local = { world: World; used: number | null; window: number; queue: number }

const TICK_MS = 80
// One lemming every ~2.4s, plus a rush whenever the context grows.
const SPAWN_EVERY = 30
const RUSH_EVERY = 4
const MAX_LEMS = 40
// Title and stats above the board, the hint below it.
const CHROME_ROWS = 3

const SKY_BG = '#0b0e1f'
const GRASS = '#3fae49'
const ROCK_BG = '#5a3a20'
const ROCK_FG = '#8a5a33'
const HAIR = '#38fe51'
const ROBE = '#5d56e4'
const SKIN = '#f7efd8'
const PILE_BG = '#1d2a6b'

type Paint = { text: string; color?: string; backgroundColor?: string; bold?: boolean }

const hash = (x: number, y: number) => ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 997

const fmt = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

const fillOf = (p: BoardProps) => (p.used === null || p.window <= 0 ? 0 : p.used / p.window)

const BODIES: Paint[] = [
  { text: '●', color: HAIR },
  { text: '▄', color: ROBE },
  { text: '▀', color: ROBE },
  { text: 'x', color: SKIN },
  { text: '▓', color: ROBE },
  { text: '◒', color: HAIR },
  { text: '▚', color: SKIN },
]
const LUMPS = ' ▁▂▃▄▅▆▇'

function paintScene(g: Geom, compactRow: number | null): Paint[][] {
  const pileFull = Math.floor(g.pile)
  const pilePart = g.pile - pileFull
  const rows: Paint[][] = []
  for (let y = 0; y < g.height; y++) {
    const row: Paint[] = []
    const fromBottom = g.height - 1 - y
    for (let x = 0; x < g.width; x++) {
      const h = hash(x, y)
      if (x >= g.cliffX && y >= g.top) {
        // A ragged cliff face, grass on top.
        if (x === g.cliffX && y > g.top && h % 3 === 0) row.push({ text: '▐', color: ROCK_BG, backgroundColor: y >= g.height - pileFull ? PILE_BG : SKY_BG })
        else if (y === g.top) row.push({ text: '▀', color: GRASS, backgroundColor: ROCK_BG })
        else row.push({ text: h % 5 === 0 ? '▒' : h % 3 === 0 ? '░' : ' ', color: ROCK_FG, backgroundColor: ROCK_BG })
      } else if (x < g.cliffX && fromBottom < pileFull) {
        row.push({ ...BODIES[h % BODIES.length]!, backgroundColor: PILE_BG })
      } else if (x < g.cliffX && fromBottom === pileFull && pilePart > 0) {
        const lump = Math.max(0, Math.min(LUMPS.length - 1, Math.round(pilePart * (LUMPS.length - 1) + ((h % 3) - 1))))
        row.push({ text: LUMPS[lump]!, color: PILE_BG, backgroundColor: SKY_BG })
      } else if (x < g.cliffX && y === compactRow) {
        row.push({ text: '┄', color: '#7a2a3a', backgroundColor: SKY_BG })
      } else if (h % 41 === 0 && y < g.height / 2) row.push({ text: '·', color: '#3a3f6a', backgroundColor: SKY_BG })
      else row.push({ text: ' ', backgroundColor: SKY_BG })
    }
    rows.push(row)
  }
  if (compactRow !== null && compactRow > g.top && compactRow < g.height - Math.ceil(g.pile)) {
    const label = 'autocompact'
    for (let i = 0; i < label.length && i < g.cliffX; i++) rows[compactRow]![i] = { text: label[i]!, color: '#a23a4f', backgroundColor: SKY_BG }
  }
  return rows
}

// Classic lemmings, one character per pixel column and two pixel rows per cell. Walkers face left.
const PIXEL: Record<string, string> = { G: HAIR, B: ROBE, S: SKIN }
const WALK_A = ['G.G.', '.GGG', '.SGG', 'SSS.', '.BS.', '.BBS', 'SBB.', '..SS']
const WALK_B = ['G.G.', '.GGG', '.SGG', 'SSS.', '.BS.', '.BBS', '.BB.', '.SS.']
const FLAIL = ['...GG...', '..GGGG..', '..SSGG..', 'S..SS..S', 'SSSBBSSS', '...BB...', '..BBBB..', '.SS..SS.']

function paintSprite(rows: Paint[][], sprite: string[], left: number, bottom: number) {
  const top = bottom - sprite.length / 2 + 1
  for (let r = 0; r < sprite.length; r += 2) {
    for (let c = 0; c < sprite[r]!.length; c++) {
      const hi = PIXEL[sprite[r]![c]!]
      const lo = PIXEL[sprite[r + 1]![c]!]
      const y = top + r / 2
      const x = left + c
      const cell = rows[y]?.[x]
      if (!cell || (!hi && !lo)) continue
      rows[y]![x] = hi ? { text: '▀', color: hi, backgroundColor: lo ?? cell.backgroundColor } : { text: '▄', color: lo, backgroundColor: cell.backgroundColor }
    }
  }
}

function paintLems(rows: Paint[][], world: World) {
  for (const l of world.lems) {
    const x = Math.round(l.x)
    const y = Math.round(l.y)
    // x is the column the lemming stands on.
    if (l.state === 'walk') paintSprite(rows, Math.floor(l.x) % 2 ? WALK_A : WALK_B, x - 2, y)
    else if (l.state === 'fall') paintSprite(rows, FLAIL, x - 3, y)
    else {
      const cell = rows[y]?.[x]
      if (cell) rows[y]![x] = { text: l.t % 2 ? '✺' : '✷', color: l.t < 4 ? '#ffd166' : '#ff4d6d', backgroundColor: cell.backgroundColor, bold: true }
      const above = rows[y - 1]?.[x]
      if (above && l.t < 5) rows[y - 1]![x] = { text: '*', color: '#ff8c42', backgroundColor: above.backgroundColor }
    }
  }
}

const runs = (cells: Paint[]) =>
  cells.reduce<Paint[]>((out, p) => {
    const last = out[out.length - 1]
    if (last && last.color === p.color && last.backgroundColor === p.backgroundColor && last.bold === p.bold) last.text += p.text
    else out.push({ ...p })
    return out
  }, [])

const Board: ClientModule<BoardProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const local = surface.state
  const board = () => geom(surface.columns, Math.max(4, surface.rows - CHROME_ROWS), fillOf(props))

  if (!local) {
    surface.setState({ world: newWorld((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0), used: props.used, window: props.window, queue: 0 })
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now || surface.columns <= 0) return
      const g = geom(surface.columns, Math.max(4, surface.rows - CHROME_ROWS), now.used === null || now.window <= 0 ? 0 : now.used / now.window)
      let world = step(now.world, g)
      let queue = now.queue
      const crowded = world.lems.length >= MAX_LEMS
      if (!crowded && queue > 0 && world.tick % RUSH_EVERY === 0) {
        world = spawn(world, g)
        queue--
      } else if (!crowded && world.tick % SPAWN_EVERY === 0) world = spawn(world, g)
      surface.setState({ ...now, world, queue })
    })
  } else if (local.used !== props.used || local.window !== props.window) {
    // The context grew: send one lemming per percent gained, a dozen at most.
    const gained = local.used === null || props.used === null ? 0 : ((props.used - local.used) / props.window) * 100
    surface.setState({ ...local, used: props.used, window: props.window, queue: Math.min(12, local.queue + Math.max(0, Math.round(gained))) })
  }

  if (!local || surface.columns <= 0) return <Text color={HAIR}>Lemmings incoming…</Text>

  const g = board()
  const compactRow = props.compactAt === null || props.window <= 0 ? null : g.height - 1 - Math.floor((props.compactAt / props.window) * (g.height - g.top))
  const rows = paintScene(g, compactRow)
  paintLems(rows, local.world)

  const pct = Math.round(fillOf(props) * 100)
  const stats = props.used === null ? 'measuring context…' : `${pct}% full · ${fmt(Math.max(0, props.window - props.used))} of ${fmt(props.window)} left · lost ${local.world.lost}`
  const doom = props.compactAt !== null && props.used !== null && props.used >= props.compactAt * 0.9
  const hint =
    pct >= 95 ? { text: 'Oh no! The pile has reached the top.', color: '#ff4d6d' }
    : doom ? { text: 'Oh no! Autocompact is near. /compact to clear the bodies.', color: local.world.tick % 10 < 5 ? '#ffd166' : '#a88a3d' }
    : { text: 'Each body is a little more context used.', color: '#5a5f8a' }

  return (
    <Box flexDirection="column">
      <Text bold color={HAIR}>{'L E M M I N G S'}</Text>
      <Text color="#c8ccf0">{stats}</Text>
      {rows.map(row => (
        <Text>
          {runs(row).map(p => (
            <Text color={p.color} backgroundColor={p.backgroundColor} bold={p.bold}>{p.text}</Text>
          ))}
        </Text>
      ))}
      <Text color={hint.color}>{hint.text}</Text>
    </Box>
  )
}

export default Board
