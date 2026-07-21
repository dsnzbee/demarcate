import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  // Repository Pages sites are served below /demarcate/. Keep local
  // development at / while GitHub Actions builds the Pages path.
  base: process.env.GITHUB_ACTIONS ? '/demarcate/' : '/',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
