# V31.10.22 GLB Preserve RAM Safe

Correzione principale:
- il RAM-safe non tronca più `glbDataUrl` / `model3D` / `render360V3000` a 1600 caratteri.
- aggiunto limite separato `MAX_STORED_GLB_DATA_URL_CHARS` default 24MB.
- `MAX_STORED_DATA_URL_CHARS=0` continua a pulire immagini pesanti, ma NON cancella il GLB 3D.
- se il GLB supera il limite, il server restituisce errore chiaro invece di viewer bianco.

Variabili consigliate Render:
```
SPESA_MEMORY_MODE=light
SPESA_RAM_SAFE=true
MAX_STORED_DATA_URL_CHARS=0
PRESERVE_GLB_DATA_URL=true
MAX_STORED_GLB_DATA_URL_CHARS=24000000
GPU_VISION_ENABLED=true
```
