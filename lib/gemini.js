// api/lib/gemini.js
// Claude (Anthropic) API wrapper — drop-in replacement for Gemini

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callGemini(prompt, options = {}) {
  const {
    imageBase64,
    imageMimeType = "image/jpeg",
    temperature = 0.1,
    maxOutputTokens = 4000,
  } = options;

  const content = [];

  if (imageBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMimeType,
        data: imageBase64,
      },
    });
  }

  content.push({ type: "text", text: prompt });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxOutputTokens,
    temperature,
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text) {
    console.error("Claude empty response:", JSON.stringify(response).substring(0, 500));
    throw new Error("Claude returned empty response");
  }

  return text;
}

export async function callGeminiJSON(prompt, options = {}) {
  const text = await callGemini(prompt, options);
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

export async function fetchTwilioImage(mediaUrl) {
  const imageResponse = await fetch(mediaUrl, {
    headers: {
      Authorization: "Basic " + Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString("base64"),
    },
  });

  if (!imageResponse.ok) {
    throw new Error(`Image fetch failed: ${imageResponse.status} ${imageResponse.statusText}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString("base64");
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  return { base64, contentType };
}
