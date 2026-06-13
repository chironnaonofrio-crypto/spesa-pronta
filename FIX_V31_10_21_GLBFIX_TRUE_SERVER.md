# FIX V31.10.21 GLB TRUE SERVER

Correzioni vere:
- route server build 3D usa forcePreview e non blocca se ci sono frame geometrici validi
- salva GLB reale in gpuVisionV33/model3D/render360V3000
- restituisce modelUrl/glbDataUrl anche a livello top-level per il viewer sotto scanner
- non importa più capturedViews/capturedParts inventati dal worker: il server usa solo frame geometryAccepted e filtra parti false
- checklist non segna più manico/top/barcode senza prove vere
