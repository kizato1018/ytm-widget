import { getCurrentWindow, Window, LogicalSize } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';

import playIcon from './assets/play.png';
import pauseIcon from './assets/pause.png';

const appWindow = getCurrentWindow();
const FIXED_WIDTH = 320;
const FIXED_HEIGHT = 160;

let ytmWindowCache = null;
let isYtmVisible = true;
let isSeeking = false;
let latestYtmState = { isPaused: true, url: '' };
let userVolumePref = parseFloat(localStorage.getItem('ytm_volume_pref')) || 0.5;

await appWindow.setSize(new LogicalSize(FIXED_WIDTH, FIXED_HEIGHT));

// ==========================================
// 1. 視窗控制
// ==========================================
async function initYtmWindow() {
    if (!ytmWindowCache) {
        ytmWindowCache = await Window.getByLabel('ytm-bg');

        if (ytmWindowCache) {
            await ytmWindowCache.onCloseRequested(async (event) => {
                event.preventDefault();
                await ytmWindowCache.hide();
                isYtmVisible = false;
                document.getElementById('show-ytm-btn')?.classList.remove('pin-active');
            });

            await ytmWindowCache.onResized(async () => {
                const isMinimized = await ytmWindowCache.isMinimized();
                if (isMinimized) {
                    await ytmWindowCache.unminimize();
                    await ytmWindowCache.hide();
                    isYtmVisible = false;
                    document.getElementById('show-ytm-btn')?.classList.remove('pin-active');
                }
            });
        }
    }
    return ytmWindowCache;
}

setTimeout(initYtmWindow, 1000);

document.getElementById('show-ytm-btn').classList.add('pin-active');
document.getElementById('opacity-slider').addEventListener('input', (e) => {
    document.querySelector('.player-container').style.opacity = e.target.value;
});

let isPinned = true;
appWindow.setAlwaysOnTop(true).catch(() => {});

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
// 2. 系統列 (右鍵選單)
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
            action: async () => { await exit(0); }
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
// 3. YTM 狀態特務
// ==========================================
function getAgentScript() {
    return `
        (() => {
            if (!window.__TAURI__ || !window.__TAURI__.event) return;
            if (window.__YTM_AGENT_INSTALLED__) return;
            window.__YTM_AGENT_INSTALLED__ = true;

            let isAdHandling = false;

            const emitStatus = (video) => {
                const titleEl = document.querySelector('ytmusic-player-bar .title');
                const artistEl = document.querySelector('ytmusic-player-bar .byline');

                let formattedArtist = artistEl ? artistEl.innerText : "無";
                formattedArtist = formattedArtist.replace(/\\n/g, '').replace(/\\s*•\\s*/g, ' • ').trim();

                const titleText = titleEl ? titleEl.innerText.trim() : "";

                window.__TAURI__.event.emit('ytm_status', {
                    url: window.location.href,
                    currentTime: video.currentTime || 0,
                    duration: isNaN(video.duration) ? 0 : video.duration,
                    isPaused: video.paused,
                    volume: video.volume,
                    title: titleText || "等待播放中...",
                    artist: formattedArtist
                });
            };

            const dismissPopups = () => {
                const youThereBtn = document.querySelector(
                    '.ytmusic-you-there-renderer yt-button-renderer[dialog-confirm] button'
                );
                if (youThereBtn && youThereBtn.offsetParent !== null) youThereBtn.click();

                const dialogConfirmBtn = document.querySelector(
                    'tp-yt-paper-dialog yt-button-renderer[dialog-confirm] button, ' +
                    'yt-dialog-renderer yt-button-renderer[dialog-confirm] button'
                );
                if (dialogConfirmBtn && dialogConfirmBtn.offsetParent !== null) dialogConfirmBtn.click();

                document.querySelectorAll(
                    'player-error-message-container button, ' +
                    'ytmusic-content-warning-supported-renderers tp-yt-paper-button, ' +
                    '#proceed-button'
                ).forEach(btn => { if (btn.offsetParent !== null) btn.click(); });

                document.querySelectorAll(
                    'ytmusic-mealbar-promo-renderer #dismiss-button, ' +
                    'yt-button-renderer[aria-label="關閉"] button, ' +
                    'yt-button-renderer[aria-label="Close"] button'
                ).forEach(btn => { if (btn.offsetParent !== null) btn.click(); });
            };

            const killAdsAndPopups = (video) => {
                const isAd = document.querySelector('.ad-showing') || document.querySelector('.ytp-ad-player-overlay');

                if (isAd) {
                    isAdHandling = true;
                    video.muted = true;
                    video.playbackRate = 4.0;

                    if (!isNaN(video.duration) && video.currentTime < video.duration - 1) {
                        video.currentTime = video.duration - 1;
                    }

                    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
                    if (skipBtn) {
                        skipBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }

                    if (video.paused) video.play().catch(() => {});
                } else if (isAdHandling) {
                    video.muted = false;
                    video.playbackRate = 1.0;
                    isAdHandling = false;
                }

                dismissPopups();
            };

            const attachEvents = () => {
                const video = document.querySelector('video');
                if (!video) return false;
                if (video.dataset.agentAttached) return true;
                video.dataset.agentAttached = "true";

                video.addEventListener('timeupdate', () => {
                    killAdsAndPopups(video);
                    emitStatus(video);
                });
                video.addEventListener('play', () => emitStatus(video));
                video.addEventListener('pause', () => emitStatus(video));
                video.addEventListener('volumechange', () => emitStatus(video));

                return true;
            };

            if (!attachEvents()) {
                const initObserver = setInterval(() => {
                    if (attachEvents()) clearInterval(initObserver);
                }, 1000);
            }

            if (!window.__YTM_POPUP_INTERVAL__) {
                window.__YTM_POPUP_INTERVAL__ = setInterval(dismissPopups, 2000);
            }
        })();
    `;
}

