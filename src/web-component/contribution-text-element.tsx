import {
  MantineProvider,
  type MantineColorScheme,
  type MantineColorSchemeManager,
} from '@mantine/core';
import { createRoot, type Root } from 'react-dom/client';

import { ContributionTextExperience } from '../ContributionTextExperience.tsx';
import { GENERATED_DATA_BASE_URL } from '../data/dataset-catalog.ts';
import {
  BROWSER_MODEL_SOURCE,
  type BrowserModelSource,
} from '../generation/browser-config.ts';
import { PortalTargetProvider } from './portal-target.tsx';
import { contributionTextStyleSheet } from './styles.ts';
import { createDistributionWorker } from './worker-loader.ts';

const ELEMENT_NAME = 'xif-contribution-text';
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

export function defineContributionTextElement(workerUrl: URL) {
  if (customElements.get(ELEMENT_NAME)) return;

  class ContributionTextElement extends HTMLElement {
    static observedAttributes = [
      'color-scheme',
      'generated-data-base-url',
      'model-base-url',
    ];

    readonly #mountNode: HTMLDivElement;
    readonly #portalNode: HTMLDivElement;
    readonly #colorSchemeObserver: MutationObserver;
    #root: Root | undefined;

    constructor() {
      super();
      const shadowRoot = this.attachShadow({ mode: 'open' });
      shadowRoot.adoptedStyleSheets = [contributionTextStyleSheet];

      this.#mountNode = document.createElement('div');
      this.#mountNode.dataset.contributionTextRoot = '';
      this.#portalNode = document.createElement('div');
      this.#portalNode.dataset.contributionTextPortals = '';
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

    attributeChangedCallback() {
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
      const modelBaseUrl = this.getAttribute('model-base-url');
      const modelSource: BrowserModelSource = modelBaseUrl
        ? {
            type: 'local',
            baseUrl: new URL(modelBaseUrl, document.baseURI).href,
          }
        : BROWSER_MODEL_SOURCE;

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
            <ContributionTextExperience
              createWorker={() => createDistributionWorker(workerUrl)}
              embedded
              generatedDataBaseUrl={generatedDataBaseUrl}
              modelSource={modelSource}
            />
          </PortalTargetProvider>
        </MantineProvider>,
      );
    }
  }

  customElements.define(ELEMENT_NAME, ContributionTextElement);
}
