import type { Register } from 'claude-code'

const PANE = 'snake'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'snake', description: 'Play Snake in a side pane' })
    return next(e)
  })

  on('command.run', { command: 'snake' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Snake', focus: true, closeOnEscape: true })
    if (!opened.isPlaced) return { text: 'Snake: widen the terminal to see the pane.' }
    return { text: 'Snake opened. Click the board, then use the arrow keys. Esc or the close mark ends the game.' }
  })

  // The game lives entirely inside the Client instance: closing the pane unmounts it, dropping its state and timer.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>Snake needs the terminal or desktop app.</Text>
    }
    // The pane body is a scroll window whose tree sizes to its content, so a percentage height resolves
    // to whatever the board last drew. Hand the Client the body's real size in cells instead.
    const { Client } = $.ui.resolve(e)
    return <Client key="board" module="./board.tsx" props={null} width={e.props.bodyColumns} height={e.props.scroll.bodyRows} />
  })
}
