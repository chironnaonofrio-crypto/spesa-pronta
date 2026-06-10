# V28.53 PRO External Knowledge Learning Loop

Questa versione trasforma le ricerche esterne/API in memoria interna dopo conferma utente/titolare.

- Open Facts / API prodotto propongono dati, immagine riferimento, barcode, categoria, ingredienti, allergeni.
- La conferma utente o titolare trasforma il risultato in cartella oggetto server.
- La foto riferimento API viene salvata tra le foto dell’articolo quando disponibile.
- Il Cervello Server mostra un tab Fonti API con immagini e fonti salvate.
- Se arriva un barcode senza nome prodotto, il server prova il lookup Open Facts prima di perdere l’apprendimento.
- I valori titolare restano sempre superiori a tutto.

Priorità: owner lock > conferma utente > barcode/Open Facts > etichetta/OCR > memoria > docente OpenAI.
