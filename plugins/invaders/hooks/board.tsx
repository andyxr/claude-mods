import type { ClientModule } from 'claude-code'

import { fire, grid, move, newGame, step, togglePause } from './game'
import type { Cell, Game } from './game'

type Local = { game: Game | null; size: string; elapsed: number; anim: number; best: number }

const FRAME_MS = 20
const TICK_MS = 40
const ANIM_MS = 80

// Header (2 rows), border (2) and hint (1) take 5 of the body's rows; each cell is 2 columns × 1 row.
const CHROME_ROWS = 5
const MAX_W = 30
const MAX_H = 24

const fit = (columns: number, rows: number) =>
  newGame(
    Math.max(10, Math.min(MAX_W, Math.floor((columns - 2) / 2))),
    Math.max(10, Math.min(MAX_H, rows - CHROME_ROWS)),
    (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0,
  )

const SPRITES = [['▞▚', '▚▞'], ['▛▜', '▙▟'], ['▜▛', '▟▙']] as const
const COLORS = ['#ff5fd2', '#5fd7ff', '#7dff7a'] as const
const BG = '#07071a'

type Paint = { text: string; color?: string; backgroundColor?: string; bold?: boolean }

const hash = (x: number, y: number) => ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 997

function paintCell(game: Game, cell: Cell, x: number, y: number, anim: number): Paint {
  const bg = game.status === 'over' ? '#1c0610' : BG
  if (!cell) {
    const h = hash(x, y)
    if (h % 29 === 0) return { text: (anim + h) % 20 < 2 ? '✦ ' : '· ', color: '#4a4f8a', backgroundColor: bg }
    return { text: '  ', backgroundColor: bg }
  }
  switch (cell.kind) {
    case 'invader':
      return { text: SPRITES[cell.invader.kind][game.frame % 2]!, color: COLORS[cell.invader.kind], backgroundColor: bg, bold: true }
    case 'player':
      if (game.hurt > 0 && anim % 2) return { text: '  ', backgroundColor: bg }
      return { text: '▟▙', color: '#e8ff6b', backgroundColor: bg, bold: true }
    case 'shot':
      return { text: '▕▏', color: '#ffffff', backgroundColor: bg, bold: true }
    case 'bomb':
      return { text: anim % 2 ? '⡇⢸' : '⢸⡇', color: '#ff6b4a', backgroundColor: bg, bold: true }
    case 'boom':
      return { text: anim % 2 ? '✺✺' : '✷✷', color: anim % 2 ? '#ffd166' : '#ff8c42', backgroundColor: bg, bold: true }
  }
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
    surface.setState({ game: null, size: '', elapsed: 0, anim: 0, best: 0 })
    surface.every(ANIM_MS, () => {
      const now = surface.state
      if (now) surface.setState({ ...now, anim: now.anim + 1 })
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
      if (now.elapsed < TICK_MS) return
      const game = step(now.game)
      surface.setState({ ...now, game, elapsed: 0, best: Math.max(now.best, game.score) })
    })
    surface.onKey(key => {
      const now = surface.state
      if (!now?.game) return
      const name = key.key.toLowerCase()
      const set = (game: Game) => surface.setState({ ...now, game })
      if (name === 'left' || name === 'a' || name === 'h') set(move(now.game, -1))
      else if (name === 'right' || name === 'd' || name === 'l') set(move(now.game, 1))
      else if (name === ' ' || name === 'space' || name === 'up' || name === 'w' || name === 'k') set(fire(now.game))
      else if (name === 'p') set(togglePause(now.game))
      else if (name === 'r') surface.setState({ ...now, game: fit(surface.columns, surface.rows), size: `${surface.columns}x${surface.rows}`, elapsed: 0 })
    })
  }

  const game = local?.game
  if (!local || !game) return <Text color="#5fd7ff">Incoming…</Text>
  const { anim, best } = local

  const hint = {
    ready: { text: '▶ Click here, then ←/→ to move, Space to fire', color: anim % 8 < 4 ? '#e8ff6b' : '#8a9a3d' },
    running: { text: '←/→ move · Space fire · P pause · R restart', color: '#7f86c9' },
    paused: { text: '❚❚ Paused · P to resume', color: anim % 10 < 5 ? '#ffd166' : '#a88a3d' },
    over: { text: `✖ Game over · score ${game.score} · R to play again`, color: anim % 6 < 3 ? '#ff4d6d' : '#ff9eb0' },
  }[game.status]

  return (
    <Box flexDirection="column">
      <Text bold color="#7dff7a">{'▚▞ S P A C E   I N V A D E R S ▚▞'}</Text>
      <Text bold color="#f8f8ff">{`Score ${game.score} · Best ${best} · Wave ${game.wave} · ${'♥'.repeat(Math.max(0, game.lives))}`}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor={game.status === 'over' ? '#ff2244' : game.hurt > 0 ? '#ff6b4a' : '#3a3f7a'}>
        {grid(game).map((row, y) => (
          <Text>
            {runs(row.map((cell, x) => paintCell(game, cell, x, y, anim))).map(p => (
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
