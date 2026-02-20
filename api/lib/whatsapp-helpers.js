// api/lib/whatsapp-helpers.js
// WhatsApp message formatting and sending helpers

import twilio from "twilio";

let _twilioClient;
function getTwilioClient() {
  if (!_twilioClient) {
    _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient;
}

export async function sendWhatsAppMessage(to, body) {
  return getTwilioClient().messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body,
  });
}

export function formatReply(parsed, dashboardUrl) {
  const txns = parsed.transactions || [];
  if (!txns.length) {
    return "I couldn't find any transactions in that image. Please send a clearer photo of your ledger page.";
  }

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
  msg += `_Send another photo or ask me a question about your expenses._`;

  return msg;
}
