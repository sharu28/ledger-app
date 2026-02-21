// api/lib/gemini.js
// Generic Gemini API wrapper

export async function callGemini(prompt, options = {}) {
  const {
    imageBase64,
    imageMimeType = "image/jpeg",
    temperature = 0.1,
    maxOutputTokens = 4000,
  } = options;

  const parts = [{ text: prompt }];

  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMimeType, data: imageBase64 } });
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature, maxOutputTokens },
      }),
    }
  );

  const data = await resp.json();

  if (data.error) {
    throw new Error(`Gemini: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

  if (!text) {
    console.error("Gemini empty response:", JSON.stringify(data).substring(0, 500));
    throw new Error("Gemini returned empty response");
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
