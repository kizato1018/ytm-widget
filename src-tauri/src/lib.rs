// 💡 引入建立視窗與應用程式所需的模組
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

// ==========================================
// 這裡保留你原本實作的各種指令 (Commands)
// ==========================================

#[tauri::command]
async fn execute_ytm_js(app: AppHandle, script: String) -> Result<(), String> {
    // 取得我們動態建立的 ytm-bg 視窗
    if let Some(window) = app.get_webview_window("ytm-bg") {
        if let Err(e) = window.eval(&script) {
            return Err(format!("腳本執行失敗: {}", e));
        }
    }
    Ok(())
}

#[tauri::command]
async fn download_music(url: String, path: String) -> Result<String, String> {
    // ... 保留你原本呼叫 yt-dlp 的實作內容 ...
    Ok(format!("開始下載: {} 到 {}", url, path))
}

#[tauri::command]
async fn open_folder_dialog() -> Result<(), String> {
    // ... 保留你原本的資料夾選擇器實作 ...
    Ok(())
}

// ==========================================
// Tauri 主程式啟動點
// ==========================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 註冊所有我們安裝好的插件
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        
        // 註冊給前端呼叫的 API
        .invoke_handler(tauri::generate_handler![
            execute_ytm_js, 
            download_music, 
            open_folder_dialog
        ])
        
        // 💡 核心變更：在程式初始化時動態建立 ytm-bg 視窗
        .setup(|app| {
            // 判斷作業系統，給予對應的 User-Agent
            #[cfg(target_os = "macos")]
            let user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

            #[cfg(target_os = "windows")]
            let user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

            #[cfg(target_os = "linux")]
            let user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

            // 使用 Builder 動態生成 YTM 背景視窗
            let _ytm_bg_window = WebviewWindowBuilder::new(
                app,
                "ytm-bg", // 💡 這個標籤必須是 ytm-bg，前端的 main.js 才抓得到！
                WebviewUrl::External("https://music.youtube.com".parse().unwrap())
            )
            .title("YTM Background")
            .visible(true) // 預設顯示，可讓使用者操作登入
            .user_agent(user_agent)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}