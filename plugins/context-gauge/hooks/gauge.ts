export type Gauge = {
  window: number
  used: number
  /** Fill at which autocompact fires; undefined when autocompact is off. */
  compactAt?: number
}

const WIDTH = 24

export const fmt = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

// █ used · ░ free before compaction · ▒ autocompact buffer
export const render = ({ window, used, compactAt }: Gauge) => {
  const cell = (n: number) => Math.max(0, Math.min(WIDTH, Math.round((n / window) * WIDTH)))
  const usedCells = cell(used)
  const limitCells = Math.max(usedCells, cell(compactAt ?? window))
  const bar = '█'.repeat(usedCells) + '░'.repeat(limitCells - usedCells) + '▒'.repeat(WIDTH - limitCells)
  const left = `${fmt(Math.max(0, window - used))} left`
  const toCompact =
    compactAt === undefined ? 'autocompact off' : `${fmt(Math.max(0, compactAt - used))} to compact`
  const pct = `${Math.round((used / window) * 100)}%`
  return `ctx ${pct} ${bar} ${left} · ${toCompact}`
}

const pad = (n: number) => `${n}`.padStart(2, '0')

export const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
