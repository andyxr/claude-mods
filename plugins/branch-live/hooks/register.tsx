import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RepoEvent, Snapshot } from '../types'
import { diffRefs, git, parseStatus, readCommits, readRefs } from './git'
import type { Run } from './git'
import { height, paint } from './graph'
import { GOOD, fileGroups, hex } from './model'
import { CELL_H, CELL_W, describe, describeStatus, graph, status } from './svg'

const PANE = 'branch-live'
const TITLE = 'Branch'
/** The second tab: the uncommitted files. */
const CHANGES = 'branch-live-changes'
const POLL_MS = 1500
const LIMIT = 300
/** A Raster holds at most this many rows. */
const RASTER_ROWS = 256

const EMPTY: Snapshot = {
  error: null,
  root: null,
  head: { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, files: [], changed: 0 },
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
/** The Uncommitted tab's label as last opened. */
let changesShown = ''

/** The tab's label is plain text, so a dot is what flags uncommitted work. */
const changesTitle = (n: number) => (n ? '● Uncommitted' : 'Uncommitted')

async function poll($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    // A /clear starts a new session whose state is EMPTY again, while these module variables live on: start over with it.
    const held = await read($, snap)
    if (held.root === null && held.error === null) {
      refs = null
      fingerprint = ''
    }
    const run: Run = argv => $.process.run(argv, { timeoutMs: 15000 })
    const st = await run(['git', '-c', 'core.quotepath=false', 'status', '--porcelain=v2', '--branch'])
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
    let follow = false
    await update($, snap, s => {
      const firstLoad = before === null || s.root !== root
      follow = firstLoad || s.head.oid !== head.oid || s.head.branch !== head.branch
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
    if (follow) await toEnd($)
  } catch (err) {
    await update($, snap, s => ({ ...s, error: String((err as Error)?.message ?? err) }))
  } finally {
    await retitle($).catch(() => undefined)
    busy = false
  }
}

/** Renames the Uncommitted tab when the tree goes dirty or clean. A reopen raises the tab, so Branch, if it was up, opens again after. */
async function retitle($: EngineInterface) {
  const title = changesTitle((await read($, snap)).head.changed)
  if (title === changesShown) return
  const panes = await $.ui.panes()
  if (!panes.some(p => p.id === CHANGES)) return
  changesShown = title
  const branchUp = panes.some(p => p.id === PANE && p.isShown)
  await $.ui.open({ id: CHANGES, title })
  if (branchUp) await $.ui.open({ id: PANE, title: TITLE })
}

/** Scrolls the pane to HEAD and the status bar: history runs upwards from there. */
const toEnd = ($: EngineInterface) => $.ui.scroll({ in: PANE, to: 'end' }).catch(() => undefined)

/** Both tabs, Branch first and shown: Branch opens again last to bring it to the front. */
async function openPanes($: EngineInterface) {
  changesShown = changesTitle((await read($, snap)).head.changed)
  await $.ui.open({ id: PANE, title: TITLE })
  await $.ui.open({ id: CHANGES, title: changesShown })
  await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'branch-live', description: 'Show a live graph of the current branch and commit' })
    void openPanes($)
    void poll($)
    $.clock.every(POLL_MS, () => poll($))
    // Drive the arrival glow and ticker fade while something is fading.
    $.clock.every(250, () => (Date.now() < glowUntil ? update($, now, () => Date.now()) : undefined))
    return next(e)
  })

  on('command.run', { command: 'branch-live' }, async $ => {
    await openPanes($)
    void poll($)
    await toEnd($)
    return { text: 'Branch panes opened.' }
  })

  // The two tabs are one pane to the person: closing either closes both. Only their close, so ours does not echo.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    const other = e.id === PANE ? CHANGES : e.id === CHANGES ? PANE : null
    if (other && e.origin.kind === 'person') void $.ui.close({ id: other })
    return closed
  })

  // A git command the agent ran shows up at once, not on the next tick.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void poll($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, snap)
    if (e.surface === 'terminal') {
      // Only the cells need the tick: the SVG runs its own glow and fade.
      await read($, now)
      const { Box, Raster } = $.ui.resolve(e)
      const w = Math.max(10, Math.min(512, e.props.bodyColumns))
      // The whole history is painted and the pane scrolls over it, stacked in Rasters as one holds at most RASTER_ROWS.
      const rows = height(s, Math.max(6, e.props.scroll.bodyRows))
      const cv = paint(s, w, rows, Date.now())
      const pieces = []
      for (let y = 0; y < rows; y += RASTER_ROWS) {
        const end = Math.min(rows, y + RASTER_ROWS)
        pieces.push(<Raster key={`graph-${y}`} columns={w} rows={end - y} cells={cv.encode(y, end)} />)
      }
      return <Box flexDirection="column">{pieces}</Box>
    }
    const { Box, Svg } = $.ui.resolve(e)
    // Short of the columns' width: the estimate runs over the room the frame gets, and the excess is clipped off the right.
    const width = Math.max(240, e.props.bodyColumns * CELL_W - 16)
    const t = Date.now()
    const foot = status(s, width, t)
    const pieces = graph(s, width, Math.max(0, e.props.scroll.bodyRows * CELL_H - foot.height), t)
    // An interactive Svg is drawn in a frame that does not size itself from the markup: without both, it is 300 by 150.
    // The desktop drops an Svg whose alt is blank, so each piece says what it is.
    return (
      <Box flexDirection="column">
        {pieces.map((p, i) => (
          <Svg source={p.svg} alt={i === 0 ? describe(s) : `Git graph, part ${i + 1} of ${pieces.length}`} width={width} height={p.height} isInteractive />
        ))}
        <Svg source={foot.svg} alt={describeStatus(s)} width={width} height={foot.height} isInteractive />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CHANGES }, async ($, e) => {
    const s = await read($, snap)
    const { Box, Text } = $.ui.resolve(e)
    const groups = fileGroups(s.head)
    if (!groups.length) return <Text color={hex(GOOD)}>✓ working tree clean</Text>
    const more = s.head.changed - s.head.files.length
    return (
      <Box flexDirection="column">
        {groups.map(g => (
          <Box key={g.title} flexDirection="column" marginBottom={1}>
            <Text color={hex(g.color)} weight="bold">{`${g.title} (${g.rows.length})`}</Text>
            {g.rows.map(r => (
              <Text key={r.mark + r.path}>
                <Text color={hex(g.color)}>{` ${r.mark} `}</Text>
                {r.path}
                <Text dimColor>{r.note ? `  ${r.note}` : ''}</Text>
              </Text>
            ))}
          </Box>
        ))}
        {more > 0 && <Text dimColor>{`…and ${more} more`}</Text>}
      </Box>
    )
  })
}
