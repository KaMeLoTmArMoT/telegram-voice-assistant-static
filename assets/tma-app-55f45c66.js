/* TMA Bundled App */

/* --- Start: version.js --- */
// Auto-generated version file. Do not edit manually.
window.APP_VERSION = "2026.10.11-2239";
window.COMMIT_HASH = "f638c3f";
window.BUILD_DATE = "2026-10-11 22:39";
window.FULL_VERSION = "2026.10.11-2239 (f638c3f)";


/* --- Start: tma_common.js --- */
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
        try {
            localStorage.setItem('tma_api_url', paramApi);
        } catch (e) {}
    } else {
        try {
            paramApi = localStorage.getItem('tma_api_url') || '';
        } catch (e) {}
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
                sampleRate: { ideal: 48000 },
            },
        },
        {
            audio: {
                echoCancellation: { ideal: false },
                noiseSuppression: { ideal: false },
                autoGainControl: { ideal: false },
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000 },
            },
        },
        {
            audio: {
                channelCount: 1,
                sampleRate: 48000,
            },
        },
        { audio: true },
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
        { audio: true },
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
        { audio: true },
    ],
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
    return (
        (candidates || []).find(
            (m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)),
        ) || ''
    );
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
        '',
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


/* --- Start: persona_engine.js --- */
/**
 * Modular Persona & System Instruction Engine for Telegram Mini App
 * Shared across Live Mode and Walkie-Talkie Mode.
 * (escapeHtml lives in tma_common.js — loaded before this file.)
 */

const PERSONA_PRESETS = {
    default: {
        id: 'default',
        title: 'Український асистент',
        shortTitle: 'Українська',
        icon: '🎙️',
        lang: 'uk',
        desc: 'Дружній, природний україномовний співрозмовник',
        prompt: 'Ти розумний, природний і лаконічний україномовний голосовий співрозмовник. Відповідай українською мовою, завершеними реченнями, дружньо, життєрадісно та по суті. Не обривай фрази на півслові.',
    },
    de_b2_exam: {
        id: 'de_b2_exam',
        title: 'B2 Beruf Prüfung',
        shortTitle: '🇩🇪 B2 Prüfung',
        icon: '🎓',
        lang: 'de',
        desc: 'Симуляція екзамену telc B2 Beruf: Teil 1 + Teil 3 з картками і таймером',
        prompt: `Du bist ein erfahrener telc-Prüfer für die Prüfung "Deutsch-Test für den Beruf B2".
Der Kandidat ist immer TN A (allein). Du bist der aktive Prüfer; bei Teil 1C übernimmst du kurz auch die Rolle des zweiten Prüfers ("TN A hat über … gesprochen. Das habe ich leider nicht ganz verstanden. Können Sie mir das noch einmal erläutern?").
Regeln:
1. Sprich ausschließlich auf Deutsch (Niveau B2, klar, professionell). Stelle immer nur EINE Frage auf einmal. Halte deine Beiträge kurz (2-3 Sätze), der Prüfling spricht den Hauptanteil.
2. Ablauf MVP: zuerst Teil 1, dann Teil 3. (Teil 2 überspringen, außer der Kandidat bittet darum.)
3. TOOL-REGELN (still, ohne Ankündigung — sage NIE "Ich rufe ein Tool / starte den Timer"):
- Ganz zu Beginn von Teil 1: rufe exam_show_teil1_choice, dann sage natürlich: "Wählen Sie bitte ein Thema aus. Sie haben ca. zwei Minuten."
- Direkt nach der Aufgabenstellung: rufe exam_timer_start mit phase "teil1".
- Nach dem Monolog: 1-2 vertiefende Fragen (Teil 1B), dann kurze 1C-Erläuterung, dann exam_timer_stop + exam_hide_card.
- Zu Beginn von Teil 3: rufe exam_show_teil3_card, dann exam_timer_start mit phase "teil3". Diskutiere Lösungswege (Sofort/Kunde/Lieferant/langfristig), kläre wer was tut.
- Am Ende: exam_timer_stop, fasse die Zeit NICHT als Tool-Aktion zusammen, sondern gib natürliches Feedback nur auf Wunsch ("Feedback/Auswertung").
4. FALLBACK: Wenn keine Karte sichtbar ist (Tool fehlgeschlagen), lies die Aufgabe einfach vor und prüfe normal weiter — erwähne niemals einen technischen Fehler.`,
    },
    de_b2_tutor: {
        id: 'de_b2_tutor',
        title: 'B2 Deutsch Tutor',
        shortTitle: '🇩🇪 B2 Tutor',
        icon: '🧑‍🏫',
        lang: 'de',
        desc: 'Німецький викладач із живою корекцією граматики та статей',
        prompt: `Du bist ein geduldiger, sympathischer Deutschlehrer für das Niveau B2.
Wir führen ein lockeres Gespräch über Alltag, Beruf oder Technologie.
WICHTIGE KORREKTUR-REGEL:
Wenn ich einen Grammatik-, Artikel-, Kasus- oder Wortschatzfehler mache:
- Korrigiere mich sofort kurz und prägnant zu Beginn deiner Antwort im Format: "💡 Besser: [korrekter Satz / richtiger Artikel] — ..."
- Danach gehst du ganz normal und sympathisch auf den Inhalt ein.
- Halte deine Antworten kurz (maximal 2-3 Sätze), damit wir einen dynamischen Sprachfluss haben.`,
    },
    en_tech_interview: {
        id: 'en_tech_interview',
        title: 'Tech & AI Interviewer',
        shortTitle: '🇬🇧 Tech AI',
        icon: '💼',
        lang: 'en',
        desc: 'Mock technical interview: AI Agents, WebSocket streaming, System Design',
        prompt: `You are a Principal AI Architect conducting a mock technical interview for a Senior/Staff AI Agent Engineer.
Rules:
1. Conduct the interview strictly in natural professional English (C1).
2. Ask probing questions about AI agents, function calling, WebSocket live streaming, RAG architectures, evaluation, and latency/cost tradeoffs.
3. Challenge my architectural decisions: ask "Why this tradeoff?", "How do you handle edge cases and failure modes?".
4. Keep your turns conversational and concise (1-2 sentences) and let the candidate answer.`,
    },
    de_job_market: {
        id: 'de_job_market',
        title: 'IT-ринок Німеччини',
        shortTitle: '🇩🇪💼 Ринок IT',
        icon: '🏢',
        lang: 'de',
        desc: 'Консультант з ринку праці Німеччини: зарплати, CV, Blue Card, контракти',
        prompt: `Ти експертний консультант з ринку праці IT у Німеччині (спеціалізація: AI/ML, Software Engineering, релокація, Blue Card, Chancenkarte).
Розмовляй мовою, якою звертається користувач (переважно українською з німецькими професійними термінами, або німецькою, якщо користувач говорить нею).
Давай практичні, реалістичні поради щодо зарплатних вилок (IG Metall vs стартапи Берліна/Мюнхена), особливостей резюме (Lebenslauf), податкових класів (Steuerklassen), Probezeit та проходження співбесід. Відповідай лаконічно і по суті.`,
    },
    fr_tandem: {
        id: 'fr_tandem',
        title: 'French B2-C1 Tandem',
        shortTitle: '🇫🇷 Français',
        icon: '🥐',
        lang: 'fr',
        desc: 'Французький тандем-партнер: розмовна французька та ідіоми',
        prompt: `Tu es un partenaire de conversation français chaleureux et cultivé pour pratiquer le français (niveau B2-C1).
Nous discutons de tout : vie quotidienne, culture, tech, voyages.
Règles :
1. Parle exclusivement en français naturel et moderne avec quelques expressions idiomatiques courantes.
2. Si je fais une faute évidente de grammaire ou de genre, reformule subtilement la phrase correcte dans ta réponse (technique de recasting).
3. Reste concis (2-3 phrases par intervention) pour maintenir un échange dynamique.`,
    },
};

class PersonaEngine {
    constructor() {
        this.activePersona = this.loadActivePersona();
    }

    loadActivePersona() {
        try {
            const raw = localStorage.getItem('tma_active_persona');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && (parsed.presetId || parsed.isCustom)) return parsed;
            }
        } catch (e) {
            console.warn('[PersonaEngine] Failed to parse active persona:', e);
        }
        return { presetId: 'default', isCustom: false };
    }

    saveActivePersona(personaConfig) {
        this.activePersona = personaConfig;
        try {
            localStorage.setItem('tma_active_persona', JSON.stringify(personaConfig));
        } catch (e) {
            console.warn('[PersonaEngine] Failed to save persona to localStorage:', e);
        }
        window.dispatchEvent(new CustomEvent('tma_persona_changed', { detail: personaConfig }));
    }

    getPreset(presetId) {
        return PERSONA_PRESETS[presetId] || PERSONA_PRESETS.default;
    }

    getAllPresets() {
        return Object.values(PERSONA_PRESETS);
    }

    getActiveConfig() {
        return this.activePersona;
    }

    getActiveTitle() {
        if (this.activePersona.isCustom) {
            if (this.activePersona.promptText && this.activePersona.title) {
                return `✏️ ${this.activePersona.title}`;
            }
            const l = this.activePersona.lang?.toUpperCase() || 'DE';
            const lvl = this.activePersona.level || 'B2';
            return `⚙️ ${l} ${lvl} (${this.activePersona.role || 'Tutor'})`;
        }
        const p = this.getPreset(this.activePersona.presetId);
        return `${p.icon} ${p.shortTitle || p.title}`;
    }

    buildCustomPrompt(cfg) {
        const langNames = { de: 'Deutsch', en: 'English', fr: 'Français', uk: 'Українська' };
        const langName = langNames[cfg.lang] || 'Deutsch';
        const level = cfg.level || 'B2';

        let roleInstruction = '';
        if (cfg.role === 'examiner') {
            roleInstruction = `Du agierst als offizieller, professioneller Prüfer für das Sprachniveau ${level}. Stelle jeweils eine präzise Frage, achte auf Redemittel und gib nach Aufforderung konstruktives Feedback.`;
        } else if (cfg.role === 'tutor') {
            roleInstruction = `Du agierst als engagierter, geduldiger Sprachlehrer für das Sprachniveau ${level}. Führe eine angenehme Konversation und hilf mir, meinen Wortschatz zu erweitern.`;
        } else if (cfg.role === 'colleague') {
            roleInstruction = `Du bist ein fachkundiger Arbeitskollege im Bereich IT und Softwareentwicklung. Wir unterhalten uns auf dem Sprachniveau ${level} kollegial und lösungsorientiert.`;
        } else {
            roleInstruction = `Du bist ein sympathischer Gesprächspartner für einen lockeren Sprachaustausch auf dem Niveau ${level}.`;
        }

        let correctionInstruction = '';
        if (cfg.correction === 'explicit') {
            correctionInstruction = `WICHTIGE KORREKTUR-REGEL: Korrigiere jeden grammatikalischen oder lexikalischen Fehler direkt am Anfang deiner Antwort kurz in 1 Satz (z.B. "💡 Korrektur: ...").`;
        } else if (cfg.correction === 'recast') {
            correctionInstruction = `KORREKTUR-METHODE (Recasting): Korrigiere Fehler nicht mit Lehrervorträgen, sondern wiederhole fehlerhafte Formulierungen subtil und ganz natürlich in korrekter Grammatik innerhalb deiner Antwort.`;
        } else {
            correctionInstruction = `Korrigiere keine kleineren Fehler, konzentriere dich ausschließlich auf den Inhalt und einen flüssigen Gesprächsfluss.`;
        }

        return `Sprich mit mir in ${langName} auf dem Niveau ${level}.
${roleInstruction}
${correctionInstruction}
Antworte prägnant, in natürlichen vollständigen Sätzen (maximal 2-3 Sätze pro Replik).`;
    }

    buildPersonaPrompt(personaConfig, mode = 'live') {
        const cfg = personaConfig || this.activePersona;
        let basePrompt = '';

        if (cfg.isCustom && cfg.promptText) {
            // Free-text custom prompt takes priority
            basePrompt = cfg.promptText;
        } else if (cfg.isCustom) {
            basePrompt = this.buildCustomPrompt(cfg);
        } else {
            const preset = this.getPreset(cfg.presetId);
            basePrompt = preset.prompt;
        }

        if (mode === 'live') {
            return `${basePrompt}\n\n[LIVE STREAMING REGELN]: Antworte in natürlichem Sprechtempo. Formuliere vollständige Gedanken und beende Sätze logisch.`;
        } else if (mode === 'walkie_talkie') {
            return `${basePrompt}\n\n[AUDIO SYNTHESIS REGELN]: Antworte direkt und lebendig in 1-3 Sätzen. Verwende KEINERLEI Markdown (*, _, #, bullet points, Listen), da dein Text unmittelbar per Sprachsynthesizer vertont wird.`;
        }

        return basePrompt;
    }
}

