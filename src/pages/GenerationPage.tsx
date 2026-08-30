import {
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Progress,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

import {
  BROWSER_MODEL_SIZE_BYTES,
  getBrowserModelUrls,
  type BrowserModelSource,
} from '../generation/browser-config.ts';
import {
  DEFAULT_GENERATION_SEED,
  GENERATION_TEMPERATURE,
  GENERATION_TOP_K,
  GENERATION_TOP_P,
  MAX_GENERATED_TOKENS,
} from '../generation/config.ts';
import type {
  BrowserGenerationPrompt,
  BrowserGenerationRequest,
  BrowserGenerationResponse,
} from '../generation/browser-generation-protocol.ts';
import { DEFAULT_SYSTEM_PROMPT } from '../generation/prompts.ts';
import type {
  ContributionManifest,
  SummedContributions,
} from '../generation/types.ts';

type RunStatus =
  | 'idle'
  | 'loading-model'
  | 'generating'
  | 'cancelling'
  | 'complete'
  | 'cancelled'
  | 'error';

type ModelProgress = {
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
};

export type GenerationResult = {
  manifest: ContributionManifest;
  contributions: SummedContributions;
};

type BrowserGenerationPanelProps = {
  createWorker: () => Worker;
  modelSource: BrowserModelSource;
  onGenerationStarted: () => void;
  onResultChange: (result: GenerationResult | undefined) => void;
  onGenerationActiveChange: (active: boolean) => void;
};

const DEFAULT_MAX_NEW_TOKENS = 128;

function numberValue(value: string | number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes < 1) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function BrowserGenerationPanel({
  createWorker,
  modelSource,
  onGenerationStarted,
  onResultChange,
  onGenerationActiveChange,
}: BrowserGenerationPanelProps) {
  const workerRef = useRef<Worker | null>(null);
  const resultRef = useRef<GenerationResult | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [assistantPrefix, setAssistantPrefix] = useState('');
  const [maxNewTokens, setMaxNewTokens] = useState(DEFAULT_MAX_NEW_TOKENS);
  const [temperature, setTemperature] = useState(GENERATION_TEMPERATURE);
  const [topK, setTopK] = useState(GENERATION_TOP_K);
  const [topP, setTopP] = useState(GENERATION_TOP_P);
  const [seed, setSeed] = useState(DEFAULT_GENERATION_SEED);
  const [enableThinking, setEnableThinking] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [error, setError] = useState<Error>();
  const [modelProgress, setModelProgress] = useState<ModelProgress>({});
  const [result, setResult] = useState<GenerationResult>();
  const [modelCached, setModelCached] = useState<boolean>();

  const isBusy =
    status === 'loading-model' ||
    status === 'generating' ||
    status === 'cancelling';
  const canSubmit = prompt.trim().length > 0 && !isBusy;
  const generatedTokenCount = result
    ? result.manifest.tokens.length - result.manifest.promptTokenCount
    : 0;

  useEffect(() => {
    onGenerationActiveChange(isBusy);
  }, [isBusy, onGenerationActiveChange]);

  useEffect(() => {
    let active = true;
    const modelUrls = getBrowserModelUrls(modelSource, document.baseURI);
    const inspectModelCache = async () => {
      if (!('caches' in globalThis)) {
        if (active) setModelCached(false);
        return;
      }
      try {
        const cached = await globalThis.caches.match(modelUrls.weights);
        if (active) setModelCached(Boolean(cached));
      } catch {
        if (active) setModelCached(false);
      }
    };
    void inspectModelCache();

    return () => {
      active = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [modelSource]);

  const progressValue =
    status === 'generating'
      ? Math.min(100, (generatedTokenCount / maxNewTokens) * 100)
      : Math.min(100, Math.max(0, modelProgress.progress ?? 0));

  const publishResult = (next: GenerationResult | undefined) => {
    resultRef.current = next;
    setResult(next);
    onResultChange(next);
  };

  const handleWorkerResponse = (
    worker: Worker,
    response: BrowserGenerationResponse,
  ) => {
    if (workerRef.current !== worker) return;
    switch (response.type) {
      case 'status':
        setStatus(response.status);
        if (response.status === 'generating') setModelCached(true);
        break;
      case 'model-progress':
        setModelProgress((current) => ({
          ...current,
          file: response.file ?? current.file,
          ...(response.progress === undefined
            ? {}
            : { progress: response.progress }),
          ...(response.loaded === undefined ? {} : { loaded: response.loaded }),
          ...(response.total === undefined ? {} : { total: response.total }),
        }));
        break;
      case 'prompt-ready':
        publishResult({
          manifest: response.manifest,
          contributions: response.contributions,
        });
        break;
      case 'generation-step': {
        if (!resultRef.current) break;
        const rows = [...resultRef.current.contributions.rows];
        rows[response.rowIndex] = response.row;
        publishResult({
          manifest: {
            ...resultRef.current.manifest,
            generatedText: response.generatedText,
            tokens: [...resultRef.current.manifest.tokens, response.token],
          },
          contributions: { ...resultRef.current.contributions, rows },
        });
        break;
      }
      case 'complete':
        publishResult({
          manifest: response.manifest,
          contributions: response.contributions,
        });
        break;
      case 'error':
        setError(new Error(response.message));
        setStatus('error');
        break;
    }
  };

  const startGeneration = () => {
    if (!canSubmit) return;
    onGenerationStarted();
    let worker = workerRef.current;
    if (!worker) {
      let createdWorker: Worker;
      try {
        createdWorker = createWorker();
      } catch (workerError) {
        setError(
          workerError instanceof Error
            ? workerError
            : new Error(String(workerError)),
        );
        setStatus('error');
        return;
      }
      worker = createdWorker;
      workerRef.current = createdWorker;
      createdWorker.onmessage = (
        event: MessageEvent<BrowserGenerationResponse>,
      ) => handleWorkerResponse(createdWorker, event.data);
      createdWorker.onerror = (event) => {
        if (workerRef.current !== createdWorker) return;
        workerRef.current = null;
        setError(new Error(event.message || 'The generation worker stopped'));
        setStatus('error');
      };
    }
    setStatus('loading-model');
    setError(undefined);
    publishResult(undefined);
    setModelProgress({});

    const values: BrowserGenerationPrompt = {
      prompt: prompt.trim(),
      ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
      ...(assistantPrefix ? { assistantPrefix } : {}),
      maxNewTokens,
      enableThinking,
      seed,
      temperature,
      topK,
      topP,
    };
    const request: BrowserGenerationRequest = {
      type: 'start',
      prompt: values,
      modelSource:
        modelSource.type === 'local'
          ? {
              type: 'local',
              baseUrl: getBrowserModelUrls(modelSource, document.baseURI).root,
            }
          : modelSource,
    };
    worker.postMessage(request);
  };

  const cancelGeneration = () => {
    if (!workerRef.current || !isBusy) return;
    setStatus('cancelling');
    workerRef.current.postMessage({
      type: 'cancel',
    } satisfies BrowserGenerationRequest);
  };

  return (
    <section className="browser-generation" aria-labelledby="generate-title">
      <header className="browser-generation-header">
        <div>
          <Text className="eyebrow">Or try your own prompt</Text>
          <Title order={2} id="generate-title">
            Generate in your browser
          </Title>
          <Text c="dimmed" size="sm">
            Nothing is sent to a server.
          </Text>
        </div>
        <Badge variant="outline">Qwen3 0.6B · INT8</Badge>
      </header>

      {modelCached === false && (
        <Alert
          className="model-download-note"
          color="violet"
          title="First run downloads the model"
        >
          Starting generation automatically downloads the instrumented model
          (about {formatBytes(BROWSER_MODEL_SIZE_BYTES)}) into this browser’s
          cache. The download happens only once per browser cache.
        </Alert>
      )}

      <Paper
        className="selector-card generation-form"
        withBorder
        radius="lg"
        p="xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startGeneration();
          }}
        >
          <Stack gap="lg">
            <Textarea
              label="Prompt"
              description="Ask the local model anything. Nothing is sent to a server."
              placeholder="Explain why the sky appears blue."
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              minRows={5}
              autosize
              maxRows={12}
              required
            />

            <Button
              type="button"
              variant="subtle"
              className="advanced-options-toggle"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? '⌃ Hide advanced options' : '⌄ Advanced options'}
            </Button>

            <Collapse expanded={advancedOpen}>
              <div className="generation-advanced-options">
                <Textarea
                  label="System prompt"
                  placeholder="You are a helpful assistant."
                  value={systemPrompt}
                  onChange={(event) =>
                    setSystemPrompt(event.currentTarget.value)
                  }
                  minRows={2}
                />
                <Textarea
                  label="Assistant prefix"
                  description="Optional text to place immediately before generation."
                  value={assistantPrefix}
                  onChange={(event) =>
                    setAssistantPrefix(event.currentTarget.value)
                  }
                  minRows={2}
                />
                <div className="generation-number-grid">
                  <NumberInput
                    label="Max new tokens"
                    value={maxNewTokens}
                    onChange={(value) =>
                      setMaxNewTokens(
                        Math.min(
                          MAX_GENERATED_TOKENS,
                          Math.max(
                            1,
                            Math.round(
                              numberValue(value, DEFAULT_MAX_NEW_TOKENS),
                            ),
                          ),
                        ),
                      )
                    }
                    min={1}
                    max={MAX_GENERATED_TOKENS}
                    step={1}
                  />
                  <NumberInput
                    label="Temperature"
                    value={temperature}
                    onChange={(value) =>
                      setTemperature(
                        Math.min(
                          2,
                          Math.max(
                            0.01,
                            numberValue(value, GENERATION_TEMPERATURE),
                          ),
                        ),
                      )
                    }
                    min={0.01}
                    max={2}
                    step={0.05}
                    decimalScale={2}
                  />
                  <NumberInput
                    label="Top K"
                    value={topK}
                    onChange={(value) =>
                      setTopK(
                        Math.max(
                          1,
                          Math.round(numberValue(value, GENERATION_TOP_K)),
                        ),
                      )
                    }
                    min={1}
                    step={1}
                  />
                  <NumberInput
                    label="Top P"
                    value={topP}
                    onChange={(value) =>
                      setTopP(
                        Math.min(
                          1,
                          Math.max(0.01, numberValue(value, GENERATION_TOP_P)),
                        ),
                      )
                    }
                    min={0.01}
                    max={1}
                    step={0.05}
                    decimalScale={2}
                  />
                  <NumberInput
                    label="Seed"
                    value={seed}
                    onChange={(value) =>
                      setSeed(
                        Math.max(
                          0,
                          Math.round(
                            numberValue(value, DEFAULT_GENERATION_SEED),
                          ),
                        ),
                      )
                    }
                    min={0}
                    step={1}
                  />
                </div>
                <Switch
                  label="Enable thinking"
                  description="Include Qwen3's reasoning phase in the generated stream."
                  checked={enableThinking}
                  onChange={(event) =>
                    setEnableThinking(event.currentTarget.checked)
                  }
                />
              </div>
            </Collapse>

            <Group justify="flex-end">
              {isBusy && (
                <Button
                  type="button"
                  variant="light"
                  color="red"
                  onClick={cancelGeneration}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={!canSubmit} loading={isBusy}>
                {isBusy ? 'Generating…' : 'Generate contributions'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      {status !== 'idle' && (
        <Paper className="generation-status" withBorder radius="lg" p="lg">
          <Group justify="space-between" align="flex-start" mb="xs">
            <div>
              <Text fw={700}>
                {status === 'loading-model'
                  ? 'Preparing the model'
                  : status === 'generating'
                    ? 'Generating and measuring contributions'
                    : status === 'cancelling'
                      ? 'Cancelling generation'
                      : status === 'complete'
                        ? 'Generation complete'
                        : status === 'cancelled'
                          ? 'Generation cancelled'
                          : 'Generation failed'}
              </Text>
              <Text size="sm" c="dimmed">
                {status === 'loading-model'
                  ? `Downloaded ${formatBytes(modelProgress.loaded)}${modelProgress.total ? ` of ${formatBytes(modelProgress.total)}` : ''}`
                  : status === 'generating'
                    ? `${generatedTokenCount} of ${maxNewTokens} tokens`
                    : status === 'cancelling'
                      ? 'Finishing the current model step…'
                      : status === 'cancelled'
                        ? 'Generation cancelled.'
                        : ''}
              </Text>
            </div>
            <Badge
              color={
                status === 'error'
                  ? 'red'
                  : status === 'complete'
                    ? 'teal'
                    : status === 'cancelled'
                      ? 'gray'
                      : 'violet'
              }
              variant="light"
            >
              {status}
            </Badge>
          </Group>
          {(status === 'loading-model' || status === 'generating') && (
            <Progress
              value={progressValue}
              animated={status === 'loading-model'}
            />
          )}
          {status === 'loading-model' && modelProgress.file && (
            <Text size="xs" c="dimmed" mt="xs">
              Loading {modelProgress.file}
            </Text>
          )}
        </Paper>
      )}

      {error && (
        <Alert color="red" title="Generation could not start">
          {error.message}
        </Alert>
      )}
    </section>
  );
}
