// api/lib/storage.js
// Supabase storage helpers

import { createClient } from "@supabase/supabase-js";

let _supabase;
export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  }
  return _supabase;
}

export function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

export async function getOrCreateUser(phone) {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("users").select("*").eq("phone", phone).single();

  if (existing) {
    await supabase.from("users")
      .update({ last_active: new Date().toISOString() })
      .eq("id", existing.id);
    return existing;
  }

  const { data: newUser } = await supabase
    .from("users").insert({ phone }).select().single();
  return newUser;
}

export async function createPage(userId, opts = {}) {
  const supabase = getSupabase();
  const { data: page } = await supabase
    .from("pages")
    .insert({
      user_id: userId,
      page_notes: opts.pageNotes || null,
      currency_detected: opts.currency || null,
      confidence: opts.confidence || null,
      transaction_count: opts.transactionCount || 0,
      image_url: opts.imageUrl || null,
      pdf_url: opts.pdfUrl || null,
    })
    .select()
    .single();
  return page;
}

export async function storeTransactions(userId, parsed, opts = {}) {
  const supabase = getSupabase();

  let page;
  if (opts.pageId) {
    // Use existing page, update transaction count
    page = { id: opts.pageId };
    await supabase
      .from("pages")
      .update({ transaction_count: parsed.transactions?.length || 0 })
      .eq("id", opts.pageId);
  } else {
    // Create new page (legacy path)
    const { data } = await supabase
      .from("pages")
      .insert({
        user_id: userId,
        page_notes: parsed.page_notes,
        currency_detected: parsed.currency_detected,
        confidence: parsed.confidence,
        transaction_count: parsed.transactions?.length || 0,
      })
      .select()
      .single();
    page = data;
  }

  if (!parsed.transactions?.length) return { page, transactions: [] };

  const rows = parsed.transactions.map((t) => ({
    user_id: userId,
    page_id: page.id,
    date: t.date,
    parsed_date: parseDate(t.date),
    description: t.description,
    amount: t.amount,
    type: t.type,
    category: t.category,
    is_unclear: t.description?.includes("[unclear]") || false,
  }));

  const { data: txns } = await supabase
    .from("transactions")
    .insert(rows)
    .select();

  return { page, transactions: txns };
}
