import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { parseContributionManifest } from '../data/contribution-data-source.ts';
import type { ContributionFormat } from '../generation/types.ts';

type CompiledDatasetEntry = {
  id: string;
  modelKey: string;
  modelVariant: string;
  format: ContributionFormat;
  path: string;
  manifest: ReturnType<typeof parseContributionManifest>;
};

export type CompiledDatasetManifest = {
  schemaVersion: 2;
  datasets: CompiledDatasetEntry[];
};

const FORMAT_DIRECTORIES = [
  { directory: 'contributions', format: 'layered' },
  { directory: 'summed-contributions', format: 'summed' },
] as const satisfies readonly {
  directory: string;
  format: ContributionFormat;
}[];

async function directories(root: string) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function assertDatasetFiles(
  datasetRoot: string,
  format: ContributionFormat,
  layers: number,
) {
  const files =
    format === 'summed'
      ? ['contributions.json']
      : Array.from(
          { length: layers },
          (_, layer) => `layer-${layer.toString().padStart(2, '0')}.json`,
        );
  for (const file of files) await access(path.join(datasetRoot, file));
}

export async function compileDatasetManifest(
  generatedRoot: string,
): Promise<CompiledDatasetManifest> {
  const datasets: CompiledDatasetEntry[] = [];

  for (const { directory, format } of FORMAT_DIRECTORIES) {
    const formatRoot = path.join(generatedRoot, directory);
    for (const modelKey of await directories(formatRoot)) {
      const modelRoot = path.join(formatRoot, modelKey);
      for (const modelVariant of await directories(modelRoot)) {
        const variantRoot = path.join(modelRoot, modelVariant);
        for (const id of await directories(variantRoot)) {
          const datasetRoot = path.join(variantRoot, id);
          const manifest = parseContributionManifest(
            JSON.parse(
              await readFile(path.join(datasetRoot, 'manifest.json'), 'utf8'),
            ),
          );
          if (manifest.model.dtype !== modelVariant) {
            throw new Error(
              `${datasetRoot} contains ${manifest.model.dtype} data under the ${modelVariant} variant`,
            );
          }
          await assertDatasetFiles(
            datasetRoot,
            format,
            manifest.geometry.layers,
          );
          datasets.push({
            id,
            modelKey,
            modelVariant,
            format,
            path: `${directory}/${modelKey}/${modelVariant}/${id}/`,
            manifest,
          });
        }
      }
    }
  }

  datasets.sort(
    (left, right) =>
      left.modelKey.localeCompare(right.modelKey) ||
      left.modelVariant.localeCompare(right.modelVariant) ||
      left.id.localeCompare(right.id) ||
      left.format.localeCompare(right.format),
  );
  return { schemaVersion: 2, datasets };
}

export async function writeDatasetManifest(
  generatedRoot: string,
  output = path.join(generatedRoot, 'manifest.json'),
) {
  const manifest = await compileDatasetManifest(generatedRoot);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const generatedRoot = path.resolve(process.argv[2] ?? 'generated');
  const output = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(generatedRoot, 'manifest.json');
  const manifest = await writeDatasetManifest(generatedRoot, output);
  console.log(`Wrote ${manifest.datasets.length} datasets to ${output}`);
}
