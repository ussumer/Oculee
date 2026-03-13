import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'src/main/main.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          preload: resolve(process.cwd(), 'src/preload/preload.ts')
        }
      }
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
