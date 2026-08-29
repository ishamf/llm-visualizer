export function createDistributionWorker(workerUrl: URL) {
  const bootstrap = new Blob([`import ${JSON.stringify(workerUrl.href)};`], {
    type: 'text/javascript',
  });
  const bootstrapUrl = URL.createObjectURL(bootstrap);
  const worker = new Worker(bootstrapUrl, { type: 'module' });
  URL.revokeObjectURL(bootstrapUrl);
  return worker;
}
