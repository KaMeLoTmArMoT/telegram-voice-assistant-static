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
                this.audioContext.resume().catch((e) => console.warn('[GeminiLive] AudioContext resume on gesture error:', e));
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
        const isStreamValid = this.mediaStream && this.mediaStream.active && this.mediaStream.getAudioTracks().some((t) => t.readyState === 'live');
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
            const supportedMime = pickSupportedMime([
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4',
                '',
            ]);
            const recorderOpts = supportedMime ? { mimeType: supportedMime, audioBitsPerSecond: 48000 } : {};

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
                    this.debugAudioBlob = new Blob(this.debugAudioChunks, { type: supportedMime || 'audio/webm' });
                    console.log(`[GeminiLive] Stereo debug recording ready: ${(this.debugAudioBlob.size / 1024).toFixed(1)} KB`);
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
            const isModelCurrentlySpeaking = this.isModelSpeaking || (now - this.lastModelAudioTime < 250);

            // Acoustic Echo Guard: when assistant is speaking through speakers, raise voice threshold to prevent false self-interruption (barge-in)
            let voiceThreshold = 0.015; // Gentle sensitivity for quiet speech
            if (this.isEchoGuardEnabled && isModelCurrentlySpeaking) {
                // Ignore lower volumes (speaker loopback) when assistant is speaking
                voiceThreshold = 0.14;
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
                if (this.isEchoGuardEnabled && isModelCurrentlySpeaking && avgVolume < voiceThreshold) {
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
            this.audioContext.resume().catch((e) => console.warn('[GeminiLive] AudioContext resume failed:', e));
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

            const micPercent = Math.min(100, Math.round(Math.pow(micVol, 0.65) * 125));
            const modelPercent = Math.min(100, Math.round(Math.pow(modelVol, 0.65) * 125));

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
    }
});