setInterval(() => {
    invoke('execute_ytm_js', { script: getAgentScript() }).catch(() => {});
}, 3000);

setTimeout(() => {
    sendCommand('volume', userVolumePref);
}, 3000);

// ==========================================
// 4. 播放控制指令
// ==========================================
async function sendCommand(action, value = null) {
    const script = `
        (() => {
            const video = document.querySelector('video');
            if (!video) return;
            if ('${action}' === 'play') video.play();
            if ('${action}' === 'pause') video.pause();
            if ('${action}' === 'seek') video.currentTime = ${value};
            if ('${action}' === 'volume') {
                video.volume = ${value};
                const ytmSlider = document.getElementById('volume-slider');
                if (ytmSlider) {
                    ytmSlider.value = ${value} * 100;
                    ytmSlider.dispatchEvent(new CustomEvent('value-changed', { detail: { value: ${value} * 100 }}));
                    ytmSlider.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            if ('${action}' === 'next') { const btn = document.querySelector('.next-button'); if (btn) btn.click(); }
            if ('${action}' === 'prev') { const btn = document.querySelector('.previous-button'); if (btn) btn.click(); }
        })();
    `;
    try {
        await invoke('execute_ytm_js', { script });
    } catch (e) {}
}

// ==========================================
// 5. UI 更新與事件綁定
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

ui.volume.value = userVolumePref;

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

    ui.progress.max = state.duration || 100;
    ui.progress.value = state.currentTime || 0;
    ui.currentTime.innerText = formatTime(state.currentTime);
    ui.duration.innerText = formatTime(state.duration);

    const playPauseImg = document.getElementById('play-pause-img');
    if (playPauseImg) {
        playPauseImg.src = state.isPaused ? playIcon : pauseIcon;
    }
});

ui.playBtn.addEventListener('click', () => {
    const willPause = !latestYtmState.isPaused;
    const playPauseImg = document.getElementById('play-pause-img');
    if (playPauseImg) {
        playPauseImg.src = willPause ? playIcon : pauseIcon;
    }
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
    const newVol = parseFloat(ui.volume.value);
    userVolumePref = newVol;
    localStorage.setItem('ytm_volume_pref', newVol.toString());
    sendCommand('volume', newVol);
});

let scaleTimeout;
appWindow.onScaleChanged(async () => {
    clearTimeout(scaleTimeout);
    scaleTimeout = setTimeout(async () => {
        await appWindow.setSize(new LogicalSize(FIXED_WIDTH, FIXED_HEIGHT));
    }, 150);
});

document.getElementById('download-btn').addEventListener('click', async () => {
    if (!latestYtmState.url?.includes('music.youtube.com/watch')) {
        console.error("尚未偵測到可下載的歌曲網址！");
        return;
    }

    const savePath = localStorage.getItem('download_path') || 'C:/Downloads';
    const btn = document.getElementById('download-btn');
    const dlImg = document.getElementById('download-img');

    if (dlImg) dlImg.style.opacity = "0.3";
    btn.style.pointerEvents = "none";

    try {
        const result = await invoke('download_music', { url: latestYtmState.url, path: savePath });
        console.log(`✅ ${result}`);
    } catch (error) {
        console.error("下載失敗:", error);
    } finally {
        if (dlImg) dlImg.style.opacity = "1";
        btn.style.pointerEvents = "auto";
    }
});

listen('theme_changed', (event) => {
    document.documentElement.setAttribute('data-theme', event.payload);
});
