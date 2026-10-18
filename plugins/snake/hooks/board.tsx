import type { ClientModule } from 'claude-code'

import { grid, newGame, speedMs, step, togglePause, turn } from './game'
import type { Dir, Game, Point } from './game'

type Burst = Point & { born: number; hue: number }
type Local = { game: Game | null; size: string; elapsed: number; anim: number; best: number; bursts: Burst[] }

const FRAME_MS = 30
const ANIM_MS = 60
const BURST_LIFE = 7

const KEYS: Record<string, Dir> = {
  up: 'up', down: 'down', left: 'left', right: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  k: 'up', j: 'down', h: 'left', l: 'right',
}

const FRUIT_HUES = [350, 30, 55, 120, 190, 275, 310]
const EYES: Record<Dir, string> = { up: '▀▀', down: '▄▄', left: '▌ ', right: ' ▐' }
const SPARKS = ['✦ ', '✧ ', '* ', '· ']

const hsl = (h: number, s: number, l: number) => {
  h = ((h % 360) + 360) % 360
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0')
  return `#${f(0)}${f(8)}${f(4)}`
}

const hash = (x: number, y: number) => ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 997

const fruitHue = (game: Game) => FRUIT_HUES[game.score % FRUIT_HUES.length]!

// The bordered game area takes half the pane's height; its two border rows count toward that half. Each cell is 2 columns × 1 row.
const BORDER_ROWS = 2

