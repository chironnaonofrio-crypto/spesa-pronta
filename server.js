import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { URL } from 'url';
import pg from 'pg';
const { Pool } = pg;

// Carica automaticamente backend-example/.env in locale, senza dipendenze esterne.
// In hosting tipo Render/Railway/Netlify Functions usa le Environment Variables del pannello.
function loadEnvFile(){
  const envPath = path.resolve(process.cwd(), '.env');
  if(!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for(const line of lines){
    const trimmed=line.trim();
    if(!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [rawKey,...rest]=trimmed.split('=');
    const key=rawKey.trim();
    let value=rest.join('=').trim();
    if((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
    if(key && process.env[key] === undefined) process.env[key]=value;
  }
}
loadEnvFile();

const PORT = process.env.PORT || 3000;
const DB_PATH = path.resolve(process.env.DB_PATH || './cloud-db.json');
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || './public');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || OPENAI_MODEL;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.PUBLIC_URL || 'https://spesa-pronta.it').replace(/\/$/, '');
const EMAIL_FROM = process.env.EMAIL_FROM || 'Spesa Pronta <noreply@spesa-pronta.it>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const APP_SECRET = process.env.APP_SECRET || process.env.ENCRYPTION_SECRET || DATABASE_URL || 'spesa-pronta-dev-secret-change-me';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';
const SMS_ENABLED = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
const TWILIO_VERIFY_ENABLED = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID);
const PHONE_VERIFY_READY = SMS_ENABLED || TWILIO_VERIFY_ENABLED;
const WHATSAPP_ENABLED = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
let db = { users:{}, households:{} };
let dbMode = 'file';
let pgPool = null;

function emptyDb(){ return { users:{}, households:{}, assistantBrain:{version:1, globalFacts:[], productLearnings:{}, phrasePatterns:{}, dailyStats:{}, updatedAt:0} }; }
function cryptoKey(){ return crypto.createHash('sha256').update(String(APP_SECRET)).digest(); }
function encryptObject(obj){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(obj),'utf8'), cipher.final()]);
  return { encrypted:true, v:2, alg:'aes-256-gcm', iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:encrypted.toString('base64') };
}
function decryptObject(payload){
  const decipher=crypto.createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(payload.iv,'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag,'base64'));
  const plain=Buffer.concat([decipher.update(Buffer.from(payload.data,'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}
function decodeStoredDb(data){
  if(data && data.encrypted && data.data && data.iv && data.tag) return { db:decryptObject(data), encrypted:true };
  return { db:data || emptyDb(), encrypted:false };
}
function loadDbFile(){ try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return emptyDb(); } }
async function initStorage(){
  if(!DATABASE_URL){
    db = loadDbFile();
    ensureDbShape();
    dbMode = 'file';
    console.log('Spesa Pronta DB: local file mode', DB_PATH);
    return;
  }
  dbMode = 'supabase-postgres';
  pgPool = new Pool({ connectionString:DATABASE_URL, ssl:{ rejectUnauthorized:false }, max:3, idleTimeoutMillis:30000, connectionTimeoutMillis:15000 });
  await pgPool.query(`CREATE TABLE IF NOT EXISTS spesa_pronta_store (
    key text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const found = await pgPool.query('SELECT data FROM spesa_pronta_store WHERE key=$1', ['main']);
  if(found.rows.length){
    const rawStoredData = found.rows[0].data;
    let decoded;
    try {
      decoded = decodeStoredDb(rawStoredData);
      db = decoded.db || emptyDb();
      ensureDbShape();
      if(!decoded.encrypted) await saveDb();
    } catch(decryptErr) {
      console.warn('Spesa Pronta DB: dati non decriptabili. Possibile APP_SECRET cambiato o vecchio formato cifrato. Avvio recovery sicuro.', decryptErr?.message || decryptErr);
      try {
        const backupKey = 'main_backup_decrypt_failed_' + Date.now();
        await pgPool.query(`INSERT INTO spesa_pronta_store(key,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO NOTHING`, [backupKey, rawStoredData]);
        console.warn('Spesa Pronta DB: backup record creato con key=' + backupKey);
      } catch(backupErr) {
        console.warn('Spesa Pronta DB: impossibile creare backup del record non decriptabile', backupErr?.message || backupErr);
      }
      db = emptyDb();
      ensureDbShape();
      await saveDb();
      console.warn('Spesa Pronta DB: database ripristinato vuoto e cifrato con APP_SECRET attuale.');
    }
  } else {
    db = loadDbFile();
    ensureDbShape();
    await saveDb();
  }
  console.log('Spesa Pronta DB: Supabase/Postgres connected encrypted=true');
}
async function saveDb(){
  if(pgPool){
    const secureData = encryptObject(db);
    await pgPool.query(`INSERT INTO spesa_pronta_store(key,data,updated_at) VALUES($1,$2,now())
      ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, ['main', secureData]);
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db,null,2));
}
function id(prefix){ return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function tokenHash(raw){ return crypto.createHash('sha256').update(String(raw)).digest('hex'); }

function nowIso(){ return new Date().toISOString(); }
function ensureDbShape(){
  db = db || emptyDb();
  db.users = db.users || {};
  db.households = db.households || {};
  db.assistantBrain = db.assistantBrain || {version:1, globalFacts:[], productLearnings:{}, phrasePatterns:{}, dailyStats:{}, updatedAt:0};
  db.assistantBrain.globalFacts = db.assistantBrain.globalFacts || [];
  db.assistantBrain.productLearnings = db.assistantBrain.productLearnings || {};
  db.assistantBrain.phrasePatterns = db.assistantBrain.phrasePatterns || {};
  db.assistantBrain.dailyStats = db.assistantBrain.dailyStats || {};
  Object.values(db.households||{}).forEach(h=>{
    h.aiMemory = h.aiMemory || {messages:[],facts:[],events:[],scanHistory:[],summary:'',preferences:{},updatedAt:0};
    h.aiMemory.messages = h.aiMemory.messages || [];
    h.aiMemory.facts = h.aiMemory.facts || [];
    h.aiMemory.events = h.aiMemory.events || [];
    h.aiMemory.scanHistory = h.aiMemory.scanHistory || [];
    h.aiMemory.preferences = h.aiMemory.preferences || {};
  });
}
function ensureHouseholdMemory(h){
  h.aiMemory = h.aiMemory || {messages:[],facts:[],events:[],scanHistory:[],summary:'',preferences:{},updatedAt:0};
  h.aiMemory.messages = h.aiMemory.messages || [];
  h.aiMemory.facts = h.aiMemory.facts || [];
  h.aiMemory.events = h.aiMemory.events || [];
  h.aiMemory.scanHistory = h.aiMemory.scanHistory || [];
  h.aiMemory.preferences = h.aiMemory.preferences || {};
  return h.aiMemory;
}
function rememberMessage(memory, role, text, extra={}){
  memory.messages = memory.messages || [];
  memory.messages.push({role, text:String(text||'').slice(0,4000), at:Date.now(), ...extra});
  memory.messages = memory.messages.slice(-800);
  memory.updatedAt = Date.now();
}
function rememberFact(memory, text, source='chat'){
  const clean=String(text||'').trim().slice(0,500);
  if(!clean) return;
  memory.facts = memory.facts || [];
  const key=normalizeText(clean);
  if(!memory.facts.some(f=>normalizeText(f.text)===key)) memory.facts.push({text:clean, source, at:Date.now()});
  memory.facts = memory.facts.slice(-250);
  memory.updatedAt = Date.now();
}
function extractMemoryFacts(message=''){
  const raw=String(message||'').trim();
  const q=normalizeText(raw);
  const facts=[];
  const patterns=[
    /(?:mi piace|preferisco|adoro|uso spesso|compro spesso)\s+(.{2,120})/i,
    /(?:non mi piace|non comprare|evita|odio)\s+(.{2,120})/i,
    /(?:ho|abbiamo)\s+(\d+)\s+(?:cani|gatti|animali|persone)/i,
    /(?:siamo)\s+(\d+)\s+(?:persone|in casa)/i,
    /(?:ricordati che|tieni a mente che|memorizza che)\s+(.{2,180})/i
  ];
  for(const r of patterns){ const m=raw.match(r); if(m) facts.push(raw); }
  if(q.includes('sono allergico') || q.includes('intollerante')) facts.push(raw);
  return facts.slice(0,3);
}
function updateGlobalBrain({message='', action='', productName='', category='', confidence=null}={}){
  ensureDbShape();
  const brain=db.assistantBrain;
  const day=new Date().toISOString().slice(0,10);
  brain.dailyStats[day]=brain.dailyStats[day]||{chats:0,photos:0,voice:0,updates:0};
  if(action==='photo') brain.dailyStats[day].photos++; else if(action==='voice') brain.dailyStats[day].voice++; else if(action==='update') brain.dailyStats[day].updates++; else brain.dailyStats[day].chats++;
  const q=normalizeText(message).replace(/\d+/g,'#').slice(0,120);
  if(q){ brain.phrasePatterns[q]=(brain.phrasePatterns[q]||0)+1; }
  if(productName){
    const key=normalizeText(productName).slice(0,80);
    brain.productLearnings[key]=brain.productLearnings[key]||{name:productName, category, count:0, confidenceSum:0, lastSeenAt:0};
    brain.productLearnings[key].count++;
    if(Number.isFinite(Number(confidence))) brain.productLearnings[key].confidenceSum += Number(confidence);
    if(category) brain.productLearnings[key].category=category;
    brain.productLearnings[key].lastSeenAt=Date.now();
  }
  brain.globalFacts=(brain.globalFacts||[]).slice(-300);
  brain.updatedAt=Date.now();
}
function publicGlobalBrain(){
  ensureDbShape();
  const brain=db.assistantBrain;
  const topProducts=Object.values(brain.productLearnings||{}).sort((a,b)=>b.count-a.count).slice(0,20).map(p=>({name:p.name, category:p.category, count:p.count, avgConfidence:p.count?Number((p.confidenceSum/p.count).toFixed(2)):null}));
  const topPhrases=Object.entries(brain.phrasePatterns||{}).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([phrase,count])=>({phrase,count}));
  return {version:brain.version||1, updatedAt:brain.updatedAt||0, topProducts, topPhrases, dailyStats:brain.dailyStats||{}};
}
function normalizeEmail(email){ return String(email||'').trim().toLowerCase(); }
function isValidEmail(email){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email||'')); }

function onlyDigits(value=''){ return String(value||'').replace(/\D+/g,''); }
function normalizePhone(country='', number='', full=''){
  const rawFull=String(full||'').trim();
  if(rawFull.startsWith('+')) return '+' + onlyDigits(rawFull);
  const cc=String(country||'+39').trim().startsWith('+') ? String(country||'+39').trim() : '+' + onlyDigits(country||'39');
  return cc + onlyDigits(number || rawFull);
}
function isValidPhone(phone){ return /^\+[1-9]\d{7,14}$/.test(String(phone||'')); }
function maskPhone(phone=''){
  const p=String(phone||'');
  if(!p) return '';
  return p.slice(0,4) + '••••' + p.slice(-3);
}
function makeSmsCode(){ return String(Math.floor(100000 + Math.random()*900000)); }
function twilioAuthHeader(){ return 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'); }
async function startTwilioVerifySms(phone){
  if(!TWILIO_VERIFY_ENABLED){ return {sent:false, simulated:true, provider:'local'}; }
  const params = new URLSearchParams();
  params.set('To', phone);
  params.set('Channel', 'sms');
  params.set('Locale', 'it');
  const r = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,{
    method:'POST', headers:{'Authorization':twilioAuthHeader(),'Content-Type':'application/x-www-form-urlencoded'}, body:params
  });
  const text=await r.text().catch(()=>'');
  if(!r.ok) console.error('[twilio-verify:start:error]', r.status, text.slice(0,500));
  return {sent:r.ok, status:r.status, provider:'twilio_verify'};
}
async function checkTwilioVerifySms(phone, code){
  if(!TWILIO_VERIFY_ENABLED){ return {ok:false, provider:'local'}; }
  const params = new URLSearchParams();
  params.set('To', phone);
  params.set('Code', code);
  const r = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,{
    method:'POST', headers:{'Authorization':twilioAuthHeader(),'Content-Type':'application/x-www-form-urlencoded'}, body:params
  });
  const json = await r.json().catch(async()=>({raw: await r.text().catch(()=> '')}));
  if(!r.ok) console.error('[twilio-verify:check:error]', r.status, JSON.stringify(json).slice(0,500));
  return {ok:r.ok && json.status === 'approved', status:r.status, provider:'twilio_verify', twilioStatus:json.status};
}
async function sendTwilioMessage({to, body, channel='sms'}={}){
  const from = channel === 'whatsapp' ? TWILIO_WHATSAPP_FROM : TWILIO_FROM_NUMBER;
  const enabled = channel === 'whatsapp' ? WHATSAPP_ENABLED : SMS_ENABLED;
  if(!enabled){ console.log(`[${channel}:simulato]`, to, body.slice(0,140)); return {sent:false, simulated:true}; }
  const params = new URLSearchParams();
  params.set('From', channel === 'whatsapp' ? `whatsapp:${from.replace(/^whatsapp:/,'')}` : from);
  params.set('To', channel === 'whatsapp' ? `whatsapp:${to.replace(/^whatsapp:/,'')}` : to);
  params.set('Body', body);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,{
    method:'POST', headers:{'Authorization':twilioAuthHeader(),'Content-Type':'application/x-www-form-urlencoded'}, body:params
  });
  const text=await r.text().catch(()=>'');
  if(!r.ok) console.error(`[${channel}:error]`, r.status, text.slice(0,300));
  return {sent:r.ok, status:r.status, provider:'twilio'};
}
function sendPhoneVerificationSms(user, code){
  if(TWILIO_VERIFY_ENABLED) return startTwilioVerifySms(user.phone);
  return sendTwilioMessage({to:user.phone, channel:'sms', body:`Spesa Pronta: il tuo codice di verifica è ${code}. Scade tra 10 minuti. Non condividerlo con nessuno.`});
}
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch])); }
function hashPassword(pwd){
  const salt=crypto.randomBytes(16).toString('hex');
  const iterations=160000;
  const hash=crypto.pbkdf2Sync(String(pwd), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}
function verifyPassword(pwd, stored=''){
  if(String(stored).startsWith('pbkdf2$')){
    const [,iterRaw,salt,expected]=String(stored).split('$');
    const actual=crypto.pbkdf2Sync(String(pwd), salt, Number(iterRaw)||160000, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual,'hex'), Buffer.from(expected,'hex'));
  }
  const legacy=crypto.createHash('sha256').update(String(pwd)).digest('hex');
  return legacy === stored;
}
function safeUser(u){ return { id:u.id, username:u.username, email:u.email, firstName:u.firstName || '', lastName:u.lastName || '', emailVerified: u.emailVerified !== false && !u.emailVerifyTokenHash, phoneVerified: u.phoneVerified === true, phoneMasked: maskPhone(u.phone || '') }; }
async function sendEmail({to,subject,text,html}){
  if(!RESEND_API_KEY){
    console.log('[mail:simulata]', subject, 'to', to, text?.slice(0,140)||'');
    return { sent:false, simulated:true };
  }
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:EMAIL_FROM,to:[to],subject,text,html})
  });
  if(!r.ok) console.error('[mail:error]', r.status, await r.text().catch(()=>'').then(x=>x.slice(0,300)));
  return { sent:r.ok };
}
function emailTextFooter(){
  return `\n\n— Spesa Pronta\n${APP_BASE_URL}\nSe non hai richiesto tu questa operazione, ignora questa email o cambia subito la password.`;
}
function emailPlain({title='', intro='', lines=[], ctaLabel='', ctaUrl='', token='', warning=''}){
  const body=[title, '', intro, ...lines.map(x=>`- ${x}`)];
  if(ctaUrl) body.push('', `${ctaLabel}: ${ctaUrl}`);
  if(token) body.push('', `Token: ${token}`);
  if(warning) body.push('', warning);
  return body.filter(Boolean).join('\n') + emailTextFooter();
}
function brandEmailTemplate({
  preheader='Spesa Pronta',
  badge='SPESA PRONTA',
  title='Spesa Pronta',
  intro='',
  name='',
  username='',
  cards=[],
  ctaLabel='Apri Spesa Pronta',
  ctaUrl=APP_BASE_URL,
  token='',
  warning='',
  footerNote='Questa email è stata inviata automaticamente dal sistema Spesa Pronta.'
}={}){
  const safeTitle=escapeHtml(title);
  const safeIntro=escapeHtml(intro);
  const safeName=escapeHtml(name || '');
  const safeUsername=escapeHtml(username || '');
  const safeCtaLabel=escapeHtml(ctaLabel);
  const safeCtaUrl=escapeHtml(ctaUrl || APP_BASE_URL);
  const safeToken=escapeHtml(token || '');
  const safeWarning=escapeHtml(warning || '');
  const cardHtml=(cards||[]).map(card=>`\n    <tr>\n      <td style="padding:0 0 12px 0;">\n        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${card.tone==='gold'?'#fff7df':card.tone==='green'?'#edfdf4':card.tone==='red'?'#fff1f2':'#f6f9ff'};border:1px solid ${card.tone==='gold'?'#ffe0a3':card.tone==='green'?'#bff0d0':card.tone==='red'?'#fecdd3':'#dbe8ff'};border-radius:18px;overflow:hidden;">\n          <tr>\n            <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;color:#0c1f35;">\n              <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#52708f;font-weight:800;margin-bottom:6px;">${escapeHtml(card.label||'')}</div>\n              <div style="font-size:18px;line-height:1.35;font-weight:900;color:#0b1c33;">${escapeHtml(card.value||'')}</div>\n              ${card.text?`<div style="font-size:14px;line-height:1.55;color:#597089;margin-top:6px;">${escapeHtml(card.text)}</div>`:''}\n            </td>\n          </tr>\n        </table>\n      </td>\n    </tr>`).join('');
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#eef5ff;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#ecf5ff 0%,#f7fbff 45%,#eef6ff 100%);margin:0;padding:0;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;border-collapse:separate;background:#ffffff;border:1px solid #dbe8ff;border-radius:30px;box-shadow:0 22px 70px rgba(16,44,84,.16);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#0a2a55 0%,#1266f1 52%,#49d79d 120%);padding:28px 26px 24px 26px;font-family:Arial,Helvetica,sans-serif;color:#fff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle" style="width:72px;">
                    <div style="width:58px;height:58px;border-radius:20px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);text-align:center;line-height:58px;font-size:30px;box-shadow:inset 0 1px 0 rgba(255,255,255,.25);">🛍️</div>
                  </td>
                  <td valign="middle">
                    <div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;font-weight:800;opacity:.88;">${escapeHtml(badge)}</div>
                    <div style="font-size:30px;line-height:1.12;font-weight:900;margin-top:5px;">${safeTitle}</div>
                    <div style="font-size:14px;line-height:1.5;opacity:.9;margin-top:6px;">Quando finisce, scorri. Quando esci, compri.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 26px 10px 26px;font-family:Arial,Helvetica,sans-serif;color:#0b1c33;">
              ${safeName?`<div style="display:inline-block;background:#eaf3ff;border:1px solid #d6e7ff;color:#1557b8;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:800;margin-bottom:14px;">Ciao ${safeName}</div>`:''}
              <p style="margin:0 0 16px 0;font-size:18px;line-height:1.62;color:#405975;font-weight:600;">${safeIntro}</p>
              ${safeUsername?`<p style="margin:0 0 18px 0;font-size:15px;line-height:1.5;color:#597089;"><b style="color:#102b4e;">Nome utente:</b> ${safeUsername}</p>`:''}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${cardHtml}</table>
              ${safeToken?`<div style="margin:6px 0 18px 0;background:#071b34;color:#dff7ff;border-radius:18px;padding:16px 18px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:15px;line-height:1.5;word-break:break-all;border:1px solid #113a69;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);"><div style="font-family:Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;font-size:11px;color:#8fd7ff;font-weight:900;margin-bottom:8px;">Token di sicurezza</div>${safeToken}</div>`:''}
              ${safeCtaUrl?`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 18px 0;"><tr><td style="border-radius:16px;background:#1266f1;box-shadow:0 10px 28px rgba(18,102,241,.28);"><a href="${safeCtaUrl}" style="display:inline-block;padding:15px 22px;border-radius:16px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:900;text-decoration:none;">${safeCtaLabel} ✨</a></td></tr></table>`:''}
              ${safeCtaUrl?`<p style="margin:0 0 14px 0;font-size:12px;line-height:1.55;color:#7790ad;word-break:break-all;">Se il pulsante non funziona, copia questo link:<br><a href="${safeCtaUrl}" style="color:#1266f1;text-decoration:underline;">${safeCtaUrl}</a></p>`:''}
              ${safeWarning?`<div style="margin:16px 0 10px 0;background:#fff7df;border:1px solid #ffe0a3;color:#6a4b00;border-radius:16px;padding:14px 16px;font-size:14px;line-height:1.55;font-weight:700;">${safeWarning}</div>`:''}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 26px 28px 26px;font-family:Arial,Helvetica,sans-serif;">
              <div style="height:1px;background:#e2ecf8;margin-bottom:18px;"></div>
              <p style="margin:0;font-size:12px;line-height:1.65;color:#7890aa;">${escapeHtml(footerNote)}<br>© ${new Date().getFullYear()} Spesa Pronta · <a href="${APP_BASE_URL}" style="color:#1266f1;text-decoration:none;">${escapeHtml(APP_BASE_URL)}</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
function welcomeHtml(user){
  return brandEmailTemplate({
    preheader:'Il tuo account Spesa Pronta è attivo.',
    title:`Benvenuto in Spesa Pronta, ${user.firstName||user.username||'amico'} ✨`,
    intro:'Account attivato, email verificata e spazio cloud pronto. Ora puoi fare l’inventario iniziale con foto e collegare Alexa o Google Assistant alla stessa lista.',
    name:user.firstName||user.username,
    username:user.username,
    ctaLabel:'Apri Spesa Pronta',
    ctaUrl:APP_BASE_URL,
    cards:[
      {label:'Cloud',value:'Sincronizzazione attiva',text:'I tuoi dati vengono salvati nel database collegato al tuo account.',tone:'green'},
      {label:'Assistenti vocali',value:'Alexa + Google Assistant',text:'La lista può essere aggiornata anche con comandi vocali.',tone:'gold'},
      {label:'Primo passo',value:'Inventario iniziale con foto',text:'Tira fuori i prodotti, fotografali e rimetti tutto a posto: l’app crea la base corretta.'}
    ]
  });
}
function verifyEmailHtml(user, rawToken){
  const link=`${APP_BASE_URL}?verify=${encodeURIComponent(rawToken)}`;
  return brandEmailTemplate({
    preheader:'Conferma la tua email per attivare Spesa Pronta.',
    title:'Verifica la tua email ✉️',
    intro:'Per proteggere il tuo account e confermare che l’indirizzo sia reale, premi il pulsante qui sotto. Dopo la verifica potrai entrare e iniziare l’inventario.',
    name:user.firstName||user.username,
    username:user.username,
    ctaLabel:'Verifica email',
    ctaUrl:link,
    token:rawToken,
    warning:'Il link scade tra 24 ore. Se non hai creato tu questo account, puoi ignorare questa email.',
    cards:[
      {label:'Sicurezza',value:'Verifica obbligatoria',text:'Senza conferma email l’account non può accedere alla dashboard.',tone:'green'},
      {label:'Account',value:user.email||'',text:'Questo è l’indirizzo che verrà collegato al profilo Spesa Pronta.'}
    ]
  });
}
async function sendVerificationEmail(user, rawToken){
  const link=`${APP_BASE_URL}?verify=${encodeURIComponent(rawToken)}`;
  return sendEmail({
    to:user.email,
    subject:'Verifica email Spesa Pronta ✉️',
    text:emailPlain({
      title:'Verifica la tua email',
      intro:`Ciao ${user.firstName||user.username||''}, conferma questa email per attivare Spesa Pronta.`,
      lines:[`Nome utente: ${user.username}`, 'Il link scade tra 24 ore.'],
      ctaLabel:'Verifica email',
      ctaUrl:link,
      token:rawToken
    }),
    html:verifyEmailHtml(user, rawToken)
  }).catch(err=>console.error('[mail verify]',err));
}
async function sendWelcomeEmail(user){
  return sendEmail({
    to:user.email,
    subject:'Benvenuto in Spesa Pronta ✨',
    text:emailPlain({
      title:'Benvenuto in Spesa Pronta',
      intro:`Ciao ${user.firstName||user.username||''}, il tuo account Spesa Pronta è pronto.`,
      lines:[`Nome utente: ${user.username}`, 'Puoi fare l’inventario iniziale con foto e collegare Alexa o Google Assistant.'],
      ctaLabel:'Apri Spesa Pronta',
      ctaUrl:APP_BASE_URL
    }),
    html:welcomeHtml(user)
  }).catch(err=>console.error('[mail welcome]',err));
}
function resetEmailHtml(user, rawToken){
  const link=`${APP_BASE_URL}?reset=${encodeURIComponent(rawToken)}`;
  return brandEmailTemplate({
    preheader:'Recupera la password del tuo account Spesa Pronta.',
    title:'Recupero password 🔐',
    intro:'Abbiamo ricevuto una richiesta per reimpostare la password. Usa il pulsante o il token qui sotto entro 30 minuti.',
    name:user.firstName||user.username,
    username:user.username,
    ctaLabel:'Reimposta password',
    ctaUrl:link,
    token:rawToken,
    warning:'Se non sei stato tu a richiederlo, ignora questa email: la password non cambierà.',
    cards:[
      {label:'Scadenza',value:'30 minuti',text:'Dopo questo tempo il link non sarà più valido.',tone:'gold'},
      {label:'Protezione',value:'Token salvato solo in hash',text:'Nel database non viene salvato il token leggibile.',tone:'green'}
    ]
  });
}
async function sendResetEmail(user, rawToken){
  const link=`${APP_BASE_URL}?reset=${encodeURIComponent(rawToken)}`;
  return sendEmail({
    to:user.email,
    subject:'Recupero password Spesa Pronta 🔐',
    text:emailPlain({
      title:'Recupero password',
      intro:'Hai richiesto il recupero password per Spesa Pronta.',
      lines:['Il link scade tra 30 minuti.'],
      ctaLabel:'Reimposta password',
      ctaUrl:link,
      token:rawToken,
      warning:'Se non sei stato tu, ignora questa email.'
    }),
    html:resetEmailHtml(user, rawToken)
  }).catch(err=>console.error('[mail reset]',err));
}
function passwordChangedHtml(user){
  return brandEmailTemplate({
    preheader:'La password del tuo account è stata aggiornata.',
    title:'Password aggiornata ✅',
    intro:'La password del tuo account Spesa Pronta è stata modificata correttamente.',
    name:user.firstName||user.username,
    username:user.username,
    ctaLabel:'Apri Spesa Pronta',
    ctaUrl:APP_BASE_URL,
    warning:'Se non sei stato tu, prova subito il recupero password e controlla il tuo account.',
    cards:[{label:'Sicurezza',value:'Modifica completata',text:'Da ora dovrai usare la nuova password per accedere.',tone:'green'}]
  });
}
async function sendPasswordChangedEmail(user){
  return sendEmail({
    to:user.email,
    subject:'Password Spesa Pronta aggiornata ✅',
    text:emailPlain({title:'Password aggiornata',intro:'La password del tuo account Spesa Pronta è stata aggiornata.',warning:'Se non sei stato tu, cambia subito la password.'}),
    html:passwordChangedHtml(user)
  }).catch(err=>console.error('[mail password changed]',err));
}

function contentType(file){
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml',
    '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.md':'text/markdown; charset=utf-8'
  })[ext] || 'application/octet-stream';
}
function serveStatic(req,res,url){
  if(req.method !== 'GET' && req.method !== 'HEAD') return false;
  if(url.pathname.startsWith('/api/')) return false;
  let pathname = decodeURIComponent(url.pathname);
  if(pathname === '/') pathname = '/index.html';
  const target = path.normalize(path.join(STATIC_DIR, pathname));
  if(!target.startsWith(STATIC_DIR)) return false;
  let file = target;
  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if(!fs.existsSync(file)) file = path.join(STATIC_DIR, 'index.html');
  try{
    const data = fs.readFileSync(file);
    const isHardNoCache = /(?:index\.html|clear-cache\.html|service-worker\.js|app\.|styles\.|\.js$|\.css$)/.test(file);
    res.writeHead(200, {
      'Content-Type': contentType(file),
      'Content-Length': data.length,
      'Cache-Control': isHardNoCache ? 'no-store, no-cache, must-revalidate, max-age=0' : 'public, max-age=86400, immutable',
      'Pragma': isHardNoCache ? 'no-cache' : undefined,
      'Expires': isHardNoCache ? '0' : undefined
    });
    if(req.method === 'HEAD') return res.end();
    res.end(data);
    return true;
  }catch{
    return false;
  }
}

