/**
 * TMA Recorder + result screen (split from app.js, behavior unchanged).
 * Load after: tma_common.js, persona_engine.js. Before: tma_jobs.js, tma_dialog.js.
 */
// Initialize Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

// Shared helpers (getUrlParam, API_BASE_URL, escapeHtml, showToast, wake lock,
// mic tiers, MediaRecorder) live in tma_common.js — loaded before this file.
// Display Version Tag
const versionEl = document.getElementById('app-version-tag');
if (versionEl && window.APP_VERSION) {
    versionEl.textContent = `${window.APP_VERSION}`;
}

// UI Elements
const screenRecorder = document.getElementById('recorder-screen');
const screenProcessing = document.getElementById('processing-screen');
const screenResult = document.getElementById('result-screen');

const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const quotaBadge = document.getElementById('quota-badge');
const quotaText = document.getElementById('quota-text');
const timerDisplay = document.getElementById('timer-display');
const canvas = document.getElementById('waveform-canvas');
const canvasCtx = canvas.getContext('2d');

const recordCore = document.getElementById('record-core');
const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const btnEco = document.getElementById('btn-eco');
const iconEcoMoon = document.getElementById('icon-eco-moon');
const iconEcoSun = document.getElementById('icon-eco-sun');
const ecoWakeHint = document.getElementById('eco-wake-hint');
const iconPause = document.getElementById('icon-pause');
const iconPlay = document.getElementById('icon-play');

const btnBack = document.getElementById('btn-back');
const btnCopy = document.getElementById('btn-copy');
const transcriptBox = document.getElementById('transcript-box');

const btnSummary = document.getElementById('btn-summary');
const btnCustomQ = document.getElementById('btn-custom-q');
const aiCard = document.getElementById('ai-response-card');
const aiCardTitle = document.getElementById('ai-card-title');
const aiCardBody = document.getElementById('ai-card-body');
const btnCloseAi = document.getElementById('btn-close-ai');

const questionModal = document.getElementById('question-modal');
const inputCustomQuestion = document.getElementById('input-custom-question');
const btnCancelQ = document.getElementById('btn-cancel-q');
const btnSendQ = document.getElementById('btn-send-q');

// Recording State
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let startTime = 0;
let elapsedTime = 0;
let isPaused = false;
let isEnergySaverActive = false;

// Audio Context & Visualizer State
let audioCtx = null;
let analyser = null;
let dataArray = null;
let animationFrameId = null;
let activeStream = null;
let smoothedHeights = [];
const NUM_VISUALIZER_BARS = 32;

// Current Transcript State
let currentTranscript = '';

// Task Queue State
let trackedJobs = [];
let pollingIntervalId = null;
let recordingCounter = 0;

// AI & Audio Quota State
let aiQuotaState = { isAllowed: true, remaining: null, tier: null };

function showScreen(screen) {
    [screenRecorder, screenProcessing, screenResult].forEach(s => s?.classList.remove('active'));
    screen?.classList.add('active');
}

// Screen Wake Lock lives in tma_common.js (shared holder for recorder + live).

// Energy Saver Mode (OLED pitch black & animation suspension)
function enableEnergySaver() {
    if (isEnergySaverActive) return;
    isEnergySaverActive = true;
    document.body.classList.add('energy-saver-active');
    screenRecorder?.classList.add('energy-saver-active');
    btnEco?.classList.add('active');
    if (iconEcoMoon) iconEcoMoon.classList.add('hidden');
    if (iconEcoSun) iconEcoSun.classList.remove('hidden');
    if (ecoWakeHint) ecoWakeHint.classList.remove('hidden');

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (canvasCtx && canvas) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function disableEnergySaver() {
    if (!isEnergySaverActive) return;
    isEnergySaverActive = false;
    document.body.classList.remove('energy-saver-active');
    screenRecorder?.classList.remove('energy-saver-active');
    btnEco?.classList.remove('active');
    if (iconEcoMoon) iconEcoMoon.classList.remove('hidden');
    if (iconEcoSun) iconEcoSun.classList.add('hidden');
    if (ecoWakeHint) ecoWakeHint.classList.add('hidden');

    if (!animationFrameId) {
        drawWaveform();
    }
}

function toggleEnergySaver() {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    if (isEnergySaverActive) {
        disableEnergySaver();
    } else {
        enableEnergySaver();
    }
}

// Timer
function startTimer() {
    startTime = Date.now() - elapsedTime;
    recordingInterval = setInterval(() => {
        elapsedTime = Date.now() - startTime;
        updateTimerDisplay(elapsedTime);
    }, 1000);
}

function stopTimer() {
    if (recordingInterval) {
        clearInterval(recordingInterval);
        recordingInterval = null;
    }
}

function resetTimer() {
    stopTimer();
    elapsedTime = 0;
    if (timerDisplay) timerDisplay.innerText = '00:00';
}

function updateTimerDisplay(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (timerDisplay) {
        timerDisplay.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

// Audio Visualizer
async function setupAudioVisualizer(stream) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.8;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        smoothedHeights = new Array(NUM_VISUALIZER_BARS).fill(6);
        resizeCanvas();
    } catch (err) {
        console.warn('Audio visualizer setup error:', err);
    }
}

function stopAudioVisualizer() {
    analyser = null;
    dataArray = null;
}

function resizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
    }
}

