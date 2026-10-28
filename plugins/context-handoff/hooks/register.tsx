import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Phase } from '../types'
import { HANDOFF_PROMPT, HANDOFF_RETRY, handoffPath, isDegrading, message, resumePrompt } from './degrade'

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

const isDocument = (text: string) => text.includes('## ')

async function draft($: EngineInterface) {
  const first = await $.model.fork({ prompt: HANDOFF_PROMPT })
  if (first.isAnswered && isDocument(first.text)) return first.text
  // A fork needs the main thread's last request. A new session has none until a reply finishes.
  if (!first.isAnswered && first.reason === 'nothing-to-fork') {
    throw new Error('Nothing to hand off yet. Wait until a reply in this session has finished.')
  }
  // empty-reply is a tool call with no text. An API error will not improve on a retry.
  if (!first.isAnswered && first.reason !== 'empty-reply') throw new Error(`hand-off not written: ${first.reason}`)
  const second = await $.model.fork({ prompt: HANDOFF_RETRY })
  if (!second.isAnswered) throw new Error(`hand-off not written: ${second.reason}`)
  return second.text
}

async function handOff($: EngineInterface) {
  await update($, phase, (): Phase => 'writing')
  try {
    const text = await draft($)
    // Native Windows usually has no HOME, only USERPROFILE.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home === undefined) throw new Error('HOME and USERPROFILE are unset')
    const path = handoffPath(home, await $.session.root(), await $.clock.now())
    await $.fs.write(path, text)
    await $.command.run({ command: 'clear', args: '' })
    isIgnored = false
    isRequested = false
    await update($, warning, () => null)
    await update($, phase, (): Phase => 'warn')
    $.ui.toast(`Hand-off saved to ${path}`)
    $.prompt.submit({ text: resumePrompt(path, text), asUser: true }).catch(err => $.ui.toast(`Hand-off not sent: ${err}`))
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
