/**
 * TMA jobs queue, IndexedDB persistence, quota UI (split from app.js, unchanged).
 * Load after: tma_common.js, tma_recorder.js.
 */
// ==========================================
// IndexedDB Zero-Loss Audio Persistence
// ==========================================
const DB_NAME = 'tma_voice_storage';
const DB_VERSION = 1;
const STORE_RECORDINGS = 'recordings';

function openAudioDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
                db.createObjectStore(STORE_RECORDINGS, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbSaveRecording(jobId, blob, name, durationSec) {
    try {
        const db = await openAudioDB();
        const tx = db.transaction(STORE_RECORDINGS, 'readwrite');
        const store = tx.objectStore(STORE_RECORDINGS);
        store.put({
            id: jobId,
            name: name,
            blob: blob,
            mimeType: blob.type || 'audio/webm',
            durationSec: durationSec || 0,
            timestamp: Date.now(),
            uploaded: false
        });
        await new Promise((res, rej) => {
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
        });
    } catch (err) {
        console.warn('IndexedDB save failed:', err);
    }
}

async function dbMarkUploaded(jobId) {
    try {
        const db = await openAudioDB();
        const tx = db.transaction(STORE_RECORDINGS, 'readwrite');
        const store = tx.objectStore(STORE_RECORDINGS);
        const req = store.get(jobId);
        req.onsuccess = () => {
            if (req.result) {
                req.result.uploaded = true;
                store.put(req.result);
            }
        };
    } catch (err) {
        console.warn('IndexedDB mark uploaded failed:', err);
    }
}

async function dbDeleteRecording(jobId) {
    try {
        const db = await openAudioDB();
        const tx = db.transaction(STORE_RECORDINGS, 'readwrite');
        const store = tx.objectStore(STORE_RECORDINGS);
        store.delete(jobId);
    } catch (err) {
        console.warn('IndexedDB delete failed:', err);
    }
}

async function dbGetUnsentRecordings() {
    try {
        const db = await openAudioDB();
        const tx = db.transaction(STORE_RECORDINGS, 'readonly');
        const store = tx.objectStore(STORE_RECORDINGS);
        return new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => {
                const items = (req.result || []).filter(r => !r.uploaded);
                resolve(items);
            };
            req.onerror = () => resolve([]);
        });
    } catch (err) {
        console.warn('IndexedDB read unsent failed:', err);
        return [];
    }
}

function downloadAudioBlob(blob, filename = 'recording.webm') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
}

let currentPlayingAudio = null;
let currentPlayingJobId = null;

function togglePlayAudio(jobId, blob, playBtnEl) {
    if (currentPlayingAudio && currentPlayingJobId === jobId) {
        currentPlayingAudio.pause();
        currentPlayingAudio = null;
        currentPlayingJobId = null;
        if (playBtnEl) playBtnEl.innerHTML = '▶️ Listen';
        return;
    }
    if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        currentPlayingAudio = null;
        currentPlayingJobId = null;
        document.querySelectorAll('.btn-rescue-play').forEach(btn => btn.innerHTML = '▶️ Listen');
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentPlayingAudio = audio;
    currentPlayingJobId = jobId;
    if (playBtnEl) playBtnEl.innerHTML = '⏸ Pause';
    audio.onended = () => {
        currentPlayingAudio = null;
        currentPlayingJobId = null;
        if (playBtnEl) playBtnEl.innerHTML = '▶️ Listen';
        URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
        currentPlayingAudio = null;
        currentPlayingJobId = null;
        if (playBtnEl) playBtnEl.innerHTML = '▶️ Listen';
        URL.revokeObjectURL(url);
        alert('Could not play audio track on this device.');
    };
    audio.play().catch(e => {
        console.warn('Play audio error:', e);
        if (playBtnEl) playBtnEl.innerHTML = '▶️ Listen';
    });
}

async function retryJobUpload(jobId) {
    const job = trackedJobs.find(j => j.task_id === jobId);
    if (!job || !job.audioBlob) {
        alert('Audio data not found in local storage.');
        return;
    }
    job.status = 'uploading';
    job.stage_label = 'Retrying upload to AI...';
    job.progress = 15;
    job.error = null;
    renderJobQueue();
    await uploadAndTranscribeAsync(job.audioBlob, job.recordingName || 'Audio Recording', job);
}

