export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, mode = 'generate', imageDataUrl = null, model = 'google/gemini-2.5-flash-image-preview:free' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const contentParts = [];
    contentParts.push({ type: 'text', text: mode === 'edit' ? `Edit: ${prompt}` : prompt });
    if (mode === 'edit' && imageDataUrl) {
      contentParts.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.origin || 'https://example.com',
        'X-Title': 'Mukemen Image Studio'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Anda adalah model image generator.' },
          { role: 'user', content: contentParts }
        ]
      })
    });

    const json = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: json.error?.message || 'OpenRouter error', raw: json });
    }

    const images = [];
    for (const ch of json.choices || []) {
      const c = ch.message?.content;
      if (Array.isArray(c)) {
        for (const part of c) {
          if (part?.type === 'image_url' && part.image_url?.url) images.push(part.image_url.url);
          if (part?.type === 'text' && part.text.startsWith('data:image')) images.push(part.text);
        }
      } else if (typeof c === 'string' && c.startsWith('data:image')) {
        images.push(c);
      }
    }

    if (!images.length) {
      return res.status(502).json({ error: 'Model tidak mengembalikan gambar', raw: json });
    }

    res.status(200).json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
