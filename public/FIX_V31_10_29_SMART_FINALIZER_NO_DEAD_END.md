# FIX V31.10.29 Smart Finalizer No-Dead-End

Patch generata dopo analisi video 20260614_033816.

Problema visto nel video: scansione e micro-celle migliorate, copertura al 98-100%, ma GLB finale non creato dopo 30 scatti perché il build strict rifiutava le maschere laterali/back anche quando la sessione era ormai utilizzabile.

Correzioni:
- readiness app basata su frontale + lato reale, non obbliga retro per sbloccare build;
- build server V31.10.29 con metadata smart-finalizer;
- worker V33.4.24 con relaxed object-only build cut per front/side/back/top/bottom;
- fallback controllato da back a side proxy quando il lato strict fallisce;
- ultimo rescue object-only GLB se il voxel multiview fallisce;
- nessun fallback a frame intero o SpesaMesh/Depth Extrusion;
- GLB finale deve apparire sotto scanner invece di lasciare il flusso in dead-end.
