// server/index.js
// WhatsApp Bot Backend for Ledger Digitizer
// Handles: Twilio webhook → Gemini Vision → Supabase → WhatsApp reply

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true })); // Twilio sends form-encoded
app.use(express.json());

// ── Clients ──────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ── Constants ────────────────────────────────────────────────────

const CATEGORIES = [
  "Revenue / Sales", "Rent / Lease", "Salaries / Wages", "Utilities",
  "Office Supplies", "Transport / Fuel", "Food / Meals", "Inventory / Stock",
  "Marketing / Ads", "Repairs / Maintenance", "Insurance", "Taxes / Fees",
  "Loan / Interest", "Miscellaneous",
];

const EXTRACTION_PROMPT = `You are a bookkeeping assistant that extracts transactions from photos of handwritten or printed ledger pages.

Return ONLY valid JSON (no markdown, no backticks) in this format:
{
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "what it's for", "amount": 1234.56, "type": "debit or credit", "category": "category" }
  ],
  "currency_detected": "LKR/USD/EUR/unknown",
  "page_notes": "context from the page",
  "confidence": "high/medium/low"
}

Categories: ${CATEGORIES.join(", ")}

Rules:
- Best-guess unclear numbers, mark with [unclear] in description
- Use most recent visible date if a row has none
- Extract ALL rows including partial ones
- If not a financial document, return {"error": "not a financial document"}`;

// ── Helper: Call Gemini Vision ───────────────────────────────────

async function extractWithGemini(imageUrl) {
  // Fetch the image from Twilio's URL (requires auth)
  const imageResponse = await fetch(imageUrl, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
    },
  });
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  // Call Gemini
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: EXTRACTION_PROMPT + "\n\nExtract all transactions. Return only JSON." },
              { inline_data: { mime_type: contentType, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
    }
  );

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── Helper: Get or create user ───────────────────────────────────

async function getOrCreateUser(phone) {
  const { data: existing } = await supabase
    .from("users")
    .select("*")
    .eq("phone", phone)
    .single();

  if (existing) {
    await supabase
      .from("users")
      .update({ last_active: new Date().toISOString() })
      .eq("id", existing.id);
    return existing;
  }

  const { data: newUser } = await supabase
    .from("users")
    .insert({ phone })
    .select()
    .single();

  return newUser;
}

// ── Helper: Store transactions ───────────────────────────────────

async function storeTransactions(userId, parsed) {
  // Create page record
  const { data: page } = await supabase
    .from("pages")
    .insert({
      user_id: userId,
      page_notes: parsed.page_notes,
      currency_detected: parsed.currency_detected,
      confidence: parsed.confidence,
      transaction_count: parsed.transactions?.length || 0,
    })
    .select()
    .single();

  if (!parsed.transactions?.length) return { page, transactions: [] };

  // Insert transactions
  const rows = parsed.transactions.map((t) => ({
    user_id: userId,
    page_id: page.id,
    date: t.date,
    parsed_date: parseDate(t.date),
    description: t.description,
    amount: t.amount,
    type: t.type,
    category: t.category,
    is_unclear: t.description?.includes("[unclear]") || false,
  }));

  const { data: txns } = await supabase
    .from("transactions")
    .insert(rows)
    .select();

  return { page, transactions: txns };
}

function parseDate(dateStr) {
  // Try to parse various date formats into YYYY-MM-DD
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

// ── Helper: Format WhatsApp reply ────────────────────────────────

function formatReply(parsed, dashboardUrl) {
  const txns = parsed.transactions || [];
  if (!txns.length) return "I couldn't find any transactions in that image. Please send a clearer photo of your ledger page.";

  const debits = txns.filter((t) => t.type === "debit");
  const credits = txns.filter((t) => t.type === "credit");
  const totalExp = debits.reduce((s, t) => s + t.amount, 0);
  const totalInc = credits.reduce((s, t) => s + t.amount, 0);
  const currency = parsed.currency_detected || "";

  let msg = `✅ *${txns.length} transactions extracted*\n`;
  msg += `📊 Confidence: ${parsed.confidence}\n\n`;

  if (totalExp > 0) msg += `💸 Expenses: ${currency} ${totalExp.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
  if (totalInc > 0) msg += `💰 Income: ${currency} ${totalInc.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;

  const net = totalInc - totalExp;
  msg += `${net >= 0 ? "📈" : "📉"} Net: ${currency} ${net.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;

  // Top categories
  const catTotals = {};
  debits.forEach((t) => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);

  if (topCats.length) {
    msg += `*Top expenses:*\n`;
    topCats.forEach(([cat, amt]) => {
      msg += `  • ${cat}: ${currency} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    });
    msg += "\n";
  }

  msg += `📋 View full details & charts:\n${dashboardUrl}\n\n`;
  msg += `_Send another photo to add more pages._`;

  return msg;
}

