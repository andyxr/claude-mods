import type { Register } from 'claude-code'

const PANE = 'invaders'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'invade', description: 'Play Space Invaders in a side pane' })
    return next(e)
  })

  on('command.run', { command: 'invade' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Invaders', focus: true, closeOnEscape: true })
    if (!opened.isPlaced) return { text: 'Invaders: widen the terminal to see the pane.' }
    return { text: 'Invaders opened. Click the board, ←/→ move, Space fires. Esc or the close mark ends the game.' }
  })

  // The game lives entirely inside the Client instance: closing the pane unmounts it, dropping its state and timer.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>Invaders needs the terminal or desktop app.</Text>
    }
    // The pane body sizes to its content, so hand the Client the body's real size in cells.
    const { Client } = $.ui.resolve(e)
    return <Client key="board" module="./board.tsx" props={null} width={e.props.bodyColumns} height={e.props.scroll.bodyRows} />
  })
}
