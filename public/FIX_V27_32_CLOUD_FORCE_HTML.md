# V27.32 - Cloud force HTML fix

Fix reale:
- Il backend era già collegato: /api/ai/status mostra visionReady true.
- Il problema era che index.html caricava ancora i file V27.30 invece del frontend V27.31.
- Ora index.html e public/index.html puntano ai nuovi asset V27.32 con cache-buster v=2732.
- Aggiunto marker console per verificare che la build giusta sia caricata.
- Mantenuti i fix anti Coca-Cola su bottiglia trasparente.
