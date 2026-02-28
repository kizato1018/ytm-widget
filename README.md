# YTM Widget 🎵

一個輕量、極簡且無廣告的 YouTube Music 桌面懸浮小工具。
支援背景播放、無縫阻擋廣告，以及一鍵下載高音質單曲功能。

## 📥 安裝指南

請至 [Releases](../../releases) 頁面下載符合您作業系統的安裝檔。

### 🪟 Windows
下載 `.msi` 或 `.exe` 檔案，雙擊執行即可完成安裝。

### 🍎 macOS (Apple Silicon / Intel)
1. 下載 `.dmg` 檔案，打開後將 `YTM Widget.app` 拖曳至 **應用程式 (Applications)** 資料夾。
2. **【重要】解除系統安全限制**
   由於本軟體為開源免費發布（未經 Apple 付費開發者簽章），macOS 會預設阻擋執行並顯示「檔案已損壞」。
   請打開 **終端機 (Terminal)**，複製貼上以下指令並按下 Enter（執行時需輸入 Mac 開機密碼）：
   
   ```bash
   sudo xattr -rd com.apple.quarantine "/Applications/YTM Widget.app"
   ```
   
3. 執行完畢後，即可至應用程式中正常點擊開啟。

### 🐧 Linux
- **.AppImage (免安裝版)**：下載後，右鍵點擊檔案 -> 內容 -> 權限，勾選「允許作為程式執行」（或在終端機執行 `chmod +x 檔案名.AppImage`），接著雙擊即可開啟。
- **.deb (安裝版)**：適用於 Ubuntu/Debian 系統，下載後雙擊透過軟體中心安裝，或在終端機輸入 `sudo dpkg -i 檔案名.deb`。

## ✨ 核心特色
- **零廣告干擾**：內建原生事件驅動特務，瞬間跳過所有影音廣告。
- **純粹背景執行**：化身系統列 (Tray) 小工具，乾淨不佔用 Dock 空間。
- **一鍵下載音樂**：內建 yt-dlp 引擎，輕鬆將當前播放單曲儲存為高音質原聲檔。