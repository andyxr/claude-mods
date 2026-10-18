import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Phase } from '../types'
import { HANDOFF_PROMPT, handoffPath, isDegrading, message, resumePrompt } from './degrade'

const warning = atom({ plugin: 'context-handoff', key: 'warning' } as const, null)
const phase = atom({ plugin: 'context-handoff', key: 'phase' } as const, 'warn')

// Ignored until context drops back under the threshold (after /clear or /compact).
let isIgnored = false
// Shown by /handyoff: stays up below the threshold until Ignore or a hand-off.
let isRequested = false

async function measure($: EngineInterface, tokens: number | undefined, window: number) {
  if (!isDegrading(tokens, window)) {
    isIgnored = false
    if (!isRequested) await update($, warning, () => null)
    return
  }
  if (isIgnored) return
  await update($, warning, () => ({ tokens: tokens!, window }))
}

async function handOff($: EngineInterface) {
  await update($, phase, (): Phase => 'writing')
  try {
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered) throw new Error(`hand-off not written: ${reply.reason}`)
    const home = await $.env.get('HOME')
    if (home === undefined) throw new Error('HOME is unset')
    const path = handoffPath(home, await $.session.root(), await $.clock.now())
    await $.fs.write(path, reply.text)
    await $.command.run({ command: 'clear', args: '' })
    isIgnored = false
    isRequested = false
    await update($, warning, () => null)
    await update($, phase, (): Phase => 'warn')
    $.ui.toast(`Hand-off saved to ${path}`)
    $.prompt.submit({ text: resumePrompt(path, reply.text), asUser: true }).catch(err => $.ui.toast(`Hand-off not sent: ${err}`))
  } catch (err) {
    await update($, phase, () => ({ error: err instanceof Error ? err.message : String(err) }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'handyoff', description: 'Offer a new session with a hand-off now' })
    const { context } = await $.session.usage()
    await measure($, context.tokens, context.window)
    return r
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await measure($, e.context.tokens, e.context.window)
    return next(e)
  })

  on('command.run', { command: 'handyoff' }, async $ => {
    const { context } = await $.session.usage()
    isIgnored = false
    isRequested = true
    await update($, phase, (): Phase => 'warn')
    await update($, warning, () => ({ tokens: context.tokens ?? 0, window: context.window }))
    return { text: 'Hand-off offer shown above the prompt.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const w = await read($, warning)
    if (e.props.hasSurvey || w === null) return next(e)
    const p = await read($, phase)
    const { Box, Button, Text } = $.ui.resolve(e)
    const ignore = async () => {
      isIgnored = true
      isRequested = false
      await update($, warning, () => null)
      await update($, phase, (): Phase => 'warn')
    }
    const band =
      p === 'writing' ? (
        <Text color="yellow">Writing hand-off, then starting a new session…</Text>
      ) : (
        <Box flexDirection="column">
          <Text color="yellow">{typeof p === 'object' ? `Hand-off failed: ${p.error}` : message(w)}</Text>
          <Box gap={1}>
            <Button key="handoff" label="New session with hand-off" hotkey="n" variant="primary" onPress={() => handOff($)} />
            <Button key="ignore" label="Ignore" hotkey="i" onPress={ignore} />
          </Box>
        </Box>
      )
    return (
      <Box flexDirection="column">
        {band}
        {await next(e)}
      </Box>
    )
  })
}
