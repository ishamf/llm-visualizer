# Coding agent replay

The coding agent visualization replays a recorded coding agent session as it
happened: user prompts, the assistant's streaming thinking and text, tool
calls with their results, and the provider requests that produced all of it,
with token counts, payload sizes, and prices. It lives at `/coding-agent` and
is linked from the homepage.

Sessions are recorded with the pi-visualization-recorder extension for the pi
coding agent and load as static JSON from the generated-data origin, like the
pre-generated contribution examples. A header selector switches between
recorded sessions. During playback the transcript streams into a
terminal-style view while a side panel follows each provider request — what
was sent, what came back, and what it cost — and the playback bar plays,
pauses, and seeks the whole timeline. Below the playback bar, a chart shows
what each provider request cost.

## Setup

The replay needs a recorded session in `generated/coding-agent/`; the folder
layout is described in
[Data source](coding-agent-visualization.md#data-source). You can download
the [example session](https://gist.github.com/ishamf/409f81c6f79dfa8f8c0b902a1062a60e) 
or record your own with the [recorder plugin](https://github.com/ishamf/pi-visualization-recorder).

With a session folder in place, compile the session index that the page
loads:

```sh
pnpm generate:session-index
```

The session format, playback timeline, and interface are described in
[Coding agent visualization](coding-agent-visualization.md).
