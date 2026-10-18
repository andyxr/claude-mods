export type Warning = { tokens: number; window: number }
export type Phase = 'warn' | 'writing' | { error: string }

declare module 'claude-code' {
  interface PluginState {
    'context-handoff': { warning: Warning | null; phase: Phase }
  }
}