// ── WhatsApp Webhook (Twilio) ────────────────────────────────────

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const from = req.body.From; // "whatsapp:+94771234567"
    const numMedia = parseInt(req.body.NumMedia || "0");
    const body = (req.body.Body || "").trim().toLowerCase();
    const phone = from.replace("whatsapp:", "");

    // Get or create user
    const user = await getOrCreateUser(phone);

    // ── Handle text commands ──
    if (numMedia === 0) {
      let reply;

      if (body === "help" || body === "start" || body === "hi" || body === "hello") {
        reply =
          `📒 *Ledger Digitizer*\n\n` +
          `Send me a photo of your ledger page and I'll:\n` +
          `✅ Extract all transactions\n` +
          `✅ Categorize each expense\n` +
          `✅ Give you a summary\n\n` +
          `*Commands:*\n` +
          `📊 "summary" — this month's overview\n` +
          `📋 "report" — full dashboard link\n` +
          `❓ "help" — show this message\n\n` +
          `_Just snap a photo of your book and send it!_`;
      } else if (body === "summary") {
        const { data: txns } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", user.id)
          .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

        if (!txns?.length) {
          reply = "No transactions this month yet. Send a ledger photo to get started!";
        } else {
          const exp = txns.filter((t) => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0);
          const inc = txns.filter((t) => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
          reply =
            `📊 *This month's summary*\n\n` +
            `${txns.length} transactions\n` +
            `💸 Expenses: ${exp.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
            `💰 Income: ${inc.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
            `${inc - exp >= 0 ? "📈" : "📉"} Net: ${(inc - exp).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n` +
            `Full details: ${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
        }
      } else if (body === "report" || body === "dashboard") {
        reply = `📋 View your full dashboard:\n${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
      } else {
        reply = `I work best with photos! 📷\n\nSend me a photo of your ledger page, or type "help" for commands.`;
      }

      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: from,
        body: reply,
      });

      return res.status(200).send("<Response></Response>");
    }

    // ── Handle image ──
    const mediaUrl = req.body.MediaUrl0;

    // Send "processing" message
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: "📷 Got your ledger photo! Extracting transactions... ⏳",
    });

    // Process with Gemini
    const parsed = await extractWithGemini(mediaUrl);

    if (parsed.error) {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: from,
        body: `⚠️ ${parsed.error}\n\nPlease send a clear photo of a ledger page, receipt book, or expense register.`,
      });
      return res.status(200).send("<Response></Response>");
    }

    // Store in Supabase
    await storeTransactions(user.id, parsed);

    // Send summary reply
    const dashboardUrl = `${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
    const reply = formatReply(parsed, dashboardUrl);

    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: reply,
    });

    res.status(200).send("<Response></Response>");
  } catch (err) {
    console.error("Webhook error:", err);

    // Try to notify user of error
    try {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: req.body.From,
        body: "❌ Sorry, something went wrong processing your image. Please try again with a clearer photo.",
      });
    } catch {}

    res.status(200).send("<Response></Response>");
  }
});

// ── API Routes (for web dashboard) ───────────────────────────────

app.get("/api/user/:phone", async (req, res) => {
  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("phone", req.params.phone)
    .single();

  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

app.get("/api/transactions/:phone", async (req, res) => {
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("phone", req.params.phone)
    .single();

  if (!user) return res.status(404).json({ error: "User not found" });

  const { month, category } = req.query;

  let query = supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (month) {
    const start = new Date(month + "-01");
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  }

  if (category) {
    query = query.eq("category", category);
  }

  const { data } = await query.limit(500);
  res.json(data || []);
});

app.get("/api/summary/:phone", async (req, res) => {
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("phone", req.params.phone)
    .single();

  if (!user) return res.status(404).json({ error: "User not found" });

  // This month's data
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const { data: txns } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .gte("created_at", monthStart.toISOString());

  const { data: allTxns } = await supabase
    .from("transactions")
    .select("amount, type, category, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const { data: pages } = await supabase
    .from("pages")
    .select("id")
    .eq("user_id", user.id);

  res.json({
    thisMonth: txns || [],
    allTransactions: allTxns || [],
    totalPages: pages?.length || 0,
  });
});

// ── Health check ─────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "ok", service: "ledger-digitizer" }));

// ── Start ────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Ledger Digitizer server running on port ${PORT}`);
  console.log(`📱 WhatsApp webhook: POST /webhook/whatsapp`);
  console.log(`📊 Dashboard API: /api/*`);
});
