import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Reading, Tokens, Window } from '../types'

const PANE = 'usage-pane'
const TITLE = 'Usage'
// Store key shared by every session, so each pane shows the newest account reading.
const LATEST = 'latest'
// Store key holding every limit window's cross-session token tally.
const WINDOWS = 'windows'
// Store key carrying a session's running total over a /clear, which restarts the module.
const CARRY = 'carry'
// A carried total older than this is ignored, so a stale one is never picked up.
const CARRY_MS = 120_000
// How often a pane pulls other sessions' readings and refreshes its countdowns.
const TICK_MS = 30_000
// Percentage points a window must climb past its base before a tokens-left estimate shows.
const MIN_PTS = 2

const reading = atom({ plugin: 'usage-pane', key: 'reading' } as const, null as Reading | null)
const now = atom({ plugin: 'usage-pane', key: 'now' } as const, 0)
const tokens = atom({ plugin: 'usage-pane', key: 'tokens' } as const, {} as Record<string, Tokens>)
// Tokens since the last /clear; equal to `tokens` until the first clear.
const current = atom({ plugin: 'usage-pane', key: 'current' } as const, {} as Record<string, Tokens>)
const windows = atom({ plugin: 'usage-pane', key: 'windows' } as const, {} as Record<string, Window>)

// Pick the newer of two readings; null loses.
export function newer(a: Reading | null, b: Reading | null): Reading | null {
  if (!a) return b
  if (!b) return a
  return b.at > a.at ? b : a
}

// Format a span in ms as "2h 14m", "3d 5h" or "45m".
export function span(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Text bar of `width` cells filled to `pct` percent.
export function bar(pct: number, width = 20): string {
  const fill = Math.min(width, Math.max(0, Math.round((pct / 100) * width)))
  return '█'.repeat(fill) + '░'.repeat(width - fill)
}

// Short token count: 950, 12.3k, 1.24M.
export function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}

// "claude-opus-5-5-20260101" becomes "Opus 5.5".
export function modelName(id: string): string {
  const parts = id.replace(/^claude-/, '').split('-').filter(p => !/^\d{8}$/.test(p))
  const words = parts.filter(p => !/^\d+$/.test(p)).join(' ')
  const nums = parts.filter(p => /^\d+$/.test(p)).join('.')
  const name = words.charAt(0).toUpperCase() + words.slice(1)
  return nums ? `${name} ${nums}` : name || id
}

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

// Add one turn's tokens to a per-model tally.
export function addTokens(all: Record<string, Tokens>, model: string, t: Tokens): Record<string, Tokens> {
  const was = all[model] ?? ZERO
  return {
    ...all,
    [model]: {
      input: was.input + t.input,
      output: was.output + t.output,
      cacheRead: was.cacheRead + t.cacheRead,
      cacheWrite: was.cacheWrite + t.cacheWrite,
    },
  }
}

// Sum a per-model tally into one set of counts.
export function sumTokens(all: Record<string, Tokens>): Tokens {
  return Object.values(all).reduce(
    (a, v) => ({
      input: a.input + v.input,
      output: a.output + v.output,
      cacheRead: a.cacheRead + v.cacheRead,
      cacheWrite: a.cacheWrite + v.cacheWrite,
    }),
    ZERO,
  )
}

const whole = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite

// Tokens that count toward the estimates; cache reads are left out as they weigh far less.
export function counted(t: Tokens): number {
  return t.input + t.output + t.cacheWrite
}

// Add one turn's tokens to every window, starting a window afresh when its reset time changes.
export function tally(
  ws: Record<string, Window>,
  limits: Limit[],
  model: string,
  n: number,
): Record<string, Window> {
  const out = { ...ws }
  for (const l of limits) {
    const resetsAt = l.resetsAt ?? ''
    const old = out[l.kind]
    const w: Window = old && old.resetsAt === resetsAt ? old : { resetsAt, basePct: l.percentUsed, byModel: {} }
    out[l.kind] = { ...w, byModel: { ...w.byModel, [model]: (w.byModel[model] ?? 0) + n } }
  }
  return out
}

// Estimated tokens left in a window, or null while too few points have moved to say.
export function tokensLeft(w: Window | undefined, pct: number): number | null {
  if (!w) return null
  const pts = pct - w.basePct
  const total = Object.values(w.byModel).reduce((a, b) => a + b, 0)
  if (pts < MIN_PTS || total === 0) return null
  return Math.max(0, (total / pts) * (100 - pct))
}

const LABELS: Record<string, string> = { five_hour: 'Session (5h)', seven_day: 'Weekly' }

// Pull the newest shared reading and window tallies into this session's state.
async function pull($: EngineInterface) {
  const shared = (await $.store.get(LATEST)) as Reading | undefined
  const ws = (await $.store.get(WINDOWS)) as Record<string, Window> | undefined
  const at = await $.clock.now()
  await update($, reading, mine => newer(mine, shared ?? null))
  if (ws) await update($, windows, () => ws)
  await update($, now, () => at)
}

