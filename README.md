# claude-mods

A small marketplace of Claude Code mods by Andy Deighton.

| Mod | What it does |
| --- | --- |
| `branch-live` | Live, bottom-up git graph of the current branch and commit in a side pane |
| `context-gauge` | Status line gauge: context tokens left and tokens until autocompact, plus a session timer above the prompt |
| `context-handoff` | Warns above the prompt when context gets long and offers a fresh session seeded with a hand-off (`/handyoff` shows it on demand) |
| `invaders` | `/invade` opens a game of Space Invaders in a side pane |
| `snake` | `/snake` opens a game of Snake in a side pane |

## Install

From a Claude Code prompt:

```
/plugin install branch-live --marketplace andyxr/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install branch-live --marketplace andyxr/claude-mods
```

Swap `branch-live` for any mod name above. You don't need to clone anything: the install fetches the repo.

## Developing

Run a local copy without installing it:

```
claude --plugin-dir ./plugins/branch-live
```

Before pushing a change, bump `version` in that mod's `.claude-plugin/plugin.json`, then:

```
claude plugin validate ./plugins/<mod>
claude plugin test ./plugins/<mod>
```
