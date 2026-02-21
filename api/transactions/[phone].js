// api/transactions/[phone].js
import { getSupabase } from "../lib/storage.js";

export default async function handler(req, res) {
  const supabase = getSupabase();
  const { phone } = req.query;
  const { data: user } = await supabase.from("users").select("id").eq("phone", phone).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const { month, category } = req.query;
  let query = supabase.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false });

  if (month) {
    const start = new Date(month + "-01");
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  }
  if (category) query = query.eq("category", category);

  const { data } = await query.limit(500);
  res.json(data || []);
}
