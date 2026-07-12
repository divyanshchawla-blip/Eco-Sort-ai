# EcoSort AI — Deploying on Your GitHub Account

This app has two parts that deploy separately:

| Part | File | Where it lives |
|---|---|---|
| Frontend (what users see) | `EcoSort_AI_Demo.html` | GitHub Pages (free, static) |
| Backend (the AI identifier) | `ai_identifier_backend.js` + `package.json` | Render.com (free tier, holds your secret key) |

**Why two places?** GitHub Pages only serves static files — HTML/CSS/JS with no server behind them. It cannot safely store a secret API key. If you put your Anthropic API key directly in the HTML and push it to GitHub, anyone could view-source the page, steal the key, and run up charges on your account. The backend exists specifically to keep that key private.

---

## Step 1 — Create your GitHub repo

1. Go to [github.com/new](https://github.com/new), create a repo (e.g. `ecosort-ai`)
2. Upload all the files: `EcoSort_AI_Demo.html`, `ai_identifier_backend.js`, `package.json`, `.env.example`
3. Commit

## Step 2 — Deploy the backend (Render.com, free tier)

1. Go to [render.com](https://render.com), sign up, click **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `node ai_identifier_backend.js`
4. Under **Environment**, add a variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your real key from [console.anthropic.com](https://console.anthropic.com/)
5. Deploy. Render gives you a URL like `https://ecosort-ai.onrender.com`
6. Test it's alive: visit `https://ecosort-ai.onrender.com/api/health` — should show `{"status":"ok"}`

*(Railway.app works the same way if you prefer it over Render.)*

## Step 3 — Point the frontend at your backend

1. Open `EcoSort_AI_Demo.html`
2. Find this line near the top of the `<script>` section:
   ```js
   const BACKEND_URL = "https://YOUR-BACKEND-URL-HERE.onrender.com/api/classify";
   ```
3. Replace it with your real Render URL + `/api/classify`, e.g.:
   ```js
   const BACKEND_URL = "https://ecosort-ai.onrender.com/api/classify";
   ```
4. Commit and push this change to GitHub

## Step 4 — Turn on GitHub Pages

1. In your repo: **Settings → Pages**
2. Source: **Deploy from a branch** → `main` → `/ (root)`
3. Save. GitHub gives you a live URL like `https://yourusername.github.io/ecosort-ai/EcoSort_AI_Demo.html`

That's it — camera scan, photo upload, and AI classification will now work fully on the live GitHub Pages site, with your API key safely hidden on the Render backend instead of exposed in the browser.

---

## Notes

- **Render's free tier sleeps after inactivity** — the first request after idle time can take 10-20 seconds while it wakes up. Fine for a hackathon demo; upgrade to a paid tier for anything more.
- **Rename `.env.example` to `.env`** only for local testing — never commit a real `.env` file with your actual key to GitHub. Add `.env` to a `.gitignore` file to be safe.
- If classification fails on the live site, check your browser console (F12) — the error message will say whether it's a `BACKEND_URL` typo, a Render server issue, or an Anthropic API error.
