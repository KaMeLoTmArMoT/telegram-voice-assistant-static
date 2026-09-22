/**
 * Exam card + phase timer UI (progressive enhancement).
 * If this file fails to load, live_stream.js must keep working — all callers
 * guard with `typeof window.ExamUI !== 'undefined'`.
 */
(function () {
    var phases = {}; // phase -> {startAt, elapsedMs}
    var currentPhase = null;
    var tickTimer = null;
    var lastChoice = null;
    var lastSituation = null;
    var lastEvaluation = null;

    function $(id) { return document.getElementById(id); }

    function fmt(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        var m = Math.floor(s / 60);
        var r = s % 60;
        return m + ":" + (r < 10 ? "0" : "") + r;
    }

    function totalElapsed() {
        var t = 0;
        Object.keys(phases).forEach(function (k) {
            var p = phases[k];
            t += p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0);
        });
        return t;
    }

    function renderTimerPill() {
        var pill = $("exam-timer-pill");
        if (!pill) return;
        var label = $("exam-timer-text");
        if (!label) return;
        if (!currentPhase && totalElapsed() === 0) {
            pill.classList.add("hidden");
            return;
        }
        pill.classList.remove("hidden");
        var cur = "";
        if (currentPhase && phases[currentPhase]) {
            var p = phases[currentPhase];
            cur = fmt(p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0));
            label.textContent = "⏱ " + currentPhase + " " + cur + " · Σ " + fmt(totalElapsed());
        } else {
            label.textContent = "⏱ Σ " + fmt(totalElapsed());
        }
    }

    function ensureTick() {
        if (tickTimer) return;
        tickTimer = setInterval(renderTimerPill, 1000);
    }

    function timerStart(phase) {
        try {
            phase = phase || "teil1";
            if (!phases[phase]) phases[phase] = { startAt: null, elapsedMs: 0 };
            if (!phases[phase].startAt) phases[phase].startAt = Date.now();
            currentPhase = phase;
            ensureTick();
            renderTimerPill();
            return { ok: true, phase: phase };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    }

    function timerStop(phase) {
        try {
            phase = phase || currentPhase || "teil1";
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
            return { ok: false, error: String(e && e.message || e) };
        }
    }

    function setPhase(phase) {
        try {
            currentPhase = phase;
            var tag = $("exam-phase-tag");
            if (tag) {
                tag.classList.remove("hidden");
                tag.textContent = phase === "teil1" ? "🎓 Teil 1" : phase === "teil3" ? "🎓 Teil 3" : "🎓 " + phase;
            }
            renderTimerPill();
            return { ok: true };
        } catch (e) {
            return { ok: false };
        }
    }

    function updateSummary() {
        var box = $("exam-time-summary");
        if (!box) return;
        var keys = Object.keys(phases);
        if (!keys.length) { box.classList.add("hidden"); return; }
        var norms = { teil1: "Ziel ~2:00", teil1_monolog: "Ziel ~2:00", teil3: "Ziel ~4:00", teil3_diskussion: "Ziel ~4:00" };
        var html = keys.map(function (k) {
            var p = phases[k];
            var ms = p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0);
            var hint = norms[k] ? " (" + norms[k] + ")" : "";
            return "<span class='exam-sum-chip'>" + k + ": <b>" + fmt(ms) + "</b>" + hint + "</span>";
        }).join("");
        box.innerHTML = html;
        box.classList.remove("hidden");
    }

    function getTopics() {
        if (window.TELC_B2_BERUF && window.TELC_B2_BERUF.pickRandomTwoTopics) {
            return window.TELC_B2_BERUF.pickRandomTwoTopics();
        }
        // Fallback if exam_content.js missing: still show a card so voice exam continues.
        return [
            { id: 0, de: "Sprechen Sie über Ihren Beruf / Arbeitgeber (Branche, Aufgaben, Besonderheiten)." },
            { id: 0, de: "Beschreiben Sie Ihr ideales Arbeitsumfeld (Gehalt, Team, Karrierechancen)." }
        ];
    }

    function getSituation(situationId) {
        try {
            if (window.TELC_B2_BERUF) {
                if (situationId && window.TELC_B2_BERUF.getSituationById) {
                    var s = window.TELC_B2_BERUF.getSituationById(situationId);
                    if (s) return s;
                }
                if (window.TELC_B2_BERUF.pickRandomSituation) return window.TELC_B2_BERUF.pickRandomSituation();
            }
        } catch (e) { /* fall through to fallback */ }
        return {
            id: "fallback", titel: "Problemlösung im Betrieb",
            situation: "Besprechen Sie mit Ihrem Partner / Prüfer, wie Sie auf eine Kundenbeschwerde reagieren und was Sie langfristig verbessern.",
            stichpunkte: ["Sofortmaßnahme?", "Kunde: kontaktieren + anbieten?", "Lieferant/Kollegen: klären?", "Langfristig: was ändern?"]
        };
    }

    function openModal() { var m = $("exam-card-modal"); if (m) m.classList.remove("hidden"); }
    function closeModal() { var m = $("exam-card-modal"); if (m) m.classList.add("hidden"); }
    function isOpen() { var m = $("exam-card-modal"); return !!(m && !m.classList.contains("hidden")); }

    function esc(s) {
        return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function showTeil1Choice() {
        try {
            var topics = getTopics();
            lastChoice = topics;
            setPhase("teil1");
            var title = $("exam-card-title");
            var body = $("exam-card-body");
            if (!title || !body) return { ok: false, error: "modal-missing" };
            title.textContent = "🎓 Teil 1 — Wählen Sie ein Thema";
            body.innerHTML =
                topics.map(function (t, i) {
                    return "<button type='button' class='exam-topic-btn' data-idx='" + i + "'>" +
                        "<span class='exam-topic-num'>Thema " + (i + 1) + "</span>" +
                        "<span class='exam-topic-text'>" + esc(t.de) + "</span>" +
                        "<span class='exam-topic-hint'>Tippen, um Vollbild zu öffnen</span></button>";
                }).join("") +
                "<div class='exam-card-actions'><button type='button' id='exam-btn-new-topics' class='btn btn-secondary'>🎲 Neue 2 Themen</button></div>";
            body.querySelectorAll(".exam-topic-btn").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    var t = topics[parseInt(btn.getAttribute("data-idx"), 10)];
                    if (t) expandTopic(t);
                });
            });
            var re = $("exam-btn-new-topics");
            if (re) re.addEventListener("click", function (e) { e.stopPropagation(); showTeil1Choice(); });
            openModal();
            var sheet = $("exam-card-sheet");
            if (sheet) sheet.classList.remove("exam-fullscreen");
            return { ok: true, topics: topics.map(function (t) { return t.de; }) };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    }

    function expandTopic(t) {
        var title = $("exam-card-title");
        var body = $("exam-card-body");
        if (!title || !body) return;
        title.textContent = "🎓 Teil 1 — Ihr Thema (~2 Min.)";
        body.innerHTML = "<div class='exam-full-topic'>" + esc(t.de) + "</div>" +
            "<div class='exam-card-actions'><button type='button' id='exam-btn-back-choice' class='btn btn-secondary'>← Zurück zur Auswahl</button></div>";
        var sheet = $("exam-card-sheet");
        if (sheet) sheet.classList.add("exam-fullscreen");
        var back = $("exam-btn-back-choice");
        if (back) back.addEventListener("click", function () {
            var sheet2 = $("exam-card-sheet");
            if (sheet2) sheet2.classList.remove("exam-fullscreen");
            showTeil1Choice();
        });
    }

    function showTeil3Card(situationId) {
        try {
            var s = getSituation(situationId);
            lastSituation = s;
            setPhase("teil3");
            var title = $("exam-card-title");
            var body = $("exam-card-body");
            if (!title || !body) return { ok: false, error: "modal-missing" };
            title.textContent = "🎓 Teil 3 — " + s.titel + " (~4 Min.)";
            body.innerHTML = "<div class='exam-situation'>" + esc(s.situation) + "</div>" +
                "<ul class='exam-points'>" + s.stichpunkte.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" +
                "<div class='exam-card-actions'><button type='button' id='exam-btn-new-sit' class='btn btn-secondary'>🎲 Andere Situation</button></div>";
            var re = $("exam-btn-new-sit");
            if (re) re.addEventListener("click", function (e) { e.stopPropagation(); showTeil3Card(); });
            openModal();
            return { ok: true, situation: s.titel };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    }

    function hideCard() {
        try { closeModal(); return { ok: true }; }
        catch (e) { return { ok: false }; }
    }

    // Post-session telc scoring via backend generateContent (text-only, no audio
    // tokens). Reads transcript from the Live manager; every step is guarded so
    // a missing manager or network failure never breaks the Live session.
    function requestEvaluation() {
        try {
            var mgr = window.liveStreamManager;
            var turns = (mgr && mgr.transcriptHistory) ? mgr.transcriptHistory : [];
            if (!turns.length) {
                if (typeof showToast === "function") showToast("Немає реплік для оцінювання", "ℹ️");
                return { ok: false, error: "empty-transcript" };
            }
            var title = $("exam-card-title");
            var body = $("exam-card-body");
            if (!title || !body) return { ok: false, error: "modal-missing" };
            title.textContent = "📊 telc-Bewertung — wird erstellt…";
            body.innerHTML = "<div class='exam-situation'>⏳ KI bewertet deinen Auftritt (nur Text, keine Audio-Tokens)…</div>";
            openModal();
            var auth = (mgr && typeof mgr.getAuthParams === "function") ? mgr.getAuthParams() : {};
            var base = (mgr && typeof mgr.getApiBaseUrl === "function") ? mgr.getApiBaseUrl() : "";
            fetch(base + "/api/tma/live/evaluate-exam", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    turns: turns,
                    phases: summary(),
                    init_data: auth.initData || null,
                    user_id: auth.userId ? parseInt(auth.userId, 10) : null
                })
            }).then(function (res) {
                return res.json().then(function (data) { return { res: res, data: data }; });
            }).then(function (out) {
                if (!out.res.ok) throw new Error(out.data.detail || "Fehler bei der Bewertung");
                lastEvaluation = out.data.evaluation;
                title.textContent = "📊 telc-Bewertung (KI, unverbindlich)";
                body.innerHTML = "<div class='exam-situation'>" + esc(out.data.evaluation).replace(/\n/g, "<br>") + "</div>" +
                    "<div class='exam-card-actions'><button type='button' id='exam-btn-eval-export' class='btn btn-secondary'>📤 Mit Export senden</button></div>";
                var eb = $("exam-btn-eval-export");
                if (eb) eb.addEventListener("click", function () {
                    closeModal();
                    if (mgr && typeof mgr.exportLiveTranscript === "function") mgr.exportLiveTranscript();
                });
            }).catch(function (e) {
                title.textContent = "📊 Bewertung fehlgeschlagen";
                body.innerHTML = "<div class='exam-situation'>" + esc("⚠️ " + (e && e.message || e)) + "</div>";
            });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
        }
    }

    function wireManualButtons() {
        function on(id, fn) {
            var el = $(id);
            if (el && !el.dataset.examWired) {
                el.dataset.examWired = "1";
                el.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
            }
        }
        on("exam-btn-manual-teil1", function () { showTeil1Choice(); });
        on("exam-btn-manual-teil3", function () { showTeil3Card(); });
        on("exam-btn-manual-timer", function () {
            // Toggle: start current phase timer or stop it.
            if (currentPhase && phases[currentPhase] && phases[currentPhase].startAt) timerStop(currentPhase);
            else timerStart(currentPhase || "teil1");
        });
        on("exam-btn-manual-eval", function () { requestEvaluation(); });
        on("exam-card-close", function () { closeModal(); });
        on("exam-card-toggle-size", function () {
            var sheet = $("exam-card-sheet");
            if (sheet) sheet.classList.toggle("exam-fullscreen");
        });
        on("exam-card-min", function () { closeModal(); });
        var modal = $("exam-card-modal");
        if (modal && !modal.dataset.examWired) {
            modal.dataset.examWired = "1";
            modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
        }
    }

    // Dispatch a single tool call from live_stream.js; always resolves, never throws.
    function dispatchTool(name, args) {
        try {
            args = args || {};
            if (name === "exam_show_teil1_choice") return showTeil1Choice();
            if (name === "exam_show_teil3_card") return showTeil3Card(args.situation_id);
            if (name === "exam_timer_start") return timerStart(args.phase || "teil1");
            if (name === "exam_timer_stop") return timerStop(args.phase);
            if (name === "exam_set_phase") return setPhase(args.phase || "teil1");
            if (name === "exam_hide_card") return hideCard();
            return { ok: false, error: "unknown-tool" };
        } catch (e) {
            return { ok: false, error: String(e && e.message || e) };
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
        setExamEvaluation: function (md) { lastEvaluation = md; },
        getExamEvaluation: function () { return lastEvaluation; },
        summary: function () {
            var out = {};
            Object.keys(phases).forEach(function (k) {
                var p = phases[k];
                out[k] = p.elapsedMs + (p.startAt ? Date.now() - p.startAt : 0);
            });
            return out;
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", wireManualButtons);
    } else {
        wireManualButtons();
    }
})();
