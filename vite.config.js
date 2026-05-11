import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
  },
  // 告诉 Vite 不要打包这个模块，由 Tauri WebView 运行时提供
  optimizeDeps: {
    exclude: ['@tauri-apps/api'],
  },
})