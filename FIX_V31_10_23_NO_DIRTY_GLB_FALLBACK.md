# V31.10.23 No Dirty GLB Fallback

Correzione critica:
- rimosso fallback automatico a render-3d/frontale singolo quando build-from-acquisition fallisce.
- richiede frontale + lato reale pulito prima di generare GLB.
- se la GPU rifiuta per maschera sporca, mostra errore chiaro invece di creare modelli deformati.
- mantiene GLB preservato dal RAM-safe.
