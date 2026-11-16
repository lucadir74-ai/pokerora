// Banco di prova della grafica: l'app vera, ma con dati finti al posto del server.
// Si avvia con: node node_modules/vite/bin/vite.js --config prove-grafica/vite.prova.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const qui = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: qui('..'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^\.\/supabase$/, replacement: qui('./supabase-finto.js') },
      // Su Windows "./Chat" verrebbe confuso con chat.js (i nomi dei file non distinguono le maiuscole)
      { find: /^\.\/Chat$/, replacement: qui('../src/Chat.jsx') },
    ],
  },
  server: { port: 5199, strictPort: true, host: '127.0.0.1' },
})