function send(res, status, data){
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS',
    'Content-Length':Buffer.byteLength(body)
  });
  res.end(body);
}
function readBody(req){
  return new Promise(resolve => {
    let body='';
    req.on('data', chunk => { body += chunk; if(body.length > 8_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); } });
  });
}
function getHousehold(url, req){
  const parts = url.pathname.split('/').filter(Boolean);
  const householdId = parts[2] || url.searchParams.get('householdId');
  const household = db.households[householdId];
  if(!household) return { error:{ status:404, body:{ error:'household_not_found' } } };
  const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/,'');
  if(!url.pathname.includes('/alexa') && household.token !== bearer) return { error:{ status:401, body:{ error:'unauthorized' } } };
  return { household, householdId };
}
function itemName(item, lang='it'){ return item.names?.[lang] || item.names?.it || item.name || item.id; }
function clamp(value,min,max,fallback){ const n=Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function learnedDailyConsumption(item, memory={}){
  const now=Date.now(), since=now-1000*60*60*24*45;
  const ev=(memory.events||[]).filter(e=>e.itemId===item.id && e.type==='consume' && e.at>=since);
  const total=ev.reduce((s,e)=>s+Math.abs(Number(e.delta)||0),0);
  if(total<=0) return 0;
  const first=Math.min(...ev.map(e=>e.at));
  return total/Math.max(1,(now-first)/86400000);
}
function baseDailyConsumption(item, settings={}){
  const people=clamp(settings.people,1,20,1), animals=clamp(settings.animals,0,30,0);
  const label=normalizeText(`${item.id||''} ${item.category||''} ${itemName(item,settings.lang||'it')||''}`);
  if(item.kind==='water' || label.includes('acqua')) return Math.max(.4, people*1.5);
  if(item.kind==='petfood' || label.includes('crocchette')) return Math.max(.08, animals*.28);
  if(label.includes('sacchetti')) return Math.max(.05, animals*2);
  if(item.category==='pets') return Math.max(.03, animals*.15);
  if(item.category==='drinks') return Math.max(.15, people*.55);
  if(item.category==='fruit' || item.category==='veg') return Math.max(.12, people*.28);
  if(item.category==='food') return Math.max(.08, people*.18);
  if(item.category==='house') return Math.max(.03, people*.06);
  if(item.category==='aquarium') return .035;
  if(item.category==='pharmacy') return .018;
  return Math.max(.03, people*.08);
}
function aiVelocity(item, settings={}, memory={}){
  const learned=learnedDailyConsumption(item,memory), base=baseDailyConsumption(item,settings);
  return learned>0 ? Math.max(.01, learned*.72 + base*.28) : Math.max(.01, base*.55);
}
function targetDaysFor(item){
  if(item.kind==='water') return 7;
  if(item.kind==='petfood' || item.category==='pets') return 18;
  if(item.category==='fruit' || item.category==='veg') return 4;
  if(item.category==='food') return 10;
  if(item.category==='house') return 24;
  if(item.category==='aquarium') return 30;
  if(item.category==='pharmacy') return 35;
  return 12;
}
function alertDaysFor(item){
  if(item.category==='fruit' || item.category==='veg') return 2;
  if(item.kind==='water') return 2;
  if(item.kind==='petfood' || item.category==='pets') return 7;
  return Math.max(2, Math.round(targetDaysFor(item)*.35));
}
function smartThreshold(item, settings={}, memory={}){
  if(settings.autoSmart === false) return Math.max(1, Number(item.baseThreshold)||1);
  const people=clamp(settings.people,1,20,1), animals=clamp(settings.animals,0,30,0);
  let th=Math.max(1, Number(item.baseThreshold)||1);
  if(item.perPersonMin) th=Math.max(th, Math.ceil(item.perPersonMin*people));
  if(item.perAnimalMin) th=Math.max(th, Math.ceil(item.perAnimalMin*animals));
  if(Number(item.usage||0)>=6) th=Math.max(th, (Number(item.baseThreshold)||1)+2);
  if(item.kind==='water') th=Math.max(th, people*2);
  if(item.kind==='petfood') th=Math.max(th, animals*4);
  th=Math.max(th, Math.ceil(aiVelocity(item,settings,memory)*alertDaysFor(item)));
  return Math.ceil(th);
}
function recommendedQty(item, settings={}, memory={}){
  const people=clamp(settings.people,1,20,1), animals=clamp(settings.animals,0,30,0);
  let r=Math.max(Number(item.recommendedBuy||0), Number(item.maxQty||0), smartThreshold(item,settings,memory));
  if(item.kind==='water') r=Math.max(r, people*7);
  if(item.kind==='petfood') r=Math.max(r, animals*6);
  r=Math.max(r, Math.ceil(aiVelocity(item,settings,memory)*targetDaysFor(item)));
  return Math.max(1, Math.ceil(r));
}
function daysLeft(item, settings={}, memory={}){ const v=aiVelocity(item,settings,memory); return v>0 ? Math.max(0, Number(item.qty||0)/v) : null; }
function consumptionReason(item, settings={}, memory={}){
  const th=smartThreshold(item,settings,memory), rec=recommendedQty(item,settings,memory), days=daysLeft(item,settings,memory);
  const status=Number(item.qty||0)<=0?'Finito':Number(item.qty||0)<=th?'Da comprare':'Scorta ok';
  return `${status}: ${days!==null?`circa ${days.toFixed(days<10?1:0)} giorni rimasti`:'giorni non stimabili'}, soglia ${th}, consiglio ${rec}.`;
}
function isBuy(item, settings, memory={}){ return Number(item.qty||0) <= smartThreshold(item, settings, memory); }
function shoppingList(household){
  const settings=household.settings||{}, memory=household.aiMemory||{};
  return (household.items||[]).filter(i=>isBuy(i, settings, memory)).map(i=>({ id:i.id, name:itemName(i, settings?.lang||'it'), qty:i.qty, unit:i.unit, image:i.image, threshold:smartThreshold(i,settings,memory), recommended:recommendedQty(i,settings,memory), daysLeft:daysLeft(i,settings,memory), reason:consumptionReason(i,settings,memory) }));
}
function findItem(household, product){
  const p = String(product||'').toLowerCase().trim();
  return (household.items||[]).find(i => {
    const names = Object.values(i.names||{}).map(x=>String(x).toLowerCase());
    return names.includes(p) || names.some(n=>n.includes(p)) || String(i.id).toLowerCase()===p;
  });
}
function alexaSpeak(text){ return { version:'1.0', response:{ outputSpeech:{ type:'PlainText', text }, shouldEndSession:true } }; }

function googleAssistantSpeak(text){
  return {
    fulfillmentText:text,
    fulfillment_response:{ messages:[{ text:{ text:[text] } }] },
    payload:{ google:{ expectUserResponse:false, richResponse:{ items:[{ simpleResponse:{ textToSpeech:text, displayText:text } }] } } }
  };
}
function textParam(params, ...keys){
  for(const k of keys){
    const v=params?.[k];
    if(v === undefined || v === null) continue;
    if(typeof v === 'object' && !Array.isArray(v)){
      if(v.value !== undefined) return v.value;
      if(v.name !== undefined) return v.name;
      if(v.amount !== undefined) return v.amount;
    }
    return Array.isArray(v) ? v[0] : v;
  }
  return '';
}

function buildSmartShoppingMessage(household){
  const lang=household.settings?.lang || 'it';
  const list=shoppingList(household);
  const people=Number(household.settings?.people||1);
  const animals=Number(household.settings?.animals||0);
  const header='🛍️ Spesa Pronta - lista intelligente';
  const intro=`Casa: ${people} persone${animals?`, ${animals} animali`:''}. Lista generata in base a scorte, consumi e soglie intelligenti.`;
  if(!list.length) return `${header}

${intro}

✅ Non risultano articoli urgenti da comprare. Dai comunque un'occhiata alle offerte e ai freschi.`;
  const lines=list.slice(0,40).map((i,n)=>`${n+1}. ${itemName(i,lang)} — consigliato ${i.recommended || i.qty || 1} ${i.unit || 'pz'} (${i.reason || 'scorta bassa'})`);
  return `${header}

${intro}

${lines.join('\n')}

✨ Consiglio AI: compra prima gli articoli essenziali e controlla frigo/dispensa prima di uscire.`;
}
async function sendShoppingWhatsapp(user, household){
  const text=buildSmartShoppingMessage(household);
  if(!user?.phone || user.phoneVerified !== true) return {sent:false, reason:'phone_not_verified', text};
  const result=await sendTwilioMessage({to:user.phone, channel:'whatsapp', body:text});
  return {...result, text};
}

function parseVoiceFromNaturalText(text=''){
  const raw=String(text||'').trim();
  const q=normalizeText(raw);
  if(!q) return { intent:'' };
  if(q.includes('cosa devo comprare') || q.includes('cosa manca') || q.includes('lista della spesa') || q.includes('leggi la lista')) return { intent:'ReadShoppingListIntent' };
  if(q.includes('ho fatto la spesa') || q.includes('resetta') || q.includes('azzera')) return { intent:'ResetListIntent' };
  let m=raw.match(/(?:aggiungi|metti|compra)\s+(.+)$/i);
  if(m) return { intent:'AddItemIntent', product:m[1].trim() };
  m=raw.match(/(?:segna|imposta|porta|metti)\s+(.+?)\s+(?:a|ad)\s+(\d+(?:[\.,]\d+)?)\s*([a-zA-Zàèéìòù]+)?/i);
  if(m) return { intent:'SetQuantityIntent', product:m[1].trim(), qty:Number(m[2].replace(',','.')), unit:m[3]||'' };
  return { intent:'HelpIntent' };
}
function parseGoogleAssistantRequest(body={}){
  const params = body.queryResult?.parameters || body.sessionInfo?.parameters || body.parameters || body.slots || {};
  const text = body.queryResult?.queryText || body.text || body.transcript || body.query || '';
  const natural = parseVoiceFromNaturalText(text);
  let intent = body.queryResult?.intent?.displayName || body.queryResult?.intent?.name || body.intent || body.request?.intent?.name || natural.intent || '';
  if(String(intent).includes('/')) intent=String(intent).split('/').pop();
  const product = textParam(params,'Product','product','articolo','item','food','prodotto') || body.product || natural.product;
  const qtyRaw = textParam(params,'Quantity','quantity','qty','number','numero') || body.qty || natural.qty;
  const unit = textParam(params,'Unit','unit','unita','unità') || body.unit || natural.unit;
  return { intent, product, qty:Number(qtyRaw||0), unit };
}

function getVoiceAuth(req, url, body={}){
  const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/, '').trim();
  const suppliedToken = String(
    url.searchParams.get('token') ||
    body.token || body.voiceToken ||
    body.sessionInfo?.parameters?.token ||
    body.originalDetectIntentRequest?.payload?.token ||
    body?.session?.user?.accessToken ||
    bearer || ''
  ).trim();
  let householdId = String(
    url.searchParams.get('householdId') ||
    body.householdId ||
    body.sessionInfo?.parameters?.householdId ||
    body.originalDetectIntentRequest?.payload?.householdId ||
    body?.session?.attributes?.householdId || ''
  ).trim();
  let h = householdId ? db.households[householdId] : null;
  if(!h && suppliedToken){
    h = Object.values(db.households||{}).find(x => x.token === suppliedToken) || null;
    householdId = h?.id || householdId;
  }
  if(!h) return { error:'Account Spesa Pronta non collegato.' };
  if(h.token !== suppliedToken) return { error:'Collegamento vocale non autorizzato. Ricopia endpoint/token dall’app.' };
  return { h, householdId };
}

