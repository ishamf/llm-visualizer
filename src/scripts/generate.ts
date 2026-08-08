import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  env,
  pipeline,
  TextStreamer,
  type Message,
} from '@huggingface/transformers';

const MODEL_ID = 'Qwen3-0.6B-ONNX';
const MODEL_ROOT = fileURLToPath(new URL('../../models/', import.meta.url));
const prompt = process.argv.slice(2).join(' ').trim();

env.localModelPath = MODEL_ROOT;
env.allowRemoteModels = false;

if (!prompt) {
  console.error('Usage: pnpm generate "Your prompt"');
  process.exitCode = 1;
} else {
  console.error(`Loading ${MODEL_ID} from ${MODEL_ROOT}...`);

  const generator = await pipeline('text-generation', MODEL_ID, {
    // Try the smaller 4-bit model with float16 computation on the CPU backend.
    dtype: 'q4f16',
    local_files_only: true,
    model_file_name: 'instrumented',
  });

  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: prompt },
  ];

  try {
    await generator(messages, {
      max_new_tokens: 256,
      do_sample: false,
      tokenizer_encode_kwargs: { enable_thinking: false },
      streamer: new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
      }),
    });
  } finally {
    await generator.dispose();
  }
}
