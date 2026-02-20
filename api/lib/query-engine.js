// api/lib/query-engine.js
// Natural language → SQL → results → formatted response

import { callGemini, callGeminiJSON } from "./gemini.js";
import { getSupabase } from "./storage.js";
import { getQueryGeneratorPrompt } from "./prompts/query-generator.js";
import { getResponseFormatterPrompt } from "./prompts/response-formatter.js";

const FORBIDDEN_KEYWORDS = [
  "DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "CREATE",
  "TRUNCATE", "GRANT", "REVOKE", "EXEC", "--",
];

export function validateSQL(sql) {
  const upper = sql.toUpperCase().trim();

  if (!upper.startsWith("SELECT")) {
    return { valid: false, reason: "Only SELECT queries are allowed" };
  }

  if (!upper.includes("USER_ID")) {
    return { valid: false, reason: "Query must filter by user_id" };
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Check for keyword as a whole word (not part of another word)
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(upper)) {
      return { valid: false, reason: `Forbidden keyword: ${keyword}` };
    }
  }

  if (sql.includes(";")) {
    return { valid: false, reason: "Semicolons not allowed" };
  }

  return { valid: true };
}

export async function handleQuery(question, userId) {
  const supabase = getSupabase();

  // Load conversation history for context
  const { data: history } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  const conversationHistory = (history || []).reverse();

  // Store user message
  await supabase.from("conversation_messages").insert({
    user_id: userId,
    role: "user",
    content: question,
    message_type: "text",
  });

  // Generate SQL
  const prompt = getQueryGeneratorPrompt(conversationHistory);
  const generated = await callGeminiJSON(`${prompt}\n\nUser question: "${question}"`, {
    maxOutputTokens: 500,
  });

  const sql = generated.sql;
  const explanation = generated.explanation;

  // Validate
  const validation = validateSQL(sql);
  if (!validation.valid) {
    const errorMsg = `I couldn't safely answer that question. ${validation.reason}`;
    await storeAssistantMessage(supabase, userId, errorMsg);
    return { answer: errorMsg, data: [], sql: null };
  }

  // Execute via Supabase RPC
  let results;
  try {
    const { data, error } = await supabase.rpc("run_user_query", {
      query_text: sql,
      p_user_id: userId,
    });

    if (error) throw error;
    results = data || [];
  } catch (err) {
    console.error("Query execution error:", err.message, "SQL:", sql);
    const errorMsg = "Sorry, I had trouble looking that up. Try rephrasing your question.";
    await storeAssistantMessage(supabase, userId, errorMsg);
    return { answer: errorMsg, data: [], sql };
  }

  // Format response
  const formatterPrompt = getResponseFormatterPrompt(question, results, explanation);
  const answer = await callGemini(formatterPrompt, { maxOutputTokens: 1000 });

  // Store assistant response
  await storeAssistantMessage(supabase, userId, answer, { sql, result_count: results.length });

  return { answer, data: results, sql };
}

async function storeAssistantMessage(supabase, userId, content, metadata = {}) {
  await supabase.from("conversation_messages").insert({
    user_id: userId,
    role: "assistant",
    content,
    message_type: "query_result",
    metadata,
  });
}
