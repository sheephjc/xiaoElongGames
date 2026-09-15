import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mahjongAssets } from './mahjong-assets';

export default defineConfig({
  // 相对路径产物：可部署到任意子路径（如 GitHub Pages 的 /<repo>/），
  // 也兼容本地包在根路径托管；单人 vs AI 模式因此可纯静态托管。
  base: './',
  plugins: [react(), mahjongAssets()],
  server: {
    port: 5173,
    // 局域网设备可访问（手机/其他电脑联机测试）
    host: true,
    proxy: {
      '/api/anqi': 'http://127.0.0.1:8787',
      '/api/mahjong': 'http://127.0.0.1:8787',
      // 联机：开发时把 Socket.IO 转发到本地服务端
      '/socket.io': {
        target: 'http://127.0.0.1:8787',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
