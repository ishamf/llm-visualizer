# Contribution text Web Component plan

## Status

Planning only. The Web Component and its distribution build have not been
implemented yet.

## Scope

Package the current contribution-text experience as one custom element:

```html
<xif-contribution-text></xif-contribution-text>
```

The element owns only the interactive experience:

- the pre-generated prompt picker;
- the in-browser generation form and its progress/error states;
- the contribution-text visualization and its controls;
- the state that switches between pre-generated and live results.

Headings and explanatory article content stay outside the element. A plain HTML
example page will provide that content and insert the element where the
interactive demo belongs.

The element does not render `App`, `HomePage`, or any route. It does not depend
on `react-router-dom`, read the host URL, or modify browser history.

## Component boundary

Extract the interactive parts of `HomePage` into a router-independent React
component, tentatively named `ContributionTextExperience`:

```text
ContributionTextExperience
├── pre-generated prompt picker
├── BrowserGenerationPanel
└── result area
    └── ContributionText
```

`HomePage` can render this component inside the existing standalone page, while
the custom element renders the same component directly. Keep the page title,
introductory copy, development navigation link, and other article-level content
in `HomePage` or in the plain HTML host page.

Remove the current router dependency from `BrowserGenerationPanel`. Its
`Navigate` usage belongs to the route-level `GenerationPage`, not to the shared
form. If necessary, split the file into:

```text
src/generation-ui/BrowserGenerationPanel.tsx
src/pages/GenerationPage.tsx
```

The panel must remain responsible for terminating its worker when unmounted.
Removing `<xif-contribution-text>` must therefore stop any active generation.

## Custom element structure

Use a small local `HTMLElement` implementation and React `createRoot`; a
general React-to-custom-element dependency is unnecessary for the initial API.

Each instance owns an open shadow root:

```text
<xif-contribution-text>
└── shadowRoot
    ├── shared constructable stylesheet
    ├── div[data-contribution-text-root]     React mount node
    └── div[data-contribution-text-portals]  Mantine portal target
```

The mount and portal nodes are siblings so React never reconciles DOM inserted
by Mantine portals.

Lifecycle:

- `connectedCallback`: create a React root and render the experience;
- `disconnectedCallback`: unmount the root, which terminates the worker and
  aborts contribution-data loading;
- reconnection: create a fresh React root on the existing mount node;
- registration: guard with `customElements.get` so importing the entry twice
  is safe.

Proposed files:

```text
src/
├── contribution-text-experience.tsx
├── generation-ui/
│   └── BrowserGenerationPanel.tsx
└── web-component/
    ├── contribution-text-element.tsx
    ├── entry.ts
    ├── portal-target.tsx
    ├── styles.ts
    └── worker-loader.ts
vite.web-component.config.ts
examples/
└── contribution-text.html
```

## Mantine and Shadow DOM

The component build must place Mantine and application CSS inside the shadow
root instead of injecting it into the host document. Import the required files
as strings and combine them in one module-level `CSSStyleSheet`:

```ts
import mantineCss from '@mantine/core/styles.css?inline';
import indexCss from '../index.css?inline';
import appCss from '../App.css?inline';
```

Move `import './App.css'` out of `App.tsx`; standalone and Web Component entries
must own their respective style loading. Split page-only rules from shared
interactive rules where practical. Embedded CSS must use `:host` and a local
root instead of relying on `html`, `body`, or viewport-height layout.

Configure the embedded `MantineProvider` with the element as its root:

```tsx
<MantineProvider cssVariablesSelector=":host" getRootElement={() => host}>
  {children}
</MantineProvider>
```

Use a per-instance color-scheme manager, or no persistent manager, so multiple
elements do not compete for Mantine's default local-storage key.

Mantine popups must not escape to `document.body`, where shadow-root styles no
longer apply. Provide the instance portal node through React context and apply
it to current portal-producing controls:

