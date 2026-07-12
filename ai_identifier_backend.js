/**
 * ============================================================
 * EcoSort AI — Backend AI Identifier Service
 * ============================================================
 * This is the server-side version of the classification logic
 * currently embedded directly in the demo HTML file.
 *
 * WHY YOU NEED THIS FOR A REAL DEPLOYMENT:
 * The HTML demo calls Anthropic's API directly from the browser.
 * That works fine inside Claude's own preview sandbox (which
 * handles the credential automatically), but if you deploy the
 * site anywhere else (Netlify, your own server, etc.), calling
 * a paid AI API straight from client-side JavaScript is NOT
 * secure — anyone could open dev tools, find the request, and
 * make unlimited calls on your bill.
 *
 * This backend fixes that: the browser sends the photo to YOUR
 * server, your server holds the secret API key, and only your
 * server talks to Anthropic. The frontend never sees the key.
 *
 * ============================================================
 * SETUP
 * ============================================================
 * 1. Install dependencies:
 *      npm init -y
 *      npm install express cors dotenv
 *
 * 2. Get an API key from https://console.anthropic.com/
 *    Create a file named ".env" in the same folder as this file:
 *      ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
 *
 * 3. Run the server:
 *      node ai_identifier_backend.js
 *
 * 4. Test it:
 *      curl -X POST http://localhost:3000/api/classify \
 *        -H "Content-Type: application/json" \
 *        -d '{"image_base64": "<base64 jpeg data here>"}'
 *
 * 5. In your frontend (EcoSort_AI_Demo.html), replace the direct
 *    fetch to https://api.anthropic.com/v1/messages with a fetch
 *    to YOUR backend instead, e.g.:
 *
 *      const response = await fetch("https://your-server.com/api/classify", {
 *        method: "POST",
 *        headers: { "Content-Type": "application/json" },
 *        body: JSON.stringify({ image_base64: base64 })
 *      });
 *      const result = await response.json();
 *      // result = { item, category, condition, estimated_weight_kg, confidence }
 *
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error("❌ Missing ANTHROPIC_API_KEY. Create a .env file — see setup instructions at the top of this file.");
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
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: media_type || "image/jpeg",
                data: image_base64,
              },
            },
            { type: "text", text: CLASSIFIER_PROMPT },
          ],
        }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      return res.status(502).json({ error: `AI service returned status ${anthropicResponse.status}` });
    }

    const data = await anthropicResponse.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message || "AI service returned an error" });
    }

    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "AI response contained no text content" });
    }

    // Robust JSON extraction — survives the model adding stray text around the JSON
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "Could not find JSON in AI response", raw: textBlock.text.slice(0, 200) });
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
