export const config = { maxDuration: 60 };

const SYSTEM = `You are a transaction extraction engine. You will receive a list of email subjects from Indian bank/UPI alerts (HDFC, ICICI, Deutsche Bank, GPay, PhonePe, Paytm).

For each email, return ONE object with these fields:
{
  "i": <original index from input>,
  "merchant": "clean brand name (Zomato, Amazon, Swiggy Instamart, Uber, BookMyShow, BESCOM, etc.) — drop suffixes like LTD/PVT/INDIA/IN/COM unless they are the brand",
  "amount": <number, no commas or currency>,
  "date": "YYYY-MM-DD — use the date in the subject, else use the provided receivedDate",
  "bank": "HDFC | ICICI | Deutsche Bank | GPay | PhonePe | Paytm | Axis | Kotak | SBI | Yes Bank",
  "type": "debit | credit",
  "ref": "reference number or null"
}

Rules:
- If the email is NOT a real completed transaction (OTP, offer, sale, reminder, statement, subscription nudge, insurance, EMI due notice, failed/reversed txn, refund pending) — return {"i": <index>, "skip": true}
- If you can't parse but it looks like a txn — return {"i": <index>, "skip": true}
- Return ONE JSON array with one entry per input email, in order.
- Output ONLY valid JSON, no markdown, no backticks.`;

async function parseBatch(emails) {
  const userMsg = 'Parse these emails:\n' + emails.map((e, i) => `[${i}] subject="${e.subject}" receivedDate=${e.date}`).join('\n');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM + '\n\nWrap the array in {"txns": [...]}.' },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!r.ok) throw new Error('groq ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const content = j.choices[0].message.content;
  const parsed = JSON.parse(content);
  return parsed.txns || parsed.transactions || [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  try {
    const emails = req.body?.emails || [];
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails array required' });
    }
    const BATCH = 25;
    const results = [];
    for (let start = 0; start < emails.length; start += BATCH) {
      const chunk = emails.slice(start, start + BATCH);
      const parsed = await parseBatch(chunk);
      parsed.forEach(p => {
        if (p && typeof p.i === 'number') {
          results.push({ ...p, i: p.i + start });
        }
      });
    }
    return res.status(200).json({ txns: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
