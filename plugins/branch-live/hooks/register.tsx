import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RepoEvent, Snapshot } from '../types'
import { diffRefs, git, parseStatus, readCommits, readRefs } from './git'
import type { Run } from './git'
import { paint } from './graph'

const PANE = 'branch-live'
const TITLE = 'Branch'
const POLL_MS = 1500
const LIMIT = 300

const EMPTY: Snapshot = {
  error: null,
  root: null,
  head: { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  commits: [],
  fresh: {},
  events: [],
}
const snap = atom({ plugin: 'branch-live', key: 'snap' } as const, EMPTY)
const now = atom({ plugin: 'branch-live', key: 'now' } as const, 0)

// What the last poll saw. A reload starts over and the first poll repaints everything.
let refs: Map<string, string> | null = null
let fingerprint = ''
let busy = false
let glowUntil = 0

async function poll($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    const run: Run = argv => $.process.run(argv, { timeoutMs: 15000 })
    const st = await run(['git', 'status', '--porcelain=v2', '--branch'])
    if (st.exitCode !== 0) {
      if (fingerprint !== 'none') {
        fingerprint = 'none'
        await update($, snap, s => ({ ...s, error: 'Not a git repository: no branches to show.', commits: [] }))
      }
      return
    }
    const head = parseStatus(st.stdout)
    const nextRefs = await readRefs(run)
    const fp = [head.oid, head.branch, ...[...nextRefs].map(([r, h]) => r + h)].join('\n')
    const t = Date.now()
    if (fp === fingerprint) {
      await update($, snap, s => (JSON.stringify(s.head) === JSON.stringify(head) ? s : { ...s, head }))
      return
    }
    fingerprint = fp
    const commits = head.oid ? await readCommits(run, LIMIT, nextRefs) : []
    const root = (await git(run, ['rev-parse', '--show-toplevel']).catch(() => '')).trim() || null
    const before = refs
    refs = nextRefs
    await update($, snap, s => {
      const firstLoad = before === null || s.root !== root
      const fresh: Record<string, number> = {}
      const known = new Set(s.commits.map(c => c.hash))
      for (const c of commits) {
        const was = s.fresh[c.hash]
        if (was && t - was < 10000) fresh[c.hash] = was
        else if (!firstLoad && !known.has(c.hash)) fresh[c.hash] = t
      }
      let events: RepoEvent[] = firstLoad ? [] : s.events
      if (!firstLoad && before) {
        const byHash = new Map(commits.map(c => [c.hash, c]))
        const added = diffRefs(before, nextRefs, byHash, t)
        if (s.head.branch !== head.branch) added.unshift({ kind: 'switch', text: `switched to ${head.branch ?? 'detached ' + (head.oid ?? '').slice(0, 7)}`, at: t })
        events = [...events, ...added].slice(-20)
        if (added.length || Object.keys(fresh).length) glowUntil = t + 21000
      }
      return { error: null, root, head, commits, fresh, events }
    })
  } catch (err) {
    await update($, snap, s => ({ ...s, error: String((err as Error)?.message ?? err) }))
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'branch-live', description: 'Show a live graph of the current branch and commit' })
    void $.ui.open({ id: PANE, title: TITLE })
    void poll($)
    $.clock.every(POLL_MS, () => poll($))
    // Drive the arrival glow and ticker fade while something is fading.
    $.clock.every(250, () => (Date.now() < glowUntil ? update($, now, () => Date.now()) : undefined))
    return next(e)
  })

  on('command.run', { command: 'branch-live' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void poll($)
    return { text: 'Branch pane opened.' }
  })

  // A git command the agent ran shows up at once, not on the next tick.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void poll($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, snap)
    await read($, now)
    const t = Date.now()
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const w = Math.max(10, Math.min(512, e.props.bodyColumns))
      const rows = Math.max(6, Math.min(256, e.props.scroll.bodyRows))
      return <Raster key="graph" columns={w} rows={rows} cells={paint(s, w, rows, t).encode()} />
    }
    const { Box, Text } = $.ui.resolve(e)
    const rows = s.commits.slice(0, 40).reverse()
    return (
      <Box flexDirection="column">
        {rows.map(c => (
          <Text dimColor={c.hash !== s.head.oid}>
            {c.hash === s.head.oid ? '◉' : '●'} {c.hash.slice(0, 7)} {c.refs.length ? `(${c.refs.join(', ')}) ` : ''}{c.subject}
          </Text>
        ))}
        <Text bold>⎇ {s.head.branch ?? 'detached'} · {s.head.oid?.slice(0, 7) ?? 'no commits'}</Text>
      </Box>
    )
  })
}
