import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, 'src/admin'),
  base: '/admin/',
  build: {
    outDir: resolve(__dirname, 'dist/admin'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/admin/api': 'http://127.0.0.1:3100',
      '/admin/login': {
        target: 'http://127.0.0.1:3100',
        // Only relevant in dev when you click the logout button — the POST
        // goes to Express, then Express tries to redirect to /admin/login.
        // Without this proxy, Vite would refuse the request.
      },
      '/admin/logout': 'http://127.0.0.1:3100',
      '/admin/csrf-token': 'http://127.0.0.1:3100',
    },
  },
  plugins: [
    preact(),
    tailwindcss(),
  ],
});
