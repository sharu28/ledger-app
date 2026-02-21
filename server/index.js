// server/index.js
// Express backend for local development
// Uses shared modules from lib/

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import { callGeminiJSON, fetchTwilioImage } from "../lib/gemini.js";
import { getOrCreateUser, storeTransactions, createPage, getSupabase } from "../lib/storage.js";
import { sendWhatsAppMessage, sendWhatsAppMedia, formatReply } from "../lib/whatsapp-helpers.js";
import { DIGITIZATION_PROMPT } from "../lib/prompts/digitization.js";
import { getCategorizationPrompt } from "../lib/prompts/categorization.js";
import { getAssessmentPrompt } from "../lib/prompts/assessment.js";
import { handleQuery } from "../lib/query-engine.js";
import { uploadToR2 } from "../lib/r2.js";
import { generateDigitizedPDF } from "../lib/pdf-generator.js";
import { createPendingExtraction, getPendingExtraction, resolvePendingExtraction } from "../lib/conversation-state.js";
import { classifyConfirmation } from "../lib/intent-classifier.js";

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const COMMANDS = ["hi", "hello", "help", "start", "summary", "report", "dashboard"];

function isCommand(body) {
  return COMMANDS.includes(body);
}

// ── WhatsApp Webhook ─────────────────────────────────────────────

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const from = req.body.From;
    const numMedia = parseInt(req.body.NumMedia || "0");
    const body = (req.body.Body || "").trim().toLowerCase();
    const phone = from.replace("whatsapp:", "");

    const user = await getOrCreateUser(phone);
    let reply;

    if (numMedia > 0) {
      // ── Image received → digitize + PDF ──
      await sendWhatsAppMessage(from, "📷 Got it! Digitizing your page... ⏳");

      // Expire any existing pending extraction
      const existingPending = await getPendingExtraction(user.id);
      if (existingPending) {
        await resolvePendingExtraction(existingPending.id, "expired");
      }

      const result = await handleImage(req.body.MediaUrl0, user, phone);

      if (result.error) {
        reply = result.error;
      } else if (result.pdfUrl) {
        await sendWhatsAppMedia(from, result.followUpMessage, result.pdfUrl);
        return res.status(200).send("<Response></Response>");
      } else {
        reply = result.followUpMessage;
      }

    } else {
      // ── Text message → check for pending extraction first ──
      const pending = await getPendingExtraction(user.id);

      if (pending && !isCommand(body)) {
        const intent = classifyConfirmation(body);

        if (intent === "yes") {
          await sendWhatsAppMessage(from, "✅ Great! Categorizing your entries... ⏳");
          reply = await handleConfirmation(pending, user, phone);

        } else if (intent === "no") {
          await resolvePendingExtraction(pending.id, "declined");
          reply = "👍 No problem! Your digitized page is saved. Send another photo anytime or ask me a question about your expenses.";

        } else {
          reply = `I'm not sure what you mean. Reply *yes* to categorize the ${pending.raw_extraction?.rows?.length || ""} entries I digitized, or *no* to skip.`;
        }

      } else if (isCommand(body)) {
        reply = await handleCommand(body, user, phone);

      } else {
        await sendWhatsAppMessage(from, "🔍 Looking that up...");
        const result = await handleQuery(body, user.id);
        reply = result.answer;
      }
    }

    await sendWhatsAppMessage(from, reply);
    res.status(200).send("<Response></Response>");

  } catch (err) {
    console.error("Webhook error:", err);
    try {
      await sendWhatsAppMessage(req.body.From, `❌ Error: ${err.message?.substring(0, 200)}`);
    } catch {}
    res.status(200).send("<Response></Response>");
  }
});

// ── Image handling (Step 1) ─────────────────────────────────────