- `ContributionText`'s `Select`: `comboboxProps.portalProps.target`;
- any future `Tooltip`, `Popover`, `Menu`, `Modal`, or `Drawer`: its equivalent
  portal target option.

The context returns `undefined` in the standalone app so existing document-body
portal behavior remains unchanged there.

## Public API

Keep the initial API small:

| Attribute                 | Property               | Default       | Purpose                                      |
| ------------------------- | ---------------------- | ------------- | -------------------------------------------- |
| `model-base-url`          | `modelBaseUrl`         | `/models/`    | Base URL for tokenizer and ONNX assets       |
| `generated-data-base-url` | `generatedDataBaseUrl` | `/generated/` | Base URL for dataset discovery and artifacts |
| `color-scheme`            | `colorScheme`          | `auto`        | `light`, `dark`, or `auto` Mantine scheme    |

There is no `initial-path` because the element has no router.

Resolve `model-base-url` to an absolute URL before worker startup. Attribute
changes after a model has started loading can be initialization-only in the
first version; document that behavior and validate malformed values before the
large download begins.

Potential host events can be added when a consumer needs them:

- `contribution-text-ready`;
- `contribution-text-error`;
- `contribution-text-generation-state-change`.

Cross-boundary events must use `bubbles: true` and `composed: true`, with
serializable details.

## Worker and asset packaging

Do not rely on the SPA-only form of:

```ts
new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
```

The sibling `site-interactive-content/packages/react-19` build avoids this for
separately deployed library output. Follow the same design:

1. Add `browser-generation.worker.ts` as an explicit Vite library entry.
2. Emit it at a stable relative path such as
   `workers/browser-generation.js`; its dependency chunks may remain hashed.
3. In development, load the TypeScript worker URL from source.
4. In production, construct the emitted worker URL relative to the Web
   Component entry's `import.meta.url`. Keep the path in a variable so Vite
   does not transform it as a source worker.
5. Create a Blob module containing an import of the resolved worker URL, start
   a module worker from the Blob URL, then revoke the Blob URL.

The production loader should follow this shape:

```ts
const builtWorkerPath = './workers/browser-generation.js';
const workerUrl = import.meta.env.DEV
  ? new URL('../generation/browser-generation.worker.ts', import.meta.url)
  : new URL(builtWorkerPath, import.meta.url);
const bootstrap = new Blob([`import ${JSON.stringify(workerUrl.href)};`], {
  type: 'text/javascript',
});
const bootstrapUrl = URL.createObjectURL(bootstrap);
const worker = new Worker(bootstrapUrl, { type: 'module' });
URL.revokeObjectURL(bootstrapUrl);
```

Use a relative production path, not `/workers/...`, so the component can be
deployed below a subpath or from a CDN without assuming the host site's root.

The Blob bootstrap has hosting implications that must be documented and tested:

- the host Content Security Policy must allow `worker-src blob:`;
- a cross-origin worker module and all of its chunks must be served with CORS;
- emitted worker/chunk URLs must remain valid when the entry is copied to a
  versioned deployment directory.

Pass the resolved model base URL in a worker initialization or generation
message. Replace the worker's current dependency on
`globalThis.location.origin` and `/models/`. Both `env.localModelPath` and the
tokenizer/model identifiers must resolve against the configured base. Update
the main-thread Cache API check to inspect the same resolved weights URL.

The model remains external to the JavaScript distribution. If Transformers.js
or ONNX needs cross-origin isolation, the embedding HTML response must set COOP
and COEP; the custom element cannot set response headers. Model responses also
need the corresponding CORS/CORP headers.

The component detects a non-isolated host page at runtime with
`window.crossOriginIsolated` (see
`src/generation/cross-origin-isolation.ts`). Without isolation, the generation
worker cannot use `SharedArrayBuffer` for multi-threaded inference, so the panel
shows a reduced-performance warning linking to
<https://llm-visualizer.ishamf.dev/>, where the site serves the isolation
headers itself.