async function restoreUnsentRecordingsFromDB() {
    const unsent = await dbGetUnsentRecordings();
    if (!unsent || unsent.length === 0) return;
    for (const rec of unsent) {
        if (!trackedJobs.some(j => j.task_id === rec.id)) {
            trackedJobs.push({
                task_id: rec.id,
                recordingName: rec.name || 'Saved Recording',
                audioBlob: rec.blob,
                status: 'failed',
                stage_label: 'Saved on device (not sent)',
                progress: 100,
                result: null,
                error: 'Pending upload from previous session'
            });
        }
    }
    renderJobQueue();
}

function updateQuotaUI(quota) {
    if (!quota) return;
    aiQuotaState.isAllowed = quota.is_allowed !== false && quota.remaining_today !== 0;
    aiQuotaState.remaining = quota.remaining_today;
    aiQuotaState.tier = quota.tier;

    if (quotaText) {
        if (quota.remaining_today === null || quota.remaining_today === undefined) {
            quotaText.innerText = '⚡ ∞';
            quotaBadge?.classList.remove('locked');
            if (quotaBadge) quotaBadge.title = 'Необмежений доступ (Admin / Unlimited)';
        } else if (quota.remaining_today <= 0) {
            quotaText.innerText = '🔒 0';
            quotaBadge?.classList.add('locked');
            if (quotaBadge) quotaBadge.title = '🔒 Денний ліміт вичерпано (відновиться о 00:00 UTC)';
        } else {
            quotaText.innerText = `⚡ ${quota.remaining_today}`;
            quotaBadge?.classList.remove('locked');
            if (quotaBadge) quotaBadge.title = `Доступно кредитів: ${quota.remaining_today} (1 хв = 1 кредит)`;
        }
    }

    const isLocked = aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false;
    if (isLocked) {
        btnSummary?.classList.add('locked');
        btnCustomQ?.classList.add('locked');
    } else {
        btnSummary?.classList.remove('locked');
        btnCustomQ?.classList.remove('locked');
    }
}

async function fetchUserQuota() {
    const { userId, initData } = getTelegramUserContext();
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    if (initData) params.append('init_data', initData);

    try {
        const res = await fetch(`${API_BASE_URL}/api/tma/quota?${params.toString()}`);
        if (res.ok) {
            const data = await res.json();
            if (data?.ai_quota) {
                updateQuotaUI(data.ai_quota);
            }
        }
    } catch (err) {
        console.warn('Could not fetch user quota:', err);
    }
}

function showQuotaExhaustedAlert(feature = "ШІ та транскрибації") {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('warning');
    }
    const msg =
        `🔒 Денний ліміт ${feature} вичерпано.\n\n` +
        "Ліміт автоматично оновлюється щодня о 00:00 UTC ⏳\n\n" +
        "💡 Маєте ваучер поповнення? Активуйте його в чаті бота (/start rst_...) або зверніться до адміністратора.";
    if (tg?.showAlert) {
        tg.showAlert(msg);
    } else {
        alert(msg);
    }
}

// Screen Navigation
function getServerStageIdx(job) {
    if (job.status === 'completed' || job.status === 'duplicating') return 4;
    if (job.status === 'diarizing_llm') return 3;
    if (job.status === 'transcribing_groq') return 2;
    return 1;
}

// Advances job.visualStage one step at a time (STAGE_STEP_MS apart) toward the
// server-reported stage, so fast pipelines animate smoothly instead of jumping.
function ensureStageAnimation(job) {
    if (job.status === 'failed') {
        if (job.stageTimer) {
            clearTimeout(job.stageTimer);
            job.stageTimer = null;
        }
        return;
    }
    const serverIdx = getServerStageIdx(job);
    if (job.visualStage === undefined) {
        job.visualStage = Math.min(1, serverIdx);
    }
    if (job.stageTimer || job.visualStage >= serverIdx) return;
    job.stageTimer = setTimeout(() => {
        job.stageTimer = null;
        if (job.visualStage < getServerStageIdx(job)) {
            job.visualStage += 1;
            renderJobQueue();
        }
    }, STAGE_STEP_MS);
}

async function dismissJob(jobId, isUnsent = false) {
    if (currentPlayingJobId === jobId) {
        if (currentPlayingAudio) {
            currentPlayingAudio.pause();
            currentPlayingAudio = null;
        }
        currentPlayingJobId = null;
    }
    trackedJobs = trackedJobs.filter(j => j.task_id !== jobId);
    if (isUnsent) {
        await dbDeleteRecording(jobId);
    }
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('warning');
    }
    showToast(isUnsent ? '🗑️ Recording discarded' : '✓ Removed from list', isUnsent ? '✕' : '✓');
    renderJobQueue();
}

