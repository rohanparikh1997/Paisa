export default async function handler(req, res) {
  const url = req.query.url;
  if (!url || !url.startsWith('https://script.google.com')) {
    return res.status(400).json({ error: 'valid script.google.com URL required' });
  }
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'days=60', { redirect: 'follow' });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
