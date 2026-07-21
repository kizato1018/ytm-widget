import { getCurrentWindow, Window, LogicalSize } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { downloadDir } from '@tauri-apps/api/path';
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

let isDownloading = false;
let lastVideoId = null;

await appWindow.setSize(new LogicalSize(FIXED_WIDTH, FIXED_HEIGHT));

// ==========================================
// 下載進度 / 已下載紀錄工具
// ==========================================
function getDownloadedIds() {
    try { return new Set(JSON.parse(localStorage.getItem('downloaded_ids') || '[]')); }
    catch { return new Set(); }
}
function markDownloaded(id) {
    if (!id) return;
    const ids = getDownloadedIds();
    ids.add(id);
    localStorage.setItem('downloaded_ids', JSON.stringify([...ids]));
}
function setDownloadProgress(pct) {
    const btn = document.getElementById('download-btn');
    if (btn) btn.style.setProperty('--dl-progress', `${pct}%`);
}
// 依當前歌曲是否已下載過，更新下載按鈕外觀 (下載中時不動它)
function refreshDownloadedState(id) {
    if (isDownloading) return;
    const btn = document.getElementById('download-btn');
    if (!btn) return;
    const done = !!(id && getDownloadedIds().has(id));
    btn.classList.toggle('downloaded', done);
    btn.classList.remove('dl-error');
    btn.title = "下載當前歌曲";
    if (!done) setDownloadProgress(0);
}

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

            // === 廣告靜音控制狀態 ===
            let adMuteActive = false;   // 因廣告而靜音中
            let userMutedPref = false;  // 廣告前使用者原本的靜音狀態
            let lastAdSignal = 0;
            let adMuteStart = 0;

            // === 自動避開升級 (Premium) 頁面：回到「上一頁」(不是強制首頁) ===
            let lastPremiumEscape = 0;
            const escapePremium = () => {
                if (!/(premium|paid_membership)/i.test(location.pathname)) return;
                const now = Date.now();
                if (now - lastPremiumEscape < 2000) return; // 冷卻，避免無限循環
                lastPremiumEscape = now;
                if (history.length > 1) {
                    history.back(); // 回到上一頁 (例如 MV 播放頁)，播放不中斷
                    // 保險：若 back 後仍停在升級頁，才退回首頁
                    setTimeout(() => {
                        if (/(premium|paid_membership)/i.test(location.pathname)) {
                            const logo = document.querySelector('ytmusic-logo a, ytmusic-nav-bar #left-content a[href]');
                            if (logo) logo.click();
                        }
                    }, 500);
                } else {
                    const logo = document.querySelector('ytmusic-logo a, ytmusic-nav-bar #left-content a[href]');
                    if (logo) logo.click();
                }
            };
            const _push = history.pushState;
            history.pushState = function () { const r = _push.apply(this, arguments); setTimeout(escapePremium, 0); return r; };
            const _replace = history.replaceState;
            history.replaceState = function () { const r = _replace.apply(this, arguments); setTimeout(escapePremium, 0); return r; };
            window.addEventListener('popstate', () => setTimeout(escapePremium, 0));
            setInterval(escapePremium, 800);

            // === 隱藏左側導覽「升級」項目 (實測：ytmusic-guide-entry-renderer，標題文字=升級，無 href) ===
            const hidePremiumNav = () => {
                document.querySelectorAll('ytmusic-guide-entry-renderer').forEach(entry => {
                    const t = entry.querySelector('.title');
                    const txt = (t ? t.textContent : '').trim();
                    if (txt === '升級' || /^upgrade$/i.test(txt) || /premium/i.test(txt)) {
                        entry.style.display = 'none';
                    }
                });
            };
            hidePremiumNav();

            // 取得「當前正在播放」的 video ID：不依賴頁面網址，
            // 就算 YTM 跳到升級頁 / 其他頁面 (歌在右下角迷你播放器繼續播) 也抓得到
            const getCurrentVideoId = () => {
                // 1. YouTube 播放器 API (最可靠)
                try {
                    const mp = document.querySelector('#movie_player');
                    if (mp && typeof mp.getVideoData === 'function') {
                        const vd = mp.getVideoData();
                        if (vd && vd.video_id) return vd.video_id;
                    }
                } catch (e) {}
                // 2. 播放列裡指向歌曲的連結
                const a = document.querySelector('ytmusic-player-bar a[href*="watch"]');
                if (a) {
                    const m = (a.getAttribute('href') || '').match(/[?&]v=([^&]+)/);
                    if (m) return m[1];
                }
                // 3. 退而求其次：目前網址
                const m2 = window.location.href.match(/[?&]v=([^&]+)/);
                return m2 ? m2[1] : "";
            };

            const emitStatus = (video) => {
                const titleEl = document.querySelector('ytmusic-player-bar .title');
                const artistEl = document.querySelector('ytmusic-player-bar .byline');

                let formattedArtist = artistEl ? artistEl.innerText : "無";
                formattedArtist = formattedArtist.replace(/\\n/g, '').replace(/\\s*•\\s*/g, ' • ').trim();

                const titleText = titleEl ? titleEl.innerText.trim() : "";

                window.__TAURI__.event.emit('ytm_status', {
                    url: window.location.href,
                    videoId: getCurrentVideoId(),
                    currentTime: video.currentTime || 0,
                    duration: isNaN(video.duration) ? 0 : video.duration,
                    isPaused: video.paused,
                    volume: video.volume,
                    muted: adMuteActive ? userMutedPref : video.muted,
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

            // === 廣告偵測 (依實測資料)：#movie_player.getAdState()===1 為主，ad-* class / 廣告 UI 為輔 ===
            // 廣告偵測 (實測基準，不用 getAdState / ad-created / .ytp-ad-*：那些正常播放也會成立)：
            //  1) #movie_player 出現 ad-showing / ad-interrupting (廣告插入當下)
            //  2) 播放列出現廣告標記 span.badge-style-type-ad-stark (整段廣告都在，class 跨語言)
            const adSignalNow = () => {
                const mp = document.querySelector('#movie_player');
                if (mp && mp.classList && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting'))) return true;
                // badge 常駐於播放列，沒廣告時是空的：必須「有文字且可見」才算廣告 (避免每首歌被誤判)
                const badge = document.querySelector('.badge-style-type-ad-stark');
                if (badge && (badge.textContent || '').trim().length > 0 && badge.getClientRects().length > 0) return true;
                return false;
            };

            // 無痕靜音 + 快轉跳過廣告 (只動 video.muted，不碰 video.volume / 音量條)
            const controlAudio = () => {
                const video = document.querySelector('video');
                if (!video) return;
                const now = Date.now();
                const adNow = adSignalNow();            // 當下是否「確實」是廣告 (強訊號)
                if (adNow) lastAdSignal = now;
                let inAd = (now - lastAdSignal) < 350;   // 保留 350ms 橋接訊號空窗，避免靜音漏聲
                // 安全網：連續靜音超過 40 秒 (廣告不會這麼長) 視為誤判，強制解除
                if (inAd && adMuteActive && (now - adMuteStart > 40000)) inAd = false;

                if (inAd) {
                    if (!adMuteActive) { userMutedPref = video.muted; adMuteActive = true; adMuteStart = now; }
                    video.muted = true; // 立即靜音，在廣告出聲前就蓋掉
                    // 跳過廣告 (參考 1.0.3)：快轉 + 直接跳到接近結尾 + 點掉「可跳過」鈕。
                    // 只在「當下即時確認是廣告 (adNow)」時才跳，避免廣告剛結束的空窗把下一首歌跳掉；
                    // 偵測已驗證不會在正常歌曲成立，所以歌不會被跳。
                    if (adNow) {
                        const skip = document.querySelector('.ytp-ad-skip-button-modern, .ytp-ad-skip-button');
                        if (skip) skip.click();
                        try { video.playbackRate = 16.0; } catch (e) {}
                        if (!isNaN(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.3) {
                            try { video.currentTime = video.duration - 0.1; } catch (e) {}
                        }
                    }
                    if (video.paused) video.play().catch(() => {});
                } else if (adMuteActive) {
                    // 廣告結束：還原速度與使用者原本的靜音狀態
                    try { video.playbackRate = 1.0; } catch (e) {}
                    video.muted = userMutedPref;
                    adMuteActive = false;
                }
            };

            const attachEvents = () => {
                const video = document.querySelector('video');
                if (!video) return false;
                if (video.dataset.agentAttached) return true;
                video.dataset.agentAttached = "true";

                video.addEventListener('timeupdate', () => emitStatus(video));
                video.addEventListener('play', () => { controlAudio(); emitStatus(video); });
                video.addEventListener('playing', () => controlAudio());
                video.addEventListener('loadstart', () => controlAudio()); // 新媒體 (歌/廣告) 載入即檢查，搶在出聲前
                video.addEventListener('pause', () => emitStatus(video));
                video.addEventListener('volumechange', () => emitStatus(video));

                return true;
            };

            if (!attachEvents()) {
                const initObserver = setInterval(() => {
                    if (attachEvents()) clearInterval(initObserver);
                }, 1000);
            }

            // 廣告靜音：100ms 快速輪詢，確保廣告一出現就靜音、不漏聲
            if (!window.__YTM_AD_INTERVAL__) {
                window.__YTM_AD_INTERVAL__ = setInterval(controlAudio, 100);
            }
            if (!window.__YTM_POPUP_INTERVAL__) {
                window.__YTM_POPUP_INTERVAL__ = setInterval(() => {
                    dismissPopups();
                    hidePremiumNav();
                }, 2000);
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

// 音量按鈕：點擊靜音 → 音量條滑到 0；再點一下 → 還原到上次音量。音量條為 0 時顯示靜音圖示。
const volumeBtn = document.getElementById('volume-btn');
let lastMuteToggle = 0;
function updateMuteIcon(muted) {
    volumeBtn.classList.toggle('vol-muted', muted);
}
volumeBtn.addEventListener('click', () => {
    lastMuteToggle = Date.now();
    const cur = parseFloat(ui.volume.value);
    if (cur > 0) {
        // 靜音：記住目前音量供還原，音量條滑到 0
        userVolumePref = cur;
        localStorage.setItem('ytm_volume_pref', cur.toString());
        ui.volume.value = 0;
        updateMuteIcon(true);
        sendCommand('volume', 0);
    } else {
        // 解除靜音：還原到上次音量
        const restore = userVolumePref > 0 ? userVolumePref : 0.5;
        ui.volume.value = restore;
        updateMuteIcon(false);
        sendCommand('volume', restore);
    }
});

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

listen('ytm_status', (event) => {
    const state = event.payload;
    latestYtmState = state;

    // 換歌時更新下載按鈕 (已下載過 → 整顆綠)
    const vid = state.videoId || null;
    if (vid !== lastVideoId) {
        lastVideoId = vid;
        refreshDownloadedState(vid);
    }

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

    // 同步靜音圖示：以實際音量是否為 0 為準 (剛手動操作 500ms 內不覆蓋，避免閃爍)
    if (Date.now() - lastMuteToggle > 500) updateMuteIcon((state.volume || 0) <= 0.001);
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
    if (newVol > 0) {                 // 只把非 0 音量記為偏好 (下次啟動/還原用)
        userVolumePref = newVol;
        localStorage.setItem('ytm_volume_pref', newVol.toString());
    }
    updateMuteIcon(newVol === 0);     // 滑到 0 → 靜音圖示；拉起來 → 恢復
    lastMuteToggle = Date.now();
    sendCommand('volume', newVol);
});

let scaleTimeout;
appWindow.onScaleChanged(async () => {
    clearTimeout(scaleTimeout);
    scaleTimeout = setTimeout(async () => {
        await appWindow.setSize(new LogicalSize(FIXED_WIDTH, FIXED_HEIGHT));
    }, 150);
});

// 後端回報的下載進度 → 綠色由下往上填滿
listen('download_progress', (event) => {
    if (!isDownloading) return;
    const pct = Math.max(0, Math.min(100, Number(event.payload) || 0));
    setDownloadProgress(pct);
});

async function resolveSavePath() {
    // release 版的 localStorage 與 dev 是不同 origin；沒設過就用系統下載資料夾當預設，
    // 不要用寫死的 C:/Downloads (可能不存在或無寫入權限)
    let savePath = localStorage.getItem('download_path');
    if (!savePath) {
        savePath = await downloadDir();
        localStorage.setItem('download_path', savePath);
    }
    return savePath;
}

document.getElementById('download-btn').addEventListener('click', async () => {
    if (isDownloading) return;
    // 用當前播放的 videoId (不依賴頁面網址，跳升級頁也抓得到)
    const vid = latestYtmState.videoId;
    if (!vid) {
        console.error("尚未偵測到可下載的歌曲！");
        return;
    }

    const btn = document.getElementById('download-btn');
    const dlUrl = `https://music.youtube.com/watch?v=${vid}`;

    isDownloading = true;
    btn.classList.remove('downloaded', 'dl-error');
    btn.title = "下載當前歌曲";
    setDownloadProgress(0);
    btn.style.pointerEvents = "none";

    try {
        const savePath = await resolveSavePath();
        const result = await invoke('download_music', { url: dlUrl, path: savePath });
        markDownloaded(vid);
        setDownloadProgress(100);
        btn.classList.add('downloaded'); // 下載完成 → 整顆綠
        console.log(`✅ ${result}`);
    } catch (error) {
        // release 沒有 console，把錯誤顯示在按鈕上：變紅 + 滑鼠移上去看得到原因
        const msg = typeof error === 'string' ? error : JSON.stringify(error);
        console.error("下載失敗:", msg);
        setDownloadProgress(0);
        btn.classList.remove('downloaded');
        btn.classList.add('dl-error');
        btn.title = "下載失敗: " + msg;
    } finally {
        isDownloading = false;
        btn.style.pointerEvents = "auto";
    }
});

listen('theme_changed', (event) => {
    document.documentElement.setAttribute('data-theme', event.payload);
});
