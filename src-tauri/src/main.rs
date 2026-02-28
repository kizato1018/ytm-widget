#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    // 這裡的 ytm_widget_lib 是對應你在 Cargo.toml 裡定義的 lib 名稱
    ytm_widget_lib::run();
}
