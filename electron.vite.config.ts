import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    entry: 'src/main/main.ts',
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    input: {
      preload: resolve(process.cwd(), 'src/preload/preload.ts')
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(process.cwd(), 'src/renderer/overlay.html')
        }
      }
    }
  }
})
