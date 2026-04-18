// gmail-scanner.gs — Google Apps Script
// Each Paisa user deploys this in their own Google account.
// Exposes a web-app URL that returns parsed transactions from their Gmail.
//
// Setup:
// 1. Go to https://script.google.com → New project
// 2. Paste this entire file
// 3. Click Deploy → New deployment → type: Web app
//    - Execute as: Me (your account)
//    - Who has access: Anyone
// 4. Authorize Gmail access when prompted
// 5. Copy the Web app URL → paste into Paisa onboarding
//
// The app then fetches <yourUrl>?days=30 to pull recent transactions.

function doGet(e) {
  const days = parseInt(e.parameter.days) || 30;
  const txns = scanTransactions(days);
  return ContentService
    .createTextOutput(JSON.stringify({ transactions: txns, count: txns.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

function scanTransactions(days) {
  // Search query: bank/UPI alerts from the last N days
  const query = `newer_than:${days}d (subject:(debited OR credited OR "transaction alert" OR "payment received" OR "UPI") OR from:(alerts OR noreply))`;
  const threads = GmailApp.search(query, 0, 200);
  const txns = [];

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const parsed = parseEmail(msg);
      if (parsed) txns.push(parsed);
    });
  });

  return txns;
}

function parseEmail(msg) {
  const from = msg.getFrom();
  const subject = msg.getSubject();
  const body = msg.getPlainBody();
  const date = msg.getDate();

  // Detect bank
  const bank = detectBank(from);
  if (!bank) return null;

  // Extract amount — patterns like "Rs. 450", "INR 1,299.00", "₹ 740"
  const amountMatch = body.match(/(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{2})?)/i);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

  // Debit or credit
  const type = /credited|received|deposit/i.test(body + subject) ? 'credit' : 'debit';

  // Extract merchant — after "to", "at", or "VPA"
  const merchMatch = body.match(/(?:to|at|VPA)\s+([A-Z0-9][A-Z0-9\s.&'-]{2,40})/i);
  const merchant = merchMatch ? merchMatch[1].trim().replace(/\s+/g, ' ') : 'Unknown';

  // Reference
  const refMatch = body.match(/(?:ref|txn|UPI)[\s:#-]+([A-Z0-9]{6,20})/i);
  const ref = refMatch ? refMatch[1] : '';

  return {
    bank,
    amount,
    type,
    merchant: cleanMerchant(merchant),
    date: date.toISOString(),
    ref,
    subject,
  };
}

function detectBank(from) {
  const f = from.toLowerCase();
  if (f.includes('hdfc')) return 'HDFC';
  if (f.includes('icici')) return 'ICICI';
  if (f.includes('sbi')) return 'SBI';
  if (f.includes('axis')) return 'Axis';
  if (f.includes('kotak')) return 'Kotak';
  if (f.includes('yes')) return 'Yes Bank';
  if (f.includes('gpay') || f.includes('google')) return 'GPay';
  if (f.includes('phonepe')) return 'PhonePe';
  if (f.includes('paytm')) return 'Paytm';
  if (f.includes('deutsche')) return 'Deutsche Bank';
  return null;
}

function cleanMerchant(m) {
  return m.replace(/\b(?:PVT|LTD|PRIVATE|LIMITED|INDIA|ONLINE)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40);
}
