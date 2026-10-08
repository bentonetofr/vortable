import { defineConfig } from 'vite'

// Build de biblioteca: o Vorterium importa o motor pronto (JS + CSS + tipos).
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    lib: { entry: 'src/engine/index.ts', formats: ['es'], fileName: () => 'vortable.js', cssFileName: 'vortable' },
  },
})
