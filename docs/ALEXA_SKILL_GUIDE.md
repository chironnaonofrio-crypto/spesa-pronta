# Alexa Skill - Spesa Pronta

La skill non usa la lista interna generica di Alexa: legge e modifica il database cloud di Spesa Pronta.

## Endpoint
```text
POST https://tuodominio.it/api/alexa?householdId=ID_CASA
```

## Intenti supportati
- `ReadListIntent`: legge solo gli articoli da comprare
- `AddItemIntent`: mette un articolo in lista
- `SetQuantityIntent`: imposta quantità e unità
- `IncreaseItemIntent`: aumenta quantità
- `DecreaseItemIntent`: diminuisce quantità
- `ChangeUnitIntent`: cambia unità
- `ResetListIntent`: segna spesa fatta e riporta le scorte a pieno

## Esempi frasi
- “Alexa, chiedi a Spesa Pronta cosa devo comprare”
- “Alexa, chiedi a Spesa Pronta di aggiungere latte”
- “Alexa, chiedi a Spesa Pronta di impostare acqua a 2 litri”
- “Alexa, chiedi a Spesa Pronta di diminuire crocchette cane di 1”
- “Alexa, chiedi a Spesa Pronta ho fatto la spesa”
