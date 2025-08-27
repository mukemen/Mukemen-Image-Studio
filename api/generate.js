// Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    prompt,
    mode = 'generate',
    imageDataUrl = null,
    model = 'google/gemini-2.5-flash-image-preview:free',
    ratio = '1:1',
    width = 1024,
    height = 1024
  } = req.body || {};

  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY belum diset di Vercel → Settings → Environment Variables' });
  }

  try {
    // Susun konten multimodal + hint ukuran/rasio
    const sizeHint = `Target aspect ratio: ${ratio}, target size: ${width}x${height}.`;
    const contentParts = [{ type: 'text', text: (mode === 'edit' ? `Edit: ` : '') + prompt + `\n\n${sizeHint}` }];
    if (mode === 'edit' && imageDataUrl) {
      contentParts.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }

    // Beberapa provider menghormati "size/width/height" di body. Yang lainnya akan pakai hint teks di atas.
    const body = {
      model,
      modalities: ['image','text'],
      messages: [
        { role: 'system', content: `Anda adalah image model. Utamakan mengembalikan gambar. Jika memungkinkan, hormati pengaturan: width=${width}, height=${height}, aspect_ratio=${ratio}.` },
        { role: 'user', content: contentParts }
      ],
      // opsi yang mungkin dipakai oleh provider tertentu
      size: `${width}x${height}`,
      width,
      height,
      aspect_ratio: ratio
    };

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://mukemen-image-studio.vercel.app',
        'X-Title': 'Mukemen Image Studio'
      },
      body: JSON.stringify(body)
    });

    const json = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: json.error?.message || 'OpenRouter error', raw: json });
    }

    // ==== Ekstraksi hasil gambar (berbagai format provider) ====
    const images = [];
    const pushMaybe = (v)=>{
      if (!v) return;
      if (typeof v === 'string' && /^https?:\/\/.+\.(png|jpg|jpeg|webp)(\?.*)?$/i.test(v)) images.push(v);
      else if (typeof v === 'string' && v.startsWith('data:image')) images.push(v);
      else if (typeof v === 'string' && /^[A-Za-z0-9+/=]+$/.test(v) && v.length > 200) images.push(`data:image/png;base64,${v}`);
    };

    if (Array.isArray(json.choices)) {
      for (const ch of json.choices) {
        const msg = ch?.message || {};

        // a) format image-gen resmi
        if (Array.isArray(msg.images)) for (const im of msg.images) pushMaybe(im?.image_url?.url);

        // b) fallback konten multimodal
        const c = msg.content;
        if (Array.isArray(c)) {
          for (const part of c) {
            if (part?.type === 'image_url') pushMaybe(part.image_url?.url);
            else if (part?.type === 'text' && typeof part.text === 'string') {
              if (part.text.startsWith('data:image')) pushMaybe(part.text);
              else { try { const p = JSON.parse(part.text); pushMaybe(p?.image_url || p?.url || p?.data); } catch {} }
            }
          }
        } else if (typeof c === 'string') {
          if (c.startsWith('data:image')) pushMaybe(c);
          else { try { const p = JSON.parse(c); pushMaybe(p?.image_url || p?.url || p?.data); } catch {} }
        }

        // c) tool_calls
        if (Array.isArray(msg.tool_calls)) {
          for (const t of msg.tool_calls) {
            const args = t?.function?.arguments;
            if (args) { try { const a = JSON.parse(args); pushMaybe(a?.image_url || a?.url || a?.data); } catch {} }
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
