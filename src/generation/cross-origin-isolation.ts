/**
 * Multi-threaded inference in the generation worker (ONNX Runtime Web via
 * Transformers.js) needs `SharedArrayBuffer`, which browsers only expose to
 * cross-origin isolated documents. See:
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
 *
 * A document is cross-origin isolated when it is served with
 * `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
 * require-corp` (or `credentialless`) in a secure context. The standalone site
 * sets these headers itself; when embedded as a web component, the host page
 * must set them.
 *
 * Returns false when the property is missing (older browsers) since the
 * `SharedArrayBuffer` constructor is hidden there too.
 */
export function isCrossOriginIsolated(): boolean {
  return globalThis.crossOriginIsolated === true;
}
