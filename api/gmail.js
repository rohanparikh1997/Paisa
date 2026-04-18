export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url || !url.startsWith('https://script.google.com')) {
    return res.status(400).json({ error: 'valid script.google.com URL required' });
  }
  try {
    const days = req.query.days || '30';
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'days=' + days, { redirect: 'follow' });
    const text = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(502).json({ error: 'non-json from apps script', preview: text.slice(0, 300) });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
