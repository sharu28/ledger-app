// api/webhook/whatsapp.js - Vercel serverless WhatsApp webhook

import { callGeminiJSON, fetchTwilioImage } from "../lib/gemini.js";
import { getOrCreateUser, storeTransactions, getSupabase } from "../lib/storage.js";
import { sendWhatsAppMessage, formatReply } from "../lib/whatsapp-helpers.js";
import { EXTRACTION_PROMPT } from "../lib/prompts/extraction.js";
import { handleQuery } from "../lib/query-engine.js";

const COMMANDS = ["hi", "hello", "help", "start", "summary", "report", "dashboard"];

function isCommand(body) {
  return COMMANDS.includes(body);
}

async function handleCommand(body, user, phone) {
  if (["hi", "hello", "help", "start"].includes(body)) {
    return (
      `📒 *Ledger Digitizer*\n\n` +
      `Send me a photo of your ledger page and I'll:\n` +
      `✅ Extract all transactions\n` +
      `✅ Categorize each expense\n` +
      `✅ Give you a summary\n\n` +
      `*Commands:*\n` +
      `📊 "summary" — this month's overview\n` +
      `📋 "report" — full dashboard link\n` +
      `❓ "help" — show this message\n\n` +
      `You can also ask me questions like:\n` +
      `_"How much did I spend on meals?"_\n` +
      `_"What were my top expenses this month?"_\n\n` +
      `_Just snap a photo of your book and send it!_`
    );
  }

  if (body === "summary") {
    const supabase = getSupabase();
    const { data: txns } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

    if (!txns?.length) {
      return "No transactions this month yet. Send a ledger photo to get started!";
    }

    const exp = txns.filter((t) => t.type === "debit").reduce((s, t) => s + Number(t.amount), 0);
    const inc = txns.filter((t) => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
    return (
      `📊 *This month's summary*\n\n` +
      `${txns.length} transactions\n` +
      `💸 Expenses: ${exp.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
      `💰 Income: ${inc.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
      `${inc - exp >= 0 ? "📈" : "📉"} Net: ${(inc - exp).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n` +
      `Full details: ${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`
    );
  }

  if (body === "report" || body === "dashboard") {
    return `📋 View your full dashboard:\n${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
  }

  return null;
}

async function handleImage(mediaUrl, user, phone) {
  const { base64, contentType } = await fetchTwilioImage(mediaUrl);
  console.log("[extract] Image fetched:", Math.round(base64.length / 1024), "KB");

  const parsed = await callGeminiJSON(EXTRACTION_PROMPT, {
    imageBase64: base64,
    imageMimeType: contentType,
  });

  if (parsed.error) {
    return `⚠️ ${parsed.error}\n\nPlease send a clear photo of a ledger page, receipt book, or expense register.`;
  }

  await storeTransactions(user.id, parsed);

  const dashboardUrl = `${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
  return formatReply(parsed, dashboardUrl);
}

// ── Main Handler ─────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const from = req.body.From;
    const numMedia = parseInt(req.body.NumMedia || "0");
    const body = (req.body.Body || "").trim().toLowerCase();
    const phone = from.replace("whatsapp:", "");

    const user = await getOrCreateUser(phone);
    let reply;

    if (numMedia > 0) {
      // Image → extraction pipeline
      await sendWhatsAppMessage(from, "📷 Got it! Extracting transactions... ⏳");
      reply = await handleImage(req.body.MediaUrl0, user, phone);

    } else if (isCommand(body)) {
      // Known command
      reply = await handleCommand(body, user, phone);

    } else {
      // Natural language query
      await sendWhatsAppMessage(from, "🔍 Looking that up...");
      const result = await handleQuery(body, user.id);
      reply = result.answer;
    }

    await sendWhatsAppMessage(from, reply);

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");

  } catch (err) {
    console.error("Webhook error:", err.message);
    console.error("Stack:", err.stack);

    try {
      await sendWhatsAppMessage(req.body.From, `❌ Error: ${err.message?.substring(0, 200)}`);
    } catch (e) {
      console.error("Failed to send error message:", e.message);
    }

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send("<Response></Response>");
  }
}
