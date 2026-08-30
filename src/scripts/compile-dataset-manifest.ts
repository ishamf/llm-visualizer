import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { parseContributionManifest } from '../data/contribution-data-source.ts';
import type { ContributionFormat } from '../generation/types.ts';

type CompiledDatasetEntry = {
  id: string;
  format: ContributionFormat;
  path: string;
  manifest: ReturnType<typeof parseContributionManifest>;
};

export type CompiledDatasetManifest = {
  schemaVersion: 3;
  modelKey: string;
  modelVariant: string;
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

export async function compileDatasetManifests(
  generatedRoot: string,
): Promise<CompiledDatasetManifest[]> {
  const variants = new Map<
    string,
    { modelKey: string; modelVariant: string }
  >();
  for (const { directory } of FORMAT_DIRECTORIES) {
    const formatRoot = path.join(generatedRoot, directory);
    for (const modelKey of await directories(formatRoot)) {
      const modelRoot = path.join(formatRoot, modelKey);
      for (const modelVariant of await directories(modelRoot)) {
        variants.set(`${modelKey}\0${modelVariant}`, {
          modelKey,
          modelVariant,
        });
      }
    }
  }

  const sortedVariants = [...variants.values()].sort(
    (left, right) =>
      left.modelKey.localeCompare(right.modelKey) ||
      left.modelVariant.localeCompare(right.modelVariant),
  );
  return Promise.all(
    sortedVariants.map(({ modelKey, modelVariant }) =>
      compileDatasetManifest(generatedRoot, modelKey, modelVariant),
    ),
  );
}

export async function compileDatasetManifest(
  generatedRoot: string,
  modelKey: string,
  modelVariant: string,
): Promise<CompiledDatasetManifest> {
  const catalog: CompiledDatasetManifest = {
    schemaVersion: 3,
    modelKey,
    modelVariant,
    datasets: [],
  };

  for (const { directory, format } of FORMAT_DIRECTORIES) {
    const variantRoot = path.join(
      generatedRoot,
      directory,
      modelKey,
      modelVariant,
    );
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
      await assertDatasetFiles(datasetRoot, format, manifest.geometry.layers);
      catalog.datasets.push({
        id,
        format,
        path: `${directory}/${modelKey}/${modelVariant}/${id}/`,
        manifest,
      });
    }
  }

  catalog.datasets.sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      left.format.localeCompare(right.format),
  );
  return catalog;
}

export async function writeDatasetManifest(
  generatedRoot: string,
  modelKey: string,
  modelVariant: string,
) {
  const manifest = await compileDatasetManifest(
    generatedRoot,
    modelKey,
    modelVariant,
  );
  await writeCompiledDatasetManifest(generatedRoot, manifest);
  return manifest;
}

async function writeCompiledDatasetManifest(
  generatedRoot: string,
  manifest: CompiledDatasetManifest,
) {
  const output = path.join(
    generatedRoot,
    'manifests',
    manifest.modelKey,
    `${manifest.modelVariant}.json`,
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function writeDatasetManifests(generatedRoot: string) {
  const manifests = await compileDatasetManifests(generatedRoot);
  await Promise.all(
    manifests.map((manifest) =>
      writeCompiledDatasetManifest(generatedRoot, manifest),
    ),
  );
  return manifests;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const generatedRoot = path.resolve(process.argv[2] ?? 'generated');
  const manifests = await writeDatasetManifests(generatedRoot);
  const datasetCount = manifests.reduce(
    (count, manifest) => count + manifest.datasets.length,
    0,
  );
  console.log(
    `Wrote ${manifests.length} manifests with ${datasetCount} datasets under ${path.join(generatedRoot, 'manifests')}`,
  );
}
