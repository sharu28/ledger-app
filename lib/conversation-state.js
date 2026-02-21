// api/lib/conversation-state.js
// Manage pending extraction state for two-step workflow

import { getSupabase } from "./storage.js";

const EXPIRY_HOURS = 24;

export async function createPendingExtraction(userId, pageId, rawExtraction, opts = {}) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("pending_extractions")
    .insert({
      user_id: userId,
      page_id: pageId,
      raw_extraction: rawExtraction,
      content_type: opts.contentType || null,
      follow_up_question: opts.followUpQuestion || null,
      image_url: opts.imageUrl || null,
      pdf_url: opts.pdfUrl || null,
    })
    .select()
    .single();
  return data;
}

export async function getPendingExtraction(userId) {
  const supabase = getSupabase();

  // Expire old pending extractions
  const cutoff = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  await supabase
    .from("pending_extractions")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "awaiting_confirmation")
    .lt("created_at", cutoff);

  // Get the most recent pending one
  const { data } = await supabase
    .from("pending_extractions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "awaiting_confirmation")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data;
}

export async function resolvePendingExtraction(id, status) {
  const supabase = getSupabase();
  await supabase
    .from("pending_extractions")
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", id);
}
