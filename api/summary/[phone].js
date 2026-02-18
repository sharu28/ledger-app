// api/summary/[phone].js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  const { phone } = req.query;
  const { data: user } = await supabase.from("users").select("id").eq("phone", phone).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [{ data: thisMonth }, { data: allTxns }, { data: pages }] = await Promise.all([
    supabase.from("transactions").select("*").eq("user_id", user.id).gte("created_at", monthStart.toISOString()),
    supabase.from("transactions").select("amount, type, category, created_at").eq("user_id", user.id).order("created_at", { ascending: true }),
    supabase.from("pages").select("id").eq("user_id", user.id),
  ]);

  res.json({
    thisMonth: thisMonth || [],
    allTransactions: allTxns || [],
    totalPages: pages?.length || 0,
  });
}
