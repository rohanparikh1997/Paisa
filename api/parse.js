export const config = { maxDuration: 60 };

const SYSTEM = `You are a bank transaction parser for Indian bank emails (HDFC, ICICI, Deutsche Bank, GPay, PhonePe, Paytm, Axis, Kotak, SBI, Yes Bank).

You will receive an array of emails. For EACH email return ONE object in the same order with this shape:

{
  "i": <0-based index into the input>,
  "merchant": "clean brand name",
  "amount": <positive number, no currency symbol>,
  "date": "YYYY-MM-DD",
  "bank": "HDFC | ICICI | Deutsche Bank | GPay | PhonePe | Paytm | Axis | Kotak | SBI | Yes Bank",
  "type": "debit | credit",
  "ref": "string or null"
}

If the email is NOT a real completed transaction, return: {"i": <index>, "skip": true, "reason": "otp|promo|statement|reminder|login|other"}

DEBIT vs CREDIT:
- debited / spent / charged / paid / withdrawn / deducted / used for transaction → debit
- credited / received / refund / cashback / NEFT credit / IMPS credit / salary → credit
- For UPI credits, merchant = sender name (the person who sent the money), not you

MERCHANT CLEANUP:
- "ZOMATO LTD" → "Zomato"
- "AMAZON PAY IN" → "Amazon"
- "SWIGGY INSTAMART" → "Swiggy Instamart"
- "UBER INDIA SYSTEMS" → "Uber"
- "BESCOM BANGALORE" → "BESCOM"
- Strip trailing LTD/PVT/PRIVATE/LIMITED/INDIA/IN/COM/.COM/INC unless it IS the brand
- For UPI credit, merchant = sender name; for salary, merchant = employer
- If unclear, use the raw string. Do NOT invent.

DATES — convert all to YYYY-MM-DD:
- "19-04-2026" / "19/04/2026" / "19.04.2026" / "19-Apr-26" / "19-Apr-2026" → "2026-04-19"
- Use the transaction date in the email body. If only metadata receivedDate is available, use that.

AMOUNT — strip "Rs.", "Rs", "INR", "₹", commas. "Rs. 1,299.00" → 1299.00. Always positive.
For international Deutsche Bank txns, use the INR equivalent.

SKIP these (return skip:true):
- OTP / verification codes
- Login alerts ("logged in from new device")
- Promotional offers / sale / cashback nudges / "keep your subscription active"
- Statement ready / generated emails
- Card block/unblock confirmations
- KYC reminders
- EMI conversion offers (NOT actual EMI deductions)
- Insurance / policy reminders
- Payment failed / reversed (unless it's a refund)

OUTPUT FORMAT: Wrap in {"txns":[...]}. Output ONLY valid JSON, no markdown, no backticks, no preamble.`;

async function parseBatch(emails) {
  const userMsg = 'Parse these ' + emails.length + ' emails and return {"txns":[...]} with one entry per email in order:\n\n' +
    emails.map((e, i) => `[${i}] receivedDate=${e.date}\nsubject: ${e.subject}\nbody: ${(e.body || '').slice(0, 800)}\n---`).join('\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!r.ok) throw new Error('claude ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  let content = j.content?.[0]?.text || '';
  // Strip any accidental fences
  content = content.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  // Find first { and last } for safety
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first >= 0 && last > first) content = content.slice(first, last + 1);
  const parsed = JSON.parse(content);
  return parsed.txns || parsed.transactions || [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const emails = req.body?.emails || [];
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails array required' });
    }
    const BATCH = 15;
    const results = [];
    for (let start = 0; start < emails.length; start += BATCH) {
      const chunk = emails.slice(start, start + BATCH);
      try {
        const parsed = await parseBatch(chunk);
        parsed.forEach(p => {
          if (p && typeof p.i === 'number') {
            results.push({ ...p, i: p.i + start });
          }
        });
      } catch (e) {
        results.push({ batchError: e.message, start });
      }
    }
    return res.status(200).json({ txns: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
