export type Elapsed = string | null

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': { elapsed: Elapsed }
  }
}
