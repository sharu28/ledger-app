// api/query/[phone].js - Dashboard chat query endpoint

import { getSupabase } from "../lib/storage.js";
import { handleQuery } from "../lib/query-engine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabase();
  const { phone } = req.query;

  const { data: user } = await supabase
    .from("users").select("id").eq("phone", phone).single();

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "Question is required" });
  }

  try {
    const result = await handleQuery(question, user.id);
    res.json(result);
  } catch (err) {
    console.error("Query error:", err);
    res.status(500).json({ error: "Failed to process query" });
  }
}
