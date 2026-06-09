# FIX V28.35 — Mic Off + Local Vision Guard

Obiettivo: evitare che il microfono contamini i campi prodotto e rendere il fallback locale più sicuro quando OpenAI non è disponibile.

Correzioni:
- microfono scanner disattivato di default; l’utente può abilitarlo manualmente;
- comandi vocali come “salta ora”, “non so”, “avanti” non possono diventare nome prodotto;
- se un comando vocale era finito nel campo nome, viene ripulito se non è una modifica manuale fidata;
- fallback visuale acqua/bottiglia reso meno fragile per foto reali con bottiglia centrale;
- OpenAI non disponibile resta diagnostica interna e non viene più mostrato come blocco della scheda;
- cache aggiornata a V28.35.
