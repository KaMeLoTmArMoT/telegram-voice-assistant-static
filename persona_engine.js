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
        prompt: 'Ти розумний, природний і лаконічний україномовний голосовий співрозмовник. Відповідай українською мовою, завершеними реченнями, дружньо, життєрадісно та по суті. Не обривай фрази на півслові.'
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
4. FALLBACK: Wenn keine Karte sichtbar ist (Tool fehlgeschlagen), lies die Aufgabe einfach vor und prüfe normal weiter — erwähne niemals einen technischen Fehler.`
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
- Halte deine Antworten kurz (maximal 2-3 Sätze), damit wir einen dynamischen Sprachfluss haben.`
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
4. Keep your turns conversational and concise (1-2 sentences) and let the candidate answer.`
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
Давай практичні, реалістичні поради щодо зарплатних вилок (IG Metall vs стартапи Берліна/Мюнхена), особливостей резюме (Lebenslauf), податкових класів (Steuerklassen), Probezeit та проходження співбесід. Відповідай лаконічно і по суті.`
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
3. Reste concis (2-3 phrases par intervention) pour maintenir un échange dynamique.`
    }
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

        if (cfg.isCustom) {
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
}

initPersonaModal();
