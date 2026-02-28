import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // 1. 告訴 Vite：現在的前端根目錄是 src
  root: 'src',
  
  build: {
    // 2. 打包時，輸出的檔案要往上一層，放回專案根目錄的 dist 資料夾
    outDir: '../dist',
    emptyOutDir: true, // 打包前先清空舊資料
    
    // 3. 多頁面應用程式 (MPA) 設定：告訴 Vite 我們有兩個 HTML 進入點
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        settings: resolve(__dirname, 'src/settings.html')
      }
    }
  }
});