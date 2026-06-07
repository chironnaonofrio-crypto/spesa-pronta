# V27.33 - Vision Rescue

Fix principali:
- la Cloud OpenAI ora non viene più sovrascritta dal fallback solo perché needsManual=true;
- backend Vision più resiliente: una sola analisi completa + secondo tentativo leggero se la prima fallisce;
- contesto ridotto per evitare timeout e risposte mancanti;
- errori cloud mostrati chiaramente nella scheda;
- badge separati: Cloud OpenAI attiva / Cloud errore / Fallback locale prudente;
- regole anti-Coca-Cola da sfondo rosso e priorità bottiglie d'acqua con etichetta.
