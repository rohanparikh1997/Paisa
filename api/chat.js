// api/chat.js — Vercel / Netlify serverless function
// Proxies chat requests to Anthropic so your API key stays server-side.
// Deploy on Vercel: drop in /api/chat.js, set ANTHROPIC_API_KEY env var.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, userId } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  // OPTIONAL: rate-limit per user here (e.g. 20 req/min via Upstash Redis)
  // OPTIONAL: fetch the user's real transactions from Supabase and build
  //           a fresh system prompt server-side rather than trusting the client.

  const systemPrompt = `You are Paisa, a friendly personal-finance assistant for an Indian user.
Respond in 2-4 short sentences. Use ₹ for amounts. Be specific; never invent numbers.
If asked unrelated things, politely steer back to money.`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return res.status(502).json({ error: 'AI upstream error', detail: err });
    }

    const data = await anthropicRes.json();
    const reply = data.content?.[0]?.text || '';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: e.message });
  }
}
