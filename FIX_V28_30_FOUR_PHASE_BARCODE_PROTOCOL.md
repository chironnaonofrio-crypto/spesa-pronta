# V28.30 - Four Phase Vision Protocol

Modifica mirata del punto 8 del protocollo Vision AI.

Nuovo flusso guidato:
1. Foto prodotto: nome, marca, categoria, confezione, formato se visibile.
2. Foto etichetta/ingredienti: ingredienti, allergeni, possibili tracce, valori utili.
3. Foto scadenza: solo data di scadenza; non riscrive nome/marca/categoria.
4. Foto barcode/EAN: solo barcode. Se il barcode porta dati più affidabili può migliorare nome/marca/formato/categoria, ma i valori modificati manualmente dall'utente restano prioritari.
5. Conferma finale.

OpenAI resta docente finale e riceve l'immagine alleggerita/croppata; il server mantiene immagine piena per la pipeline locale.
