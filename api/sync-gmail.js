// api/sync-gmail.js — optional Vercel function
// Fetches a user's Apps Script URL, parses transactions, dedupes, and upserts to Supabase.
// Call this from the frontend on app load to sync fresh emails.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, gmailUrl, days = 30 } = req.body;
  if (!userId || !gmailUrl) return res.status(400).json({ error: 'missing params' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    // Pull from user's Apps Script
    const gmailRes = await fetch(`${gmailUrl}?days=${days}`);
    const { transactions = [] } = await gmailRes.json();

    // Prep rows for upsert
    const rows = transactions.map(t => ({
      user_id: userId,
      merchant: t.merchant,
      amount: t.amount,
      type: t.type,
      bank: t.bank,
      ref: t.ref,
      date: t.date,
      source: 'gmail',
      dedup_key: `${t.bank}_${t.amount}_${t.date.slice(0,10)}_${t.ref || t.merchant}`,
    }));

    // Upsert (dedup on (user_id, dedup_key))
    const { error } = await supabase
      .from('transactions')
      .upsert(rows, { onConflict: 'user_id,dedup_key', ignoreDuplicates: true });

    if (error) throw error;

    return res.status(200).json({ synced: rows.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
