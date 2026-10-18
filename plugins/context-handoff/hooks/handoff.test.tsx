import { test, expect } from 'claude-code/testing'
import { handoffPath, isDegrading, message, warnAt } from './degrade'

test('warns at 60% of small windows, 200k on large ones', () => {
  expect(warnAt(200_000)).toBe(120_000)
  expect(warnAt(1_000_000)).toBe(200_000)
  expect(isDegrading(undefined, 200_000)).toBe(false)
  expect(isDegrading(119_999, 200_000)).toBe(false)
  expect(isDegrading(120_000, 200_000)).toBe(true)
})

test('words the warning', () => {
  expect(message({ tokens: 210_000, window: 1_000_000 })).toBe(
    'Context at 210k tokens (21%). Answers may start to degrade. Start a fresh session with a hand-off?',
  )
})

test('names the hand-off file after the project', () => {
  expect(handoffPath('/Users/a', '/dev/sdss-quasar', Date.UTC(2026, 9, 7, 9, 5, 3))).toBe(
    '/Users/a/.claude/handoffs/sdss-quasar-2026-10-07T09-05-03-000Z.md',
  )
})

const measure = ($: any, tokens: number) =>
  $.session.measure({ context: { tokens, window: 200_000 }, rateLimits: [], changed: ['context'] })

test('band appears past the threshold and Ignore hides it until context drops', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  for (const surface of ['terminal', 'desktop'] as const) {
    await measure($, 50_000)
    let ui = await $.ui.mount({ plugin: 'context-handoff', surface, component: 'AbovePrompt', props: {} } as any)
    expect(await ui.find({ key: 'ignore' })).toBeUndefined()
    await ui.unmount()

    await measure($, 150_000)
    ui = await $.ui.mount({ plugin: 'context-handoff', surface, component: 'AbovePrompt', props: {} } as any)
    expect(await ui.find({ type: 'Text', text: /Context at 150k/ })).toBeDefined()
    expect(await ui.find({ key: 'handoff' })).toBeDefined()
    await ui.press({ key: 'ignore' })
    expect(await ui.find({ key: 'ignore' })).toBeUndefined()

    await measure($, 160_000)
    expect(await ui.find({ key: 'ignore' })).toBeUndefined()
    await ui.unmount()

    await measure($, 10_000)
    await measure($, 150_000)
    ui = await $.ui.mount({ plugin: 'context-handoff', surface, component: 'AbovePrompt', props: {} } as any)
    expect(await ui.find({ key: 'ignore' })).toBeDefined()
    await ui.press({ key: 'ignore' })
    await ui.unmount()
    await measure($, 10_000)
  }
})

test('hand-off writes the file, clears, and sends the prompt', async ($, on) => {
  const calls: string[] = []
  let written = ''
  let sent = ''
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('model.fork', () => ({ value: { isAnswered: true, text: '## Goal\nship it', usage: {} } }) as any)
  on('env.get', () => ({ value: '/Users/a' }))
  on('session.root', () => ({ value: '/dev/sdss-quasar' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 7, 9, 5, 3) }))
  // On Windows the engine resolves the path to D:\Users\a\..., so compare it in POSIX form.
  on('fs.write', ($, e: any) => { written = `${e.path.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/')}\n${e.text}`; return { value: undefined } as any })
  on('command.run', ($, e) => { calls.push(e.command); return {} as any })
  on('prompt.submit', ($, e) => { sent = e.text; return { text: e.text } as any })
  on('ui.toast', () => ({ value: undefined }) as any)

  await measure($, 150_000)
  const ui = await $.ui.mount({ plugin: 'context-handoff', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  await ui.press({ key: 'handoff' })
  const path = '/Users/a/.claude/handoffs/sdss-quasar-2026-10-07T09-05-03-000Z.md'
  expect(written).toBe(`${path}\n## Goal\nship it`)
  expect(calls).toEqual(['clear'])
  expect(sent).toBe(`Hand-off from my previous session (saved at ${path}):\n\n## Goal\nship it\n\nContinue from Next steps.`)
  expect(await ui.find({ key: 'handoff' })).toBeUndefined()
})

test('/handyoff shows the band on demand', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 30_000, window: 200_000 }, rateLimits: [] } }) as any)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  await $.command.run({ command: 'handyoff', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'context-handoff', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  expect(await ui.find({ type: 'Text', text: /Context at 30k/ })).toBeDefined()
  expect(await ui.find({ key: 'handoff' })).toBeDefined()
})

test('/handyoff band survives a measure below the threshold', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 30_000, window: 200_000 }, rateLimits: [] } }) as any)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  await $.command.run({ command: 'handyoff', args: '' } as any)
  await measure($, 31_000)
  const ui = await $.ui.mount({ plugin: 'context-handoff', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  expect(await ui.find({ key: 'handoff' })).toBeDefined()
  await ui.press({ key: 'ignore' })
  expect(await ui.find({ key: 'ignore' })).toBeUndefined()
})
