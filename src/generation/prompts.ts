import {
  DEFAULT_GENERATION_SEED,
  GENERATION_TEMPERATURE,
  GENERATION_TOP_K,
  GENERATION_TOP_P,
  MAX_GENERATED_TOKENS,
  type GenerationDefaults,
} from './config.ts';
import type {
  ContributionFormat,
  PromptConfiguration,
  ValidatedPromptConfiguration,
} from './types.ts';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Keep your answers concise.';

export const prompts: PromptConfiguration[] = [
  {
    id: 'summarize-office-move',
    title: 'Office Move Summary',
    prompt: `Can you summarize the main points of this announcement in no more than two short sentences?

The Riverside team has worked from its current building for nearly six years, and many employees helped choose the furniture for the new space. Next month, the office is moving to 18 King Street. Employees should work from home on November 2 and 3 while computers and other equipment are transferred. The new office will open on November 4. Existing employee access cards will work at the new entrance, and all company phone numbers will stay the same. The kitchen will not have a coffee machine during the first week, but several cafes are located nearby.`,
    maxNewTokens: 128,
  },
  {
    id: 'extract-contact',
    title: 'Finding Contact Details',
    prompt: `Could you turn the signature in this email into a contact record? Return exactly four lines labeled Full name, Job title, Company, and Email. Copy each value exactly and do not add any other information.

Hi team,

Thanks for the productive planning session yesterday. I'll prepare the next set of dashboard mockups once the engineering feedback arrives.

Best,
Maya Chen
Product Designer
Northstar Labs
maya.chen@example.com`,
    assistantPrefix: 'Full name:',
    maxNewTokens: 64,
  },
  {
    id: 'extract-event',
    title: 'Finding Event Details',
    prompt: `What are the date, time, and location of the engineering meetup? Please give only those three details.

Several activities are planned at the community center next month. The photography club meets on Mondays, and a book exchange will run throughout the first week. The monthly engineering meetup is scheduled for September 12. It will begin at 6:30 PM in Room 204. Attendees are welcome to bring a laptop, although one is not required. Drinks will be available near the entrance, and the organizers recommend arriving a few minutes early.`,
    maxNewTokens: 64,
  },
  {
    id: 'extract-order',
    title: 'Finding Order Details',
    prompt: `Can you find the order number, ordered product, quantity, and delivery date in this update? Please answer with only those four labeled details, and do not infer any missing date information.

Thanks for visiting our store last weekend. We have finished processing your purchase, and no further payment is required. Order A-1842 contains three blue desk lamps from the Harbor collection. The matching bulbs were purchased separately and are already available for pickup. The lamps are scheduled for delivery on October 5. Our driver will send a message before arriving. Packaging can be returned to the store for recycling.`,
    maxNewTokens: 80,
  },
  {
    id: 'summarize-library-notice',
    title: 'Library Closure Summary',
    prompt: `Please summarize this notice in one sentence:

The city library is preparing for its annual autumn reading program, and registration forms are available beside the main desk. This Friday, the building will close at 5 PM so electricians can perform scheduled maintenance. It will reopen at 9 AM on Saturday. The book-return slot outside the entrance will remain open while the building is closed, and online services such as ebook borrowing and account renewals will continue to work. Saturday's children's story session will take place at its usual time. Visitors with questions can speak to a librarian before Friday afternoon.`,
    maxNewTokens: 64,
  },

  {
    id: 'summarize-customer-message',
    title: 'Customer Support Summary',
    prompt: `Summarize this customer message for a support handoff. Please answer with exactly two short labeled lines: Problem and Requested action.

I have been using the monthly plan since January and normally receive a single receipt on the first day of each month. This morning I noticed that my card was charged twice for invoice 7812. Both payments have completed, rather than appearing as pending transactions. I still use the service every day and do not want my account closed or my current subscription changed. Please refund the duplicate payment but leave the subscription active. I have kept copies of both card notifications in case you need them.`,
    maxNewTokens: 96,
  },
  {
    id: 'multiplication-place-values',
    title: 'Multiplication by Place Value',
    prompt:
      'Calculate 5726 × 37 using place values. Give a brief calculation and the final answer.',
    assistantPrefix: `5726 × 37 = 5726 × 30 + 5726 × 7
5726 × 30 = 171780
5726 × 7 = 40082
Therefore, 5726 × 37 =`,
    maxNewTokens: 48,
  },
  {
    id: 'fix-average-reference-error',
    title: 'Debugging an Average Function',
    prompt: `This JavaScript function should calculate the average of its input, but it crashes with ReferenceError: array is not defined instead. Why did it happen? Can you fix it?


function arrayAverage(numbers) {
  let total = 0;
  for (let index = 0; index < array.length; index++) {
    total += array[index];
  }
  return total / array.length;
}

console.log(arrayAverage([2, 4, 6]));
`,
    assistantPrefix: `The bug is a simple naming mismatch: the function parameter is called numbers, but the body references array`,
    maxNewTokens: 1000,
  },
];

