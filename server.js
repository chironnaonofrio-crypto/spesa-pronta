// Spesa Pronta V27.71 - backend cloud reale per /api
// Avvio: npm install && npm start
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'cloud-db.json');

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

function ensureDb(){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(DB_FILE)){
    fs.writeFileSync(DB_FILE, JSON.stringify({ users:{}, households:{}, tokens:{} }, null, 2));
  }
}
function readDb(){
  ensureDb();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users:{}, households:{}, tokens:{} }; }
}
function writeDb(db){
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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
  res.json({ ok:true, app:'Spesa Pronta', version:'V27.71 VOICE SYNC', time:new Date().toISOString() });
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

app.post('/api/alexa', (req,res) => {
  const db = readDb();
  const householdId = String(req.query.householdId || req.body?.householdId || '');
  const h = db.households[householdId];
  const items = h ? (h.items || []).filter(i => !i.inStock || i.buy || Number(i.qty||0) <= Number(i.baseThreshold||0)) : [];
  const speech = items.length ? `Devi comprare: ${items.map(i => i.names?.it || i.name || i.id).join(', ')}` : 'Non hai niente da comprare.';
  res.json({ version:'1.0', response:{ outputSpeech:{ type:'PlainText', text:speech }, shouldEndSession:true } });
});

app.use(express.static(PUBLIC_DIR, { maxAge: '0' }));
app.get('*', (req,res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
  ensureDb();
  console.log(`Spesa Pronta cloud backend V27.71 attivo su http://localhost:${PORT}`);
});
