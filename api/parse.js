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
- "GOOGLE *SERVICES" → "Google"
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

OUTPUT FORMAT: Wrap in {"txns":[...]}. Output ONLY valid JSON, no markdown, no backticks.`;

async function parseBatch(emails) {
  const userMsg = 'Parse these ' + emails.length + ' emails:\n\n' +
    emails.map((e, i) => `[${i}] receivedDate=${e.date}\nsubject: ${e.subject}\nbody: ${(e.body || '').slice(0, 800)}\n---`).join('\n');
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
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
    }),
  });
  if (!r.ok) throw new Error('groq ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const parsed = JSON.parse(j.choices[0].message.content);
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
    const BATCH = 10;
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
        // skip failed batch but continue
        results.push({ batchError: e.message, start });
      }
    }
    return res.status(200).json({ txns: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
