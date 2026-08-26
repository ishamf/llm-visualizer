import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function pathExists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function assertDatasetDestinationAvailable(
  outputRoot: string,
  datasetId: string,
  overwrite: boolean,
) {
  const destination = path.join(outputRoot, datasetId);
  if (!overwrite && (await pathExists(destination))) {
    throw new Error(
      `Dataset destination already exists: ${destination} (use --overwrite to replace it)`,
    );
  }
}

export async function writeDatasetAtomically(
  outputRoot: string,
  datasetId: string,
  overwrite: boolean,
  stage: (directory: string) => Promise<void>,
  validate: (directory: string) => Promise<void>,
) {
  await mkdir(outputRoot, { recursive: true });
  const destination = path.join(outputRoot, datasetId);
  await assertDatasetDestinationAvailable(outputRoot, datasetId, overwrite);

  const temporary = await mkdtemp(path.join(outputRoot, `.${datasetId}.tmp-`));
  let backup: string | undefined;
  try {
    await stage(temporary);
    await validate(temporary);

    if (await pathExists(destination)) {
      backup = `${destination}.backup-${randomUUID()}`;
      await rename(destination, backup);
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (backup) await rename(backup, destination);
      throw error;
    }
    if (backup) await rm(backup, { recursive: true });
    return destination;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
