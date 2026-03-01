import { open } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path';
// 💡 引入 autostart 系統 API
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { emit } from '@tauri-apps/api/event'; // 💡 引入跨視窗通訊

// --- 深色模式邏輯 ---
const themeCheckbox = document.getElementById('dark-mode-checkbox');

// 1. 讀取並顯示當前狀態 (預設是 light)
const currentTheme = localStorage.getItem('ytm_theme') || 'dark'; // 💡 預設改為 dark
const pathInput = document.getElementById('download-path-input');
const browseBtn = document.getElementById('browse-btn');
const autostartCheckbox = document.getElementById('autostart-checkbox');
themeCheckbox.checked = currentTheme === 'dark';

// 2. 監聽切換事件
themeCheckbox.addEventListener('change', async (e) => {
    const newTheme = e.target.checked ? 'dark' : 'light';
    
    // 改變設定視窗自己的外觀
    document.documentElement.setAttribute('data-theme', newTheme);
    // 儲存設定
    localStorage.setItem('ytm_theme', newTheme);
    
    // 💡 廣播給其他視窗 (包含 Widget 主視窗)
    await emit('theme_changed', newTheme);
});

// --- 下載路徑邏輯 ---
async function initPath() {
  let savedPath = localStorage.getItem('download_path');
  if (!savedPath) {
    savedPath = await downloadDir(); 
    localStorage.setItem('download_path', savedPath);
  }
  pathInput.value = savedPath;
}
initPath();

const selectFolder = async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected) {
    pathInput.value = selected;
    localStorage.setItem('download_path', selected);
  }
};
browseBtn.addEventListener('click', selectFolder);


// --- 開機自動啟動邏輯 ---
async function initAutostart() {
  // 1. 檢查作業系統目前的真實狀態
  const currentlyEnabled = await isEnabled();
  
  // 2. 如果是使用者第一次開啟這個 Widget (沒有我們存過的標記)
  if (localStorage.getItem('autostart_initialized') === null) {
      // 💡 強制開啟自動啟動，符合你要求的「預設開啟」
      await enable();
      autostartCheckbox.checked = true;
      localStorage.setItem('autostart_initialized', 'true');
  } else {
      // 否則，就依照作業系統的真實狀態來顯示打勾與否
      autostartCheckbox.checked = currentlyEnabled;
  }
}
initAutostart();

// 3. 監聽勾選動作，並直接向系統註冊/取消註冊
autostartCheckbox.addEventListener('change', async (e) => {
  try {
      if (e.target.checked) {
          await enable();
          console.log("已啟用開機自動啟動");
      } else {
          await disable();
          console.log("已停用開機自動啟動");
      }
  } catch (error) {
      console.error("切換開機啟動失敗:", error);
      // 如果系統權限拒絕，把勾選框恢復原狀
      e.target.checked = !e.target.checked; 
  }
});