async function handleVoiceIntent(h, {intent='', product='', qty=0, unit='', phrase=''}={}){
  if(intent === 'ReadListIntent' || intent === 'ReadShoppingListIntent' || intent === 'ReadGroceryListIntent'){
    const list = shoppingList(h);
    if(!list.length) return 'La lista della spesa è vuota.';
    return 'Devi comprare: ' + list.map(x=>`${x.name}, ${x.qty} ${x.unit||''}`).join('; ') + '.';
  }
  if(intent === 'AddItemIntent'){
    const item = findItem(h, product);
    if(!item) return `Non trovo ${product}. Apri l'app e aggiungilo al catalogo.`;
    item.qty = 0; item.updatedAt = Date.now(); item.usage = Number(item.usage||0)+1; ensureHouseholdMemory(h); rememberMessage(h.aiMemory,'user',`Aggiungi ${product}`,{channel:'voice'}); rememberMessage(h.aiMemory,'assistant',`Ok, ho aggiunto ${itemName(item,h.settings?.lang)} alla lista della spesa.`,{channel:'voice'}); updateGlobalBrain({message:`aggiungi ${product}`, action:'voice'}); h.updatedAt=Date.now(); await saveDb();
    return `Ok, ho aggiunto ${itemName(item,h.settings?.lang)} alla lista della spesa.`;
  }
  if(intent === 'SetQuantityIntent' || intent === 'UpdateItemIntent'){
    const item = findItem(h, product);
    if(!item) return `Non trovo ${product}.`;
    if(!Number.isFinite(Number(qty))) return 'Dimmi una quantità valida.';
    item.qty = Number(qty); if(unit) item.unit = unit; item.updatedAt = Date.now(); ensureHouseholdMemory(h); rememberMessage(h.aiMemory,'user',`Imposta ${product} a ${qty} ${unit||''}`,{channel:'voice'}); updateGlobalBrain({message:`imposta ${product}`, action:'voice', productName:product}); h.updatedAt=Date.now(); await saveDb();
    return `Ok, ${itemName(item,h.settings?.lang)} ora è a ${item.qty} ${item.unit||''}.`;
  }
  if(intent === 'ResetListIntent'){
    h.items = (h.items||[]).map(i => ({ ...i, qty: i.recommendedBuy || i.maxQty || 5, updatedAt:Date.now() }));
    ensureHouseholdMemory(h); rememberMessage(h.aiMemory,'user','Ho fatto la spesa',{channel:'voice'}); rememberMessage(h.aiMemory,'assistant','Perfetto, ho segnato la spesa come fatta.',{channel:'voice'}); updateGlobalBrain({message:'ho fatto la spesa', action:'voice'}); h.updatedAt=Date.now(); await saveDb();
    return 'Perfetto, ho segnato la spesa come fatta.';
  }
  const mem=ensureHouseholdMemory(h);
  const userPhrase = phrase || product || intent || 'Aiutami con la spesa';
  rememberMessage(mem,'user',userPhrase,{channel:'voice-chat'});
  const reply=await llmChatReply({message:userPhrase,state:h.items||[],settings:h.settings||{},memory:mem,globalMemory:publicGlobalBrain()});
  rememberMessage(mem,'assistant',reply,{channel:'voice-chat'});
  updateGlobalBrain({message:userPhrase, action:'voice'});
  h.updatedAt=Date.now(); await saveDb();
  return reply || 'Puoi chiedermi cosa devi comprare, aggiungere un prodotto o modificare una quantità.';
}



