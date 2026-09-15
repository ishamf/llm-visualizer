import {
  MantineProvider,
  type MantineColorScheme,
  type MantineColorSchemeManager,
} from '@mantine/core';
import { createRoot, type Root } from 'react-dom/client';

import { RequestCostExperience } from '../RequestCostExperience.tsx';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { visualizerStyleSheet } from './styles.ts';

const ELEMENT_NAME = 'xif-request-cost';
/** Session charted when the `session` attribute is absent. */
const DEFAULT_SESSION_ID = 'coding-agent';
const isolatedColorSchemeManager: MantineColorSchemeManager = {
  get: (defaultValue) => defaultValue,
  set: () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  clear: () => undefined,
};

function parseColorScheme(value: string | null): MantineColorScheme {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function defineRequestCostElement() {
  if (customElements.get(ELEMENT_NAME)) return;

  class RequestCostElement extends HTMLElement {
    static observedAttributes = [
      'color-scheme',
      'generated-data-base-url',
      'session',
    ];

    readonly #mountNode: HTMLDivElement;
    readonly #colorSchemeObserver: MutationObserver;
    #root: Root | undefined;

    constructor() {
      super();
      const shadowRoot = this.attachShadow({ mode: 'open' });
      shadowRoot.adoptedStyleSheets = [visualizerStyleSheet];

      this.#mountNode = document.createElement('div');
      this.#mountNode.dataset.requestCostRoot = '';
      shadowRoot.append(this.#mountNode);

      this.#colorSchemeObserver = new MutationObserver(() => {
        this.#syncColorScheme();
      });
    }

    connectedCallback() {
      this.#colorSchemeObserver.observe(this, {
        attributeFilter: ['data-mantine-color-scheme'],
      });
      this.#syncColorScheme();
      this.#render();
    }

    disconnectedCallback() {
      this.#colorSchemeObserver.disconnect();
      this.#root?.unmount();
      this.#root = undefined;
    }

    attributeChangedCallback() {
      if (this.isConnected) this.#render();
    }

    #syncColorScheme() {
      const colorScheme = this.getAttribute('data-mantine-color-scheme');

      if (colorScheme === 'light' || colorScheme === 'dark') {
        this.#mountNode.setAttribute('data-mantine-color-scheme', colorScheme);
      } else {
        this.#mountNode.removeAttribute('data-mantine-color-scheme');
      }
    }

    #render() {
      const colorScheme = parseColorScheme(this.getAttribute('color-scheme'));
      const generatedDataBaseUrl = new URL(
        this.getAttribute('generated-data-base-url') ?? GENERATED_DATA_BASE_URL,
        document.baseURI,
      ).href;
      const sessionId = this.getAttribute('session') ?? DEFAULT_SESSION_ID;

      this.#root ??= createRoot(this.#mountNode);
      this.#root.render(
        <MantineProvider
          colorSchemeManager={isolatedColorSchemeManager}
          cssVariablesSelector=":host"
          defaultColorScheme={colorScheme}
          forceColorScheme={colorScheme === 'auto' ? undefined : colorScheme}
          getRootElement={() => this}
        >
          <RequestCostExperience
            generatedDataBaseUrl={generatedDataBaseUrl}
            sessionId={sessionId}
            showDescription={false}
          />
        </MantineProvider>,
      );
    }
  }

  customElements.define(ELEMENT_NAME, RequestCostElement);
}
