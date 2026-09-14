# Coding agent visualization

The coding agent visualization replays a recorded coding agent session as it
happened: user prompts, the assistant's streaming thinking and text, tool
calls with their results, and the provider requests that produced all of it,
with token counts, payload sizes, and prices. It lives at `/coding-agent`, is
linked from the homepage, and is also published as the `xif-coding-agent` web
component.

Unlike the contribution visualizations, which render pre-computed model
internals, this one renders the _runtime_ of an agent: what the model
generated, what it did, and what it cost.

## Web component

The `src/web-component/coding-agent.ts` entry defines
`<xif-coding-agent>`, which renders the same replay as the page — header
badges, session selector, terminal, request list, playback bar — inside an
open shadow root. It has no router and never touches the host URL. The replay
logic itself lives in the router-free `CodingAgentExperience`; the page only
adds the `<h1>`, description, back-to-homepage links, and `?session=` URL
sync.

| Attribute                 | Default                  | Purpose                                              |
| ------------------------- | ------------------------ | ---------------------------------------------------- |
| `generated-data-base-url` | `/generated/`            | Base URL for the session index and session JSONs     |
| `session`                 | first `index.json` entry | Session id to replay (a deep link, like `?session=`) |
| `color-scheme`            | `auto`                   | `light`, `dark`, or `auto` Mantine scheme            |

Setting the `session` attribute points the replay at that session until the
user picks another one in the header selector; changing the attribute again
takes precedence once more. `dev/coding-agent.html` is a plain-HTML fixture
that exercises the element against deliberately hostile host styles. The
visualization needs no model or worker — sessions are static JSON — so unlike
`<xif-contribution-text>` it works on pages without cross-origin isolation.

## Data source

Sessions are served as static JSON from
`${GENERATED_DATA_BASE_URL}coding-agent/` (`/generated/` by default,
overridable with `VITE_GENERATED_DATA_BASE_URL`). Each session lives in its
own folder:

```text
generated/coding-agent/
  index.json                       # generated session catalog
  <session-id>/
    info.json                      # hand-written: { title, description? }
    session.json                   # packed session
```

`index.json` is compiled by `pnpm generate:session-index`
(`src/scripts/compile-session-index.ts`), which scans the session folders,
reads each `info.json`, and derives playback statistics from the packed
session — model, provider, request count, output tokens, total cost, and
duration — so the in-app selector can show them without downloading every
session. The session files use the
**packed session format** (`pi-recorder-packed-session`, schema version 1)
produced by the pi-visualization-recorder extension for the pi coding agent;
its structure is specified in that project's `docs/extension.md` §17.

The packed format stores:

