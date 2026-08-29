import mantineCss from '@mantine/core/styles.css?inline';

import appCss from '../App.css?inline';
import indexCss from '../index.css?inline';

const hostCss = `
  :host {
    display: block;
    min-width: 0;
    color: var(--mantine-color-text);
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
