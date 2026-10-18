import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { client: 'client.tsx' },
  outDir: '../../.build/lab',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  dts: false,
  clean: false,
  deps: { alwaysBundle: [/.*/] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
