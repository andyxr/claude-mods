import type { Warning } from '../types'

// Quality drops with absolute length, not just fill: cap the threshold so large windows warn too.
export const warnAt = (window: number) => Math.min(Math.round(window * 0.6), 200_000)

export const isDegrading = (tokens: number | undefined, window: number) =>
  tokens !== undefined && tokens >= warnAt(window)

const k = (n: number) => `${Math.round(n / 1000)}k`

export const message = ({ tokens, window }: Warning) =>
  `Context at ${k(tokens)} tokens (${Math.round((tokens / window) * 100)}%). Answers may start to degrade. Start a fresh session with a hand-off?`

export const HANDOFF_PROMPT = `Write a hand-off document so a fresh Claude Code session in this same project can continue this work with no access to this conversation. Use markdown with these sections:

## Goal
## Current state
## Key decisions and why
## Files touched or relevant (paths)
## Next steps
## Open questions / gotchas

Be specific and complete but concise. Output only the document, no preamble.`

export const handoffPath = (home: string, root: string, now: number) => {
  const project = root.split('/').filter(Boolean).at(-1) ?? 'project'
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  return `${home}/.claude/handoffs/${project}-${stamp}.md`
}

// Plugin-submitted prompts don't expand @file mentions, so the hand-off goes inline.
export const resumePrompt = (path: string, handoff: string) =>
  `Hand-off from my previous session (saved at ${path}):\n\n${handoff}\n\nContinue from Next steps.`
