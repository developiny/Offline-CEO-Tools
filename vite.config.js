import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Allows opening dist/index.html from disk and deploying under subpaths.
  // Note: some browser features (module workers, camera) can still be restricted under file://.
  base: './',
  plugins: [react()],
})
