# V31.4 Render RAM Safe

Patch anti-crash Render 512MB.

- Avvio server leggero in `SPESA_MEMORY_MODE=light`.
- Seed vision in lazy mode: non carica il mega JSON all'avvio su Render.
- Compattazione memoria globale, knowledge cache, barcode brain e diagnosi.
- Rimozione base64/dataUrl pesanti dal database quando `MAX_STORED_DATA_URL_CHARS=0`.
- Google HTML scrape disattivato di default in RAM Safe.
- GPU Vision disattivata di default finché non viene configurata esplicitamente.
- Nuovi endpoint:
  - `/api/ai/memory-health`
  - `/api/ai/memory-compact`
- Preflight e Server Brain espongono `ramSafeV314`.

Variabili consigliate su Render:

```text
SPESA_MEMORY_MODE=light
SPESA_RAM_SAFE=true
DISABLE_GOOGLE_HTML_SCRAPE=1
GPU_VISION_ENABLED=false
MAX_MEMORY_CACHE=120
MAX_DIAGNOSTIC_EVENTS=50
MAX_GLOBAL_PRODUCTS=800
MAX_PRODUCT_PHOTOS=2
MAX_STORED_DATA_URL_CHARS=0
```
