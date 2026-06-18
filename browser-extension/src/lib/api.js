// The WebExtension API namespace, normalized across engines: Firefox exposes
// `browser` (promise-based), Chrome exposes `chrome` (callback-based, but
// promise-capable in MV3). Every other module imports `api` from here.
export const api = globalThis.browser ?? globalThis.chrome;
