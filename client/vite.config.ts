import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    // El frontend le pide /api/... a Vite y Vite se lo pasa al backend
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3001' },
  },
});
