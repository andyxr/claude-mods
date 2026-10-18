import { test, expect } from 'claude-code/testing'
import { fire, grid, move, newGame, step, togglePause } from './game'
import type { Game } from './game'

const running = (g: Game): Game => ({ ...g, status: 'running' })

test('starts ready with a centred player, a full formation and three lives', () => {
  const g = newGame(20, 16, 1)
  expect(g.status).toBe('ready')
  expect(g.player).toBe(10)
  expect(g.invaders.length).toBe(40)
  expect(g.lives).toBe(3)
})

test('moving starts the game and stops at the walls', () => {
  const g = move(newGame(10, 12, 1), -1)
  expect(g.status).toBe('running')
  expect(g.player).toBe(4)
  let edge = g
  for (let i = 0; i < 20; i++) edge = move(edge, 1)
  expect(edge.player).toBe(9)
})

test('one shot at a time', () => {
  const g = fire(newGame(10, 12, 1))
  expect(g.shot).toEqual({ x: 5, y: 10 })
  expect(fire(g).shot).toEqual(g.shot)
})

test('a shot kills the invader it reaches and scores', () => {
  const g = running({ ...newGame(10, 12, 1), invaders: [{ x: 5, y: 3, kind: 2 }, { x: 1, y: 1, kind: 0 }], total: 2, shot: { x: 5, y: 4 } })
  const after = step(g)
  expect(after.invaders).toEqual([{ x: 1, y: 1, kind: 0 }])
  expect(after.score).toBe(10)
  expect(after.shot).toBe(null)
})

test('clearing the formation starts the next wave', () => {
  const g = running({ ...newGame(10, 12, 1), invaders: [{ x: 5, y: 3, kind: 0 }], total: 1, shot: { x: 5, y: 4 } })
  const after = step(g)
  expect(after.wave).toBe(2)
  expect(after.score).toBe(30)
  expect(after.invaders.length).toBeGreaterThan(1)
})

test('a bomb on the player costs a life; the last life ends the game', () => {
  const base = running({ ...newGame(10, 12, 1), invaders: [{ x: 0, y: 1, kind: 0 }], total: 1, bombs: [{ x: 5, y: 10 }], tick: 2 })
  const hit = step(base)
  expect(hit.lives).toBe(2)
  expect(hit.bombs).toEqual([])
  expect(step({ ...base, lives: 1 }).status).toBe('over')
})

test('invaders reaching the bottom end the game', () => {
  const g = running({ ...newGame(10, 12, 1), invaders: [{ x: 3, y: 11, kind: 1 }], total: 1, tick: 1 })
  expect(step(g).status).toBe('over')
})

test('the formation steps down and turns at the edge', () => {
  const g = running({ ...newGame(10, 12, 1), invaders: [{ x: 9, y: 1, kind: 1 }], total: 1, dir: 1, tick: 0 })
  let s = g
  while (s.invaders[0]!.y === 1) s = step(s)
  expect(s.invaders[0]).toMatchObject({ x: 9, y: 2 })
  expect(s.dir).toBe(-1)
})

test('pause freezes the board', () => {
  const g = togglePause(running(newGame(10, 12, 1)))
  expect(g.status).toBe('paused')
  expect(step(g)).toBe(g)
  expect(togglePause(g).status).toBe('running')
})

test('grids invaders, shot and player', () => {
  const g = { ...newGame(4, 3, 1), invaders: [{ x: 0, y: 0, kind: 0 as const }], shot: { x: 2, y: 1 }, player: 1 }
  expect(grid(g).map(r => r.map(c => c?.kind ?? null))).toEqual([
    ['invader', null, null, null],
    [null, null, 'shot', null],
    [null, 'player', null, null],
  ])
})
