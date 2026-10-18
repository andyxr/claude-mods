import { test, expect } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'invaders' } as const
const props = (columns: number, rows: number) =>
  ({ id: 'invaders', title: 'Invaders', isFocused: true, placement: 'dock', bodyColumns: columns, scroll: { offset: 0, bodyRows: rows }, view: {} })

test('the pane runs a game driven by keys', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount<typeof surface, 'Pane'>({ plugin: 'invaders', surface, ...PANE, props: props(50, 26) } as never)
    await ui.resize({ columns: 50, rows: 26 })
    await ui.advance(40)
    expect(await ui.find({ type: 'Text', text: /Score 0 · Best 0 · Wave 1 · ♥♥♥/, in: 'board' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Space to fire/, in: 'board' })).toBeDefined()

    await ui.key({ key: ' ' })
    expect(await ui.find({ type: 'Text', text: /P pause/, in: 'board' })).toBeDefined()
    await ui.key({ key: 'p' })
    expect(await ui.find({ type: 'Text', text: /Paused/, in: 'board' })).toBeDefined()
    await ui.key({ key: 'p' })

    // The shot flies straight up the centre column into the formation.
    await ui.advance(40 * 30)
    expect(await ui.find({ type: 'Text', text: /Score [1-9]\d* /, in: 'board' })).toBeDefined()

    await ui.key({ key: 'r' })
    expect(await ui.find({ type: 'Text', text: /Space to fire/, in: 'board' })).toBeDefined()
    await ui.unmount()
  }
})

test('the terminal names the space bar "space"; it fires too', async $ => {
  const ui = await $.ui.mount<'terminal', 'Pane'>({ plugin: 'invaders', surface: 'terminal', ...PANE, props: props(50, 26) } as never)
  await ui.resize({ columns: 50, rows: 26 })
  await ui.advance(40)
  await ui.key({ key: 'space' })
  await ui.advance(40 * 30)
  expect(await ui.find({ type: 'Text', text: /Score [1-9]\d* /, in: 'board' })).toBeDefined()
  await ui.unmount()
})
