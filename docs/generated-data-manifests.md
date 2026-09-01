# Generated data manifests

Pre-generated contribution data is organized into self-contained folders for
each contribution format, model, and model variant. Every such folder contains
its own discovery manifest, so it can be copied or deployed without a separate
global manifest tree.

## Layout

```text
generated/
  contributions/<model-key>/<model-variant>/manifest.json
  contributions/<model-key>/<model-variant>/<dataset-id>/manifest.json
  contributions/<model-key>/<model-variant>/<dataset-id>/layer-00.json
  contributions/<model-key>/<model-variant>/<dataset-id>/layer-01.json
  ...
  summed-contributions/<model-key>/<model-variant>/manifest.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/manifest.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/contributions.json
```

There are two kinds of `manifest.json`:

- The manifest at the model-variant root is a discovery catalog containing all
  datasets available in that folder.
- The manifest inside a dataset folder describes that individual generation,
  including its model, tokens, geometry, and generation settings.

Catalog dataset paths are relative to the catalog's folder. For example, an
entry for `extract-contact` uses `"path": "extract-contact/"`, rather than a
path relative to `generated/`.

## Generating catalogs

Refresh all discovery manifests after generating or changing datasets:

```sh
pnpm generate:data-manifest
```

The compiler discovers datasets from the filesystem. For each format, model,
and variant folder, it:

1. Treats each child directory as a dataset ID.
2. Parses and validates the dataset's `manifest.json`.
3. Verifies that the manifest's model variant matches its containing folder.
4. Checks for every expected data file. Layered datasets require one
   `layer-XX.json` file per declared layer; summed datasets require
   `contributions.json`.
5. Orders the valid entries and writes the root `manifest.json`.

The contribution generation commands also refresh the affected catalog after a
successful batch run without `--id`. A single-dataset run leaves the catalog
unchanged, so run `pnpm generate:data-manifest` afterward when that dataset
should become discoverable immediately.

## Dataset ordering

The compiler uses `src/generation/prompts.ts` to order datasets that exist on
disk:

1. Generated datasets defined in `prompts.ts` appear first, in the same order as
   their prompt configurations.
2. Datasets found only on the filesystem follow, sorted alphabetically by ID.

The prompt configuration does not create catalog entries by itself. Configured
prompts without corresponding generated folders are omitted.

## Catalog format

Discovery catalogs currently use schema version 4. A simplified summed catalog
looks like this:

```json
{
  "schemaVersion": 4,
  "modelKey": "qwen3-0.6b",
  "modelVariant": "int8",
  "format": "summed",
  "datasets": [
    {
      "id": "extract-contact",
      "path": "extract-contact/",
      "manifest": {}
    }
  ]
}
```

The real `manifest` value is the complete validated dataset manifest rather than
the empty object shown above.

## Runtime discovery

For its configured model and variant, the app requests both catalogs:

```text
contributions/<model-key>/<model-variant>/manifest.json
summed-contributions/<model-key>/<model-variant>/manifest.json
```

The app merges entries from the catalogs that exist and resolves each dataset
path relative to the catalog URL. A missing catalog is ignored, allowing a
deployment to provide only layered or only summed data. Loading fails when
neither catalog is available or when a catalog's model, variant, or format does
not match its location.

After discovery, the app lazily fetches contribution files only for the selected
dataset.

See the [deployment guide](./deployment.md) for generated-data hosting paths and
response-header requirements.
