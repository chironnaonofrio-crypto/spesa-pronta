# FIX V31.10.3 Balanced Render Fix

Patch creata per correggere i due estremi visti nei test:

- niente più tappo/pezzettini sottili mangiati dal ritaglio;
- niente sagoma troppo aggressiva o prodotto troppo appiccicato ai bordi;
- maschera prodotto bilanciata: preserva alpha originale e aggiunge respiro trasparente;
- render PRO su canvas più stabile, con scala più naturale;
- vecchi render V31.10.2 non sono più considerati fresh, quindi Render PRO rigenera la nuova versione.

Dopo deploy aprire clear-cache.html e poi server-brain.html?force=31103.
