import mantineCss from '@mantine/core/styles.css?inline';

import indexCss from '../index.css?inline';

// Collects every co-located component stylesheet (e.g. ContributionText.module.css)
// for injection into the shadow root. `query: '?inline'` yields the raw CSS string
// for each module; the hashed classnames inside match the ones the components
// import from the same files at runtime.
const moduleCss = import.meta.glob<string>('../**/*.module.css', {
  query: '?inline',
  import: 'default',
  eager: true,
});
const appCss = Object.values(moduleCss).join('\n');

const hostCss = `
  :host {
    display: block;
    min-width: 0;
    padding: clamp(1rem, 2.5vw, 2rem);
    overflow: hidden;
    border-radius: var(--mantine-radius-xl);
    color: var(--mantine-color-text);
    background: var(--mantine-color-body);
    font-family: var(--mantine-font-family);
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :host, :host * {
    box-sizing: border-box;
  }

  /* The card's own padding provides the inset, so a Mantine Container's
     document-level inline padding would stack on top of it and make the
     horizontal padding larger than the vertical one. */
  :host .mantine-Container-root {
    padding-inline: 0;
  }
`;

export const visualizerStyleSheet = new CSSStyleSheet();
visualizerStyleSheet.replaceSync(
  [mantineCss, indexCss, appCss, hostCss].join('\n'),
);
