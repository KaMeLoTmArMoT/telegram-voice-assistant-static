/**
 * Gemini Live session manager (split from live_stream.js, behavior unchanged).
 * Owns: WebSocket setup, server messages, tool calls, transcript, export,
 * stats, exam tools wiring, connection lifecycle.
 * Audio pipeline methods arrive via live_audio.js prototype mixin (load next).
 */
/**
 * Gemini Multimodal Live Audio Streaming Engine (Admin Only)
 *
 * Full-duplex WebSocket connection between TMA browser and Google Gemini Live API.
 * Features:
 * - 16kHz PCM audio capture & downsampling
 * - 24kHz PCM audio playback queue
 * - Native barge-in interruption handling
 * - Diagnostics & step-by-step connection logging
 * - Mock Mode toggle for offline/local simulation testing
 */

class GeminiLiveStreamManager {
    constructor() {
        this.isConnected = false;
        this.isMuted = false;
        this.isMockMode = false;
        this.ws = null;
        this.audioContext = null;
        this.audioContextIn = null;
        this.audioContextOut = null;
        this.mediaStream = null;
        this.scriptProcessor = null;
        this.queuedSources = [];
        this.nextPlayTime = 0;
        this.apiKey = null;
        this.token = null;
        this.model = localStorage.getItem('tma_live_model') || 'gemini-3.8-live';
        this.thinkingLevel = localStorage.getItem('tma_live_thinking') || 'low';
        this.transcriptHistory = [];
        this.sessionStartTime = 0;

        // Voice, Pace, Audio Profile and Anti-Echo settings
        this.voice = localStorage.getItem('tma_live_voice') || 'Aoede';
        this.pace = localStorage.getItem('tma_live_pace') || 'normal';
        this.audioProfile = localStorage.getItem('tma_live_audio_profile') || 'headphones';
        this.micGainLevel = parseFloat(localStorage.getItem('tma_live_mic_gain') || '1.8');
        this.isEchoGuardEnabled = localStorage.getItem('tma_live_echoguard') !== 'false';
        this.isModelSpeaking = false;
        this.lastModelAudioTime = 0;
        this.isAutoMuted = false;

        // Audio pipeline nodes & meters
        this.gainNode = null;
        this.compressorNode = null;
        this.micAnalyser = null;
        this.modelAnalyser = null;
        this.vuAnimationFrame = null;
        this.activeDeviceSummary = '';

        // Stereo debug recorder (L: User, R: Gemini)
        this.debugMediaRecorder = null;
        this.debugAudioChunks = [];
        this.debugAudioBlob = null;
        this.debugDestNode = null;
        this.debugAudioMerger = null;

        // Token & Cost accounting
        this.sessionTokenStats = {
            prompt_tokens: 0,
            response_tokens: 0,
            thoughts_tokens: 0,
            total_tokens: 0,
            cost_usd: 0.0,
        };
        this.searchQueriesCount = 0;

        // Mock mode timers
        this.mockSilenceTimer = null;
        this.mockIsSpeaking = false;
        this.lastUserVoiceTime = 0;

        // DOM Elements
        this.screenLive = document.getElementById('live-screen');
        this.btnToggle = document.getElementById('btn-live-toggle');
        this.btnMute = document.getElementById('btn-live-mute');
        this.btnDisconnect = document.getElementById('btn-live-disconnect');
        this.btnMockToggle = document.getElementById('btn-live-mock-toggle');
        this.selectModel = document.getElementById('select-live-model');
        this.groupThinking = document.getElementById('group-thinking-level');
        this.selectThinkingLevel = document.getElementById('select-live-thinking-level');
        this.selectVoice = document.getElementById('select-live-voice');
        this.selectPace = document.getElementById('select-live-pace');
        this.selectAudioProfile = document.getElementById('select-live-audio-profile');
        this.selectMicGain = document.getElementById('select-live-mic-gain');
        this.deviceStatus = document.getElementById('live-device-status');
        this.deviceLabel = document.getElementById('live-device-label');
        this.btnEchoGuard = document.getElementById('toggle-live-echoguard');
        this.btnExport = document.getElementById('btn-live-export');
        this.controlsBar = document.getElementById('live-controls-bar');
        this.statusDot = document.getElementById('live-status-dot');
        this.statusText = document.getElementById('live-status-text');
        this.sessionTitle = document.getElementById('live-session-title');
        this.sessionDesc = document.getElementById('live-session-desc');
        this.captionBox = document.getElementById('live-caption-box');
        this.speakerLabel = document.getElementById('live-speaker-label');

        // VU Meter elements
        this.vuContainer = document.getElementById('live-vu-container');
        this.vuMicBar = document.getElementById('vu-mic-bar');
        this.vuModelBar = document.getElementById('vu-model-bar');

        // Transcript Header elements
        this.btnCopyTranscript = document.getElementById('btn-live-copy-transcript');

        // Usage Stats Card elements
        this.usageStatsCard = document.getElementById('live-usage-stats-card');
        this.statDuration = document.getElementById('live-stat-duration');
        this.statTokensIn = document.getElementById('live-stat-tokens-in');
        this.statTokensOut = document.getElementById('live-stat-tokens-out');
        this.statCost = document.getElementById('live-stat-cost');

        // Persona and Google Search Grounding elements
        this.isSearchGroundingEnabled = localStorage.getItem('tma_live_search') === 'true';
        this.btnSearchToggle = document.getElementById('toggle-live-search');
        this.btnPersonaPicker = document.getElementById('btn-live-persona-picker');
        this.personaPickerText = document.getElementById('live-persona-picker-text');

        // New redesign elements
        this.settingsPanel = document.getElementById('live-settings-panel');
        this.btnSettingsToggle = document.getElementById('btn-live-settings-toggle');
        this.transcriptFeed = document.getElementById('live-transcript-feed');
        this.feedPlaceholder = document.getElementById('live-feed-placeholder');
        this.idleControl = document.getElementById('live-idle-control');
        this.resumeBanner = document.getElementById('live-resume-banner');
        this.resumeTitle = document.getElementById('live-resume-title');
        this.resumeDetail = document.getElementById('live-resume-detail');
        this.btnResumeDismiss = document.getElementById('btn-live-resume-dismiss');
        this.btnIdleExport = document.getElementById('btn-live-idle-export');
        this.resumeContext = null;
        this.lastLiveExportAt = 0;

        this.init();
    }

