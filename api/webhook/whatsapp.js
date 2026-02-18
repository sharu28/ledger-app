// api/webhook/whatsapp.js
// Vercel Serverless Function - WhatsApp Webhook Handler

import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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
- Extract ALL rows
- If not a financial document, return {"error": "not a financial document"}`;

async function extractWithGemini(imageUrl) {
  const imageResponse = await fetch(imageUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
    },
  });
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: EXTRACTION_PROMPT + "\n\nExtract all transactions. Return only JSON." },
            { inline_data: { mime_type: contentType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
    }
  );
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function getOrCreateUser(phone) {
  const { data: existing } = await supabase.from("users").select("*").eq("phone", phone).single();
  if (existing) {
    await supabase.from("users").update({ last_active: new Date().toISOString() }).eq("id", existing.id);
    return existing;
  }
  const { data: newUser } = await supabase.from("users").insert({ phone }).select().single();
  return newUser;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) ? d.toISOString().split("T")[0] : null;
}

function formatReply(parsed, dashboardUrl) {
  const txns = parsed.transactions || [];
  if (!txns.length) return "I couldn't find any transactions in that image. Please send a clearer photo.";
  const debits = txns.filter((t) => t.type === "debit");
  const credits = txns.filter((t) => t.type === "credit");
  const totalExp = debits.reduce((s, t) => s + t.amount, 0);
  const totalInc = credits.reduce((s, t) => s + t.amount, 0);
  const cur = parsed.currency_detected || "";

  let msg = `✅ *${txns.length} transactions extracted*\n📊 Confidence: ${parsed.confidence}\n\n`;
  if (totalExp > 0) msg += `💸 Expenses: ${cur} ${totalExp.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
  if (totalInc > 0) msg += `💰 Income: ${cur} ${totalInc.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
  const net = totalInc - totalExp;
  msg += `${net >= 0 ? "📈" : "📉"} Net: ${cur} ${net.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;

  const catTotals = {};
  debits.forEach((t) => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (topCats.length) {
    msg += `*Top expenses:*\n`;
    topCats.forEach(([cat, amt]) => { msg += `  • ${cat}: ${cur} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`; });
    msg += "\n";
  }

  msg += `📋 Full dashboard:\n${dashboardUrl}\n\n_Send another photo to add more pages._`;
  return msg;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const from = req.body.From;
    const numMedia = parseInt(req.body.NumMedia || "0");
    const body = (req.body.Body || "").trim().toLowerCase();
    const phone = from.replace("whatsapp:", "");
    const user = await getOrCreateUser(phone);

    // Text commands
    if (numMedia === 0) {
      let reply;
      if (["help", "start", "hi", "hello"].includes(body)) {
        reply = `📒 *Ledger Digitizer*\n\nSend me a photo of your ledger page and I'll:\n✅ Extract all transactions\n✅ Categorize each expense\n✅ Give you a summary\n\n*Commands:*\n📊 "summary" — this month\n📋 "report" — dashboard link\n\n_Just snap & send!_`;
      } else if (body === "summary") {
        const { data: txns } = await supabase.from("transactions").select("*").eq("user_id", user.id)
          .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
        if (!txns?.length) {
          reply = "No transactions this month yet. Send a ledger photo to get started!";
        } else {
          const exp = txns.filter((t) => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0);
          const inc = txns.filter((t) => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
          reply = `📊 *This month*\n${txns.length} txns\n💸 Expenses: ${exp.toLocaleString()}\n💰 Income: ${inc.toLocaleString()}\n${inc - exp >= 0 ? "📈" : "📉"} Net: ${(inc - exp).toLocaleString()}\n\nFull details: ${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
        }
      } else if (["report", "dashboard"].includes(body)) {
        reply = `📋 Dashboard:\n${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
      } else {
        reply = `📷 Send me a photo of your ledger page!\nType "help" for commands.`;
      }
      await twilioClient.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: from, body: reply });
      return res.status(200).send("<Response></Response>");
    }

    // Image processing
    await twilioClient.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: from, body: "📷 Got it! Extracting transactions... ⏳" });

    const parsed = await extractWithGemini(req.body.MediaUrl0);

    if (parsed.error) {
      await twilioClient.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: from, body: `⚠️ ${parsed.error}\nPlease send a clear photo of a ledger page.` });
      return res.status(200).send("<Response></Response>");
    }

    // Store
    const { data: page } = await supabase.from("pages").insert({
      user_id: user.id, page_notes: parsed.page_notes,
      currency_detected: parsed.currency_detected, confidence: parsed.confidence,
      transaction_count: parsed.transactions?.length || 0,
    }).select().single();

    if (parsed.transactions?.length) {
      await supabase.from("transactions").insert(
        parsed.transactions.map((t) => ({
          user_id: user.id, page_id: page.id, date: t.date,
          parsed_date: parseDate(t.date), description: t.description,
          amount: t.amount, type: t.type, category: t.category,
          is_unclear: t.description?.includes("[unclear]") || false,
        }))
      );
    }

    const dashboardUrl = `${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
    await twilioClient.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: from, body: formatReply(parsed, dashboardUrl) });

    res.status(200).send("<Response></Response>");
  } catch (err) {
    console.error("Webhook error:", err);
    try {
      await twilioClient.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: req.body.From, body: "❌ Something went wrong. Please try again." });
    } catch {}
    res.status(200).send("<Response></Response>");
  }
}
