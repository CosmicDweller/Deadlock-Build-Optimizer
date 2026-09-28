import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // The learned-value and hero-meta tables are large and change only
        // when the model is retrained, so they get their own chunk rather
        // than invalidating the app bundle on every code edit.
        manualChunks(id) {
          if (id.includes('src/data/learnedValues.json')) return 'model-values'
          if (id.includes('src/data/heroMeta.json')) return 'hero-meta'
        },
      },
    },
  },
})
