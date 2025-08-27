// local.js — Local WebGPU Text-to-Image (Stable Diffusion Turbo) via diffusers.js

let pipe = null;
let loading = false;

export async function isWebGPUAvailable() {
  return !!navigator.gpu;
}

export async function ensurePipeline(statusEl) {
  if (pipe || loading) return pipe;
  if (!await isWebGPUAvailable()) {
    throw new Error('WebGPU tidak tersedia di perangkat ini.');
  }
  loading = true;
  statusEl && (statusEl.textContent = 'Menyiapkan model lokal (sekali unduh)…');

  // Muat library diffusers.js dari CDN
  const diffusers = await import('https://cdn.jsdelivr.net/npm/@xenova/diffusers/dist/diffusers.min.js');

  // Muat model SD Turbo (varian ONNX untuk browser)
  pipe = await diffusers.DiffusionPipeline.from_pretrained(
    'stabilityai/sd-turbo',
    { revision: 'onnx' } // gunakan artefak ONNX
  );

  loading = false;
  return pipe;
}

/**
 * Generate image locally (dataURL PNG)
 * @param {string} prompt
 * @param {number} width  - gunakan 512/768
 * @param {number} height
 * @param {HTMLElement?} statusEl
 * @returns {Promise<string[]>}
 */
export async function generateLocal(prompt, width = 512, height = 512, statusEl) {
  const p = await ensurePipeline(statusEl);
  statusEl && (statusEl.textContent = 'Menggambar (lokal, WebGPU)…');

  const result = await p(prompt, {
    num_inference_steps: 1,  // Turbo = 1 step
    guidance_scale: 0,       // distilled
    width,
    height,
    num_images: 1
  });

  const urls = [];
  const canvases = Array.isArray(result.images) ? result.images : [result.image || result.images];
  for (const canvas of canvases) urls.push(canvas.toDataURL('image/png'));
  statusEl && (statusEl.textContent = 'Sukses (lokal).');
  return urls;
}
