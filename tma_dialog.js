/**
 * TMA DialogModeManager (walkie-talkie PTT + chats). Split from app.js, unchanged.
 * Load after: tma_common.js, persona_engine.js, tma_recorder.js, tma_jobs.js.
 */
/* ==========================================================================
   LIVE DIALOGUE & WALKIE-TALKIE MANAGER (ADMIN ONLY)
   ========================================================================== */

class DialogModeManager {
    constructor() {
        this.isAdmin = false;
        this.activeChatId = null;
        this.chats = [];
        this.session = null;
        this.isRecording = false;
        this.isStartingRecording = false;
        this.stopRequested = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordStartTime = 0;
        this.stream = null;

        // Elements
        this.tabsContainer = document.getElementById('app-mode-tabs');
        this.tabRecorder = document.getElementById('tab-recorder');
        this.tabDialog = document.getElementById('tab-dialog');
        this.tabLive = document.getElementById('tab-live');
        this.screenDialog = document.getElementById('dialog-screen');
        this.screenLive = document.getElementById('live-screen');

        this.chatPickerBtn = document.getElementById('btn-dialog-select-chat');
        this.activeChatTitleEl = document.getElementById('dialog-active-chat-title');
        this.contextChip = document.getElementById('dialog-context-chip');
        this.contextTokensEl = document.getElementById('dialog-context-tokens');

        this.feedEl = document.getElementById('dialog-messages-feed');
        this.btnTalk = document.getElementById('btn-dialog-talk');
        this.visualizerRing = document.getElementById('dialog-audio-visualizer-ring');
        this.statusHint = document.getElementById('dialog-status-hint');

        this.textInput = document.getElementById('dialog-text-input');
        this.btnSendText = document.getElementById('btn-dialog-send-text');

        this.modal = document.getElementById('dialog-chat-modal');
        this.modalCloseBtn = document.getElementById('btn-dialog-close-modal');
        this.modalChatsList = document.getElementById('dialog-chats-list');
        this.modalNewBtn = document.getElementById('btn-dialog-modal-new');
        this.modalRenameBtn = document.getElementById('btn-dialog-modal-rename');
        this.modalDelBtn = document.getElementById('btn-dialog-modal-del');
        this.btnDialogExport = document.getElementById('btn-dialog-export');

        // Context Stats Modal Elements
        this.statsModal = document.getElementById('dialog-stats-modal');
        this.btnCloseStatsModal = document.getElementById('btn-dialog-close-stats-modal');
        this.btnCloseStatsAction = document.getElementById('btn-dialog-close-stats-action');
        this.btnCopyStatsSummary = document.getElementById('btn-copy-stats-summary');
        this.statFreshTokens = document.getElementById('stat-fresh-tokens');
        this.statSummaryTokens = document.getElementById('stat-summary-tokens');
        this.statTotalTokens = document.getElementById('stat-total-tokens');
        this.statSummaryText = document.getElementById('dialog-stats-summary-text');
        this.statTitle = document.getElementById('dialog-stats-title');
        this.btnPersonaChip = document.getElementById('btn-dialog-persona-chip');
        this.personaChipText = document.getElementById('dialog-persona-chip-text');
        this.lastExportAt = 0;
        this.currentAudio = null;
        this.currentPlayingBtn = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAdminAndLoadState();
    }

    bindEvents() {
        if (this.tabRecorder) {
            this.tabRecorder.addEventListener('click', () => this.switchAppMode('recorder'));
        }
        if (this.tabDialog) {
            this.tabDialog.addEventListener('click', () => this.switchAppMode('dialog'));
        }
        if (this.tabLive) {
            this.tabLive.addEventListener('click', () => this.switchAppMode('live'));
        }

        // Push-to-Talk Events with Pointer Events & Capture (Instant mobile responsiveness)
        if (this.btnTalk) {
            this.btnTalk.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                try {
                    this.btnTalk.setPointerCapture(e.pointerId);
                } catch (_) {}
                this.startRecording();
            });

