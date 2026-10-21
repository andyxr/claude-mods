import { test, expect } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'lemmings' } as const
const props = (columns: number, rows: number) =>
  ({ id: 'lemmings', title: 'Lemmings', isFocused: false, placement: 'dock', bodyColumns: columns, scroll: { offset: 0, bodyRows: rows }, view: {} })

test('the pane draws the cliff and releases lemmings', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount<typeof surface, 'Pane'>({ plugin: 'lemmings', surface, ...PANE, props: props(48, 26) } as never)
    await ui.resize({ columns: 48, rows: 26 })
    await ui.advance(80 * 31)
    expect(await ui.find({ type: 'Text', text: /L E M M I N G S/, in: 'board' })).toBeDefined()
    const halves = await ui.findAll({ type: 'Text', text: /[▀▄]/, in: 'board' })
    expect(halves.some(t => t.props.color === '#38fe51')).toBe(true)
    await ui.unmount()
  }
})

test('mobile gets a line of text', async $ => {
  const ui = await $.ui.mount<'mobile', 'Pane'>({ plugin: 'lemmings', surface: 'mobile', ...PANE, props: props(30, 20) } as never)
  expect(await ui.find({ type: 'Text', text: /Lemmings need/ })).toBeDefined()
  await ui.unmount()
})
