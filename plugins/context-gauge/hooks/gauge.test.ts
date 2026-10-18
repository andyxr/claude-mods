import { test, expect } from 'claude-code/testing'
import { render, fmt, hms } from './gauge'

test('formats token counts', () => {
  expect(fmt(950)).toBe('950')
  expect(fmt(612_400)).toBe('612k')
  expect(fmt(1_000_000)).toBe('1M')
})

test('shows tokens left and tokens to compaction', () => {
  expect(render({ window: 200_000, used: 50_000, compactAt: 167_000 })).toBe(
    'ctx 25% ██████░░░░░░░░░░░░░░▒▒▒▒ 150k left · 117k to compact',
  )
})

test('clamps past the compaction point', () => {
  expect(render({ window: 200_000, used: 180_000, compactAt: 167_000 })).toBe(
    'ctx 90% ██████████████████████▒▒ 20k left · 0 to compact',
  )
})

test('says when autocompact is off', () => {
  expect(render({ window: 100_000, used: 25_000 })).toBe(
    'ctx 25% ██████░░░░░░░░░░░░░░░░░░ 75k left · autocompact off',
  )
})

test('formats session time as hh:mm:ss', () => {
  expect(hms(0)).toBe('00:00:00')
  expect(hms(59_999)).toBe('00:00:59')
  expect(hms(3_725_000)).toBe('01:02:05')
  expect(hms(100 * 3600_000)).toBe('100:00:00')
})
