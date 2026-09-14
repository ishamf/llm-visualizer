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
pauses, and seeks the whole timeline.

The session format, playback timeline, and interface are described in
[Coding agent visualization](coding-agent-visualization.md).
