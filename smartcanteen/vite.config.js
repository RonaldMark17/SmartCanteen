import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import packageJson from './package.json';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiHost = env.VITE_API_HOST || '127.0.0.1';
  const apiPort = env.VITE_API_PORT || '8000';
  const apiTarget =
    env.VITE_API_PROXY_TARGET ||
    `http://${apiHost}${apiPort ? `:${apiPort}` : ''}`;

  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version || '1.1.0'),
    },
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          xfwd: true,
          ws: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
    },
  };
});
