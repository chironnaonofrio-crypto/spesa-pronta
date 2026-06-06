
const STORAGE_KEY = 'spesa-pronta-final:v1';
const SETTINGS_KEY = 'spesa-pronta-final:settings:v1';
const SESSION_KEY = 'spesa-pronta-final:session:v1';
const AI_MEMORY_KEY = 'spesa-pronta-final:ai-memory:v2';
const SYNC_WAIT = 650;

const translations = {
  it: {
    navDashboard:'Dashboard', navProducts:'Prodotti', navShopping:'Lista della spesa', navSuggestions:'Suggerimenti', navSettings:'Impostazioni', navHelp:'Aiuto',
    heroEyebrow:'Organizzatore domestico', appTitle:'SPESA PRONTA', subtitle:'Quando finisce, scorri. Quando esci, compri.', statusSituation:'Situazione spesa', totalItems:'articoli totali', inHome:'In casa', readyAvailable:'scorte sufficienti',
    toBuy:'Da comprare', missingItems:'scorte in esaurimento', syncStatus:'Stato sync', yourProducts:'I tuoi prodotti', dashboardHint:'Gestisci quantità, unità e stato della spesa.',
    addArticle:'Aggiungi articolo', shoppingDone:'Ho fatto la spesa', searchPlaceholder:'Cerca un articolo', allCategories:'Tutte le categorie',
    catalogNote:'Qui trovi un menu generico con molti articoli comuni. Se qualcosa manca, aggiungilo tu.', quickList:'Lista rapida', quickListHint:'Solo ciò che devi comprare.',
    copyList:'Copia lista', suggestedTitle:'Consigliati per te', suggestedHint:'Articoli che consumi spesso o che stanno per finire.', alexaTitle:'Collegamento Alexa',
    alexaTextShort:'Alexa legge e aggiorna la lista cloud.', connectAlexa:'Connetti Alexa', copyAlexaEndpoint:'Copia endpoint Alexa', registerTitle:'Registrazione opzionale',
    registerText:'Crea un account per sincronizzare i tuoi dati e usare Alexa. Puoi anche continuare offline.', username:'Nome utente', usernamePh:'Inserisci il tuo nome',
    email:'Email', password:'Password', passwordPh:'Minimo 8 caratteri', peopleCount:'Numero persone in casa', animalCount:'Numero animali', captcha:'Captcha',
    apiEndpoint:'API endpoint', autoSmartOrdering:'Spesa intelligente automatica', registerCreate:'Registrati', continueOffline:'Continua offline', whyRegister:'Perché registrarsi?',
    benefitCloud:'Sincronizzazione sicura su cloud', benefitDevices:'Accesso da più dispositivi', benefitSmart:'Suggerimenti personalizzati', benefitAlexa:'Integrazione con Alexa',
    productsHint:'Catalogo completo e gestione articoli personalizzati.', shoppingHint:'Questa è la lista che Alexa leggerà dal cloud.', suggestionsSmart:'Suggerimenti intelligenti',
    suggestionsExplain:'Raccomandazioni basate su persone, animali e consumo reale.', peopleInHome:'Persone in casa', animalsInHome:'Animali', smartAnalysis:'Analisi consumi',
    smartHow:'Analizziamo i consumi abituali e il numero di persone/animali per prevedere cosa sta per finire.', language:'Lingua dell’app', cloudSync:'Cloud & Sincronizzazione',
    enableCloud:'Abilita sync cloud', householdId:'ID famiglia', apiToken:'Token API', saveSettings:'Salva impostazioni', household:'Famiglia', smartShopping:'Suggerimenti spesa intelligenti',
    autoSmartExplain:'Se disattivato, l’app non aggiunge suggerimenti automatici alla lista.', alexaLong:'Collega Alexa allo stesso database: quando modifichi un articolo, la lista vocale si aggiorna.',
    helpText:'Esempi Alexa: “Alexa, chiedi a Spesa Pronta cosa devo comprare”, “aggiungi acqua”, “segna crocchette cane a 10 kg”.',
    nameIt:'Nome italiano', nameEn:'Nome inglese', nameEs:'Nome spagnolo', nameDe:'Nome tedesco', category:'Categoria', add:'Aggiungi',
    qty:'Quantità', unit:'Unità', availability:'Disponibilità', lowStock:'Scorta bassa', goodStock:'Scorta buona', inStock:'IN CASA', buyStock:'DA COMPRARE',
    copied:'Copiato ✅', saved:'Salvato ✅', synced:'Sincronizzato', offline:'Offline', guest:'Ospite', registered:'Registrato', wrongCaptcha:'Captcha errato', required:'Compila i campi richiesti',
    noBuy:'Niente da comprare 🎉', added:'Articolo aggiunto ✅', syncFail:'Sync non riuscita', alexaConnected:'Collegata', alexaNotConnected:'Non collegata',
    category_food:'Alimentari', category_drinks:'Bevande', category_pets:'Animali', category_house:'Casa', category_pharmacy:'Farmacia', category_aquarium:'Acquario', category_fruit:'Frutta', category_veg:'Verdura', firstName:'Nome', lastName:'Cognome', firstNamePh:'Inserisci il tuo nome', lastNamePh:'Inserisci il tuo cognome', profileTitle:'Profilo utente', saveProfile:'Salva profilo', registerOrLogin:'Registrati / Login', account:'Account', clickToProfile:'Apri profilo', clickToRegister:'Registrati per sincronizzare', profileSaved:'Profilo aggiornato ✅', profileGuestText:'Accedi per sincronizzare tutto e usare Alexa.', homeDataTitle:'Dati casa per i consumi intelligenti', homeDataHint:'Questi numeri servono per calcolare acqua, crocchette e scorte consigliate.'
  },
  en: {
    navDashboard:'Dashboard', navProducts:'Products', navShopping:'Shopping list', navSuggestions:'Suggestions', navSettings:'Settings', navHelp:'Help',
    heroEyebrow:'Home organizer', appTitle:'READY GROCERIES', subtitle:'When it runs out, swipe. When you go out, buy.', statusSituation:'Shopping status', totalItems:'total items', inHome:'At home', readyAvailable:'enough stock',
    toBuy:'To buy', missingItems:'running low', syncStatus:'Sync status', yourProducts:'Your products', dashboardHint:'Manage quantity, unit and shopping status.',
    addArticle:'Add item', shoppingDone:'Shopping completed', searchPlaceholder:'Search item', allCategories:'All categories',
    catalogNote:'Here is a generic menu with many common items. Add yours if something is missing.', quickList:'Quick list', quickListHint:'Only what you need to buy.',
    copyList:'Copy list', suggestedTitle:'Suggested for you', suggestedHint:'Items you use often or that are running low.', alexaTitle:'Alexa connection',
    alexaTextShort:'Alexa reads and updates the cloud list.', connectAlexa:'Connect Alexa', copyAlexaEndpoint:'Copy Alexa endpoint', registerTitle:'Optional registration',
    registerText:'Create an account to sync your data and use Alexa. You can also continue offline.', username:'Username', usernamePh:'Enter your name',
    email:'Email', password:'Password', passwordPh:'Minimum 8 characters', peopleCount:'People at home', animalCount:'Animals', captcha:'Captcha',
    apiEndpoint:'API endpoint', autoSmartOrdering:'Automatic smart shopping', registerCreate:'Register', continueOffline:'Continue offline', whyRegister:'Why register?',
    benefitCloud:'Secure cloud synchronization', benefitDevices:'Access from multiple devices', benefitSmart:'Personalized suggestions', benefitAlexa:'Alexa integration',
    productsHint:'Full catalog and custom item management.', shoppingHint:'This is the list Alexa will read from the cloud.', suggestionsSmart:'Smart suggestions',
    suggestionsExplain:'Recommendations based on people, pets and real consumption.', peopleInHome:'People at home', animalsInHome:'Animals', smartAnalysis:'Consumption analysis',
    smartHow:'We analyze typical consumption and household size/pets to predict what is running low.', language:'App language', cloudSync:'Cloud & Sync',
    enableCloud:'Enable cloud sync', householdId:'Household ID', apiToken:'API token', saveSettings:'Save settings', household:'Household', smartShopping:'Smart shopping suggestions',
    autoSmartExplain:'If disabled, the app will not automatically add smart suggestions to the list.', alexaLong:'Connect Alexa to the same database: when you edit an item, the voice list updates.',
    helpText:'Alexa examples: “Alexa, ask Ready Groceries what should I buy”, “add water”, “set dog food to 10 kg”.',
    nameIt:'Italian name', nameEn:'English name', nameEs:'Spanish name', nameDe:'German name', category:'Category', add:'Add',
    qty:'Quantity', unit:'Unit', availability:'Availability', lowStock:'Low stock', goodStock:'Good stock', inStock:'AT HOME', buyStock:'TO BUY',
    copied:'Copied ✅', saved:'Saved ✅', synced:'Synced', offline:'Offline', guest:'Guest', registered:'Registered', wrongCaptcha:'Wrong captcha', required:'Fill required fields',
    noBuy:'Nothing to buy 🎉', added:'Item added ✅', syncFail:'Sync failed', alexaConnected:'Connected', alexaNotConnected:'Not connected',
    category_food:'Groceries', category_drinks:'Drinks', category_pets:'Pets', category_house:'Home', category_pharmacy:'Pharmacy', category_aquarium:'Aquarium', category_fruit:'Fruit', category_veg:'Vegetables', firstName:'First name', lastName:'Last name', firstNamePh:'Enter your first name', lastNamePh:'Enter your last name', profileTitle:'User profile', saveProfile:'Save profile', registerOrLogin:'Register / Login', account:'Account', clickToProfile:'Open profile', clickToRegister:'Register to sync', profileSaved:'Profile updated ✅', profileGuestText:'Sign in to sync everything and use Alexa.', homeDataTitle:'Home data for smart consumption', homeDataHint:'These numbers calculate water, pet food and recommended stock.'
  },
  es: {
    navDashboard:'Panel', navProducts:'Productos', navShopping:'Lista de compra', navSuggestions:'Sugerencias', navSettings:'Ajustes', navHelp:'Ayuda',
    heroEyebrow:'Organizador doméstico', appTitle:'COMPRA LISTA', subtitle:'Cuando se acaba, desliza. Cuando sales, compra.', statusSituation:'Situación compra', totalItems:'artículos totales', inHome:'En casa', readyAvailable:'stock suficiente',
    toBuy:'Por comprar', missingItems:'stock bajo', syncStatus:'Estado sync', yourProducts:'Tus productos', dashboardHint:'Gestiona cantidad, unidad y estado de compra.',
    addArticle:'Añadir artículo', shoppingDone:'Compra hecha', searchPlaceholder:'Buscar artículo', allCategories:'Todas las categorías',
    catalogNote:'Aquí tienes un menú genérico con muchos artículos comunes. Añade los tuyos si falta algo.', quickList:'Lista rápida', quickListHint:'Solo lo que debes comprar.',
    copyList:'Copiar lista', suggestedTitle:'Sugeridos para ti', suggestedHint:'Artículos que usas a menudo o que se están acabando.', alexaTitle:'Conexión Alexa',
    alexaTextShort:'Alexa lee y actualiza la lista cloud.', connectAlexa:'Conectar Alexa', copyAlexaEndpoint:'Copiar endpoint Alexa', registerTitle:'Registro opcional',
    registerText:'Crea una cuenta para sincronizar datos y usar Alexa. También puedes seguir offline.', username:'Usuario', usernamePh:'Introduce tu nombre',
    email:'Email', password:'Contraseña', passwordPh:'Mínimo 8 caracteres', peopleCount:'Personas en casa', animalCount:'Animales', captcha:'Captcha',
    apiEndpoint:'API endpoint', autoSmartOrdering:'Compra inteligente automática', registerCreate:'Registrarse', continueOffline:'Continuar offline', whyRegister:'¿Por qué registrarse?',
    benefitCloud:'Sincronización segura en la nube', benefitDevices:'Acceso desde varios dispositivos', benefitSmart:'Sugerencias personalizadas', benefitAlexa:'Integración con Alexa',
    productsHint:'Catálogo completo y gestión de artículos personalizados.', shoppingHint:'Esta es la lista que Alexa leerá desde la nube.', suggestionsSmart:'Sugerencias inteligentes',
    suggestionsExplain:'Recomendaciones basadas en personas, animales y consumo real.', peopleInHome:'Personas en casa', animalsInHome:'Animales', smartAnalysis:'Análisis de consumo',
    smartHow:'Analizamos consumos habituales y número de personas/animales para prever lo que se acaba.', language:'Idioma de la app', cloudSync:'Cloud y sincronización',
    enableCloud:'Activar sincronización cloud', householdId:'ID familia', apiToken:'Token API', saveSettings:'Guardar ajustes', household:'Familia', smartShopping:'Sugerencias inteligentes',
    autoSmartExplain:'Si está desactivado, la app no añade sugerencias automáticas a la lista.', alexaLong:'Conecta Alexa a la misma base de datos: al modificar un artículo, se actualiza la lista por voz.',
    helpText:'Ejemplos Alexa: “Alexa, pregunta a Compra Lista qué debo comprar”, “añade agua”, “marca comida de perro a 10 kg”.',
    nameIt:'Nombre italiano', nameEn:'Nombre inglés', nameEs:'Nombre español', nameDe:'Nombre alemán', category:'Categoría', add:'Añadir',
    qty:'Cantidad', unit:'Unidad', availability:'Disponibilidad', lowStock:'Stock bajo', goodStock:'Stock bueno', inStock:'EN CASA', buyStock:'POR COMPRAR',
    copied:'Copiado ✅', saved:'Guardado ✅', synced:'Sincronizado', offline:'Offline', guest:'Invitado', registered:'Registrado', wrongCaptcha:'Captcha incorrecto', required:'Rellena los campos requeridos',
    noBuy:'Nada que comprar 🎉', added:'Artículo añadido ✅', syncFail:'Sync fallida', alexaConnected:'Conectada', alexaNotConnected:'No conectada',
    category_food:'Alimentos', category_drinks:'Bebidas', category_pets:'Animales', category_house:'Casa', category_pharmacy:'Farmacia', category_aquarium:'Acuario', category_fruit:'Fruta', category_veg:'Verdura', firstName:'Nombre', lastName:'Apellido', firstNamePh:'Introduce tu nombre', lastNamePh:'Introduce tu apellido', profileTitle:'Perfil de usuario', saveProfile:'Guardar perfil', registerOrLogin:'Registrarse / Login', account:'Cuenta', clickToProfile:'Abrir perfil', clickToRegister:'Regístrate para sincronizar', profileSaved:'Perfil actualizado ✅', profileGuestText:'Inicia sesión para sincronizar todo y usar Alexa.', homeDataTitle:'Datos de casa para consumo inteligente', homeDataHint:'Estos números calculan agua, comida de animales y stock recomendado.'
  },
  de: {
    navDashboard:'Dashboard', navProducts:'Produkte', navShopping:'Einkaufsliste', navSuggestions:'Vorschläge', navSettings:'Einstellungen', navHelp:'Hilfe',
    heroEyebrow:'Haushalts-Organizer', appTitle:'EINKAUF BEREIT', subtitle:'Wenn es ausgeht, wische. Wenn du rausgehst, kaufe.', statusSituation:'Einkaufsstatus', totalItems:'Artikel gesamt', inHome:'Zu Hause', readyAvailable:'genug Vorrat',
    toBuy:'Zu kaufen', missingItems:'Vorrat niedrig', syncStatus:'Sync-Status', yourProducts:'Deine Produkte', dashboardHint:'Menge, Einheit und Einkaufsstatus verwalten.',
    addArticle:'Artikel hinzufügen', shoppingDone:'Einkauf erledigt', searchPlaceholder:'Artikel suchen', allCategories:'Alle Kategorien',
    catalogNote:'Hier findest du viele häufige Artikel. Füge eigene Artikel hinzu, wenn etwas fehlt.', quickList:'Schnellliste', quickListHint:'Nur was du kaufen musst.',
    copyList:'Liste kopieren', suggestedTitle:'Für dich empfohlen', suggestedHint:'Artikel, die du oft verbrauchst oder die knapp werden.', alexaTitle:'Alexa-Verbindung',
    alexaTextShort:'Alexa liest und aktualisiert die Cloud-Liste.', connectAlexa:'Alexa verbinden', copyAlexaEndpoint:'Alexa-Endpunkt kopieren', registerTitle:'Optionale Registrierung',
    registerText:'Erstelle ein Konto, um Daten zu synchronisieren und Alexa zu nutzen. Du kannst auch offline fortfahren.', username:'Benutzername', usernamePh:'Namen eingeben',
    email:'E-Mail', password:'Passwort', passwordPh:'Mindestens 8 Zeichen', peopleCount:'Personen im Haushalt', animalCount:'Tiere', captcha:'Captcha',
    apiEndpoint:'API-Endpunkt', autoSmartOrdering:'Automatische intelligente Einkaufsliste', registerCreate:'Registrieren', continueOffline:'Offline fortfahren', whyRegister:'Warum registrieren?',
    benefitCloud:'Sichere Cloud-Synchronisierung', benefitDevices:'Zugriff von mehreren Geräten', benefitSmart:'Personalisierte Vorschläge', benefitAlexa:'Alexa-Integration',
    productsHint:'Vollständiger Katalog und eigene Artikel verwalten.', shoppingHint:'Diese Liste liest Alexa aus der Cloud.', suggestionsSmart:'Intelligente Vorschläge',
    suggestionsExplain:'Empfehlungen nach Personen, Tieren und tatsächlichem Verbrauch.', peopleInHome:'Personen im Haushalt', animalsInHome:'Tiere', smartAnalysis:'Verbrauchsanalyse',
    smartHow:'Wir analysieren Verbrauch, Personen und Tiere, um vorherzusagen, was knapp wird.', language:'App-Sprache', cloudSync:'Cloud & Synchronisierung',
    enableCloud:'Cloud-Sync aktivieren', householdId:'Haushalts-ID', apiToken:'API-Token', saveSettings:'Einstellungen speichern', household:'Haushalt', smartShopping:'Intelligente Einkaufsvorschläge',
    autoSmartExplain:'Wenn deaktiviert, fügt die App keine automatischen Vorschläge zur Liste hinzu.', alexaLong:'Verbinde Alexa mit derselben Datenbank: Änderungen aktualisieren die Sprachliste.',
    helpText:'Alexa-Beispiele: „Alexa, frage Einkauf Bereit, was ich kaufen muss“, „Wasser hinzufügen“, „Hundefutter auf 10 kg setzen“.',
    nameIt:'Italienischer Name', nameEn:'Englischer Name', nameEs:'Spanischer Name', nameDe:'Deutscher Name', category:'Kategorie', add:'Hinzufügen',
    qty:'Menge', unit:'Einheit', availability:'Verfügbarkeit', lowStock:'Niedriger Vorrat', goodStock:'Guter Vorrat', inStock:'ZU HAUSE', buyStock:'ZU KAUFEN',
    copied:'Kopiert ✅', saved:'Gespeichert ✅', synced:'Synchronisiert', offline:'Offline', guest:'Gast', registered:'Registriert', wrongCaptcha:'Captcha falsch', required:'Pflichtfelder ausfüllen',
    noBuy:'Nichts zu kaufen 🎉', added:'Artikel hinzugefügt ✅', syncFail:'Sync fehlgeschlagen', alexaConnected:'Verbunden', alexaNotConnected:'Nicht verbunden',
    category_food:'Lebensmittel', category_drinks:'Getränke', category_pets:'Tiere', category_house:'Haushalt', category_pharmacy:'Apotheke', category_aquarium:'Aquarium', category_fruit:'Obst', category_veg:'Gemüse', firstName:'Vorname', lastName:'Nachname', firstNamePh:'Vorname eingeben', lastNamePh:'Nachname eingeben', profileTitle:'Benutzerprofil', saveProfile:'Profil speichern', registerOrLogin:'Registrieren / Login', account:'Konto', clickToProfile:'Profil öffnen', clickToRegister:'Zum Synchronisieren registrieren', profileSaved:'Profil aktualisiert ✅', profileGuestText:'Melde dich an, um alles zu synchronisieren und Alexa zu nutzen.', homeDataTitle:'Haushaltsdaten für intelligente Vorräte', homeDataHint:'Diese Zahlen berechnen Wasser, Tierfutter und empfohlene Vorräte.'
  }
};

