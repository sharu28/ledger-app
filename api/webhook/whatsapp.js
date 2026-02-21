// api/webhook/whatsapp.js - Vercel serverless WhatsApp webhook
// Two-step flow: digitize → confirm → categorize

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

const COMMANDS = ["hi", "hello", "help", "start", "summary", "report", "dashboard"];

function isCommand(body) {
  return COMMANDS.includes(body);
}

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

// ── Step 1: Digitize image → PDF → pending ──────────────────────

async function handleImage(mediaUrl, user, phone) {
  // 1. Fetch image from Twilio
  const { base64, contentType } = await fetchTwilioImage(mediaUrl);
  console.log("[digitize] Image fetched:", Math.round(base64.length / 1024), "KB");

  // 2. Digitize with Gemini (pure OCR, no categories)
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

  // 3. Create page record (to get ID for R2 paths)
  const page = await createPage(user.id, {
    pageNotes: digitized.page_notes,
    currency: digitized.currency_detected,
    confidence: digitized.confidence,
    transactionCount: rowCount,
  });

  // 4. Upload image to R2
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

  // 5. Generate PDF
  const pdfBuffer = await generateDigitizedPDF(digitized);
  const pdfKey = `${user.id}/pdfs/${page.id}.pdf`;
  let pdfUrl;
  try {
    pdfUrl = await uploadToR2(pdfKey, pdfBuffer, "application/pdf");
    await getSupabase().from("pages").update({ pdf_url: pdfUrl }).eq("id", page.id);
  } catch (err) {
    console.warn("[r2] PDF upload failed (continuing):", err.message);
  }

  // 6. Get AI assessment and follow-up question
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

  // 7. Create pending extraction
  await createPendingExtraction(user.id, page.id, digitized, {
    contentType: digitized.content_assessment,
    followUpQuestion: followUpMessage,
    imageUrl,
    pdfUrl,
  });

  return { pdfUrl, followUpMessage };
}

// ── Step 2: Handle confirmation → categorize ────────────────────

async function handleConfirmation(pending, user, phone) {
  const raw = pending.raw_extraction;

  // Categorize from text (no image needed)
  const categorized = await callGeminiJSON(
    getCategorizationPrompt(raw.rows, raw.currency_detected, raw.page_notes)
  );

  if (!categorized.transactions?.length) {
    return "Something went wrong during categorization. Please try sending the photo again.";
  }

  // Store categorized transactions using the existing page
  await storeTransactions(user.id, categorized, { pageId: pending.page_id });

  // Mark pending as confirmed
  await resolvePendingExtraction(pending.id, "confirmed");

  // Format reply with dashboard link
  const dashboardUrl = `${process.env.APP_URL}/dashboard?phone=${encodeURIComponent(phone)}`;
  return formatReply(categorized, dashboardUrl);
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
      // ── Image received → digitize + PDF ──
      await sendWhatsAppMessage(from, "📷 Got it! Digitizing your page... ⏳");

      // Expire any existing pending extraction for this user
      const existingPending = await getPendingExtraction(user.id);
      if (existingPending) {
        await resolvePendingExtraction(existingPending.id, "expired");
      }

      const result = await handleImage(req.body.MediaUrl0, user, phone);

      if (result.error) {
        reply = result.error;
      } else if (result.pdfUrl) {
        // Send PDF with follow-up question
        await sendWhatsAppMedia(from, result.followUpMessage, result.pdfUrl);
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send("<Response></Response>");
      } else {
        // R2 upload failed — send text-only follow-up
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
        // Natural language query
        await sendWhatsAppMessage(from, "🔍 Looking that up...");
        const result = await handleQuery(body, user.id);
        reply = result.answer;
      }
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
