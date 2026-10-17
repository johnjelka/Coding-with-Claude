# Coding with Claude

Mods for Claude Code and the Claude desktop app.

## usage-pane

A docked **Usage** pane that opens with every session:

- **Session (5h)** and **Weekly** plan limits: percent used, a bar, time to reset, and an estimate of tokens left.
- **Running total** of the session's tokens and **Current (since /clear)**, each split into input, output, cache read and cache write, plus the split by model. The two match until the first `/clear`.
- **Limit points by model (est.)**: each model's estimated share of the session and weekly limits.

The mod also hands Claude one hidden line with each prompt — the measured context size, the plan limits and the session's real cost (tokens weighted by price, so cheap cache re-reads count a tenth) — so rules like "wrap up at 15% context" can run on real numbers instead of Claude's guesses. The line rides after the prompt, so the prompt cache is not broken.

Figures refresh after each Claude reply, and every open pane picks up other sessions' readings within 30 seconds. Plan limits only report a percentage, so tokens left and per-model shares are estimates: they count tokens from all sessions since the mod first saw each limit window, leave out cache reads, and do not see claude.ai usage. The mod makes no model calls and costs no tokens.

`/usage-pane` reopens the pane after it is closed.

## Install

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `johnjelka/Coding-with-Claude`, then **Add plugin**.

At the prompt of a terminal session:

```
/plugin install usage-pane --marketplace johnjelka/Coding-with-Claude
```

From a shell:

```
claude plugin install usage-pane --marketplace johnjelka/Coding-with-Claude
```

Answer `y` to add the marketplace, then pick a scope.

The mod uses Claude Code's early-access plugin API, which may change between releases.

## License

Public domain under [The Unlicense](LICENSE). Use it for anything.
