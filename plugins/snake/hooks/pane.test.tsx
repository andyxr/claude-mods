import { test, expect } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'snake' } as const
const props = (columns: number, rows: number) =>
  ({ id: 'snake', title: 'Snake', isFocused: true, placement: 'dock', bodyColumns: columns, scroll: { offset: 0, bodyRows: rows }, view: {} })

test('the pane runs a game driven by keys, and ends with it', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'snake', surface, ...PANE, props: props(40, 20) } as never)
    await ui.resize({ columns: 40, rows: 20 })
    await ui.advance(30)
    expect(await ui.find({ type: 'Text', text: /Score 0 · Length 3 · Best 0/, in: 'board' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /press an arrow key/, in: 'board' })).toBeDefined()

    await ui.key({ key: 'up' })
    expect(await ui.find({ type: 'Text', text: /Space pause/, in: 'board' })).toBeDefined()
    await ui.key({ key: ' ' })
    expect(await ui.find({ type: 'Text', text: /Paused/, in: 'board' })).toBeDefined()
    await ui.key({ key: ' ' })

    await ui.advance(150 * 20)
    expect(await ui.find({ type: 'Text', text: /Game over/, in: 'board' })).toBeDefined()
    await ui.key({ key: 'r' })
    expect(await ui.find({ type: 'Text', text: /press an arrow key/, in: 'board' })).toBeDefined()
    await ui.unmount()
  }
})

test('the game area takes half the pane body, and refits on resize before play', async $ => {
  const boardRows = async () => (await ui.findAll({ type: 'Box', in: 'board' })).find(b => 'borderStyle' in b.props)?.children.length
  // The pane's window is taller than its content; the board must size from bodyRows, not from what it last drew.
  const ui = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...PANE, props: props(60, 40) } as never)
  expect((await ui.find({ type: 'Client' }))?.props).toMatchObject({ width: 60, height: 40 })
  await ui.resize({ columns: 60, rows: 40 })
  await ui.advance(90)
  expect(await boardRows()).toBe(18)
  await ui.redraw(props(60, 60) as never)
  expect((await ui.find({ type: 'Client' }))?.props).toMatchObject({ width: 60, height: 60 })
  await ui.resize({ columns: 60, rows: 60 })
  await ui.advance(90)
  expect(await boardRows()).toBe(28)
  await ui.unmount()
})
