// api/lib/prompts/response-formatter.js
// Prompt for formatting query results into WhatsApp messages

export function getResponseFormatterPrompt(question, results, explanation) {
  return `Format this database query result as a concise WhatsApp message.

User's question: "${question}"
What the query does: ${explanation}
Query results: ${JSON.stringify(results)}

Rules:
- Keep the message under 1500 characters
- Use WhatsApp formatting: *bold*, _italic_
- Use bullet points (•) for lists
- Format numbers with commas and 2 decimal places
- Be conversational and helpful
- If results are empty, say so clearly and suggest what data might be available
- Don't mention SQL, databases, or technical details
- End with a helpful suggestion like "Ask me anything else about your expenses!"

Return ONLY the formatted message text, no JSON wrapper.`;
}