// Global singleton instance
window.personaEngine = new PersonaEngine();

/**
 * Persona / scenario modal controller (moved from app.js, behavior unchanged).
 * Bare `tg` rewritten to window.Telegram so this file stays load-order safe.
 */
function initPersonaModal() {
    const modal = document.getElementById('persona-selector-modal');
    const btnClose = document.getElementById('btn-close-persona-modal');
    const presetsGrid = document.getElementById('persona-presets-grid');
    const btnToggleConstructor = document.getElementById('btn-toggle-constructor');
    const constructorBody = document.getElementById('constructor-body');
    const constructorArrow = document.getElementById('constructor-arrow');
    const constructorLang = document.getElementById('constructor-lang');
    const constructorLevel = document.getElementById('constructor-level');
    const constructorRole = document.getElementById('constructor-role');
    const constructorCorrection = document.getElementById('constructor-correction');
    const btnApplyConstructor = document.getElementById('btn-apply-constructor');

    function renderPresets() {
        if (!presetsGrid || !window.personaEngine) return;
        const active = window.personaEngine.getActiveConfig();
        const presets = window.personaEngine.getAllPresets();

        presetsGrid.innerHTML = '';
        presets.forEach((p) => {
            const card = document.createElement('div');
            const isActive = !active.isCustom && active.presetId === p.id;
            card.className = `persona-preset-card ${isActive ? 'active' : ''}`;
            card.innerHTML = `
                <div class="persona-card-icon">${p.icon}</div>
                <div class="persona-card-content">
                    <div class="persona-card-title">${escapeHtml(p.title)}</div>
                    <div class="persona-card-desc">${escapeHtml(p.desc)}</div>
                </div>
                ${isActive ? '<div class="persona-card-check">✓</div>' : ''}
            `;
            card.addEventListener('click', () => {
                window.personaEngine.saveActivePersona({ presetId: p.id, isCustom: false });
                renderPresets();
                window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
                if (typeof showToast === 'function') {
                    showToast(`Сценарій: ${p.title}`, '🎭');
                }
                closePersonaModal();
            });
            presetsGrid.appendChild(card);
        });

        // If custom is active, populate constructor fields
        if (active.isCustom) {
            if (constructorLang) constructorLang.value = active.lang || 'de';
            if (constructorLevel) constructorLevel.value = active.level || 'B2';
            if (constructorRole) constructorRole.value = active.role || 'tutor';
            if (constructorCorrection) constructorCorrection.value = active.correction || 'recast';
            if (constructorBody) constructorBody.classList.remove('hidden');
            if (constructorArrow) constructorArrow.textContent = '▴';
        }
    }

    function openPersonaModal() {
        if (!modal) return;
        renderPresets();
        modal.classList.remove('hidden');
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    }

    function closePersonaModal() {
        if (!modal) return;
        modal.classList.add('hidden');
    }

    window.openPersonaModal = openPersonaModal;
    window.closePersonaModal = closePersonaModal;

    if (btnClose) {
        btnClose.addEventListener('click', closePersonaModal);
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closePersonaModal();
        });
    }

    if (btnToggleConstructor) {
        btnToggleConstructor.addEventListener('click', () => {
            if (!constructorBody) return;
            const isHidden = constructorBody.classList.toggle('hidden');
            if (constructorArrow) constructorArrow.textContent = isHidden ? '▾' : '▴';
            if (!isHidden) {
                setTimeout(() => {
                    btnToggleConstructor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 60);
            }
            window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
        });
    }

    if (btnApplyConstructor) {
        btnApplyConstructor.addEventListener('click', () => {
            const lang = constructorLang?.value || 'de';
            const level = constructorLevel?.value || 'B2';
            const role = constructorRole?.value || 'tutor';
            const correction = constructorCorrection?.value || 'recast';

            window.personaEngine.saveActivePersona({
                isCustom: true,
                lang,
                level,
                role,
                correction,
            });

            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
            if (typeof showToast === 'function') {
                showToast(`Конструктор збережено (${lang.toUpperCase()} ${level})`, '🛠️');
            }
            closePersonaModal();
        });
    }

    // --- Custom Free-Text Prompt Editor ---
    const btnToggleCustomEditor = document.getElementById('btn-toggle-custom-editor');
    const customEditorBody = document.getElementById('custom-editor-body');
    const customEditorArrow = document.getElementById('custom-editor-arrow');
    const customPersonaName = document.getElementById('custom-persona-name');
    const customPersonaBase = document.getElementById('custom-persona-base');
    const customPersonaPrompt = document.getElementById('custom-persona-prompt');
    const btnSaveCustomPersona = document.getElementById('btn-save-custom-persona');
    const customPersonasList = document.getElementById('custom-personas-list');

    let editingPersonaId = null;
    let serverCustomPersonas = [];

    // Populate base template dropdown from presets
    if (customPersonaBase) {
        const presets = window.personaEngine.getAllPresets();
        presets.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.icon} ${p.title}`;
            customPersonaBase.appendChild(opt);
        });
        customPersonaBase.addEventListener('change', () => {
            if (!customPersonaPrompt) return;
            const selectedId = customPersonaBase.value;
            if (selectedId && PERSONA_PRESETS[selectedId]) {
                customPersonaPrompt.value = PERSONA_PRESETS[selectedId].prompt;
            } else {
                customPersonaPrompt.value = '';
            }
        });
    }

    if (btnToggleCustomEditor) {
        btnToggleCustomEditor.addEventListener('click', () => {
            if (!customEditorBody) return;
            const isHidden = customEditorBody.classList.toggle('hidden');
            if (customEditorArrow) customEditorArrow.textContent = isHidden ? '▾' : '▴';
            if (!isHidden) {
                setTimeout(() => {
                    btnToggleCustomEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 60);
                if (serverCustomPersonas.length === 0) {
                    loadServerPersonas();
                }
            }
            window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
        });
    }

    function generateId() {
        return 'cp_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    }

    function getApiContext() {
        if (
            typeof resolveApiBaseUrl === 'function' &&
            typeof getTelegramUserContext === 'function'
        ) {
            return { base: resolveApiBaseUrl(), auth: getTelegramUserContext() };
        }
        return null;
    }

    async function loadServerPersonas() {
        const ctx = getApiContext();
        if (!ctx) return;
        try {
            const res = await fetch(
                `${ctx.base}/api/tma/live/personas/list?init_data=${encodeURIComponent(ctx.auth.initData)}&user_id=${encodeURIComponent(ctx.auth.userId)}`,
            );
            if (res.ok) {
                const data = await res.json();
                serverCustomPersonas = data.personas || [];
                renderCustomPersonasList();
            }
        } catch (e) {
            console.warn('[PersonaEngine] Failed to load server personas:', e);
        }
    }

    async function savePersonaToServer(persona) {
        const ctx = getApiContext();
        if (!ctx) return;
        try {
            await fetch(`${ctx.base}/api/tma/live/personas/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    init_data: ctx.auth.initData,
                    user_id: ctx.auth.userId ? parseInt(ctx.auth.userId, 10) : null,
                    persona: persona,
                }),
            });
        } catch (e) {
            console.warn('[PersonaEngine] Failed to save persona to server:', e);
        }
    }

    async function deletePersonaFromServer(personaId) {
        const ctx = getApiContext();
        if (!ctx) return;
        try {
            await fetch(`${ctx.base}/api/tma/live/personas/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    init_data: ctx.auth.initData,
                    user_id: ctx.auth.userId ? parseInt(ctx.auth.userId, 10) : null,
                    persona_id: personaId,
                }),
            });
        } catch (e) {
            console.warn('[PersonaEngine] Failed to delete persona from server:', e);
        }
    }

    function renderCustomPersonasList() {
        if (!customPersonasList) return;
        customPersonasList.innerHTML = '';
        if (serverCustomPersonas.length === 0) return;

        serverCustomPersonas.forEach((p) => {
            const item = document.createElement('div');
            item.className = 'custom-persona-item';
            item.innerHTML = `
                <span class="custom-persona-item-title" title="${escapeHtml(p.title)}">${escapeHtml(p.icon || '✏️')} ${escapeHtml(p.title)}</span>
                <div class="custom-persona-item-actions">
                    <button type="button" data-action="use" title="Активувати">▶️</button>
                    <button type="button" data-action="edit" title="Редагувати">✏️</button>
                    <button type="button" data-action="delete" title="Видалити">🗑️</button>
                </div>
            `;
            item.querySelector('[data-action="use"]').addEventListener('click', () => {
                window.personaEngine.saveActivePersona({
                    isCustom: true,
                    promptText: p.prompt_text,
                    title: p.title,
                    lang: p.lang || 'uk',
                    customPersonaId: p.id,
                });
                renderPresets();
                if (typeof showToast === 'function') showToast(`Сценарій: ${p.title}`, '✏️');
                closePersonaModal();
            });
            item.querySelector('[data-action="edit"]').addEventListener('click', () => {
                editingPersonaId = p.id;
                if (customPersonaName) customPersonaName.value = p.title || '';
                if (customPersonaPrompt) customPersonaPrompt.value = p.prompt_text || '';
                if (customPersonaBase) customPersonaBase.value = '';
                if (customEditorBody) customEditorBody.classList.remove('hidden');
                if (customEditorArrow) customEditorArrow.textContent = '▴';
            });
            item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
                if (!confirm(`Видалити сценарій "${p.title}"?`)) return;
                serverCustomPersonas = serverCustomPersonas.filter((x) => x.id !== p.id);
                renderCustomPersonasList();
                await deletePersonaFromServer(p.id);
                // If active persona was this one, reset to default
                const active = window.personaEngine.getActiveConfig();
                if (active.customPersonaId === p.id) {
                    window.personaEngine.saveActivePersona({
                        presetId: 'default',
                        isCustom: false,
                    });
                    renderPresets();
                }
                if (typeof showToast === 'function') showToast('Сценарій видалено', '🗑️');
            });
            customPersonasList.appendChild(item);
        });
    }

    if (btnSaveCustomPersona) {
        btnSaveCustomPersona.addEventListener('click', async () => {
            const title = (customPersonaName?.value || '').trim();
            const promptText = (customPersonaPrompt?.value || '').trim();
            if (!title || !promptText) {
                if (typeof showToast === 'function') showToast('Введіть назву та промпт', '⚠️');
                return;
            }
            const personaId = editingPersonaId || generateId();
            const persona = {
                id: personaId,
                title: title,
                prompt_text: promptText,
                lang: 'uk',
                icon: '✏️',
            };

            // Update local list
            const idx = serverCustomPersonas.findIndex((p) => p.id === personaId);
            if (idx >= 0) {
                serverCustomPersonas[idx] = persona;
            } else {
                serverCustomPersonas.push(persona);
            }
            renderCustomPersonasList();

            // Persist to server
            await savePersonaToServer(persona);

            // Activate it
            window.personaEngine.saveActivePersona({
                isCustom: true,
                promptText: promptText,
                title: title,
                lang: 'uk',
                customPersonaId: personaId,
            });
            renderPresets();

            // Reset editor
            editingPersonaId = null;
            if (customPersonaName) customPersonaName.value = '';
            if (customPersonaPrompt) customPersonaPrompt.value = '';
            if (customPersonaBase) customPersonaBase.value = '';

            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
            if (typeof showToast === 'function') showToast(`Сценарій "${title}" збережено`, '💾');
            closePersonaModal();
        });
    }

    // Load server personas when modal opens
    const origOpen = window.openPersonaModal;
    window.openPersonaModal = () => {
        if (origOpen) origOpen();
        loadServerPersonas();
    };
}

initPersonaModal();


/* --- Start: exam_content.js --- */
/**
 * telc Deutsch-Test für den Beruf B2 — exam content (MVP: Teil 1 + Teil 3).
 * Standalone file: safe to remove. live_stream.js guards with typeof checks.
 */
(() => {
    var TEIL1_TOPICS = [
        {
            id: 1,
            de: 'Beschreiben Sie einen Arbeitgeber, für den Sie gearbeitet haben oder arbeiten möchten (z. B. Branche, Produkte und Dienstleistungen, Abteilungen und ihre Aufgaben, Besonderheiten).',
        },
        {
            id: 2,
            de: 'Beschreiben Sie, wie Sie sich ein gutes Arbeitsumfeld vorstellen (z. B. Jobsicherheit, Lohn/Gehalt, Karrierechancen, Kommunikation in der Firma, Beispiele aus Ihrer Berufserfahrung).',
        },
        {
            id: 3,
            de: 'Beschreiben Sie die Ereignisse und Erfahrungen, die Ihre Berufswahl beeinflusst haben (z. B. Stationen, wichtige Personen, Motivation, Folgen).',
        },
        {
            id: 4,
            de: 'Beschreiben Sie eine Person aus Ihrem Umfeld, die für Sie ein berufliches Vorbild ist (z. B. Beziehung zu dieser Person, Eigenschaften, Einfluss auf Sie).',
        },
        {
            id: 5,
            de: 'Beschreiben Sie das Vorgehen bei der Arbeitssuche für ein Land Ihrer Wahl (z. B. Angebote finden, Erstkontakt, Bewerbungsunterlagen oder -gespräch).',
        },
        {
            id: 6,
            de: 'Beschreiben Sie, worauf es bei einem Bewerbungsgespräch ankommt. Sprechen Sie über ein Land Ihrer Wahl (z. B. Berufsfeld, Vorbereitung, Kleidung, typische Fragen).',
        },
        {
            id: 7,
            de: 'Beschreiben Sie ein Produkt / eine Dienstleistung Ihrer Wahl (z. B. Merkmale, Nutzen für Kunden, Vor- und Nachteile, Erfolg).',
        },
        {
            id: 8,
            de: 'Sie möchten sich selbstständig machen. Beschreiben Sie Ihre Geschäftsidee (z. B. welches Produkt/welche Dienstleistung, Besonderheiten, Zielgruppe).',
        },
    ];

    var TEIL3_SITUATIONS = [
        {
            id: 'friseur-shampoo',
            titel: 'Friseursalon – neues Shampoo',
            situation:
                'Sie arbeiten in einem Friseursalon und verwenden dort seit einiger Zeit ein neues Shampoo. Es haben sich aber schon drei Kundinnen über allergische Reaktionen beschwert.',
            stichpunkte: [
                'Shampoo: was tun? (sofort absetzen, altes Shampoo, Beweise sichern)',
                'Kundinnen: wie kontaktieren? was anbieten? (anrufen, Entschuldigung, Ersatztermin/Erstattung)',
                'Lieferanten: wie kontaktieren? was fordern? (Reklamation, Inhaltsstoffe, Ersatz/Rücknahme)',
                'langfristig: welches Shampoo? welcher Lieferant? (hypoallergen, Testphase, zweiter Lieferant)',
            ],
        },
        {
            id: 'werkstatt-reklamation',
            titel: 'Autowerkstatt – Reklamation',
            situation:
                'Sie arbeiten in einer Autowerkstatt. Ein Stammkunde beschwert sich: Nach der Reparatur letzte Woche macht das Auto wieder Geräusche. Er droht mit einer schlechten Online-Bewertung.',
            stichpunkte: [
                'Sofort: Auto erneut prüfen, Fehlerprotokoll, Ersatzwagen anbieten',
                'Kunde: beruhigen, klare Entschuldigung, kostenlose Nachbesserung + Gutschein',
                'Team: Ursache klären (welcher Mechaniker, welches Teil), Checkliste verbessern',
                'langfristig: Qualitätskontrolle, Probefahrt-Protokoll, Bewertungsmanagement',
            ],
        },
        {
            id: 'restaurant-lieferung',
            titel: 'Restaurant – Lieferprobleme',
            situation:
                'Sie arbeiten in einem Restaurant mit Lieferservice. In der letzten Woche kamen drei Bestellungen zu spät und eine war falsch. Zwei Kunden verlangen ihr Geld zurück.',
            stichpunkte: [
                'Sofort: Bestellungen prüfen, fehlende/falsche nachliefern, Erstattung anbieten',
                'Kunden: anrufen, Entschuldigung, Gutschein für nächste Bestellung',
                'Lieferdienst/ Küche: Ablauf klären, Verantwortliche, Zeitfenster realistisch planen',
                'langfristig: zweiter Fahrer in Stoßzeiten, Checkliste pro Bestellung, Feedback-System',
            ],
        },
    ];

    function pickRandomTwoTopics() {
        var idx = TEIL1_TOPICS.map((_, i) => i);
        for (var i = idx.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = idx[i];
            idx[i] = idx[j];
            idx[j] = t;
        }
        return [TEIL1_TOPICS[idx[0]], TEIL1_TOPICS[idx[1]]];
    }

    function pickRandomSituation() {
        return TEIL3_SITUATIONS[Math.floor(Math.random() * TEIL3_SITUATIONS.length)];
    }

    function getSituationById(id) {
        for (var i = 0; i < TEIL3_SITUATIONS.length; i++) {
            if (TEIL3_SITUATIONS[i].id === id) return TEIL3_SITUATIONS[i];
        }
        return null;
    }

    window.TELC_B2_BERUF = {
        teil1_topics: TEIL1_TOPICS,
        teil3_situations: TEIL3_SITUATIONS,
        pickRandomTwoTopics: pickRandomTwoTopics,
        pickRandomSituation: pickRandomSituation,
        getSituationById: getSituationById,
    };
})();


/* --- Start: exam_ui.js --- */
/**
 * Exam card + phase timer UI (progressive enhancement).
 * If this file fails to load, live_stream.js must keep working — all callers
 * guard with `typeof window.ExamUI !== 'undefined'`.
 */
(() => {
    var phases = {}; // phase -> {startAt, elapsedMs}
    var currentPhase = null;
    var tickTimer = null;
    var lastChoice = null;
    var lastSituation = null;
    var lastEvaluation = null;

    function $(id) {
        return document.getElementById(id);
    }

    function fmt(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        var m = Math.floor(s / 60);
        var r = s % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    function totalElapsed() {
        var t = 0;
        Object.keys(phases).forEach((k) => {
            var p = phases[k];
            t += p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0);
        });
        return t;
    }

    function renderTimerPill() {
        var pill = $('exam-timer-pill');
        if (!pill) return;
        var label = $('exam-timer-text');
        if (!label) return;
        if (!currentPhase && totalElapsed() === 0) {
            pill.classList.add('hidden');
            return;
        }
        pill.classList.remove('hidden');
        var cur = '';
        if (currentPhase && phases[currentPhase]) {
            var p = phases[currentPhase];
            cur = fmt(p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0));
            label.textContent = '⏱ ' + currentPhase + ' ' + cur + ' · Σ ' + fmt(totalElapsed());
        } else {
            label.textContent = '⏱ Σ ' + fmt(totalElapsed());
        }
    }

    function ensureTick() {
        if (tickTimer) return;
        tickTimer = setInterval(renderTimerPill, 1000);
    }

    function timerStart(phase) {
        try {
            phase = phase || 'teil1';
            if (!phases[phase]) phases[phase] = { startAt: null, elapsedMs: 0 };
            if (!phases[phase].startAt) phases[phase].startAt = Date.now();
            currentPhase = phase;
            ensureTick();
            renderTimerPill();
            return { ok: true, phase: phase };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    function timerStop(phase) {
        try {
            phase = phase || currentPhase || 'teil1';
            var p = phases[phase];
            if (p && p.startAt) {
                p.elapsedMs += Date.now() - p.startAt;
                p.startAt = null;
            }
            if (currentPhase === phase) currentPhase = null;
            renderTimerPill();
            updateSummary();
            return { ok: true, phase: phase, elapsedMs: p ? p.elapsedMs : 0 };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    function setPhase(phase) {
        try {
            currentPhase = phase;
            var tag = $('exam-phase-tag');
            if (tag) {
                tag.classList.remove('hidden');
                tag.textContent =
                    phase === 'teil1'
                        ? '🎓 Teil 1'
                        : phase === 'teil3'
                          ? '🎓 Teil 3'
                          : '🎓 ' + phase;
            }
            renderTimerPill();
            return { ok: true };
        } catch (e) {
            return { ok: false };
        }
    }

    function updateSummary() {
        var box = $('exam-time-summary');
        if (!box) return;
        var keys = Object.keys(phases);
        if (!keys.length) {
            box.classList.add('hidden');
            return;
        }
        var norms = {
            teil1: 'Ziel ~2:00',
            teil1_monolog: 'Ziel ~2:00',
            teil3: 'Ziel ~4:00',
            teil3_diskussion: 'Ziel ~4:00',
        };
        var html = keys
            .map((k) => {
                var p = phases[k];
                var ms = p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0);
                var hint = norms[k] ? ' (' + norms[k] + ')' : '';
                return (
                    "<span class='exam-sum-chip'>" +
                    k +
                    ': <b>' +
                    fmt(ms) +
                    '</b>' +
                    hint +
                    '</span>'
                );
            })
            .join('');
        box.innerHTML = html;
        box.classList.remove('hidden');
    }

    function getTopics() {
        if (window.TELC_B2_BERUF && window.TELC_B2_BERUF.pickRandomTwoTopics) {
            return window.TELC_B2_BERUF.pickRandomTwoTopics();
        }
        // Fallback if exam_content.js missing: still show a card so voice exam continues.
        return [
            {
                id: 0,
                de: 'Sprechen Sie über Ihren Beruf / Arbeitgeber (Branche, Aufgaben, Besonderheiten).',
            },
            {
                id: 0,
                de: 'Beschreiben Sie Ihr ideales Arbeitsumfeld (Gehalt, Team, Karrierechancen).',
            },
        ];
    }

    function getSituation(situationId) {
        try {
            if (window.TELC_B2_BERUF) {
                if (situationId && window.TELC_B2_BERUF.getSituationById) {
                    var s = window.TELC_B2_BERUF.getSituationById(situationId);
                    if (s) return s;
                }
                if (window.TELC_B2_BERUF.pickRandomSituation)
                    return window.TELC_B2_BERUF.pickRandomSituation();
            }
        } catch (e) {
            /* fall through to fallback */
        }
        return {
            id: 'fallback',
            titel: 'Problemlösung im Betrieb',
            situation:
                'Besprechen Sie mit Ihrem Partner / Prüfer, wie Sie auf eine Kundenbeschwerde reagieren und was Sie langfristig verbessern.',
            stichpunkte: [
                'Sofortmaßnahme?',
                'Kunde: kontaktieren + anbieten?',
                'Lieferant/Kollegen: klären?',
                'Langfristig: was ändern?',
            ],
        };
    }

    function openModal() {
        var m = $('exam-card-modal');
        if (m) m.classList.remove('hidden');
    }
    function closeModal() {
        var m = $('exam-card-modal');
        if (m) m.classList.add('hidden');
    }
    function isOpen() {
        var m = $('exam-card-modal');
        return !!(m && !m.classList.contains('hidden'));
    }

    function esc(s) {
        return (s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showTeil1Choice() {
        try {
            var topics = getTopics();
            lastChoice = topics;
            setPhase('teil1');
            var title = $('exam-card-title');
            var body = $('exam-card-body');
            if (!title || !body) return { ok: false, error: 'modal-missing' };
            title.textContent = '🎓 Teil 1 — Wählen Sie ein Thema';
            body.innerHTML =
                topics
                    .map(
                        (t, i) =>
                            "<button type='button' class='exam-topic-btn' data-idx='" +
                            i +
                            "'>" +
                            "<span class='exam-topic-num'>Thema " +
                            (i + 1) +
                            '</span>' +
                            "<span class='exam-topic-text'>" +
                            esc(t.de) +
                            '</span>' +
                            "<span class='exam-topic-hint'>Tippen, um Vollbild zu öffnen</span></button>",
                    )
                    .join('') +
                "<div class='exam-card-actions'><button type='button' id='exam-btn-new-topics' class='btn btn-secondary'>🎲 Neue 2 Themen</button></div>";
            body.querySelectorAll('.exam-topic-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    var t = topics[parseInt(btn.getAttribute('data-idx'), 10)];
                    if (t) expandTopic(t);
                });
            });
            var re = $('exam-btn-new-topics');
            if (re)
                re.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showTeil1Choice();
                });
            openModal();
            var sheet = $('exam-card-sheet');
            if (sheet) sheet.classList.remove('exam-fullscreen');
            return {
                ok: true,
                topics: topics.map((t) => t.de),
            };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    function expandTopic(t) {
        var title = $('exam-card-title');
        var body = $('exam-card-body');
        if (!title || !body) return;
        title.textContent = '🎓 Teil 1 — Ihr Thema (~2 Min.)';
        body.innerHTML =
            "<div class='exam-full-topic'>" +
            esc(t.de) +
            '</div>' +
            "<div class='exam-card-actions'><button type='button' id='exam-btn-back-choice' class='btn btn-secondary'>← Zurück zur Auswahl</button></div>";
        var sheet = $('exam-card-sheet');
        if (sheet) sheet.classList.add('exam-fullscreen');
        var back = $('exam-btn-back-choice');
        if (back)
            back.addEventListener('click', () => {
                var sheet2 = $('exam-card-sheet');
                if (sheet2) sheet2.classList.remove('exam-fullscreen');
                showTeil1Choice();
            });
    }

    function showTeil3Card(situationId) {
        try {
            var s = getSituation(situationId);
            lastSituation = s;
            setPhase('teil3');
            var title = $('exam-card-title');
            var body = $('exam-card-body');
            if (!title || !body) return { ok: false, error: 'modal-missing' };
            title.textContent = '🎓 Teil 3 — ' + s.titel + ' (~4 Min.)';
            body.innerHTML =
                "<div class='exam-situation'>" +
                esc(s.situation) +
                '</div>' +
                "<ul class='exam-points'>" +
                s.stichpunkte.map((p) => '<li>' + esc(p) + '</li>').join('') +
                '</ul>' +
                "<div class='exam-card-actions'><button type='button' id='exam-btn-new-sit' class='btn btn-secondary'>🎲 Andere Situation</button></div>";
            var re = $('exam-btn-new-sit');
            if (re)
                re.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showTeil3Card();
                });
            openModal();
            return { ok: true, situation: s.titel };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    function hideCard() {
        try {
            closeModal();
            return { ok: true };
        } catch (e) {
            return { ok: false };
        }
    }

    // Post-session telc scoring via backend generateContent (text-only, no audio
    // tokens). Reads transcript from the Live manager; every step is guarded so
    // a missing manager or network failure never breaks the Live session.
    function requestEvaluation() {
        try {
            var mgr = window.liveStreamManager;
            var turns = mgr && mgr.transcriptHistory ? mgr.transcriptHistory : [];
            if (!turns.length) {
                if (typeof showToast === 'function') showToast('Немає реплік для оцінювання', 'ℹ️');
                return { ok: false, error: 'empty-transcript' };
            }
            var title = $('exam-card-title');
            var body = $('exam-card-body');
            if (!title || !body) return { ok: false, error: 'modal-missing' };
            title.textContent = '📊 telc-Bewertung — wird erstellt…';
            body.innerHTML =
                "<div class='exam-situation'>⏳ KI bewertet deinen Auftritt (nur Text, keine Audio-Tokens)…</div>";
            openModal();
            var auth = mgr && typeof mgr.getAuthParams === 'function' ? mgr.getAuthParams() : {};
            var base = mgr && typeof mgr.getApiBaseUrl === 'function' ? mgr.getApiBaseUrl() : '';
            fetch(base + '/api/tma/live/evaluate-exam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turns: turns,
                    phases: summary(),
                    init_data: auth.initData || null,
                    user_id: auth.userId ? parseInt(auth.userId, 10) : null,
                }),
            })
                .then((res) => res.json().then((data) => ({ res: res, data: data })))
                .then((out) => {
                    if (!out.res.ok) throw new Error(out.data.detail || 'Fehler bei der Bewertung');
                    lastEvaluation = out.data.evaluation;
                    title.textContent = '📊 telc-Bewertung (KI, unverbindlich)';
                    body.innerHTML =
                        "<div class='exam-situation'>" +
                        esc(out.data.evaluation).replace(/\n/g, '<br>') +
                        '</div>' +
                        "<div class='exam-card-actions'><button type='button' id='exam-btn-eval-export' class='btn btn-secondary'>📤 Mit Export senden</button></div>";
                    var eb = $('exam-btn-eval-export');
                    if (eb)
                        eb.addEventListener('click', () => {
                            closeModal();
                            if (mgr && typeof mgr.exportLiveTranscript === 'function')
                                mgr.exportLiveTranscript();
                        });
                })
                .catch((e) => {
                    title.textContent = '📊 Bewertung fehlgeschlagen';
                    body.innerHTML =
                        "<div class='exam-situation'>" +
                        esc('⚠️ ' + ((e && e.message) || e)) +
                        '</div>';
                });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    function wireManualButtons() {
        function on(id, fn) {
            var el = $(id);
            if (el && !el.dataset.examWired) {
                el.dataset.examWired = '1';
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fn();
                });
            }
        }
        on('exam-btn-manual-teil1', () => {
            showTeil1Choice();
        });
        on('exam-btn-manual-teil3', () => {
            showTeil3Card();
        });
        on('exam-btn-manual-timer', () => {
            // Toggle: start current phase timer or stop it.
            if (currentPhase && phases[currentPhase] && phases[currentPhase].startAt)
                timerStop(currentPhase);
            else timerStart(currentPhase || 'teil1');
        });
        on('exam-btn-manual-eval', () => {
            requestEvaluation();
        });
        on('exam-card-close', () => {
            closeModal();
        });
        on('exam-card-toggle-size', () => {
            var sheet = $('exam-card-sheet');
            if (sheet) sheet.classList.toggle('exam-fullscreen');
        });
        on('exam-card-min', () => {
            closeModal();
        });
        var modal = $('exam-card-modal');
        if (modal && !modal.dataset.examWired) {
            modal.dataset.examWired = '1';
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        }
    }

    // Dispatch a single tool call from live_stream.js; always resolves, never throws.
    function dispatchTool(name, args) {
        try {
            args = args || {};
            if (name === 'exam_show_teil1_choice') return showTeil1Choice();
            if (name === 'exam_show_teil3_card') return showTeil3Card(args.situation_id);
            if (name === 'exam_timer_start') return timerStart(args.phase || 'teil1');
            if (name === 'exam_timer_stop') return timerStop(args.phase);
            if (name === 'exam_set_phase') return setPhase(args.phase || 'teil1');
            if (name === 'exam_hide_card') return hideCard();
            return { ok: false, error: 'unknown-tool' };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e) };
        }
    }

    window.ExamUI = {
        showTeil1Choice: showTeil1Choice,
        showTeil3Card: showTeil3Card,
        hideCard: hideCard,
        timerStart: timerStart,
        timerStop: timerStop,
        setPhase: setPhase,
        dispatchTool: dispatchTool,
        wireManualButtons: wireManualButtons,
        isOpen: isOpen,
        requestEvaluation: requestEvaluation,
        setExamEvaluation: (md) => {
            lastEvaluation = md;
        },
        getExamEvaluation: () => lastEvaluation,
        summary: () => {
            var out = {};
            Object.keys(phases).forEach((k) => {
                var p = phases[k];
                out[k] = p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0);
            });
            return out;
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireManualButtons);
    } else {
        wireManualButtons();
    }
})();


/* --- Start: tma_recorder.js --- */
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
    [screenRecorder, screenProcessing, screenResult].forEach((s) => s?.classList.remove('active'));
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
    if (
        activeStream &&
        activeStream.active &&
        activeStream.getAudioTracks().some((t) => t.readyState === 'live')
    ) {
        return activeStream;
    }

    activeStream = await requestMicStream('clean');
    return activeStream;
}

function releaseAudioStream() {
    if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
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
    4: '✅ Finalizing...',
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
    const stoppedPromise = new Promise((resolve) => {
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
        error: null,
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
            throw new Error('No internet connection (offline). Audio safely saved on device!');
        }

        const res = await fetch(`${API_BASE_URL}/api/tma/transcribe-async`, {
            method: 'POST',
            body: formData,
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
                throw new Error(
                    'Recording exceeds server upload limit (413). Audio safely saved locally!',
                );
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
            throw new Error('Invalid response from async transcribe API.');
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
                error: null,
            };
            trackedJobs.push(newJob);
        }

        renderJobQueue();
        startPollingTasks();
    } catch (err) {
        console.error('Async upload failed:', err);
        let userMsg = err.message || 'Upload failed';
        if (
            !navigator.onLine ||
            userMsg.includes('Failed to fetch') ||
            userMsg.includes('NetworkError')
        ) {
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
                error: userMsg,
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
        showQuotaExhaustedAlert('генерації Summary');
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
            body: JSON.stringify(payload),
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

        aiCardBody.innerText = data?.summary || 'No summary returned.';
        fetchUserQuota();
    } catch (err) {
        aiCardBody.innerText = err.message;
    }
}

async function sendCustomQuestion() {
    const q = inputCustomQuestion.value.trim();
    if (!q || !currentTranscript) return;

    if (aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false) {
        showQuotaExhaustedAlert('відповідей на питання');
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
            body: JSON.stringify(payload),
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

        aiCardBody.innerText = data?.answer || 'No answer returned.';
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
        showQuotaExhaustedAlert('запису та транскрибації');
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
        setTimeout(() => {
            btnCopy.innerText = 'Copy';
        }, 2000);
    }
});

btnSummary.addEventListener('click', requestSummary);

btnCustomQ.addEventListener('click', () => {
    if (aiQuotaState.remaining === 0 || aiQuotaState.isAllowed === false) {
        showQuotaExhaustedAlert('відповідей на питання');
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
        const msg =
            rem === null || rem === undefined
                ? '⚡ У вас необмежений доступ (Admin / Unlimited)!'
                : rem <= 0
                  ? '🔒 Денний ліміт вичерпано. Оновиться о 00:00 UTC або за ваучером /start rst_...'
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


/* --- Start: tma_jobs.js --- */
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
            uploaded: false,
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
                const items = (req.result || []).filter((r) => !r.uploaded);
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
        document
            .querySelectorAll('.btn-rescue-play')
            .forEach((btn) => (btn.innerHTML = '▶️ Listen'));
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
    audio.play().catch((e) => {
        console.warn('Play audio error:', e);
        if (playBtnEl) playBtnEl.innerHTML = '▶️ Listen';
    });
}

async function retryJobUpload(jobId) {
    const job = trackedJobs.find((j) => j.task_id === jobId);
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
        if (!trackedJobs.some((j) => j.task_id === rec.id)) {
            trackedJobs.push({
                task_id: rec.id,
                recordingName: rec.name || 'Saved Recording',
                audioBlob: rec.blob,
                status: 'failed',
                stage_label: 'Saved on device (not sent)',
                progress: 100,
                result: null,
                error: 'Pending upload from previous session',
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
            if (quotaBadge)
                quotaBadge.title = '🔒 Денний ліміт вичерпано (відновиться о 00:00 UTC)';
        } else {
            quotaText.innerText = `⚡ ${quota.remaining_today}`;
            quotaBadge?.classList.remove('locked');
            if (quotaBadge)
                quotaBadge.title = `Доступно кредитів: ${quota.remaining_today} (1 хв = 1 кредит)`;
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

// Optimistic quota restore from previous session
try {
    const cachedQuotaStr = localStorage.getItem('tma_ai_quota');
    if (cachedQuotaStr) {
        updateQuotaUI(JSON.parse(cachedQuotaStr));
    }
} catch (_) {}

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
                try {
                    localStorage.setItem('tma_ai_quota', JSON.stringify(data.ai_quota));
                } catch (_) {}
                updateQuotaUI(data.ai_quota);
            }
        }
    } catch (err) {
        console.warn('Could not fetch user quota:', err);
    }
}

function showQuotaExhaustedAlert(feature = 'ШІ та транскрибації') {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('warning');
    }
    const msg =
        `🔒 Денний ліміт ${feature} вичерпано.\n\n` +
        'Ліміт автоматично оновлюється щодня о 00:00 UTC ⏳\n\n' +
        '💡 Маєте ваучер поповнення? Активуйте його в чаті бота (/start rst_...) або зверніться до адміністратора.';
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
    trackedJobs = trackedJobs.filter((j) => j.task_id !== jobId);
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
    const activeCount = trackedJobs.filter(
        (j) => j.status !== 'completed' && j.status !== 'failed',
    ).length;
    jobsCountBadge.innerText =
        activeCount > 0 ? `${activeCount} processing` : `${trackedJobs.length} total`;

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

        const displayProgress =
            currentStageIdx < serverStageIdx
                ? STAGE_PROGRESS[currentStageIdx]
                : Math.min(job.progress || STAGE_PROGRESS[serverStageIdx], 100);
        const displayLabel =
            currentStageIdx < serverStageIdx
                ? currentStageIdx === 3 && job.status !== 'diarizing_llm'
                    ? '📤 Finalizing...'
                    : STAGE_LABELS[currentStageIdx]
                : job.stage_label || 'Processing...';

        const step3Label = job.status === 'diarizing_llm' ? '🧠 Diarize' : '📤 Sync';
        const stepsHtml = `
            <div class="pipeline-steps">
                <span class="pipeline-step ${currentStageIdx > 1 ? 'done' : currentStageIdx === 1 ? 'active' : ''}">📦 Prep</span>
                <span class="pipeline-step ${currentStageIdx > 2 ? 'done' : currentStageIdx === 2 ? 'active' : ''}">🎙️ Groq STT</span>
                <span class="pipeline-step ${currentStageIdx > 3 ? 'done' : currentStageIdx === 3 ? 'active' : ''}">${step3Label}</span>
                <span class="pipeline-step ${currentStageIdx >= 4 ? (isFailed ? 'failed' : 'done') : ''}">✅ Done</span>
            </div>
        `;

        const rescueHtml = isFailed
            ? `
            <div class="job-rescue-actions">
                ${
                    job.audioBlob
                        ? `
                    <button class="btn-rescue btn-rescue-save" title="Save file to device">
                        📥 Save Audio
                    </button>
                    <button class="btn-rescue btn-rescue-play" title="Listen to recording">
                        ▶️ Listen
                    </button>
                `
                        : ''
                }
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
        `
            : '';

        const completedHtml = visuallyComplete
            ? `
            <div class="job-view-btn">📄 Open Transcript →</div>
            <div class="job-mini-confirm hidden">
                <span class="job-mini-confirm-msg">Remove from list?</span>
                <div class="job-mini-confirm-actions">
                    <button class="btn-mini-confirm-yes">✓ Yes</button>
                    <button class="btn-mini-confirm-no">Cancel</button>
                </div>
            </div>
        `
            : '';

        card.innerHTML = `
            <div class="job-top-row">
                <span class="job-title">🎙️ ${job.recordingName || 'Audio Recording'}</span>
                <div class="job-top-right">
                    <span class="job-status-pill">${visuallyComplete ? '✓ Ready' : isFailed ? '✕ Error' : isUploading ? '🚀 Uploading' : displayProgress + '%'}</span>
                    ${visuallyComplete || isFailed ? '<button class="job-card-close-btn" title="Close">✕</button>' : ''}
                </div>
            </div>
            <div class="job-stage-desc">${displayLabel}</div>
            ${
                !visuallyComplete && !isFailed
                    ? `
                <div class="job-progress-bg">
                    <div class="job-progress-fill" style="width: ${displayProgress}%"></div>
                </div>
            `
                    : ''
            }
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
                    const ext =
                        job.audioBlob.type && job.audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
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
    const activeJobs = trackedJobs.filter((j) => j.status !== 'completed' && j.status !== 'failed');
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


/* --- Start: tma_dialog.js --- */
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

        // Optimistic UI restoration: show tabs immediately if previously verified as admin
        this.isAdmin = localStorage.getItem('tma_is_admin') === 'true';
        if (this.isAdmin && this.tabsContainer) {
            this.tabsContainer.classList.remove('hidden');
        }

        this.init();
    }

    async init() {
        this.bindEvents();
        const requestedMode = typeof getUrlParam === 'function' ? getUrlParam('mode') : null;
        if (
            this.isAdmin &&
            requestedMode &&
            (requestedMode === 'live' || requestedMode === 'dialog')
        ) {
            this.switchAppMode(requestedMode);
        }
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
                    navigator.clipboard
                        .writeText(text)
                        .then(() => {
                            showToast('📋 Summary скопійовано', '✅');
                        })
                        .catch(() => {
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
                `${API_BASE_URL}/api/tma/dialog/state?init_data=${encodeURIComponent(initData)}&user_id=${encodeURIComponent(userId)}`,
            );
            if (!res.ok) return;
            const data = await res.json();
            if (!data.is_admin) {
                this.isAdmin = false;
                try {
                    localStorage.removeItem('tma_is_admin');
                } catch (_) {}
                if (this.tabsContainer) {
                    this.tabsContainer.classList.add('hidden');
                }
                this.switchAppMode('recorder');
                return;
            }

            this.isAdmin = true;
            try {
                localStorage.setItem('tma_is_admin', 'true');
            } catch (_) {}
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
        const isAudioRecording =
            typeof mediaRecorder !== 'undefined' &&
            mediaRecorder &&
            mediaRecorder.state === 'recording';
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
        if (
            triggerBtn &&
            this.currentPlayingBtn === triggerBtn &&
            this.currentAudio &&
            !this.currentAudio.paused
        ) {
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
        if (
            this.stream &&
            this.stream.active &&
            this.stream.getAudioTracks().some((t) => t.readyState === 'live')
        ) {
            return this.stream;
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                channelCount: { ideal: 1 },
                sampleRate: { ideal: 48000, min: 16000 },
            },
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
            const mimeCandidates = [
                'audio/webm;codecs=opus',
                'audio/ogg;codecs=opus',
                'audio/mp4',
                'audio/webm',
                '',
            ];
            const supportedMime =
                mimeCandidates.find(
                    (m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)),
                ) || '';
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
        const asstBubble = this.appendMessageBubble(
            'assistant',
            data.reply_text,
            data.audio_base64,
            data.latency_ms,
        );

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
        const hasContent = this.session?.messages?.length > 0 || Boolean(this.session?.summary);
        if (!hasContent) {
            showToast('Чат порожній, немає що експортувати', 'ℹ️');
            return;
        }

        const elapsedMs = Date.now() - (this.lastExportAt || 0);
        if (this.lastExportAt && elapsedMs < 3 * 60 * 1000) {
            const minsAgo = Math.max(1, Math.round(elapsedMs / 60000));
            const ok = confirm(
                `Стенограму цієї бесіди вже було надіслано менше ${minsAgo} хв тому. Надіслати ще раз?`,
            );
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
            const totTok = typeof tokens.total === 'number' ? tokens.total : freshTok + sumTok;

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
        const hasContent = this.session?.messages?.length > 0 || Boolean(this.session?.summary);
        if (this.btnDialogExport) {
            this.btnDialogExport.disabled = !hasContent;
            this.btnDialogExport.classList.toggle('disabled', !hasContent);
        }
    }
}
const dialogManager = new DialogModeManager();


/* --- Start: live_session.js --- */
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
        this.vadMode = localStorage.getItem('tma_live_vad') || 'auto';
        this.manualActivityActive = false;
        this.audioProfile = localStorage.getItem('tma_live_audio_profile') || 'headphones';
        this.micGainLevel = parseFloat(localStorage.getItem('tma_live_mic_gain') || '1.8');
        this.echoThreshold = parseFloat(localStorage.getItem('tma_live_echo_threshold') || '0.14');
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
        this.selectVadMode = document.getElementById('select-live-vad-mode');
        this.btnActivityEnd = document.getElementById('btn-live-activity-end');
        this.selectAudioProfile = document.getElementById('select-live-audio-profile');
        this.selectMicGain = document.getElementById('select-live-mic-gain');
        this.deviceStatus = document.getElementById('live-device-status');
        this.deviceLabel = document.getElementById('live-device-label');
        this.selectEchoThreshold = document.getElementById('select-live-echo-threshold');
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
        this.resumeClickable = document.getElementById('live-resume-clickable');
        this.resumeTitle = document.getElementById('live-resume-title');
        this.resumeDetail = document.getElementById('live-resume-detail');
        this.btnResumeDismiss = document.getElementById('btn-live-resume-dismiss');
        this.btnIdleExport = document.getElementById('btn-live-idle-export');
        this.resumeModal = document.getElementById('live-resume-modal');
        this.resumeModalClose = document.getElementById('btn-close-live-resume-modal');
        this.resumeModalOk = document.getElementById('btn-live-resume-modal-close');
        this.resumeModalReset = document.getElementById('btn-live-resume-modal-reset');
        this.resumeModalBadge = document.getElementById('live-resume-modal-badge');
        this.resumeModalTime = document.getElementById('live-resume-modal-time');
        this.resumeModalSummaryBox = document.getElementById('live-resume-summary-box');
        this.resumeModalSummaryText = document.getElementById('live-resume-summary-text');
        this.resumeModalTurnsList = document.getElementById('live-resume-turns-list');
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

        if (this.selectVadMode) {
            this.selectVadMode.value = this.vadMode;
            this.selectVadMode.addEventListener('change', (e) => {
                this.vadMode = e.target.value;
                localStorage.setItem('tma_live_vad', this.vadMode);
                this.updateActivityEndButtonVisibility();
                window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
                if (this.isConnected && typeof showToast === 'function') {
                    showToast('Режим пауз зміниться з наступного дзвінка', 'ℹ️');
                }
            });
        }

        if (this.btnActivityEnd) {
            this.btnActivityEnd.addEventListener('click', () => this.sendActivityEnd());
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
            this.selectMicGain.value = ['1.0', '1.8', '2.8'].includes(formattedGain)
                ? formattedGain
                : '1.8';
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
                    if (typeof showToast === 'function')
                        showToast('Стенограма поки що порожня', 'ℹ️');
                    return;
                }
                const fullText = this.transcriptHistory
                    .map((t) => `${t.speaker === 'user' ? 'Ви' : 'Gemini'}: ${t.text}`)
                    .join('\n\n');
                navigator.clipboard
                    .writeText(fullText)
                    .then(() => {
                        if (typeof showToast === 'function')
                            showToast('📋 Стенограму скопійовано!', '✅');
                        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
                    })
                    .catch(() => {
                        if (typeof showToast === 'function')
                            showToast('Не вдалося скопіювати', '❌');
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

        if (this.selectEchoThreshold) {
            this.selectEchoThreshold.value = this.echoThreshold.toString();
            this.selectEchoThreshold.addEventListener('change', (e) => {
                this.echoThreshold = parseFloat(e.target.value);
                localStorage.setItem('tma_live_echo_threshold', this.echoThreshold.toString());
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
                    showToast(
                        this.isSearchGroundingEnabled
                            ? '🔍 Google Search увімкнено'
                            : '🔍 Google Search вимкнено',
                        'ℹ️',
                    );
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

        if (this.resumeClickable) {
            this.resumeClickable.addEventListener('click', () => this.openResumeModal());
        }

        if (this.resumeModalClose) {
            this.resumeModalClose.addEventListener('click', () => this.closeResumeModal());
        }

        if (this.resumeModalOk) {
            this.resumeModalOk.addEventListener('click', () => this.closeResumeModal());
        }

        if (this.resumeModal) {
            this.resumeModal.addEventListener('click', (e) => {
                if (e.target === this.resumeModal) this.closeResumeModal();
            });
        }

        if (this.resumeModalReset) {
            this.resumeModalReset.addEventListener('click', () => {
                this.dismissResumeContext();
                this.closeResumeModal();
            });
        }

        if (this.btnResumeDismiss) {
            this.btnResumeDismiss.addEventListener('click', (e) => {
                e.stopPropagation();
                this.dismissResumeContext();
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

    dismissResumeContext() {
        this.resumeContext = null;
        this.resumeBanner?.classList.add('hidden');
        if (typeof showToast === 'function') showToast('Контекст продовження скинуто', 'ℹ️');
    }

    openResumeModal() {
        if (!this.resumeContext) {
            if (typeof showToast === 'function') showToast('Контекст ще завантажується...', '⏳');
            return;
        }
        const data = this.resumeContext;
        if (this.resumeModalBadge) {
            this.resumeModalBadge.textContent = `${data.turns_count || 0} реплік, ~${data.words_count || 0} слів`;
        }
        if (this.resumeModalTime) {
            const timeStr = data.created_at
                ? new Date(data.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                  })
                : '';
            this.resumeModalTime.textContent = timeStr ? `Сесія від ${timeStr}` : '';
        }

        // Summary handling
        let summaryText = data.summary || '';
        if (!summaryText && data.context_summary) {
            const match = /\[Зміст попередньої частини бесіди\]:\s*([\s\S]+?)(?=\n\n\[|$)/i.exec(
                data.context_summary,
            );
            if (match) summaryText = match[1].trim();
        }
        if (summaryText && this.resumeModalSummaryBox && this.resumeModalSummaryText) {
            this.resumeModalSummaryText.textContent = summaryText;
            this.resumeModalSummaryBox.classList.remove('hidden');
        } else if (this.resumeModalSummaryBox) {
            this.resumeModalSummaryBox.classList.add('hidden');
        }

        // Turns handling
        if (this.resumeModalTurnsList) {
            this.resumeModalTurnsList.innerHTML = '';
            let turns = Array.isArray(data.turns) ? data.turns : [];
            if (!turns.length && data.context_summary) {
                // Parse legacy lines from context_summary
                const verbatimMatch = /\[Останні репліки\]:\s*([\s\S]+)/i.exec(
                    data.context_summary,
                );
                const raw = verbatimMatch ? verbatimMatch[1] : data.context_summary;
                const lines = raw.split('\n').filter((l) => l.trim());
                turns = lines.map((l) => {
                    const colonIdx = l.indexOf(':');
                    if (colonIdx > 0) {
                        return {
                            speaker: l.substring(0, colonIdx).trim().toLowerCase(),
                            text: l.substring(colonIdx + 1).trim(),
                        };
                    }
                    return { speaker: 'user', text: l };
                });
            }

            if (turns.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'live-resume-turn';
                emptyEl.textContent = 'Немає збережених реплік у цій сесії.';
                this.resumeModalTurnsList.appendChild(emptyEl);
            } else {
                turns.forEach((t) => {
                    const turnEl = document.createElement('div');
                    const isUser =
                        (t.speaker || '').toLowerCase().includes('user') ||
                        (t.speaker || '').toLowerCase() === 'ви';
                    turnEl.className = `live-resume-turn ${isUser ? 'user' : 'model'}`;
                    const speakerLabel = isUser ? '🧑 Ви' : '🤖 Gemini';
                    const timeBadge = t.timestamp
                        ? `<span class="live-resume-turn-time">${escapeHtml(t.timestamp)}</span>`
                        : '';
                    turnEl.innerHTML = `
                        <strong class="live-resume-turn-speaker">${speakerLabel}${timeBadge}</strong>
                        <div>${escapeHtml(t.text)}</div>
                    `;
                    this.resumeModalTurnsList.appendChild(turnEl);
                });
            }
        }

        window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
        this.resumeModal?.classList.remove('hidden');
    }

    closeResumeModal() {
        this.resumeModal?.classList.add('hidden');
    }

    async loadResumeContext(resumeId) {
        try {
            const base = this.getApiBaseUrl();
            const res = await fetch(
                `${base}/api/tma/live/resume-context?resume_id=${encodeURIComponent(resumeId)}`,
            );
            if (!res.ok) return;
            const data = await res.json();
            this.resumeContext = data;
            if (this.resumeBanner) {
                this.resumeBanner.classList.remove('hidden');
                if (this.resumeTitle) this.resumeTitle.textContent = '🔄 Продовження бесіди';
                if (this.resumeDetail)
                    this.resumeDetail.textContent = `${data.turns_count || 0} реплік, ~${data.words_count || 0} слів з минулої сесії`;
            }
            if (typeof showToast === 'function') {
                showToast(`Контекст сесії відновлено (${data.turns_count || 0} реплік)`, '🔄');
            }
        } catch (e) {
            console.warn('[GeminiLive] Failed to load resume context:', e);
        }
    }

    updateSearchToggleUI() {
        if (!this.btnSearchToggle) return;
        if (this.isSearchGroundingEnabled) {
            this.btnSearchToggle.classList.add('active');
            this.btnSearchToggle.textContent = '🔍 Увімк';
            this.btnSearchToggle.title =
                'Google Search Grounding активний: модель шукає свіжі дані в Google.';
        } else {
            this.btnSearchToggle.classList.remove('active');
            this.btnSearchToggle.textContent = '🔍 Вимк';
            this.btnSearchToggle.title =
                'Google Search Grounding вимкнений: максимальна швидкість без додаткових запитів.';
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
                this.sessionDesc.textContent =
                    'Тестовий режим активний: мікрофон захоплюється локально без викликів Google API.';
            } else {
                this.btnMockToggle.classList.remove('active');
                this.btnMockToggle.textContent = '🧪 Mock: OFF';
                this.sessionDesc.textContent =
                    'Повний дуплекс через WebSocket. Говори вільно, перебивай у будь-який момент.';
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

            if (this.speakerLabel) this.speakerLabel.textContent = "З'єднання з Gemini...";
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
            this.updateActivityEndButtonVisibility();

            // In manual VAD mode, send initial activityStart so user can begin speaking
            if (this.vadMode === 'manual') {
                this.manualActivityActive = false;
                this.sendActivityStart();
            }
            this.updateExportButtonState();

            if (tg?.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        } catch (err) {
            console.error('[GeminiLive] Failed to start session:', err);
            this.resetConnectingButtonUI();
            this.disconnect(true, true);
            this.setStatus('error', "⚠️ Помилка з'єднання");
            if (this.speakerLabel) this.speakerLabel.textContent = 'Помилка';
            if (this.transcriptFeed) {
                const isQuotaError =
                    err.message && (err.message.includes('quota') || err.message.includes('1011'));
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
            {
                name: 'exam_show_teil1_choice',
                description:
                    'Zeige dem Kandidaten 2 zufällige Teil-1-Themen als Karte. Einmal zu Beginn von Teil 1 aufrufen, still (nichts über Tools sagen).',
                parameters: { type: 'OBJECT', properties: {} },
            },
            {
                name: 'exam_show_teil3_card',
                description:
                    'Zeige die Teil-3-Situationskarte (Situation + Stichpunkte). Zu Beginn von Teil 3 aufrufen, still.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        situation_id: {
                            type: 'STRING',
                            description: 'Optionale Situations-ID, sonst zufällig.',
                        },
                    },
                },
            },
            {
                name: 'exam_timer_start',
                description:
                    'Starte den Phasen-Timer SOFORT nach der Aufgabenstellung. NIEMALS ankündigen (kein "Ich starte den Timer").',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        phase: {
                            type: 'STRING',
                            enum: ['teil1', 'teil1_monolog', 'teil3', 'teil3_diskussion'],
                        },
                        label: { type: 'STRING' },
                    },
                    required: ['phase'],
                },
            },
            {
                name: 'exam_timer_stop',
                description: 'Stoppe den Phasen-Timer am Ende der Phase.',
                parameters: { type: 'OBJECT', properties: { phase: { type: 'STRING' } } },
            },
            {
                name: 'exam_set_phase',
                description: 'Aktualisiere die Phasenanzeige in der UI.',
                parameters: {
                    type: 'OBJECT',
                    properties: { phase: { type: 'STRING', enum: ['teil1', 'teil3'] } },
                },
            },
            {
                name: 'exam_hide_card',
                description: 'Verstecke die Aufgabenkarte.',
                parameters: { type: 'OBJECT', properties: {} },
            },
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
        } catch (e) {
            /* never break Live */
        }
    }

    handleExamToolCall(toolCallMsg) {
        var fns = toolCallMsg.functionCalls || toolCallMsg.function_calls || [];
        var responses = [];
        for (var i = 0; i < fns.length; i++) {
            ((fc) => {
                var result = { ok: true, fallback: 'voice' };
                try {
                    if (window.ExamUI && typeof window.ExamUI.dispatchTool === 'function') {
                        var r = window.ExamUI.dispatchTool(fc.name, fc.args || fc.arguments || {});
                        if (r) result = r;
                    } else {
                        result = { ok: false, error: 'exam-ui-missing', fallback: 'voice' };
                    }
                } catch (e) {
                    result = { ok: false, error: String((e && e.message) || e), fallback: 'voice' };
                }
                // Always respond ok-ish so the synchronous Live turn never stalls.
                responses.push({
                    id: fc.id,
                    name: fc.name,
                    response: { result: 'ok', detail: result },
                });
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
                    reject(
                        new Error(
                            'Час очікування підтвердження сесії від Google Live API вичерпано (Timeout 10s).',
                        ),
                    );
                }
            }, 10000);

            this.ws.onopen = () => {
                console.log(
                    `[GeminiLive] WebSocket connected. Model: ${this.model}, Voice: ${this.voice}, Pace: ${this.pace}. Sending setup...`,
                );
                const isExtended = this.model.includes('extended-thinking');
                const modelIdentifier = isExtended
                    ? 'models/gemini-3.8-live-extended-thinking'
                    : this.model.startsWith('models/')
                      ? this.model
                      : `models/${this.model}`;
                const paceInstruction = this.getPaceInstruction();
                const basePrompt = window.personaEngine
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

                // VAD mode configuration
                if (this.vadMode === 'relaxed') {
                    setupPayload.realtimeInputConfig = {
                        automaticActivityDetection: {
                            disabled: false,
                            endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                            silenceDurationMs: 2000,
                        },
                    };
                } else if (this.vadMode === 'manual') {
                    setupPayload.realtimeInputConfig = {
                        automaticActivityDetection: {
                            disabled: true,
                        },
                    };
                }

                if (this.isSearchGroundingEnabled) {
                    setupPayload.tools = [{ googleSearch: {} }];
                }

                // Exam tools are additive and guarded: any failure falls back to voice-only.
                var examToolsWanted = false;
                try {
                    if (this.isExamMode()) {
                        examToolsWanted = true;
                        var examDecls = this.getExamFunctionDeclarations();
                        setupPayload.tools = (setupPayload.tools || []).concat([
                            { functionDeclarations: examDecls },
                        ]);
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
                        console.warn(
                            '[GeminiLive] exam toolCall handling failed, continuing voice:',
                            e,
                        );
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
                    reject(
                        new Error(
                            "Помилка WebSocket з'єднання з серверами Google. Перевірте інтернет та налаштування доступу.",
                        ),
                    );
                }
            };

            this.ws.onclose = (ev) => {
                console.log('[GeminiLive] WebSocket closed:', ev.code, ev.reason);
                clearTimeout(setupTimeout);
                const reasonText = ev.reason ? `: ${ev.reason}` : '';
                if (!isSetupDone) {
                    // One graceful retry without exam tools if setup with tools was rejected.
                    if (
                        this._examToolsWanted &&
                        !this._examToolsRetried &&
                        (ev.code === 1002 || ev.code === 1011 || ev.code === 1012)
                    ) {
                        this._examToolsRetried = true;
                        this._examToolsWanted = false;
                        console.warn(
                            '[GeminiLive] Retrying Live setup without exam tools (voice-only fallback).',
                        );
                        if (typeof showToast === 'function')
                            showToast('Картки іспиту вимкнено, продовжую голосом', 'ℹ️');
                        isSetupDone = true;
                        clearTimeout(setupTimeout);
                        // Re-enter setup without tools by reconnecting once.
                        this.ws = null;
                        this.connectWebSocket().then(resolve).catch(reject);
                        return;
                    }
                    isSetupDone = true;
                    let errorMsg = `Google Live API розірвав зв'язок при старті (код ${ev.code}${reasonText}).`;
                    if (
                        this.isSearchGroundingEnabled &&
                        (ev.code === 1011 || reasonText.includes('quota'))
                    ) {
                        errorMsg +=
                            ' 💡 Підказка: Вимкніть "🔍 Google Пошук" у налаштуваннях Live (інструмент Search у Live API вимагає окремого платного тарифу).';
                    } else {
                        errorMsg += ` Перевірте модель (${this.model}) або ліміти API.`;
                    }
                    reject(new Error(errorMsg));
                } else if (this.isConnected) {
                    this.disconnect(true);
                    this.setStatus('error', `Код ${ev.code}`);
                    this.sessionTitle.textContent = "З'єднання перервано";
                    this.sessionDesc.textContent = `Google Live API закрив сесію (код ${ev.code}${reasonText}).`;
                    if (this.speakerLabel) this.speakerLabel.textContent = 'Система:';
                    this.recordTranscriptTurn(
                        'gemini',
                        `[Сесію закрито сервером Google: код ${ev.code}${reasonText}]`,
                    );
                }
            };
        });
    }

    handleServerMessage(msg) {
        // Track token usage and cost accounting
        if (msg.usageMetadata || msg.usage_metadata) {
            const u = msg.usageMetadata || msg.usage_metadata;
            this.sessionTokenStats.prompt_tokens =
                u.promptTokenCount || u.prompt_token_count || this.sessionTokenStats.prompt_tokens;
            this.sessionTokenStats.response_tokens =
                u.responseTokenCount ||
                u.response_token_count ||
                this.sessionTokenStats.response_tokens;
            this.sessionTokenStats.thoughts_tokens =
                u.thoughtsTokenCount ||
                u.thoughts_token_count ||
                this.sessionTokenStats.thoughts_tokens;
            this.sessionTokenStats.total_tokens =
                u.totalTokenCount ||
                u.total_token_count ||
                this.sessionTokenStats.prompt_tokens + this.sessionTokenStats.response_tokens;

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
            // In manual VAD mode, auto-start next user activity after model finishes
            if (this.vadMode === 'manual' && this.isConnected) {
                this.sendActivityStart();
                if (this.speakerLabel) this.speakerLabel.textContent = 'Слухаю вас...';
            }
        }
    }

    updateActivityEndButtonVisibility() {
        if (!this.btnActivityEnd) return;
        if (this.vadMode === 'manual' && this.isConnected) {
            this.btnActivityEnd.classList.remove('hidden');
        } else {
            this.btnActivityEnd.classList.add('hidden');
        }
    }

    sendActivityStart() {
        if (this.vadMode !== 'manual' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (this.manualActivityActive) return;
        this.manualActivityActive = true;
        this.ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        console.log('[GeminiLive] Manual VAD: activityStart sent');
    }

    sendActivityEnd() {
        if (this.vadMode !== 'manual' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (!this.manualActivityActive) return;
        this.manualActivityActive = false;
        this.ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        console.log('[GeminiLive] Manual VAD: activityEnd sent');
        if (this.speakerLabel) this.speakerLabel.textContent = 'Gemini думає...';
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
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
        const durSec = this.sessionStartTime
            ? Math.round((Date.now() - this.sessionStartTime) / 1000)
            : 0;
        const mins = Math.floor(durSec / 60);
        const secs = durSec % 60;
        const durStr = `${mins}:${secs.toString().padStart(2, '0')}`;

        if (this.statDuration) this.statDuration.textContent = durStr;
        if (this.statTokensIn)
            this.statTokensIn.textContent = this.sessionTokenStats.prompt_tokens.toLocaleString();
        if (this.statTokensOut)
            this.statTokensOut.textContent =
                this.sessionTokenStats.response_tokens.toLocaleString();
        if (this.statCost)
            this.statCost.textContent = `~$${this.sessionTokenStats.cost_usd.toFixed(4)}`;
        this.usageStatsCard.classList.remove('hidden');
    }

    finalizeSessionStats() {
        const durSec = this.sessionStartTime
            ? Math.round((Date.now() - this.sessionStartTime) / 1000)
            : 0;
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
        this.btnActivityEnd?.classList.add('hidden');
        this.manualActivityActive = false;
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

        if (typeof releaseWakeLock === 'function' && !window.isRecording) {
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
                    textEl.textContent +=
                        (textEl.textContent.endsWith(' ') || trimmed.startsWith(' ') ? '' : ' ') +
                        trimmed;
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
            const ok = confirm(
                `Стенограму Live вже було надіслано менше ${minsAgo} хв тому. Надіслати ще раз?`,
            );
            if (!ok) return;
        }

        const { initData, userId } = this.getAuthParams();
        if (typeof showToast === 'function') {
            showToast('📤 Відправляємо стенограму Live в чат...', '⏳');
        }
        const durationSec = this.sessionStartTime
            ? Math.round((Date.now() - this.sessionStartTime) / 1000)
            : 0;
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
                    evaluation:
                        window.ExamUI && typeof window.ExamUI.getExamEvaluation === 'function'
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
            const isOgg = this.debugAudioBlob.type && this.debugAudioBlob.type.includes('ogg');
            const ext = isOgg ? 'ogg' : 'webm';
            formData.append('audio_file', this.debugAudioBlob, `live_debug.${ext}`);
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


/* --- Start: live_audio.js --- */
/**
 * Gemini Live audio pipeline mixin (split from live_stream.js, verbatim).
 * Assigned onto GeminiLiveStreamManager.prototype — must load AFTER live_session.js.
 * Covers: mic stream, AudioContext graph, playback queue, VU meters,
 * PCM conversion, mock TTS, stereo debug recorder.
 */
Object.assign(GeminiLiveStreamManager.prototype, {
    async getLiveAudioStream() {
        const isHeadphones = this.audioProfile === 'headphones';

        // Tiers live in tma_common.js; device inspection stays here (needs UI).
        let stream = null;
        try {
            stream = await requestMicStream(isHeadphones ? 'headphones' : 'speaker');
        } catch (err) {
            throw new Error('Не вдалося отримати доступ до мікрофона на цьому пристрої.');
        }

        // Inspect hardware microphone track and display in UI
        try {
            const track = stream.getAudioTracks()[0];
            const settings = track.getSettings ? track.getSettings() : {};
            const label = track.label || 'Вбудований мікрофон';
            const sr = settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)}kHz` : '';
            const profileText = isHeadphones ? '🎧 Clean' : '🔊 AEC';
            const gainText = `+${Math.round((this.micGainLevel - 1) * 6)}dB`;
            this.activeDeviceSummary = `${label} (${sr || '48k'}, ${profileText}, Gain ${this.micGainLevel}x ${gainText})`;
            if (this.deviceLabel) this.deviceLabel.textContent = this.activeDeviceSummary;
        } catch (e) {
            console.log('[GeminiLive] Device inspection skipped:', e);
        }

        return stream;
    },
    ensureAudioContextUnlocked() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new AudioContextClass();
                this.audioContextIn = this.audioContext;
                this.audioContextOut = this.audioContext;
            }
            if (this.audioContext.state === 'suspended') {
                this.audioContext
                    .resume()
                    .catch((e) =>
                        console.warn('[GeminiLive] AudioContext resume on gesture error:', e),
                    );
            }
        } catch (e) {
            console.warn('[GeminiLive] Failed to unlock AudioContext on gesture:', e);
        }
    },
    async initAudio(isMock = false) {
        this.ensureAudioContextUnlocked();
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        this.nextPlayTime = this.audioContext.currentTime;

        // Model Output Gain Node (prevents clipping/screeching from hot model output)
        this.modelGainNode = this.audioContext.createGain();
        this.modelGainNode.gain.value = 0.8;

        // Model Output Analyser for VU Meter
        try {
            this.modelAnalyser = this.audioContext.createAnalyser();
            this.modelAnalyser.fftSize = 64;
            this.modelAnalyser.connect(this.modelGainNode);
            this.modelGainNode.connect(this.audioContext.destination);
        } catch (e) {
            console.warn('[GeminiLive] Model analyser init error:', e);
            // Fallback: connect gain directly to destination
            this.modelGainNode.connect(this.audioContext.destination);
        }

        // Request microphone stream using progressive hardware fallback
        const isStreamValid =
            this.mediaStream &&
            this.mediaStream.active &&
            this.mediaStream.getAudioTracks().some((t) => t.readyState === 'live');
        if (!isStreamValid) {
            this.mediaStream = await this.getLiveAudioStream();
        }

        // Enable audio tracks
        this.mediaStream.getAudioTracks().forEach((t) => {
            t.enabled = true;
        });

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);

        // 1. Microphone Gain Booster Node (Software amplifier for quiet voices/whispers)
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.micGainLevel;

        // 2. Broadcast Dynamics Compressor Node (raises quiet syllables, prevents clipping)
        this.compressorNode = this.audioContext.createDynamicsCompressor();
        this.compressorNode.threshold.value = -36;
        this.compressorNode.knee.value = 12;
        this.compressorNode.ratio.value = 4;
        this.compressorNode.attack.value = 0.003;
        this.compressorNode.release.value = 0.25;

        // 3. Microphone Analyser for Real-time VU Meter
        this.micAnalyser = this.audioContext.createAnalyser();
        this.micAnalyser.fftSize = 64;

        // Wire: Source -> Gain -> DynamicsCompressor -> Mic Analyser
        source.connect(this.gainNode);
        this.gainNode.connect(this.compressorNode);
        this.compressorNode.connect(this.micAnalyser);

        // 4. Stereo Debug Recording: ChannelMergerNode (Channel 0: User Mic, Channel 1: Gemini Voice)
        try {
            this.debugAudioMerger = this.audioContext.createChannelMerger(2);
            this.compressorNode.connect(this.debugAudioMerger, 0, 0); // Left channel: User

            this.debugDestNode = this.audioContext.createMediaStreamDestination();
            this.debugAudioMerger.connect(this.debugDestNode);

            // Configure MediaRecorder for stereo debug stream
            // OGG Opus preferred: Telegram displays waveform for voice messages
            const supportedMime = pickSupportedMime([
                'audio/ogg;codecs=opus',
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                '',
            ]);
            const recorderOpts = supportedMime
                ? { mimeType: supportedMime, audioBitsPerSecond: 48000 }
                : {};

            this.debugAudioChunks = [];
            this.debugAudioBlob = null;
            this.debugMediaRecorder = new MediaRecorder(this.debugDestNode.stream, recorderOpts);
            this.debugMediaRecorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) {
                    this.debugAudioChunks.push(ev.data);
                }
            };
            this.debugMediaRecorder.onstop = () => {
                if (this.debugAudioChunks.length > 0) {
                    this.debugAudioBlob = new Blob(this.debugAudioChunks, {
                        type: supportedMime || 'audio/webm',
                    });
                    console.log(
                        `[GeminiLive] Stereo debug recording ready: ${(this.debugAudioBlob.size / 1024).toFixed(1)} KB`,
                    );
                }
            };
            this.debugMediaRecorder.start(1000);
        } catch (e) {
            console.warn('[GeminiLive] Stereo debug recorder init failed:', e);
        }

        // Start VU Meter Loop
        this.startVuMeterLoop();

        // 5. ScriptProcessor for streaming raw PCM to Gemini Live API
        const bufferSize = 4096;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        const inputSampleRate = this.audioContext.sampleRate;

        this.scriptProcessor.onaudioprocess = (e) => {
            if (!this.isConnected || this.isMuted) return;

            const inputData = e.inputBuffer.getChannelData(0);

            // Compute volume level for orb responsiveness
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) {
                sum += Math.abs(inputData[i]);
            }
            const avgVolume = sum / inputData.length;

            const now = Date.now();
            const isModelCurrentlySpeaking =
                this.isModelSpeaking || now - this.lastModelAudioTime < 250;

            // Acoustic Echo Guard: when assistant is speaking through speakers, raise voice threshold to prevent false self-interruption (barge-in)
            let voiceThreshold = 0.015; // Gentle sensitivity for quiet speech
            if (this.echoThreshold > 0 && isModelCurrentlySpeaking) {
                // Ignore lower volumes (speaker loopback) when assistant is speaking
                voiceThreshold = this.echoThreshold;
            }

            if (avgVolume > voiceThreshold) {
                // User is speaking
                this.lastUserVoiceTime = now;
                if (this.mockIsSpeaking) {
                    // Barge-in in Mock Mode!
                    console.log('[MockMode] User interrupted mock assistant!');
                    this.stopMockSpeech();
                }

                if (isMock) {
                    if (this.speakerLabel) this.speakerLabel.textContent = 'Ви:';
                    clearTimeout(this.mockSilenceTimer);
                    this.mockSilenceTimer = setTimeout(() => this.triggerMockResponse(), 1400);
                }
            }

            if (!isMock && this.ws && this.ws.readyState === WebSocket.OPEN) {
                // If assistant is speaking and echo guard is active, don't stream quiet speaker feedback
                if (
                    this.echoThreshold > 0 &&
                    isModelCurrentlySpeaking &&
                    avgVolume < voiceThreshold
                ) {
                    return;
                }

                const downsampled = this.downsampleTo16k(inputData, inputSampleRate);
                const pcm16 = this.floatTo16BitPCM(downsampled);
                const base64Audio = this.arrayBufferToBase64(pcm16);

                // Gemini Live API payload format: 'audio' key with MIME type and base64 data
                const payload = {
                    realtimeInput: {
                        audio: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: base64Audio,
                        },
                        mediaChunks: [
                            {
                                mimeType: 'audio/pcm;rate=16000',
                                data: base64Audio,
                            },
                        ],
                    },
                };
                this.ws.send(JSON.stringify(payload));
            }
        };

        // Mute node to prevent any audio feedback/echo to the user's speakers
        const zeroGainNode = this.audioContext.createGain();
        zeroGainNode.gain.value = 0;

        this.compressorNode.connect(this.scriptProcessor);
        this.scriptProcessor.connect(zeroGainNode);
        zeroGainNode.connect(this.audioContext.destination);
    },

    // Mock response simulation
    triggerMockResponse() {
        if (!this.isConnected || !this.isMockMode) return;
        this.mockIsSpeaking = true;
        this.setOrbSpeaking(true);

        const mockReplies = [
            'Привіт! Я чудово чую твій голос. Це тестова емуляція дуплексної рації Gemini Live!',
            'Все працює як годинник! Ти можеш почати говорити просто зараз, щоб перевірити як працює перебивання.',
            'Аудіосистема та Web Audio API готові до підключення справжнього Gemini API ключа.',
        ];
        const randomReply = mockReplies[Math.floor(Math.random() * mockReplies.length)];

        if (this.speakerLabel) this.speakerLabel.textContent = 'Mock Assistant:';
        this.recordTranscriptTurn('gemini', randomReply);

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(randomReply);
            utterance.lang = 'uk-UA';
            utterance.rate = 1.05;
            utterance.onend = () => {
                this.mockIsSpeaking = false;
                this.setOrbSpeaking(false);
            };
            utterance.onerror = () => {
                this.mockIsSpeaking = false;
                this.setOrbSpeaking(false);
            };
            window.speechSynthesis.speak(utterance);
        } else {
            setTimeout(() => {
                this.mockIsSpeaking = false;
                this.setOrbSpeaking(false);
            }, 3000);
        }
    },
    stopMockSpeech() {
        this.mockIsSpeaking = false;
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        this.setOrbSpeaking(false);
    },
    queuePcmAudioChunk(base64Data) {
        if (!this.audioContext) return;

        if (this.audioContext.state === 'suspended') {
            this.audioContext
                .resume()
                .catch((e) => console.warn('[GeminiLive] AudioContext resume failed:', e));
        }

        const arrayBuffer = this.base64ToArrayBuffer(base64Data);
        const int16View = new Int16Array(arrayBuffer);
        const float32Array = new Float32Array(int16View.length);

        for (let i = 0; i < int16View.length; i++) {
            float32Array[i] = int16View[i] / 32768.0;
        }

        const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Route model audio through Model Analyser -> Gain Node -> destination
        // Gain node prevents clipping/screeching from hot model output
        if (this.modelAnalyser && this.modelGainNode) {
            source.connect(this.modelAnalyser);
        } else if (this.modelGainNode) {
            source.connect(this.modelGainNode);
        } else {
            source.connect(this.audioContext.destination);
        }

        // Route model audio directly to Right channel of Stereo Debug Recorder
        // Since it uses the same scheduled source, it records at the exact playback time and clean speed!
        if (this.debugAudioMerger) {
            try {
                source.connect(this.debugAudioMerger, 0, 1); // Channel 1 = Model (Right)
            } catch (e) {
                // Ignore if merger closed
            }
        }

        const currentTime = this.audioContext.currentTime;
        const startTime = Math.max(currentTime, this.nextPlayTime);
        source.start(startTime);
        this.nextPlayTime = startTime + audioBuffer.duration;

        this.isModelSpeaking = true;
        this.lastModelAudioTime = Date.now() + Math.round(audioBuffer.duration * 1000);

        this.queuedSources.push(source);
        source.onended = () => {
            const idx = this.queuedSources.indexOf(source);
            if (idx !== -1) {
                this.queuedSources.splice(idx, 1);
            }
            if (this.queuedSources.length === 0) {
                this.isModelSpeaking = false;
                this.setOrbSpeaking(false);
            }
        };
    },
    stopAllAudioPlayback() {
        this.isModelSpeaking = false;
        for (const source of this.queuedSources) {
            try {
                source.stop();
                source.disconnect();
            } catch (e) {}
        }
        this.queuedSources = [];
        if (this.audioContext) {
            this.nextPlayTime = this.audioContext.currentTime;
        }
    },
    startVuMeterLoop() {
        this.stopVuMeterLoop();
        const micData = new Uint8Array(32);
        const modelData = new Uint8Array(32);

        const updateMeters = () => {
            if (!this.isConnected) {
                if (this.vuMicBar) this.vuMicBar.style.width = '0%';
                if (this.vuModelBar) this.vuModelBar.style.width = '0%';
                this.vuAnimationFrame = null;
                return;
            }

            // User microphone level
            let micVol = 0;
            if (this.micAnalyser && !this.isMuted) {
                this.micAnalyser.getByteFrequencyData(micData);
                let sum = 0;
                for (let i = 0; i < micData.length; i++) sum += micData[i];
                micVol = sum / micData.length / 255;
            }

            // Assistant model speech level
            let modelVol = 0;
            if (this.modelAnalyser && this.isModelSpeaking) {
                this.modelAnalyser.getByteFrequencyData(modelData);
                let sum = 0;
                for (let i = 0; i < modelData.length; i++) sum += modelData[i];
                modelVol = sum / modelData.length / 255;
            }

            const micPercent = Math.min(100, Math.round(micVol ** 0.65 * 125));
            const modelPercent = Math.min(100, Math.round(modelVol ** 0.65 * 125));

            if (this.vuMicBar) this.vuMicBar.style.width = `${micPercent}%`;
            if (this.vuModelBar) this.vuModelBar.style.width = `${modelPercent}%`;

            this.vuAnimationFrame = requestAnimationFrame(updateMeters);
        };
        this.vuAnimationFrame = requestAnimationFrame(updateMeters);
    },
    stopVuMeterLoop() {
        if (this.vuAnimationFrame) {
            cancelAnimationFrame(this.vuAnimationFrame);
            this.vuAnimationFrame = null;
        }
        if (this.vuMicBar) this.vuMicBar.style.width = '0%';
        if (this.vuModelBar) this.vuModelBar.style.width = '0%';
    },
    setOrbActive(active) {
        if (!this.orbInner) return;
        if (active) {
            this.orbInner.classList.add('active');
            this.ring1?.classList.add('pulsing');
            this.ring2?.classList.add('pulsing');
            this.ring3?.classList.add('pulsing');
        } else {
            this.orbInner.classList.remove('active', 'speaking');
            this.ring1?.classList.remove('pulsing');
            this.ring2?.classList.remove('pulsing');
            this.ring3?.classList.remove('pulsing');
        }
    },
    setOrbSpeaking(speaking) {
        if (!this.orbInner) return;
        if (speaking) {
            this.orbInner.classList.add('speaking');
        } else {
            this.orbInner.classList.remove('speaking');
        }
    },

    // High quality audio conversion utilities with linear interpolation
    downsampleTo16k(buffer, sampleRate) {
        if (sampleRate === 16000) return buffer;
        const sampleRatio = sampleRate / 16000;
        const newLength = Math.round(buffer.length / sampleRatio);
        const result = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
            const srcIdx = i * sampleRatio;
            const idxFloor = Math.floor(srcIdx);
            const idxCeil = Math.min(buffer.length - 1, idxFloor + 1);
            const frac = srcIdx - idxFloor;
            result[i] = buffer[idxFloor] * (1 - frac) + buffer[idxCeil] * frac;
        }
        return result;
    },
    floatTo16BitPCM(input) {
        const buffer = new ArrayBuffer(input.length * 2);
        const view = new DataView(buffer);
        let offset = 0;
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return buffer;
    },
    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    },
    base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    },
});

