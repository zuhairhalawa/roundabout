import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // The App Check debug token is injected by the dev server only. A build always gets ''.
  const debugToken = command === 'serve' ? env.APPCHECK_DEBUG_TOKEN || '' : '';
  return {
    plugins: [preact()],
    define: { __APPCHECK_DEBUG__: JSON.stringify(debugToken) },
    server: { port: 5196, strictPort: true, fs: { allow: ['..'] } },
    build: { target: 'es2023' },
    test: { include: ['test/**/*.test.ts'] },
  };
});
