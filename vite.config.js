import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import names from './src/buildNames.json' with { type: 'json' };

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

const git = (args) => {
  try { return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
};
// The commit this build is of, so a served copy can be checked against the repo. CI sets
// GITHUB_SHA; a Docker context has no .git and passes BUILD_COMMIT.
const buildCommit = () => process.env.BUILD_COMMIT || process.env.GITHUB_SHA || git('rev-parse HEAD');
// The tree (the files): a "Ship dev" merge makes a new commit but keeps dev's tree, so the build
// name stays the same from dev to prod. The same scheme as PS&R.
const buildTree = () => process.env.BUILD_TREE || git('rev-parse HEAD^{tree}');
// Adjective or colour + animal from the tree's first two bytes: 4,096 names, so a repeat is rare.
// Stamped, not worked out in the app, so anything that fetches index.html (autodeploy) reads it.
export function buildName(tree) {
  if (!/^[0-9a-f]{4}/.test(tree)) return '';
  return `${names.adjectives[parseInt(tree.slice(0, 2), 16) % 64]} ${names.animals[parseInt(tree.slice(2, 4), 16) % 64]}`;
}

const stamp = {
  name: 'stamp-build',
  transformIndexHtml: () => {
    const tree = buildTree();
    return [['build-commit', buildCommit()], ['build-tree', tree], ['build-name', buildName(tree)]]
      .map(([name, content]) => ({ tag: 'meta', attrs: { name, content }, injectTo: 'head' }));
  },
};

export default defineConfig({
  plugins: [react(), stamp],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // 'dev' for the build that serves the dev branch (APP_CHANNEL=dev); every other build is 'prod'.
    __APP_CHANNEL__: JSON.stringify(process.env.APP_CHANNEL || 'prod'),
  },
  base: './',
  build: {
    rollupOptions: {
      // Three entries, one build. `base: './'` keeps every asset path relative,
      // so all three sit in one Pages artifact with no base-path juggling.
      //   /          the driver tool, standalone drop-two-CSVs page
      //   /api/      the driver tool, embed target for DJ 101681
      //   /lcp/api/  the LCP tool, embed target for DJ 101698 - its ONLY entry
      input: {
        main: 'index.html',
        embed: 'api/index.html',
        lcp: 'lcp/api/index.html',
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
