/**
 * ============================================================
 * EcoSort AI — Backend Service (AI Identifier + Signup Notifier)
 * ============================================================
 * This is the server-side version of the classification logic
 * currently embedded directly in the demo HTML file, plus a
 * silent signup-notification endpoint.
 *
 * WHY YOU NEED THIS FOR A REAL DEPLOYMENT:
 * The HTML demo cannot safely call a paid AI API directly from
 * the browser (anyone could steal the key from dev tools). This
 * backend fixes that: the browser sends the photo to YOUR server,
 * your server holds the secret API key, and only your server
 * talks to Google. The frontend never sees the key.
 *
 * WHY GEMINI (not Anthropic) IN THIS VERSION:
 * Google's Gemini API has a genuine free tier — no credit card
 * required — that includes image/vision understanding through
 * the Flash and Flash-Lite models. This is the right choice for
 * testing and demoing over several days at zero cost. If you
 * later want higher accuracy or move to production, you can swap
 * back to Anthropic's API using the same output contract below.
 *
 * ============================================================
 * SETUP
 * ============================================================
 * 1. Install dependencies:
 *      npm init -y
 *      npm install express cors dotenv nodemailer
 *
 * 2. Get a FREE Gemini API key (no credit card needed):
 *      Go to https://aistudio.google.com/apikey
 *      Sign in with any Google account → "Create API key"
 *
 * 3. Set up email sending (for silent signup notifications):
 *      a) Go to https://myaccount.google.com/apppasswords
 *         (use the Gmail account you want emails to be SENT FROM —
 *         this can be the same account as your notification recipient,
 *         or a different one, your choice)
 *      b) Generate an "App Password" (NOT your normal Gmail password —
 *         Gmail requires this special 16-character password for apps)
 *      c) Copy the 16-character password it gives you
 *
 * 4. Create a file named ".env" in the same folder as this file:
 *      GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *      EMAIL_USER=your-sending-gmail@gmail.com
 *      EMAIL_APP_PASSWORD=abcdefghijklmnop
 *      NOTIFY_EMAIL_TO=divyansh6239538841@gmail.com
 *
 * 5. Run the server:
 *      node ai_identifier_backend.js
 *
 * 6. In your frontend (EcoSort_AI_Demo.html), BACKEND_URL should
 *    point at YOUR deployed backend's /api/classify endpoint —
 *    the signup notifier automatically uses the same domain.
 *
 * FREE TIER LIMITS (subject to change by these providers):
 *    Gemini: ~10-15 requests/minute, ~1,000+ requests/day — plenty
 *    for a hackathon demo or several days of testing.
 *    Gmail sending via App Password: fine for low-volume signup
 *    notifications; not meant for bulk/marketing email.
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO || "divyansh6239538841@gmail.com";
const RESEND_FROM = process.env.RESEND_FROM || "EcoSort AI <onboarding@resend.dev>";

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey and create a .env file — see setup instructions at the top of this file.");
  process.exit(1);
}

// Email sending is optional — if not configured, /api/notify-signup will
// log a warning and skip sending rather than crashing the whole server,
// since AI classification should keep working even without email set up.
// NOTE: uses Resend's HTTP API (not SMTP) because Render's free tier (and
// most free hosting tiers) block outbound SMTP connections as an anti-spam
// measure — a plain HTTPS request like this one is not affected by that.
const emailConfigured = !!RESEND_API_KEY;
if (!emailConfigured) {
  console.warn("⚠️  RESEND_API_KEY not set — signup notifications will be skipped (AI classification still works fine).");
} else {
  console.warn("⚠️  EMAIL_USER / EMAIL_APP_PASSWORD not set — signup notifications will be skipped (AI classification still works fine).");
}

app.use(cors());                      // Allow your frontend domain to call this API
app.use(express.json({ limit: '10mb' })); // Photos as base64 can be a few MB

// ------------------------------------------------------------
// Same category + condition system used by the frontend, kept
// here too so the backend can validate the AI's response before
// trusting it (never trust external API output blindly).
// ------------------------------------------------------------
const VALID_CATEGORIES = ["wet", "dry", "metal", "glass", "textile", "hazardous", "other"];
const VALID_CONDITIONS = ["good", "minor_damage", "severe_damage"];

const CLASSIFIER_PROMPT = `You are an expert waste-sorting classifier for an Indian recycling marketplace app, trained on real recycling industry and manufacturing knowledge — not just general object recognition.

Look carefully at this photo and identify the single main waste/discarded item shown — even if the photo is imperfect, angled, or partially visible, give your best specific guess (e.g. "PET plastic water bottle" rather than just "bottle" or "object").

Use real recycling/manufacturing knowledge to classify accurately:
- Plastics: PET (♳1, e.g. water/soda bottles) and HDPE (♴2, e.g. milk jugs, shampoo bottles) ARE commonly recycled as "dry". Multilayer/laminated plastic (chip packets, gutkha/tobacco pouches, biscuit wrappers, most snack packaging) is NOT recyclable in standard streams even though it looks like plastic — classify as "other" regardless of appearance.
- Metals: distinguish tin/steel cans and aluminium (cans, foil, wire) as "metal" — both have real scrap value, aluminium generally higher.
- E-waste: anything with a circuit board, battery, screen, motor, or electrical cord counts as "hazardous", not "metal" or "dry" — this includes cables/wires, chargers, remotes, appliances.
- Textiles: pure cotton/fabric rags have some resale value as "textile"; heavily synthetic-blend or badly soiled cloth is lower value.
- Glass: intact bottles/jars are valuable "glass"; shattered fragments are hazardous to handle and effectively unsellable.
- Organic/wet: only food scraps, peels, garden waste — not packaging that merely touched food.

Also assess physical CONDITION using a real scrap dealer's judgment — damage is a spectrum, not just "sellable or not":
- "good": no meaningful defects, full scrap value applies.
- "minor_damage": visibly worn, dented, scratched, slightly torn, or scuffed, but the core material is still intact and a dealer would still buy it at a discounted rate.
- "severe_damage": genuinely unsellable — shattered glass, crushed beyond recognition, missing most of the material, heavily contaminated/soiled, or structurally destroyed. These items still earn Green Points but cannot be sold for cash.
Default to "good" unless damage is clearly visible; prefer "minor_damage" over "severe_damage" unless resale is genuinely impossible.

Respond with ONLY raw JSON, no markdown code fences, no explanation before or after, in exactly this shape:
{"item": "short common name (2-4 words)", "category": "wet|dry|metal|glass|textile|hazardous|other", "condition": "good|minor_damage|severe_damage", "estimated_weight_kg": number, "confidence": "high|medium|low"}

Only use category "other" with item "unidentified item" if you truly cannot tell what the object is — otherwise always make your best specific guess.`;

// ------------------------------------------------------------
// POST /api/classify
// Body: { image_base64: "<raw base64 jpeg/png, no data: prefix>", media_type?: "image/jpeg" }
// Returns: { item, category, condition, estimated_weight_kg, confidence }
// ------------------------------------------------------------
app.post('/api/classify', async (req, res) => {
  const { image_base64, media_type } = req.body;

  if (!image_base64 || typeof image_base64 !== 'string') {
    return res.status(400).json({ error: "Missing or invalid 'image_base64' in request body." });
  }

  // Tried in order — if Google renames/retires one, the next candidate
  // picks up the slack automatically instead of the whole feature breaking.
  const MODEL_CANDIDATES = [
    "gemini-flash-latest",
    "gemini-3-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ];

  async function callGemini(modelName) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: CLASSIFIER_PROMPT },
            {
              inline_data: {
                mime_type: media_type || "image/jpeg",
                data: image_base64,
              },
            },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 0 }, // disable extended "thinking" tokens — this is a short classification task, not a reasoning task, and thinking mode was eating the token budget before any answer text got written
        },
      }),
    });
    return response;
  }

  try {
    let geminiResponse = null;
    let lastErrorDetail = "";

    for (const modelName of MODEL_CANDIDATES) {
      const attempt = await callGemini(modelName);
      if (attempt.ok) {
        geminiResponse = attempt;
        break;
      }
      // 404 = model not found/retired on this project — try the next candidate.
      // Any other error (401, 429, 500, etc.) is a real problem, not a naming
      // issue, so stop retrying and surface it immediately.
      if (attempt.status !== 404) {
        geminiResponse = attempt;
        break;
      }
      const errText = await attempt.text();
      lastErrorDetail = errText;
      console.warn(`Model "${modelName}" unavailable (404), trying next candidate...`);
    }

    if (!geminiResponse) {
      return res.status(502).json({
        error: `All candidate models unavailable. Last error: ${lastErrorDetail}`
      });
    }

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errText);
      let detail = errText;
      try {
        const errJson = JSON.parse(errText);
        detail = errJson.error?.message || errText;
      } catch (parseErr) { /* errText wasn't JSON, use raw text as-is */ }
      return res.status(502).json({
        error: `AI service returned status ${geminiResponse.status}: ${detail}`
      });
    }

    const data = await geminiResponse.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message || "AI service returned an error" });
    }

    const candidate = (data.candidates || [])[0];
    const textPart = candidate?.content?.parts?.find(p => p.text);
    if (!textPart) {
      // Gemini can return a blocked/empty response for safety filters etc.
      const reason = candidate?.finishReason || "unknown reason";
      return res.status(502).json({ error: `AI response contained no usable text (${reason})` });
    }

    // Robust JSON extraction — survives the model adding stray text or
    // markdown code fences around the JSON despite instructions not to.
    const jsonMatch = textPart.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: `Could not find JSON in AI response. Raw text: "${textPart.text.slice(0, 300)}"` });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(502).json({ error: `AI response was not valid JSON. Raw text: "${jsonMatch[0].slice(0, 300)}"` });
    }

    // Server-side validation — never trust external AI output blindly
    const result = {
      item: typeof parsed.item === 'string' ? parsed.item.slice(0, 60) : "unidentified item",
      category: VALID_CATEGORIES.includes(parsed.category) ? parsed.category : "other",
      condition: VALID_CONDITIONS.includes(parsed.condition) ? parsed.condition : "good",
      estimated_weight_kg: (Number(parsed.estimated_weight_kg) > 0 && Number(parsed.estimated_weight_kg) < 100)
        ? Number(parsed.estimated_weight_kg) : 0.1,
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    };

    return res.json(result);

  } catch (err) {
    console.error("Classification request failed:", err);
    return res.status(500).json({ error: "Internal server error while classifying image." });
  }
});

