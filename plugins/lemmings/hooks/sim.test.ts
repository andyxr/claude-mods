import { test, expect } from 'claude-code/testing'
import { geom, landing, newWorld, release, slot, spawn, step } from './sim'

test('the cliff takes the right third and the pile rises with the fill', () => {
  const g = geom(60, 23, 0.5)
  expect(g.cliffX).toBe(40)
  expect(g.top).toBe(5)
  expect(g.pile).toBe(9)
  expect(geom(60, 23, 0).pile).toBe(0)
  expect(geom(60, 23, 2).pile).toBe(18)
})

test('a lemming walks to the edge, falls, and splats on the pile', () => {
  const g = geom(30, 20, 0.25)
  let w = release(spawn(newWorld(1), g))
  expect(w.lems[0]!.state).toBe('walk')
  let fell = false
  for (let i = 0; i < 200 && w.lost === 0; i++) {
    w = step(w, g)
    if (w.lems[0]?.state === 'fall') fell = true
  }
  expect(fell).toBe(true)
  expect(w.lost).toBe(1)
  expect(w.lems[0]!.state).toBe('splat')
  expect(w.lems[0]!.y).toBe(landing(g))
  for (let i = 0; i < 20; i++) w = step(w, g)
  expect(w.lems.length).toBe(0)
})

test('lemmings queue on the cliff and only jump when released', () => {
  const g = geom(60, 20, 0.25)
  let w = newWorld(1)
  for (let i = 0; i < 400; i++) w = step(spawn(w, g), g)
  expect(w.lost).toBe(0)
  expect(w.lems.length).toBe(4)
  expect(w.lems.every(l => l.state === 'wait')).toBe(true)
  expect(w.lems.map(l => l.x).sort((a, b) => a - b)).toEqual([0, 1, 2, 3].map(i => slot(g, i)))
  const still = step(w, g)
  expect(still.lems).toEqual(w.lems)
  w = release(w)
  for (let i = 0; i < 200 && w.lost === 0; i++) w = step(w, g)
  expect(w.lost).toBe(1)
})
