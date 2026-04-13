import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const renderEntry = fileURLToPath(new URL('./src/index.js', import.meta.url))

export default defineConfig({
  build: {
    lib: {
      entry: renderEntry,
      formats: ['es'],
      fileName: () => 'emf-renderer.js'
    },
    minify: false
  },
  server: {
    host: '127.0.0.1',
    port: 4173
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
})