function normalizeText(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function localAiReply({message,state=[],settings={},memory={}}){
  const q=normalizeText(message);
  const name=settings?.profile?.firstName || 'amico';
  if(q.includes('buongiorno') || q.includes('ciao')) return `Buongiorno ${name}! Sono Spesa Pronta AI. Ricordo chat, consumi, preferenze e posso aggiornare la lista.`;
  if(q.includes('cosa ricordi') || q.includes('memoria')){
    const facts=(memory.facts||[]).slice(-8).map(f=>`- ${f.text}`).join('\n') || '- Nessuna preferenza salvata ancora';
    return `Ricordo ${(memory.messages||[]).length} messaggi e ${(memory.scanHistory||[]).length} foto spesa.\n${facts}`;
  }
  if(q.includes('cosa devo comprare') || q.includes('cosa manca')){
    const list=state.filter(i=>isBuy(i,settings)).map(i=>`${itemName(i,settings.lang||'it')} (${i.qty} ${i.unit||''})`);
    return list.length ? `Devi comprare: ${list.join(', ')}.` : 'La lista sembra vuota: non manca niente.';
  }
  if(q.includes('foto') || q.includes('fotografa') || q.includes('frigo')) return 'Apri Foto spesa: fotografa un articolo alla volta, controllo qualità immagine, nome e quantità, poi aggiorno la scorta.';
  return 'Ho capito. Posso ragionare sui tuoi consumi, ricordare preferenze, modificare la lista e analizzare foto se il backend è collegato a una chiave AI.';
}
function aiConnected(){ return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'INSERISCI_LA_TUA_CHIAVE_OPENAI'); }
async function openAiResponse(payload){
  const key=process.env.OPENAI_API_KEY;
  if(!aiConnected()) return null;
  const ctrl = new AbortController();
  const timeout = setTimeout(()=>ctrl.abort(), OPENAI_TIMEOUT_MS);
  try{
    const res=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify(payload),
      signal:ctrl.signal
    });
    if(!res.ok){
      const errText=await res.text().catch(()=>'');
      throw new Error('openai_error_'+res.status+'_'+errText.slice(0,300));
    }
    return await res.json();
  } finally { clearTimeout(timeout); }
}
function outputText(resp){
  if(resp.output_text) return resp.output_text;
  const chunks=[];
  for(const out of resp.output||[]) for(const c of out.content||[]) if(c.text) chunks.push(c.text);
  return chunks.join('\n').trim();
}
async function llmChatReply({message,state,settings,memory,globalMemory={}}){
  const key=process.env.OPENAI_API_KEY;
  if(!key) return localAiReply({message,state,settings,memory});
  const compactState=(state||[]).map(i=>({id:i.id,name:itemName(i,settings?.lang||'it'),qty:i.qty,unit:i.unit,category:i.category,threshold:smartThreshold(i,settings,memory),recommended:recommendedQty(i,settings,memory),daysLeft:daysLeft(i,settings,memory)}));
  const payload={
    model:OPENAI_MODEL,
    input:[
      {role:'system',content:'Sei Spesa Pronta AI, un assistente domestico vocale e testuale stile ChatGPT. Rispondi in italiano, con tono caldo e pratico. Usa la memoria personale solo per aiutare quell’utente. Usa la memoria globale solo come esperienza anonima aggregata, senza nominare altri utenti e senza inventare dati privati. Puoi ragionare sui consumi, suggerire acquisti, spiegare foto, correggere quantità e preparare azioni sulla lista. Se non hai certezza, chiedi conferma.'},
      {role:'user',content:JSON.stringify({message,state:compactState,settings,memory:(memory||{}),globalAssistantExperience:globalMemory||{}}).slice(0,90000)}
    ]
  };
  const resp=await openAiResponse(payload);
  return outputText(resp) || localAiReply({message,state,settings,memory});
}
async function visionAnalyze({image,catalog,settings,memory}){
  if(!process.env.OPENAI_API_KEY){
    return { needsManual:true, productName:'', quantity:1, unit:'pz', category:'food', confidence:.25, reason:'Backend AI Vision non collegato: inserisci nome e quantità manualmente.' };
  }
  const compact=(catalog||[]).map(i=>({id:i.id,names:i.names,unit:i.unit,category:i.category,qty:i.qty})).slice(0,200);
  const prompt='Analizza SOLO quello che si vede realmente nella foto. Non inventare marca, prodotto o quantità se non sono visibili. Rispondi SOLO JSON valido con: needsRetake boolean, reason string, productName string, quantity number, unit string, category tra food/drinks/pets/house/pharmacy/aquarium/fruit/veg, confidence 0..1, visibleEvidence array di brevi prove visive. Se foto sfocata, buia, tagliata, prodotto non identificabile o quantità non stimabile, needsRetake true e reason breve. Se il prodotto sembra già nel catalogo usa lo stesso nome. Se vedi più prodotti, scegli quello principale e segnala nel reason che servono foto separate.';
  const payload={
    model:OPENAI_VISION_MODEL,
    input:[{role:'user',content:[{type:'input_text',text:prompt+' Catalogo: '+JSON.stringify(compact).slice(0,30000)},{type:'input_image',image_url:image}]}]
  };
  const resp=await openAiResponse(payload);
  const txt=outputText(resp).replace(/^```json\s*/,'').replace(/```$/,'').trim();
  try{ return JSON.parse(txt); }catch{ return {needsRetake:true, reason:'Risposta AI non leggibile, rifai la foto o inserisci manualmente.', productName:'', quantity:1, unit:'pz', category:'food', confidence:.1}; }
}