function drawWaveform() {
    if (isEnergySaverActive) {
        animationFrameId = null;
        return;
    }
    animationFrameId = requestAnimationFrame(drawWaveform);
    if (!canvas || !canvasCtx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    canvasCtx.clearRect(0, 0, width, height);

    const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
    const numBars = NUM_VISUALIZER_BARS;
    const totalGapRatio = 0.35;
    const barWidth = (width / numBars) * (1 - totalGapRatio);
    const gap = (width / numBars) * totalGapRatio;

    if (isRecording && analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
    }

    const time = Date.now() * 0.003;

    for (let i = 0; i < numBars; i++) {
        let targetH = 6;
        if (isRecording && dataArray) {
            const sampleIdx = Math.floor((i / numBars) * Math.min(dataArray.length, 48));
            const val = dataArray[sampleIdx] || 0;
            targetH = Math.max(6, (val / 255) * (height * 0.85));
        } else if (isPaused) {
            targetH = 6;
        } else {
            // Ambient idle wave animation so container is never empty square
            const sine = Math.sin(time + i * 0.25);
            const cosine = Math.cos(time * 0.7 + i * 0.15);
            targetH = 8 + (sine + cosine) * 3;
        }

        if (!smoothedHeights[i]) smoothedHeights[i] = 6;
        smoothedHeights[i] = smoothedHeights[i] * 0.65 + targetH * 0.35;
        const currentH = smoothedHeights[i];

        const x = i * (barWidth + gap) + gap / 2;
        const y = (height - currentH) / 2;
        const radius = Math.min(barWidth / 2, currentH / 2);

        const gradient = canvasCtx.createLinearGradient(0, y, 0, y + currentH);
        if (isRecording) {
            gradient.addColorStop(0, '#60a5fa');
            gradient.addColorStop(0.5, '#3b82f6');
            gradient.addColorStop(1, '#8b5cf6');
        } else if (isPaused) {
            gradient.addColorStop(0, '#fbbf24');
            gradient.addColorStop(1, '#f59e0b');
        } else {
            // Soft ambient wave colors when waiting/idle
            gradient.addColorStop(0, 'rgba(96, 165, 250, 0.45)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.25)');
        }

        canvasCtx.fillStyle = gradient;
        canvasCtx.beginPath();
        if (canvasCtx.roundRect) {
            canvasCtx.roundRect(x, y, barWidth, currentH, radius);
        } else {
            canvasCtx.rect(x, y, barWidth, currentH);
        }
        canvasCtx.fill();
    }
}

// Audio Stream Acquisition (tiers live in tma_common.js; cache stays here so the
// mic permission survives across recordings without re-requesting).
async function getAudioStream() {
    if (activeStream && activeStream.active && activeStream.getAudioTracks().some(t => t.readyState === 'live')) {
        return activeStream;
    }

    activeStream = await requestMicStream('clean');
    return activeStream;
}

function releaseAudioStream() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
    }
}

window.addEventListener('beforeunload', releaseAudioStream);

// createMediaRecorder lives in tma_common.js (shared adaptive-bitrate helper).

