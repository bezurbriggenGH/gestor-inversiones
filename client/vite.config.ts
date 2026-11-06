import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // El frontend le pide /api/... a Vite y Vite se lo pasa al backend
    proxy: { '/api': 'http://localhost:3001' },
  },
});
