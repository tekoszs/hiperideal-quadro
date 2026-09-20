import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    // `node` continua sendo o padrão (rápido). Os testes que precisam de DOM de
    // verdade — digitação em campo controlado — pedem jsdom no próprio arquivo,
    // com o comentário `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
    globals: false,
  },
});
