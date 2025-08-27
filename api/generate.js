// /api/generate.js — Auto (Gratis) + fallback ke Gemini Free + parser gambar yang robust
function round8(x){ const n=Number(x)||0; return Math.max(256, Math.round(n/8)*8); }

async function pickFreeImageModel(apiKey){
  try{
    const r = await fetch('https://openrouter.ai/api/v1/models',{
      headers:{ Authorization:`Bearer ${apiKey}` }
    });
    const j = await r.json();
    const list = Array.isArray(j?.data) ? j.data : [];
    const freeImage = list.find(m=>{
      const out = m?.capabilities?.output || m?.output || [];
      const priceIn  = Number(m?.pricing?.prompt ?? m?.pricing?.input ?? 0);
      const priceOut = Number(m?.pricing?.completion ?? m?.pricing?.output ?? 0);
      return out.includes('image') && priceIn===0 && priceOut===0;
    });
    return freeImage?.id || 'google/gemini-2.5-flash-image-preview:free';
  }catch{
    return 'google/gemini-2.5-flash-image-preview:free';
  }
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  const {
    prompt,
    mode='generate',
    imageDataUrl=null,
    model='auto-free',
    ratio='1:1',
    width:W=1024,
    height:H=1024
  } = req.body || {};

  if(!prompt) return res.status(400).json({error:'Missing prompt'});
  const API_KEY = process.env.OPENROUTER_API_KEY;
  if(!API_KEY){
    return res.status(500).json({error:'OPENROUTER_API_KEY belum diset di Vercel (Project → Settings → Environment Variables).'});
  }

  const width  = round8(W);
  const height = round8(H);

  const chosen = model==='auto-free' ? await pickFreeImageModel(API_KEY) : model;

  async function call(modelId){
    const content = [{ type:'text', text: (mode==='edit'?'Edit: ':'') + prompt +
      `\n\nTarget aspect ratio: ${ratio}, target size: ${width}x${height}.` }];
    if(mode==='edit' && imageDataUrl){
      content.push({ type:'image_url', image_url:{ url:imageDataUrl }});
    }

    const body = {
      model: modelId,
      modalities: ['image','text'],
      messages: [
        { role:'system', content:`Utamakan mengembalikan gambar. Hormati ukuran: ${width}x${height} (rasio ${ratio}).` },
        { role:'user', content }
      ],
      size: `${width}x${height}`,
      width, height, aspect_ratio: ratio
    };

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',
      headers:{
        Authorization:`Bearer ${API_KEY}`,
        'Content-Type':'application/json',
        'HTTP-Referer':'https://mukemen-image-studio.vercel.app',
        'X-Title':'Mukemen Image Studio'
      },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    return { ok:r.ok, status:r.status, json:j };
  }

  let { ok, status, json } = await call(chosen);

  // Fallback jika ID model invalid / 404
  if(!ok && /not a valid model id|model not found|404/i.test(JSON.stringify(json))){
    ({ ok, status, json } = await call('google/gemini-2.5-flash-image-preview:free'));
  }

  if(!ok){
    return res.status(status).json({ error: json?.error?.message || 'OpenRouter error', raw: json });
  }

  // --- Ekstrak URL/base64 image dari berbagai format ---
  const images = [];
  const add = (v)=>{
    if(!v || typeof v!=='string') return;
    if(/^https?:\/\/.+\.(png|jpg|jpeg|webp)(\?.*)?$/i.test(v)) return images.push(v);
    if(v.startsWith('data:image')) return images.push(v);
    if(/^[A-Za-z0-9+/=]+$/.test(v) && v.length>200) images.push(`data:image/png;base64,${v}`);
  };

  for(const ch of (json?.choices||[])){
    const msg = ch?.message || {};
    if(Array.isArray(msg.images)) for(const im of msg.images) add(im?.image_url?.url);
    const c = msg.content;
    if(Array.isArray(c)){
      for(const part of c){
        if(part?.type==='image_url') add(part.image_url?.url);
        else if(part?.type==='text'){
          try{ const p=JSON.parse(part.text); add(p?.image_url||p?.url||p?.data); }
          catch{ if(part.text.startsWith('data:image')) add(part.text); }
        }
      }
    }else if(typeof c==='string'){
      try{ const p=JSON.parse(c); add(p?.image_url||p?.url||p?.data); }
      catch{ if(c.startsWith('data:image')) add(c); }
    }
    if(Array.isArray(msg.tool_calls)){
      for(const t of msg.tool_calls){ try{ const a=JSON.parse(t?.function?.arguments||'{}'); add(a?.image_url||a?.url||a?.data); }catch{} }
    }
  }

  if(!images.length){
    return res.status(502).json({
      error:'Model tidak mengembalikan gambar. Coba ulang atau gunakan Gemini 2.5 Flash Image (free).',
      raw: json
    });
  }

  res.status(200).json({ images });
}
