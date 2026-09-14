import {
  MantineProvider,
  type MantineColorScheme,
  type MantineColorSchemeManager,
} from '@mantine/core';
import { createRoot, type Root } from 'react-dom/client';

import { CodingAgentExperience } from '../CodingAgentExperience.tsx';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import { PortalTargetProvider } from './portal-target.tsx';
import { visualizerStyleSheet } from './styles.ts';

const ELEMENT_NAME = 'xif-coding-agent';
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

export function defineCodingAgentElement() {
  if (customElements.get(ELEMENT_NAME)) return;

  class CodingAgentElement extends HTMLElement {
    static observedAttributes = [
      'color-scheme',
      'generated-data-base-url',
      'session',
    ];

    readonly #mountNode: HTMLDivElement;
    readonly #portalNode: HTMLDivElement;
    readonly #colorSchemeObserver: MutationObserver;
    #root: Root | undefined;
    /**
     * Session picked in the header selector. `null` means the default first
     * session was chosen explicitly; `undefined` means no choice was made and
     * the `session` attribute (if any) decides.
     */
    #selectedSessionId: string | null | undefined;

    constructor() {
      super();
      const shadowRoot = this.attachShadow({ mode: 'open' });
      shadowRoot.adoptedStyleSheets = [visualizerStyleSheet];

      this.#mountNode = document.createElement('div');
      this.#mountNode.dataset.codingAgentRoot = '';
      this.#portalNode = document.createElement('div');
      this.#portalNode.dataset.codingAgentPortals = '';
      shadowRoot.append(this.#mountNode, this.#portalNode);

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

    attributeChangedCallback(
      name: string,
      oldValue: string | null,
      newValue: string | null,
    ) {
      // A host-driven session change overrides whatever the selector chose.
      if (name === 'session' && oldValue !== newValue) {
        this.#selectedSessionId = undefined;
      }
      if (this.isConnected) this.#render();
    }

    #syncColorScheme() {
      const colorScheme = this.getAttribute('data-mantine-color-scheme');

      for (const node of [this.#mountNode, this.#portalNode]) {
        if (colorScheme === 'light' || colorScheme === 'dark') {
          node.setAttribute('data-mantine-color-scheme', colorScheme);
        } else {
          node.removeAttribute('data-mantine-color-scheme');
        }
      }
    }

    #render() {
      const colorScheme = parseColorScheme(this.getAttribute('color-scheme'));
      const generatedDataBaseUrl = new URL(
        this.getAttribute('generated-data-base-url') ?? GENERATED_DATA_BASE_URL,
        document.baseURI,
      ).href;
      // An explicit `session` attribute deep-links a replay until the user
      // chooses another one in the header selector.
      const sessionId =
        this.#selectedSessionId === undefined
          ? this.getAttribute('session')
          : this.#selectedSessionId;

      this.#root ??= createRoot(this.#mountNode);
      this.#root.render(
        <MantineProvider
          colorSchemeManager={isolatedColorSchemeManager}
          cssVariablesSelector=":host"
          defaultColorScheme={colorScheme}
          forceColorScheme={colorScheme === 'auto' ? undefined : colorScheme}
          getRootElement={() => this}
        >
          <PortalTargetProvider target={this.#portalNode}>
            <CodingAgentExperience
              generatedDataBaseUrl={generatedDataBaseUrl}
              onSessionSelect={(id) => {
                if (this.#selectedSessionId === id) return;
                this.#selectedSessionId = id;
                this.#render();
              }}
              sessionId={sessionId}
            />
          </PortalTargetProvider>
        </MantineProvider>,
      );
    }
  }

  customElements.define(ELEMENT_NAME, CodingAgentElement);
}
