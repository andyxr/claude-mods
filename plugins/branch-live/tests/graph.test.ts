import { expect, test } from 'claude-code/testing'

import type { GraphCommit, Snapshot } from '../types'
import { diffRefs, mergedBranchName, parseStatus } from '../hooks/git'
import { layout } from '../hooks/model'
import { MAX_SVG, graph, status } from '../hooks/svg'
import { paint } from '../hooks/graph'

const c = (hash: string, parents: string[], refs: string[] = [], subject = hash): GraphCommit => ({ hash, parents, author: 'a', time: 0, subject, refs })

// Newest first, as git log --topo-order lists them: m merges feature (f2, f1) into main (b, a).
const commits = [
  c('m', ['b', 'f2'], ['heads/main'], "Merge branch 'feature'"),
  c('f2', ['f1']),
  c('f1', ['a']),
  c('b', ['a']),
  c('a', []),
]

test('pins HEAD to lane 0 and gives the merged branch its own lane', () => {
  const lay = layout(commits, 'm')
  const lane = (h: string) => lay.nodes[lay.rowOf.get(h)!]!.lane
  expect(lane('m')).toBe(0)
  expect(lane('b')).toBe(0)
  expect(lane('a')).toBe(0)
  expect(lane('f2')).toBe(1)
  expect(lane('f1')).toBe(1)
})

test('paints HEAD on the bottom graph row and the branch in the footer', () => {
  const snap: Snapshot = {
    error: null,
    root: '/r',
    head: { branch: 'main', oid: 'm', upstream: null, ahead: 0, behind: 0, staged: 1, unstaged: 0, untracked: 0, conflicted: 0 },
    commits,
    fresh: {},
    events: [{ kind: 'commit', text: 'main: hello', at: 0 }],
  }
  const cv = paint(snap, 60, 20, 1000)
  const row = (y: number) => String.fromCodePoint(...cv.cp.slice(y * 60, (y + 1) * 60))
  expect(row(18)).toContain('⎇ main')
  expect(row(19)).toContain('1 staged')
  expect(row(16)).toContain('main: hello')
  expect(row(14)).toContain('◉')
  expect(row(14)).toContain('HEAD')
  expect(cv.encode().length).toBe(Math.ceil((60 * 20 * 12) / 3) * 4)
})

test('reads porcelain v2 status', () => {
  const w = parseStatus('# branch.oid abc\n# branch.head dev\n# branch.upstream origin/dev\n# branch.ab +2 -1\n1 M. N... x\n1 .M N... y\n? z\n')
  expect(w).toEqual({ branch: 'dev', oid: 'abc', upstream: 'origin/dev', ahead: 2, behind: 1, staged: 1, unstaged: 1, untracked: 1, conflicted: 0 })
})

test('names ref changes', () => {
  const byHash = new Map([['n', { parents: ['o'], subject: 'fix' }]])
  const ev = diffRefs(new Map([['heads/main', 'o'], ['heads/old', 'x']]), new Map([['heads/main', 'n'], ['heads/new', 'n']]), byHash, 5)
  expect(ev.map(e => e.text)).toEqual(['main: fix', 'branch new created', 'old deleted'])
  expect(mergedBranchName('Merge pull request #3 from me/feat/x')).toBe('feat/x')
})

const repo: Snapshot = {
  error: null,
  root: '/r',
  head: { branch: 'main', oid: 'm', upstream: 'origin/main', ahead: 2, behind: 0, staged: 1, unstaged: 0, untracked: 0, conflicted: 0 },
  commits: [{ ...commits[0]!, refs: ['heads/main', 'remotes/origin/main', 'tags/v1'] }, ...commits.slice(1, 4), { ...commits[4]!, subject: 'fix <a & b>' }],
  fresh: { f2: 900 },
  events: [{ kind: 'commit', text: 'main: hello', at: 0 }],
}

test('draws the same content as SVG, escaped', () => {
  const doc = [...graph(repo, 480, 0, 1000), status(repo, 480, 1000)].map(p => p.svg).join('')
  expect(doc.startsWith('<svg')).toBe(true)
  for (const s of ['⎇ main', '◉ m', '→ origin/main', '⇡2', '1 staged', 'main: hello', '>HEAD<', '>origin/main<', '◈ v1', 'fix &lt;a &amp; b&gt;']) expect(doc).toContain(s)
  expect(doc).not.toContain('fix <a')
  // f2 arrived 100ms ago: its halo pulses from that point.
  expect(doc).toContain('begin="-0.10s"')
  // Five rows of the graph, a node each.
  expect(doc.match(/<g class="row">/g)).toHaveLength(5)
})

test('sits a short history on the status bar', () => {
  const pieces = graph(repo, 480, 1000, 1000)
  expect(pieces.reduce((h, p) => h + p.height, 0)).toBe(1000)
})

test('draws all of a long history in pieces, each under the element limit', () => {
  const many = Array.from({ length: 300 }, (_, i) => c(`h${i}`, i < 299 ? [`h${i + 1}`] : [], [], 'x'.repeat(400)))
  const pieces = graph({ ...repo, head: { ...repo.head, oid: 'h0' }, commits: many }, 1200, 0, 1000)
  expect(pieces.length).toBeGreaterThan(1)
  for (const p of pieces) expect(p.svg.length).toBeLessThanOrEqual(MAX_SVG)
  expect(pieces.reduce((h, p) => h + p.height, 0)).toBe(300 * 26)
  // Every commit drawn once: a row never straddles a join.
  expect(pieces.map(p => p.svg).join('').match(/<g class="row">/g)).toHaveLength(300)
})

test('the pane draws cells in the terminal and SVG elsewhere', async $ => {
  const props = { title: 'Branch', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const
  const term = await $.ui.mount({ plugin: 'branch-live', surface: 'terminal', component: 'Pane', requestId: 'branch-live', props })
  expect((await term.drawn()).type).toBe('Raster')
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'branch-live', surface, component: 'Pane', requestId: 'branch-live', props })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
  }
})