The bundled pre-generated contribution JSON uses `import.meta.glob` and dynamic
imports. Keep those generated chunks beside the component output and verify
their URLs are relative to the component deployment rather than the host page.

## Vite distribution build

Add a separate `vite.web-component.config.ts` and script:

```json
"build:web-component": "tsc -b && vite build --config vite.web-component.config.ts"
```

The library build has two explicit entries:

```text
entry/contribution-text       -> src/web-component/entry.ts
workers/browser-generation   -> src/generation/browser-generation.worker.ts
```

Build requirements:

- ES module output;
- stable filenames for the public component and worker entries;
- hashed shared chunks and generated contribution JSON assets;
- source maps;
- React, React DOM, Mantine, Transformers.js, and other runtime dependencies
  bundled so the host installs nothing;
- no document-level CSS output or injection;
- all runtime URLs valid when the distribution directory is hosted at an
  arbitrary URL prefix.

Expected output:

```text
dist-web-component/
├── contribution-text.js
├── workers/
│   └── browser-generation.js
└── static/
    ├── chunks/*.js
    └── assets/*
```

## Plain HTML example

Add `dev/contribution-text.html` as a non-React development consumer. It should
contain the explanatory title, prose, usage/privacy notes, and surrounding page
layout, then load the source Web Component entry:

```html
<article>
  <h1>See what shaped each token</h1>
  <p>...</p>

  <xif-contribution-text
    model-base-url="../models/"
    color-scheme="auto"
  ></xif-contribution-text>
</article>

<script type="module" src="/src/web-component/entry.ts"></script>
```

Give this page its own small host stylesheet. It is also the isolation fixture:
use deliberately different body typography, colors, and form styles to catch
CSS leakage in either direction.

Vite transforms and serves the page at `/dev/contribution-text.html` with the
same React preamble and COOP/COEP headers as the application. The default
production build only uses the root `index.html`, so it does not include this
development fixture.

## Implementation sequence

1. Extract `ContributionTextExperience` and the router-free generation panel;
   render the extraction from the current `HomePage` and verify no standalone
   behavior changes.
2. Add the shadow-root custom element, contained Mantine provider, CSS adoption,
   portal context, and lifecycle cleanup.
3. Add configurable model URLs to the main thread and worker protocol.
4. Add the explicit worker entry and Blob-based production worker loader.
5. Add the separate Web Component build and inspect all emitted entry, chunk,
   worker, and contribution-data URLs.
6. Add the plain HTML explanatory example and browser integration tests.

## Verification and acceptance criteria

- The existing standalone app still builds and behaves as before.
- The Web Component entry contains no router code and never changes the host
  URL.
- A plain HTML page renders the form, prompt picker, and contribution-text
  visualization without installing React or Mantine.
- Mantine and application styles stay inside the shadow root; host styles do
  not break controls inside it.
- Select dropdowns render in the instance's shadow-root portal node.
- Pre-generated contribution chunks load from the component deployment URL.
- The production worker loads from `workers/browser-generation.js`, including
  when the component is hosted under a nested path and when it is hosted on a
  CORS-enabled CDN.
- The worker loads tokenizer and model files from `model-base-url`, not from the
  embedding page's origin by accident.
- Worker/model failures produce contained UI errors.
- Removing the element during generation terminates its worker and aborts
  outstanding contribution-data loads.
- Two elements can run independently without sharing React roots, portal
  targets, or workers.
- Browser smoke tests cover current Chromium, Firefox, and WebKit.

## References

- Sibling worker build:
  `../site-interactive-content/packages/react-19/vite.config.ts`
- Sibling worker loader:
  `../site-interactive-content/packages/react-19/src/utils/worker.ts`
- [React `createRoot` and `root.unmount`](https://react.dev/reference/react-dom/client/createRoot)
- [MantineProvider configuration](https://mantine.dev/theming/mantine-provider/)
- [Mantine Portal target configuration](https://mantine.dev/core/portal/)
- [MDN: Using custom elements](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements)
