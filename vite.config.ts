import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves the site under /<repo>/ — the deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ? `${process.env.BASE_PATH.replace(/\/$/, '')}/` : '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
