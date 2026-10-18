import { expect, test } from 'claude-code/testing'

import type { GraphCommit, Snapshot } from '../types'
import { diffRefs, mergedBranchName, parseStatus } from '../hooks/git'
import { layout, paint } from '../hooks/graph'

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
