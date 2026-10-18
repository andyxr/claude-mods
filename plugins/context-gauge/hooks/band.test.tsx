import { test, expect } from 'claude-code/testing'

test('timer band leaves room for other plugins below it', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 30_000, window: 200_000 }, rateLimits: [] } }) as any)
  on('clock.now', () => ({ value: 65_000 }))
  on('clock.every', () => ({ value: undefined }) as any)
  on('ui.status', () => ({ value: undefined }) as any)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box key="below" /> })
  on('session.start', () => ({ cwd: '/p' }) as any)
  await $.session.start({ cwd: '/p' } as any)
  const ui = await $.ui.mount({ plugin: 'context-gauge', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  expect(await ui.find({ type: 'Text' })).toBeDefined()
  expect(await ui.find({ key: 'below' })).toBeDefined()
})
