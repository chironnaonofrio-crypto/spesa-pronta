# V31.10.25 Macro No False Ready

Patch grossa: blocco false-ready, niente build se ultimo frame non è geometria valida, checklist più severa, blocco GLB legacy, debug JSON.

Regole principali:
- readyFor3D richiede ultimo frame accettato, 0 reject dopo ultimo accepted, front + side + back, almeno 4 geometry frames.
- build bloccata se rejectedSinceAccepted > 0.
- UI non mette verde top/base/handle da parti OCR se non c’è geometria vera.
