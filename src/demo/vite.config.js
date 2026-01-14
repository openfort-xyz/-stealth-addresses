import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
    },
  },
  server: {
    fs: {
      allow: [rootDir],
    },
  },
  optimizeDeps: {
    include: ['viem', '@noble/curves', '@noble/hashes'],
  },
});
