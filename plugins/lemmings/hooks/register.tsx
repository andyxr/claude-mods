import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Context } from '../types'

const PANE = 'lemmings'
const context = atom({ plugin: 'lemmings', key: 'context' } as const, { used: null, window: 200_000, compactAt: null })

async function refresh($: EngineInterface) {
  const { context: c } = await $.session.usage({ breakdown: 'summary' })
  const b = c.breakdown
  const used = c.tokens ?? b?.totalTokens ?? null
  const buffer = b?.categories.find(cat => cat.kind === 'buffer')
  const compactAt = b && buffer ? b.rawMaxTokens - buffer.tokens : null
  await update($, context, (): Context => ({ used, window: c.window, compactAt }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lemmings', description: 'Watch lemmings fill the context window in a side pane' })
    const r = await next(e)
    await refresh($)
    return r
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await refresh($)
    return next(e)
  })

  on('command.run', { command: 'lemmings' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'Lemmings', closeOnEscape: true })
    if (!opened.isPlaced) return { text: 'Lemmings: widen the window to see the pane.' }
    return { text: 'Lemmings released. Oh no!' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const c = await read($, context)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      const pct = c.used === null ? '?' : `${Math.round((c.used / c.window) * 100)}%`
      return <Text>Lemmings need the terminal or desktop app. Context {pct} full.</Text>
    }
    // The pane body sizes to its content, so hand the Client the body's real size in cells.
    const { Client } = $.ui.resolve(e)
    return <Client key="board" module="./board.tsx" props={c} width={e.props.bodyColumns} height={e.props.scroll.bodyRows} />
  })
}
