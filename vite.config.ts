import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  plugins: [react(), tailwindcss()],
  css: { preprocessorMaxWorkers: 0 },
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
})
