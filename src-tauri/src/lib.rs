// 💡 關鍵修正：引入 Manager 特徵，解鎖 AppHandle 的視窗控制能力
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
// use tauri_plugin_dialog::DialogExt; // 💡 引入對話框插件

// #[tauri::command]
// async fn open_folder_dialog(app: tauri::AppHandle) -> Result<String, String> {
//     // 💡 呼叫系統原生選擇資料夾對話框
//     let folder = app.dialog()
//         .file()
//         .pick_folder();

//     if let Some(path) = folder {
//         Ok(path.to_string())
//     } else {
//         Err("取消選擇".into())
//     }
// }

#[tauri::command]
async fn download_music(app: tauri::AppHandle, url: String, path: String) -> Result<String, String> {
    let sidecar_command = app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?
        .args([
            "-x", 
            "--audio-format", "mp3", 
            "--no-playlist",
            "--audio-quality", "0",
            "-o", &format!("{}/%(title)s.%(ext)s", path),
            &url
        ]);

    let (mut rx, _child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line) = event {
            println!("下載進度: {:?}", String::from_utf8(line));
        }
    }
    Ok("下載完成".into())
}

#[tauri::command]
fn execute_ytm_js(app: tauri::AppHandle, script: String) {
    // 透過 Rust 取得背景視窗，並強行注入 JS 執行
    if let Some(webview) = app.get_webview_window("ytm-bg") {
        let _ = webview.eval(&script);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // 當有第二個實例啟動時，這裡會被呼叫
            println!("第二個實例啟動了！參數: {:?}, 工作目錄: {:?}", args, cwd);
            // 你可以在這裡做一些處理，例如將參數傳給第一個實例
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show(); // 顯示視窗
                let _ = w.unminimize(); // 如果縮小了就恢復
                let _ = w.set_focus(); // 抓取焦點到最前方
            });
        }))
        .plugin(tauri_plugin_process::init())
        // 註冊我們剛寫好的指令
        .invoke_handler(tauri::generate_handler![execute_ytm_js, download_music])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