function renderJobQueue() {
    const jobsContainer = document.getElementById('jobs-container');
    const jobsList = document.getElementById('jobs-list');
    const jobsCountBadge = document.getElementById('jobs-count-badge');

    if (!jobsContainer || !jobsList || !jobsCountBadge) return;

    if (trackedJobs.length === 0) {
        jobsContainer.classList.add('hidden');
        return;
    }

    jobsContainer.classList.remove('hidden');
    const activeCount = trackedJobs.filter(j => j.status !== 'completed' && j.status !== 'failed').length;
    jobsCountBadge.innerText = activeCount > 0 ? `${activeCount} processing` : `${trackedJobs.length} total`;

    jobsList.innerHTML = '';

    // Render jobs in reverse order (newest first)
    [...trackedJobs].reverse().forEach((job) => {
        const card = document.createElement('div');
        const isCompleted = job.status === 'completed';
        const isFailed = job.status === 'failed';
        const isUploading = job.status === 'uploading';
        ensureStageAnimation(job);

        const serverStageIdx = getServerStageIdx(job);
        const currentStageIdx = job.visualStage === undefined ? serverStageIdx : job.visualStage;
        const visuallyComplete = isCompleted && currentStageIdx >= 4;
        card.className = `job-card ${visuallyComplete ? 'completed' : isFailed ? 'failed' : 'active-job'}`;

        const displayProgress = currentStageIdx < serverStageIdx
            ? STAGE_PROGRESS[currentStageIdx]
            : Math.min(job.progress || STAGE_PROGRESS[serverStageIdx], 100);
        const displayLabel = currentStageIdx < serverStageIdx
            ? (currentStageIdx === 3 && job.status !== 'diarizing_llm' ? '📤 Finalizing...' : STAGE_LABELS[currentStageIdx])
            : (job.stage_label || 'Processing...');

        const step3Label = job.status === 'diarizing_llm' ? '🧠 Diarize' : '📤 Sync';
        const stepsHtml = `
            <div class="pipeline-steps">
                <span class="pipeline-step ${currentStageIdx > 1 ? 'done' : currentStageIdx === 1 ? 'active' : ''}">📦 Prep</span>
                <span class="pipeline-step ${currentStageIdx > 2 ? 'done' : currentStageIdx === 2 ? 'active' : ''}">🎙️ Groq STT</span>
                <span class="pipeline-step ${currentStageIdx > 3 ? 'done' : currentStageIdx === 3 ? 'active' : ''}">${step3Label}</span>
                <span class="pipeline-step ${currentStageIdx >= 4 ? (isFailed ? 'failed' : 'done') : ''}">✅ Done</span>
            </div>
        `;

        const rescueHtml = isFailed ? `
            <div class="job-rescue-actions">
                ${job.audioBlob ? `
                    <button class="btn-rescue btn-rescue-save" title="Save file to device">
                        📥 Save Audio
                    </button>
                    <button class="btn-rescue btn-rescue-play" title="Listen to recording">
                        ▶️ Listen
                    </button>
                ` : ''}
                <button class="btn-rescue btn-rescue-retry" title="Retry upload to AI">
                    🔄 Retry
                </button>
                <button class="btn-rescue btn-rescue-dismiss" title="Close and discard">
                    ✕ Close
                </button>
            </div>
            <div class="job-mini-confirm hidden">
                <span class="job-mini-confirm-msg">⚠️ Discard unsent recording?</span>
                <div class="job-mini-confirm-actions">
                    <button class="btn-mini-confirm-yes">✓ Yes, delete</button>
                    <button class="btn-mini-confirm-no">Cancel</button>
                </div>
            </div>
        ` : '';

        const completedHtml = visuallyComplete ? `
            <div class="job-view-btn">📄 Open Transcript →</div>
            <div class="job-mini-confirm hidden">
                <span class="job-mini-confirm-msg">Remove from list?</span>
                <div class="job-mini-confirm-actions">
                    <button class="btn-mini-confirm-yes">✓ Yes</button>
                    <button class="btn-mini-confirm-no">Cancel</button>
                </div>
            </div>
        ` : '';

        card.innerHTML = `
            <div class="job-top-row">
                <span class="job-title">🎙️ ${job.recordingName || 'Audio Recording'}</span>
                <div class="job-top-right">
                    <span class="job-status-pill">${visuallyComplete ? '✓ Ready' : isFailed ? '✕ Error' : isUploading ? '🚀 Uploading' : displayProgress + '%'}</span>
                    ${(visuallyComplete || isFailed) ? '<button class="job-card-close-btn" title="Close">✕</button>' : ''}
                </div>
            </div>
            <div class="job-stage-desc">${displayLabel}</div>
            ${!visuallyComplete && !isFailed ? `
                <div class="job-progress-bg">
                    <div class="job-progress-fill" style="width: ${displayProgress}%"></div>
                </div>
            ` : ''}
            ${stepsHtml}
            ${rescueHtml}
            ${completedHtml}
        `;

        const miniConfirm = card.querySelector('.job-mini-confirm');
        const btnConfirmYes = card.querySelector('.btn-mini-confirm-yes');
        const btnConfirmNo = card.querySelector('.btn-mini-confirm-no');
        const btnTopClose = card.querySelector('.job-card-close-btn');
        const rescueActions = card.querySelector('.job-rescue-actions');
        const viewBtn = card.querySelector('.job-view-btn');

        const showConfirmUI = (e) => {
            e.stopPropagation();
            if (rescueActions) rescueActions.classList.add('hidden');
            if (viewBtn) viewBtn.classList.add('hidden');
            if (miniConfirm) miniConfirm.classList.remove('hidden');
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('light');
            }
        };

        const hideConfirmUI = (e) => {
            if (e) e.stopPropagation();
            if (miniConfirm) miniConfirm.classList.add('hidden');
            if (rescueActions) rescueActions.classList.remove('hidden');
            if (viewBtn) viewBtn.classList.remove('hidden');
        };

        if (btnTopClose) {
            btnTopClose.addEventListener('click', showConfirmUI);
        }

        if (btnConfirmNo) {
            btnConfirmNo.addEventListener('click', hideConfirmUI);
        }

        if (btnConfirmYes) {
            btnConfirmYes.addEventListener('click', async (e) => {
                e.stopPropagation();
                await dismissJob(job.task_id, isFailed);
            });
        }

        if (isFailed) {
            const btnSave = card.querySelector('.btn-rescue-save');
            if (btnSave && job.audioBlob) {
                btnSave.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const ext = job.audioBlob.type && job.audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
                    const fname = `${(job.recordingName || 'recording').replace(/\s+/g, '_')}_${job.task_id}.${ext}`;
                    downloadAudioBlob(job.audioBlob, fname);
                });
            }
            const btnPlay = card.querySelector('.btn-rescue-play');
            if (btnPlay && job.audioBlob) {
                btnPlay.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePlayAudio(job.task_id, job.audioBlob, btnPlay);
                });
            }
            const btnRetry = card.querySelector('.btn-rescue-retry');
            if (btnRetry) {
                btnRetry.addEventListener('click', (e) => {
                    e.stopPropagation();
                    retryJobUpload(job.task_id);
                });
            }
            const btnDismiss = card.querySelector('.btn-rescue-dismiss');
            if (btnDismiss) {
                btnDismiss.addEventListener('click', showConfirmUI);
            }
        }

        card.addEventListener('click', () => {
            if (miniConfirm && !miniConfirm.classList.contains('hidden')) {
                hideConfirmUI();
                return;
            }
            if (isCompleted && job.result) {
                currentTranscript = job.result.formatted_text || job.result.raw_text || '';
                transcriptBox.innerText = currentTranscript;
                showScreen(screenResult);
            } else if (isFailed) {
                if (job.error) {
                    alert(`Job notice: ${job.error}`);
                }
            } else {
                showToast('⏳ AI is transcribing audio in background...', '⚡');
            }
        });

        jobsList.appendChild(card);
    });
}

