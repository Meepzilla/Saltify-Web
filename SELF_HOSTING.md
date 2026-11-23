# Self-Hosting Saltify Web (100% Zero-Cloud / Air-Gapped Ready)

Saltify Web is engineered to run **100% self-hosted** with **zero external requests** to Hugging Face, jsDelivr, or Google Fonts once you download the Whisper model files onto your server:

- **App Shell & SALT NLP Engine:** Bundled locally in `dist/` (Workbox offline Service Worker).
- **ONNX Runtime Web (`.wasm` / `.mjs`):** Automatically copied from `node_modules/onnxruntime-web/dist/` into `public/ort/` during `npm run build` / Docker build (zero CDN requests).
- **Whisper Models (`.onnx`):** Downloaded once onto your host via `npm run models:download` into `public/models/` and served directly from `/models/`.
- **Zero Server-Side Audio Storage:** All recordings, transcripts, and client info stay strictly on each clinician's device (IndexedDB). Your server only serves static files.

---

## Step 1 — Download Whisper Models Onto Your Server

Run one of the following commands on your host machine:

```bash
# Recommended default: Tiny (~38 MB, iPad/Android) + Base (~73 MB, tablets/laptops)
npm run models:download

# All three English models: Tiny + Base + Small (~350 MB total, Windows desktop parity)
npm run models:download -- --all

# Only a single model (e.g. Tiny only, ~38 MB)
npm run models:download -- --models=tiny

# Optional: also download larger fp32/q4 weights for WebGPU GPU acceleration
npm run models:download -- --all --webgpu
```

This populates `public/models/onnx-community/whisper-*.en/` and writes `public/models/manifest.json`.
Inside Saltify Web's **AI Models** modal, downloaded models automatically show a **Self-Hosted** badge. You can set **Model Hosting Source → Self-Hosted Only (Zero External Requests)** to enforce strict air-gapped behavior.

---

## Step 2 — Start Your Self-Hosted Server

### Option A: Docker Compose (Recommended)

```bash
docker compose up -d --build
```

By default, Saltify Web listens on `http://localhost:8080` and mounts `./public/models` read-only into `/srv/models` (so you can run `npm run models:download` anytime without rebuilding the container).

### Option B: Static Hosting (Nginx / Caddy / IIS / Apache)

```bash
npm ci
npm run models:download   # optional, puts models into public/models/
npm run build             # copies public/ort/ and public/models/ into dist/
```

Serve the generated `dist/` folder using the included `nginx.conf` or `Caddyfile`.

---

## Step 3 — Enable HTTPS for iPad, Android, and Windows

> **Why HTTPS matters:** Modern browsers on **iPadOS Safari, Android Chrome, and Windows Edge/Chrome** require **HTTPS** (or `localhost`) to allow microphone recording (`getUserMedia`) and PWA installation. Plain `http://192.168.x.x` over LAN blocks the microphone!

Choose whichever HTTPS option best fits your setup:

### 1. Tailscale HTTPS (Easiest for Personal / Multi-Device Clinic Use — Free)
If your server, Windows PC, Android phone, and iPad are on your private Tailscale network (no open router ports, trusted Let's Encrypt cert automatically on iPad/Android/Windows!):
```bash
# Run Saltify locally on port 8080 via Docker Compose, then expose privately with HTTPS:
tailscale serve --bg http://127.0.0.1:8080
```
Open your `https://<machine-name>.<tailnet>.ts.net` URL on iPad, Android, and Windows and install the PWA!

### 2. Custom Domain with Automatic Let's Encrypt HTTPS (Caddy)
Point an A/AAAA DNS record (e.g., `saltify.yourdomain.com`) to your server with ports `80` and `443` open, then run:
```bash
SALTIFY_SITE=saltify.yourdomain.com SALTIFY_HTTP_PORT=80 SALTIFY_HTTPS_PORT=443 docker compose up -d --build
```
Caddy automatically provisions and renews TLS certificates.

### 3. Cloudflare Tunnel (Zero Open Ports, Custom Domain)
Point a Cloudflare Tunnel hostname (`https://saltify.yourdomain.com`) to `http://127.0.0.1:8080` (with `SALTIFY_SITE=:80`). Works seamlessly across iPad, Android, and Windows.

### 4. Air-Gapped Local LAN Only (Caddy Internal CA)
If your server has no internet/domain at all:
1. Uncomment `tls internal` in `Caddyfile` and set `SALTIFY_SITE=saltify.local` (or your server LAN IP).
2. Start with `docker compose up -d --build`.
3. Export Caddy's local root certificate:
   ```bash
   docker compose cp saltify-web:/data/caddy/pki/authorities/local/root.crt ./saltify-root-ca.crt
   ```
4. Install and trust `saltify-root-ca.crt` once on your devices:
   - **iPad:** AirDrop/open `.crt` → Settings → Profile Downloaded → Install → Settings → General → About → Certificate Trust Settings → Enable full trust.
   - **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
   - **Windows:** Double-click `.crt` → Install Certificate → Local Machine → Trusted Root Certification Authorities.
