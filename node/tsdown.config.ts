import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      host: 'src/host/index.ts',
      cli: 'src/cli/index.ts',
    },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'es2023',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
])
