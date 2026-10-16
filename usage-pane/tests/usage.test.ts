import { test, expect } from 'claude-code/testing'

import { addTokens, bar, fmt, modelName, newer, span, sumTokens, tally, tokensLeft } from '../hooks/register'

test('addTokens and sumTokens tally per model', () => {
  const t = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  const all = addTokens(addTokens(addTokens({}, 'a', t), 'a', t), 'b', t)
  expect(all['a']).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8 })
  expect(sumTokens(all)).toEqual({ input: 3, output: 6, cacheRead: 9, cacheWrite: 12 })
  expect(sumTokens({})).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
})

test('a /clear picks the carried running total back up', async ($, on) => {
  const t = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  const saved: Record<string, unknown> = { carry: { at: 1_000, running: { m: t } } }
  on('store.get', ($, e) => ({ value: saved[e.key] }) as never)
  on('store.set', ($, e) => { saved[e.key] = e.value; return { value: undefined } as never })
  on('store.delete', ($, e) => { delete saved[e.key]; return { value: undefined } as never })
  on('clock.now', () => ({ value: 2_000 }) as never)
  const writes: string[] = []
  on('state.set', ($, e, next) => { writes.push(JSON.stringify(e)); return next(e) })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'clear' } as never)
  expect(writes.some(w => w.includes('"tokens"') && w.includes('"cacheWrite":4'))).toBe(true)
  expect(saved['carry']).toBe(undefined)
})

test('fmt and modelName read well', () => {
  expect(fmt(950)).toBe('950')
  expect(fmt(12_340)).toBe('12.3k')
  expect(fmt(1_240_000)).toBe('1.24M')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5-20260101')).toBe('Haiku 5.5')
})

test('tally adds per model and restarts on a new reset time', () => {
  const limits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: 'A' }]
  let ws = tally({}, limits, 'm1', 100)
  ws = tally(ws, limits, 'm1', 50)
  ws = tally(ws, limits, 'm2', 25)
  expect(ws['five_hour']).toEqual({ resetsAt: 'A', basePct: 40, byModel: { m1: 150, m2: 25 } })
  ws = tally(ws, [{ kind: 'five_hour', percentUsed: 1, resetsAt: 'B' }], 'm1', 10)
  expect(ws['five_hour']).toEqual({ resetsAt: 'B', basePct: 1, byModel: { m1: 10 } })
})

test('tokensLeft waits for enough points then extrapolates', () => {
  const w = { resetsAt: 'A', basePct: 40, byModel: { m1: 1000 } }
  expect(tokensLeft(w, 41)).toBe(null)
  expect(tokensLeft(w, 50)).toBe(5000)
  expect(tokensLeft(undefined, 50)).toBe(null)
})

test('newer keeps the later reading', () => {
  const a = { at: 1, limits: [] }
  const b = { at: 2, limits: [] }
  expect(newer(a, b)).toBe(b)
  expect(newer(b, a)).toBe(b)
  expect(newer(null, a)).toBe(a)
})

test('span formats minutes, hours and days', () => {
  expect(span(45 * 60_000)).toBe('45m')
  expect(span((2 * 60 + 14) * 60_000)).toBe('2h 14m')
  expect(span((3 * 1440 + 5 * 60) * 60_000)).toBe('3d 5h')
})

test('bar fills to the percent', () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(150, 4)).toBe('████')
})

test('a measurement is saved to the shared store', async ($, on) => {
  const saved: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: saved[e.key] }) as never)
  on('store.set', ($, e) => { saved[e.key] = e.value; return { value: undefined } as never })
  on('clock.now', () => ({ value: 1_000 }) as never)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: {},
    rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-16T14:00:00Z' }],
    changed: ['rateLimits'],
  } as never)
  const latest = saved['latest'] as { limits: { percentUsed: number }[] }
  expect(latest.limits[0]?.percentUsed).toBe(34)
})