export const register: Register = on => {
  // Running total for drawing; /clear wipes state and module memory, so it rides over in the store.
  let running: Record<string, Tokens> = {}

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await $.store.set(CARRY, { at: await $.clock.now(), running })

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-pane', description: 'Open the usage pane' })
    running = await read($, tokens)
    await pull($)
    $.clock.every(TICK_MS, () => void pull($))
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'usage-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Usage pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const t: Tokens = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
      }
      running = addTokens(running, u.model, t)
      const total = running
      await update($, tokens, () => total)
      await update($, current, all => addTokens(all, u.model, t))
      const r = newer(await read($, reading), ((await $.store.get(LATEST)) as Reading | undefined) ?? null)
      if (r) {
        const shared = ((await $.store.get(WINDOWS)) as Record<string, Window> | undefined) ?? {}
        const ws = tally(shared, r.limits, u.model, counted(t))
        await $.store.set(WINDOWS, ws)
        await update($, windows, () => ws)
      }
    }

    return next(e)
  })

  // After /clear the new session's state starts empty: restore the running total and shared figures.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      const carry = (await $.store.get(CARRY)) as { at: number; running: Record<string, Tokens> } | undefined
      if (carry && (await $.clock.now()) - carry.at < CARRY_MS) running = carry.running
      await $.store.delete(CARRY)
      const total = running
      await update($, tokens, () => total)
      await update($, current, () => ({}))
      await pull($)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      const at = await $.clock.now()
      const fresh: Reading = {
        at,
        limits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
      }
      const shared = (await $.store.get(LATEST)) as Reading | undefined
      if (newer(shared ?? null, fresh) === fresh) await $.store.set(LATEST, fresh)
      await update($, reading, mine => newer(mine, fresh))
      await update($, now, () => at)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, reading)
    const t = await read($, now)
    const mine = await read($, tokens)
    const ws = await read($, windows)

    const limitRow = (l: Limit) => {
      const resets = l.resetsAt ? Date.parse(l.resetsAt) - t : NaN
      const left = tokensLeft(ws[l.kind], l.percentUsed)
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{LABELS[l.kind] ?? l.kind}  {l.percentUsed}%</Text>
          <Text color={l.percentUsed >= 90 ? 'red' : l.percentUsed >= 70 ? 'yellow' : 'green'}>{bar(l.percentUsed)}</Text>
          {Number.isFinite(resets) && <Text dimColor>resets in {span(resets)}</Text>}
          <Text dimColor>{left === null ? 'tokens left: gathering data (est.)' : `~${fmt(left)} tokens left (est.)`}</Text>
        </Box>
      )
    }

    const sinceClear = await read($, current)
    const models = Object.entries(mine)
    const sum = sumTokens(mine)
    const all = whole(sum)
    const cur = sumTokens(sinceClear)
    const split = (t: Tokens) =>
      `in ${fmt(t.input)} · out ${fmt(t.output)} · cache read ${fmt(t.cacheRead)} · cache write ${fmt(t.cacheWrite)}`

    // Each model's estimated points of a window: its token share times the points moved since tracking began.
    const share = (kind: string, model: string) => {
      const w = ws[kind]
      const pct = r?.limits.find(l => l.kind === kind)?.percentUsed
      if (!w || pct === undefined) return null
      const total = Object.values(w.byModel).reduce((a, b) => a + b, 0)
      const pts = pct - w.basePct
      if (total === 0 || pts <= 0) return null
      return ((w.byModel[model] ?? 0) / total) * pts
    }
    const shareModels = [...new Set(Object.values(ws).flatMap(w => Object.keys(w.byModel)))]
    const pts = (n: number | null) => (n === null ? '–' : `~${n.toFixed(1)}`)

    return (
      <Box flexDirection="column">
        {r ? r.limits.map(limitRow) : <Text dimColor>No limit reading yet. It fills after the next Claude reply.</Text>}
        {r && <Text dimColor>updated {span(t - r.at)} ago</Text>}

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Running total  {fmt(all)} tokens</Text>
          <Text dimColor>{split(sum)}</Text>
          <Text bold>Current (since /clear)  {fmt(whole(cur))} tokens</Text>
          <Text dimColor>{split(cur)}</Text>
          {models.map(([id, v]) => {
            const n = whole(v)
            const c = sinceClear[id] ? whole(sinceClear[id]) : 0
            return <Text>{modelName(id)}  {fmt(n)} ({all ? Math.round((n / all) * 100) : 0}%) · current {fmt(c)}</Text>
          })}
        </Box>

        {shareModels.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Limit points by model (est.)</Text>
            {shareModels.map(m => (
              <Text>{modelName(m)}  session {pts(share('five_hour', m))} · week {pts(share('seven_day', m))}</Text>
            ))}
            <Text dimColor>All sessions since tracking began; cache reads not counted.</Text>
          </Box>
        )}
      </Box>
    )
  })
}
