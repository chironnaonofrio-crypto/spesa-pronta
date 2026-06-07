# V27.31 - Cloud Guard + Bottle Fix

Fix principali:
- se Cloud/OpenAI Vision non è attiva, l'app lo segnala chiaramente prima della scansione;
- il fallback locale non può più chiamare Coca-Cola una bottiglia solo perché lo sfondo è rosso;
- riconoscimento locale acqua/bottiglia reso prioritario e prudente;
- badge risultato: Cloud OpenAI attiva oppure Cloud AI non collegata / stima locale;
- backend tagga ogni risposta Vision con cloudVision/cloudOffline;
- local fallback resta una stima da confermare, non un riconoscimento vero.
