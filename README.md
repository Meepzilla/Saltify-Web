# Saltify Web

https://saltify-web.devinllewis-git.workers.dev/

**Privacy-focused, 100% on-device Progressive Web App (PWA) for recording, transcribing, coding, and analyzing child language samples with SALT conventions** — built for **Android, Windows, and iPad**, inspired by and maintaining parity with [`oss-slu/SpeechTranscription`](https://github.com/oss-slu/SpeechTranscription).

## Privacy Guarantee

Every step of the clinical workflow executes **100% locally in the browser** — no audio recordings, transcripts, or client metadata are ever sent to an external server:

- **Audio Recording & Processing:** Captured via Web Audio / MediaRecorder (adaptive MP4/AAC for iPadOS Safari, WebM/Opus for Android/Windows, with raw PCM WAV fallback), normalized locally, and stored in IndexedDB.
- **On-Device Speech Recognition:** Powered by OpenAI Whisper (`whisper-tiny.en`, `whisper-base.en`, `whisper-small.en`) via [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) in a dedicated Web Worker (WebGPU acceleration with automatic universal WASM fallback). Model weights download once and remain cached in browser Cache Storage for **fully offline use**.
- **SALT Grammar & Bound Morpheme Engine:** Pure TypeScript NLP (`wink-pos-tagger` + `wink-lemmatizer` + pediatric SLP rule engine) with zero Java/LanguageTool/Python server dependencies.
- **Client-Side Exports:** Generates Microsoft Word (`.docx`), SALT Software (`.slt`), plain text (`.txt`), 16-bit PCM audio (`.wav`), Print sheets, and portable `.saltify.json` session backups entirely on-device.

---

## Features & Parity with `oss-slu/SpeechTranscription`

| Capability | Desktop Saltify (`oss-slu/SpeechTranscription`) | Saltify Web PWA (Android / Windows / iPad) |
|---|---|---|
| **Audio Capture & Upload** | PyAudio / MP3 & WAV upload + loudness normalization | Live mic with VU meter, Pause/Resume, Screen Wake Lock + drag-and-drop WAV/MP3/M4A/MP4/WebM/OGG + peak normalization |
| **Waveform & Playback** | Matplotlib popup + Play/Pause/±5s/Restart/Scrub | Interactive high-DPI Canvas waveform (inline + expandable modal), ±5s, Restart, Scrubbing, `0.5x–1.5x` speed, click `[M:SS]` to seek |
| **Speech Transcription** | Local Whisper `small.en` subprocess w/ cancel | Local Whisper Web Worker (`Tiny`/`Base`/`Small .en`) with pause-aware low-RAM chunking (safe for iPadOS), progress streaming & instant cancel |
| **Speaker Labeling & Aliases** | Bulk Label Speakers modal + `C` / `E` aliases & color coding | Bulk Label Speakers modal + 1-tap speaker badges per utterance + customizable aliases & color coding |
| **SALT Grammar Check** | LanguageTool (Java) step-by-step review | On-device child-language grammar engine (repetitions/mazes, overregularizations `[EW:]`/`[EO:]`, `/*3s`, pronoun case, copula omissions, `a`/`an`) + step-by-step workbench with touch SALT code chips & batch auto-apply |
| **Inflectional Morphemes** | NLTK + WordNet (`/s`, `/z`, `/ed`, `/3s`, `/ing`, contractions) | `wink-pos-tagger` + `wink-lemmatizer` passing all ported `SpeechTranscription` unit tests while preserving SALT error codes & timestamps |
| **Clinical SALT Metrics** | — | Real-time Child vs Examiner **MLUm, MLUw, TNW, NDW, TTR, Bound Morphemes, Mazes %, Error/Omission counts, WPM** |
| **Session & Client Metadata** | Multi-session tabs + Client Info fields | Persistent IndexedDB multi-session manager (rename, delete, `.saltify.json` import/export) + Client Info modal with live SALT header preview |
| **Export & Print** | `.docx` Word export + WAV download | `.docx`, native SALT `.slt`, `.txt`, `.wav`, Copy to Clipboard, Print view, and `.saltify.json` backup |

---

## Installing on Android, Windows, and iPad

1. **iPad (iPadOS Safari):** Open Saltify Web in Safari → tap **Share** → **Add to Home Screen**. Recommended model: **Whisper Tiny (.en)** or **Whisper Base (.en)** for optimal iPad Safari memory stability.
2. **Android (Chrome / Edge):** Open Saltify Web → tap **Install Saltify App** in the sidebar (or browser menu → **Install app**).
3. **Windows (Edge / Chrome):** Click the **Install** icon in the address bar (or **Install Saltify App** in the sidebar). Windows laptops/desktops comfortably run **Whisper Small (.en)** with WebGPU or WASM.

To prepare for offline clinical sessions, open **AI Models** in the sidebar while connected to Wi-Fi and click **Download** on your preferred Whisper model.

---

## Self-Hosting (100% Air-Gapped / Zero External Calls)

Saltify Web includes everything needed to self-host the entire PWA, ONNX Runtime Web WASM (`/ort/`), and Whisper models (`/models/`) on your own Windows PC, Linux server, Raspberry Pi, or clinic LAN with **zero outbound internet traffic** from client devices:

```bash
# 1. Download Whisper models onto your server (default: tiny + base; add --all for small too)
npm run models:download

# 2. Launch with Docker Compose + Caddy (or serve dist/ with nginx.conf)
docker compose up -d --build
```

See [SELF_HOSTING.md](./SELF_HOSTING.md) for complete setup instructions — including HTTPS options for **iPad, Android, and Windows** (Tailscale HTTPS, Caddy Let's Encrypt, Cloudflare Tunnel, and air-gapped LAN CA).

---

## Development

```bash
npm install
npm run models:download   # Optional: download self-hosted Whisper models into public/models/
npm run dev               # Copies self-hosted ORT WASM into public/ort/ and starts Vite dev server
npm test                  # Run Vitest suite (includes ported SpeechTranscription SALT tests)
npm run build             # Type-check + build production PWA bundle with Workbox service worker
npm run preview           # Preview production PWA build locally
npm run lint              # Run oxlint checks
```

## License & Attribution

Inspired by and porting the SALT transcription conventions and test suite from [Saint Louis University Open Source Software — SpeechTranscription (Saltify)](https://github.com/oss-slu/SpeechTranscription) (GNU GPLv3).