const categories = ['food','drinks','pets','house','pharmacy','aquarium','fruit','veg'];

function createItem(id, image, category, names, qty, maxQty, baseThreshold, unitOptions, opts={}) {
  return {
    id, image, category, names, qty, maxQty, baseThreshold, unit: unitOptions[0], unitOptions,
    usage: opts.usage || 0, kind: opts.kind || 'generic', perPersonMin: opts.perPersonMin || 0,
    perAnimalMin: opts.perAnimalMin || 0, recommendedBuy: opts.recommendedBuy || Math.max(maxQty, 1),
    custom: !!opts.custom, updatedAt: Date.now()
  };
}

const defaults = [
  createItem('latte','assets/illustrations/milk.png','drinks',{it:'Latte',en:'Milk',es:'Leche',de:'Milch'},1,6,2,['lt','bt','cf'],{perPersonMin:.8,recommendedBuy:6,usage:4}),
  createItem('pane','assets/illustrations/bread.png','food',{it:'Pane',en:'Bread',es:'Pan',de:'Brot'},2,6,1,['pz','pc'],{perPersonMin:.5,recommendedBuy:4,usage:2}),
  createItem('acqua','assets/illustrations/water.png','drinks',{it:'Acqua',en:'Water',es:'Agua',de:'Wasser'},2,24,4,['lt','bt','cf'],{kind:'water',perPersonMin:2,recommendedBuy:12,usage:5}),
  createItem('crocchette-cane','assets/illustrations/dogfood.png','pets',{it:'Crocchette cane',en:'Dog food',es:'Comida perro',de:'Hundefutter'},10,30,4,['kg','cf'],{kind:'petfood',perAnimalMin:4,recommendedBuy:15,usage:3}),
  createItem('cerotti','assets/illustrations/bandage.png','pharmacy',{it:'Cerotti',en:'Bandages',es:'Tiritas',de:'Pflaster'},2,12,3,['pz','cf'],{recommendedBuy:12,usage:1}),
  createItem('pasta','assets/illustrations/pasta.png','food',{it:'Pasta',en:'Pasta',es:'Pasta',de:'Nudeln'},3,10,2,['pz','cf'],{perPersonMin:.5,recommendedBuy:6}),
  createItem('uova','assets/illustrations/eggs.png','food',{it:'Uova',en:'Eggs',es:'Huevos',de:'Eier'},4,20,4,['pz','cf'],{perPersonMin:1.5,recommendedBuy:12}),
  createItem('carta','assets/illustrations/toilet-paper.png','house',{it:'Carta igienica',en:'Toilet paper',es:'Papel higiénico',de:'Toilettenpapier'},3,20,4,['pz','cf'],{perPersonMin:2,recommendedBuy:12}),
  createItem('mangime-pesci','assets/illustrations/fishfood.png','aquarium',{it:'Mangime pesci',en:'Fish food',es:'Comida peces',de:'Fischfutter'},1,5,1,['cf','pz'],{recommendedBuy:3}),
  createItem('biocondizionatore','assets/illustrations/conditioner.png','aquarium',{it:'Biocondizionatore',en:'Water conditioner',es:'Acondicionador agua',de:'Wasseraufbereiter'},1,4,1,['bt','lt'],{recommendedBuy:2}),
  createItem('mele','assets/illustrations/apple.png','fruit',{it:'Mele',en:'Apples',es:'Manzanas',de:'Äpfel'},3,10,2,['pz','kg'],{perPersonMin:1,recommendedBuy:6}),
  createItem('banane','assets/illustrations/banana.png','fruit',{it:'Banane',en:'Bananas',es:'Plátanos',de:'Bananen'},2,10,2,['pz','kg'],{perPersonMin:1,recommendedBuy:6}),
  createItem('pomodori','assets/illustrations/tomato.png','veg',{it:'Pomodori',en:'Tomatoes',es:'Tomates',de:'Tomaten'},2,8,2,['kg','pz'],{perPersonMin:.5,recommendedBuy:4}),
  createItem('patate','assets/illustrations/potato.png','veg',{it:'Patate',en:'Potatoes',es:'Patatas',de:'Kartoffeln'},5,12,3,['kg','pz'],{perPersonMin:1,recommendedBuy:8}),
  createItem('insalata','assets/illustrations/lettuce.png','veg',{it:'Insalata',en:'Lettuce',es:'Lechuga',de:'Salat'},1,4,1,['pz'],{recommendedBuy:2}),
  createItem('riso','assets/illustrations/rice.png','food',{it:'Riso',en:'Rice',es:'Arroz',de:'Reis'},2,6,1,['kg','cf'],{perPersonMin:.5,recommendedBuy:4}),
  createItem('formaggio','assets/illustrations/cheese.png','food',{it:'Formaggio',en:'Cheese',es:'Queso',de:'Käse'},1,5,1,['pz','gr'],{recommendedBuy:3}),
  createItem('detersivo','assets/illustrations/detergent.png','house',{it:'Detersivo',en:'Detergent',es:'Detergente',de:'Waschmittel'},1,4,1,['bt','lt'],{recommendedBuy:2}),
  createItem('sacchetti-cane','assets/illustrations/bags.png','pets',{it:'Sacchetti cane',en:'Dog bags',es:'Bolsas perro',de:'Hundebeutel'},12,30,6,['pz','cf'],{perAnimalMin:4,recommendedBuy:20}),
  createItem('farmaci','assets/illustrations/medicine.png','pharmacy',{it:'Farmaci',en:'Medicines',es:'Medicinas',de:'Medikamente'},8,20,4,['cp','cf'],{recommendedBuy:12})
];