function startPollingTasks() {
    if (pollingIntervalId) return;
    pollingIntervalId = setInterval(pollTaskStatuses, 1500);
}

function stopPollingTasks() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

async function pollTaskStatuses() {
    const activeJobs = trackedJobs.filter(j => j.status !== 'completed' && j.status !== 'failed');
    if (activeJobs.length === 0) {
        stopPollingTasks();
        return;
    }

    const { userId, initData } = getTelegramUserContext();
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    if (initData) params.append('init_data', initData);
    const queryString = params.toString() ? `?${params.toString()}` : '';

    for (const job of activeJobs) {
        if (!job.task_id || job.task_id.startsWith('temp_')) continue;
        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/tasks/${job.task_id}${queryString}`);
            if (res.ok) {
                const data = await res.json();
                const wasCompleted = job.status === 'completed';
                job.status = data.status;
                job.stage_label = data.stage_label;
                job.progress = data.progress;
                job.result = data.result;
                job.error = data.error;

                if (!wasCompleted && data.status === 'completed') {
                    if (tg?.HapticFeedback) {
                        tg.HapticFeedback.notificationOccurred('success');
                    }
                    showToast(`✅ ${job.recordingName || 'Recording'} transcript ready!`, '⚡');
                }
            }
        } catch (err) {
            console.warn('Task status poll error:', err);
        }
    }

    renderJobQueue();
}
