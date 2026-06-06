# Email brand Spesa Pronta - V20

Tutte le email inviate dal backend usano lo stesso template HTML con stile Spesa Pronta:

- sfondo azzurro/bianco;
- card arrotondata;
- header gradient blu/verde;
- logo emoji shopping coerente col sito;
- pulsante principale arrotondato;
- box informativi colorati;
- token di sicurezza in riquadro scuro;
- footer automatico.

## Email coperte

1. Verifica email obbligatoria dopo registrazione.
2. Benvenuto dopo verifica.
3. Recupero password con link/token.
4. Conferma cambio password.

Ogni email cambia contenuto, titolo, pulsante e riquadri in base alla situazione, ma mantiene la stessa formattazione grafica.

## Fallback testo

Ogni email contiene anche una versione testo semplice per compatibilità con client email vecchi o filtri antispam.

## Sicurezza

I token non vengono salvati in chiaro nel database: viene salvato solo l'hash SHA-256 del token.