// Start Recording
async function startRecording() {
    try {
        const stream = await getAudioStream();

        mediaRecorder = createMediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // Keep persistentStream active to avoid re-requesting mic permission on next record!
            stopAudioVisualizer();
            releaseWakeLock();
        };

        mediaRecorder.start(1000);
        await requestWakeLock();
        await setupAudioVisualizer(stream);

        isPaused = false;
        startTimer();

        // UI Updates
        btnRecord.classList.add('recording');
        if (recordCore) recordCore.classList.add('hidden');
        iconPause.classList.remove('hidden');
        iconPlay.classList.add('hidden');
        btnStop.classList.remove('hidden');
        btnEco?.classList.remove('hidden');

        statusBadge.className = 'status-badge recording';
        statusText.innerText = 'Recording...';

    } catch (err) {
        alert('Failed to access microphone: ' + err.message);
    }
}

// Pause / Resume Recording
function togglePause() {
    if (!mediaRecorder) return;

    if (!isPaused) {
        mediaRecorder.pause();
        stopTimer();
        isPaused = true;

        iconPause.classList.add('hidden');
        iconPlay.classList.remove('hidden');

        statusBadge.className = 'status-badge paused';
        statusText.innerText = 'Paused';
    } else {
        mediaRecorder.resume();
        startTimer();
        isPaused = false;

        iconPause.classList.remove('hidden');
        iconPlay.classList.add('hidden');

        statusBadge.className = 'status-badge recording';
        statusText.innerText = 'Recording...';
    }
}

// Toast helper lives in tma_common.js (window.showToast).

// Job Queue & Pipeline Tracker UI
const STAGE_STEP_MS = 500; // Artificial minimum time per pipeline step for smooth animation
const STAGE_LABELS = {
    1: '📦 Preparing audio...',
    2: '🎙️ Transcribing with Groq STT...',
    3: '🧠 Identifying speakers...',
    4: '✅ Finalizing...'
};
const STAGE_PROGRESS = { 1: 25, 2: 50, 3: 75, 4: 100 };

// Stop Recording with instant visual feedback and optimistic task queue entry
async function stopRecording() {
    if (!mediaRecorder) return;

    recordingCounter += 1;
    const recName = `Rec #${recordingCounter}`;

    // 1. Trigger tactile haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    // 2. Animate visualizer container dispatch pulse
    const visContainer = document.querySelector('.visualizer-container');
    if (visContainer) {
        visContainer.classList.add('dispatching');
        setTimeout(() => visContainer.classList.remove('dispatching'), 600);
    }

    // 3. Update status badge to uploading state
    statusBadge.className = 'status-badge uploading';
    statusText.innerText = '🚀 Uploading audio...';
    setTimeout(() => {
        if (statusBadge.classList.contains('uploading')) {
            statusBadge.className = 'status-badge';
            statusText.innerText = 'Ready to record';
        }
    }, 2000);

    // 4. Show instant toast notification
    showToast('🎙️ Audio sent to processing queue', '🚀');

    stopTimer();
    const recordedSec = Math.max(1, Math.round(elapsedTime / 1000));

    // Wait cleanly for onstop event to ensure all audio chunks are fully committed
    const stoppedPromise = new Promise(resolve => {
        mediaRecorder.onstop = () => {
            stopAudioVisualizer();
            releaseWakeLock();
            resolve();
        };
    });
    mediaRecorder.stop();
    await stoppedPromise;

    btnRecord.classList.remove('recording');
    if (recordCore) recordCore.classList.remove('hidden');
    iconPause.classList.add('hidden');
    iconPlay.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnEco?.classList.add('hidden');
    disableEnergySaver();

    resetTimer();
    showScreen(screenRecorder); // Stay on recorder screen so user can record again immediately!

    // 5. Create optimistic pending job entry immediately
    const tempId = 'temp_' + Date.now();
    const mimeType = mediaRecorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });

    // Save to local IndexedDB storage before any network request
    await dbSaveRecording(tempId, audioBlob, recName, recordedSec);

    const optimisticJob = {
        task_id: tempId,
        recordingName: recName,
        audioBlob: audioBlob,
        status: 'uploading',
        stage_label: 'Uploading audio to server...',
        progress: 15,
        result: null,
        error: null
    };
    trackedJobs.push(optimisticJob);
    renderJobQueue();

    // 6. Upload audio
    await uploadAndTranscribeAsync(audioBlob, recName, optimisticJob);
}

