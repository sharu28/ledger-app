// test/test-gemini.js
// Usage: node test/test-gemini.js test/sample1.jpg
//
// Tests the extraction pipeline with a local image using the same
// prompt and Gemini call as production.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

import { callGeminiJSON } from "../api/lib/gemini.js";
import { EXTRACTION_PROMPT, CATEGORIES } from "../api/lib/prompts/extraction.js";

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Usage: node test/test-gemini.js <image-path>");
    console.error("Example: node test/test-gemini.js test/sample1.jpg");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env");
    process.exit(1);
  }

  const fullPath = path.resolve(imagePath);
  if (!fs.existsSync(fullPath)) {
    console.error("File not found:", fullPath);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(fullPath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(fullPath).toLowerCase();
  const mimeType = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[ext] || "image/jpeg";

  console.log(`Image: ${fullPath} (${Math.round(base64.length / 1024)} KB, ${mimeType})`);
  console.log("Calling Gemini API...\n");

  const parsed = await callGeminiJSON(EXTRACTION_PROMPT, {
    imageBase64: base64,
    imageMimeType: mimeType,
  });

  console.log("=== GEMINI RESULT ===\n");
  console.log(JSON.stringify(parsed, null, 2));

  const txns = parsed.transactions || [];
  console.log(`\n=== SUMMARY ===`);
  console.log(`Transactions: ${txns.length}`);
  console.log(`Currency: ${parsed.currency_detected}`);
  console.log(`Confidence: ${parsed.confidence}`);

  const debits = txns.filter(t => t.type === "debit");
  const credits = txns.filter(t => t.type === "credit");
  console.log(`Expenses: ${debits.reduce((s, t) => s + t.amount, 0).toLocaleString()}`);
  console.log(`Income: ${credits.reduce((s, t) => s + t.amount, 0).toLocaleString()}`);

  console.log(`\nCategories used:`);
  const cats = {};
  txns.forEach(t => { cats[t.category] = (cats[t.category] || 0) + 1; });
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    const valid = CATEGORIES.includes(cat) ? "✓" : "✗ INVALID";
    console.log(`  ${valid} ${cat}: ${count} transactions`);
  });
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
