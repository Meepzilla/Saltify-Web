# Saltify Web

A privacy-focused, **100% on-device Progressive Web App (PWA)** for Speech-Language Pathologists (SLPs), educators, and researchers to record, transcribe, code SALT conventions, and analyze child language samples across **iPad (iPadOS Safari)**, **Android (Chrome)**, and **Windows (Edge/Chrome/Firefox)**.

> Based on [**Saltify (`oss-slu/SpeechTranscription`)**](https://github.com/oss-slu/SpeechTranscription) by Open Source with SLU, ported from a Python desktop app into an offline-capable cross-platform web application under the **GNU General Public License v3.0 (GPLv3)**.

---

## Why 100% On-Device?

Child speech samples are sensitive clinical and educational records (FERPA / HIPAA contexts). In Saltify Web:

- **Zero audio or transcript uploads**: Audio recording, loudness normalization, Whisper speech-to-text, SALT grammar coding, inflectional morpheme tagging, and `.docx` / `.slt` exports all execute locally inside the browser.
- **Offline-capable PWA**: Installable directly to the Home Screen on iPads and Android tablets, or as a desktop app on Windows. Once a Whisper speech model is downloaded the first time, it is cached locally in the browser for offline transcription.
- **Local persistence with quick wipe**: Sessions and audio blobs persist locally in `IndexedDB` across reloads, with a one-click **Clear All Local Data** button for shared school iPads or clinic devices.

---

## Features

- **Cross-Platform Audio Capture & Upload**
  - Live microphone recording with a real-time acoustic input level meter (automatically negotiates MP4/AAC on iPad Safari and WebM/Opus on Android/Windows, exporting clean 16-bit PCM `.wav`).
  - Upload `.wav`, `.mp3`, `.m4a` (iPad Voice Memos), `.webm`, `.ogg`, or `.aac` recordings.
  - Touch-friendly interactive waveform with tap/drag scrubbing, Restart, ±5s skip, and SLP playback speed controls (`0.65×`–`1.5×`).
- **On-Device Whisper Transcription & Automatic Speaker Assignment**
  - Runs OpenAI Whisper (`Xenova/whisper-tiny.en`, `base.en`, `onnx-community/distil-small.en`, and desktop `Xenova/whisper-small.en`) locally in a dedicated Web Worker via `@huggingface/transformers` (quantized WASM) using silence-aware chunk-by-chunk decoding for iPad memory safety.
  - Supports mid-run **Cancel**, live download & per-segment transcription progress, Screen Wake Lock on iPads/tablets, and clickable `[m:ss]` timestamps that jump playback directly to the utterance.
  - Automatically assigns **C** (Child) and **E** (Examiner) speaker labels on-device using acoustic voice analysis (YIN pitch, spectral centroid, MFCC clustering) combined with clinical conversational cues.
- **Speaker Labeling & Custom Aliases**
  - Auto-assign speakers on demand, one-tap **Swap C ↔ E**, batch-assign utterances with high-contrast color coding, or customize speaker aliases and re-tag transcripts in-place.
- **SALT Grammar Check & Inflectional Morphemes**
  - Step-by-step interactive review highlighting child-speech patterns:
    - Repeated-word mazes: `(I I) I`
    - Overgeneralized irregular past tense & plurals: `telled[EW:told]`, `goed[EW:went]`, `foots[EW:feet]`
    - Omitted 3rd-person singular `-s`: `He walk/*3s to school.`
    - Subject-verb agreement & omitted auxiliaries: `are[EW:is]`, `was[EW:were]`, `He is* running`
    - Pronoun case errors & article mismatches: `Me[EP:I]`, `a[EW:an] elephant`
  - Quick-insert SALT code buttons (`[EW:]`, `[EP:]`, `[EO:]`, `[EW]`, `/*3s`, `[EU]`, `XXX`).
  - Bound inflectional morpheme tagging (`/s`, `/z`, `/ed`, `/3s`, `/ing`, contractions `/'m`, `/'s`, `can/'t`, `don't`) while preserving existing SALT error codes and timestamps.
- **Live Clinical SALT Metrics**
  - Real-time Utterances, **TNW**, **NDW**, **TTR**, **MLU-w**, **MLU-m**, Mazes, and Error Codes with speaker filtering (`All`, `C`, `E`).
- **Clinical Exports & Sharing**
  - **SALT Software (`.slt`)** with `$ Child, Examiner`, `+ Name/CA/DOB/DOE/Examiner/Context`, and `- 0:00` headers.
  - **Word Document (`.docx`)** generated client-side with timestamps stripped.
  - **PCM WAV Audio (`.wav`)**, **Print / AirPrint / Save PDF**, and native iPad/Android Web Share Sheet.

---

## Installing on iPad, Android & Windows

Host the built `dist/` folder on any HTTPS static host (for example, enable **Settings → Pages → Source: GitHub Actions** in this repository to deploy automatically to GitHub Pages).

- **iPad / iPhone (Safari)**: Open the HTTPS URL → tap the **Share** button → **Add to Home Screen**.
- **Android (Chrome)**: Open the HTTPS URL → tap **Install App** in the top bar (or Chrome menu `⋮` → **Install app**).
- **Windows (Edge / Chrome)**: Open the HTTPS URL → click **Install App** in the top bar or the address bar install icon.

> Note: Microphone recording (`getUserMedia`) and PWA installation require **HTTPS** (or `http://localhost` during local development).

---

## Local Development

```bash
npm install
npm run dev
```

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite development server |
| `npm test` | Run Vitest unit tests (including ported upstream SALT test cases) |
| `npm run typecheck` | Run strict TypeScript typecheck |
| `npm run lint` | Run `oxlint` static analysis |
| `npm run build` | Build production static bundle and generate offline Service Worker (`dist/sw.js`) |
| `npm run preview` | Preview the production build locally |

---

## Upstream Attribution & License

This project is derived from [**oss-slu/SpeechTranscription** (Saltify)](https://github.com/oss-slu/SpeechTranscription), created by Open Source with SLU. Its SALT convention rules, test suites, and clinical workflow are adapted for browser execution and released under the **GNU General Public License v3.0** — see [LICENSE.md](./LICENSE.md).