// getTelegramUserContext lives in tma_common.js.

// API Calls
async function uploadAndTranscribeAsync(blob, recordingName, existingJob = null) {
    const { userId, initData } = getTelegramUserContext();
    const formData = new FormData();
    const ext = blob.type && blob.type.includes('mp4') ? 'recording.mp4' : 'recording.webm';
    formData.append('file', blob, ext);
    if (userId) formData.append('user_id', userId);
    if (initData) formData.append('init_data', initData);
    formData.append('do_diarize', 'false');

    try {
        if (!navigator.onLine) {
            throw new Error("No internet connection (offline). Audio safely saved on device!");
        }

        const res = await fetch(`${API_BASE_URL}/api/tma/transcribe-async`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            if (res.status === 429) {
                updateQuotaUI({ is_allowed: false, remaining_today: 0 });
                if (tg?.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('error');
                }
            }
            if (res.status === 413) {
                throw new Error("Recording exceeds server upload limit (413). Audio safely saved locally!");
            }
            throw new Error(data?.detail || `Server error (${res.status})`);
        }

        // Mark as uploaded in IndexedDB
        if (existingJob) {
            await dbMarkUploaded(existingJob.task_id);
        }
        if (data?.task_id) {
            await dbMarkUploaded(data.task_id);
        }

        // Refresh quota after successful upload
        fetchUserQuota();

        if (!data || !data.task_id) {
            throw new Error("Invalid response from async transcribe API.");
        }

        if (existingJob) {
            existingJob.task_id = data.task_id;
            existingJob.status = data.status || 'queued';
            existingJob.stage_label = data.stage_label || 'Queued for processing...';
            existingJob.progress = data.progress || 20;
        } else {
            const newJob = {
                task_id: data.task_id,
                recordingName: recordingName,
                audioBlob: blob,
                status: data.status || 'queued',
                stage_label: data.stage_label || 'Queued for processing...',
                progress: data.progress || 20,
                result: null,
                error: null
            };
            trackedJobs.push(newJob);
        }

        renderJobQueue();
        startPollingTasks();

    } catch (err) {
        console.error('Async upload failed:', err);
        let userMsg = err.message || 'Upload failed';
        if (!navigator.onLine || userMsg.includes('Failed to fetch') || userMsg.includes('NetworkError')) {
            userMsg = 'Network connection lost during upload. Audio saved safely on device!';
        }

        if (existingJob) {
            existingJob.status = 'failed';
            existingJob.stage_label = 'Upload failed (Audio saved)';
            existingJob.progress = 100;
            existingJob.error = userMsg;
            existingJob.audioBlob = blob;
        } else {
            trackedJobs.push({
                task_id: 'err_' + Date.now(),
                recordingName: recordingName,
                audioBlob: blob,
                status: 'failed',
                stage_label: 'Upload failed (Audio saved)',
                progress: 100,
                error: userMsg
            });
        }
        renderJobQueue();
    }
}

async function uploadAndTranscribe(blob) {
    return uploadAndTranscribeAsync(blob, 'Recording');
}


