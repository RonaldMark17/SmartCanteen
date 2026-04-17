import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiHost = env.VITE_API_HOST || '127.0.0.1';
  const apiPort = env.VITE_API_PORT || '8000';
  const apiTarget =
    env.VITE_API_PROXY_TARGET ||
    `http://${apiHost}${apiPort ? `:${apiPort}` : ''}`;

  return {
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
