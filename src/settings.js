import { open } from '@tauri-apps/plugin-dialog';
import { downloadDir } from '@tauri-apps/api/path'; // 💡 引入系統路徑 API

const pathInput = document.getElementById('download-path-input');
const browseBtn = document.getElementById('browse-btn');

// 💡 1. 初始化：改為動態獲取跨平台預設路徑
async function initPath() {
  let savedPath = localStorage.getItem('download_path');
  if (!savedPath) {
    // 如果沒有儲存過，就呼叫系統 API 取得對應 OS 的「下載」資料夾
    savedPath = await downloadDir(); 
    localStorage.setItem('download_path', savedPath);
  }
  pathInput.value = savedPath;
}
initPath();

const selectFolder = async () => {
  const selected = await open({
    directory: true,
    multiple: false,
  });

  if (selected) {
    console.log('Selected folder path:', selected);
    pathInput.value = selected;
    localStorage.setItem('download_path', selected);
  }
};

browseBtn.addEventListener('click', selectFolder);