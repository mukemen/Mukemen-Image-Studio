<!-- local.js -->
<script type="module">
/**
 * Local WebGPU Text-to-Image using diffusers.js (Stable Diffusion Turbo).
 * Catatan:
 * - Pertama kali load model ~ ratusan MB (sekali saja, lalu cache).
 * - Rekomendasi ukuran output: 512 atau 768 (kelipatan 8).
 * - num_inference_steps=1 (Turbo) → cepat.
 */

let pipe = null;
let loading = false;

export async function isWebGPUAvailable() {
  return !!navigator.gpu;
}

export async function ensurePipeline(statusEl) {
  if (pipe || loading) return pipe;
  if (!await isWebGPUAvailable()) {
    throw new Error('WebGPU tidak tersedia di browser/perangkat ini.');
  }
  loading = true;
  statusEl && (statusEl.textContent = 'Menyiapkan model lokal (pertama kali agak lama)...');

  // Muat diffusers.js via CDN
  const diffusers = await import('https://cdn.jsdelivr.net/npm/@xenova/diffusers/dist/diffusers.min.js');

  // Model SD Turbo (T2I)
  // Kamu bisa ganti model lain yang kompatibel kalau tersedia sebagai ONNX di HF.
  pipe = await diffusers.DiffusionPipeline.from_pretrained(
    'stabilityai/sd-turbo',
    {
      // precision lebih rendah = lebih ringan (jika device mendukung)
      revision: 'onnx', // gunakan varian ONNX
      // backend: 'webgpu' → dipilih otomatis
    }
  );

  loading = false;
  return pipe;
}

/**
 * Generate local image
 * @param {string} prompt
 * @param {number} width  - gunakan 512/768 agar pas & cepat
 * @param {number} height
 * @param {HTMLElement?} statusEl
 * @returns {Promise<string[]>} dataURL PNG(s)
 */
export async function generateLocal(prompt, width=512, height=512, statusEl) {
  const p = await ensurePipeline(statusEl);
  statusEl && (statusEl.textContent = 'Menggambar (lokal, WebGPU)…');

  // SD Turbo optimal: 1 step, guidance 0 (distilled)
  const result = await p(prompt, {
    num_inference_steps: 1,
    guidance_scale: 0,
    width, height,
    num_images: 1,
  });

  // result.images bisa berupa HTMLCanvasElement[] → konversi ke dataURL
  const urls = [];
  const imgs = Array.isArray(result.images) ? result.images : [result.image || result.images];
  for (const canvas of imgs) {
    const url = canvas.toDataURL('image/png');
    urls.push(url);
  }
  statusEl && (statusEl.textContent = 'Sukses (lokal).');
  return urls;
}
</script>
