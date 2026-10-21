import { test, expect } from 'claude-code/testing'
import { geom, landing, newWorld, spawn, step } from './sim'

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
  let w = spawn(newWorld(1), g)
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