async function requestSummary() {
    if (!currentTranscript) return;

    if (aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false) {
        showQuotaExhaustedAlert("генерації Summary");
        return;
    }

    aiCard.classList.remove('hidden');
    aiCardTitle.innerText = '📝 Summary';
    aiCardBody.innerText = 'Generating summary...';

    const { userId, initData } = getTelegramUserContext();
    const payload = { text: currentTranscript };
    if (userId) payload.user_id = userId;
    if (initData) payload.init_data = initData;

    try {
        const res = await fetch(`${API_BASE_URL}/api/tma/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            if (res.status === 429) {
                updateQuotaUI({ is_allowed: false, remaining_today: 0 });
                if (tg?.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('error');
                }
            }
            throw new Error(data?.detail || `Server error (${res.status})`);
        }

        aiCardBody.innerText = data?.summary || "No summary returned.";
        fetchUserQuota();
    } catch (err) {
        aiCardBody.innerText = err.message;
    }
}

async function sendCustomQuestion() {
    const q = inputCustomQuestion.value.trim();
    if (!q || !currentTranscript) return;

    if (aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false) {
        showQuotaExhaustedAlert("відповідей на питання");
        return;
    }

    questionModal.classList.add('hidden');
    aiCard.classList.remove('hidden');
    aiCardTitle.innerText = `❓ Question: "${q}"`;
    aiCardBody.innerText = 'Thinking...';

    const { userId, initData } = getTelegramUserContext();
    const payload = { text: currentTranscript, question: q };
    if (userId) payload.user_id = userId;
    if (initData) payload.init_data = initData;

    try {
        const res = await fetch(`${API_BASE_URL}/api/tma/custom-question`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            if (res.status === 429) {
                updateQuotaUI({ is_allowed: false, remaining_today: 0 });
                if (tg?.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('error');
                }
            }
            throw new Error(data?.detail || `Server error (${res.status})`);
        }

        aiCardBody.innerText = data?.answer || "No answer returned.";
        inputCustomQuestion.value = '';
        fetchUserQuota();
    } catch (err) {
        aiCardBody.innerText = err.message;
    }
}

// Event Listeners
btnRecord.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        togglePause();
        return;
    }

    if (aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false) {
        showQuotaExhaustedAlert("запису та транскрибації");
        return;
    }

    resetTimer();
    startRecording();
});

btnStop.addEventListener('click', stopRecording);

if (btnEco) {
    btnEco.addEventListener('click', toggleEnergySaver);
}
if (ecoWakeHint) {
    ecoWakeHint.addEventListener('click', disableEnergySaver);
}
screenRecorder?.addEventListener('click', (e) => {
    if (!isEnergySaverActive) return;
    if (e.target.closest('#btn-record, #btn-stop, #btn-eco')) {
        return;
    }
    disableEnergySaver();
});

btnBack.addEventListener('click', () => {
    resetTimer();
    statusBadge.className = 'status-badge';
    statusText.innerText = 'Ready to record';
    aiCard.classList.add('hidden');
    questionModal.classList.add('hidden');
    showScreen(screenRecorder);
});

btnCopy.addEventListener('click', () => {
    if (currentTranscript) {
        navigator.clipboard.writeText(currentTranscript);
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }
        btnCopy.innerText = 'Copied!';
        setTimeout(() => { btnCopy.innerText = 'Copy'; }, 2000);
    }
});

btnSummary.addEventListener('click', requestSummary);

btnCustomQ.addEventListener('click', () => {
    if (aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false) {
        showQuotaExhaustedAlert("відповідей на питання");
        return;
    }
    questionModal.classList.remove('hidden');
    inputCustomQuestion.focus();
});

btnCancelQ.addEventListener('click', () => {
    questionModal.classList.add('hidden');
});

btnSendQ.addEventListener('click', sendCustomQuestion);

btnCloseAi.addEventListener('click', () => {
    aiCard.classList.add('hidden');
});

if (quotaBadge) {
    quotaBadge.addEventListener('click', async () => {
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
        await fetchUserQuota();
        const rem = aiQuotaState.remaining;
        const msg = (rem === null || rem === undefined)
            ? "⚡ У вас необмежений доступ (Admin / Unlimited)!"
            : rem <= 0
            ? "🔒 Денний ліміт вичерпано. Оновиться о 00:00 UTC або за ваучером /start rst_..."
            : `⚡ Залишилось кредитів на сьогодні: ${rem}\n\n🎙️ 1 хв аудіо = 1 кредит\n📝 1000 символів тексту = 1 кредит`;
        if (tg?.showAlert) {
            tg.showAlert(msg);
        } else {
            alert(msg);
        }
    });
}

// Re-fetch quota on focus / visibility change
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        fetchUserQuota();
    }
});
window.addEventListener('focus', fetchUserQuota);

// Initial quota fetch & unsent audio restore from IndexedDB
fetchUserQuota();
restoreUnsentRecordingsFromDB();

// Network connectivity monitoring
window.addEventListener('online', () => {
    showToast('🌐 Network connection restored', '✅');
});
window.addEventListener('offline', () => {
    showToast('📡 You are offline. Recordings are saved locally.', '⚠️');
});

// Initialize visualizer loop and window resize handler
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
drawWaveform();