// ------------------------------------------------------------
// POST /api/notify-signup
// Body: { name, address, phone, dob, location, signedUpAt }
// Sends a silent email to NOTIFY_EMAIL_TO — the signing-up user
// never sees this happen (no popup, no visible link, nothing in
// their UI references it).
// ------------------------------------------------------------
app.post('/api/notify-signup', async (req, res) => {
  const { name, address, phone, dob, location, signedUpAt } = req.body || {};

  if (!name || !address || !phone) {
    return res.status(400).json({ error: "Missing required signup fields." });
  }

  if (!emailConfigured) {
    console.warn("Signup notification skipped — email not configured:", name);
    return res.json({ status: "skipped", reason: "email not configured on server" });
  }

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [NOTIFY_EMAIL_TO],
        subject: `New EcoSort AI Signup — ${name}`,
        text: `New user signed up on EcoSort AI:\n\nName: ${name}\nAddress: ${address}\nPhone: ${phone}\nDate of Birth: ${dob || "not provided"}\nLocation: ${location || "not shared"}\nSigned up at: ${signedUpAt || new Date().toISOString()}`,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error("Resend API error:", resendResponse.status, errText);
      return res.status(200).json({ status: "failed", error: "Email could not be sent, but signup was still recorded." });
    }

    console.log(`✅ Signup notification sent to ${NOTIFY_EMAIL_TO} for "${name}"`);
    return res.json({ status: "sent" });
  } catch (err) {
    console.error("Failed to send signup notification email:", err);
    // Still respond 200-ish so the frontend never shows an error to the
    // signing-up user — email delivery failures shouldn't block signup.
    return res.status(200).json({ status: "failed", error: "Email could not be sent, but signup was still recorded." });
  }
});

// Simple health check
app.get('/api/health', (req, res) => res.json({
  status: "ok",
  geminiConfigured: !!GEMINI_API_KEY,
  emailConfigured: emailConfigured,
  notifyEmailTo: emailConfigured ? NOTIFY_EMAIL_TO : null,
}));

app.listen(PORT, () => {
  console.log(`✅ EcoSort AI identifier backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/classify  — classify a waste item photo`);
  console.log(`   GET  /api/health    — health check`);
});
