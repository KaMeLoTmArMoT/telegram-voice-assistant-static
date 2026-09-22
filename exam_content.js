/**
 * telc Deutsch-Test für den Beruf B2 — exam content (MVP: Teil 1 + Teil 3).
 * Standalone file: safe to remove. live_stream.js guards with typeof checks.
 */
(function () {
    var TEIL1_TOPICS = [
        { id: 1, de: "Beschreiben Sie einen Arbeitgeber, für den Sie gearbeitet haben oder arbeiten möchten (z. B. Branche, Produkte und Dienstleistungen, Abteilungen und ihre Aufgaben, Besonderheiten)." },
        { id: 2, de: "Beschreiben Sie, wie Sie sich ein gutes Arbeitsumfeld vorstellen (z. B. Jobsicherheit, Lohn/Gehalt, Karrierechancen, Kommunikation in der Firma, Beispiele aus Ihrer Berufserfahrung)." },
        { id: 3, de: "Beschreiben Sie die Ereignisse und Erfahrungen, die Ihre Berufswahl beeinflusst haben (z. B. Stationen, wichtige Personen, Motivation, Folgen)." },
        { id: 4, de: "Beschreiben Sie eine Person aus Ihrem Umfeld, die für Sie ein berufliches Vorbild ist (z. B. Beziehung zu dieser Person, Eigenschaften, Einfluss auf Sie)." },
        { id: 5, de: "Beschreiben Sie das Vorgehen bei der Arbeitssuche für ein Land Ihrer Wahl (z. B. Angebote finden, Erstkontakt, Bewerbungsunterlagen oder -gespräch)." },
        { id: 6, de: "Beschreiben Sie, worauf es bei einem Bewerbungsgespräch ankommt. Sprechen Sie über ein Land Ihrer Wahl (z. B. Berufsfeld, Vorbereitung, Kleidung, typische Fragen)." },
        { id: 7, de: "Beschreiben Sie ein Produkt / eine Dienstleistung Ihrer Wahl (z. B. Merkmale, Nutzen für Kunden, Vor- und Nachteile, Erfolg)." },
        { id: 8, de: "Sie möchten sich selbstständig machen. Beschreiben Sie Ihre Geschäftsidee (z. B. welches Produkt/welche Dienstleistung, Besonderheiten, Zielgruppe)." }
    ];

    var TEIL3_SITUATIONS = [
        {
            id: "friseur-shampoo",
            titel: "Friseursalon – neues Shampoo",
            situation: "Sie arbeiten in einem Friseursalon und verwenden dort seit einiger Zeit ein neues Shampoo. Es haben sich aber schon drei Kundinnen über allergische Reaktionen beschwert.",
            stichpunkte: [
                "Shampoo: was tun? (sofort absetzen, altes Shampoo, Beweise sichern)",
                "Kundinnen: wie kontaktieren? was anbieten? (anrufen, Entschuldigung, Ersatztermin/Erstattung)",
                "Lieferanten: wie kontaktieren? was fordern? (Reklamation, Inhaltsstoffe, Ersatz/Rücknahme)",
                "langfristig: welches Shampoo? welcher Lieferant? (hypoallergen, Testphase, zweiter Lieferant)"
            ]
        },
        {
            id: "werkstatt-reklamation",
            titel: "Autowerkstatt – Reklamation",
            situation: "Sie arbeiten in einer Autowerkstatt. Ein Stammkunde beschwert sich: Nach der Reparatur letzte Woche macht das Auto wieder Geräusche. Er droht mit einer schlechten Online-Bewertung.",
            stichpunkte: [
                "Sofort: Auto erneut prüfen, Fehlerprotokoll, Ersatzwagen anbieten",
                "Kunde: beruhigen, klare Entschuldigung, kostenlose Nachbesserung + Gutschein",
                "Team: Ursache klären (welcher Mechaniker, welches Teil), Checkliste verbessern",
                "langfristig: Qualitätskontrolle, Probefahrt-Protokoll, Bewertungsmanagement"
            ]
        },
        {
            id: "restaurant-lieferung",
            titel: "Restaurant – Lieferprobleme",
            situation: "Sie arbeiten in einem Restaurant mit Lieferservice. In der letzten Woche kamen drei Bestellungen zu spät und eine war falsch. Zwei Kunden verlangen ihr Geld zurück.",
            stichpunkte: [
                "Sofort: Bestellungen prüfen, fehlende/falsche nachliefern, Erstattung anbieten",
                "Kunden: anrufen, Entschuldigung, Gutschein für nächste Bestellung",
                "Lieferdienst/ Küche: Ablauf klären, Verantwortliche, Zeitfenster realistisch planen",
                "langfristig: zweiter Fahrer in Stoßzeiten, Checkliste pro Bestellung, Feedback-System"
            ]
        }
    ];

    function pickRandomTwoTopics() {
        var idx = TEIL1_TOPICS.map(function (_, i) { return i; });
        for (var i = idx.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
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
        getSituationById: getSituationById
    };
})();
