# V28.54 PRO Cost Meter + Semantic Visual Signature Core

- Aggiunto contatore costi server: separa chiamate OpenAI da lookup Open Facts/barcode a costo token zero.
- Diagnosi AI espone `costMeterV2854` con ultime chiamate, stage, max token richiesti, KB immagine e hit/miss Open Facts.
- Ogni prodotto confermato riceve una firma visiva semantica V28.54: nome, marca, categoria, formato, barcode, testi forti, package e colori come indizi secondari.
- Ingredienti, allergeni, tracce e colori non comandano l'identità del prodotto.
- Cervello Server espone la firma semantica dentro ogni scheda prodotto.
