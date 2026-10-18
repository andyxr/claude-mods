import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { render, hms } from './gauge'

const elapsed = atom({ plugin: 'context-gauge', key: 'elapsed' } as const, null)

let startedAt: number | undefined

async function tick($: EngineInterface) {
  if (startedAt === undefined) return
  const text = hms((await $.clock.now()) - startedAt)
  await update($, elapsed, () => text)
}

async function refresh($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  startedAt = usage.startedAt
  const { context } = usage
  const b = context.breakdown
  const used = context.tokens ?? b?.totalTokens
  const buffer = b?.categories.find(c => c.kind === 'buffer')
  const compactAt = b && buffer ? b.rawMaxTokens - buffer.tokens : undefined
  $.ui.status(used === undefined ? undefined : render({ window: context.window, used, compactAt }))
  await tick($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    $.clock.every(1000, () => tick($))
    return r
  })
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await refresh($)
    return next(e)
  })
  // status line is plain text, so the styled timer lives in the band above the prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, elapsed)
    if (e.props.hasSurvey || text === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // one band for every plugin: draw the timer, then let the rest of the chain draw below it
    return (
      <Box flexDirection="column">
        <Box justifyContent="flex-end">
          <Text color="white" backgroundColor="black">
            {` ${text} `}
          </Text>
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