    init() {
        if (!this.btnToggle) return;

        // Initialize selectors with stored values
        if (this.selectModel) {
            this.selectModel.value = this.model;
            if (this.model.includes('extended-thinking') && this.groupThinking) {
                this.groupThinking.classList.remove('hidden');
            }
            this.selectModel.addEventListener('change', (e) => {
                this.model = e.target.value;
                localStorage.setItem('tma_live_model', this.model);
                if (this.model.includes('extended-thinking')) {
                    this.groupThinking?.classList.remove('hidden');
                } else {
                    this.groupThinking?.classList.add('hidden');
                }
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        if (this.selectThinkingLevel) {
            this.selectThinkingLevel.value = this.thinkingLevel;
            this.selectThinkingLevel.addEventListener('change', (e) => {
                this.thinkingLevel = e.target.value;
                localStorage.setItem('tma_live_thinking', this.thinkingLevel);
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        if (this.selectVoice) {
            this.selectVoice.value = this.voice;
            this.selectVoice.addEventListener('change', (e) => {
                this.voice = e.target.value;
                localStorage.setItem('tma_live_voice', this.voice);
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        if (this.selectPace) {
            this.selectPace.value = this.pace;
            this.selectPace.addEventListener('change', (e) => {
                this.pace = e.target.value;
                localStorage.setItem('tma_live_pace', this.pace);
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        if (this.selectAudioProfile) {
            this.selectAudioProfile.value = this.audioProfile;
            this.selectAudioProfile.addEventListener('change', (e) => {
                this.audioProfile = e.target.value;
                localStorage.setItem('tma_live_audio_profile', this.audioProfile);
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
                if (this.isConnected && typeof showToast === 'function') {
                    showToast('Зміна аудіотракту почне діяти з наступного дзвінка', 'ℹ️');
                }
            });
        }

        if (this.selectMicGain) {
            const formattedGain = Number(this.micGainLevel || 1.8).toFixed(1);
            this.selectMicGain.value = ['1.0', '1.8', '2.8'].includes(formattedGain) ? formattedGain : '1.8';
            this.selectMicGain.addEventListener('change', (e) => {
                this.micGainLevel = parseFloat(e.target.value);
                localStorage.setItem('tma_live_mic_gain', this.micGainLevel.toString());
                if (this.gainNode) {
                    this.gainNode.gain.value = this.micGainLevel;
                }
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        if (this.btnCopyTranscript) {
            this.btnCopyTranscript.addEventListener('click', () => {
                if (!this.transcriptHistory || this.transcriptHistory.length === 0) {
                    if (typeof showToast === 'function') showToast('Стенограма поки що порожня', 'ℹ️');
                    return;
                }
                const fullText = this.transcriptHistory
                    .map((t) => `${t.speaker === 'user' ? 'Ви' : 'Gemini'}: ${t.text}`)
                    .join('\n\n');
                navigator.clipboard.writeText(fullText).then(() => {
                    if (typeof showToast === 'function') showToast('📋 Стенограму скопійовано!', '✅');
                    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
                }).catch(() => {
                    if (typeof showToast === 'function') showToast('Не вдалося скопіювати', '❌');
                });
            });
        }

        // Background Auto-Mute via Page Visibility API (saves battery and tokens)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isConnected && !this.isMuted) {
                console.log('[GeminiLive] App in background: auto-muting mic to save tokens');
                this.toggleMute();
                this.isAutoMuted = true;
                if (typeof showToast === 'function') {
                    showToast('🔇 Авто-пауза мікрофона (TMA у фоні)', 'ℹ️');
                }
            } else if (!document.hidden && this.isConnected && this.isMuted && this.isAutoMuted) {
                console.log('[GeminiLive] App restored: unmuting mic');
                this.toggleMute();
                this.isAutoMuted = false;
                if (typeof showToast === 'function') {
                    showToast('🎤 Мікрофон відновлено', 'ℹ️');
                }
            }
        });

        if (this.btnEchoGuard) {
            this.updateEchoGuardUI();
            this.btnEchoGuard.addEventListener('click', () => {
                this.isEchoGuardEnabled = !this.isEchoGuardEnabled;
                localStorage.setItem('tma_live_echoguard', this.isEchoGuardEnabled.toString());
                this.updateEchoGuardUI();
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        if (this.btnSearchToggle) {
            this.updateSearchToggleUI();
            this.btnSearchToggle.addEventListener('click', () => {
                this.isSearchGroundingEnabled = !this.isSearchGroundingEnabled;
                localStorage.setItem('tma_live_search', this.isSearchGroundingEnabled.toString());
                this.updateSearchToggleUI();
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
                if (typeof showToast === 'function') {
                    showToast(this.isSearchGroundingEnabled ? '🔍 Google Search увімкнено' : '🔍 Google Search вимкнено', 'ℹ️');
                }
            });
        }

        this.updatePersonaUI();
        if (this.btnPersonaPicker) {
            const openPersona = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof window.openPersonaModal === 'function') {
                    window.openPersonaModal();
                }
            };
            this.btnPersonaPicker.addEventListener('click', openPersona);
            this.btnPersonaPicker.addEventListener('touchend', openPersona);
        }

        window.addEventListener('tma_persona_changed', () => {
            this.updatePersonaUI();
            this.updateExamModeUI();
        });

        if (this.btnSettingsToggle && this.settingsPanel) {
            this.btnSettingsToggle.addEventListener('click', () => {
                this.settingsPanel.classList.toggle('collapsed');
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
            });
        }

        const getResumeId = () => {
            if (typeof window.getUrlParam === 'function') {
                const id = window.getUrlParam('resume_id');
                if (id) return id;
            }
            const match = /[?&#]resume_id=([a-zA-Z0-9_-]+)/.exec(window.location.href);
            return match ? match[1] : null;
        };

        const resumeId = getResumeId();
        if (resumeId) {
            this.loadResumeContext(resumeId);
        }

        if (this.btnResumeDismiss) {
            this.btnResumeDismiss.addEventListener('click', () => {
                this.resumeContext = null;
                this.resumeBanner?.classList.add('hidden');
                if (typeof showToast === 'function') showToast('Контекст продовження скинуто', 'ℹ️');
            });
        }

        this.btnToggle.addEventListener('click', () => {
            if (this.isConnected) {
                this.disconnect(false, false);
            } else {
                this.ensureAudioContextUnlocked();
                this.startSession();
            }
        });

        if (this.btnDisconnect) {
            this.btnDisconnect.addEventListener('click', () => this.disconnect(false, false));
        }

        if (this.btnMute) {
            this.btnMute.addEventListener('click', () => this.toggleMute());
        }

        if (this.btnMockToggle) {
            this.btnMockToggle.addEventListener('click', () => this.toggleMockMode());
        }

        if (this.btnExport) {
            this.btnExport.addEventListener('click', () => this.exportLiveTranscript());
        }

        if (this.btnIdleExport) {
            this.btnIdleExport.addEventListener('click', () => this.exportLiveTranscript());
        }

        this.updateExportButtonState();
        this.updateExamModeUI();
    }

    async loadResumeContext(resumeId) {
        try {
            const base = this.getApiBaseUrl();
            const res = await fetch(`${base}/api/tma/live/resume-context?resume_id=${encodeURIComponent(resumeId)}`);
            if (!res.ok) return;
            const data = await res.json();
            this.resumeContext = data;
            if (this.resumeBanner) {
                this.resumeBanner.classList.remove('hidden');
                if (this.resumeTitle) this.resumeTitle.textContent = '🔄 Продовження бесіди';
                if (this.resumeDetail) this.resumeDetail.textContent = `${data.turns_count || 0} реплік, ~${data.words_count || 0} слів з минулої сесії`;
            }
            if (typeof showToast === 'function') {
                showToast(`Контекст сесії відновлено (${data.turns_count || 0} реплік)`, '🔄');
            }
        } catch (e) {
            console.warn('[GeminiLive] Failed to load resume context:', e);
        }
    }

    updateEchoGuardUI() {
        if (!this.btnEchoGuard) return;
        if (this.isEchoGuardEnabled) {
            this.btnEchoGuard.classList.add('active');
            this.btnEchoGuard.textContent = '🛡️ Авто';
            this.btnEchoGuard.title = 'Анти-відлуння УВІМКНЕНО: захист від перебивання власним звуком динаміка.';
        } else {
            this.btnEchoGuard.classList.remove('active');
            this.btnEchoGuard.textContent = '🛡️ Вимк';
            this.btnEchoGuard.title = 'Анти-відлуння ВИМКНЕНО: максимальна чутливість для навушників.';
        }
    }

    updateSearchToggleUI() {
        if (!this.btnSearchToggle) return;
        if (this.isSearchGroundingEnabled) {
            this.btnSearchToggle.classList.add('active');
            this.btnSearchToggle.textContent = '🔍 Увімк';
            this.btnSearchToggle.title = 'Google Search Grounding активний: модель шукає свіжі дані в Google.';
        } else {
            this.btnSearchToggle.classList.remove('active');
            this.btnSearchToggle.textContent = '🔍 Вимк';
            this.btnSearchToggle.title = 'Google Search Grounding вимкнений: максимальна швидкість без додаткових запитів.';
        }
    }

    updatePersonaUI() {
        if (this.personaPickerText && window.personaEngine) {
            this.personaPickerText.textContent = window.personaEngine.getActiveTitle();
        }
    }

    getApiBaseUrl() {
        return resolveApiBaseUrl();
    }

    getAuthParams() {
        return getTelegramUserContext();
    }

    toggleMockMode() {
        this.isMockMode = !this.isMockMode;
        if (this.btnMockToggle) {
            if (this.isMockMode) {
                this.btnMockToggle.classList.add('active');
                this.btnMockToggle.textContent = '🧪 Mock: ON';
                this.sessionDesc.textContent = 'Тестовий режим активний: мікрофон захоплюється локально без викликів Google API.';
            } else {
                this.btnMockToggle.classList.remove('active');
                this.btnMockToggle.textContent = '🧪 Mock: OFF';
                this.sessionDesc.textContent = 'Повний дуплекс через WebSocket. Говори вільно, перебивай у будь-який момент.';
            }
        }
        window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
    }

    async fetchCredentials() {
        const { initData, userId } = this.getAuthParams();
        const base = this.getApiBaseUrl();
        const url = `${base}/api/tma/live/config?init_data=${encodeURIComponent(initData)}&user_id=${encodeURIComponent(userId)}`;

        console.log(`[GeminiLive] Fetching credentials from: ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Server auth HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        this.token = data.token || null;
        this.apiKey = data.api_key || null;
        return data;
    }

    async startSession() {
        const tg = window.Telegram?.WebApp;
        this.setStatus('connecting', 'Підключення...');
        this.settingsPanel?.classList.add('collapsed');

        // Apply connecting button feedback animation
        if (this.btnToggle) {
            this.btnToggle.classList.add('connecting');
            const iconEl = this.btnToggle.querySelector('.live-start-icon');
            if (iconEl) iconEl.textContent = '⏳';
            if (this.sessionTitle) this.sessionTitle.textContent = 'Підключення...';
        }

        try {
            // Strict admin check before any operation
            if (window.dialogManager && !window.dialogManager.isAdmin) {
                throw new Error('Доступ до Live режиму дозволений виключно адміністраторам бота.');
            }

            if (this.isMockMode) {
                this.ensureAudioContextUnlocked();
                // MOCK SIMULATION MODE
                if (this.speakerLabel) this.speakerLabel.textContent = 'Ініціалізація (Mock)...';
                await this.initAudio(true);
                this.isConnected = true;
                this.startVuMeterLoop();
                this.sessionStartTime = Date.now();
                if (!this.resumeContext) {
                    this.transcriptHistory = [];
                    if (this.transcriptFeed) this.transcriptFeed.innerHTML = '';
                }
                if (typeof requestWakeLock === 'function') requestWakeLock();
                this.setStatus('live', '🟢 Mock Live Active');
                this.resetConnectingButtonUI();
                this.idleControl?.classList.add('hidden');
                this.controlsBar?.classList.remove('hidden');
                this.updateExportButtonState();
                return;
            }

            // REAL GOOGLE GEMINI LIVE WEBSOCKET WITH EPHEMERAL TOKEN
            this.ensureAudioContextUnlocked();
            if (this.speakerLabel) this.speakerLabel.textContent = 'Отримання токена...';
            await this.fetchCredentials();

            if (this.speakerLabel) this.speakerLabel.textContent = 'Аудіосистема...';
            await this.initAudio(false);

            if (this.speakerLabel) this.speakerLabel.textContent = 'З\'єднання з Gemini...';
            await this.connectWebSocket();

            this.isConnected = true;
            this.startVuMeterLoop();
            this.sessionStartTime = Date.now();
            if (!this.resumeContext) {
                this.transcriptHistory = [];
                if (this.transcriptFeed) this.transcriptFeed.innerHTML = '';
            }
            if (typeof requestWakeLock === 'function') requestWakeLock();
            this.setStatus('live', '🟢 У прямому ефірі');
            if (this.speakerLabel) this.speakerLabel.textContent = 'Слухаю вас...';
            this.resetConnectingButtonUI();
            this.idleControl?.classList.add('hidden');
            this.controlsBar?.classList.remove('hidden');
            this.updateExportButtonState();

            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        } catch (err) {
            console.error('[GeminiLive] Failed to start session:', err);
            this.resetConnectingButtonUI();
            this.disconnect(true, true);
            this.setStatus('error', '⚠️ Помилка з\'єднання');
            if (this.speakerLabel) this.speakerLabel.textContent = 'Помилка';
            if (this.transcriptFeed) {
                const isQuotaError = err.message && (err.message.includes('quota') || err.message.includes('1011'));
                const errDiv = document.createElement('div');
                errDiv.className = 'live-feed-turn model';

                if (isQuotaError) {
                    errDiv.innerHTML = `
                        <div class="turn-text" style="color: #f87171; background: rgba(239, 68, 68, 0.12); padding: 12px; border-radius: 10px; border: 1px solid rgba(239, 68, 68, 0.3);">
                            <div style="font-weight: 600; margin-bottom: 6px;">🚫 Вичерпано квоту Google AI Studio (Код 1011)</div>
                            <div style="font-size: 13px; line-height: 1.4; color: #cbd5e1; margin-bottom: 10px;">
                                Google Live API вимагає підключення білінгу (Pay-as-you-go) в Google AI Studio або ліміт безкоштовних сесій для поточного ключа тимчасово вичерпано.
                            </div>
                            <button type="button" id="btn-err-activate-mock" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px; border-radius: 6px;">
                                🧪 Увімкнути Mock Mode (Тестовий режим без квоти)
                            </button>
                        </div>
                    `;
                    setTimeout(() => {
                        const btnActivateMock = document.getElementById('btn-err-activate-mock');
                        if (btnActivateMock) {
                            btnActivateMock.addEventListener('click', () => {
                                if (!this.isMockMode) this.toggleMockMode();
                                this.startSession();
                            });
                        }
                    }, 50);
                } else {
                    errDiv.innerHTML = `<div class="turn-text" style="color: #ef4444;">❌ ${escapeHtml(err.message)}</div>`;
                }

                this.transcriptFeed.appendChild(errDiv);
            }
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('error');
            }
        }
    }

    resetConnectingButtonUI() {
        if (this.btnToggle) {
            this.btnToggle.classList.remove('connecting');
            const iconEl = this.btnToggle.querySelector('.live-start-icon');
            if (iconEl) iconEl.textContent = '⚡';
            if (this.sessionTitle) this.sessionTitle.textContent = 'Почати Live';
        }
    }

    getPaceInstruction() {
        if (this.pace === 'calm') {
            return 'Говори повільно, виважено, спокійно та плавно, роби природні короткі паузи між закінченими думками.';
        } else if (this.pace === 'fast') {
            return 'Говори бадьоро, динамічно, швидко та енергійно, але чітко й виразно.';
        }
        return 'Говори у природному, помірному розмовному темпі без поспіху.';
    }


    // --- Exam mode (progressive enhancement: never breaks base Live) ---
    isExamMode() {
        try {
            var cfg = window.personaEngine ? window.personaEngine.getActiveConfig() : null;
            if (!cfg) return false;
            if (cfg.presetId === 'de_b2_exam') return true;
            if (cfg.isCustom && cfg.role === 'examiner') return true;
            return false;
        } catch (e) {
            return false;
        }
    }

    getExamFunctionDeclarations() {
        return [
            { name: 'exam_show_teil1_choice', description: 'Zeige dem Kandidaten 2 zufällige Teil-1-Themen als Karte. Einmal zu Beginn von Teil 1 aufrufen, still (nichts über Tools sagen).', parameters: { type: 'OBJECT', properties: {} } },
            { name: 'exam_show_teil3_card', description: 'Zeige die Teil-3-Situationskarte (Situation + Stichpunkte). Zu Beginn von Teil 3 aufrufen, still.', parameters: { type: 'OBJECT', properties: { situation_id: { type: 'STRING', description: 'Optionale Situations-ID, sonst zufällig.' } } } },
            { name: 'exam_timer_start', description: 'Starte den Phasen-Timer SOFORT nach der Aufgabenstellung. NIEMALS ankündigen (kein "Ich starte den Timer").', parameters: { type: 'OBJECT', properties: { phase: { type: 'STRING', enum: ['teil1', 'teil1_monolog', 'teil3', 'teil3_diskussion'] }, label: { type: 'STRING' } }, required: ['phase'] } },
            { name: 'exam_timer_stop', description: 'Stoppe den Phasen-Timer am Ende der Phase.', parameters: { type: 'OBJECT', properties: { phase: { type: 'STRING' } } } },
            { name: 'exam_set_phase', description: 'Aktualisiere die Phasenanzeige in der UI.', parameters: { type: 'OBJECT', properties: { phase: { type: 'STRING', enum: ['teil1', 'teil3'] } } } },
            { name: 'exam_hide_card', description: 'Verstecke die Aufgabenkarte.', parameters: { type: 'OBJECT', properties: {} } }
        ];
    }

    updateExamModeUI() {
        try {
            var bar = document.getElementById('exam-manual-bar');
            if (!bar) return;
            if (this.isExamMode()) bar.classList.remove('hidden');
            else bar.classList.add('hidden');
            if (window.ExamUI && typeof window.ExamUI.wireManualButtons === 'function') {
                window.ExamUI.wireManualButtons();
            }
        } catch (e) { /* never break Live */ }
    }

    handleExamToolCall(toolCallMsg) {
        var fns = toolCallMsg.functionCalls || toolCallMsg.function_calls || [];
        var responses = [];
        for (var i = 0; i < fns.length; i++) {
            (function (fc) {
                var result = { ok: true, fallback: 'voice' };
                try {
                    if (window.ExamUI && typeof window.ExamUI.dispatchTool === 'function') {
                        var r = window.ExamUI.dispatchTool(fc.name, fc.args || fc.arguments || {});
                        if (r) result = r;
                    } else {
                        result = { ok: false, error: 'exam-ui-missing', fallback: 'voice' };
                    }
                } catch (e) {
                    result = { ok: false, error: String(e && e.message || e), fallback: 'voice' };
                }
                // Always respond ok-ish so the synchronous Live turn never stalls.
                responses.push({ id: fc.id, name: fc.name, response: { result: 'ok', detail: result } });
            })(fns[i]);
        }
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && responses.length) {
                this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
            }
        } catch (e) {
            console.warn('[GeminiLive] toolResponse send failed:', e);
        }
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            let wsUrl;
            if (this.token) {
                wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(this.token)}`;
            } else {
                wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;
            }

            console.log('[GeminiLive] Opening WebSocket to Google...');
            this.ws = new WebSocket(wsUrl);

            let isSetupDone = false;
            const setupTimeout = setTimeout(() => {
                if (!isSetupDone) {
                    isSetupDone = true;
                    reject(new Error('Час очікування підтвердження сесії від Google Live API вичерпано (Timeout 10s).'));
                }
            }, 10000);

            this.ws.onopen = () => {
                console.log(`[GeminiLive] WebSocket connected. Model: ${this.model}, Voice: ${this.voice}, Pace: ${this.pace}. Sending setup...`);
                const isExtended = this.model.includes('extended-thinking');
                const modelIdentifier = isExtended
                    ? 'models/gemini-3.8-live-extended-thinking'
                    : (this.model.startsWith('models/') ? this.model : `models/${this.model}`);
                const paceInstruction = this.getPaceInstruction();
                let basePrompt = window.personaEngine
                    ? window.personaEngine.buildPersonaPrompt(null, 'live')
                    : 'Ти розумний, природний і лаконічний україномовний голосовий співрозмовник. Відповідай українською мовою, завершеними реченнями, дружньо, життєрадісно та по суті. Не обривай фрази на півслові.';

                let systemPrompt = `${basePrompt}\n\n[ТЕМП МОВЛЕННЯ]: ${paceInstruction}`;
                if (this.resumeContext?.context_summary) {
                    systemPrompt += `\n\n[КОНТЕКСТ ПРОДОВЖЕННЯ РОЗМОВИ]:\n${this.resumeContext.context_summary}\nПродовжуй бесіду враховуючи ці попередні факти.`;
                }

                const generationConfig = {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: this.voice,
                            },
                        },
                    },
                };

                if (isExtended) {
                    generationConfig.thinkingConfig = {
                        thinkingLevel: this.thinkingLevel || 'low',
                    };
                }

                const setupPayload = {
                    model: modelIdentifier,
                    generationConfig: generationConfig,
                    systemInstruction: {
                        parts: [
                            {
                                text: systemPrompt,
                            },
                        ],
                    },
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                };

                if (this.isSearchGroundingEnabled) {
                    setupPayload.tools = [{ googleSearch: {} }];
                }

                // Exam tools are additive and guarded: any failure falls back to voice-only.
                var examToolsWanted = false;
                try {
                    if (this.isExamMode()) {
                        examToolsWanted = true;
                        var examDecls = this.getExamFunctionDeclarations();
                        setupPayload.tools = (setupPayload.tools || []).concat([{ functionDeclarations: examDecls }]);
                    }
                } catch (e) {
                    console.warn('[GeminiLive] Exam tools setup skipped, voice-only fallback:', e);
                }
                this._examToolsWanted = examToolsWanted;
                this._examToolsRetried = this._examToolsRetried || false;

                const setupMessage = {
                    setup: setupPayload,
                };

                this.ws.send(JSON.stringify(setupMessage));
            };

            this.ws.onmessage = async (event) => {
                let data = event.data;
                if (data instanceof Blob) {
                    data = await data.text();
                }
                try {
                    const msg = JSON.parse(data);
                    console.log('[GeminiLive] Received from Google:', msg);

                    if (msg.error) {
                        const errMsg = msg.error.message || JSON.stringify(msg.error);
                        console.error('[GeminiLive] Google API Error:', errMsg);
                        if (!isSetupDone) {
                            clearTimeout(setupTimeout);
                            isSetupDone = true;
                            reject(new Error(`Google Live API помилка: ${errMsg}`));
                            return;
                        } else {
                            if (this.speakerLabel) this.speakerLabel.textContent = 'Помилка:';
                            this.recordTranscriptTurn('gemini', `[Помилка Google: ${errMsg}]`);
                        }
                    }

                    if (msg.setupComplete && !isSetupDone) {
                        console.log('[GeminiLive] ✅ SetupComplete received from Google!');
                        clearTimeout(setupTimeout);
                        isSetupDone = true;
                        resolve();
                        return;
                    }

                    if (!isSetupDone && (msg.serverContent || msg.toolCall || msg.tool_call)) {
                        clearTimeout(setupTimeout);
                        isSetupDone = true;
                        resolve();
                    }

                    // Exam/Function tools: respond manually, never throw (else Live stalls).
                    try {
                        var tc = msg.toolCall || msg.tool_call;
                        if (tc) this.handleExamToolCall(tc);
                    } catch (e) {
                        console.warn('[GeminiLive] exam toolCall handling failed, continuing voice:', e);
                    }

                    this.handleServerMessage(msg);
                } catch (e) {
                    console.warn('[GeminiLive] Parse error for incoming message:', e);
                }
            };

            this.ws.onerror = (err) => {
                console.error('[GeminiLive] WebSocket error event:', err);
                if (!isSetupDone) {
                    clearTimeout(setupTimeout);
                    isSetupDone = true;
                    reject(new Error('Помилка WebSocket з\'єднання з серверами Google. Перевірте інтернет та налаштування доступу.'));
                }
            };

            this.ws.onclose = (ev) => {
                console.log('[GeminiLive] WebSocket closed:', ev.code, ev.reason);
                clearTimeout(setupTimeout);
                const reasonText = ev.reason ? `: ${ev.reason}` : '';
                if (!isSetupDone) {
                    // One graceful retry without exam tools if setup with tools was rejected.
                    if (this._examToolsWanted && !this._examToolsRetried && (ev.code === 1002 || ev.code === 1011 || ev.code === 1012)) {
                        this._examToolsRetried = true;
                        this._examToolsWanted = false;
                        console.warn('[GeminiLive] Retrying Live setup without exam tools (voice-only fallback).');
                        if (typeof showToast === 'function') showToast('Картки іспиту вимкнено, продовжую голосом', 'ℹ️');
                        isSetupDone = true;
                        clearTimeout(setupTimeout);
                        // Re-enter setup without tools by reconnecting once.
                        this.ws = null;
                        this.connectWebSocket().then(resolve).catch(reject);
                        return;
                    }
                    isSetupDone = true;
                    let errorMsg = `Google Live API розірвав зв'язок при старті (код ${ev.code}${reasonText}).`;
                    if (this.isSearchGroundingEnabled && (ev.code === 1011 || reasonText.includes('quota'))) {
                        errorMsg += ' 💡 Підказка: Вимкніть "🔍 Google Пошук" у налаштуваннях Live (інструмент Search у Live API вимагає окремого платного тарифу).';
                    } else {
                        errorMsg += ` Перевірте модель (${this.model}) або ліміти API.`;
                    }
                    reject(new Error(errorMsg));
                } else if (this.isConnected) {
                    this.disconnect(true);
                    this.setStatus('error', `Код ${ev.code}`);
                    this.sessionTitle.textContent = 'З\'єднання перервано';
                    this.sessionDesc.textContent = `Google Live API закрив сесію (код ${ev.code}${reasonText}).`;
                    if (this.speakerLabel) this.speakerLabel.textContent = 'Система:';
                    this.recordTranscriptTurn('gemini', `[Сесію закрито сервером Google: код ${ev.code}${reasonText}]`);
                }
            };
        });
    }

    handleServerMessage(msg) {
        // Track token usage and cost accounting
        if (msg.usageMetadata || msg.usage_metadata) {
            const u = msg.usageMetadata || msg.usage_metadata;
            this.sessionTokenStats.prompt_tokens = u.promptTokenCount || u.prompt_token_count || this.sessionTokenStats.prompt_tokens;
            this.sessionTokenStats.response_tokens = u.responseTokenCount || u.response_token_count || this.sessionTokenStats.response_tokens;
            this.sessionTokenStats.thoughts_tokens = u.thoughtsTokenCount || u.thoughts_token_count || this.sessionTokenStats.thoughts_tokens;
            this.sessionTokenStats.total_tokens = u.totalTokenCount || u.total_token_count || (this.sessionTokenStats.prompt_tokens + this.sessionTokenStats.response_tokens);

            // Compute estimated cost: audio in $3/1M, audio out $12/1M, thinking $4.50/1M, search $0.014/req
            const pCost = (this.sessionTokenStats.prompt_tokens / 1000000) * 3.0;
            const rCost = (this.sessionTokenStats.response_tokens / 1000000) * 12.0;
            const tCost = (this.sessionTokenStats.thoughts_tokens / 1000000) * 4.5;
            const sCost = this.searchQueriesCount * 0.014;
            this.sessionTokenStats.cost_usd = pCost + rCost + tCost + sCost;

            this.updateUsageStatsUI();
        }

        // Track Google Search tool invocations
        if (msg.toolCall || msg.tool_call) {
            const tc = msg.toolCall || msg.tool_call;
            const fns = tc.functionCalls || tc.function_calls || [];
            for (const fn of fns) {
                if (fn.name?.toLowerCase().includes('search')) {
                    this.searchQueriesCount++;
                }
            }
        }

        // Track background thinking state in Extended Thinking models
        const interactionStatus = msg.interactionStatus || msg.interaction_status;
        if (interactionStatus === 'IN_PROGRESS') {
            if (this.statusText) this.statusText.textContent = '🧠 Мислення...';
        } else if (interactionStatus === 'IDLE' && this.isConnected) {
            if (this.statusText) this.statusText.textContent = '🟢 У прямому ефірі';
        }

        const serverContent = msg.serverContent || msg.server_content;
        if (!serverContent) {
            console.log('[GeminiLive] Received non-content packet:', msg);
            return;
        }

        // 1. Interruption (Barge-in): User started speaking, cancel pending model speech
        if (serverContent.interrupted) {
            console.log('[GeminiLive] ⚡ Barge-in detected! Stopping audio playback immediately.');
            this.stopAllAudioPlayback();
            this.setOrbSpeaking(false);
            return;
        }

        // 2. Audio playback chunks and model text
        const modelTurn = serverContent.modelTurn || serverContent.model_turn;
        const parts = modelTurn?.parts || [];
        for (const part of parts) {
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData && inlineData.data) {
                this.queuePcmAudioChunk(inlineData.data);
                this.setOrbSpeaking(true);
            }
            if (part.text) {
                if (this.speakerLabel) this.speakerLabel.textContent = 'Gemini:';
                this.recordTranscriptTurn('gemini', part.text);
            }
        }

        // 3. Transcription events (if enabled by API)
        const inputTx = serverContent.inputTranscription || serverContent.input_transcription;
        if (inputTx?.text) {
            if (this.speakerLabel) this.speakerLabel.textContent = 'Ви:';
            this.recordTranscriptTurn('user', inputTx.text);
        }

        const outputTx = serverContent.outputTranscription || serverContent.output_transcription;
        if (outputTx?.text) {
            if (this.speakerLabel) this.speakerLabel.textContent = 'Gemini:';
            this.recordTranscriptTurn('gemini', outputTx.text);
        }

        if (serverContent.turnComplete || serverContent.turn_complete) {
            if (this.queuedSources.length === 0) {
                this.setOrbSpeaking(false);
            }
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        const icon = document.getElementById('live-mute-icon');
        const text = document.getElementById('live-mute-text');

        if (this.isMuted) {
            if (icon) icon.textContent = '🔇';
            if (text) text.textContent = 'Muted';
            this.btnMute?.classList.add('muted');
            if (this.statusText) this.statusText.textContent = '🔇 Мікрофон на паузі';
        } else {
            if (icon) icon.textContent = '🎤';
            if (text) text.textContent = 'Мік ON';
            this.btnMute?.classList.remove('muted');
            if (this.statusText) this.statusText.textContent = '🟢 У прямому ефірі';
        }
        window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
    }

    updateUsageStatsUI() {
        if (!this.usageStatsCard) return;
        const durSec = this.sessionStartTime ? Math.round((Date.now() - this.sessionStartTime) / 1000) : 0;
        const mins = Math.floor(durSec / 60);
        const secs = durSec % 60;
        const durStr = `${mins}:${secs.toString().padStart(2, '0')}`;

        if (this.statDuration) this.statDuration.textContent = durStr;
        if (this.statTokensIn) this.statTokensIn.textContent = this.sessionTokenStats.prompt_tokens.toLocaleString();
        if (this.statTokensOut) this.statTokensOut.textContent = this.sessionTokenStats.response_tokens.toLocaleString();
        if (this.statCost) this.statCost.textContent = `~$${this.sessionTokenStats.cost_usd.toFixed(4)}`;
        this.usageStatsCard.classList.remove('hidden');
    }

    finalizeSessionStats() {
        const durSec = this.sessionStartTime ? Math.round((Date.now() - this.sessionStartTime) / 1000) : 0;
        // Fallback calculation if Google did not return usageMetadata
        if (this.sessionTokenStats.prompt_tokens === 0 && durSec > 0) {
            const estAudioInTokens = Math.round(durSec * 25); // ~25-30 tokens/sec
            const estAudioOutTokens = Math.round(durSec * 25);
            this.sessionTokenStats.prompt_tokens = estAudioInTokens;
            this.sessionTokenStats.response_tokens = estAudioOutTokens;
            this.sessionTokenStats.total_tokens = estAudioInTokens + estAudioOutTokens;
            this.sessionTokenStats.cost_usd =
                (estAudioInTokens / 1000000) * 3.0 +
                (estAudioOutTokens / 1000000) * 12.0 +
                this.searchQueriesCount * 0.014;
        }
        this.updateUsageStatsUI();
    }

    disconnect(preserveError = false, force = false) {
        if (this.isConnected && !force) {
            if (!confirm('Завершити Live розмову?')) {
                return;
            }
        }
        this.isConnected = false;
        this.stopVuMeterLoop();
        this.stopAllAudioPlayback();
        this.stopMockSpeech();
        clearTimeout(this.mockSilenceTimer);

        // Stop stereo debug recording
        if (this.debugMediaRecorder && this.debugMediaRecorder.state !== 'inactive') {
            try {
                this.debugMediaRecorder.stop();
            } catch (e) {
                console.warn('[GeminiLive] Stop debug recorder error:', e);
            }
        }

        if (this.ws) {
            try {
                this.ws.close();
            } catch (e) {}
            this.ws = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getAudioTracks().forEach((track) => {
                track.enabled = false;
            });
        }

        if (this.scriptProcessor) {
            try {
                this.scriptProcessor.disconnect();
            } catch (e) {}
            this.scriptProcessor = null;
        }

        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (e) {}
            this.audioContext = null;
            this.audioContextIn = null;
            this.audioContextOut = null;
        }

        this.idleControl?.classList.remove('hidden');
        this.controlsBar?.classList.add('hidden');
        this.settingsPanel?.classList.remove('collapsed');
        this.finalizeSessionStats();
        this.updateExportButtonState();

        const hasTranscript = Boolean(this.transcriptHistory && this.transcriptHistory.length > 0);
        if (hasTranscript) {
            this.btnIdleExport?.classList.remove('hidden');
            setTimeout(() => {
                if (confirm('Надіслати стенограму сесії та аудіозапис в Telegram?')) {
                    this.exportLiveTranscript();
                }
            }, 300);
        } else {
            this.btnIdleExport?.classList.add('hidden');
        }

        if (typeof releaseWakeLock === 'function' && (!window.isRecording)) {
            releaseWakeLock();
        }

        if (!preserveError) {
            this.setStatus('disconnected', 'Відключено');
            if (this.speakerLabel) this.speakerLabel.textContent = 'Очікування...';
        }
    }

    recordTranscriptTurn(speaker, text) {
        if (!text || !text.trim()) return;
        const trimmed = text.trim();
        const last = this.transcriptHistory[this.transcriptHistory.length - 1];
        if (last && last.speaker === speaker) {
            last.text += (last.text.endsWith(' ') || trimmed.startsWith(' ') ? '' : ' ') + trimmed;
        } else {
            this.transcriptHistory.push({
                speaker: speaker,
                text: trimmed,
                timestamp: Date.now(),
            });
        }

        // Render in scrollable transcript feed
        if (this.feedPlaceholder) {
            this.feedPlaceholder.remove();
            this.feedPlaceholder = null;
        }
        if (this.transcriptFeed) {
            const lastChild = this.transcriptFeed.lastElementChild;
            if (lastChild && lastChild.dataset.speaker === speaker) {
                const textEl = lastChild.querySelector('.turn-text');
                if (textEl) {
                    textEl.textContent += (textEl.textContent.endsWith(' ') || trimmed.startsWith(' ') ? '' : ' ') + trimmed;
                }
            } else {
                const turnDiv = document.createElement('div');
                turnDiv.className = `live-feed-turn ${speaker === 'user' ? 'user' : 'model'}`;
                turnDiv.dataset.speaker = speaker;
                turnDiv.innerHTML = `
                    <div class="speaker-name">${speaker === 'user' ? '👤 Ви' : '⚡ Gemini'}</div>
                    <div class="turn-text">${escapeHtml(trimmed)}</div>
                `;
                this.transcriptFeed.appendChild(turnDiv);
            }
            this.transcriptFeed.scrollTop = this.transcriptFeed.scrollHeight;
        }
        this.updateExportButtonState();
    }

    updateExportButtonState() {
        const hasContent = Boolean(this.transcriptHistory && this.transcriptHistory.length > 0);
        if (this.btnExport) {
            this.btnExport.disabled = !hasContent;
            this.btnExport.classList.toggle('disabled', !hasContent);
        }
        if (this.btnIdleExport) {
            if (this.isConnected || !hasContent) {
                this.btnIdleExport.classList.add('hidden');
            } else {
                this.btnIdleExport.classList.remove('hidden');
            }
        }
    }

    async exportLiveTranscript() {
        if (!this.transcriptHistory || this.transcriptHistory.length === 0) {
            if (typeof showToast === 'function') {
                showToast('Стенограма поки що порожня, немає що експортувати', 'ℹ️');
            }
            return;
        }

        const elapsedMs = Date.now() - (this.lastLiveExportAt || 0);
        if (this.lastLiveExportAt && elapsedMs < 3 * 60 * 1000) {
            const minsAgo = Math.max(1, Math.round(elapsedMs / 60000));
            const ok = confirm(`Стенограму Live вже було надіслано менше ${minsAgo} хв тому. Надіслати ще раз?`);
            if (!ok) return;
        }

        const { initData, userId } = this.getAuthParams();
        if (typeof showToast === 'function') {
            showToast('📤 Відправляємо стенограму Live в чат...', '⏳');
        }
        const durationSec = this.sessionStartTime ? Math.round((Date.now() - this.sessionStartTime) / 1000) : 0;
        try {
            const base = this.getApiBaseUrl();
            const res = await fetch(`${base}/api/tma/live/export-transcript`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turns: this.transcriptHistory,
                    duration_sec: durationSec,
                    init_data: initData,
                    user_id: userId ? parseInt(userId, 10) : null,
                    evaluation: (window.ExamUI && typeof window.ExamUI.getExamEvaluation === 'function')
                        ? window.ExamUI.getExamEvaluation()
                        : null,
                    usage_stats: {
                        prompt_tokens: this.sessionTokenStats.prompt_tokens,
                        response_tokens: this.sessionTokenStats.response_tokens,
                        thoughts_tokens: this.sessionTokenStats.thoughts_tokens,
                        total_tokens: this.sessionTokenStats.total_tokens,
                        cost_usd: this.sessionTokenStats.cost_usd,
                        model: this.model,
                    },
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Помилка експорту');
            this.lastLiveExportAt = Date.now();
            if (typeof showToast === 'function') {
                showToast(data.message || '🚀 Стенограму надіслано в Telegram!', '✅');
            }
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');

            // Also upload stereo debug audio if available
            this.exportDebugAudio(durationSec);
        } catch (e) {
            console.error('[GeminiLive] Export failed:', e);
            if (typeof showToast === 'function') {
                showToast(`⚠️ ${e.message}`, '❌');
            }
        }
    }

    async exportDebugAudio(durationSec) {
        if (!this.debugAudioBlob || this.debugAudioBlob.size < 1500) {
            console.log('[GeminiLive] No debug audio recording to upload');
            return;
        }

        const { initData, userId } = this.getAuthParams();
        try {
            const base = this.getApiBaseUrl();
            const formData = new FormData();
            formData.append('audio_file', this.debugAudioBlob, 'live_debug.webm');
            formData.append('duration_sec', durationSec ? durationSec.toString() : '0');
            if (initData) formData.append('init_data', initData);
            if (userId) formData.append('user_id', userId.toString());

            const res = await fetch(`${base}/api/tma/live/export-audio`, {
                method: 'POST',
                body: formData,
            });
            if (res.ok) {
                console.log('[GeminiLive] ✅ Stereo debug audio uploaded to Telegram chat!');
                if (typeof showToast === 'function') {
                    showToast('🎙️ Стерео-аудіо сесії надіслано в чат!', '🎧');
                }
            }
        } catch (err) {
            console.warn('[GeminiLive] Failed to export debug audio:', err);
        }
    }

    setStatus(state, text) {
        if (!this.statusDot || !this.statusText) return;
        this.statusDot.className = 'status-dot live-dot';

        if (state === 'live') {
            this.statusDot.classList.add('live-active');
        } else if (state === 'connecting') {
            this.statusDot.classList.add('live-connecting');
        } else if (state === 'error') {
            this.statusDot.classList.add('live-error');
        }

        this.statusText.textContent = text;
    }

}

// Global instance
window.liveStreamManager = new GeminiLiveStreamManager();