const fit = (columns: number, rows: number) =>
  newGame(Math.max(6, Math.floor((columns - 2) / 2)), Math.max(6, Math.floor(rows / 2) - BORDER_ROWS), (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0)

type Paint = { text: string; color?: string; backgroundColor?: string; bold?: boolean }

function paintCell(game: Game, cell: number | 'food' | null, x: number, y: number, anim: number, bursts: Burst[]): Paint {
  const over = game.status === 'over'
  // Striped by row, not checkered, so empty cells merge into runs and the tree stays under the size limit.
  const checker = y % 2 === 0
  let bg = over
    ? (checker ? '#2a0b16' : '#22081a')
    : (checker ? '#12122b' : '#191936')

  if (cell === 0) {
    if (over) return { text: '✕✕', color: '#ffffff', backgroundColor: anim % 2 ? '#ff2244' : '#aa0022', bold: true }
    return { text: EYES[game.queued[0] ?? game.dir], color: '#0b0b1a', backgroundColor: hsl(-anim * 9, 100, 72), bold: true }
  }
  if (typeof cell === 'number') {
    const hue = cell * 14 - anim * 9
    return {
      text: cell % 3 === 0 ? '░░' : '  ',
      color: hsl(hue + 40, 100, 80),
      backgroundColor: over ? hsl(0, 20, 25 + (cell % 2) * 4) : hsl(hue, 95, Math.max(38, 62 - cell * 0.8)),
    }
  }
  const hue = fruitHue(game)
  if (cell === 'food') {
    const pulse = Math.sin(anim / 2) * 12
    return { text: '◖◗', color: hsl(hue, 100, 62 + pulse), backgroundColor: hsl(hue, 70, 18 + pulse / 3), bold: true }
  }

  for (const b of bursts) {
    const age = anim - b.born
    const d = Math.abs(b.x - x) + Math.abs(b.y - y)
    if (d > 0 && (d === age || d === age - 1)) {
      return { text: SPARKS[Math.min(SPARKS.length - 1, Math.floor(age / 2))]!, color: hsl(b.hue + d * 30, 100, 75 - age * 4), backgroundColor: bg, bold: true }
    }
  }

  if (!over && Math.abs(game.food.x - x) + Math.abs(game.food.y - y) === 1) bg = hsl(hue, 45, 14 + Math.sin(anim / 2) * 4)

  const h = hash(x, y)
  if (h % 23 === 0) {
    if ((anim + h) % 16 < 3) return { text: '✧ ', color: hsl(200 + (h % 120), 80, 85), backgroundColor: bg }
    return { text: '· ', color: hsl(230 + (h % 60), 50, 45), backgroundColor: bg }
  }
  return { text: '  ', backgroundColor: bg }
}

const runs = (cells: Paint[]) =>
  cells.reduce<Paint[]>((out, p) => {
    const last = out[out.length - 1]
    if (last && last.color === p.color && last.backgroundColor === p.backgroundColor && last.bold === p.bold) last.text += p.text
    else out.push({ ...p })
    return out
  }, [])

const Board: ClientModule<null, Local> = (_props, surface) => {
  const { Box, Text } = surface.elements
  const local = surface.state

  if (!local) {
    surface.setState({ game: null, size: '', elapsed: 0, anim: 0, best: 0, bursts: [] })
    surface.every(ANIM_MS, () => {
      const now = surface.state
      if (!now) return
      const anim = now.anim + 1
      surface.setState({ ...now, anim, bursts: now.bursts.filter(b => anim - b.born < BURST_LIFE) })
    })
    surface.every(FRAME_MS, () => {
      const now = surface.state
      if (!now) return
      const size = `${surface.columns}x${surface.rows}`
      if (!now.game || (now.game.status === 'ready' && size !== now.size)) {
        if (surface.columns > 0) surface.setState({ ...now, game: fit(surface.columns, surface.rows), size, elapsed: 0 })
        return
      }
      if (now.game.status !== 'running') return
      now.elapsed += FRAME_MS
      if (now.elapsed < speedMs(now.game.score)) return
      const game = step(now.game)
      const ate = game.score > now.game.score
      surface.setState({
        ...now,
        game,
        elapsed: 0,
        best: Math.max(now.best, game.score),
        bursts: ate ? [...now.bursts, { ...game.snake[0], born: now.anim, hue: fruitHue(now.game) }] : now.bursts,
      })
    })
    surface.onKey(key => {
      const now = surface.state
      if (!now?.game) return
      const name = key.key.toLowerCase()
      const dir = KEYS[name]
      if (dir) surface.setState({ ...now, game: turn(now.game, dir) })
      else if (name === ' ' || name === 'p') surface.setState({ ...now, game: togglePause(now.game) })
      else if (name === 'r') surface.setState({ ...now, game: fit(surface.columns, surface.rows), size: `${surface.columns}x${surface.rows}`, elapsed: 0, bursts: [] })
    })
  }

  const game = local?.game
  if (!local || !game) return <Text color="#c792ea">Hatching…</Text>
  const { anim, bursts, best } = local

  const hint = {
    ready: { text: '▶ Click here, then press an arrow key (or WASD) to start', color: hsl(anim * 6, 90, 70) },
    running: { text: 'Arrows/WASD move · Space pause · R restart', color: '#7f86c9' },
    paused: { text: '❚❚ Paused · Space to resume', color: anim % 10 < 5 ? '#ffd166' : '#a88a3d' },
    over: { text: `✖ Game over · score ${game.score} · R to play again`, color: anim % 6 < 3 ? '#ff4d6d' : '#ff9eb0' },
  }[game.status]

  return (
    <Box flexDirection="column">
      <Text bold>
        {[...'▓▒░ S N A K E ░▒▓'].map((ch, i) => <Text color={hsl(i * 22 - anim * 12, 100, 65)}>{ch}</Text>)}
      </Text>
      <Text bold color="#f8f8ff">{`★ Score ${game.score} · Length ${game.snake.length} · Best ${best}`}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor={game.status === 'over' ? '#ff2244' : hsl(anim * 5, 90, 60)}>
        {grid(game).map((row, y) => (
          <Text>
            {runs(row.map((cell, x) => paintCell(game, cell, x, y, anim, bursts))).map(p => (
              <Text color={p.color} backgroundColor={p.backgroundColor} bold={p.bold}>{p.text}</Text>
            ))}
          </Text>
        ))}
      </Box>
      <Text color={hint.color}>{hint.text}</Text>
    </Box>
  )
}

export default Board
