import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '番茄小说宽屏阅读',
    description: '非官方扩展。将番茄小说网页阅读器转换为沉浸式单栏或双栏翻页阅读。',
    version: '0.1.18',
    permissions: ['storage'],
    host_permissions: ['https://fanqienovel.com/reader/*'],
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
    action: {
      default_title: '番茄小说宽屏阅读',
    },
  },
});
