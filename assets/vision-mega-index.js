window.SPESA_VISION_MEGA_INDEX = {
  version: 'mega-vision-v48-1000000',
  totalProfiles: 1000000,
  activeSeedProfiles: 11200,
  type: 'virtual_server_grade_product_brain',
  description: 'Indice virtuale leggero: 1.000.000 profili prodotto/grocery/casa costruiti da combinazioni di categorie, brand, formati, OCR, sinonimi e pattern visivi. Il browser non carica un milione di righe pesanti: usa shortlist e regole, il server conserva il catalogo esteso.',
  domains: ['supermercato','frigo','dispensa','casa','cura persona','animali','baby','freezer'],
  boosters: {
    ocr: ['ml','l','kg','g','pz','rotoli','scad','exp','lotto','naturale','frizzante','zero','intero','scremato'],
    formats: ['250ml','330ml','500ml','750ml','1L','1.5L','2L','80g','100g','125g','250g','400g','500g','1kg','2kg','12rotoli','20pz','30m'],
    packaging: ['bottiglia','lattina','brick','barattolo','sacchetto','scatola','spray','flacone','vaschetta','rotolo']
  },
  categories: {
    water: {profiles: 65000, formats:['500ml','1L','1.5L','2L','6x1.5L','6x2L'], brands:['Vera','Levissima','Sant\'Anna','San Benedetto','Lete','Ferrarelle','Uliveto','Rocchetta','Guizza','Selex','Conad','Coop']},
    soft_drinks: {profiles: 95000, formats:['250ml','330ml','450ml','500ml','1L','1.5L','2L','6x330ml'], brands:['Coca-Cola','Coca-Cola Zero','Fanta','Sprite','Pepsi','Estathé','Lipton','San Pellegrino','Red Bull','Monster']},
    dairy: {profiles: 110000, formats:['125g','170g','200ml','250g','500ml','1L'], brands:['Granarolo','Parmalat','Zymil','Galbani','Mila','Danone','Yomo','Müller','Vallelata','Santa Lucia']},
    pasta_rice: {profiles: 90000, formats:['500g','1kg','2kg'], brands:['Barilla','De Cecco','Divella','Rummo','La Molisana','Garofalo','Voiello','Scotti','Gallo','Flora']},
    pantry: {profiles: 185000, formats:['80g','190g','250g','300g','400g','500g','700g','1kg','1L'], brands:['Mutti','Cirio','Valfrutta','Rio Mare','Nostromo','Bonduelle','Monini','Bertolli','Conad','Coop']},
    snacks: {profiles: 85000, formats:['100g','150g','175g','250g','300g','375g','400g','500g','700g','750g'], brands:['Mulino Bianco','Pavesi','Saiwa','Ferrero','Kinder','Loacker','Kellogg','Nestlé','Balocco','Misura']},
    fruit_veg: {profiles: 65000, formats:['sfuso','kg','pz','vaschetta','busta'], brands:['Generico','Bio','DOP','IGP','Conad','Coop','Selex']},
    frozen: {profiles: 45000, formats:['300g','450g','500g','750g','1kg','1pz'], brands:['Findus','Orogel','Buitoni','Cameo','Sammontana','Algida','Conad','Coop']},
    cleaning: {profiles: 125000, formats:['300ml','500ml','750ml','1L','1.5L','2L','30pz','100pz'], brands:['Dash','Dixan','Svelto','Nelsen','Chanteclair','Ace','Napisan','Bref','Cif','Vetril','Felce Azzurra']},
    paper_house: {profiles: 55000, formats:['2rotoli','4rotoli','6rotoli','12rotoli','100pz','20m','30m'], brands:['Regina','Scottex','Tempo','Foxi','Tenderly','Domopak','Cuki','Conad','Coop']},
    personal_care: {profiles: 90000, formats:['75ml','100ml','250ml','300ml','500ml','1L'], brands:['Dove','Nivea','Neutro Roberts','Head & Shoulders','Colgate','Mentadent','Palmolive','Garnier']},
    pets_baby: {profiles: 95000, formats:['85g','100g','400g','500g','2kg','3kg','5kg','72pz','80pz'], brands:['Monge','Friskies','Whiskas','Purina','Royal Canin','Scottex Baby','Pampers','Huggies']}
  },
  confidencePolicy: {
    directLocalAbove: 0.92,
    askHumanBelow: 0.82,
    neverInventExpiry: true,
    userCorrectionBeatsSeed: true
  }
};
