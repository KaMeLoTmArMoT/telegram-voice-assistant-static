/**
 * TMA shared utilities (single source of truth).
 *
 * Must be loaded FIRST among app scripts (before persona_engine.js / app.js /
 * live_stream.js). Everything here is additive: plain top-level `function`
 * declarations + `window.*` aliases, so load order after this file is flexible
 * and removing this file breaks loudly instead of silently.
 *
 * Moved here verbatim (no behavior changes) from:
 * - app.js: getUrlParam, API_BASE_URL init, escapeHtml, showToast,
 *   requestWakeLock/releaseWakeLock, getTelegramUserContext,
 *   getAudioStream tiers, createMediaRecorder
 * - live_stream.js: getApiBaseUrl/getAuthParams logic, getLiveAudioStream tiers,
 *   stereo debug recorder MIME picking
 * - persona_engine.js: escapeHtml
 */

// URL parameters helper (searches query string, hash, and Telegram start_param)
function getUrlParam(name) {
    // 1. Check standard search query
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has(name)) return searchParams.get(name);

    // 2. Check hash query (e.g., #tgWebAppData=...&mode=live or #mode=live)
    if (window.location.hash) {
        const hashRaw = window.location.hash.substring(1);
        const hashParams = new URLSearchParams(hashRaw);
        if (hashParams.has(name)) return hashParams.get(name);
        // Also check if hash itself contains a query string (?mode=live)
        const qIndex = hashRaw.indexOf('?');
        if (qIndex !== -1) {
            const innerHashParams = new URLSearchParams(hashRaw.substring(qIndex + 1));
            if (innerHashParams.has(name)) return innerHashParams.get(name);
        }
    }

    // 3. Check Telegram startapp parameter (e.g. live or live_resume_xxx)
    const tgStart = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (tgStart) {
        if (name === 'mode' && tgStart.startsWith('live')) return 'live';
        if (name === 'resume_id' && tgStart.startsWith('live_')) return tgStart;
    }

    return null;
}
window.getUrlParam = getUrlParam;

// Determine API Base URL with persistent localStorage fallback
function resolveApiBaseUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    let paramApi = getUrlParam('api_url') || urlParams.get('api_url');
    if (paramApi) {
        try { localStorage.setItem('tma_api_url', paramApi); } catch (e) {}
    } else {
        try { paramApi = localStorage.getItem('tma_api_url') || ''; } catch (e) {}
    }
    return (window.API_BASE_URL || paramApi || '').replace(/\/+$/, '');
}
(function initApiBaseUrl() {
    // Canonical copy lives on window; legacy bare `API_BASE_URL` call sites
    // keep working through the getter below (no const re-declaration here on
    // purpose: duplicate top-level const across scripts would throw).
    window.API_BASE_URL = resolveApiBaseUrl();
})();

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
window.escapeHtml = escapeHtml;

// Toast Feedback Notification Helper
var toastTimeout = null;
function showToast(text, icon = '🚀') {
    const toast = document.getElementById('toast-notification');
    const toastText = document.getElementById('toast-text');
    const toastIcon = document.getElementById('toast-icon');
    if (!toast || !toastText) return;

    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }

    if (toastIcon) toastIcon.innerText = icon;
    toastText.innerText = text;
    toast.classList.remove('hidden', 'fade-out');

    toastTimeout = setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            toast.classList.add('hidden');
            toast.classList.remove('fade-out');
        }, 350);
    }, 2800);
}
window.showToast = showToast;

// Screen Wake Lock (shared holder so recorder + live modes cooperate)
var wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn('Wake Lock request failed:', err);
    }
}
function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}
window.requestWakeLock = requestWakeLock;
window.releaseWakeLock = releaseWakeLock;

// Helper to extract Telegram WebApp User Context
function getTelegramUserContext() {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    const devUser = getUrlParam('dev_user_id') || getUrlParam('user_id');
    const userId = tgUser || devUser || '';
    const initData = window.Telegram?.WebApp?.initData || getUrlParam('init_data') || '';
    return { userId, initData };
}
window.getTelegramUserContext = getTelegramUserContext;

// Microphone constraint tiers, unified from recorder (clean) and live modes.
// Profiles: 'clean' (studio recording), 'headphones' (live, no DSP),
// 'speaker' (live, AEC/DSP). Pure: returns a fresh MediaStream, no caching.
const MIC_TIERS = {
    clean: [
        {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 }
            }
        },
        {
            audio: {
                echoCancellation: { ideal: false },
                noiseSuppression: { ideal: false },
                autoGainControl: { ideal: false },
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 }
            }
        },
        {
            audio: {
                channelCount: 1,
                sampleRate: 48000
            }
        },
        { audio: true }
    ],
    headphones: [
        {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 },
            },
        },
        {
            audio: {
                echoCancellation: { ideal: false },
                noiseSuppression: { ideal: false },
                channelCount: 1,
            },
        },
        { audio: true }
    ],
    speaker: [
        {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000, min: 16000 },
            },
        },
        {
            audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                channelCount: 1,
            },
        },
        { audio: true }
    ]
};

async function requestMicStream(profile) {
    const tiers = MIC_TIERS[profile] || MIC_TIERS.clean;
    for (const constraints of tiers) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (stream && stream.active) return stream;
        } catch (err) {
            console.warn('Microphone constraint tier unavailable, trying fallback:', err);
        }
    }
    throw new Error('Unable to access microphone on this device.');
}
window.requestMicStream = requestMicStream;

// Pick the first MediaRecorder MIME type supported on this device.
function pickSupportedMime(candidates) {
    return (candidates || []).find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m))) || '';
}
window.pickSupportedMime = pickSupportedMime;

// Helper to create MediaRecorder with adaptive bitrate fallback for mobile compatibility
function createMediaRecorder(stream, bitrates) {
    const candidateMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/aac',
        ''
    ];

    const supportedMime = pickSupportedMime(candidateMimeTypes);

    // Voice-optimized speech bitrate tiers: prioritize 64k, 48k, 96k
    const tiers = bitrates || [64000, 48000, 96000];
    const optionTiers = [];
    if (supportedMime) {
        for (const bitrate of tiers) {
            optionTiers.push({ mimeType: supportedMime, audioBitsPerSecond: bitrate });
        }
        optionTiers.push({ mimeType: supportedMime });
    }
    optionTiers.push({}); // Browser native default fallback

    for (const opts of optionTiers) {
        try {
            return new MediaRecorder(stream, opts);
        } catch (err) {
            console.warn('MediaRecorder option tier unavailable, trying fallback:', err);
        }
    }

    return new MediaRecorder(stream);
}
window.createMediaRecorder = createMediaRecorder;