const SAFE_PROMPT_ID = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const DEFAULT_MAX_NEW_TOKENS = 64;
const DEFAULT_CONTRIBUTION_FORMATS: ContributionFormat[] = [
  'layered',
  'summed',
];

export function validatePrompts(
  configurations: PromptConfiguration[],
  defaults: GenerationDefaults = {
    maxGeneratedTokens: MAX_GENERATED_TOKENS,
    seed: DEFAULT_GENERATION_SEED,
    temperature: GENERATION_TEMPERATURE,
    topK: GENERATION_TOP_K,
    topP: GENERATION_TOP_P,
  },
): ValidatedPromptConfiguration[] {
  if (configurations.length === 0) {
    throw new Error('At least one prompt must be configured');
  }

  const ids = new Set<string>();
  return configurations.map((configuration, index) => {
    if (!SAFE_PROMPT_ID.test(configuration.id)) {
      throw new Error(
        `Prompt ${index} has unsafe ID ${JSON.stringify(configuration.id)}`,
      );
    }
    if (ids.has(configuration.id)) {
      throw new Error(`Duplicate prompt ID: ${configuration.id}`);
    }
    ids.add(configuration.id);

    if (configuration.prompt.trim().length === 0) {
      throw new Error(`Prompt ${configuration.id} is empty`);
    }
    if (
      configuration.title !== undefined &&
      configuration.title.trim().length === 0
    ) {
      throw new Error(`Prompt ${configuration.id} has an empty title`);
    }
    if (
      configuration.systemPrompt !== undefined &&
      configuration.systemPrompt.trim().length === 0
    ) {
      throw new Error(`Prompt ${configuration.id} has an empty system prompt`);
    }
    if (
      configuration.assistantPrefix !== undefined &&
      configuration.assistantPrefix.trim().length === 0
    ) {
      throw new Error(
        `Prompt ${configuration.id} has an empty assistant prefix`,
      );
    }

    const maxNewTokens = configuration.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS;
    if (
      !Number.isSafeInteger(maxNewTokens) ||
      maxNewTokens < 1 ||
      maxNewTokens > defaults.maxGeneratedTokens
    ) {
      throw new Error(
        `Prompt ${configuration.id} maxNewTokens must be an integer from 1 to ${defaults.maxGeneratedTokens}`,
      );
    }

    const contributionFormats = configuration.contributionFormats ?? [
      ...DEFAULT_CONTRIBUTION_FORMATS,
    ];
    if (
      contributionFormats.length === 0 ||
      contributionFormats.some(
        (format) => format !== 'layered' && format !== 'summed',
      ) ||
      new Set(contributionFormats).size !== contributionFormats.length
    ) {
      throw new Error(
        `Prompt ${configuration.id} contributionFormats must contain unique layered and/or summed values`,
      );
    }

    const enableThinking = configuration.enableThinking ?? false;
    if (typeof enableThinking !== 'boolean') {
      throw new Error(
        `Prompt ${configuration.id} enableThinking must be boolean`,
      );
    }
    const seed = configuration.seed ?? defaults.seed;
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error(
        `Prompt ${configuration.id} seed must be a non-negative safe integer`,
      );
    }
    const temperature = configuration.temperature ?? defaults.temperature;
    if (!Number.isFinite(temperature) || temperature <= 0) {
      throw new Error(
        `Prompt ${configuration.id} temperature must be a positive finite number`,
      );
    }
    const topK = configuration.topK ?? defaults.topK;
    if (!Number.isSafeInteger(topK) || topK < 1) {
      throw new Error(
        `Prompt ${configuration.id} topK must be a positive safe integer`,
      );
    }
    const topP = configuration.topP ?? defaults.topP;
    if (!Number.isFinite(topP) || topP <= 0 || topP > 1) {
      throw new Error(
        `Prompt ${configuration.id} topP must be a finite number in (0, 1]`,
      );
    }

    return {
      ...configuration,
      systemPrompt: configuration.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      maxNewTokens,
      contributionFormats,
      enableThinking,
      seed,
      temperature,
      topK,
      topP,
    };
  });
}

export function selectPromptConfigurations(
  configurations: ValidatedPromptConfiguration[],
  id?: string,
  format?: ContributionFormat,
): ValidatedPromptConfiguration[] {
  const eligible =
    format === undefined
      ? configurations
      : configurations.filter((configuration) =>
          configuration.contributionFormats.includes(format),
        );
  if (id === undefined) return eligible;

  const selected = configurations.find(
    (configuration) => configuration.id === id,
  );
  if (!selected) {
    throw new Error(
      `Unknown dataset ID ${JSON.stringify(id)}. Available IDs: ${configurations.map((configuration) => configuration.id).join(', ')}`,
    );
  }
  if (format !== undefined && !selected.contributionFormats.includes(format)) {
    throw new Error(
      `Dataset ${JSON.stringify(id)} is not configured for ${format} contributions`,
    );
  }
  return [selected];
}

export function getConfiguredPromptTitle(id: string) {
  return prompts.find((configuration) => configuration.id === id)?.title;
}
