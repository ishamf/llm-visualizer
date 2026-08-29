import mantineCss from '@mantine/core/styles.css?inline';

import appCss from '../App.css?inline';
import indexCss from '../index.css?inline';

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
`;

export const contributionTextStyleSheet = new CSSStyleSheet();
contributionTextStyleSheet.replaceSync(
  [mantineCss, indexCss, appCss, hostCss].join('\n'),
);
