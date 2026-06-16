import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const npmPackageVersion = (globalThis as { process?: { env?: { npm_package_version?: string } } })
  .process?.env?.npm_package_version

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(npmPackageVersion ?? '0.0.0-dev'),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router-dom')
          ) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/antd') || id.includes('node_modules/@ant-design')) {
            return 'vendor-antd'
          }
        },
      },
    },
  },
})
