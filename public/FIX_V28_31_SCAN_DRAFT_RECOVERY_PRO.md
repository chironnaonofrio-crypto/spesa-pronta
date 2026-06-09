# FIX V28.31 - Scan Draft Recovery Pro

Obiettivo: se l’utente esce dal sito mentre sta creando una scheda prodotto non ancora confermata, l’app salva automaticamente una bozza locale e la propone al rientro nello scanner.

## Regole
- Gli articoli gia confermati restano salvati in casa e in coda sync server se offline.
- Le scansioni non confermate vengono salvate come bozza locale nel browser.
- Al rientro nello scanner appare un pannello professionale: Riprendi bozza / Continua dopo / Elimina bozza.
- La bozza salva campi, step corrente, sessione scanner, barcode, scadenza e dati Vision utili.
- Le immagini vengono tenute solo se leggere; se troppo pesanti viene mantenuta la scheda testuale per evitare quota localStorage.
- Reset risultati elimina intenzionalmente la bozza.

## Versione
V28.31 Scan Draft Recovery Pro