- the **final prompt** (system prompt, tools, and all messages — a superset of
  every earlier request's prompt),
- one entry per provider request with `messageCount` (the length of that
  request's prompt prefix), `data` (usage, cost, timings, streaming segments),
  and `response` (the parsed assistant message),
- no provider payloads and no raw SSE bytes — the visualization works from the
  normalized prompt and Pi's provider-neutral response.

`prompt(n)` is reconstructed as `prompt.messages.slice(0, messageCount[n])`,
so earlier prompts are stored once each as a prefix of the final one. The full
transcript is all prompt messages plus the final response. Tool results are
matched to tool calls by `toolCallId`.

`src/coding-agent/packed-session.ts` parses and validates the document
(unsupported formats, out-of-range message counts, and malformed parts throw);
`src/coding-agent/session-index.ts` does the same for the session catalog and
the per-session `info.json`. `generated/` is not committed; place session
folders there manually and re-run `pnpm generate:session-index`.

The page loads the index, then renders the session named by the `session`
query parameter (falling back to the first entry): `/coding-agent?session=id`.
When more than one session is available, a dropdown button showing the
session title appears in the header's badge row, listing every session with
its model, request count, duration, and cost; switching remounts the replay
so playback restarts from the beginning. With a single session the selector
is hidden and no session metadata is rendered.

## Timeline model

`src/coding-agent/timeline.ts` turns the packed session into a wall-clock
timeline in seconds. Each turn runs through a sequence of phases:

```text
typing → input processing → streaming → tools → (gap) → next turn
```

1. **Typing** — user prompts newly included in a request appear
   character-by-character after a pause, and the request is sent the moment
   typing finishes. The first prompt is the exception: the session opens with
   it already written.
2. **Input processing** — the request's uncached input tokens
   (`input − cacheRead`) process at a fixed rate before output starts. The
   request shows as _processing_ in the request list during this phase. The
   processing time is capped, so an unusually large uncached prompt (for
   example, a retry that lost its cache hit) cannot stall the playback.
3. **Streaming** — output tokens (including reasoning and tool-call tokens)
   advance the clock at a fixed rate. Within a request, the window is split
   across the response content blocks (thinking / text / toolCall)
   proportional to each block's UTF-8 byte length, falling back to an even
   split when every block is empty. Recorded segment durations
   (`timing.segments`) are ignored: they include API latency, which does not
   reflect generation speed. Text reveals character-by-character; tool-call
   lines appear whole with a spinner.
4. **Tools** — a fixed pause per streamed tool call, during which the call
   line keeps its spinner; tool results appear when the phase ends.

Tool _execution_ wall-clock time from the real session is deliberately
compressed into this fixed per-tool pause: the playback timeline is driven by
generated tokens, not by the original session duration.

Phases are accumulated in integer milliseconds internally and exposed as
seconds, so seeking to a boundary compares exactly.

### Constants

All tunables are exported from `src/coding-agent/timeline.ts`:

| Constant                             | Default | Meaning                                       |
| ------------------------------------ | ------- | --------------------------------------------- |
| `PLAYBACK_TOKENS_PER_SECOND`         | 50      | Output tokens advanced per second of playback |
| `INPUT_PROCESSING_TOKENS_PER_SECOND` | 500     | Prefill rate for uncached input tokens        |
| `MAX_INPUT_PROCESSING_MS`            | 2000    | Cap on each request's prefill time            |
| `TOOL_EXECUTION_MS`                  | 300     | Pause per streamed tool call                  |
| `REQUEST_GAP_MS`                     | 10      | Minimum pause before the next request appears |
| `USER_TYPING_DELAY_MS`               | 2000    | Pause before the user starts typing           |
| `USER_TYPING_WORDS_PER_MINUTE`       | 45      | Typing speed (5 characters per word)          |

The playback clock itself (`src/coding-agent/use-playback.ts`) is a
requestAnimationFrame loop that advances by the frame delta capped at 100 ms.
Frames stop firing while the tab is unfocused, so playback pauses instead of
jumping ahead on refocus.

## User interface

`src/pages/CodingAgentPage.tsx` composes three parts over the shared
`usePlayback` clock, deriving everything from the current time with pure
functions (`entriesAt`, `requestsAt`, `usageBreakdownAt`), so playing,
pausing, seeking, and jumping to a request all run through the same snapshot
logic.

### Terminal (main view)

`src/coding-agent/AgentTerminal.tsx` renders the transcript in a CLI style,
light and dark:

- User prompts with a `❯` mark, typed out with a caret.
- Thinking blocks, dim and italic, expanded while streaming; a completed block
  stays expanded and is only auto-collapsed when a later thinking block starts
  streaming (so it remains visible through tool calls and text). While the
  user is scrolled up, auto-collapses are deferred — the blocks stay expanded
  and fold in once the user returns to the latest. Seeking replays the same
  fold pattern: everything but the most recent thinking block appears
  collapsed, as continuous playback would have left it. An explicit toggle
  always wins over the automatic behavior.
- Assistant text.
- Tool calls as `● <tool> <summary>` lines (command for `bash`, path for
  file tools), spinner while running, ✓/✕ based on the result, click to
  expand the full arguments; tool results collapsed to three lines until
  expanded.

The transcript auto-scrolls pinned to the bottom during playback. Scrolling
up releases the pin immediately (content shrinking — e.g. a thinking block
collapsing — does not); scrolling back to the bottom or pressing
"Jump to latest" re-pins.

### Provider requests (side panel)

`src/coding-agent/RequestList.tsx` shows one card per request with three
states: _processing input_, _streaming_, and _done_. A completed card shows
the UTF-8 JSON payload sizes sent and received (computed once per request
during timeline construction — the recording stores no byte counts), cached /
input / output token counts, and the request cost. The footer accumulates
per-category tokens and costs (cached, cache write, input, output) with the
total, over requests completed so far.

Clicking a card opens the **request pane**: the list slides left by its own
width plus a padding gap and a floating pane of the same width appears in
its place, overlaying the terminal's right edge without reflowing the rest
of the visualization (on the single-column mobile layout the pane covers
the list in place instead). Opening it pauses playback; closing it — via
its close button, a click on the dimmed backdrop over the terminal, or
clicking the selected card again — resumes playback, but only if it was
running when the pane opened. The header carries a **Go to** button next
to the title: it seeks to the moment that request's response finished
streaming, applies the bounded peek, and closes the pane without resuming
playback. A minimum gap between requests guarantees the following request
is not revealed at that point. The space is reserved for a two-section
accordion with the request input (the prompt prefix as pretty-printed
JSON, the same shape the payload byte sizes were computed from) and the
parsed assistant response in scrollable code boxes. Input starts expanded;
exactly one section is always expanded — opening the output collapses the
input, and an open section cannot be collapsed (its header shows no hover
or pointer affordance). The accordion resets to the input when another
request is opened. The panel shares the same
pin-to-bottom scroll behavior as the terminal.

Normally only requests that have been sent at the current playback time are
listed. Jumping to an earlier request (the pane's **Go to** button) keeps
the already-visible requests in a dimmed `future` state — a temporary "peek"
mode that ends as soon as the user plays or seeks the slider. The peek is
bounded by the request edge shown before the jump: requests up to that edge
stay visible (those after the seeked one dimmed), and nothing beyond it is
revealed. The **Show all requests** checkbox in the panel header lifts the
bound and pins every request permanently instead; it renders in the
indeterminate state while a peek is active. Toggling it never scrolls the
list. While future requests are visible the panel does not auto-scroll at
all — it becomes a static browsing view without the jump button, since
every request is rendered and the list can simply be scrolled. While future
requests are visible, an in-flight request keeps the settled card — payload
bytes, usage, and the spinner where the checkmark would be — instead of the
live labels, so seeking across it does not flip the card's layout.
`requestsAt` produces the `future` status only when asked for it via its
`includeFuture` option, so the default snapshot logic is unchanged.

### Playback bar

Play/pause, a seek slider, and a `m:ss` clock; space toggles playback unless
a control has focus. Pressing play at the end restarts from the beginning.
Playback auto-starts once the session has loaded.

## Testing

Timeline construction, entry/request snapshots, usage breakdowns, payload
sizes, and parser validation are covered by unit tests against a synthetic
two-request session (`src/coding-agent/*-test.ts`); expectations are derived
from the exported constants so retuning them keeps the tests meaningful.

`dev/coding-agent.html` serves as the manual browser fixture for the web
component; `dev/contribution-text.html` plays the same role for the
contribution-text element.
