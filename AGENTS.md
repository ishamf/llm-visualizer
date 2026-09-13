# Agent notes

## Browser verification (agent-browser)

Use `agent-browser` to verify UI changes against an already-running dev
server (headless Chrome via CDP). This is the basics only — run
`agent-browser skills get core` for the full guide before heavy use.

```bash
# Isolate your session first (the default session is shared machine-wide)
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix <task>)"

agent-browser set viewport 390 844        # e.g. mobile-size for responsive checks
agent-browser open http://localhost:<port>
agent-browser snapshot -i                 # accessibility tree with @eN refs
agent-browser click @e3                   # act on refs; re-snapshot after page changes
agent-browser screenshot /tmp/page.png    # eyeball the result
agent-browser close                       # closes your browser session only
```

- Routes are hash-based: use `/#/coding-agent`, not `/coding-agent`.
- For non-trivial JS, pipe a heredoc: `cat <<'EOF' | agent-browser eval --stdin … EOF`.
- `agent-browser close` never touches the user's dev server.

## Dev servers

Do NOT start dev servers (`pnpm dev`, `vite`, …) — the user usually has one
running. Find it and reuse it. To match a listening port to its project
directory:

```bash
pgrep -af vite                  # list vite processes directly (argv reveals the project path):
ss -tlnp | grep node            # listening port → pid (if port is not visible)
```

Reuse the server whose working directory matches this repository; if none
does, ask the user instead of starting one.
