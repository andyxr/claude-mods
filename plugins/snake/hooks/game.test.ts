import { test, expect } from 'claude-code/testing'
import { grid, newGame, step, togglePause, turn } from './game'
import type { Game } from './game'

const running = (g: Game): Game => ({ ...g, status: 'running' })

test('starts ready, three long, heading right', () => {
  const g = newGame(10, 8, 1)
  expect(g.status).toBe('ready')
  expect(g.snake).toEqual([{ x: 5, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 4 }])
  expect(g.dir).toBe('right')
})

test('a turn starts the game; reversing is ignored', () => {
  const g = newGame(10, 8, 1)
  expect(turn(g, 'up').status).toBe('running')
  expect(turn(g, 'up').queued).toEqual(['up'])
  expect(turn(running(g), 'left').queued).toEqual([])
})

test('steps forward one cell', () => {
  const g = step(running({ ...newGame(10, 8, 1), food: { x: 0, y: 0 } }))
  expect(g.snake).toEqual([{ x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }])
})

test('eating grows the snake and scores', () => {
  const g = step(running({ ...newGame(10, 8, 1), food: { x: 6, y: 4 } }))
  expect(g.snake.length).toBe(4)
  expect(g.score).toBe(1)
  expect(g.snake.some(p => p.x === g.food.x && p.y === g.food.y)).toBe(false)
})

test('hitting the wall ends the game', () => {
  let g = running({ ...newGame(10, 8, 1), food: { x: 0, y: 0 } })
  for (let i = 0; i < 4; i++) g = step(g)
  expect(g.status).toBe('running')
  g = step(g)
  expect(g.status).toBe('over')
})

test('pause freezes the board', () => {
  const g = togglePause(running({ ...newGame(10, 8, 1), food: { x: 0, y: 0 } }))
  expect(g.status).toBe('paused')
  expect(step(g).snake).toEqual(g.snake)
  expect(togglePause(g).status).toBe('running')
})

test('grids head, body and food', () => {
  const g = { ...newGame(4, 1, 1), snake: [{ x: 1, y: 0 }, { x: 0, y: 0 }] as Game['snake'], food: { x: 3, y: 0 } }
  expect(grid(g)).toEqual([[1, 0, null, 'food']])
})
