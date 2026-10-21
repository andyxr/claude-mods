export type Context = { used: number | null; window: number; compactAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    lemmings: { context: Context }
  }
}
