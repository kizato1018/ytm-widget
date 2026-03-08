use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[tauri::command]
async fn download_music(app: tauri::AppHandle, url: String, path: String) -> Result<String, String> {
    let sidecar_command = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            "-f", "ba[ext=m4a]",
            "--no-playlist",
            "--audio-quality", "0",
            "-o", &format!("{}/%(title)s.%(ext)s", path),
            &url,
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