let state = loadState();
let settings = loadSettings();
let session = loadSession();
let activeView = 'dashboard';
let filter = 'all';
let searchTerm = '';
let categoryFilter = 'all';
let captcha = newCaptcha();
let syncTimer = null;
let aiMemory = loadAiMemory();
let aiRecognition = null;
let aiListening = false;

function loadState(){ try { const x=JSON.parse(localStorage.getItem(STORAGE_KEY)); return Array.isArray(x) && x.length ? migrateItems(x) : structuredClone(defaults); } catch { return structuredClone(defaults); } }
function loadSettings(){ try { return Object.assign(defaultSettings(), JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')); } catch { return defaultSettings(); } }
function loadSession(){ try { return Object.assign({mode:'guest', user:null}, JSON.parse(localStorage.getItem(SESSION_KEY)||'{}')); } catch { return {mode:'guest', user:null}; } }
function loadAiMemory(){ try { return Object.assign({messages:[], facts:[], events:[], scanHistory:[], pendingVerification:false, lastGreetingDate:'', summary:'', lastInsights:{}, personality:{warmth:1}}, JSON.parse(localStorage.getItem(AI_MEMORY_KEY)||'{}')); } catch { return {messages:[], facts:[], events:[], scanHistory:[], pendingVerification:false, lastGreetingDate:'', summary:'', lastInsights:{}, personality:{warmth:1}}; } }
function saveAiMemory(){ localStorage.setItem(AI_MEMORY_KEY, JSON.stringify(aiMemory)); }
function defaultSettings(){ return {lang:'it', cloudEnabled:false, apiEndpoint:'/api', token:'', householdId:'', people:2, animals:3, autoSmart:true, alexaConnected:false, profile:{firstName:'',lastName:'',username:'',email:''}}; }
function migrateItems(items){ return items.map(x => ({...createItem(x.id||cryptoId(), x.image||'assets/illustrations/generic-item.png', x.category||'food', x.names||{it:x.name||x.id,en:x.name||x.id,es:x.name||x.id,de:x.name||x.id}, x.qty??1, x.maxQty??6, x.baseThreshold??2, x.unitOptions||['pz','pc','lt','kg'], {custom:x.custom, usage:x.usage||0, kind:x.kind, perPersonMin:x.perPersonMin, perAnimalMin:x.perAnimalMin, recommendedBuy:x.recommendedBuy}), ...x})); }
function saveAll(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); localStorage.setItem(SESSION_KEY, JSON.stringify(session)); scheduleSync(); }
function t(k){ return translations[settings.lang]?.[k] || translations.it[k] || k; }
function nameOf(item){ return item.names?.[settings.lang] || item.names?.it || item.id; }
function catName(cat){ return t('category_'+cat); }
function cryptoId(){ return 'i_'+Math.random().toString(36).slice(2,10); }
function $(s){ return document.querySelector(s); }
function $all(s){ return [...document.querySelectorAll(s)]; }
function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function daysBetween(a,b){ return Math.max(1,(b-a)/86400000); }
function aiEventsFor(id,type){ return (aiMemory.events||[]).filter(e=>e.itemId===id && (!type || e.type===type)); }
function aiVelocity(item){
  const now=Date.now(), since=now-1000*60*60*24*30;
  const ev=aiEventsFor(item.id,'consume').filter(e=>e.at>=since);
  const total=ev.reduce((s,e)=>s+Math.abs(Number(e.delta)||0),0);
  if(total<=0) return 0;
  const first=Math.min(...ev.map(e=>e.at));
  return total / daysBetween(first, now);
}
function rememberEvent(type,item,delta=0,note=''){
  aiMemory.events = aiMemory.events || [];
  aiMemory.events.push({type,itemId:item?.id||null,itemName:item?nameOf(item):'',delta:Number(delta)||0,note,at:Date.now()});
  aiMemory.events = aiMemory.events.slice(-400);
  saveAiMemory();
}

function smartThreshold(item){
  if(!settings.autoSmart) return item.baseThreshold;
  let th = item.baseThreshold;
  if(item.perPersonMin) th = Math.max(th, Math.ceil(item.perPersonMin * Math.max(1, settings.people)));
  if(item.perAnimalMin) th = Math.max(th, Math.ceil(item.perAnimalMin * Math.max(0, settings.animals)));
  if(item.usage >= 6) th = Math.max(th, item.baseThreshold + 2);
  if(item.kind === 'water') th = Math.max(th, settings.people * 2);
  if(item.kind === 'petfood') th = Math.max(th, settings.animals * 4);
  const velocity = aiVelocity(item);
  if(velocity > 0) th = Math.max(th, Math.ceil(velocity * 3));
  return th;
}
function statusOf(item){ return item.qty <= smartThreshold(item) ? 'buy' : 'home'; }
function buyItems(){ return state.filter(i => statusOf(i)==='buy'); }
function suggestionScore(item){ return (statusOf(item)==='buy'?50:0) + item.usage*7 + Math.max(0, smartThreshold(item)-item.qty)*8; }
function recommendedQty(item){ 
  let r = item.recommendedBuy || item.maxQty;
  if(item.kind==='water') r = Math.max(r, settings.people * 6);
  if(item.kind==='petfood') r = Math.max(r, settings.animals * 5);
  const velocity = aiVelocity(item);
  if(velocity > 0) r = Math.max(r, Math.ceil(velocity * 10));
  return Math.ceil(r);
}
function stockPercent(item){ return Math.max(0, Math.min(100, Math.round((1 - (item.qty / Math.max(item.maxQty, recommendedQty(item)))) * 100))); }

function newCaptcha(){ const a=1+Math.floor(Math.random()*8), b=1+Math.floor(Math.random()*8); return {q:`${a} + ${b} = ?`, ans:a+b}; }

function init(){
  bind();
  applyLang();
  render();
  showView('dashboard');
  $('#regCaptcha').placeholder = captcha.q;
  $('#alexaExamples').textContent = [
    'Alexa, chiedi a Spesa Pronta cosa devo comprare',
    'Alexa, chiedi a Spesa Pronta di aggiungere acqua',
    'Alexa, chiedi a Spesa Pronta di segnare crocchette cane a 10 kg',
    'Alexa, chiedi a Spesa Pronta di resettare la spesa'
  ].join('\n');
  if(new URLSearchParams(location.search).get('openMenu') === '1') setTimeout(() => toggleMobileMenu(true), 120);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}
function bind(){
  $all('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#mobileMenuBtn')?.addEventListener('click', () => toggleMobileMenu(true));
  $('#mobileNavBackdrop')?.addEventListener('click', () => toggleMobileMenu(false));
  $all('[data-view-shortcut]').forEach(b => b.addEventListener('click', () => showView(b.dataset.viewShortcut)));
  $('#userShortcutBtn').addEventListener('click', handleUserShortcut);
  $('#languageSelect').addEventListener('change', e => { settings.lang=e.target.value; saveAll(); applyLang(); render(); });
  $('#settingsLanguage').addEventListener('change', e => { settings.lang=e.target.value; saveAll(); applyLang(); render(); });
  $('#searchInput').addEventListener('input', e => { searchTerm=e.target.value.toLowerCase(); renderProducts(); });
  $('#categorySelect').addEventListener('change', e => { categoryFilter=e.target.value; renderProducts(); });
  $all('.status-tab').forEach(b => b.addEventListener('click', () => { filter=b.dataset.filter; $all('.status-tab').forEach(x=>x.classList.toggle('active',x===b)); renderProducts(); }));
  $('#shoppingDoneBtn').addEventListener('click', shoppingDone);
  $('#shoppingDoneBtn2').addEventListener('click', shoppingDone);
  $('#copyListBtn').addEventListener('click', copyList);
  $('#addProductBtn').addEventListener('click', openAdd);
  $('#addProductBtn2').addEventListener('click', openAdd);
  $('#closeDialogBtn').addEventListener('click', () => $('#productDialog').close());
  $('#customProductForm').addEventListener('submit', addCustom);
  $('#registerForm').addEventListener('submit', register);
  $('#continueOfflineBtn').addEventListener('click', () => { session={mode:'offline',user:null}; settings.cloudEnabled=false; saveAll(); showView('dashboard'); toast('Offline'); });
  $('#saveSettingsBtn').addEventListener('click', saveSettingsFromForm);
  $('#syncNowBtn').addEventListener('click', () => syncCloud(true));
  $('#saveProfileBtn').addEventListener('click', saveProfile);
  $('#goRegisterBtn').addEventListener('click', () => showView(session.user ? 'settings' : 'registration'));
  $('#connectAlexaBtn').addEventListener('click', connectAlexa);
  $('#connectAlexaBtn2').addEventListener('click', connectAlexa);
  $('#copyAlexaBtn').addEventListener('click', copyAlexaEndpoint);
  $('#copyAlexaBtn2').addEventListener('click', copyAlexaEndpoint);
  $('#aiFab').addEventListener('click', openAiPanel);
  $('#aiCloseBtn').addEventListener('click', closeAiPanel);
  $('#aiForm').addEventListener('submit', submitAiForm);
  $('#aiVoiceBtn').addEventListener('click', startAiVoiceOnce);
  $('#aiWakeToggle').addEventListener('change', e => toggleWakeWord(e.target.checked));
  $('#aiOpenScannerBtn')?.addEventListener('click', () => openGroceryScanner(false));
  $('#scannerCloseBtn')?.addEventListener('click', closeGroceryScanner);
  $('#scannerFinishBtn')?.addEventListener('click', finishScanner);
  $('#scannerResetBtn')?.addEventListener('click', resetScannerResults);
  $('#markVerifyBtn')?.addEventListener('click', markShoppingDoneToVerify);
  $('#fridgeModeBtn')?.addEventListener('click', startFridgeMode);
  $('#groceryPhotoInput')?.addEventListener('change', e => handleGroceryFiles(e.target.files));
  $('#groceryGalleryInput')?.addEventListener('change', e => handleGroceryFiles(e.target.files));
}

function applyLang(){
  document.documentElement.lang = settings.lang;
  $all('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  $all('[data-i18n-placeholder]').forEach(el => el.placeholder = t(el.dataset.i18nPlaceholder));
  $('#languageSelect').value = settings.lang;
  $('#settingsLanguage').value = settings.lang;
  $('#categorySelect').innerHTML = `<option value="all">${esc(t('allCategories'))}</option>` + categories.map(c=>`<option value="${c}">${esc(catName(c))}</option>`).join('');
  $('#customCategory').innerHTML = categories.map(c=>`<option value="${c}">${esc(catName(c))}</option>`).join('');
}
function toggleMobileMenu(open){
  document.querySelector('.sidebar')?.classList.toggle('open', !!open);
  $('#mobileNavBackdrop')?.classList.toggle('show', !!open);
  document.body.classList.toggle('menu-open', !!open);
}

function showView(v){
  toggleMobileMenu(false);
  activeView=v;
  $all('.view').forEach(x=>x.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  $all('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  if(v==='products') renderAllProducts();
  if(v==='shopping') renderShoppingFull();
  if(v==='suggestions') renderSuggestions();
  if(v==='settings') renderSettings();
}
function render(){
  renderStats(); renderProducts(); renderSide(); renderSettings(); renderAllProducts(); renderShoppingFull(); renderSuggestions();
  renderUserPill();
}

function renderUserPill(){
  const btn = $('#userShortcutBtn');
  const label = $('#userLabel');
  const sub = $('#userPillSub');
  const icon = $('#userPillIcon');
  const registered = !!(session.user && (session.user.username || settings.profile?.username));
  btn.classList.toggle('guest', !registered);
  btn.classList.toggle('registered', registered);
  if(registered){
    const first = settings.profile?.firstName || session.user?.firstName || '';
    const last = settings.profile?.lastName || session.user?.lastName || '';
    const full = `${first} ${last}`.trim() || session.user?.username || settings.profile?.username || 'Utente';
    label.textContent = full;
    sub.textContent = t('clickToProfile');
    icon.textContent = (first?.[0] || session.user?.username?.[0] || 'U').toUpperCase();
  } else {
    label.textContent = t('registerOrLogin');
    sub.textContent = t('clickToRegister');
    icon.textContent = '👤';
  }
}

function handleUserShortcut(){
  showView(session.user ? 'settings' : 'registration');
  if(session.user){
    setTimeout(() => document.querySelector('.profile-card')?.scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }
}

function saveProfile(){
  settings.profile = settings.profile || {};
  settings.profile.firstName = $('#profileFirstName').value.trim();
  settings.profile.lastName = $('#profileLastName').value.trim();
  settings.profile.username = $('#profileUsername').value.trim();
  settings.profile.email = $('#profileEmail').value.trim();
  settings.people = Math.max(1, Math.min(20, Number($('#profilePeople').value) || 1));
  settings.animals = Math.max(0, Math.min(30, Number($('#profileAnimals').value) || 0));
  if(!session.user && settings.profile.username){
    session.user = { username: settings.profile.username, firstName: settings.profile.firstName, lastName: settings.profile.lastName, email: settings.profile.email };
  } else if(session.user){
    Object.assign(session.user, settings.profile);
  }
  saveAll(); render(); toast(t('profileSaved'));
}

function renderStats(){
  $('#statTotal').textContent = state.length;
  $('#statHome').textContent = state.filter(i=>statusOf(i)==='home').length;
  $('#statBuy').textContent = buyItems().length;
  $('#statSync').textContent = settings.cloudEnabled ? t('synced') : t('offline');
  $('#statSyncSub').textContent = settings.cloudEnabled ? (settings.householdId || 'cloud') : 'local';
  $('#alexaStatus').textContent = settings.alexaConnected ? t('alexaConnected') : t('alexaNotConnected');
  $('#alexaDot').classList.toggle('connected', !!settings.alexaConnected);
}
function filteredItems(){
  return state.filter(item => {
    const st=statusOf(item);
    const byFilter = filter==='all' || filter===st;
    const byCat = categoryFilter==='all' || item.category===categoryFilter;
    const bySearch = !searchTerm || nameOf(item).toLowerCase().includes(searchTerm);
    return byFilter && byCat && bySearch;
  });
}
function renderProducts(){
  const html = filteredItems().map(productRow).join('') || `<div class="info-strip"><span>i</span><p>${esc(t('noBuy'))}</p></div>`;
  $('#productList').innerHTML=html;
  bindProductControls($('#productList'));
  renderStats(); renderSide();
}
function productRow(item){
  const st=statusOf(item), pct=stockPercent(item);
  const options=item.unitOptions.map(u=>`<option value="${u}" ${u===item.unit?'selected':''}>${esc(u)}</option>`).join('');
  return `<article class="product-row" data-id="${esc(item.id)}">
    <img class="product-img" src="${esc(item.image)}" alt="${esc(nameOf(item))}">
    <div class="product-title">
      <h4>${esc(nameOf(item))}</h4>
      <p>${esc(catName(item.category))}</p>
      <div class="qty-grid">
        <div class="qty-box"><span class="mini-label">${t('qty')}</span><div class="qty-controls"><button data-step="-1">−</button><div class="qty-value">${item.qty}</div><button data-step="1">+</button></div></div>
        <div class="unit-box"><span class="mini-label">${t('unit')}</span><select data-unit>${options}</select></div>
      </div>
    </div>
    <div class="status-block">
      <div class="bar-labels"><span>${t('inStock')}</span><span>${t('buyStock')}</span></div>
      <div class="stock-bar"><span class="stock-knob" style="left:${pct}%"></span></div>
      <div class="bar-meta"><span>${item.qty} ${esc(item.unit)}</span><span>${st==='buy'?t('lowStock'):t('goodStock')}</span></div>
      <span class="availability ${st}">${st==='buy'?t('lowStock'):t('goodStock')}</span>
    </div>
  </article>`;
}
function bindProductControls(root){
  root.querySelectorAll('[data-step]').forEach(btn => btn.addEventListener('click', () => {
    const id=btn.closest('.product-row').dataset.id, step=Number(btn.dataset.step);
    const item=state.find(x=>x.id===id); if(!item) return;
    const oldQty = item.qty;
    item.qty=Math.max(0, Math.min(recommendedQty(item), item.qty + step));
    if(step<0) item.usage++;
    if(item.qty < oldQty) rememberEvent('consume', item, oldQty-item.qty, 'manual decrease');
    if(item.qty > oldQty) rememberEvent('restock', item, item.qty-oldQty, 'manual increase');
    item.updatedAt=Date.now(); saveAll(); render();
  }));
  root.querySelectorAll('[data-unit]').forEach(sel => sel.addEventListener('change', () => {
    const id=sel.closest('.product-row').dataset.id, item=state.find(x=>x.id===id); if(!item) return;
    item.unit=sel.value; item.updatedAt=Date.now(); saveAll(); render();
  }));
}
function renderSide(){
  const list = buyItems();
  $('#quickList').innerHTML = list.length ? list.slice(0,4).map(sideItem).join('') : `<div class="side-item"><strong>${t('noBuy')}</strong></div>`;
  const sug = [...state].sort((a,b)=>suggestionScore(b)-suggestionScore(a)).slice(0,4);
  $('#suggestedMini').innerHTML = sug.map(sideItem).join('');
}
function sideItem(item){ return `<div class="side-item"><img src="${esc(item.image)}" alt=""><div><strong>${esc(nameOf(item))}</strong><small>${item.qty} ${esc(item.unit)}</small></div></div>`; }
function renderAllProducts(){ $('#allProductsList').innerHTML = state.map(productRow).join(''); bindProductControls($('#allProductsList')); }
function renderShoppingFull(){
  const items=buyItems();
  $('#shoppingListFull').innerHTML = items.length ? items.map(i=>`<div class="shopping-card"><img src="${esc(i.image)}" alt=""><div><strong>${esc(nameOf(i))}</strong><p>${i.qty} ${esc(i.unit)} · ${t('lowStock')}</p></div></div>`).join('') : `<div class="info-strip success"><span>✓</span><p>${t('noBuy')}</p></div>`;
}
function renderSuggestions(){
  $('#smartPeople').textContent=settings.people; $('#smartAnimals').textContent=settings.animals; $('#smartMode').textContent=settings.autoSmart?'ON':'OFF';
  const items=[...state].sort((a,b)=>suggestionScore(b)-suggestionScore(a)).slice(0,6);
  $('#smartSuggestions').innerHTML=items.map(item=>{
    const th=smartThreshold(item), rec=recommendedQty(item), pct=Math.min(100,Math.max(8,(item.qty/Math.max(th,1))*100));
    return `<article class="suggest-card"><img src="${esc(item.image)}" alt=""><div><h3>${esc(nameOf(item))}</h3><p>${esc(catName(item.category))}</p><p class="alert">⚠ ${statusOf(item)==='buy'?t('lowStock'):t('goodStock')}</p><p>${item.qty} ${esc(item.unit)} / min ${th} ${esc(item.unit)}</p><div class="progress"><span style="width:${pct}%"></span></div><p>Consigliato: ${rec} ${esc(item.unit)}</p><button class="primary-btn" data-suggest="${esc(item.id)}">${t('toBuy')}</button></div></article>`;
  }).join('');
  $('#smartSuggestions').querySelectorAll('[data-suggest]').forEach(b=>b.addEventListener('click',()=>{ const i=state.find(x=>x.id===b.dataset.suggest); if(i){ i.qty=0; i.updatedAt=Date.now(); saveAll(); render(); toast(t('saved')); }}));
}
function renderSettings(){
  $('#settingsPeople').value=settings.people; $('#settingsAnimals').value=settings.animals; $('#autoSmartToggle').checked=!!settings.autoSmart; $('#cloudEnabled').checked=!!settings.cloudEnabled;
  $('#apiEndpoint').value=settings.apiEndpoint; $('#householdId').value=settings.householdId; $('#apiToken').value=settings.token;
  const p = settings.profile || {};
  $('#profileFirstName').value = p.firstName || session.user?.firstName || '';
  $('#profileLastName').value = p.lastName || session.user?.lastName || '';
  $('#profileUsername').value = p.username || session.user?.username || '';
  $('#profileEmail').value = p.email || session.user?.email || '';
  $('#profilePeople').value = settings.people;
  $('#profileAnimals').value = settings.animals;
  const full = `${$('#profileFirstName').value} ${$('#profileLastName').value}`.trim() || $('#profileUsername').value || t('registerOrLogin');
  $('#profileDisplayName').textContent = full;
  $('#profileStatusText').textContent = session.user ? (session.user.email || p.email || t('registered')) : t('profileGuestText');
  const initials = ((($('#profileFirstName').value||'')[0]||'') + ((($('#profileLastName').value||'')[0]||'') || (($('#profileUsername').value||'')[0]||''))).toUpperCase() || 'SP';
  $('#profileAvatar').textContent = initials;
  $('#goRegisterBtn').textContent = session.user ? t('navSettings') : t('registerOrLogin');
}
function saveSettingsFromForm(){
  settings.people=Number($('#settingsPeople').value)||1; settings.animals=Number($('#settingsAnimals').value)||0; settings.autoSmart=$('#autoSmartToggle').checked;
  settings.cloudEnabled=$('#cloudEnabled').checked; settings.apiEndpoint=$('#apiEndpoint').value.trim()||settings.apiEndpoint;
  saveAll(); render(); toast(t('saved'));
}
async function register(e){
  e.preventDefault();
  const answer=Number($('#regCaptcha').value);
  if(answer!==captcha.ans){ toast(t('wrongCaptcha')); captcha=newCaptcha(); $('#regCaptcha').value=''; $('#regCaptcha').placeholder=captcha.q; return; }
  const firstName=$('#regFirstName').value.trim(), lastName=$('#regLastName').value.trim(), username=$('#regUsername').value.trim(), email=$('#regEmail').value.trim(), password=$('#regPassword').value;
  if(!firstName||!lastName||!username||!email||!password){ toast(t('required')); return; }
  settings.people=Number($('#regPeople').value)||1; settings.animals=Number($('#regAnimals').value)||0; settings.autoSmart=$('#regAutoSmart').checked; settings.apiEndpoint=$('#regEndpoint').value.trim()||settings.apiEndpoint;
  settings.profile = { firstName, lastName, username, email };
  try{
    const res=await fetch(`${settings.apiEndpoint}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName,lastName,username,email,password,people:settings.people,animals:settings.animals,autoSmart:settings.autoSmart,items:state})});
    if(!res.ok) throw new Error('register fail');
    const data=await res.json(); settings.token=data.token; settings.householdId=data.householdId; settings.cloudEnabled=true; session={mode:'registered',user:data.user};
    saveAll(); await syncCloud(true); toast(t('saved')); showView('dashboard');
  }catch(err){
    session={mode:'offline',user:{firstName,lastName,username,email}}; settings.cloudEnabled=false; saveAll(); toast('Offline: account locale salvato'); showView('dashboard');
  }
}
function openAdd(){ $('#productDialog').showModal(); }
function addCustom(e){
  e.preventDefault();
  const names={it:$('#customNameIt').value.trim(),en:$('#customNameEn').value.trim(),es:$('#customNameEs').value.trim(),de:$('#customNameDe').value.trim()};
  if(!names.it){ toast(t('required')); return; }
  ['en','es','de'].forEach(k=>{ if(!names[k]) names[k]=names.it; });
  state.unshift(createItem(cryptoId(),'assets/illustrations/generic-item.png',$('#customCategory').value,names,1,6,2,['pz','pc','lt','kg'],{custom:true}));
  $('#productDialog').close(); $('#customProductForm').reset(); saveAll(); render(); toast(t('added'));
}
function shoppingDone(){ state=state.map(i=>{ const newQty=recommendedQty(i); if(newQty>i.qty) rememberEvent('restock', i, newQty-i.qty, 'shopping done'); return {...i,qty:newQty,updatedAt:Date.now()}; }); saveAll(); render(); toast(t('saved')); }
async function copyList(){ const txt=buyItems().map(i=>`- ${nameOf(i)} (${i.qty} ${i.unit})`).join('\n') || t('noBuy'); await navigator.clipboard.writeText(txt).catch(()=>{}); toast(t('copied')); }
function connectAlexa(){ settings.alexaConnected=true; saveAll(); render(); syncCloud(true); toast(t('alexaConnected')); }
async function copyAlexaEndpoint(){ const url=`${settings.apiEndpoint.replace(/\/$/,'')}/alexa?householdId=${encodeURIComponent(settings.householdId||'DEMO')}`; await navigator.clipboard.writeText(url).catch(()=>{}); toast(t('copied')); }
function scheduleSync(){ clearTimeout(syncTimer); if(settings.cloudEnabled) syncTimer=setTimeout(()=>syncCloud(false), SYNC_WAIT); }
async function syncCloud(show){
  if(!settings.cloudEnabled || !settings.apiEndpoint || !settings.token || !settings.householdId){ if(show) toast(t('syncFail')); return; }
  try{
    const payload={items:state, settings:{people:settings.people,animals:settings.animals,autoSmart:settings.autoSmart,lang:settings.lang,alexaConnected:settings.alexaConnected,profile:settings.profile}, aiMemory};
    const res=await fetch(`${settings.apiEndpoint}/households/${settings.householdId}/state`,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':`Bearer ${settings.token}`},body:JSON.stringify(payload)});
    if(!res.ok) throw new Error('sync fail');
    if(show) toast(t('synced'));
  }catch(err){ if(show) toast(t('syncFail')); }
}


function userDisplayName(){
  const p=settings.profile||{};
  return [p.firstName,p.lastName].filter(Boolean).join(' ').trim() || p.username || session.user?.firstName || session.user?.username || 'amico';
}
function timeGreeting(){
  const h=new Date().getHours();
  if(h<12) return 'Buongiorno';
  if(h<18) return 'Buon pomeriggio';
  return 'Buonasera';
}
function aiGreetingText(){
  const name=userDisplayName();
  const pending=aiMemory.pendingVerification ? ' Hai anche una spesa segnata come “da verificare”: posso aiutarti con le foto.' : '';
  const facts=(aiMemory.facts||[]).slice(-3).map(f=>f.text).join(' · ');
  return `${timeGreeting()} ${name}! Sono Spesa Pronta AI: ricordo le nostre chat, imparo i tuoi consumi e posso modificare la lista. Puoi dirmi “hey spesa pronta” oppure fotografare la spesa articolo per articolo.${pending}${facts?` Ricordo anche: ${facts}.`:''}`;
}
function maybeDailyGreeting(){
  const today=new Date().toISOString().slice(0,10);
  if(aiMemory.lastGreetingDate!==today && (aiMemory.messages||[]).length){
    aiMemory.lastGreetingDate=today;
    aiMemory.messages.push({role:'assistant',text:aiGreetingText(),at:Date.now(),daily:true});
    aiMemory.messages=aiMemory.messages.slice(-600);
    saveAiMemory();
  }
}
function learnFromUserText(text){
  const q=normalizeText(text);
  const patterns=['mi piace','non mi piace','di solito','compro sempre','consumo spesso','preferisco','ricorda','ricordati'];
  if(patterns.some(p=>q.includes(p))){
    aiMemory.facts=aiMemory.facts||[];
    const fact={text:String(text).trim(), at:Date.now(), source:'chat'};
    if(fact.text && !aiMemory.facts.some(f=>normalizeText(f.text)===normalizeText(fact.text))) aiMemory.facts.push(fact);
    aiMemory.facts=aiMemory.facts.slice(-200);
  }
}
function memorySummaryText(){
  const facts=(aiMemory.facts||[]).slice(-8).map(f=>'• '+f.text).join('\n');
  const msgs=(aiMemory.messages||[]).length;
  const scans=(aiMemory.scanHistory||[]).length;
  return `Ricordo ${msgs} messaggi, ${scans} foto spesa e queste preferenze:\n${facts||'Ancora nessuna preferenza salvata.'}`;
}

function openAiPanel(){
  $('#aiPanel').classList.remove('hidden');
  maybeDailyGreeting();
  updateAiBackendStatus();
  if(!aiMemory.messages?.length){
    addAiMessage('assistant', aiGreetingText());
  } else renderAiMessages();
  setTimeout(()=>$('#aiInput')?.focus(),80);
}
async function updateAiBackendStatus(){
  const el=$('#aiStatusText'); if(!el || !settings.apiEndpoint) return;
  try{
    const res=await fetch(`${settings.apiEndpoint.replace(/\/$/,'')}/ai/status`);
    if(!res.ok) throw new Error('status');
    const data=await res.json();
    el.textContent = data.connected ? `AI vera collegata: chat + vision attive (${data.model}).` : 'AI locale attiva. Per Vision vera manca la chiave OpenAI nel backend.';
  }catch{
    el.textContent='AI locale attiva. Backend non raggiungibile o non ancora online.';
  }
}
function closeAiPanel(){ $('#aiPanel').classList.add('hidden'); }
function addAiMessage(role,text){
  aiMemory.messages = aiMemory.messages || [];
  aiMemory.messages.push({role,text,at:Date.now()});
  aiMemory.messages = aiMemory.messages.slice(-600);
  if(role==='user') learnFromUserText(text);
  saveAiMemory(); renderAiMessages();
}
function renderAiMessages(){
  const box=$('#aiMessages'); if(!box) return;
  box.innerHTML=(aiMemory.messages||[]).map(m=>`<div class="ai-msg ${m.role}">${esc(m.text)}</div>`).join('');
  box.scrollTop=box.scrollHeight;
}
async function submitAiForm(e){
  e.preventDefault();
  const input=$('#aiInput');
  const txt=input.value.trim();
  if(!txt) return;
  input.value='';
  await handleAiText(txt,false);
}
async function handleAiText(text, speak=false){
  openAiPanel();
  const cleaned=text.replace(/hey\s+spesa\s+pronta[:,]?/i,'').trim() || text;
  addAiMessage('user', cleaned);
  const answer=await aiAnswer(cleaned);
  addAiMessage('assistant', answer);
  if(speak && 'speechSynthesis' in window){
    const u=new SpeechSynthesisUtterance(answer); u.lang='it-IT'; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
function normalizeText(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function findItemBySpeech(query){
  const q=normalizeText(query);
  let best=null, bestLen=0;
  for(const item of state){
    const names=[item.id,...Object.values(item.names||{})].map(normalizeText);
    for(const n of names){
      if(n && (q.includes(n) || n.includes(q)) && n.length>bestLen){ best=item; bestLen=n.length; }
    }
  }
  return best;
}
function extractNumber(text){ const m=normalizeText(text).match(/(\d+(?:[\.,]\d+)?)/); return m ? Number(m[1].replace(',','.')) : null; }
function listBuyText(){
  const list=buyItems();
  if(!list.length) return 'Non manca niente: la lista della spesa è vuota.';
  return 'Devi comprare: '+list.map(i=>`${nameOf(i)} (${i.qty} ${i.unit})`).join(', ')+'.';
}
function aiExplainItem(item){
  const th=smartThreshold(item), vel=aiVelocity(item), days=vel>0 ? Math.max(0, item.qty/vel) : null;
  let txt=`${nameOf(item)}: hai ${item.qty} ${item.unit}. La soglia intelligente è ${th} ${item.unit}.`;
  if(days!==null) txt+=` In base ai consumi registrati durerebbe circa ${days.toFixed(1)} giorni.`;
  txt+= statusOf(item)==='buy' ? ' Per questo lo metto in lista.' : ' Per ora la scorta sembra buona.';
  return txt;
}
async function aiAnswer(text){
  const raw=text.trim();
  const q=normalizeText(raw);
  let m;
  if(q.includes('buongiorno') || q.includes('ciao') || q.includes('buonasera')) return aiGreetingText();
  if(q.includes('cosa ricordi') || q.includes('che ricordi') || q.includes('memoria')) return memorySummaryText();
  if(q.includes('dimentica tutto') || q.includes('cancella memoria')){ aiMemory={messages:[],facts:[],events:[],scanHistory:[],pendingVerification:false,lastGreetingDate:'',summary:'',lastInsights:{},personality:{warmth:1}}; saveAiMemory(); return 'Ok, ho cancellato la memoria locale dell’assistente.'; }
  if(q.includes('fotografa') || q.includes('foto spesa') || q.includes('scanner') || q.includes('modalita frigo')){ openGroceryScanner(false); return 'Perfetto, ho aperto la modalità foto spesa. Fotografa un articolo alla volta: se non vedo bene ti chiedo di rifarla.'; }
  if(q.includes('cosa devo comprare') || q.includes('lista della spesa') || q.includes('che manca') || q.includes('cosa manca')) return listBuyText();
  if(q.includes('ho fatto la spesa') || q.includes('spesa fatta')){ openGroceryScanner(true); return 'Perfetto. Prima di chiudere la spesa ti propongo il controllo con foto: scatta un articolo alla volta, oppure segna “fatta da verificare”.'; }
  m=q.match(/siamo\s+(\d+)\s+persone|(?:metti|imposta|aggiorna).*?(\d+)\s+persone/);
  if(m){ settings.people=Number(m[1]||m[2]); saveAll(); render(); return `Ok, ho aggiornato il profilo: ${settings.people} persone in casa. Ora ricalcolo acqua, alimenti e scorte.`; }
  m=q.match(/(?:ho|abbiamo|siamo).*?(\d+)\s+(?:animali|cani|gatti)|(?:metti|imposta|aggiorna).*?(\d+)\s+(?:animali|cani|gatti)/);
  if(m){ settings.animals=Number(m[1]||m[2]); saveAll(); render(); return `Ok, ho aggiornato il profilo: ${settings.animals} animali. Ora ricalcolo crocchette, sacchetti e prodotti animali.`; }
  m=q.match(/(?:segna|imposta|metti|porta)\s+(.+?)\s+(?:a|ad)\s+(\d+(?:[\.,]\d+)?)\s*([a-z]*)/);
  if(m){
    const item=findItemBySpeech(m[1]);
    if(!item) return `Non ho trovato “${m[1]}”. Posso aggiungerlo come nuovo articolo se mi dici la categoria.`;
    const old=item.qty; item.qty=Number(m[2].replace(',','.')); if(m[3]) item.unit=m[3];
    if(item.qty<old) rememberEvent('consume',item,old-item.qty,'AI set quantity'); else if(item.qty>old) rememberEvent('restock',item,item.qty-old,'AI set quantity');
    item.updatedAt=Date.now(); saveAll(); render(); return `Fatto: ${nameOf(item)} ora è a ${item.qty} ${item.unit}. Ho aggiornato anche i consumi.`;
  }
  if(q.includes('aggiungi') || q.includes('metti in lista') || q.includes('comprare')){
    const guess=raw.replace(/hey\s+spesa\s+pronta[:,]?/i,'').replace(/aggiungi|metti in lista|da comprare|comprare|alla lista/gi,'').trim();
    const item=findItemBySpeech(guess||raw);
    if(item){ const old=item.qty; item.qty=0; item.usage=(item.usage||0)+1; rememberEvent('consume',item,old,'AI add to list'); item.updatedAt=Date.now(); saveAll(); render(); return `Ok, ho messo ${nameOf(item)} nella lista della spesa.`; }
    const names={it:guess||'Nuovo articolo', en:guess||'New item', es:guess||'Nuevo artículo', de:guess||'Neuer Artikel'};
    const newItem=createItem(cryptoId(),'assets/illustrations/generic-item.png','food',names,0,6,2,['pz','pc','kg','lt'],{custom:true,usage:1});
    state.unshift(newItem); rememberEvent('consume',newItem,1,'AI created item'); saveAll(); render(); return `Non era nel catalogo: ho creato “${names.it}” e l'ho messo nella lista.`;
  }
  if(q.includes('perche') || q.includes('spiega')){
    const item=findItemBySpeech(raw) || [...state].sort((a,b)=>suggestionScore(b)-suggestionScore(a))[0];
    return item ? aiExplainItem(item) : 'Uso persone, animali, storico consumi, soglia minima e giorni stimati per decidere cosa suggerire.';
  }
  if(q.includes('consumi') || q.includes('analisi')){
    const urgent=[...state].sort((a,b)=>suggestionScore(b)-suggestionScore(a)).slice(0,3);
    return 'Analisi AI: '+urgent.map(aiExplainItem).join(' ');
  }
  if(q.includes('ricorda') || q.includes('ricordati')){
    aiMemory.facts=aiMemory.facts||[]; aiMemory.facts.push({text:raw,at:Date.now()}); aiMemory.facts=aiMemory.facts.slice(-80); saveAiMemory(); return 'Memorizzato. Userò questa informazione per adattare meglio i suggerimenti.';
  }
  const backend = await askBackendAi(raw).catch(()=>null);
  if(backend) return backend;
  return `Ho capito. Lo tengo a mente e continuo ad adattarmi a te. Posso leggere la lista, aggiungere articoli, modificare quantità, aggiornare persone/animali, ricordare preferenze e analizzare foto spesa. Prova: “hey spesa pronta, fotografa la spesa”.`;
}
async function askBackendAi(message){
  if(!settings.apiEndpoint) return null;
  const res=await fetch(`${settings.apiEndpoint.replace(/\/$/,'')}/ai/chat`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${settings.token||''}`},body:JSON.stringify({message,state,settings,memory:aiMemory})});
  if(!res.ok) return null;
  const data=await res.json(); return data.reply || null;
}

function openGroceryScanner(afterShopping=false){
  const dlg=$('#groceryScannerDialog'); if(!dlg) return;
  dlg.dataset.afterShopping = afterShopping ? '1' : '0';
  $('#scannerStatus').textContent = afterShopping ? 'Hai premuto “Ho fatto la spesa”. Ora puoi fotografare ogni prodotto prima di metterlo in frigo/dispensa, oppure segnare la spesa come fatta ma da verificare.' : 'Fotografa un articolo alla volta. L’AI prova a riconoscerlo, ti fa modificare nome/quantità e poi aggiorna le scorte.';
  try{ dlg.showModal(); }catch{ dlg.setAttribute('open',''); }
  openAiPanel();
}
function closeGroceryScanner(){ const dlg=$('#groceryScannerDialog'); if(dlg?.open) dlg.close(); else dlg?.removeAttribute('open'); }
function resetScannerResults(){ $('#scannerResults').innerHTML=''; $('#scannerPreview').innerHTML=''; $('#scannerStatus').textContent='Risultati svuotati. Puoi scattare nuove foto.'; }
function finishScanner(){
  aiMemory.pendingVerification=false; saveAiMemory(); saveAll(); render(); closeGroceryScanner();
  addAiMessage('assistant','Controllo foto completato. Ho aggiornato gli articoli riconosciuti e salvato la memoria della spesa.');
  toast('Controllo spesa completato ✅');
}
function markShoppingDoneToVerify(){
  completeShoppingDone(true); closeGroceryScanner();
  addAiMessage('assistant','Ok, ho segnato la spesa come fatta ma da verificare. Quando puoi, riapri Foto spesa e controlliamo prodotto per prodotto.');
}
function startFridgeMode(){
  $('#scannerStatus').textContent='Modalità frigo attiva: scatta una foto per ogni prodotto mentre lo appoggi davanti al frigo. Se la foto è chiara, lo aggiungo o aggiorno la quantità.';
  $('#groceryPhotoInput')?.click();
}
async function handleGroceryFiles(files){
  const arr=[...(files||[])]; if(!arr.length) return;
  for(const file of arr) await analyzeGroceryPhoto(file);
  $('#groceryPhotoInput').value=''; $('#groceryGalleryInput').value='';
}
function loadImageElement(dataUrl){
  return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=dataUrl; });
}
function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
}
async function compressImage(dataUrl,max=900,quality=.78){
  const img=await loadImageElement(dataUrl); const scale=Math.min(1,max/Math.max(img.width,img.height));
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
  const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',quality);
}
async function imageQuality(dataUrl){
  const img=await loadImageElement(dataUrl); const c=document.createElement('canvas'); const w=96,h=96; c.width=w;c.height=h;
  const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data; let lum=[],sum=0;
  for(let i=0;i<d.length;i+=4){ const l=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]; lum.push(l); sum+=l; }
  const avg=sum/lum.length; const contrast=Math.sqrt(lum.reduce((s,l)=>s+(l-avg)**2,0)/lum.length);
  let edge=0; for(let y=1;y<h;y++){ for(let x=1;x<w;x++){ const a=lum[y*w+x], b=lum[y*w+x-1], c2=lum[(y-1)*w+x]; edge+=Math.abs(a-b)+Math.abs(a-c2); }}
  edge=edge/(w*h);
  const ok=img.width>=480 && img.height>=480 && avg>35 && avg<230 && contrast>14 && edge>5;
  const reason = !ok ? (img.width<480||img.height<480?'foto troppo piccola':avg<=35?'foto troppo scura':avg>=230?'foto troppo chiara':contrast<=14?'poco contrasto / prodotto poco visibile':'foto un po’ sfocata') : 'foto leggibile';
  return {ok,reason,width:img.width,height:img.height,avg,contrast,edge};
}
async function analyzeGroceryPhoto(file){
  const original=await fileToDataUrl(file);
  const dataUrl=await compressImage(original);
  $('#scannerPreview').innerHTML=`<img src="${dataUrl}" alt="Foto articolo"><p>Analizzo la foto...</p>`;
  const quality=await imageQuality(dataUrl).catch(()=>({ok:false,reason:'non riesco a leggere la foto'}));
  if(!quality.ok){
    $('#scannerStatus').textContent=`Non vedo bene: ${quality.reason}. Rifai la foto più vicino, con luce buona e prodotto centrato.`;
    addScannerResult({needsRetake:true, reason:quality.reason, dataUrl});
    return;
  }
  let result=await askVisionAi(dataUrl).catch(()=>null);
  if(!result || result.needsManual){ result=guessScanFallback(file.name,dataUrl); }
  if(result.needsRetake){ $('#scannerStatus').textContent=result.reason || 'Non vedo bene, rifai la foto.'; addScannerResult({...result,dataUrl}); return; }
  result.dataUrl=dataUrl; result.quality=quality;
  addScannerResult(result);
  $('#scannerStatus').textContent='Foto letta. Controlla nome e quantità, poi conferma.';
}
function guessScanFallback(fileName='',dataUrl=''){
  const base=String(fileName).replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').trim();
  const name=base && !/^image|img|photo|screenshot|camera/i.test(base) ? base : '';
  return {needsManual:true, productName:name, quantity:1, unit:'pz', category:'food', confidence:.35, reason:'Vision AI esterna non collegata: conferma manualmente nome e quantità.'};
}
async function askVisionAi(dataUrl){
  if(!settings.apiEndpoint) return null;
  const catalog=state.map(i=>({id:i.id,names:i.names,unit:i.unit,unitOptions:i.unitOptions,category:i.category,qty:i.qty}));
  const res=await fetch(`${settings.apiEndpoint.replace(/\/$/,'')}/ai/vision`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${settings.token||''}`},body:JSON.stringify({image:dataUrl,catalog,settings,memory:aiMemory})});
  if(!res.ok) return null; const data=await res.json(); return data.result || data;
}
function addScannerResult(result){
  const id='scan_'+Math.random().toString(36).slice(2,9);
  const html=`<article class="scan-result ${result.needsRetake?'bad':''}" id="${id}">
    <img src="${esc(result.dataUrl||'assets/illustrations/generic-item.png')}" alt="Foto prodotto">
    <div class="scan-fields">
      <strong>${result.needsRetake?'Foto da rifare':'Prodotto riconosciuto'}</strong>
      <p>${esc(result.reason || (result.confidence?`Confidenza AI ${Math.round(result.confidence*100)}%`:'Controlla e conferma.'))}</p>
      ${result.needsRetake?'<button class="outline-btn" data-retake>Rifai foto</button>':`
      <label>Nome prodotto<input data-scan-name value="${esc(result.productName||'')}"></label>
      <div class="scan-grid"><label>Quantità<input data-scan-qty type="number" min="0" step="0.1" value="${esc(result.quantity||1)}"></label><label>Unità<input data-scan-unit value="${esc(result.unit||'pz')}"></label></div>
      <label>Categoria<select data-scan-cat>${categoryOptions(result.category||'food')}</select></label>
      <button class="primary-btn" data-confirm-scan>Conferma e aggiungi in casa</button>`}
    </div>
  </article>`;
  $('#scannerResults').insertAdjacentHTML('afterbegin',html);
  const el=$('#'+id);
  el.querySelector('[data-retake]')?.addEventListener('click',()=>$('#groceryPhotoInput')?.click());
  el.querySelector('[data-confirm-scan]')?.addEventListener('click',()=>confirmScanResult(el,result));
}
function categoryOptions(selected){
  return ['food','drinks','pets','house','pharmacy','aquarium','fruit','veg'].map(c=>`<option value="${c}" ${c===selected?'selected':''}>${esc(catName(c))}</option>`).join('');
}
function confirmScanResult(el,result){
  const productName=el.querySelector('[data-scan-name]').value.trim();
  const qty=Number(el.querySelector('[data-scan-qty]').value)||1;
  const unit=el.querySelector('[data-scan-unit]').value.trim()||'pz';
  const category=el.querySelector('[data-scan-cat]').value||'food';
  if(!productName){ toast('Inserisci il nome prodotto'); return; }
  const item=findItemBySpeech(productName);
  if(item){
    const old=item.qty; item.qty=qty; item.unit=unit; item.updatedAt=Date.now(); item.usage=Number(item.usage||0)+1;
    rememberEvent('photo_restock',item,Math.max(0,qty-old),'Foto spesa confermata');
    el.classList.add('confirmed'); el.querySelector('.scan-fields strong').textContent='Aggiornato: '+nameOf(item);
  }else{
    const names={it:productName,en:productName,es:productName,de:productName};
    const img=result.dataUrl || 'assets/illustrations/generic-item.png';
    const newItem=createItem(cryptoId(),img,category,names,qty,Math.max(6,Math.ceil(qty*2)),Math.max(1,Math.ceil(qty*.35)),['pz','kg','lt','gr','cf','bt'],{custom:true,usage:1});
    newItem.unit=unit; state.unshift(newItem); rememberEvent('photo_new_item',newItem,qty,'Foto spesa nuovo articolo');
    el.classList.add('confirmed'); el.querySelector('.scan-fields strong').textContent='Aggiunto: '+productName;
  }
  aiMemory.scanHistory=aiMemory.scanHistory||[];
  aiMemory.scanHistory.push({name:productName,qty,unit,category,at:Date.now(),confidence:result.confidence||null});
  aiMemory.scanHistory=aiMemory.scanHistory.slice(-300); aiMemory.pendingVerification=false;
  saveAiMemory(); saveAll(); render(); toast('Articolo aggiornato in casa ✅');
}

function startAiVoiceOnce(){
  const SR=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ toast('Microfono vocale non supportato da questo browser'); return; }
  const r=new SR(); r.lang='it-IT'; r.interimResults=false; r.continuous=false;
  r.onstart=()=>{ $('#aiStatusText').textContent='Ti ascolto...'; };
  r.onresult=e=>{ const txt=e.results[0][0].transcript; handleAiText(txt,true); };
  r.onerror=()=>toast('Non ho capito, riprova');
  r.onend=()=>{ $('#aiStatusText').textContent='Dimmi cosa comprare, modificare o imparare.'; };
  r.start();
}
function toggleWakeWord(on){
  const SR=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ $('#aiWakeToggle').checked=false; toast('Wake word non supportato da questo browser'); return; }
  if(aiRecognition){ aiRecognition.stop(); aiRecognition=null; }
  aiListening=on;
  if(!on) return;
  aiRecognition=new SR(); aiRecognition.lang='it-IT'; aiRecognition.continuous=true; aiRecognition.interimResults=false;
  aiRecognition.onresult=e=>{
    for(let i=e.resultIndex;i<e.results.length;i++){
      const txt=e.results[i][0].transcript;
      if(normalizeText(txt).includes('hey spesa pronta')) handleAiText(txt,true);
    }
  };
  aiRecognition.onend=()=>{ if(aiListening) { try{ aiRecognition.start(); }catch{} } };
  try{ aiRecognition.start(); toast('Wake word attivo: dì “Hey Spesa Pronta”'); }catch{}
}

init();
