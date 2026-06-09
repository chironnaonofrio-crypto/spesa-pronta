# FIX V28.21 - Language Cloud Pro

Versione creata da base stabile V28.20.

## Modifiche principali

- Barra principale aggiornata con nuovo pulsante lingua premium.
- Popup cambio lingua stile card:
  - IT Italiano
  - EN English
  - ES Español
  - DE Deutsch
  - lingua attiva con spunta
- Cambio lingua realmente collegato a `settings.lang`, `applyLang()`, salvataggio locale e rerender UI.
- Nuvoletta cloud trasformata in pulsante centro sincronizzazione.
- Nuovo menu cloud:
  - stato cloud online/offline/configurazione
  - ultima sincronizzazione
  - conteggio prodotti
  - stato backup locale
  - household ID
  - endpoint cloud
  - sincronizza ora
  - scarica backup JSON
  - ripristina backup JSON
  - copia ID cloud
- `syncCloud()` ora restituisce esito true/false e salva `lastSyncAt`.
- Cache aggiornata a V28.21.
- Root e `public/` aggiornati.

## Controlli

- `node --check assets/app.v27-48-premium-mega-vision.js`
- `node --check assets/app.js`
- `node --check public/assets/app.v27-48-premium-mega-vision.js`
- `node --check server.js`
