/**
 * ============================================================
 * EcoSort AI — Backend AI Identifier Service (Google Gemini edition)
 * ============================================================
 * This is the server-side version of the classification logic
 * currently embedded directly in the demo HTML file.
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
 *      npm install express cors dotenv
 *
 * 2. Get a FREE API key (no credit card needed):
 *      Go to https://aistudio.google.com/apikey
 *      Sign in with any Google account → "Create API key"
 *    Create a file named ".env" in the same folder as this file:
 *      GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * 3. Run the server:
 *      node ai_identifier_backend.js
 *
 * 4. Test it:
 *      curl -X POST http://localhost:3000/api/classify \
 *        -H "Content-Type: application/json" \
 *        -d '{"image_base64": "<base64 jpeg data here>"}'
 *
 * 5. In your frontend (EcoSort_AI_Demo.html), the BACKEND_URL
 *    constant should point at YOUR deployed backend's
 *    /api/classify endpoint — no other frontend changes needed,
 *    since this returns the exact same JSON shape as before:
 *      { item, category, condition, estimated_weight_kg, confidence }
 *
 * FREE TIER LIMITS (subject to change by Google):
 *    Roughly 10-15 requests/minute and ~1,000+ requests/day on
 *    Gemini Flash / Flash-Lite — comfortably enough for a
 *    hackathon demo or several days of testing.
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey and create a .env file — see setup instructions at the top of this file.");
  process.exit(1);
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

  try {
    const geminiModel = "gemini-2.5-flash"; // free-tier vision-capable model
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiUrl, {
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
          maxOutputTokens: 300,
          temperature: 0.2,
        },
      }),
    });

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
      return res.status(502).json({ error: "Could not find JSON in AI response", raw: textPart.text.slice(0, 200) });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(502).json({ error: "AI response was not valid JSON", raw: jsonMatch[0].slice(0, 200) });
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

// Simple health check
app.get('/api/health', (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`✅ EcoSort AI identifier backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/classify  — classify a waste item photo`);
  console.log(`   GET  /api/health    — health check`);
});
