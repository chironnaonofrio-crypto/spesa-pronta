# V27.15 - Fix pulsante Registrati

Correzioni:
- il form registrazione ora usa `novalidate`, quindi il browser non blocca il submit in silenzio;
- il pulsante Registrati ha un listener diretto oltre al submit del form;
- aggiunto fallback DOMContentLoaded: anche se un bind secondario fallisce, Registrati resta attivo;
- aggiunto stato "Invio in corso" durante la registrazione;
- mantenute immagini inline/chiare e azioni account V27.14.
