// Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt,
    mode = 'generate',
    imageDataUrl = null,
    model = 'google/gemini-2.5-flash-image-preview:free'
  } = req.body || {};

  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY belum diset di Vercel → Settings → Environment Variables' });
  }

  try {
    // Susun konten multimodal
    const contentParts = [{ type: 'text', text: mode === 'edit' ? `Edit: ${prompt}` : prompt }];
    if (mode === 'edit' && imageDataUrl) {
      contentParts.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://mukemen-image-studio.vercel.app',
        'X-Title': 'Mukemen Image Studio'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Anda adalah image model. Hasilkan gambar dari prompt atau edit gambar yang diberikan.' },
          { role: 'user', content: contentParts }
        ]
      })
    });

    const json = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: json.error?.message || 'OpenRouter error', raw: json });
    }

    // ==== Ekstraksi hasil gambar (beberapa provider beda format) ====
    const images = [];

    function maybePush(v) {
      if (!v) return;
      // URL http(s) langsung
      if (typeof v === 'string' && /^https?:\/\/.+\.(png|jpg|jpeg|webp)(\?.*)?$/i.test(v)) images.push(v);
      // Data URL base64
      else if (typeof v === 'string' && v.startsWith('data:image')) images.push(v);
      // Base64 mentah → bungkus data URL (jika terdeteksi)
      else if (typeof v === 'string' && /^[A-Za-z0-9+/=]+$/.test(v) && v.length > 200) {
        images.push(`data:image/png;base64,${v}`);
      }
    }

    for (const ch of json.choices || []) {
      const msg = ch.message || {};
      const c = msg.content;

      // Array parts (format OpenAI-style multimodal)
      if (Array.isArray(c)) {
        for (const part of c) {
          if (part?.type === 'image_url') {
            maybePush(part.image_url?.url);
          } else if (part?.type === 'text') {
            // Bisa jadi provider mengembalikan data:image... di teks
            maybePush(part.text);
            // Atau JSON bertuliskan { "image_url": "..." }
            try {
              const parsed = JSON.parse(part.text);
              maybePush(parsed?.image_url || parsed?.url || parsed?.data);
            } catch {}
          }
        }
      }
      // String tunggal
      else if (typeof c === 'string') {
        maybePush(c);
        try {
          const parsed = JSON.parse(c);
          maybePush(parsed?.image_url || parsed?.url || parsed?.data);
        } catch {}
      }
      // Tool calls (beberapa provider taruh di sini)
      if (Array.isArray(msg?.tool_calls)) {
        for (const t of msg.tool_calls) {
          if (t?.function?.arguments) {
            try {
              const a = JSON.parse(t.function.arguments);
              maybePush(a?.image_url || a?.url || a?.data);
            } catch {}
          }
        }
      }
    }
    // ==== END ekstraksi ====

    if (!images.length) {
      return res.status(502).json({
        error: 'Model tidak mengembalikan gambar. Coba ganti model (mis. Stable Diffusion 3.5) atau ulangi lagi.',
        raw: json
      });
    }

    res.status(200).json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