            const handlePointerRelease = (e) => {
                try {
                    if (this.btnTalk.hasPointerCapture(e.pointerId)) {
                        this.btnTalk.releasePointerCapture(e.pointerId);
                    }
                } catch (_) {}
                this.stopRecordingAndSend();
            };

            this.btnTalk.addEventListener('pointerup', handlePointerRelease);
            this.btnTalk.addEventListener('pointercancel', handlePointerRelease);
        }

        // Text input send
        if (this.btnSendText && this.textInput) {
            this.btnSendText.addEventListener('click', () => this.sendTextMessage());
            this.textInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.sendTextMessage();
            });
        }

        // Chat Picker Modal
        if (this.chatPickerBtn) {
            this.chatPickerBtn.addEventListener('click', () => this.openChatsModal());
        }
        if (this.modalCloseBtn) {
            this.modalCloseBtn.addEventListener('click', () => this.closeChatsModal());
        }
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) this.closeChatsModal();
            });
        }
        if (this.modalNewBtn) {
            this.modalNewBtn.addEventListener('click', () => this.handleNewChat());
        }
        if (this.modalRenameBtn) {
            this.modalRenameBtn.addEventListener('click', () => this.handleRenameChat());
        }
        if (this.modalDelBtn) {
            this.modalDelBtn.addEventListener('click', () => this.handleDeleteChat());
        }

        // Context stats breakdown click
        if (this.contextChip) {
            const openStats = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showContextStatsModal();
            };
            this.contextChip.addEventListener('click', openStats);
            this.contextChip.addEventListener('touchend', openStats);
        }
        if (this.btnCloseStatsModal) {
            this.btnCloseStatsModal.addEventListener('click', () => this.closeStatsModal());
        }
        if (this.btnCloseStatsAction) {
            this.btnCloseStatsAction.addEventListener('click', () => this.closeStatsModal());
        }
        if (this.statsModal) {
            this.statsModal.addEventListener('click', (e) => {
                if (e.target === this.statsModal) this.closeStatsModal();
            });
        }
        if (this.btnCopyStatsSummary) {
            this.btnCopyStatsSummary.addEventListener('click', () => {
                const text = this.statSummaryText?.textContent || '';
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(() => {
                        showToast('📋 Summary скопійовано', '✅');
                    }).catch(() => {
                        showToast('Не вдалося скопіювати', '⚠️');
                    });
                }
            });
        }

        // Export dialog history
        if (this.btnDialogExport) {
            this.btnDialogExport.addEventListener('click', () => this.exportDialogTranscript());
        }

        // Persona & Scenario Selector
        if (this.btnPersonaChip) {
            const openPersona = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof window.openPersonaModal === 'function') {
                    window.openPersonaModal();
                }
            };
            this.btnPersonaChip.addEventListener('click', openPersona);
            this.btnPersonaChip.addEventListener('touchend', openPersona);
        }
        window.addEventListener('tma_persona_changed', () => this.updateHeaderUI());
    }

    getAuthParams() {
        const initData = tg?.initData || getUrlParam('init_data') || '';
        const userId = tg?.initDataUnsafe?.user?.id || getUrlParam('user_id') || '';
        return { initData, userId };
    }

    async checkAdminAndLoadState() {
        const { initData, userId } = this.getAuthParams();
        try {
            const res = await fetch(
                `${API_BASE_URL}/api/tma/dialog/state?init_data=${encodeURIComponent(initData)}&user_id=${encodeURIComponent(userId)}`
            );
            if (!res.ok) return;
            const data = await res.json();
            if (!data.is_admin) return;

            this.isAdmin = true;
            this.chats = data.state?.chats || [];
            this.activeChatId = data.state?.active_chat_id || 'chat_1';
            this.session = data.active_session;

            // Show mode navigation tabs
            if (this.tabsContainer) {
                this.tabsContainer.classList.remove('hidden');
            }
            this.updateHeaderUI();
            this.renderMessages();
            this.updateExportButtonState();

            // Auto-switch mode if specified in URL query / hash (e.g. ?mode=live or #mode=live from continuation link)
            const requestedMode = getUrlParam('mode');
            if (requestedMode && (requestedMode === 'live' || requestedMode === 'dialog')) {
                this.switchAppMode(requestedMode);
            }
        } catch (e) {
            console.log('[DialogMode] Admin check skipped or failed:', e);
        }
    }

    switchAppMode(mode) {
        // Strict guard for admin-only modes
        if (mode !== 'recorder' && !this.isAdmin) {
            console.warn('[ModeManager] Access denied: admin permissions required for mode:', mode);
            return;
        }

        // Disconnect live stream if leaving live mode
        if (mode !== 'live' && window.liveStreamManager?.isConnected) {
            window.liveStreamManager.disconnect();
        }

        // Screen Wake Lock handling across modes
        const isAudioRecording = typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording';
        if (mode === 'dialog' || mode === 'live') {
            requestWakeLock();
        } else if (mode === 'recorder' && !isAudioRecording) {
            releaseWakeLock();
        }

        // Hide all screens
        screenRecorder?.classList.remove('active');
        screenProcessing?.classList.remove('active');
        screenResult?.classList.remove('active');
        this.screenDialog?.classList.remove('active');
        this.screenLive?.classList.remove('active');

        // Reset tab buttons
        this.tabRecorder?.classList.remove('active');
        this.tabDialog?.classList.remove('active');
        this.tabLive?.classList.remove('active');

        if (mode === 'dialog') {
            this.screenDialog?.classList.add('active');
            this.tabDialog?.classList.add('active');
            this.scrollToBottom();
        } else if (mode === 'live') {
            this.screenLive?.classList.add('active');
            this.tabLive?.classList.add('active');
        } else {
            screenRecorder?.classList.add('active');
            this.tabRecorder?.classList.add('active');
        }
        tg?.HapticFeedback?.selectionChanged();
    }

    updateHeaderUI() {
        if (this.personaChipText && window.personaEngine) {
            this.personaChipText.textContent = window.personaEngine.getActiveTitle();
        }
        if (!this.session) return;
        if (this.activeChatTitleEl) {
            this.activeChatTitleEl.textContent = this.session.title || 'Головний чат';
        }
        if (this.contextTokensEl) {
            const totalTok = this.session.tokens?.total || 0;
            this.contextTokensEl.textContent = `~${totalTok} tok`;
        }
    }

    renderMessages() {
        if (!this.feedEl || !this.session) return;
        const messages = this.session.messages || [];
        const summary = this.session.summary || '';
        const summarizedCount = this.session.summarized_count || 0;

        if (messages.length === 0 && !summary) {
            this.feedEl.innerHTML = `
                <div class="dialog-welcome-bubble">
                    <div class="welcome-icon">📻</div>
                    <h4>Режим Рації (${this.session.title || 'Головний чат'})</h4>
                    <p>Затискай кнопку мікрофона і говори. Бот миттєво відповість голосом.</p>
                </div>
            `;
            this.updateExportButtonState();
            return;
        }

        this.feedEl.innerHTML = '';
        if (summary) {
            this.appendSummaryBubble(summary, summarizedCount);
        }
        messages.forEach((msg) => {
            this.appendMessageBubble(msg.role, msg.content, null);
        });
        this.updateExportButtonState();
        this.scrollToBottom();
    }

    appendSummaryBubble(summary, count = 0) {
        if (!this.feedEl || !summary) return;
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'dialog-msg system-summary';
        summaryDiv.id = 'dialog-system-summary';
        summaryDiv.innerHTML = `
            <div class="system-summary-bubble">
                <div class="system-summary-header">
                    <span class="system-summary-icon">🧠</span>
                    <span>Пам'ять бесіди ${count > 0 ? `(${count} згорнуто)` : ''}</span>
                </div>
                <div class="system-summary-body">${escapeHtml(summary)}</div>
            </div>
        `;
        this.feedEl.appendChild(summaryDiv);
    }

    appendMessageBubble(role, content, audioBase64 = null, latencyMs = null) {
        if (!this.feedEl) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `dialog-msg ${role}`;

        let audioControlHtml = '';
        if (role === 'assistant' && audioBase64) {
            audioControlHtml = `
                <div class="dialog-audio-bar">
                    <button class="btn-replay-audio" data-audio="${audioBase64}">
                        ▶️ Слухати
                    </button>
                    ${latencyMs ? `<span class="dialog-latency-badge">⚡ ${(latencyMs / 1000).toFixed(1)}s</span>` : ''}
                </div>
            `;
        }

        msgDiv.innerHTML = `
            <div class="dialog-bubble">${escapeHtml(content)}</div>
            ${audioControlHtml}
        `;

        const replayBtn = msgDiv.querySelector('.btn-replay-audio');
        if (replayBtn) {
            replayBtn.addEventListener('click', () => {
                this.playBase64Audio(replayBtn.dataset.audio, 'audio/ogg', replayBtn);
            });
        }

        this.feedEl.appendChild(msgDiv);
        this.scrollToBottom();
        return msgDiv;
    }

    stopAudio() {
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            } catch (e) {
                console.log('[DialogMode] Error pausing audio:', e);
            }
            this.currentAudio = null;
        }
        if (this.currentPlayingBtn) {
            this.currentPlayingBtn.innerHTML = '▶️ Слухати';
            this.currentPlayingBtn.classList.remove('playing');
            this.currentPlayingBtn = null;
        }
    }

    playBase64Audio(base64Data, mimeType = 'audio/ogg', triggerBtn = null) {
        if (!base64Data) return;

        // If clicking the button that is already playing, pause/stop it
        if (triggerBtn && this.currentPlayingBtn === triggerBtn && this.currentAudio && !this.currentAudio.paused) {
            this.stopAudio();
            return;
        }

        // Stop any currently playing audio so only 1 audio plays at a time
        this.stopAudio();

        try {
            const audio = new Audio(`data:${mimeType};base64,${base64Data}`);
            this.currentAudio = audio;

            if (triggerBtn) {
                this.currentPlayingBtn = triggerBtn;
                triggerBtn.innerHTML = '⏹ Зупинити';
                triggerBtn.classList.add('playing');
            }

            audio.onended = () => {
                this.stopAudio();
            };

            audio.onerror = (e) => {
                console.error('[DialogMode] Audio playback error:', e);
                this.stopAudio();
            };

            audio.play().catch((err) => {
                console.log('[DialogMode] Autoplay failed or blocked:', err);
                this.stopAudio();
            });
        } catch (e) {
            console.error('[DialogMode] Error initializing audio:', e);
            this.stopAudio();
        }
    }

    scrollToBottom() {
        if (this.feedEl) {
            this.feedEl.scrollTop = this.feedEl.scrollHeight;
        }
    }

    async getDialogAudioStream() {
        if (this.stream && this.stream.active && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) {
            return this.stream;
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000, min: 16000 }
            }
        });
        return this.stream;
    }

    async startRecording() {
        this.stopAudio();
        if (this.isRecording || this.isStartingRecording) return;
        this.isStartingRecording = true;
        this.stopRequested = false;

        // Provide immediate visual and haptic feedback on touch down!
        this.btnTalk.classList.add('recording');
        this.visualizerRing.classList.add('recording');
        this.statusHint.textContent = '🎙 Слухаю... Говори (відпусти для надсилання)';
        tg?.HapticFeedback?.impactOccurred('medium');

        try {
            this.audioChunks = [];
            const stream = await this.getDialogAudioStream();

            // Check if user already released button while getUserMedia was resolving
            if (this.stopRequested) {
                this.isStartingRecording = false;
                this.stopRequested = false;
                this.btnTalk.classList.remove('recording');
                this.visualizerRing.classList.remove('recording');
                this.statusHint.textContent = '⏱ Занадто коротко. Затисни і говори.';
                return;
            }

            // Create MediaRecorder with adaptive MIME support
            const mimeCandidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', ''];
            const supportedMime = mimeCandidates.find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m))) || '';
            const options = supportedMime ? { mimeType: supportedMime } : {};

            this.mediaRecorder = new MediaRecorder(stream, options);
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.start(100);
            this.isRecording = true;
            this.isStartingRecording = false;
            this.recordStartTime = Date.now();
        } catch (e) {
            this.isStartingRecording = false;
            this.isRecording = false;
            this.btnTalk.classList.remove('recording');
            this.visualizerRing.classList.remove('recording');
            console.error('[DialogMode] Mic access denied:', e);
            showToast('⚠️ Доступ до мікрофона заблоковано', '⛔️');
        }
    }

    async stopRecordingAndSend() {
        if (this.isStartingRecording) {
            this.stopRequested = true;
            return;
        }

        if (!this.isRecording || !this.mediaRecorder) return;
        this.isRecording = false;

        const duration = Date.now() - this.recordStartTime;
        this.btnTalk.classList.remove('recording');
        this.visualizerRing.classList.remove('recording');

        // Stop media recorder without stopping hardware mic tracks (keeps mic warm for next press!)
        try {
            if (this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
        } catch (e) {
            console.warn('[DialogMode] Error stopping MediaRecorder:', e);
        }

        if (duration < 400) {
            this.statusHint.textContent = '⏱ Занадто коротко. Затисни і говори.';
            return;
        }

        this.btnTalk.classList.add('processing');
        this.statusHint.textContent = '⚡ Groq обробляє відповідь...';
        tg?.HapticFeedback?.impactOccurred('light');

        // Wait a tiny bit for the last chunk
        await new Promise((r) => setTimeout(r, 100));

        const mime = this.mediaRecorder?.mimeType || 'audio/ogg; codecs=opus';
        const audioBlob = new Blob(this.audioChunks, { type: mime });
        await this.uploadVoiceTurn(audioBlob);
    }

    async uploadVoiceTurn(audioBlob) {
        const { initData, userId } = this.getAuthParams();
        const formData = new FormData();
        formData.append('file', audioBlob, 'dialog_turn.ogg');
        if (initData) formData.append('init_data', initData);
        if (userId) formData.append('user_id', userId);
        if (this.activeChatId) formData.append('chat_id', this.activeChatId);

        if (window.personaEngine) {
            const systemPrompt = window.personaEngine.buildPersonaPrompt(null, 'walkie_talkie');
            if (systemPrompt) formData.append('system_prompt', systemPrompt);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/voice`, {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Server error');
            }

            const data = await res.json();
            this.handleTurnSuccess(data);
        } catch (e) {
            console.error('[DialogMode] Voice turn error:', e);
            showToast(`⚠️ Помилка: ${e.message}`, '❌');
            this.statusHint.textContent = 'Спробуй ще раз';
        } finally {
            this.btnTalk.classList.remove('processing');
            this.statusHint.textContent = 'Натисни або затисни, щоб говорити';
        }
    }

    async sendTextMessage() {
        this.stopAudio();
        const text = this.textInput.value.trim();
        if (!text) return;
        this.textInput.value = '';
        this.btnSendText.disabled = true;

        this.statusHint.textContent = '⚡ Groq генерує голосову відповідь...';
        const { initData, userId } = this.getAuthParams();
        const systemPrompt = window.personaEngine
            ? window.personaEngine.buildPersonaPrompt(null, 'walkie_talkie')
            : null;

        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                    chat_id: this.activeChatId,
                    system_prompt: systemPrompt || undefined,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Server error');
            }

            const data = await res.json();
            this.handleTurnSuccess(data);
        } catch (e) {
            console.error('[DialogMode] Text turn error:', e);
            showToast(`⚠️ Помилка: ${e.message}`, '❌');
        } finally {
            this.btnSendText.disabled = false;
            this.statusHint.textContent = 'Натисни або затисни, щоб говорити';
        }
    }

    handleTurnSuccess(data) {
        this.appendMessageBubble('user', data.user_text);
        const asstBubble = this.appendMessageBubble('assistant', data.reply_text, data.audio_base64, data.latency_ms);

        if (data.audio_base64) {
            const replayBtn = asstBubble?.querySelector?.('.btn-replay-audio');
            this.playBase64Audio(data.audio_base64, data.audio_mime || 'audio/ogg', replayBtn);
        }

        if (data.tokens) {
            if (this.session) {
                this.session.tokens = data.tokens;
            }
            if (this.contextTokensEl) {
                this.contextTokensEl.textContent = `~${data.tokens.total} tok`;
            }
        }

        if (data.summary && this.session) {
            const hadSummary = Boolean(this.session.summary);
            this.session.summary = data.summary;
            if (data.summarized_count) {
                this.session.summarized_count = data.summarized_count;
            }
            const existingSummaryEl = document.getElementById('dialog-system-summary');
            if (existingSummaryEl) {
                const bodyEl = existingSummaryEl.querySelector('.system-summary-body');
                if (bodyEl) bodyEl.textContent = data.summary;
            } else if (!hadSummary) {
                const summaryDiv = document.createElement('div');
                summaryDiv.className = 'dialog-msg system-summary';
                summaryDiv.id = 'dialog-system-summary';
                summaryDiv.innerHTML = `
                    <div class="system-summary-bubble">
                        <div class="system-summary-header">
                            <span class="system-summary-icon">🧠</span>
                            <span>Пам'ять бесіди ${data.summarized_count > 0 ? `(${data.summarized_count} згорнуто)` : ''}</span>
                        </div>
                        <div class="system-summary-body">${escapeHtml(data.summary)}</div>
                    </div>
                `;
                this.feedEl.insertBefore(summaryDiv, this.feedEl.firstChild);
            }
        }
        this.updateExportButtonState();

        tg?.HapticFeedback?.notificationOccurred('success');
    }

    async exportDialogTranscript() {
        const hasContent = (this.session?.messages?.length > 0) || Boolean(this.session?.summary);
        if (!hasContent) {
            showToast('Чат порожній, немає що експортувати', 'ℹ️');
            return;
        }

        const elapsedMs = Date.now() - (this.lastExportAt || 0);
        if (this.lastExportAt && elapsedMs < 3 * 60 * 1000) {
            const minsAgo = Math.max(1, Math.round(elapsedMs / 60000));
            const ok = confirm(`Стенограму цієї бесіди вже було надіслано менше ${minsAgo} хв тому. Надіслати ще раз?`);
            if (!ok) return;
        }

        const { initData, userId } = this.getAuthParams();
        showToast('📤 Відправляємо стенограму в чат...', '⏳');
        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/export-transcript`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.activeChatId,
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Помилка експорту');
            this.lastExportAt = Date.now();
            showToast(data.message || '🚀 Стенограму надіслано в Telegram!', '✅');
            tg?.HapticFeedback?.notificationOccurred('success');
        } catch (e) {
            console.error('[DialogMode] Export failed:', e);
            showToast(`⚠️ ${e.message}`, '❌');
        }
    }

    // Modal & Chat management
    openChatsModal() {
        if (!this.modalChatsList) return;
        this.modalChatsList.innerHTML = '';

        this.chats.forEach((c) => {
            const row = document.createElement('div');
            row.className = `dialog-chat-row ${c.id === this.activeChatId ? 'active' : ''}`;
            row.innerHTML = `
                <span class="dialog-chat-row-title">${c.id === this.activeChatId ? '🔘' : '⚪️'} ${escapeHtml(c.title || 'Чат')}</span>
                <span class="dialog-chat-row-meta">${c.id === this.activeChatId ? 'Активний' : 'Обрати'}</span>
            `;
            row.addEventListener('click', () => this.switchChat(c.id));
            this.modalChatsList.appendChild(row);
        });

        this.modal.classList.remove('hidden');
    }

    closeChatsModal() {
        this.modal.classList.add('hidden');
    }

    async switchChat(chatId) {
        if (chatId === this.activeChatId) {
            this.closeChatsModal();
            return;
        }
        const { initData, userId } = this.getAuthParams();
        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/chat/switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                }),
            });
            if (res.ok) {
                this.closeChatsModal();
                await this.checkAdminAndLoadState();
                showToast('💬 Чат перемкнуто', '✅');
            }
        } catch (e) {
            console.error('[DialogMode] Switch chat failed:', e);
        }
    }

    async handleNewChat() {
        const title = prompt('Назва нового чату:') || '';
        const { initData, userId } = this.getAuthParams();
        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/chat/new`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                }),
            });
            if (res.ok) {
                this.closeChatsModal();
                await this.checkAdminAndLoadState();
                showToast('✨ Новий чат створено', '✅');
            }
        } catch (e) {
            console.error('[DialogMode] New chat failed:', e);
        }
    }

    async handleRenameChat() {
        const currentTitle = this.session?.title || '';
        const newTitle = prompt('Введи нову назву для поточного чату:', currentTitle);
        if (!newTitle || !newTitle.trim()) return;

        const { initData, userId } = this.getAuthParams();
        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/chat/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: newTitle.trim(),
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                }),
            });
            if (res.ok) {
                this.closeChatsModal();
                await this.checkAdminAndLoadState();
                showToast('✏️ Чат перейменовано', '✅');
            }
        } catch (e) {
            console.error('[DialogMode] Rename failed:', e);
        }
    }

    async handleDeleteChat() {
        if (!confirm(`Видалити цей чат? Всі повідомлення буде втрачено.`)) return;

        const { initData, userId } = this.getAuthParams();
        try {
            const res = await fetch(`${API_BASE_URL}/api/tma/dialog/chat/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                }),
            });
            if (res.ok) {
                this.closeChatsModal();
                await this.checkAdminAndLoadState();
                showToast('🗑 Чат видалено', '✅');
            }
        } catch (e) {
            console.error('[DialogMode] Delete chat failed:', e);
        }
    }

    closeStatsModal() {
        if (this.statsModal) this.statsModal.classList.add('hidden');
    }

    showContextStatsModal() {
        try {
            console.log('[DialogMode] Opening stats modal. Current session:', this.session);
            const title = this.session?.title || 'Головний чат';
            const tokens = this.session?.tokens || {};
            const summary = this.session?.summary || 'Поки що немає (розмова коротка)';
            const freshTok = typeof tokens.fresh === 'number' ? tokens.fresh : 0;
            const sumTok = typeof tokens.summary === 'number' ? tokens.summary : 0;
            const totTok = typeof tokens.total === 'number' ? tokens.total : (freshTok + sumTok);

            if (this.statTitle) this.statTitle.textContent = `📊 Контекст бесіди (${title})`;
            if (this.statFreshTokens) this.statFreshTokens.textContent = `${freshTok} tok`;
            if (this.statSummaryTokens) this.statSummaryTokens.textContent = `${sumTok} tok`;
            if (this.statTotalTokens) this.statTotalTokens.textContent = `~${totTok} tok`;
            if (this.statSummaryText) this.statSummaryText.textContent = summary;

            if (this.statsModal) {
                this.statsModal.classList.remove('hidden');
            } else {
                console.warn('[DialogMode] statsModal DOM element not found');
            }
        } catch (err) {
            console.error('[DialogMode] Error in showContextStatsModal:', err);
        }
    }

    updateExportButtonState() {
        const hasContent = (this.session?.messages?.length > 0) || Boolean(this.session?.summary);
        if (this.btnDialogExport) {
            this.btnDialogExport.disabled = !hasContent;
            this.btnDialogExport.classList.toggle('disabled', !hasContent);
        }
    }
}
const dialogManager = new DialogModeManager();