const server = http.createServer(async (req,res)=>{
  if(req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;
  const body = await readBody(req);

  try {
    if(req.method === 'GET' && pathName === '/api/health') return send(res, 200, { ok:true, service:'spesa-pronta-cloud', dbMode, dbConnected: dbMode !== 'file', time:new Date().toISOString() });

    if(req.method === 'GET' && pathName === '/api/db/status') {
      const users=Object.values(db.users||{});
      return send(res, 200, { ok:true, mode:dbMode, connected:dbMode !== 'file', users:users.length, verifiedUsers:users.filter(u=>u.emailVerified !== false && !u.emailVerifyTokenHash).length, pendingEmailUsers:users.filter(u=>u.emailVerified === false || u.emailVerifyTokenHash).length, households:Object.keys(db.households||{}).length });
    }

    if(req.method === 'GET' && pathName === '/api/ai/status') {
      return send(res, 200, {
        ok:true,
        connected: aiConnected(),
        provider: aiConnected() ? 'openai' : 'local-fallback',
        model: OPENAI_MODEL,
        visionModel: OPENAI_VISION_MODEL,
        visionReady: aiConnected(),
        dbMode,
        databaseConnected: dbMode !== 'file',
        memoryReady: dbMode !== 'file',
        globalLearning: 'anonymous_aggregate',
        smsReady: PHONE_VERIFY_READY,
        twilioVerifyReady: TWILIO_VERIFY_ENABLED,
        smsFromNumberReady: SMS_ENABLED,
        whatsappReady: WHATSAPP_ENABLED,
        note: aiConnected() ? 'AI Chat + Vision attive dal backend' : 'Manca OPENAI_API_KEY: usa motore locale e inserimento guidato foto'
      });
    }

    if(req.method === 'POST' && pathName === '/api/auth/register'){
      const { firstName='', lastName='', username, password, people=1, animals=0, autoSmart=true, items=[], aiMemory=null } = body;
      const email = normalizeEmail(body.email);
      const phone = normalizePhone(body.phoneCountry, body.phoneNumber, body.phone);
      if(!firstName || !lastName || !username || !email || !password || !phone) return send(res, 400, { error:'missing_fields' });
      if(String(firstName).trim().length < 2 || String(lastName).trim().length < 2) return send(res, 400, { error:'invalid_name' });
      if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(String(username||''))) return send(res, 400, { error:'invalid_username' });
      if(!isValidEmail(email)) return send(res, 400, { error:'invalid_email' });
      if(!isValidPhone(phone)) return send(res, 400, { error:'invalid_phone' });
      if(String(password).length < 8) return send(res, 400, { error:'weak_password' });
      if(Number(people)<1 || Number(people)>20 || Number(animals)<0 || Number(animals)>30) return send(res, 400, { error:'invalid_household_numbers' });
      const found = Object.values(db.users).find(u=>normalizeEmail(u.email)===email || String(u.phone||'')===phone);
      if(found && normalizeEmail(found.email)===email) return send(res, 409, { error:'email_exists' });
      if(found && String(found.phone||'')===phone) return send(res, 409, { error:'phone_exists' });
      const userId=id('user'), householdId=id('home'), tkn=token(), verifyRaw=token(), smsCode=makeSmsCode();
      const phoneVerifyFields = TWILIO_VERIFY_ENABLED
        ? { phoneVerified:false, phoneVerifyProvider:'twilio_verify', phoneVerifySentAt:Date.now() }
        : { phoneVerified:false, phoneVerifyProvider:'local_sms', phoneVerifyCodeHash:tokenHash(smsCode), phoneVerifyCodeExpiresAt:Date.now()+10*60*1000, phoneVerifySentAt:Date.now() };
      db.users[userId]={ id:userId, firstName, lastName, username, email, phone, passwordHash:hashPassword(password), householdId, emailVerified:false, emailVerifyTokenHash:tokenHash(verifyRaw), emailVerifyTokenExpiresAt:Date.now()+24*60*60*1000, emailVerifySentAt:Date.now(), ...phoneVerifyFields };
      db.households[householdId]={ id:householdId, ownerUserId:userId, token:tkn, settings:{ people, animals, autoSmart, alexaConnected:false, googleAssistantConnected:false, lang:'it', inventorySetupDone:false, inventoryStatus:'required', inventoryUpdatedAt:null, phoneMasked:maskPhone(phone) }, items, aiMemory: aiMemory || {messages:[],facts:[],events:[],scanHistory:[],summary:'',preferences:{},updatedAt:Date.now()}, updatedAt:Date.now() };
      await saveDb();
      sendVerificationEmail(db.users[userId], verifyRaw);
      sendPhoneVerificationSms(db.users[userId], smsCode);
      return send(res, 200, { ok:true, requiresEmailVerification:true, requiresPhoneVerification:true, email, phoneMasked:maskPhone(phone), smsReady:PHONE_VERIFY_READY, twilioVerifyReady:TWILIO_VERIFY_ENABLED, message:'verification_email_and_sms_sent' });
    }

    if(req.method === 'POST' && pathName === '/api/auth/login'){
      const { email,password } = body;
      const user = Object.values(db.users).find(u=>String(u.email||'').toLowerCase()===String(email||'').toLowerCase());
      if(!user || !verifyPassword(password, user.passwordHash)) return send(res, 401, { error:'invalid_credentials' });
      if(user.emailVerified === false || user.emailVerifyTokenHash) return send(res, 403, { error:'email_not_verified', email:user.email });
      if(user.phone && user.phoneVerified !== true) return send(res, 403, { error:'phone_not_verified', email:user.email, phoneMasked:maskPhone(user.phone) });
      if(!String(user.passwordHash||'').startsWith('pbkdf2$')){ user.passwordHash=hashPassword(password); await saveDb(); }
      const h = db.households[user.householdId];
      return send(res, 200, { ok:true, user:safeUser(user), householdId:h.id, token:h.token, settings:h.settings, items:h.items, aiMemory:h.aiMemory||null });
    }


    if(req.method === 'POST' && pathName === '/api/auth/verify-email'){
      const raw=String(body.token||'').trim();
      if(!raw) return send(res, 400, { error:'missing_token' });
      const hsh=tokenHash(raw);
      const user=Object.values(db.users||{}).find(u=>u.emailVerifyTokenHash===hsh && Number(u.emailVerifyTokenExpiresAt||0)>Date.now());
      if(!user) return send(res, 400, { error:'invalid_or_expired_token' });
      user.emailVerified=true;
      user.emailVerifiedAt=Date.now();
      delete user.emailVerifyTokenHash; delete user.emailVerifyTokenExpiresAt; delete user.emailVerifySentAt;
      if(!String(user.passwordHash||'').startsWith('pbkdf2$')) user.passwordHash=hashPassword(user.passwordHash || token());
      const h=db.households[user.householdId];
      await saveDb();
      if(user.phone && user.phoneVerified !== true){
        return send(res, 200, { ok:true, emailVerified:true, requiresPhoneVerification:true, email:user.email, phoneMasked:maskPhone(user.phone), smsReady:SMS_ENABLED });
      }
      sendWelcomeEmail(user);
      return send(res, 200, { ok:true, user:safeUser(user), householdId:h.id, token:h.token, settings:h.settings, items:h.items, aiMemory:h.aiMemory||null, welcomeEmail:true });
    }

    if(req.method === 'POST' && pathName === '/api/auth/resend-verification'){
      const email=normalizeEmail(body.email);
      const user=Object.values(db.users||{}).find(u=>normalizeEmail(u.email)===email);
      if(user && (user.emailVerified === false || user.emailVerifyTokenHash)){
        const raw=token();
        user.emailVerifyTokenHash=tokenHash(raw);
        user.emailVerifyTokenExpiresAt=Date.now()+24*60*60*1000;
        user.emailVerifySentAt=Date.now();
        await saveDb();
        sendVerificationEmail(user, raw);
      }
      return send(res, 200, { ok:true, message:'if_email_exists_verification_sent' });
    }



    if(req.method === 'POST' && pathName === '/api/auth/verify-phone'){
      const email=normalizeEmail(body.email);
      const code=String(body.code||'').replace(/\D+/g,'').trim();
      if(!email || !code) return send(res, 400, { error:'missing_fields' });
      const user=Object.values(db.users||{}).find(u=>normalizeEmail(u.email)===email);
      if(!user) return send(res, 400, { error:'invalid_code' });
      if(TWILIO_VERIFY_ENABLED || user.phoneVerifyProvider === 'twilio_verify'){
        const checked = await checkTwilioVerifySms(user.phone, code);
        if(!checked.ok) return send(res, 400, { error:'invalid_code', provider:'twilio_verify', twilioStatus:checked.twilioStatus||null });
      } else {
        if(!user.phoneVerifyCodeHash || Number(user.phoneVerifyCodeExpiresAt||0)<Date.now()) return send(res, 400, { error:'invalid_or_expired_code' });
        if(user.phoneVerifyCodeHash !== tokenHash(code)) return send(res, 400, { error:'invalid_code' });
      }
      user.phoneVerified=true;
      user.phoneVerifiedAt=Date.now();
      delete user.phoneVerifyCodeHash; delete user.phoneVerifyCodeExpiresAt; delete user.phoneVerifySentAt; delete user.phoneVerifyProvider;
      const h=db.households[user.householdId];
      if(h?.settings) h.settings.phoneMasked=maskPhone(user.phone||'');
      await saveDb();
      if(user.emailVerified === false || user.emailVerifyTokenHash) return send(res, 200, { ok:true, phoneVerified:true, requiresEmailVerification:true, email:user.email });
      sendWelcomeEmail(user);
      return send(res, 200, { ok:true, user:safeUser(user), householdId:h.id, token:h.token, settings:h.settings, items:h.items, aiMemory:h.aiMemory||null, welcomeEmail:true });
    }

    if(req.method === 'POST' && pathName === '/api/auth/resend-phone'){
      const email=normalizeEmail(body.email);
      const user=Object.values(db.users||{}).find(u=>normalizeEmail(u.email)===email);
      if(user && user.phone && user.phoneVerified !== true){
        const code=makeSmsCode();
        if(TWILIO_VERIFY_ENABLED){
          user.phoneVerifyProvider='twilio_verify';
          delete user.phoneVerifyCodeHash; delete user.phoneVerifyCodeExpiresAt;
        } else {
          user.phoneVerifyProvider='local_sms';
          user.phoneVerifyCodeHash=tokenHash(code);
          user.phoneVerifyCodeExpiresAt=Date.now()+10*60*1000;
        }
        user.phoneVerifySentAt=Date.now();
        await saveDb();
        sendPhoneVerificationSms(user, code);
      }
      return send(res, 200, { ok:true, message:'if_phone_exists_sms_sent', smsReady:PHONE_VERIFY_READY, twilioVerifyReady:TWILIO_VERIFY_ENABLED });
    }

    if(req.method === 'POST' && pathName === '/api/auth/forgot'){
      const email=String(body.email||'').trim().toLowerCase();
      const user=Object.values(db.users||{}).find(u=>String(u.email||'').toLowerCase()===email);
      if(user){
        const raw=token();
        if(user.emailVerified === false || user.emailVerifyTokenHash){
          user.emailVerifyTokenHash=tokenHash(raw);
          user.emailVerifyTokenExpiresAt=Date.now()+24*60*60*1000;
          user.emailVerifySentAt=Date.now();
          await saveDb();
          sendVerificationEmail(user, raw);
        } else {
          user.resetTokenHash=tokenHash(raw);
          user.resetTokenExpiresAt=Date.now()+30*60*1000;
          user.resetRequestedAt=Date.now();
          await saveDb();
          sendResetEmail(user, raw);
        }
      }
      return send(res, 200, { ok:true, message:'if_email_exists_reset_sent' });
    }

    if(req.method === 'POST' && pathName === '/api/auth/reset'){
      const raw=String(body.token||'').trim();
      const newPassword=String(body.password||'');
      if(!raw || newPassword.length<8) return send(res, 400, { error:'invalid_request' });
      const hsh=tokenHash(raw);
      const user=Object.values(db.users||{}).find(u=>u.resetTokenHash===hsh && Number(u.resetTokenExpiresAt||0)>Date.now());
      if(!user) return send(res, 400, { error:'invalid_or_expired_token' });
      user.passwordHash=hashPassword(newPassword);
      delete user.resetTokenHash; delete user.resetTokenExpiresAt; delete user.resetRequestedAt;
      await saveDb();
      sendPasswordChangedEmail(user);
      return send(res, 200, { ok:true });
    }

    const stateMatch = pathName.match(/^\/api\/households\/([^/]+)\/state$/);
    if(stateMatch){
      const householdId = stateMatch[1];
      const h = db.households[householdId];
      if(!h) return send(res, 404, { error:'household_not_found' });
      const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/,'');
      if(h.token !== bearer) return send(res, 401, { error:'unauthorized' });
      if(req.method === 'GET') return send(res, 200, { ok:true, items:h.items, settings:h.settings, aiMemory:h.aiMemory||null, updatedAt:h.updatedAt });
      if(req.method === 'PUT'){
        if(!Array.isArray(body.items)) return send(res, 400, { error:'items_required' });
        h.items = body.items;
        h.settings = { ...h.settings, ...(body.settings || {}) };
        if(body.aiMemory) h.aiMemory = body.aiMemory;
        h.updatedAt = Date.now();
        await saveDb();
        return send(res, 200, { ok:true, updatedAt:h.updatedAt, shoppingList: shoppingList(h) });
      }
    }

    const listMatch = pathName.match(/^\/api\/households\/([^/]+)\/shopping-list$/);
    if(req.method === 'GET' && listMatch){
      const householdId = listMatch[1];
      const h = db.households[householdId];
      if(!h) return send(res, 404, { error:'household_not_found' });
      const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/,'');
      if(h.token !== bearer) return send(res, 401, { error:'unauthorized' });
      return send(res, 200, { ok:true, shoppingList: shoppingList(h) });
    }



    if(req.method === 'POST' && pathName === '/api/assistant/whatsapp-list'){
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=db.households[householdId];
      if(!h) return send(res, 404, { error:'household_not_found' });
      if(h.token !== bearer) return send(res, 401, { error:'unauthorized' });
      const user=db.users[h.ownerUserId];
      const result=await sendShoppingWhatsapp(user,h);
      ensureHouseholdMemory(h);
      rememberMessage(h.aiMemory,'assistant','Lista spesa WhatsApp generata.',{channel:'whatsapp'});
      h.updatedAt=Date.now();
      await saveDb();
      return send(res, 200, { ok:true, sent:!!result.sent, simulated:!!result.simulated, reason:result.reason||null, whatsappReady:WHATSAPP_ENABLED, phoneVerified:user?.phoneVerified===true, phoneMasked:maskPhone(user?.phone||''), text:result.text });
    }

    if(req.method === 'POST' && pathName === '/api/ai/chat'){
      const { message='', state=[], settings={}, memory={} } = body;
      let h=null;
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      if(householdId && db.households[householdId] && db.households[householdId].token===bearer) h=db.households[householdId];
      const activeMemory=h ? ensureHouseholdMemory(h) : memory;
      if(h) rememberMessage(activeMemory,'user',message,{channel:'app-chat'});
      for(const fact of extractMemoryFacts(message)) if(h) rememberFact(activeMemory,fact,'chat');
      const reply = await llmChatReply({
        message,
        state: h ? (h.items||[]) : state,
        settings: h ? (h.settings||{}) : settings,
        memory: activeMemory,
        globalMemory: publicGlobalBrain()
      });
      if(h){
        rememberMessage(activeMemory,'assistant',reply,{channel:'app-chat'});
        updateGlobalBrain({message, action:'chat'});
        h.updatedAt=Date.now();
        await saveDb();
      }
      return send(res, 200, { ok:true, reply, memory: h ? activeMemory : memory, globalExperience: publicGlobalBrain(), persistent:!!h });
    }

    if(req.method === 'POST' && pathName === '/api/ai/vision'){
      const { image='', catalog=[], settings={}, memory={} } = body;
      if(!image || !String(image).startsWith('data:image/')) return send(res, 400, { error:'image_required' });
      let h=null;
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      if(householdId && db.households[householdId] && db.households[householdId].token===bearer) h=db.households[householdId];
      const activeMemory=h ? ensureHouseholdMemory(h) : memory;
      const result = await visionAnalyze({image,catalog:h?(h.items||[]):catalog,settings:h?(h.settings||{}):settings,memory:activeMemory});
      if(h){
        activeMemory.scanHistory.push({
          productName:result.productName||'', quantity:result.quantity||null, unit:result.unit||'', category:result.category||'', confidence:result.confidence||0, needsRetake:!!result.needsRetake, reason:result.reason||'', visibleEvidence:result.visibleEvidence||[], at:Date.now()
        });
        activeMemory.scanHistory=activeMemory.scanHistory.slice(-500);
        rememberMessage(activeMemory,'assistant', result.needsRetake ? `Foto non abbastanza chiara: ${result.reason||'rifalla meglio.'}` : `Ho analizzato la foto: ${result.productName||'prodotto'} (${result.quantity||1} ${result.unit||'pz'}).`, {channel:'vision'});
        updateGlobalBrain({action:'photo', productName:result.productName, category:result.category, confidence:result.confidence});
        h.updatedAt=Date.now();
        await saveDb();
      }
      return send(res, 200, { ok:true, result, memory:h?activeMemory:memory, persistent:!!h });
    }

    if(req.method === 'GET' && pathName === '/api/ai/global-memory'){
      return send(res, 200, { ok:true, globalExperience: publicGlobalBrain(), privacy:'aggregated_anonymous_only' });
    }

    const aiAnalysisMatch = pathName.match(/^\/api\/households\/([^/]+)\/ai-analysis$/);
    if(req.method === 'GET' && aiAnalysisMatch){
      const householdId = aiAnalysisMatch[1];
      const h = db.households[householdId];
      if(!h) return send(res, 404, { error:'household_not_found' });
      const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/, '');
      if(h.token !== bearer) return send(res, 401, { error:'unauthorized' });
      const analysis=(h.items||[]).map(i=>({id:i.id,name:itemName(i,h.settings?.lang||'it'),qty:i.qty,unit:i.unit,threshold:smartThreshold(i,h.settings,h.aiMemory||{}),recommended:recommendedQty(i,h.settings,h.aiMemory||{}),daysLeft:daysLeft(i,h.settings,h.aiMemory||{}),reason:consumptionReason(i,h.settings,h.aiMemory||{}),toBuy:isBuy(i,h.settings,h.aiMemory||{})}));
      return send(res, 200, {ok:true, analysis, memory:h.aiMemory||{}});
    }

    if(req.method === 'GET' && pathName === '/api/voice/status'){
      const voice = getVoiceAuth(req, url, body);
      if(voice.error) return send(res, 401, { ok:false, error:voice.error });
      return send(res, 200, { ok:true, connected:true, householdId:voice.householdId, shoppingItems:shoppingList(voice.h).length, alexaConnected:!!voice.h.settings?.alexaConnected, googleAssistantConnected:!!voice.h.settings?.googleAssistantConnected });
    }

    if(req.method === 'POST' && pathName === '/api/alexa'){
      const voice = getVoiceAuth(req, url, body);
      if(voice.error) return send(res, 200, alexaSpeak(voice.error));
      const h = voice.h;
      const intent = body?.request?.intent?.name || body?.intent || '';
      const slots = body?.request?.intent?.slots || body?.slots || {};
      const product = slots.Product?.value || slots.product?.value || body?.product;
      const qty = Number(slots.Quantity?.value || slots.quantity?.value || body?.qty || 0);
      const unit = slots.Unit?.value || slots.unit?.value || body?.unit;

      const text = await handleVoiceIntent(h, { intent, product, qty, unit, phrase: body?.request?.intent?.slots?.Phrase?.value || body?.text || product || intent });
      return send(res, 200, alexaSpeak(text));
    }

    if(req.method === 'POST' && (pathName === '/api/google-assistant' || pathName === '/api/google' || pathName === '/api/gemini-assistant')){
      const voice = getVoiceAuth(req, url, body);
      if(voice.error) return send(res, 200, googleAssistantSpeak(voice.error));
      const parsed = parseGoogleAssistantRequest(body);
      const text = await handleVoiceIntent(voice.h, {...parsed, phrase: body.queryResult?.queryText || body.text || body.transcript || body.query || parsed.product || parsed.intent});
      return send(res, 200, googleAssistantSpeak(text));
    }

    if(serveStatic(req,res,url)) return;
    return send(res, 404, { error:'not_found' });
  } catch(err) {
    console.error(err);
    return send(res, 500, { error:'server_error' });
  }
});

initStorage()
  .then(() => server.listen(PORT, ()=>console.log(`Spesa Pronta all-in-one running on http://localhost:${PORT} - db=${dbMode}`)))
  .catch(err => {
    console.error('Errore connessione database:', err);
    process.exit(1);
  });
