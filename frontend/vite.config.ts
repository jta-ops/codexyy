import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@react-three') || id.includes('/three/') || id.includes('postprocessing')) return 'visuals'
          if (id.includes('framer-motion') || id.includes('/motion/')) return 'motion'
          if (id.includes('react-router') || id.includes('/react/') || id.includes('/react-dom/')) return 'react'
        },
      },
    },
  },
})
