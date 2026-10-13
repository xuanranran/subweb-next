import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    vue(),
    // Keep the deployment-editable config outside the JavaScript bundle.
    {
      name: 'runtime-config',
      transformIndexHtml: {
        order: 'post',
        handler: () => [{ tag: 'script', attrs: { src: './conf/config.js' }, injectTo: 'head' }],
      },
    },
  ],
  base: './',
});