async function handleImage(mediaUrl, user, phone) {
  const { base64, contentType } = await fetchTwilioImage(mediaUrl);
  console.log("[digitize] Image fetched:", Math.round(base64.length / 1024), "KB");

  const digitized = await callGeminiJSON(DIGITIZATION_PROMPT, {
    imageBase64: base64,
    imageMimeType: contentType,
  });

  if (digitized.error) {
    return { error: `⚠️ ${digitized.error}` };
  }

  const rowCount = digitized.rows?.length || 0;
  if (!rowCount) {
    return { error: "I couldn't find any entries in that image. Please send a clearer photo." };
  }

  const page = await createPage(user.id, {
    pageNotes: digitized.page_notes,
    currency: digitized.currency_detected,
    confidence: digitized.confidence,
    transactionCount: rowCount,
  });

  // Upload image to R2
  const imageBuffer = Buffer.from(base64, "base64");
  const ext = contentType === "image/png" ? "png" : "jpg";
  const imageKey = `${user.id}/images/${page.id}.${ext}`;
  let imageUrl;
  try {
    imageUrl = await uploadToR2(imageKey, imageBuffer, contentType);
    await getSupabase().from("pages").update({ image_url: imageUrl }).eq("id", page.id);
  } catch (err) {
    console.warn("[r2] Image upload failed (continuing):", err.message);
  }

  // Generate and upload PDF
  const pdfBuffer = await generateDigitizedPDF(digitized);
  const pdfKey = `${user.id}/pdfs/${page.id}.pdf`;
  let pdfUrl;
  try {
    pdfUrl = await uploadToR2(pdfKey, pdfBuffer, "application/pdf");
    await getSupabase().from("pages").update({ pdf_url: pdfUrl }).eq("id", page.id);
  } catch (err) {
    console.warn("[r2] PDF upload failed (continuing):", err.message);
  }

  // Get AI assessment
  let followUpMessage;
  try {
    const assessment = await callGeminiJSON(getAssessmentPrompt(digitized));
    followUpMessage = assessment.follow_up_message;
  } catch (err) {
    console.warn("[assess] Assessment failed, using default:", err.message);
  }

  if (!followUpMessage) {
    followUpMessage = `I've digitized *${rowCount} entries* from your page. Want me to categorize them and add to your ledger? Reply *yes* or *no*.`;
  }

  await createPendingExtraction(user.id, page.id, digitized, {
    contentType: digitized.content_assessment,
    followUpQuestion: followUpMessage,
    imageUrl,
    pdfUrl,
  });

  return { pdfUrl, followUpMessage };
}

// ── Confirmation handling (Step 2) ──────────────────────────────

async function handleConfirmation(pending, user, phone) {
  const raw = pending.raw_extraction;

  const categorized = await callGeminiJSON(
    getCategorizationPrompt(raw.rows, raw.currency_detected, raw.page_notes)
  );

  if (!categorized.transactions?.length) {
    return "Something went wrong during categorization. Please try sending the photo again.";
  }

  await storeTransactions(user.id, categorized, { pageId: pending.page_id });
  await resolvePendingExtraction(pending.id, "confirmed");

  const dashboardUrl = `${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
  return formatReply(categorized, dashboardUrl);
}

// ── Command handling ────────────────────────────────────────────

async function handleCommand(body, user, phone) {
  if (["hi", "hello", "help", "start"].includes(body)) {
    return (
      `📒 *Ledger Digitizer*\n\n` +
      `Send me a photo of your ledger page and I'll:\n` +
      `✅ Digitize it into a clean table\n` +
      `✅ Send you a PDF of the entries\n` +
      `✅ Categorize & summarize on your request\n\n` +
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
    return `📋 View your full dashboard: ${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
  }

  return null;
}

// ── API Routes (for web dashboard) ───────────────────────────────

app.get("/api/user/:phone", async (req, res) => {
  const supabase = getSupabase();
  const { data: user } = await supabase
    .from("users").select("*").eq("phone", req.params.phone).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

app.get("/api/transactions", async (req, res) => {
  const supabase = getSupabase();
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: "Phone parameter required" });
  const { data: user } = await supabase
    .from("users").select("id").eq("phone", phone).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const { month, category } = req.query;
  let query = supabase.from("transactions").select("*")
    .eq("user_id", user.id).order("created_at", { ascending: false });

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

app.get("/api/summary", async (req, res) => {
  const supabase = getSupabase();
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: "Phone parameter required" });
  const { data: user } = await supabase
    .from("users").select("id").eq("phone", phone).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const { data: txns } = await supabase.from("transactions").select("*")
    .eq("user_id", user.id).gte("created_at", monthStart.toISOString());

  const { data: allTxns } = await supabase.from("transactions")
    .select("amount, type, category, created_at")
    .eq("user_id", user.id).order("created_at", { ascending: true });

  const { data: pages } = await supabase.from("pages").select("id").eq("user_id", user.id);

  res.json({
    thisMonth: txns || [],
    allTransactions: allTxns || [],
    totalPages: pages?.length || 0,
  });
});

app.post("/api/query", async (req, res) => {
  const supabase = getSupabase();
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: "Phone parameter required" });
  const { data: user } = await supabase
    .from("users").select("id").eq("phone", phone).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "Question is required" });

  try {
    const result = await handleQuery(question, user.id);
    res.json(result);
  } catch (err) {
    console.error("Query error:", err);
    res.status(500).json({ error: "Failed to process query" });
  }
});

// ── Health check ─────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "ok", service: "ledger-digitizer" }));

// ── Start ────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Ledger Digitizer server running on port ${PORT}`);
  console.log(`📱 WhatsApp webhook: POST /webhook/whatsapp`);
  console.log(`📊 Dashboard API: /api/*`);
  console.log(`💬 Query API: POST /api/query?phone=...`);
});
