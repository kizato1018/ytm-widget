use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

// 從 yt-dlp 的 --progress-template 輸出 (例如 "DLPROG:  45.2%") 解析出百分比數字
fn parse_progress(text: &str) -> Option<f64> {
    let idx = text.find("DLPROG:")?;
    let rest = &text[idx + "DLPROG:".len()..];
    rest.trim().trim_end_matches('%').trim().parse::<f64>().ok()
}

#[tauri::command]
async fn download_music(app: tauri::AppHandle, url: String, path: String) -> Result<String, String> {
    let sidecar_command = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            "--no-update",
            // YTM 現在不一定提供純 m4a 音訊串流，逐層回退確保一定抓得到可下載的格式
            "-f", "ba[ext=m4a]/ba/bestaudio/best",
            // 用 ffmpeg 把音訊抽出成 mp3 (若下載到的是含影像的格式也會轉成純音訊)
            "-x", "--audio-format", "mp3",
            "--audio-quality", "0",
            "--no-playlist",
            "--newline",
            "--progress-template", "DLPROG:%(progress._percent_str)s",
            "-o", &format!("{}/%(title)s.%(ext)s", path),
            &url,
        ]);

    let (mut rx, _child) = sidecar_command.spawn().map_err(|e| e.to_string())?;

    let mut error_output = String::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            // yt-dlp 的下載進度透過 --progress-template 走 stdout
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                if let Some(pct) = parse_progress(&text) {
                    let _ = app.emit("download_progress", pct);
                }
            }
            // 警告與錯誤都在 stderr；成功 (exit 0) 時忽略，失敗時當作錯誤訊息回傳
            CommandEvent::Stderr(line) => {
                error_output.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        return Err(if error_output.trim().is_empty() {
            format!("yt-dlp 結束代碼 {:?}", exit_code)
        } else {
            error_output.trim().to_string()
        });
    }

    let _ = app.emit("download_progress", 100.0);
    Ok("下載完成".into())
}

#[tauri::command]
fn execute_ytm_js(app: tauri::AppHandle, script: String) {
    if let Some(webview) = app.get_webview_window("ytm-bg") {
        let _ = webview.eval(&script);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![execute_ytm_js, download_music])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            let user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

            #[cfg(target_os = "windows")]
            let user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

            #[cfg(target_os = "linux")]
            let user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

            WebviewWindowBuilder::new(
                app,
                "ytm-bg",
                WebviewUrl::External("https://music.youtube.com".parse().unwrap())
            )
            .title("YTM Background")
            .visible(true)
            .user_agent(user_agent)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
