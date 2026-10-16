export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// One rate-limit reading, stamped with when it was taken (ms since epoch).
export type Reading = { at: number; limits: Limit[] }
// Token counts as the API reports them.
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
// One limit window's token tally across all sessions since the mod first saw it at basePct.
export type Window = { resetsAt: string; basePct: number; byModel: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'usage-pane': {
      reading: Reading | null
      now: number
      tokens: Record<string, Tokens>
      current: Record<string, Tokens>
      windows: Record<string, Window>
    }
  }
}
