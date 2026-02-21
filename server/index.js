// server/index.js
// Express backend for local development
// Uses shared modules from api/lib/

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import { callGeminiJSON, fetchTwilioImage } from "../api/lib/gemini.js";
import { getOrCreateUser, storeTransactions, getSupabase } from "../api/lib/storage.js";
import { sendWhatsAppMessage, formatReply } from "../api/lib/whatsapp-helpers.js";
import { EXTRACTION_PROMPT } from "../api/lib/prompts/extraction.js";
import { handleQuery } from "../api/lib/query-engine.js";

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const COMMANDS = ["hi", "hello", "help", "start", "summary", "report", "dashboard"];

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
      // Image → extraction pipeline
      await sendWhatsAppMessage(from, "📷 Got your ledger photo! Extracting transactions... ⏳");

      const { base64, contentType } = await fetchTwilioImage(req.body.MediaUrl0);
      const parsed = await callGeminiJSON(EXTRACTION_PROMPT, {
        imageBase64: base64,
        imageMimeType: contentType,
      });

      if (parsed.error) {
        reply = `⚠️ ${parsed.error}\n\nPlease send a clear photo of a ledger page, receipt book, or expense register.`;
      } else {
        await storeTransactions(user.id, parsed);
        const dashboardUrl = `${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
        reply = formatReply(parsed, dashboardUrl);
      }

    } else if (COMMANDS.includes(body)) {
      // Known commands
      if (["hi", "hello", "help", "start"].includes(body)) {
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
          `You can also ask me questions like:\n` +
          `_"How much did I spend on meals?"_\n` +
          `_"What were my top expenses this month?"_\n\n` +
          `_Just snap a photo of your book and send it!_`;
      } else if (body === "summary") {
        const supabase = getSupabase();
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
      }

    } else {
      // Natural language query
      await sendWhatsAppMessage(from, "🔍 Looking that up...");
      const result = await handleQuery(body, user.id);
      reply = result.answer;
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
  const phone = req.query.phone || req.params.phone;
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
  const phone = req.query.phone || req.params.phone;
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

// Query endpoint for dashboard chat bar
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
  console.log(`💬 Query API: POST /api/query/:phone`);
});
