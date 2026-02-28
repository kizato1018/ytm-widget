import { getCurrentWindow, Window, getAllWindows, LogicalSize, LogicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { app } from '@tauri-apps/api';
const appWindow = getCurrentWindow();
const FIXED_WIDTH = 320;
const FIXED_HEIGHT = 160;

// ==========================================
// 1. 視窗控制與透明度
// ==========================================
let ytmWindowCache = null;
let isYtmVisible = true;

await appWindow.setSize(new LogicalSize(FIXED_WIDTH, FIXED_HEIGHT));
async function initYtmWindow() {
    if (!ytmWindowCache) {
        ytmWindowCache = await Window.getByLabel('ytm-bg');

        if (ytmWindowCache) {
            await ytmWindowCache.onCloseRequested(async (event) => {
                event.preventDefault();
                await ytmWindowCache.hide();
                isYtmVisible = false;
                document
                    .getElementById('show-ytm-btn')
                    ?.classList.remove('pin-active');
            });

            await ytmWindowCache.onResized(async () => {
                const isMinimized = await ytmWindowCache.isMinimized();
                if (isMinimized) {
                    await ytmWindowCache.unminimize();
                    await ytmWindowCache.hide();
                    isYtmVisible = false;
                    document
                        .getElementById('show-ytm-btn')
                        ?.classList.remove('pin-active');
                }
            });
        }
    }
    return ytmWindowCache;
}

initYtmWindow();

document.getElementById('show-ytm-btn').classList.add('pin-active');

document.getElementById('opacity-slider').addEventListener('input', (e) => {
    document.querySelector('.player-container').style.opacity = e.target.value;
});

let isPinned = true;
appWindow.setAlwaysOnTop(true).catch(() => { });

document.getElementById('pin-btn').addEventListener('click', async () => {
    isPinned = !isPinned;
    await appWindow.setAlwaysOnTop(isPinned);
    document.getElementById('pin-btn').classList.toggle('pin-active', isPinned);
});

document.getElementById('show-ytm-btn').addEventListener('click', async () => {
    const win = await initYtmWindow();
    if (!win) return;

    isYtmVisible = !isYtmVisible;
    if (isYtmVisible) {
        await win.show();
        await win.unminimize();
        await win.setFocus();
        document.getElementById('show-ytm-btn').classList.add('pin-active');
    } else {
        await win.hide();
        document.getElementById('show-ytm-btn').classList.remove('pin-active');
    }
});

document.getElementById('close-btn').addEventListener('click', async () => {
    await appWindow.hide();
    const win = await initYtmWindow();
    if (win && isYtmVisible) {
        await win.hide();
        isYtmVisible = false;
        document.getElementById('show-ytm-btn').classList.remove('pin-active');
    }
});

// ==========================================
// 2. 右下角系統列 (新增右鍵選單)
// ==========================================
async function setupTray() {
    try {
        const settingsItem = await MenuItem.new({
            text: '⚙️ 設定',
            action: async () => {
                const existing = await WebviewWindow.getByLabel('settings');
                if (existing) {
                    await existing.show();
                    await existing.setFocus();
                } else {
                    new WebviewWindow('settings', {
                        url: '/settings.html',
                        title: 'YTM Widget 設定',
                        width: 400,
                        height: 300,
                        resizable: false
                    });
                }
            }
        });

        const quitItem = await MenuItem.new({
            text: '❌ 徹底關閉程式',
            action: async () => {
                // const windows = await getAllWindows();
                // for (const w of windows) {
                //     await w.close();
                // }
                await exit(0);
            }
        });

        const menu = await Menu.new({ items: [settingsItem, quitItem] });

        await TrayIcon.new({
            id: 'ytm-tray',
            tooltip: 'YTM Widget',
            icon: await defaultWindowIcon(),
            menu,
            action: async (event) => {
                if (event.type === 'Click' && event.button === 'Left') {
                    await appWindow.show();
                    await appWindow.setFocus();
                }
            }
        });
    } catch (error) {
        console.error("Tray 圖示建立失敗", error);
    }
}
setupTray();

// ==========================================
// 3. 本地動態廣告黑名單與潛伏特務
// ==========================================

// 💡 1. 建立預設黑名單，並嘗試從 localStorage 讀取最新資料庫
const DEFAULT_AD_DOMAINS = [
    'doubleclick.net',
    'googleadservices.com',
    'youtube.com/api/stats/ads',
    'youtube.com/pagead/',
    'googlesyndication.com'
];

let currentAdDomains = JSON.parse(localStorage.getItem('ytm_ad_domains')) || DEFAULT_AD_DOMAINS;

// 💡 2. 提供一個全域函數，未來可以在設定視窗呼叫它來更新資料庫
window.updateAdDomains = (newDomains) => {
    currentAdDomains = newDomains;
    localStorage.setItem('ytm_ad_domains', JSON.stringify(currentAdDomains));
    console.log("🛡️ 廣告黑名單已更新並存入本地資料庫！");
};

let isSeeking = false;
let latestYtmState = { isPaused: true };

// 💡 3. 將寫死的腳本改為「動態生成的函數」，每次呼叫都會帶入最新的 currentAdDomains
function getAgentScript() {
    return `
        (() => {
            if (!window.__TAURI__ || !window.__TAURI__.event) return;
            
            // 同步最新黑名單
            window.__AD_DOMAINS__ = ${JSON.stringify(currentAdDomains)};

            if (!window.__YTM_ADBLOCK_INSTALLED__) {
                window.__YTM_ADBLOCK_INSTALLED__ = true;
                
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                    if (window.__AD_DOMAINS__.some(domain => url.includes(domain))) {
                        return new Response('{}', { status: 200 }); 
                    }
                    return originalFetch.apply(this, args);
                };

                const originalXHR = window.XMLHttpRequest.prototype.open;
                window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    if (typeof url === 'string' && window.__AD_DOMAINS__.some(domain => url.includes(domain))) {
                        url = 'data:,'; 
                    }
                    return originalXHR.call(this, method, url, ...rest);
                };
            }

            if (window.__YTM_AGENT_INSTALLED__) return;
            window.__YTM_AGENT_INSTALLED__ = true;

            console.log("✅ YTM 純事件驅動特務已潛入！效能極致最佳化。");

            const emitStatus = (video) => {
                const titleEl = document.querySelector('ytmusic-player-bar .title');
                const artistEl = document.querySelector('ytmusic-player-bar .byline');

                let formattedArtist = artistEl ? artistEl.innerText : "無";
                formattedArtist = formattedArtist.replace(/\\n/g, '').replace(/\\s*•\\s*/g, ' • ').trim();
                
                window.__TAURI__.event.emit('ytm_status', {
                    url: window.location.href,
                    currentTime: video.currentTime || 0,
                    duration: isNaN(video.duration) ? 0 : video.duration,
                    isPaused: video.paused,
                    volume: video.volume,
                    title: titleEl ? titleEl.innerText : "等待播放中...",
                    artist: formattedArtist
                });
            };

            const killAdsAndPopups = (video) => {
                const isAd = document.querySelector('.ad-showing') || document.querySelector('.ytp-ad-player-overlay');
                if (isAd) {
                    video.muted = true;

                    if (!isNaN(video.duration) && video.currentTime < video.duration - 0.5) {
                        video.currentTime = video.duration - 0.1;
                    }

                    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
                    if (skipBtn) {
                        skipBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                    
                    if (video.paused) {
                        // 使用 catch 避免瀏覽器擋下自動播放產生的 Promise 報錯
                        video.play().catch(() => {}); 
                    }
                    video.playbackRate = 16.0;
                    
                }

                const youThereBtn = document.querySelector('.ytmusic-you-there-renderer yt-button-renderer[dialog-confirm] button');
                if (youThereBtn && youThereBtn.offsetParent !== null) youThereBtn.click();

                const warningBtns = document.querySelectorAll('player-error-message-container button, ytmusic-content-warning-supported-renderers tp-yt-paper-button, #proceed-button');
                warningBtns.forEach(btn => {
                    if (btn.offsetParent !== null) btn.click();
                });

                const dismissBtns = document.querySelectorAll('ytmusic-mealbar-promo-renderer #dismiss-button, yt-button-renderer[aria-label="關閉"] button, yt-button-renderer[aria-label="Close"] button');
                dismissBtns.forEach(btn => {
                    if (btn.offsetParent !== null) btn.click();
                });
            };

            // 💡 尋找影片標籤，並掛載「純事件監聽」
            const attachEvents = () => {
                const video = document.querySelector('video');
                if (!video) return false;
                
                if (video.dataset.agentAttached) return true; // 避免重複掛載
                video.dataset.agentAttached = "true";

                // 💡 核心改動：不再用 setInterval，而是跟著影片的呼吸一起動！
                video.addEventListener('timeupdate', () => {
                    killAdsAndPopups(video); // 影片在跑的時候，高頻率檢查廣告
                    emitStatus(video);       // 影片在跑的時候，自動推播最新秒數給進度條
                });

                // 其他狀態的瞬間更新
                video.addEventListener('play', () => emitStatus(video));
                video.addEventListener('pause', () => emitStatus(video));
                video.addEventListener('volumechange', () => emitStatus(video));
                
                return true;
            };

            // YouTube 剛載入時可能還沒有 <video> 標籤，
            // 所以我們設一個輕量級的觀察者，一旦找到 video 就掛載事件並自我銷毀。
            if (!attachEvents()) {
                const initObserver = setInterval(() => {
                    if (attachEvents()) clearInterval(initObserver);
                }, 1000);
            }
        })();
    `;
}

// 每 3 秒呼叫一次 getAgentScript()，確保特務帶上最新的黑名單
setInterval(() => {
    invoke('execute_ytm_js', { script: getAgentScript() }).catch(() => { });
}, 3000);

async function sendCommand(action, value = null) {
    const script = `
        (() => {
            const video = document.querySelector('video');
            if (!video) return;
            if ('${action}' === 'play') video.play();
            if ('${action}' === 'pause') video.pause();
            if ('${action}' === 'seek') video.currentTime = ${value};
            if ('${action}' === 'volume') video.volume = ${value};
            if ('${action}' === 'next') { const btn = document.querySelector('.next-button'); if(btn) btn.click(); }
            if ('${action}' === 'prev') { const btn = document.querySelector('.previous-button'); if(btn) btn.click(); }
        })();
    `;
    try {
        await invoke('execute_ytm_js', { script });
    } catch (e) { }
}

// ==========================================
// 4. UI 更新與事件綁定
// ==========================================
const ui = {
    title: document.getElementById('song-title'),
    artist: document.getElementById('song-artist'),
    progress: document.getElementById('progress-bar'),
    currentTime: document.getElementById('current-time'),
    duration: document.getElementById('duration'),
    playBtn: document.getElementById('play-pause-btn'),
    volume: document.getElementById('volume-bar')
};

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

listen('ytm_status', (event) => {
    const state = event.payload;
    latestYtmState = state;

    if (isSeeking) return;

    if (ui.title.innerText !== state.title) ui.title.innerText = state.title;
    const newArtist = state.artist && state.artist !== "無" ? state.artist : '';
    if (ui.artist.innerText !== newArtist) ui.artist.innerText = newArtist;
    console.log("url:", state.url);
    ui.progress.max = state.duration || 100;
    ui.progress.value = state.currentTime || 0;
    ui.currentTime.innerText = formatTime(state.currentTime);
    ui.duration.innerText = formatTime(state.duration);

    if (document.activeElement !== ui.volume) {
        ui.volume.value = state.volume;
    }

    ui.playBtn.innerText = state.isPaused ? "▶️" : "⏸️";
});

ui.playBtn.addEventListener('click', () => {
    const willPause = !latestYtmState.isPaused;
    ui.playBtn.innerText = willPause ? "▶️" : "⏸️";
    latestYtmState.isPaused = willPause;
    sendCommand(willPause ? 'pause' : 'play');
});

document.getElementById('next-btn').addEventListener('click', () => sendCommand('next'));
document.getElementById('prev-btn').addEventListener('click', () => sendCommand('prev'));

ui.progress.addEventListener('input', () => {
    isSeeking = true;
    ui.currentTime.innerText = formatTime(ui.progress.value);
});
ui.progress.addEventListener('change', () => {
    sendCommand('seek', parseFloat(ui.progress.value));
    isSeeking = false;
});

ui.volume.addEventListener('input', () => {
    sendCommand('volume', parseFloat(ui.volume.value));
});

let scaleTimeout;
appWindow.onScaleChanged(async ({ scaleFactor }) => {
    console.log("螢幕縮放比例改變:", scaleFactor);
    
    // 清除上一次的延遲，確保只在最後一次變動後執行
    clearTimeout(scaleTimeout);
    
    scaleTimeout = setTimeout(async () => {
        // 💡 等系統穩定後，強行設定邏輯尺寸
        // LogicalSize 會自動根據當前的 scaleFactor 轉換成正確的物理像素
        await appWindow.setSize(new LogicalSize(FIXED_WIDTH, FIXED_HEIGHT));
        console.log("尺寸已強制校正為:", FIXED_WIDTH, FIXED_HEIGHT);
    }, 150); // 150ms 的延遲通常足以避開系統的競態條件
});

// 在 main.js 的 UI 事件綁定區塊加入
document.getElementById('download-btn').addEventListener('click', async () => {
    if (!latestYtmState.url || latestYtmState.url.includes('music.youtube.com/watch') === false) {
        console.error("尚未偵測到可下載的歌曲網址！");
        return;
    }

    // 從 localStorage 取得使用者設定的下載路徑，若無則預設為下載資料夾
    const savePath = localStorage.getItem('download_path') || 'C:/Downloads';
    
    const btn = document.getElementById('download-btn');
    btn.innerText = "⏳"; // 顯示處理中
    btn.style.pointerEvents = "none";

    try {
        console.log("準備下載:", latestYtmState.url);
        // 💡 呼叫我們在 Rust 定義的指令
        const result = await invoke('download_music', { 
            url: latestYtmState.url, 
            path: savePath 
        });
        console.log(`✅ ${result}`);
    } catch (error) {
        console.error("下載失敗:", error);
    } finally {
        btn.innerText = "📥";
        btn.style.pointerEvents = "auto";
    }
});