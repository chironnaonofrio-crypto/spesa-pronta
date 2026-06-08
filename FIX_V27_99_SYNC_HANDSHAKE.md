# V27.99 Sync Handshake Fix

Fix mirato al caso: preflight Supabase OK ma salvataggio articolo resta in coda con `endpoint_not_confirmed`.

## Cosa cambia
- Il client usa gli stessi candidati endpoint per preflight e sync.
- Il salvataggio prova `/api/ai/learn/autonomy` e alias compatibili.
- Il server accetta anche alias `/ai/...` per evitare errori di base API configurata male.
- La diagnosi mostra il motivo reale: 401, 404, timeout, network, payload.
- Il sync in coda può essere ritentato con la nuova logica.
