// Which build is serving this page: what vite.config.js stamped into the HTML, and the channel.
const meta = (name) => (typeof document === 'undefined' ? null
  : document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || null);

export const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;
export const APP_CHANNEL = typeof __APP_CHANNEL__ === 'undefined' ? 'prod' : __APP_CHANNEL__;
// 'local' when there is no stamp (tests, an unstamped build).
export const BUILD_COMMIT = meta('build-commit');
// "Magenta Starling": named from the tree, so dev and the prod it ships as share it.
export const BUILD_NAME = meta('build-name') || (BUILD_COMMIT || 'local').slice(0, 7);
