import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: { port: 5180 },
  // o Phaser sozinho tem ~1,2 MB; o aviso padrão (500 kB) não ajuda aqui
  build: { chunkSizeWarningLimit: 1600 },
})
