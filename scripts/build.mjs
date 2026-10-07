import * as esbuild from 'esbuild';

const alias = { '@shared': './src/shared' };

await Promise.all([
  // Main process — bundle our TypeScript, keep node_modules external
  esbuild.build({
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    outfile: 'dist/main/index.js',
    platform: 'node',
    packages: 'external',
    alias,
    sourcemap: true,
  }),
  // Preload — bundle shared/types inline, keep electron external
  esbuild.build({
    entryPoints: ['src/main/preload.ts'],
    bundle: true,
    outfile: 'dist/main/preload.js',
    platform: 'node',
    external: ['electron'],
    alias,
    sourcemap: true,
  }),
  // Renderer — bundle React + all app code into a single file
  esbuild.build({
    entryPoints: ['src/renderer/index.tsx'],
    bundle: true,
    outfile: 'dist/renderer/bundle.js',
    platform: 'browser',
    external: ['electron'],
    alias,
    sourcemap: true,
  }),
]);

console.log('Build complete.');
