// Spesa Pronta V27.73 - backend cloud reale per /api
// Avvio: npm install && npm start
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Database persistente:
    // - Render/Railway/VPS: imposta DATA_DIR=/var/data oppure monta un disco persistente su /var/data
    // - Locale: usa .data nella cartella progetto
const DEFAULT_DATA_DIR = fs.existsSync('/var/data') ? '/var/data' : path.join(__dirname, '.data');
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'cloud-db.json');

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

function emptyDb(){
  return { users:{}, households:{}, tokens:{}, meta:{ createdAt:Date.now(), version:'V27.87 DB PERSISTENT' } };
}
function ensureDb(){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(DB_FILE)){
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2));
  }
}
function readDb(){
  ensureDb();
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users = db.users || {};
    db.households = db.households || {};
    db.tokens = db.tokens || {};
    db.meta = db.meta || {};
    return db;
  } catch(err) {
    try {
      const backup = path.join(DATA_DIR, `cloud-db-corrupt-${Date.now()}.json`);
      if(fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, backup);
    } catch {}
    const db = emptyDb();
    writeDb(db);
    return db;
  }
}
function writeDb(db){
  ensureDb();
  db.meta = db.meta || {};
  db.meta.updatedAt = Date.now();
  db.meta.version = 'V27.87 DB PERSISTENT';
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function id(prefix='id'){
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}
function token(){
  return `sp_${crypto.randomBytes(18).toString('hex')}`;
}
function hashPassword(password=''){
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}
function sanitizeUser(u){
  if(!u) return null;
  const { passwordHash, ...safe } = u;
  return safe;
}
function auth(req, db){
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim()
    || String(req.query.token || '').trim()
    || String(req.body?.token || '').trim();
  if(!raw) return null;
  const authData = db.tokens[raw];
  if(!authData) return null;
  return { token: raw, ...authData };
}
function defaultState(){
  return { items: [], settings: {}, aiMemory: null, updatedAt: Date.now() };
}
function authPayload(db, user, householdId, rawToken){
  const household = db.households[householdId] || defaultState();
  return {
    ok: true,
    user: sanitizeUser(user),
    householdId,
    token: rawToken,
    items: Array.isArray(household.items) ? household.items : [],
    settings: { ...(household.settings || {}), cloudEnabled: true },
    aiMemory: household.aiMemory || null
  };
}

app.get('/api/health', (req,res) => {
  const db = readDb();
  res.json({
    ok:true,
    app:'Spesa Pronta',
    version:'V27.87 DB PERSISTENT',
    time:new Date().toISOString(),
    db:{
      persistent: DATA_DIR.includes('/var/data') || !!process.env.DATA_DIR || !!process.env.DB_FILE,
      dataDir: DATA_DIR,
      users:Object.keys(db.users||{}).length,
      households:Object.keys(db.households||{}).length
    }
  });
});

app.post('/api/auth/register', (req,res) => {
  const db = readDb();
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if(!email || !username || password.length < 4) return res.status(400).json({ error:'required' });
  if(db.users[email]) return res.status(409).json({ error:'email_exists' });

  const householdId = id('home');
  const rawToken = token();
  const user = {
    id: id('user'),
    firstName: b.firstName || '',
    lastName: b.lastName || '',
    username,
    email,
    phoneCountry: b.phoneCountry || '+39',
    phoneNumber: b.phoneNumber || '',
    passwordHash: hashPassword(password),
    householdId,
    createdAt: Date.now()
  };

  db.users[email] = user;
  db.tokens[rawToken] = { email, householdId };
  db.households[householdId] = {
    items: Array.isArray(b.items) ? b.items : [],
    settings: {
      people: Number(b.people || 2),
      animals: Number(b.animals || 0),
      autoSmart: b.autoSmart !== false,
      lang: 'it',
      cloudEnabled: true,
      profile: { firstName:user.firstName,lastName:user.lastName,username:user.username,email:user.email }
    },
    aiMemory: b.aiMemory || null,
    updatedAt: Date.now()
  };
  writeDb(db);
  res.json(authPayload(db, user, householdId, rawToken));
});

app.post('/api/auth/login', (req,res) => {
  const db = readDb();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = db.users[email];
  if(!user || user.passwordHash !== hashPassword(req.body?.password || '')){
    return res.status(401).json({ error:'invalid_credentials' });
  }
  const rawToken = token();
  db.tokens[rawToken] = { email, householdId: user.householdId };
  writeDb(db);
  res.json(authPayload(db, user, user.householdId, rawToken));
});



app.post('/api/auth/delete-account', (req,res) => {
  const db = readDb();
  const authData = auth(req, db);
  if(!authData) return res.status(401).json({ error:'unauthorized' });
  if(String(req.body?.confirm || '').toUpperCase() !== 'ELIMINA'){
    return res.status(400).json({ error:'missing_confirm_text' });
  }
  const email = authData.email;
  const householdId = authData.householdId;
  if(email) delete db.users[email];
  if(householdId) delete db.households[householdId];
  Object.keys(db.tokens || {}).forEach(t => {
    if(db.tokens[t]?.email === email || db.tokens[t]?.householdId === householdId) delete db.tokens[t];
  });
  writeDb(db);
  res.json({ ok:true, deleted:true });
});

app.post('/api/auth/logout', (req,res) => {
  const db = readDb();
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim()
    || String(req.body?.token || '').trim();
  if(raw && db.tokens && db.tokens[raw]){
    delete db.tokens[raw];
    writeDb(db);
  }
  // Logout NON cancella mai utenti, household, lista, AI memory o impostazioni.
  res.json({ ok:true, message:'logout_only_token_removed_profile_kept' });
});

// Compatibilità con il flusso verifica: in questo backend demo la verifica è già completata.
app.post('/api/auth/verify-email', (req,res) => res.json({ ok:true }));
app.post('/api/auth/verify-phone', (req,res) => res.json({ ok:true }));
app.post('/api/auth/change-pending-email', (req,res) => res.json({ ok:true, email:req.body?.newEmail || req.body?.email || '' }));

app.get('/api/households/:householdId/state', (req,res) => {
  const db = readDb();
  const household = db.households[req.params.householdId];
  if(!household) return res.status(404).json({ error:'household_not_found' });
  res.json({ ok:true, ...household });
});

app.put('/api/households/:householdId/state', (req,res) => {
  const db = readDb();
  const authData = auth(req, db);
  const householdId = req.params.householdId;
  if(!authData || authData.householdId !== householdId) return res.status(401).json({ error:'unauthorized' });

  db.households[householdId] = {
    items: Array.isArray(req.body?.items) ? req.body.items : [],
    settings: req.body?.settings || {},
    aiMemory: req.body?.aiMemory || null,
    updatedAt: Date.now()
  };
  writeDb(db);
  res.json({ ok:true, householdId, updatedAt: db.households[householdId].updatedAt });
});

// Rotte legacy documentate
app.get('/api/sync', (req,res) => {
  const db = readDb();
  const householdId = String(req.query.householdId || '');
  const household = db.households[householdId];
  if(!household) return res.status(404).json({ error:'household_not_found' });
  res.json({ ok:true, householdId, ...household });
});
app.put('/api/sync', (req,res) => {
  const db = readDb();
  const authData = auth(req, db);
  const householdId = req.body?.householdId || authData?.householdId;
  if(!authData || !householdId || authData.householdId !== householdId) return res.status(401).json({ error:'unauthorized' });
  db.households[householdId] = {
    items: Array.isArray(req.body?.items) ? req.body.items : [],
    settings: req.body?.settings || {},
    aiMemory: req.body?.aiMemory || null,
    updatedAt: Date.now()
  };
  writeDb(db);
  res.json({ ok:true, householdId, updatedAt: db.households[householdId].updatedAt });
});

app.post('/api/assistant/whatsapp-list', (req,res) => {
  const db = readDb();
  const authData = auth(req, db);
  const householdId = req.body?.householdId || authData?.householdId;
  const h = db.households[householdId];
  if(!h) return res.status(404).json({ error:'household_not_found' });
  const items = (h.items || []).filter(i => !i.inStock || i.buy || Number(i.qty||0) <= Number(i.baseThreshold||0));
  const text = items.length ? items.map(i => `- ${i.names?.it || i.name || i.id} (${i.qty || 1} ${i.unit || 'pz'})`).join('\n') : 'Niente da comprare 🎉';
  res.json({ ok:true, text });
});


app.post('/api/google-assistant', (req,res) => {
  const db = readDb();
  const householdId = String(req.query.householdId || req.body?.householdId || '');
  const h = db.households[householdId];
  const items = h ? (h.items || []).filter(i => !i.inStock || i.buy || Number(i.qty||0) <= Number(i.baseThreshold||0)) : [];
  const text = items.length ? `Devi comprare: ${items.map(i => i.names?.it || i.name || i.id).join(', ')}` : 'Non hai niente da comprare.';
  res.json({ ok:true, fulfillmentText:text, speech:text });
});


function alexaSpeech(text, end=true){
  return {
    version:'1.0',
    response:{
      outputSpeech:{ type:'PlainText', text },
      shouldEndSession:end
    }
  };
}
function itemName(i){
  return i?.names?.it || i?.name || i?.id || 'prodotto';
}
function shoppingItems(items=[]){
  return items.filter(i => !i.inStock || i.buy || Number(i.qty||0) <= Number(i.baseThreshold||0));
}
app.post('/api/alexa', (req,res) => {
  const db = readDb();
  const householdId = String(req.query.householdId || req.body?.householdId || '');
  const h = db.households[householdId];
  if(!h) return res.json(alexaSpeech('Non trovo il cloud di Spesa Pronta. Controlla il collegamento della Skill.'));
  const request = req.body?.request || {};
  const intent = request.intent || {};
  const intentName = intent.name || request.type || 'LaunchRequest';

  if(request.type === 'LaunchRequest'){
    return res.json(alexaSpeech('Benvenuto in Spesa Pronta. Puoi chiedermi cosa devi comprare, oppure dirmi aggiungi acqua.'));
  }

  if(intentName === 'AMAZON.HelpIntent'){
    return res.json(alexaSpeech('Puoi dire: cosa devo comprare, aggiungi acqua, oppure segna latte comprato.'));
  }
  if(intentName === 'AMAZON.CancelIntent' || intentName === 'AMAZON.StopIntent'){
    return res.json(alexaSpeech('Va bene, a presto.'));
  }

  const items = Array.isArray(h.items) ? h.items : [];
  const buy = shoppingItems(items);

  if(intentName === 'ReadShoppingListIntent'){
    const speech = buy.length
      ? `Devi comprare: ${buy.map(itemName).join(', ')}.`
      : 'Non hai niente da comprare.';
    return res.json(alexaSpeech(speech));
  }

  if(intentName === 'CountShoppingListIntent'){
    return res.json(alexaSpeech(buy.length ? `Hai ${buy.length} prodotti da comprare.` : 'Non hai prodotti da comprare.'));
  }

  if(intentName === 'AddItemIntent'){
    const name = String(intent.slots?.item?.value || '').trim();
    if(!name) return res.json(alexaSpeech('Dimmi quale prodotto vuoi aggiungere.'));
    const found = items.find(i => itemName(i).toLowerCase() === name.toLowerCase());
    if(found){
      found.inStock = false;
      found.buy = true;
      found.qty = Math.max(0, Number(found.qty || 0));
    }else{
      items.unshift({
        id:`alexa_${Date.now()}`,
        names:{it:name,en:name,es:name,de:name},
        name,
        category:'food',
        qty:0,
        unit:'pz',
        baseThreshold:1,
        maxQty:6,
        inStock:false,
        buy:true,
        custom:true,
        image:'assets/illustrations/generic-item.png'
      });
    }
    h.items = items;
    h.updatedAt = Date.now();
    writeDb(db);
    return res.json(alexaSpeech(`${name} aggiunto alla lista della spesa.`));
  }

  if(intentName === 'MarkBoughtIntent'){
    const name = String(intent.slots?.item?.value || '').trim();
    if(!name) return res.json(alexaSpeech('Dimmi quale prodotto hai comprato.'));
    const found = items.find(i => itemName(i).toLowerCase().includes(name.toLowerCase()));
    if(found){
      found.inStock = true;
      found.buy = false;
      found.qty = Math.max(Number(found.qty || 0), Number(found.baseThreshold || 1) + 1);
      h.updatedAt = Date.now();
      writeDb(db);
      return res.json(alexaSpeech(`${itemName(found)} segnato come comprato.`));
    }
    return res.json(alexaSpeech(`Non ho trovato ${name} nella lista.`));
  }

  return res.json(alexaSpeech('Non ho capito. Puoi dire cosa devo comprare, oppure aggiungi acqua.'));
});



app.get('/api/export-db', (req,res) => {
  const db = readDb();
  const authData = auth(req, db);
  if(!authData) return res.status(401).json({ error:'unauthorized' });
  // Backup utile prima dei deploy: contiene utenti, household e dati cloud.
  res.json({ ok:true, exportedAt:new Date().toISOString(), db });
});

app.use(express.static(PUBLIC_DIR, { maxAge: '0' }));
app.get('*', (req,res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
  ensureDb();
  console.log(`Spesa Pronta cloud backend V27.73 attivo su http://localhost:${PORT}`);
});
