# Coding with Claude

Mods for Claude Code and the Claude desktop app.

## usage-pane

A docked **Usage** pane that opens with every session:

- **Session (5h)** and **Weekly** plan limits: percent used, a bar, time to reset, and an estimate of tokens left.
- **This session**: total tokens (input, output, cache read, cache write) and the split by model.
- **Limit points by model (est.)**: each model's estimated share of the session and weekly limits.

Figures refresh after each Claude reply, and every open pane picks up other sessions' readings within 30 seconds. Plan limits only report a percentage, so tokens left and per-model shares are estimates: they count tokens from all sessions since the mod first saw each limit window, leave out cache reads, and do not see claude.ai usage. The mod makes no model calls and costs no tokens.

`/usage-pane` reopens the pane after it is closed.

## Install

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `SimAnt2020/Coding-with-Claude`, then **Add plugin**.

At the prompt of a terminal session:

```
/plugin install usage-pane --marketplace SimAnt2020/Coding-with-Claude
```

From a shell:

```
claude plugin install usage-pane --marketplace SimAnt2020/Coding-with-Claude
```

Answer `y` to add the marketplace, then pick a scope.

The mod uses Claude Code's early-access plugin API, which may change between releases.

## License

Public domain under [The Unlicense](LICENSE). Use it for anything.
