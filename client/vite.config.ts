import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    // El frontend le pide /api/... a Vite y Vite se lo pasa al backend
    // 127.0.0.1 y no "localhost": el backend escucha solo en IPv4 de esta compu (ver server/src/index.ts)
    proxy: { '/api': process.env.API_URL ?? 'http://127.0.0.1:3001' },
  },
});
