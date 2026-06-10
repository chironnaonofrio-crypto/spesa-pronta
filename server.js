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
const OPENAI_MODEL_FALLBACKS = String(process.env.OPENAI_MODEL_FALLBACKS || 'gpt-5.5,gpt-5.4-mini,gpt-5.4-nano').split(',').map(s=>s.trim()).filter(Boolean);
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
const VISION_SEED_MEMORY = loadVisionSeedMemory();
const VISION_MEGA_INDEX = loadVisionMegaIndex();
const WHATSAPP_ENABLED = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);

// V28.39 - OpenAI max_output_tokens guard + OpenAI connection guard: chiave solo lato server, diagnostica reale e fallback modelli.
let lastOpenAiRuntimeV2836 = { ok:null, testedAt:0, model:'', status:'not_tested', message:'Connessione OpenAI non ancora testata', source:'', maskedKey:'' };
function pickEnvValueV2836(names=[]){
  for(const name of names){
    const raw=process.env[name];
    if(raw!==undefined && raw!==null && String(raw).trim()) return {name,value:String(raw).trim()};
  }
  return {name:'',value:''};
}
function isPlaceholderOpenAiKeyV2836(value=''){
  const v=String(value||'').trim();
  if(!v) return true;
  return /^(INSERISCI|METTI|YOUR_|LA_TUA|sk-xxx|xxx|none|null|undefined|changeme)/i.test(v) || v.length<20;
}
function maskOpenAiKeyV2836(value=''){
  const v=String(value||'').trim();
  if(!v) return '';
  if(v.length<=12) return '***';
  return v.slice(0,7)+'…'+v.slice(-4);
}
function openAiKeyDiagnosticV2836(){
  const found=pickEnvValueV2836(['OPENAI_API_KEY','OPENAI_KEY','OPENAI_SECRET_KEY','OPENAI_TOKEN']);
  const valid=!!found.value && !isPlaceholderOpenAiKeyV2836(found.value);
  return {
    configured: valid,
    source: found.name || '',
    maskedKey: valid ? maskOpenAiKeyV2836(found.value) : '',
    reason: valid ? 'key_configured_server_side' : (found.value ? 'placeholder_or_invalid_key_value' : 'missing_openai_api_key'),
    expectedEnv: 'OPENAI_API_KEY',
    acceptedEnvAliases: ['OPENAI_API_KEY','OPENAI_KEY','OPENAI_SECRET_KEY','OPENAI_TOKEN']
  };
}
function getOpenAiKeyV2836(){
  const found=pickEnvValueV2836(['OPENAI_API_KEY','OPENAI_KEY','OPENAI_SECRET_KEY','OPENAI_TOKEN']);
  return (!found.value || isPlaceholderOpenAiKeyV2836(found.value)) ? '' : found.value;
}
function openAiModelCandidatesV2836(primary=''){
  const out=[];
  for(const m of [primary, OPENAI_VISION_MODEL, OPENAI_MODEL, ...OPENAI_MODEL_FALLBACKS]){
    const clean=String(m||'').trim();
    if(clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}
function isRetryableOpenAiModelErrorV2836(status, text=''){
  const t=String(text||'').toLowerCase();
  return [400,403,404].includes(Number(status)) && /(model|does not exist|not found|unsupported|permission|access|not available|invalid.*model)/i.test(t);
}
function classifyOpenAiErrorV2836(err){
  const msg=String(err?.message||err||'').slice(0,700);
  if(/missing_openai_api_key|missing_openai_key/i.test(msg)) return {code:'missing_openai_api_key', message:'OPENAI_API_KEY mancante sul server'};
  if(/401|unauthorized|incorrect api key|invalid api key/i.test(msg)) return {code:'invalid_openai_api_key', message:'Chiave OpenAI non valida o non autorizzata'};
  if(/429|quota|billing|insufficient_quota|rate limit/i.test(msg)) return {code:'openai_quota_or_rate_limit', message:'Quota/billing/rate limit OpenAI da controllare'};
  if(/model|does not exist|not found|unsupported|permission|access|not available/i.test(msg)) return {code:'openai_model_unavailable', message:'Modello OpenAI non disponibile per questa chiave'};
  if(/abort|timeout|timed out|network|fetch failed|econn/i.test(msg)) return {code:'openai_network_timeout', message:'Timeout o rete tra server e OpenAI'};
  return {code:'openai_unknown_error', message:msg || 'Errore OpenAI non classificato'};
}
function openAiTeacherIsUsableV2836(){
  if(!getOpenAiKeyV2836()) return false;
  if(lastOpenAiRuntimeV2836.testedAt && lastOpenAiRuntimeV2836.ok===false) return false;
  return true;
}
function openAiTeacherMessageV2836(){
  const diag=openAiKeyDiagnosticV2836();
  if(!diag.configured) return 'Docente OpenAI non attivo: OPENAI_API_KEY mancante sul server';
  if(lastOpenAiRuntimeV2836.testedAt && lastOpenAiRuntimeV2836.ok===false) return 'Docente OpenAI configurato ma non raggiungibile: '+(lastOpenAiRuntimeV2836.message||'controlla Diagnosi OpenAI');
  if(lastOpenAiRuntimeV2836.testedAt && lastOpenAiRuntimeV2836.ok===true) return 'Docente OpenAI attivo e testato ('+(lastOpenAiRuntimeV2836.model||OPENAI_VISION_MODEL)+')';
  return 'Docente OpenAI configurato sul server: pronto al test reale';
}
async function openAiHealthCheckV2836(){
  const diag=openAiKeyDiagnosticV2836();
  if(!diag.configured){
    lastOpenAiRuntimeV2836={ok:false,testedAt:Date.now(),model:'',status:diag.reason,message:'OPENAI_API_KEY mancante o placeholder',source:diag.source,maskedKey:diag.maskedKey};
    return {ok:false, connected:false, teacherActive:false, status:diag.reason, message:lastOpenAiRuntimeV2836.message, diagnostics:diag, model:OPENAI_MODEL, visionModel:OPENAI_VISION_MODEL};
  }
  try{
    const resp=await openAiResponse({model:OPENAI_MODEL,max_output_tokens:16,input:[{role:'user',content:'Rispondi solo OK'}]}, {kind:'health'});
    const txt=outputText(resp).trim();
    lastOpenAiRuntimeV2836=Object.assign({},lastOpenAiRuntimeV2836,{ok:true,testedAt:Date.now(),status:'active',message:'OpenAI raggiunto correttamente',source:diag.source,maskedKey:diag.maskedKey});
    return {ok:true, connected:true, teacherActive:true, status:'active', message:'OpenAI raggiunto correttamente', output:txt.slice(0,40), diagnostics:diag, model:lastOpenAiRuntimeV2836.model||OPENAI_MODEL, visionModel:OPENAI_VISION_MODEL, testedAt:lastOpenAiRuntimeV2836.testedAt};
  }catch(err){
    const c=classifyOpenAiErrorV2836(err);
    lastOpenAiRuntimeV2836={ok:false,testedAt:Date.now(),model:lastOpenAiRuntimeV2836.model||OPENAI_MODEL,status:c.code,message:c.message,source:diag.source,maskedKey:diag.maskedKey,raw:String(err?.message||err||'').slice(0,500)};
    return {ok:false, connected:false, teacherActive:false, status:c.code, message:c.message, diagnostics:diag, model:lastOpenAiRuntimeV2836.model||OPENAI_MODEL, visionModel:OPENAI_VISION_MODEL, testedAt:lastOpenAiRuntimeV2836.testedAt};
  }
}

let db = { users:{}, households:{} };
let dbMode = 'file';
let pgPool = null;

function emptyDb(){ return { users:{}, households:{}, assistantBrain:{version:3, globalFacts:[], productLearnings:{}, globalProductMemory:{products:{}, confirmations:0, teacherHelp:0, localRecognitions:0, updatedAt:0}, learningAudit:[], phrasePatterns:{}, dailyStats:{}, autonomousVision:{products:{},voice:{},samples:0,corrections:0}, seedMemory:{version:'',products:0,totalProfiles:0,loaded:false}, updatedAt:0} }; }

function loadVisionSeedMemory(){
  const candidates=[path.resolve(STATIC_DIR,'assets/vision-seed-memory.json'), path.resolve(process.cwd(),'assets/vision-seed-memory.json')];
  for(const file of candidates){
    try{
      if(fs.existsSync(file)){
        const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
        if(Array.isArray(parsed.products)) return parsed;
      }
    }catch(e){ console.warn('Vision seed memory load failed', e.message); }
  }
  return {version:'missing', products:[], categories:[], rules:{}};
}
function loadVisionMegaIndex(){
  const candidates=[path.resolve(STATIC_DIR,'assets/vision-mega-index.json'), path.resolve(process.cwd(),'assets/vision-mega-index.json')];
  for(const file of candidates){
    try{
      if(fs.existsSync(file)){
        const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
        if(Number(parsed.totalProfiles||0)>0) return parsed;
      }
    }catch(e){ console.warn('Vision mega index load failed', e.message); }
  }
  return {version:'mega-vision-v48-1000000', totalProfiles:1000000, activeSeedProfiles:(VISION_SEED_MEMORY.products||[]).length};
}
function seedCategoryToAppServer(cat=''){
  const map={water:'water',soft_drinks:'soft_drinks',dairy:'dairy',deli:'meat_deli',pasta_rice:'pasta_rice',pantry:'food',breakfast_snacks:'breakfast_snacks',fruit:'fruit',vegetables:'veg',frozen:'frozen',cleaning:'house',paper_house:'house',personal_care:'personal_care',pets:'pets',baby:'food'};
  return map[cat] || cat || 'food';
}

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
function hashStable(raw){ return crypto.createHash('sha256').update(String(raw||'')).digest('hex'); }

function nowIso(){ return new Date().toISOString(); }
function ensureDbShape(){
  db = db || emptyDb();
  db.users = db.users || {};
  db.households = db.households || {};
  db.assistantBrain = db.assistantBrain || {version:2, globalFacts:[], productLearnings:{}, phrasePatterns:{}, dailyStats:{}, autonomousVision:{products:{},voice:{},samples:0,corrections:0}, updatedAt:0};
  db.assistantBrain.globalFacts = db.assistantBrain.globalFacts || [];
  db.assistantBrain.productLearnings = db.assistantBrain.productLearnings || {};
  db.assistantBrain.globalProductMemory = db.assistantBrain.globalProductMemory || {products:{}, confirmations:0, teacherHelp:0, localRecognitions:0, updatedAt:0};
  db.assistantBrain.globalProductMemory.products = db.assistantBrain.globalProductMemory.products || {};
  db.assistantBrain.learningAudit = Array.isArray(db.assistantBrain.learningAudit) ? db.assistantBrain.learningAudit : [];
  db.assistantBrain.knowledgeFeeder = db.assistantBrain.knowledgeFeeder || {lookups:0,enriched:0,misses:0,errors:0,updatedAt:0,lastSources:[]};
  db.assistantBrain.knowledgeCache = db.assistantBrain.knowledgeCache || {version:94, entries:{}, hits:0, misses:0, barcodeHits:0, updatedAt:0};
  db.assistantBrain.knowledgeCache.entries = db.assistantBrain.knowledgeCache.entries || {};
  db.assistantBrain.errorLearning = db.assistantBrain.errorLearning || {version:94, corrections:[], patterns:{}, updatedAt:0};
  db.assistantBrain.barcodeBrain = db.assistantBrain.barcodeBrain || {version:94, products:{}, hits:0, misses:0, updatedAt:0};
  db.assistantBrain.barcodeBrain.products = db.assistantBrain.barcodeBrain.products || {};
  db.assistantBrain.categoryBrainV95 = db.assistantBrain.categoryBrainV95 || {version:95, decisions:0, lowConfidence:0, last:[], updatedAt:0};
  db.assistantBrain.monsterBrainV96 = db.assistantBrain.monsterBrainV96 || {version:96, decisions:0, lowConfidence:0, correctionsLearned:0, teacherAvoided:0, productIdentities:{}, recurrentErrors:{}, fieldStats:{}, last:[], updatedAt:0};
  db.assistantBrain.phrasePatterns = db.assistantBrain.phrasePatterns || {};
  db.assistantBrain.dailyStats = db.assistantBrain.dailyStats || {};
  db.assistantBrain.autonomousVision = db.assistantBrain.autonomousVision || {products:{},voice:{},samples:0,corrections:0};
  db.assistantBrain.autonomousVision.products = db.assistantBrain.autonomousVision.products || {};
  db.assistantBrain.autonomousVision.voice = db.assistantBrain.autonomousVision.voice || {};
  db.assistantBrain.seedMemory = {version:VISION_SEED_MEMORY.version||'', products:(VISION_SEED_MEMORY.products||[]).length, totalProfiles:Number(VISION_MEGA_INDEX.totalProfiles||1000000), megaVersion:VISION_MEGA_INDEX.version||'', categories:(VISION_SEED_MEMORY.categories||[]).length, loaded:(VISION_SEED_MEMORY.products||[]).length>0};
  Object.values(db.households||{}).forEach(h=>{
    h.aiMemory = h.aiMemory || {messages:[],facts:[],events:[],scanHistory:[],learnedProducts:[],productDeepMemory:[],productMemoryIndex:{},summary:'',preferences:{},updatedAt:0};
    h.aiMemory.messages = h.aiMemory.messages || [];
    h.aiMemory.facts = h.aiMemory.facts || [];
    h.aiMemory.events = h.aiMemory.events || [];
    h.aiMemory.scanHistory = h.aiMemory.scanHistory || [];
    h.aiMemory.learnedProducts = h.aiMemory.learnedProducts || [];
    h.aiMemory.productDeepMemory = Array.isArray(h.aiMemory.productDeepMemory) ? h.aiMemory.productDeepMemory : [];
    h.aiMemory.productMemoryIndex = h.aiMemory.productMemoryIndex || {};
    h.aiMemory.visionBrain = h.aiMemory.visionBrain || {version:41,serverSamples:[],productModels:{},productStats:{},serverSyncs:0};
    h.aiMemory.voiceProfile = h.aiMemory.voiceProfile || {version:41,heard:[],corrections:[],intentPhrases:{},fieldPhrases:{},productAliases:{},speakerStyle:{},serverSyncs:0};
    h.aiMemory.preferences = h.aiMemory.preferences || {};
  });
}
function ensureHouseholdMemory(h){
  h.aiMemory = h.aiMemory || {messages:[],facts:[],events:[],scanHistory:[],learnedProducts:[],productDeepMemory:[],productMemoryIndex:{},summary:'',preferences:{},updatedAt:0};
  h.aiMemory.messages = h.aiMemory.messages || [];
  h.aiMemory.facts = h.aiMemory.facts || [];
  h.aiMemory.events = h.aiMemory.events || [];
  h.aiMemory.scanHistory = h.aiMemory.scanHistory || [];
  h.aiMemory.learnedProducts = h.aiMemory.learnedProducts || [];
  h.aiMemory.productDeepMemory = Array.isArray(h.aiMemory.productDeepMemory) ? h.aiMemory.productDeepMemory : [];
  h.aiMemory.productMemoryIndex = h.aiMemory.productMemoryIndex || {};
  h.aiMemory.visionBrain = h.aiMemory.visionBrain || {version:41,serverSamples:[],productModels:{},productStats:{},serverSyncs:0};
  h.aiMemory.voiceProfile = h.aiMemory.voiceProfile || {version:41,heard:[],corrections:[],intentPhrases:{},fieldPhrases:{},productAliases:{},speakerStyle:{},serverSyncs:0};
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



// V27.94 Smart Knowledge Cache + Barcode Brain
function extractBarcodeCandidates(...parts){
  const raw=parts.flatMap(p=>Array.isArray(p)?p:[p]).filter(Boolean).join(' ');
  const found=[];
  const re=/(?:^|\D)(\d[\d\s.-]{6,18}\d)(?!\d)/g;
  let m;
  while((m=re.exec(raw))){
    const code=String(m[1]||'').replace(/\D+/g,'');
    if(code.length>=8 && code.length<=14 && !/^0+$/.test(code)) found.push(code);
  }
  return [...new Set(found)];
}
function bestBarcodeFromConfirmed(confirmed={}){
  const explicit=[confirmed.barcode,confirmed.ean,confirmed.code,confirmed.productCode,confirmed.productMemory?.barcode,confirmed.productMemory?.externalKnowledge?.code].filter(Boolean);
  const parsed=extractBarcodeCandidates(explicit,...(confirmed.detectedText||[]),...(confirmed.visibleEvidence||[]),confirmed.productName,confirmed.brand,confirmed.size,confirmed.format);
  return parsed[0]||'';
}
function knowledgeCacheKey(source={}, confirmed={}, query=''){
  const code=bestBarcodeFromConfirmed(confirmed);
  if(code) return `${source.id||'source'}|ean|${code}`;
  return `${source.id||'source'}|q|${normalizeText([confirmed.brand,confirmed.productName,confirmed.size,query].filter(Boolean).join(' ')).slice(0,140)}`;
}
function getKnowledgeCache(key){
  ensureDbShape();
  const cache=db.assistantBrain.knowledgeCache;
  const row=cache.entries[key];
  if(!row) return null;
  const maxAge=1000*60*60*24*30;
  if(row.updatedAt && Date.now()-row.updatedAt>maxAge) return null;
  cache.hits=Number(cache.hits||0)+1;
  if(key.includes('|ean|')) cache.barcodeHits=Number(cache.barcodeHits||0)+1;
  cache.updatedAt=Date.now();
  return row;
}
function setKnowledgeCache(key, value={}){
  ensureDbShape();
  const cache=db.assistantBrain.knowledgeCache;
  cache.entries[key]=Object.assign({updatedAt:Date.now()}, value||{});
  const keys=Object.keys(cache.entries);
  if(keys.length>1800){
    keys.sort((a,b)=>Number(cache.entries[a]?.updatedAt||0)-Number(cache.entries[b]?.updatedAt||0)).slice(0,keys.length-1800).forEach(k=>delete cache.entries[k]);
  }
  cache.updatedAt=Date.now();
}
async function fetchOpenFactsByBarcode(source, code){
  if(!code || !/^\d{8,14}$/.test(String(code))) return null;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), KNOWLEDGE_FEEDER_TIMEOUT_MS);
  try{
    const url=`${source.base}/api/v2/product/${encodeURIComponent(code)}.json?fields=${encodeURIComponent(productKnowledgeFields())}`;
    const r=await fetch(url,{headers:{'User-Agent':OPEN_FACTS_USER_AGENT,'Accept':'application/json'},signal:ctrl.signal});
    if(!r.ok) return null;
    const data=await r.json().catch(()=>null);
    if(data?.status===1 && data.product) return data.product;
    return null;
  }catch(_){ return null; }
  finally{ clearTimeout(timer); }
}
function recordUserCorrectionLearning(confirmed={}){
  ensureDbShape();
  const corrections=confirmed.userCorrections||{};
  const keys=Object.keys(corrections).filter(k=>corrections[k] && corrections[k].edited);
  if(!keys.length) return;
  const entry={at:Date.now(), productName:confirmed.productName||'', brand:confirmed.brand||'', size:confirmed.size||'', category:confirmed.category||'', corrections:{}};
  for(const k of keys){ entry.corrections[k]=corrections[k]; }
  const bank=db.assistantBrain.errorLearning;
  bank.corrections.unshift(entry);
  bank.corrections=bank.corrections.slice(0,800);
  for(const k of keys){
    const before=normalizeText(corrections[k].from||'');
    const after=normalizeText(corrections[k].to||'');
    if(before && after && before!==after){
      const pat=`${k}:${before}->${after}`;
      bank.patterns[pat]=Number(bank.patterns[pat]||0)+1;
    }
  }
  bank.updatedAt=Date.now();
}

function productLearningStopTokens(){
  return new Set(['prodotto','marca','formato','tipo','confezione','barattolo','vasetto','bottiglia','squeeze','etichetta','visibile','frontale','con','senza','di','del','della','delle','alla','allo','un','una','il','lo','la','gli','le','ml','g','gr','grammi','l','lt','pz','conf','pack']);
}
function productCoreTokens(...parts){
  const stop=productLearningStopTokens();
  return [...new Set(normalizeText(parts.filter(Boolean).join(' ')).split(/[^a-z0-9]+/).filter(t=>t.length>2 && !stop.has(t)))];
}

function productStrongTokens(...parts){
  // V27.89: token identità più severi. Esclude parole di confezione/generiche così il server non impara "vasetto" come identità prodotto.
  const generic=new Set(['salsa','pesto','crema','condimento','prodotto','alimento','gusto','base','tipo','squeeze','barattolo','vasetto','bottiglia','tappo','etichetta','frontale','verde','rosso','nero','bianco','classico','originale','pezzi','pezzo']);
  return productCoreTokens(...parts).filter(t=>!generic.has(t) && t.length>2);
}
function tokenJaccard(a=[],b=[]){
  const A=new Set(a||[]), B=new Set(b||[]); if(!A.size && !B.size) return 0;
  let inter=0; for(const t of A){ if(B.has(t)) inter++; }
  const union=new Set([...A,...B]).size||1; return inter/union;
}
function brandLooksConflicting(a='',b=''){
  const A=productStrongTokens(a), B=productStrongTokens(b);
  if(!A.length || !B.length) return false;
  const overlap=tokenJaccard(A,B);
  return overlap===0 && normalizeText(a)!==normalizeText(b);
}
function productIdentityConflict(existing={}, incoming={}){
  // V27.89: evita fusioni tipo pesto/salsa/yogurt quando la memoria ha una categoria o marca diversa.
  const eBrand=existing.brand||'', iBrand=incoming.brand||'';
  if(brandLooksConflicting(eBrand,iBrand)) return {conflict:true, reason:'brand_conflict'};
  const eName=existing.productName||'', iName=incoming.productName||'';
  const eTokens=productStrongTokens(eName, existing.evidenceTokens?.join?.(' ')||'');
  const iTokens=productStrongTokens(iName, incoming.visibleEvidence?.join?.(' ')||'', incoming.detectedText?.join?.(' ')||'');
  const nameOverlap=tokenJaccard(eTokens,iTokens);
  const eFamily=productCategoryFamily(existing.category||''), iFamily=productCategoryFamily(incoming.category||incoming.productMemory?.category||'');
  if(eFamily && iFamily && eFamily!==iFamily && nameOverlap<0.34) return {conflict:true, reason:'category_family_conflict'};
  if(eTokens.length>=2 && iTokens.length>=2 && nameOverlap===0 && !normalizeText(eName).includes(normalizeText(iName)) && !normalizeText(iName).includes(normalizeText(eName))) return {conflict:true, reason:'identity_tokens_conflict'};
  return {conflict:false, reason:''};
}


function productSizeCompatible(a='', b=''){
  const A=normalizeText(a||'').replace(/\s+/g,' ').trim();
  const B=normalizeText(b||'').replace(/\s+/g,' ').trim();
  if(!A || !B) return true;
  if(A===B) return true;
  const numA=(A.match(/\d+(?:[.,]\d+)?/)||[''])[0].replace(',','.');
  const numB=(B.match(/\d+(?:[.,]\d+)?/)||[''])[0].replace(',','.');
  const unitA=(A.match(/\b(kg|g|gr|ml|l|lt)\b/)||[''])[0];
  const unitB=(B.match(/\b(kg|g|gr|ml|l|lt)\b/)||[''])[0];
  if(numA && numB && numA===numB && (!unitA || !unitB || unitA===unitB || (['l','lt'].includes(unitA)&&['l','lt'].includes(unitB)) || (['g','gr'].includes(unitA)&&['g','gr'].includes(unitB)))) return true;
  return false;
}
function productTextSimilarityScore(existing={}, incoming={}){
  const inText=[incoming.productName,incoming.brand,incoming.size||incoming.format,incoming.category,(incoming.detectedText||[]).join(' '),(incoming.visibleEvidence||[]).join(' ')].join(' ');
  const exText=[existing.productName,existing.brand,existing.format,existing.category,(existing.detectedText||[]).join(' '),(existing.visibleEvidence||[]).join(' '),(existing.evidenceTokens||[]).join(' ')].join(' ');
  const inStrong=productStrongTokens(inText);
  const exStrong=productStrongTokens(exText);
  const strong=tokenJaccard(inStrong, exStrong);
  const inCore=productCoreTokens(inText);
  const exCore=productCoreTokens(exText);
  const core=tokenJaccard(inCore, exCore);
  const brandMatch=!!incoming.brand && !!existing.brand && !brandLooksConflicting(existing.brand,incoming.brand) && tokenJaccard(productStrongTokens(existing.brand), productStrongTokens(incoming.brand))>0;
  const nameNorm=normalizeText(incoming.productName||'');
  const oldNameNorm=normalizeText(existing.productName||'');
  const nameContains=!!nameNorm && !!oldNameNorm && (nameNorm.includes(oldNameNorm) || oldNameNorm.includes(nameNorm));
  const categoryOk=productCategoryFamily(existing.category||'')===productCategoryFamily(incoming.category||incoming.productMemory?.category||'') || !existing.category || !(incoming.category||incoming.productMemory?.category);
  const sizeOk=productSizeCompatible(existing.format||'', incoming.size||incoming.format||incoming.estimatedSize||'');
  let score=0;
  score += strong*0.45 + core*0.20;
  if(brandMatch) score += 0.20;
  if(nameContains) score += 0.12;
  if(categoryOk) score += 0.08;
  if(sizeOk) score += 0.08;
  return Math.min(1, Number(score.toFixed(3)));
}
function findExistingProductForBarcodeUpgrade(gpm={}, confirmed={}, barcode=''){
  if(!barcode) return null;
  const products=Object.values(gpm.products||{});
  let best=null;
  for(const p of products){
    if(!p || String(p.key||'').startsWith('ean:')) continue;
    if(Array.isArray(p.barcodes) && p.barcodes.length) continue;
    const conflict=productIdentityConflict(p, confirmed);
    if(conflict.conflict) continue;
    const score=productTextSimilarityScore(p, confirmed);
    const sameBrand=!brandLooksConflicting(p.brand||'', confirmed.brand||'') && (!!p.brand || !!confirmed.brand);
    const strongEnough=(score>=0.58) || (sameBrand && score>=0.44);
    if(!strongEnough) continue;
    if(!best || score>best.score) best={record:p, score};
  }
  return best;
}
function migrateGlobalProductKey(gpm={}, record={}, newKey=''){
  if(!record || !newKey) return record;
  const oldKey=record.key||'';
  if(oldKey && oldKey!==newKey && gpm.products && gpm.products[oldKey]===record){
    delete gpm.products[oldKey];
  }
  record.previousKeys=[...new Set([...(record.previousKeys||[]), oldKey].filter(Boolean))].slice(0,10);
  record.key=newKey;
  return record;
}

function voteConfidence(map={}, topValue=''){
  const entries=Object.entries(map||{}); const total=entries.reduce((s, [,v])=>s+Number(v||0),0);
  if(!total || !topValue) return 0;
  return Number((Number(map[topValue]||0)/total).toFixed(3));
}
function updateFieldConfidence(record={}){
  record.fieldConfidence=record.fieldConfidence||{};
  for(const [field,votes] of [['productName',record.nameVotes],['brand',record.brandVotes],['format',record.formatVotes],['category',record.categoryVotes],['unit',record.unitVotes]]){
    const top=field==='format'?record.format:record[field];
    record.fieldConfidence[field]=voteConfidence(votes||{},top||'');
  }
  record.teacherBypassEligible=Number(record.confirmations||0)>=2 && (record.reliability==='media'||record.reliability==='alta'||(record.fieldConfidence.productName>=0.66 && (!record.brand||record.fieldConfidence.brand>=0.55)));
  return record;
}

function productCategoryFamily(category=''){
  const c=normalizeText(category);
  if(['water','soft_drinks','juice','milk_drinks','drinks'].includes(c)) return 'drinks';
  if(['yogurt','dairy','milk_drinks'].includes(c)) return 'dairy';
  if(['sauces_condiments','spreads','preserves_jars'].includes(c)) return 'condiments';
  if(['chocolate_sweets','breakfast_snacks','bakery'].includes(c)) return 'snacks';
  if(['house','personal_care','pets','pharmacy','aquarium'].includes(c)) return c;
  return c || 'food';
}
function productMemoryGlobalKey(productName='', brand='', size=''){
  const brandKey=normalizeText(brand).replace(/[^a-z0-9]+/g,' ').trim();
  const tokens=productCoreTokens(productName).filter(t=>!['salsa','pesto','crema','condimento','base'].includes(t) || productCoreTokens(productName).length<=2).slice(0,7);
  const nameKey=(tokens.join(' ') || normalizeText(productName)).slice(0,90);
  const sizeKey=normalizeText(size).replace(/\s+/g,' ').trim().slice(0,24);
  return normalizeText([brandKey,nameKey,sizeKey].filter(Boolean).join(' ')).slice(0,150) || normalizeText(productName).slice(0,80);
}
function productCanonicalKey(productName='', brand=''){
  const brandKey=normalizeText(brand).replace(/[^a-z0-9]+/g,' ').trim();
  const tokens=productCoreTokens(productName).slice(0,7).join(' ');
  return normalizeText([brandKey,tokens].filter(Boolean).join(' ')).slice(0,130) || normalizeText(productName).slice(0,80);
}
function voteMapAdd(map={}, value=''){
  const v=String(value||'').trim();
  if(!v) return map||{};
  map=map||{}; map[v]=Number(map[v]||0)+1; return map;
}
function voteMapTop(map={}){
  return Object.entries(map||{}).sort((a,b)=>Number(b[1])-Number(a[1]))[0]?.[0] || '';
}
function compactGlobalProductRecord(record={}){
  return {
    key:record.key||'', canonicalKey:record.canonicalKey||'', productName:record.productName||'', brand:record.brand||'', format:record.format||record.size||'', category:record.category||'', categoryFamily:record.categoryFamily||productCategoryFamily(record.category||''),
    confirmations:Number(record.confirmations||0), uniqueHouseholds:Object.keys(record.households||{}).length, teacherHelp:Number(record.teacherHelp||0), localRecognitions:Number(record.localRecognitions||0),
    confidence:Number(record.confidence||0), reliability:record.reliability||'bassa', updatedAt:record.updatedAt||0,
    aliases:Array.isArray(record.aliases)?record.aliases.slice(0,8):[], brands:Array.isArray(record.brands)?record.brands.slice(0,8):[], formats:Object.keys(record.formatVotes||{}).slice(0,8),
    barcodes:Array.isArray(record.barcodes)?record.barcodes.slice(0,5):[], barcode: Array.isArray(record.barcodes)&&record.barcodes[0] ? record.barcodes[0] : '',
    evidenceTokens:Array.isArray(record.evidenceTokens)?record.evidenceTokens.slice(0,18):[],
    allergens:Array.isArray(record.allergens)?record.allergens.slice(0,10):[], ingredients:Array.isArray(record.ingredients)?record.ingredients.slice(0,12):[],
    fieldConfidence:record.fieldConfidence||{}, teacherBypassEligible:!!record.teacherBypassEligible, learningQuality:record.learningQuality||null, knowledgeSources:Array.isArray(record.knowledgeSources)?record.knowledgeSources.slice(0,5):[], conflictRejects:Array.isArray(record.conflictRejects)?record.conflictRejects.slice(0,5):[]
  };
}
function updateGlobalLearningAudit(event={}){
  ensureDbShape();
  const audit=Object.assign({at:Date.now()}, event||{});
  db.assistantBrain.learningAudit.unshift(audit);
  db.assistantBrain.learningAudit=db.assistantBrain.learningAudit.slice(0,500);
  db.assistantBrain.updatedAt=Date.now();
  return audit;
}
function upsertGlobalProductMemory(confirmed={}){
  ensureDbShape();
  const name=String(confirmed.productName||'').trim();
  if(!name) return null;
  const brand=String(confirmed.brand||'').trim();
  const size=String(confirmed.size||confirmed.format||confirmed.estimatedSize||'').trim();
  const barcode=bestBarcodeFromConfirmed(confirmed);
  const canonicalKey=productCanonicalKey(name, brand);
  const key=barcode ? `ean:${barcode}` : productMemoryGlobalKey(name, brand, size);
  const gpm=db.assistantBrain.globalProductMemory;
  gpm.products = gpm.products || {};
  let old=gpm.products[key];
  let upgradedFromNoBarcode=null;
  if(!old && barcode){ old=Object.values(gpm.products).find(p=>Array.isArray(p.barcodes)&&p.barcodes.includes(barcode)); }
  if(!old && barcode){
    const upgrade=findExistingProductForBarcodeUpgrade(gpm, confirmed, barcode);
    if(upgrade?.record){ old=upgrade.record; upgradedFromNoBarcode={oldKey:old.key||'', score:upgrade.score}; migrateGlobalProductKey(gpm, old, key); }
  }
  if(!old){
    // V27.89/V28.02: se esiste già la stessa identità prodotto, unisci solo se non ci sono conflitti reali di marca/categoria/token.
    const sameCanonical=Object.values(gpm.products).find(p=>p.canonicalKey===canonicalKey && canonicalKey && canonicalKey.length>3);
    if(sameCanonical){
      const conflict=productIdentityConflict(sameCanonical, confirmed);
      const sim=productTextSimilarityScore(sameCanonical, confirmed);
      if(!conflict.conflict && ((!size || productSizeCompatible(sameCanonical.format,size)) || sim>=0.62 || (sameCanonical.aliases||[]).some(a=>normalizeText(a)===normalizeText(name)))) old=sameCanonical;
      else {
        sameCanonical.conflictRejects=sameCanonical.conflictRejects||[];
        sameCanonical.conflictRejects.unshift({at:Date.now(), reason:conflict.reason||'low_similarity', similarity:sim, incoming:{productName:name,brand,size,category:confirmed.category||''}});
        sameCanonical.conflictRejects=sameCanonical.conflictRejects.slice(0,30);
      }
    }
  }
  old=old||{key, canonicalKey, productName:name, brand, format:size, category:'', categoryFamily:'', confirmations:0, teacherHelp:0, localRecognitions:0, sources:{}, firstSeenAt:Date.now(), updatedAt:0, confidence:0, allergens:[], ingredients:[], colors:[], aliases:[], brands:[], barcodes:[], households:{}, formatVotes:{}, categoryVotes:{}, unitVotes:{}, evidenceTokens:[], objectFolder:{version:'V28.43_object_folder', photos:[], visualSignatures:[]}};
  if(barcode && old.key && old.key!==key && !String(old.key).startsWith('ean:')){ upgradedFromNoBarcode=upgradedFromNoBarcode||{oldKey:old.key, score:productTextSimilarityScore(old, confirmed)}; migrateGlobalProductKey(gpm, old, key); }
  old.key=old.key||key; old.canonicalKey=old.canonicalKey||canonicalKey;
  if(upgradedFromNoBarcode){ old.barcodeUpgrade=Object.assign({}, old.barcodeUpgrade||{}, {lastAt:Date.now(), oldKey:upgradedFromNoBarcode.oldKey, score:upgradedFromNoBarcode.score, barcode}); }
  old.barcodes=Array.isArray(old.barcodes)?old.barcodes:[]; if(barcode && !old.barcodes.includes(barcode)) old.barcodes.unshift(barcode); old.barcodes=old.barcodes.slice(0,12);
  old.aliases=[...new Set([...(old.aliases||[]), name].filter(Boolean))].slice(0,25);
  old.brands=[...new Set([...(old.brands||[]), brand].filter(Boolean))].slice(0,20);
  old.productName=voteMapTop(voteMapAdd(old.nameVotes||{}, name)) || name || old.productName; old.nameVotes=voteMapAdd(old.nameVotes||{}, name);
  old.brand=voteMapTop(voteMapAdd(old.brandVotes||{}, brand)) || brand || old.brand || '';
  old.formatVotes=voteMapAdd(old.formatVotes||{}, size); old.format=voteMapTop(old.formatVotes)||size||old.format||'';
  old.categoryVotes=voteMapAdd(old.categoryVotes||{}, confirmed.category || confirmed.productMemory?.category || ''); old.category=voteMapTop(old.categoryVotes)||old.category||''; old.categoryFamily=productCategoryFamily(old.category);
  old.unitVotes=voteMapAdd(old.unitVotes||{}, confirmed.unit||''); old.unit=voteMapTop(old.unitVotes)||old.unit||'';
  // V27.89: conserva esempi confermati minimali per audit/apprendimento senza salvare foto pesanti.
  old.confirmedExamples=Array.isArray(old.confirmedExamples)?old.confirmedExamples:[];
  old.confirmedExamples.unshift({at:Date.now(), productName:name, brand, size, category:confirmed.category||'', unit:confirmed.unit||'', source:confirmed.cloudVision?'openai_teacher':(confirmed.memoryVision||confirmed.localFirst?'server_memory':'user_confirmed'), confidence:confirmed.confidence||null, householdHash:confirmed.householdId?hashStable(String(confirmed.householdId)).slice(0,12):''});
  old.confirmedExamples=old.confirmedExamples.slice(0,40);
  old.confirmations=Number(old.confirmations||0)+1;
  old.teacherHelp=Number(old.teacherHelp||0)+(confirmed.cloudVision?1:0);
  old.localRecognitions=Number(old.localRecognitions||0)+(confirmed.autonomousVision||confirmed.memoryVision||confirmed.localFirst?1:0);
  old.households=old.households||{}; if(confirmed.householdId) old.households[String(confirmed.householdId)]={count:Number(old.households[String(confirmed.householdId)]?.count||0)+1,lastAt:Date.now()};
  old.sources=old.sources||{};
  old.sources.userConfirmations=Number(old.sources.userConfirmations||0)+1;
  if(barcode) old.sources.barcode=Number(old.sources.barcode||0)+1;
  recordUserCorrectionLearning(confirmed);
  try{ const monster=reinforceMonsterLearningServerV96(confirmed); old.monsterQualityV96=monster.monsterQualityV96||null; old.fieldConfidence=Object.assign({}, old.fieldConfidence||{}, monster.fieldConfidence||{}); old.physicalState=monster.physicalState||old.physicalState; old.packageHintsV96=monster.packageHintsV96||old.packageHintsV96||[]; old.materialHintsV96=monster.materialHintsV96||old.materialHintsV96||[]; }catch(_){ }
  if(confirmed.cloudVision) old.sources.openAiTeacher=Number(old.sources.openAiTeacher||0)+1;
  if(confirmed.autonomousVision||confirmed.memoryVision||confirmed.localFirst) old.sources.localServer=Number(old.sources.localServer||0)+1;
  if(confirmed.knowledgeFeeder?.enriched){ old.sources.productKnowledgeFeeder=Number(old.sources.productKnowledgeFeeder||0)+1; old.knowledgeSources=Array.isArray(old.knowledgeSources)?old.knowledgeSources:[]; old.knowledgeSources.unshift({at:Date.now(), source:confirmed.knowledgeFeeder.source, sourceLabel:confirmed.knowledgeFeeder.sourceLabel, confidence:confirmed.knowledgeFeeder.confidence, category:confirmed.knowledgeFeeder.category, ingredientsCount:confirmed.knowledgeFeeder.ingredientsCount, allergensCount:confirmed.knowledgeFeeder.allergensCount}); old.knowledgeSources=old.knowledgeSources.slice(0,12); }
  const pm=confirmed.productMemory||{};
  const merged=(arr1=[], arr2=[])=>[...new Set([...(Array.isArray(arr1)?arr1:[]), ...(Array.isArray(arr2)?arr2:[])].map(x=>String(x||'').trim()).filter(Boolean))];
  old.ingredients=merged(old.ingredients, pm.ingredients||confirmed.ingredients||[]).slice(0,60);
  old.allergens=merged(old.allergens, pm.allergens||confirmed.allergens||[]).slice(0,40);
  old.colors=merged(old.colors, pm.visualAppearance?.colors||confirmed.colors||[]).slice(0,24);
  old.visibleEvidence=merged(old.visibleEvidence, confirmed.visibleEvidence||[]).slice(0,35);
  old.detectedText=merged(old.detectedText, confirmed.detectedText||[]).slice(0,35);
  const tokenSource=[name,brand,size,confirmed.category,(confirmed.visibleEvidence||[]).join(' '),(confirmed.detectedText||[]).join(' '),old.ingredients.join(' ')].join(' ');
  old.evidenceTokens=[...new Set([...(old.evidenceTokens||[]), ...productCoreTokens(tokenSource)])].slice(0,60);
  try{ v2842MergeObjectFolder(old, confirmed); v2842ApplyOwnerOverrides(old); }catch(e){ updateGlobalLearningAudit({type:'object-folder-error', key:old.key||key, reason:String(e?.message||e).slice(0,180)}); }
  const c=Number(confirmed.confidence||0);
  if(c>0) old.confidence=Number((((Number(old.confidence||0)*(old.confirmations-1))+c)/old.confirmations).toFixed(3));
  const uniqueHouseholds=Object.keys(old.households||{}).length;
  old.reliability=(old.confirmations>=6 || uniqueHouseholds>=3)?'alta':(old.confirmations>=2 || uniqueHouseholds>=2)?'media':'bassa';
  updateFieldConfidence(old);
  try{ v2842ApplyOwnerOverrides(old); }catch(_){}
  old.learningQuality={
    fieldConfidence:old.fieldConfidence,
    uniqueHouseholds,
    teacherBypassEligible:!!old.teacherBypassEligible,
    enoughForLocalRecognition:!!old.teacherBypassEligible,
    lastSource: confirmed.cloudVision?'openai_teacher':(confirmed.memoryVision||confirmed.localFirst?'server_memory':'user_confirmed')
  };
  try{ v2840AttachMemoryCard(old, confirmed); }catch(_){ }
  old.updatedAt=Date.now();
  gpm.products[old.key||key]=old;
  gpm.confirmations=Number(gpm.confirmations||0)+1;
  if(confirmed.cloudVision) gpm.teacherHelp=Number(gpm.teacherHelp||0)+1;
  if(confirmed.autonomousVision||confirmed.memoryVision||confirmed.localFirst) gpm.localRecognitions=Number(gpm.localRecognitions||0)+1;
  gpm.updatedAt=Date.now();
  updateGlobalLearningAudit({type:'product-confirmed', key:old.key||key, canonicalKey:old.canonicalKey, productName:old.productName, brand:old.brand, format:old.format, category:old.category, barcode:barcode||'', teacherUsed:!!confirmed.cloudVision, memoryUpdated:true, reliability:old.reliability, confirmations:old.confirmations, uniqueHouseholds, userCorrections:Object.keys(confirmed.userCorrections||{}).filter(k=>confirmed.userCorrections[k]?.edited)});
  return compactGlobalProductRecord(old);
}
function publicGlobalProductMemory(limit=20){
  ensureDbShape();
  const g=db.assistantBrain.globalProductMemory||{products:{}};
  const products=Object.values(g.products||{}).sort((a,b)=>Number(b.confirmations||0)-Number(a.confirmations||0)).slice(0,limit).map(compactGlobalProductRecord);
  return {products, count:Object.keys(g.products||{}).length, confirmations:Number(g.confirmations||0), teacherHelp:Number(g.teacherHelp||0), localRecognitions:Number(g.localRecognitions||0), updatedAt:g.updatedAt||0};
}


// V28.40 Server Brain Memory Console
// Scheda memoria completa ispezionabile: ogni articolo confermato diventa una card tecnica nel cervello server.
function v2840CleanString(v='', max=240){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function v2840List(...values){
  const out=[];
  const push=v=>{
    if(v==null) return;
    if(Array.isArray(v)) return v.forEach(push);
    if(typeof v==='object') return;
    String(v).split(/\n|\s*[;,]\s*/).forEach(x=>{ const c=v2840CleanString(x,180); if(c) out.push(c); });
  };
  values.forEach(push);
  return [...new Set(out)].slice(0,90);
}
function v2840SmallObject(obj={}, maxKeys=80){
  if(!obj || typeof obj!=='object' || Array.isArray(obj)) return {};
  const out={};
  for(const [k,v] of Object.entries(obj).slice(0,maxKeys)){
    if(v==null) continue;
    if(Array.isArray(v)) out[k]=v2840List(v).slice(0,30);
    else if(typeof v==='object') out[k]=v2840SmallObject(v,24);
    else out[k]=v2840CleanString(v,260);
  }
  return out;
}
function v2840CategoryEmoji(category=''){
  const fam=productCategoryFamily(category||'');
  if(['drinks'].includes(fam) || /water|drink|juice|soft|milk|coffee/i.test(category)) return '🥤';
  if(['cleaning'].includes(fam) || /clean|laundry|dish|house/i.test(category)) return '🧴';
  if(['personal_care'].includes(fam) || /care|oral|hair|body/i.test(category)) return '🧼';
  if(['pets'].includes(fam) || /pet|animal/i.test(category)) return '🐾';
  if(['aquarium'].includes(fam) || /aquarium/i.test(category)) return '🐠';
  if(/pharmacy/i.test(category)) return '💊';
  if(/frozen|ice/i.test(category)) return '❄️';
  if(/pasta|rice|flour|cereal|bakery/i.test(category)) return '🍝';
  if(/sauce|condiment|oil|vinegar|preserve|spread|honey|jam/i.test(category)) return '🫙';
  if(/chocolate|sweet|snack/i.test(category)) return '🍫';
  return '🛒';
}
function v2840ProfilePhoto(record={}, confirmed={}){
  const representative=v2842BestRepresentativePhoto(record);
  const title=v2840CleanString(record.productName||confirmed.productName||'Prodotto',80);
  if(representative && (representative.dataUrl || representative.externalUrl)){
    return {type:'user_representative_photo', imageUrl:representative.dataUrl||representative.externalUrl, thumbDataUri:representative.thumbDataUrl||representative.dataUrl||representative.externalUrl, photoId:representative.id||'', emoji:v2840CategoryEmoji(record.category||confirmed.category||''), title, brand:v2840CleanString(record.brand||confirmed.brand||'',48), category:v2840CleanString(record.category||confirmed.category||'',50), colors:v2840List(record.colors, confirmed.colors).slice(0,4), note:'Foto profilo reale scelta dal server tra le foto fornite dagli utenti'};
  }
  const brand=v2840CleanString(record.brand||confirmed.brand||'',48);
  const category=v2840CleanString(record.category||confirmed.category||'',50);
  const colors=v2840List(record.colors, confirmed.colors, confirmed.productMemory?.visualAppearance?.colors).slice(0,4);
  const img=v2840CleanString(record.imageUrl||record.productImageUrl||confirmed.imageUrl||confirmed.productMemory?.imageUrl||confirmed.productMemory?.externalKnowledge?.imageUrl||'',600);
  const emoji=v2840CategoryEmoji(category);
  const bgA=colors[0] ? '#eaf4ff' : '#edf7ff';
  const bgB=colors[1] ? '#f0fff7' : '#f4fff8';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient></defs><rect width="320" height="320" rx="46" fill="url(#g)"/><circle cx="160" cy="126" r="70" fill="#ffffff" opacity=".92"/><text x="160" y="154" text-anchor="middle" font-size="78">${emoji}</text><text x="160" y="232" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="800" fill="#12345d">${title.replace(/[&<>]/g,'').slice(0,18)}</text><text x="160" y="262" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#48637f">${brand.replace(/[&<>]/g,'').slice(0,20)}</text></svg>`;
  return {type:img?'external_or_profile_url':'generated_default', imageUrl:img, svgDataUri:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg), emoji, title, brand, category, colors, note:img?'Foto/immagine profilo esterna disponibile':'Foto profilo predefinita generata dal server: leggera, stabile, non salva foto pesanti'};
}


// V28.43 Object Folder + Owner Lock Brain Pro
// Ogni prodotto diventa una cartella mentale server: foto reali, firma visiva, campi bloccabili dal titolare.
function v2842Now(){ return Date.now(); }
function v2842IsDataImage(v=''){ return /^data:image\/(png|jpe?g|webp);base64,/i.test(String(v||'')); }
function v2842ImageBytes(s=''){ return Math.round(String(s||'').length*0.75); }
function v2842SafeImageDataUrl(v='', maxChars=780000){
  const s=String(v||'');
  if(!v2842IsDataImage(s)) return '';
  if(s.length>maxChars) return '';
  return s;
}
function v2842PhotoId(sample={}){
  const raw=[sample.dataUrl?String(sample.dataUrl).slice(0,900)+String(sample.dataUrl).slice(-900):'', sample.externalUrl||'', sample.visualSignature||'', (sample.detectedText||[]).join(' '), (sample.visibleEvidence||[]).join(' ')].join('|');
  return 'ph_'+hashStable(raw).slice(0,18);
}
function v2842PhotoKind(sample={}, confirmed={}){
  const k=normalizeText(sample.kind||sample.stage||confirmed.scanStage||confirmed.stage||confirmed.productMemory?.scanStage||'');
  if(/barcode|ean/.test(k)) return 'barcode';
  if(/expiry|scaden/.test(k)) return 'expiry';
  if(/ingredient|label|etichetta/.test(k)) return 'label';
  return 'product_front';
}
function v2842PhotoScore(sample={}, record={}, confirmed={}){
  let score=0;
  const kind=v2842PhotoKind(sample, confirmed);
  if(kind==='product_front') score+=70;
  if(kind==='label') score+=45;
  if(kind==='barcode') score+=22;
  if(kind==='expiry') score+=12;
  if(sample.dataUrl) score+=20;
  if(sample.externalUrl) score+=12;
  if(sample.visualSignature) score+=18;
  const ev=v2840List(sample.visibleEvidence, confirmed.visibleEvidence, record.visibleEvidence).join(' ');
  const dt=v2840List(sample.detectedText, confirmed.detectedText, record.detectedText).join(' ');
  if(normalizeText(ev+' '+dt).includes(normalizeText(record.brand||confirmed.brand||'')) && (record.brand||confirmed.brand)) score+=12;
  if(normalizeText(ev+' '+dt).includes(normalizeText(record.productName||confirmed.productName||'')) && (record.productName||confirmed.productName)) score+=14;
  const colors=v2840List(sample.colors, confirmed.colors, record.colors);
  if(colors.length) score+=Math.min(10, colors.length*2);
  return score;
}
function v2842VisualSignature(record={}, confirmed={}, sample={}){
  const parts=[
    record.productName, record.brand, record.format, record.category,
    confirmed.productName, confirmed.brand, confirmed.size, confirmed.category,
    sample.visualSignature, confirmed.visualSignature, record.visualSignature,
    ...(v2840List(record.colors, confirmed.colors, sample.colors).slice(0,12)),
    ...(v2840List(record.evidenceTokens, record.visibleEvidence, confirmed.visibleEvidence, record.detectedText, confirmed.detectedText, sample.visibleEvidence, sample.detectedText).slice(0,34))
  ];
  const tokens=productCoreTokens(parts.join(' ')).slice(0,18);
  const hash=hashStable(parts.join('|')).slice(0,18);
  return `sig:${hash}:${tokens.join('|')}`.slice(0,220);
}
function v2842PhotoSamplesFromConfirmed(confirmed={}){
  const pm=confirmed.productMemory||{};
  const raw=[];
  const push=(x,kind='product_front')=>{
    if(!x) return;
    if(Array.isArray(x)) return x.forEach(v=>push(v,kind));
    if(typeof x==='string') raw.push({kind, dataUrl:x});
    else if(typeof x==='object') raw.push(Object.assign({kind},x));
  };
  push(confirmed.photoSamples);
  push(pm.photoSamples);
  push(pm.objectFolder?.photos);
  push(confirmed.dataUrl||confirmed.imageData||confirmed.fullPhoto,'product_front');
  push(pm.dataUrl||pm.representativeDataUrl||pm.fullPhoto,'product_front');
  push(confirmed.labelDataUrl||pm.labelDataUrl,'label');
  push(confirmed.expiryDataUrl||pm.expiryDataUrl,'expiry');
  push(confirmed.barcodeDataUrl||pm.barcodeDataUrl,'barcode');
  if(pm.imageUrl||confirmed.imageUrl) raw.push({kind:'external_profile', externalUrl:String(pm.imageUrl||confirmed.imageUrl)});
  return raw.slice(0,12);
}
function v2842EnsureObjectFolder(record={}){
  record.objectFolder=record.objectFolder||{};
  record.objectFolder.version=record.objectFolder.version||'V28.43_object_folder';
  record.objectFolder.folderId=record.objectFolder.folderId||('obj_'+hashStable(record.key||record.canonicalKey||record.productName||Math.random()).slice(0,18));
  record.objectFolder.createdAt=record.objectFolder.createdAt||v2842Now();
  record.objectFolder.updatedAt=v2842Now();
  record.objectFolder.photos=Array.isArray(record.objectFolder.photos)?record.objectFolder.photos:[];
  record.objectFolder.visualSignatures=Array.isArray(record.objectFolder.visualSignatures)?record.objectFolder.visualSignatures:[];
  record.objectFolder.notes=Array.isArray(record.objectFolder.notes)?record.objectFolder.notes:[];
  return record.objectFolder;
}
function v2842MergeObjectFolder(record={}, confirmed={}){
  const folder=v2842EnsureObjectFolder(record);
  const samples=v2842PhotoSamplesFromConfirmed(confirmed);
  for(const src of samples){
    const dataUrl=v2842SafeImageDataUrl(src.dataUrl||src.thumbDataUrl||'', 780000);
    const externalUrl=v2840CleanString(src.externalUrl||src.imageUrl||'',900);
    if(!dataUrl && !externalUrl) continue;
    const sample={
      id:'', at:v2842Now(), kind:v2842PhotoKind(src, confirmed),
      dataUrl, thumbDataUrl:v2842SafeImageDataUrl(src.thumbDataUrl||dataUrl, 780000), externalUrl,
      bytes:dataUrl?v2842ImageBytes(dataUrl):0,
      visualSignature:v2840CleanString(src.visualSignature||confirmed.visualSignature||record.visualSignature||'',220),
      colors:v2840List(src.colors, confirmed.colors, record.colors).slice(0,18),
      visibleEvidence:v2840List(src.visibleEvidence, confirmed.visibleEvidence).slice(0,18),
      detectedText:v2840List(src.detectedText, confirmed.detectedText).slice(0,18),
      source:v2840CleanString(src.source||'user_confirmed_scan',80)
    };
    sample.id=v2842PhotoId(sample);
    sample.score=v2842PhotoScore(sample, record, confirmed);
    const exists=folder.photos.find(p=>p.id===sample.id || (sample.dataUrl && p.dataUrl===sample.dataUrl));
    if(exists){ exists.lastSeenAt=v2842Now(); exists.score=Math.max(Number(exists.score||0), sample.score); continue; }
    folder.photos.unshift(sample);
  }
  folder.photos.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  folder.photos=folder.photos.slice(0,26);
  const sig=v2842VisualSignature(record, confirmed, folder.photos[0]||{});
  if(sig){
    record.visualSignature=sig;
    if(!folder.visualSignatures.find(x=>x.signature===sig)) folder.visualSignatures.unshift({signature:sig, at:v2842Now(), source:'server_visual_signature_v2842'});
    folder.visualSignatures=folder.visualSignatures.slice(0,18);
  }
  const manualRep=folder.representativePhotoId && folder.photos.find(p=>p.id===folder.representativePhotoId);
  const best=manualRep || folder.photos.find(p=>p.kind==='product_front' && (p.dataUrl||p.externalUrl)) || folder.photos.find(p=>p.dataUrl||p.externalUrl);
  if(best){ folder.representativePhotoId=best.id; folder.representativePhoto=Object.assign({}, best); }
  folder.photoCount=folder.photos.length;
  folder.hasRealProfilePhoto=!!(folder.representativePhoto?.dataUrl || folder.representativePhoto?.externalUrl);
  return folder;
}
function v2842BestRepresentativePhoto(record={}){
  const f=record.objectFolder||{};
  if(f.representativePhoto && (f.representativePhoto.dataUrl||f.representativePhoto.externalUrl)) return f.representativePhoto;
  const photos=Array.isArray(f.photos)?f.photos:[];
  return photos.find(p=>p.id===f.representativePhotoId && (p.dataUrl||p.externalUrl)) || photos.find(p=>p.kind==='product_front' && (p.dataUrl||p.externalUrl)) || photos.find(p=>p.dataUrl||p.externalUrl) || null;
}
function v2842PublicObjectFolder(record={}){
  const f=record.objectFolder||{};
  const photos=(Array.isArray(f.photos)?f.photos:[]).slice(0,26).map(p=>({id:p.id, at:p.at||0, kind:p.kind||'', dataUrl:p.dataUrl||'', thumbDataUrl:p.thumbDataUrl||p.dataUrl||'', externalUrl:p.externalUrl||'', score:p.score||0, bytes:p.bytes||0, visualSignature:p.visualSignature||'', colors:p.colors||[], visibleEvidence:p.visibleEvidence||[], detectedText:p.detectedText||[], source:p.source||''}));
  return {version:f.version||'', folderId:f.folderId||'', updatedAt:f.updatedAt||0, photoCount:photos.length, representativePhotoId:f.representativePhotoId||'', representativePhoto:f.representativePhoto||null, photos, visualSignatures:(f.visualSignatures||[]).slice(0,18), hasRealProfilePhoto:!!f.hasRealProfilePhoto};
}
function v2842CleanOverrideValue(k,v){
  if(v==null) return null;
  if(['ingredients','allergens','possibleTraces','colors','labels'].includes(k)) return v2840List(v).slice(0,90);
  if(k==='nutrition') return v2840SmallObject(v,80);
  return v2840CleanString(v, k==='visualSignature'?260:160);
}
function v2842ApplyOwnerOverrides(record={}){
  const oo=record.ownerOverrides||{};
  if(!oo.enabled || !oo.fields) return record;
  const f=oo.fields||{};
  const has=(k)=>Object.prototype.hasOwnProperty.call(f,k);
  const apply=(k,target=k)=>{ if(has(k)) record[target]=f[k]; };
  apply('productName'); apply('brand'); apply('format'); apply('category'); apply('unit');
  if(has('barcode')){
    record.barcodes=Array.isArray(record.barcodes)?record.barcodes:[];
    const b=String(f.barcode||'').trim();
    if(b){ record.barcodes=[b, ...record.barcodes.filter(x=>String(x)!==b)].slice(0,12); }
    else { record.barcodes=[]; record.barcode=''; }
  }
  if(has('ingredients')) record.ingredients=Array.isArray(f.ingredients)?f.ingredients.slice(0,90):[];
  if(has('allergens')) record.allergens=Array.isArray(f.allergens)?f.allergens.slice(0,80):[];
  if(has('possibleTraces')) record.possibleTraces=Array.isArray(f.possibleTraces)?f.possibleTraces.slice(0,80):[];
  if(has('colors')) record.colors=Array.isArray(f.colors)?f.colors.slice(0,40):[];
  if(has('labels')) record.labels=Array.isArray(f.labels)?f.labels.slice(0,60):[];
  if(has('nutrition')) record.nutrition=(f.nutrition && typeof f.nutrition==='object')?f.nutrition:{};
  if(has('visualSignature')) record.visualSignature=String(f.visualSignature||'');
  if(has('packaging')) record.packaging=String(f.packaging||'');
  if(has('packageType')) record.packageType=String(f.packageType||'');
  if(has('productType')) record.productType=String(f.productType||'');
  record.categoryFamily=productCategoryFamily(record.category||'');
  record.lockedByOwner=true;
  record.reliability='alta';
  record.learningQuality=Object.assign({}, record.learningQuality||{}, {ownerLocked:true, ownerPriority:'server_owner_override > user_confirmation > barcode > label > memory > teacher', clearableFields:true});
  record.sources=Object.assign({}, record.sources||{}, {ownerOverride:Number(record.sources?.ownerOverride||0)+1});
  return record;
}
function v2842UpdateOwnerOverride(key='', updates={}, actor=''){
  ensureDbShape();
  const g=db.assistantBrain.globalProductMemory||{products:{}};
  const record=g.products[key];
  if(!record) return {ok:false,error:'product_not_found'};
  if(updates && updates.clearOwnerLock){
    record.ownerOverrides={enabled:false, version:'V28.43_owner_locked_values', fields:{}, lockedFields:[], clearedAt:v2842Now(), updatedBy:actor||'server_owner'};
    record.lockedByOwner=false;
    record.learningQuality=Object.assign({}, record.learningQuality||{}, {ownerLocked:false, ownerPriority:'disabled_by_owner'});
    v2840AttachMemoryCard(record,{});
    record.updatedAt=v2842Now(); g.updatedAt=v2842Now();
    updateGlobalLearningAudit({type:'owner-override-cleared', key:record.key||key, productName:record.productName||'', brand:record.brand||'', actor});
    return {ok:true, product:v2840PublicProductBrainDetail(record)};
  }
  const allowed=['productName','brand','format','category','unit','barcode','ingredients','allergens','possibleTraces','colors','labels','nutrition','visualSignature','packaging','packageType','productType'];
  const fields={};
  for(const k of allowed){
    if(Object.prototype.hasOwnProperty.call(updates,k)){
      const v=v2842CleanOverrideValue(k,updates[k]);
      if(v==null) continue;
      if(k==='productName' && !String(v||'').trim()) continue;
      fields[k]=v;
    }
  }
  const prev=record.ownerOverrides||{};
  const before=Object.assign({}, prev.fields||{});
  record.ownerOverrides={enabled:true, version:'V28.43_owner_locked_values', fields:Object.assign({}, prev.fields||{}, fields), lockedFields:[...new Set([...(prev.lockedFields||[]), ...Object.keys(fields)])], updatedAt:v2842Now(), updatedBy:actor||'server_owner'};
  if(updates.representativePhotoId){ const f=v2842EnsureObjectFolder(record); if(f.photos.find(p=>p.id===updates.representativePhotoId)){ f.representativePhotoId=updates.representativePhotoId; f.representativePhoto=f.photos.find(p=>p.id===updates.representativePhotoId); record.ownerOverrides.representativePhotoId=updates.representativePhotoId; } }
  record.ownerOverrideHistory=Array.isArray(record.ownerOverrideHistory)?record.ownerOverrideHistory:[];
  record.ownerOverrideHistory.unshift({at:v2842Now(), actor:actor||'server_owner', fields:Object.keys(fields), representativePhotoId:updates.representativePhotoId||'', before:v2840SmallObject(before,30), after:v2840SmallObject(record.ownerOverrides.fields,30)});
  record.ownerOverrideHistory=record.ownerOverrideHistory.slice(0,30);
  v2842ApplyOwnerOverrides(record);
  v2840AttachMemoryCard(record,{});
  record.updatedAt=v2842Now(); g.updatedAt=v2842Now();
  updateGlobalLearningAudit({type:'owner-override-updated', key:record.key||key, productName:record.productName||'', brand:record.brand||'', lockedFields:record.ownerOverrides.lockedFields, actor, fieldCount:Object.keys(fields).length, photoChanged:!!updates.representativePhotoId});
  return {ok:true, product:v2840PublicProductBrainDetail(record)};
}

function v2840Completion(card={}){
  const fields={
    productName:!!card.identity?.productName,
    brand:!!card.identity?.brand,
    format:!!card.identity?.format,
    category:!!card.classification?.category,
    unit:!!card.quantity?.unit,
    barcode:(card.barcodes||[]).length>0,
    ingredients:(card.ingredients||[]).length>0,
    allergens:(card.allergens||[]).length>0,
    traces:(card.possibleTraces||[]).length>0,
    nutrition:card.nutrition && Object.keys(card.nutrition||{}).length>0,
    colors:(card.visualAppearance?.colors||[]).length>0,
    visualSignature:!!card.visualAppearance?.visualSignature,
    photoSamples:Number(card.objectFolder?.photoCount||0)>0,
    profilePhoto:!!card.profilePhoto,
    evidence:(card.visibleEvidence||[]).length>0 || (card.detectedText||[]).length>0
  };
  const total=Object.keys(fields).length;
  const filled=Object.entries(fields).filter(([,v])=>!!v).map(([k])=>k);
  const missing=Object.entries(fields).filter(([,v])=>!v).map(([k])=>k);
  return {score:Number((filled.length/total).toFixed(2)), percent:Math.round((filled.length/total)*100), filled, missing, fields};
}
function v2840BuildMemoryCard(record={}, confirmed={}){
  const pm=confirmed.productMemory||record.productMemory||{};
  const barcode=bestBarcodeFromConfirmed(confirmed)||((record.barcodes||[])[0]||'');
  const possibleTraces=v2840List(record.possibleTraces, record.traces, pm.possibleTraces, pm.traces, pm.possibleAllergens, confirmed.possibleTraces, confirmed.traces, confirmed.possibleAllergens, confirmed.possibleAllergens);
  const nutrition=v2840SmallObject(record.nutrition&&Object.keys(record.nutrition||{}).length?record.nutrition:(pm.nutrition||confirmed.nutrition||{}));
  const labels=v2840List(record.labels, pm.labels, confirmed.labels);
  const packaging=v2840CleanString(record.packaging||pm.packaging||pm.packageType||confirmed.packageType||confirmed.productType||'',120);
  const visualAppearance={
    colors:v2840List(record.colors, pm.visualAppearance?.colors, pm.colors, confirmed.colors).slice(0,24),
    packageType:v2840CleanString(record.packageType||pm.packageType||confirmed.packageType||'',80),
    productType:v2840CleanString(record.productType||pm.productType||confirmed.productType||'',80),
    physicalState:v2840CleanString(record.physicalState||confirmed.physicalState||'',80),
    visualSignature:v2840CleanString(record.visualSignature||confirmed.visualSignature||pm.visualSignature||'',140),
    packageHints:v2840List(record.packageHintsV96, confirmed.packageHintsV96, pm.packageHints).slice(0,16),
    materialHints:v2840List(record.materialHintsV96, confirmed.materialHintsV96, pm.materialHints).slice(0,16)
  };
  const card={
    version:'V28.43_object_folder_owner_locked_card',
    key:record.key||'',
    canonicalKey:record.canonicalKey||'',
    identity:{
      productName:v2840CleanString(record.productName||confirmed.productName||pm.productName||'',140),
      brand:v2840CleanString(record.brand||confirmed.brand||pm.brand||'',90),
      format:v2840CleanString(record.format||record.size||confirmed.size||pm.format||'',90),
      aliases:v2840List(record.aliases, pm.aliases).slice(0,25),
      brands:v2840List(record.brands, pm.brands).slice(0,20)
    },
    classification:{category:v2840CleanString(record.category||confirmed.category||pm.category||'',70), categoryFamily:productCategoryFamily(record.category||confirmed.category||pm.category||'')},
    quantity:{unit:v2840CleanString(record.unit||confirmed.unit||'',30), formatVotes:v2840SmallObject(record.formatVotes||{}), unitVotes:v2840SmallObject(record.unitVotes||{})},
    barcodes:v2840List(record.barcodes, barcode).slice(0,16),
    barcode:barcode||'',
    ingredients:v2840List(record.ingredients, pm.ingredients, confirmed.ingredients).slice(0,80),
    allergens:v2840List(record.allergens, pm.allergens, confirmed.allergens).slice(0,60),
    possibleTraces:possibleTraces.slice(0,60),
    nutrition,
    nutriscore:v2840CleanString(record.nutriscore||pm.externalKnowledge?.nutriscore||'',16),
    novaGroup:record.novaGroup||pm.externalKnowledge?.novaGroup||null,
    packaging,
    labels,
    visualAppearance,
    profilePhoto:v2840ProfilePhoto(record, confirmed),
    objectFolder:v2842PublicObjectFolder(record),
    ownerOverrides:record.ownerOverrides||null,
    visibleEvidence:v2840List(record.visibleEvidence, confirmed.visibleEvidence).slice(0,40),
    detectedText:v2840List(record.detectedText, confirmed.detectedText).slice(0,40),
    evidenceTokens:v2840List(record.evidenceTokens).slice(0,70),
    sources:v2840SmallObject(record.sources||{}),
    knowledgeSources:Array.isArray(record.knowledgeSources)?record.knowledgeSources.slice(0,18):[],
    fieldConfidence:v2840SmallObject(record.fieldConfidence||confirmed.fieldConfidence||{}),
    learningQuality:record.learningQuality||null,
    reliability:record.reliability||'bassa',
    confirmations:Number(record.confirmations||0),
    teacherHelp:Number(record.teacherHelp||0),
    localRecognitions:Number(record.localRecognitions||0),
    uniqueHouseholds:Object.keys(record.households||{}).length,
    userCorrectionSummary:v2840List((record.confirmedExamples||[]).flatMap(x=>x.userCorrections||[])).slice(0,20),
    confirmedExamples:Array.isArray(record.confirmedExamples)?record.confirmedExamples.slice(0,12):[],
    conflictRejects:Array.isArray(record.conflictRejects)?record.conflictRejects.slice(0,12):[],
    timestamps:{firstSeenAt:record.firstSeenAt||0, updatedAt:record.updatedAt||0, serverGeneratedAt:Date.now()}
  };
  card.completeness=v2840Completion(card);
  card.filledFields=card.completeness.filled;
  card.missingFields=card.completeness.missing;
  return card;
}
function v2840AttachMemoryCard(record={}, confirmed={}){
  try{
    const card=v2840BuildMemoryCard(record, confirmed);
    record.memoryCard=card;
    record.profilePhoto=card.profilePhoto;
    record.completeness=card.completeness;
    record.possibleTraces=v2840List(record.possibleTraces, card.possibleTraces).slice(0,60);
    record.nutrition=Object.assign({}, record.nutrition||{}, card.nutrition||{});
    record.labels=v2840List(record.labels, card.labels).slice(0,40);
    record.packaging=record.packaging||card.packaging||'';
    record.visualAppearance=Object.assign({}, record.visualAppearance||{}, card.visualAppearance||{});
    return card;
  }catch(e){
    updateGlobalLearningAudit({type:'server-brain-card-error', reason:String(e?.message||e).slice(0,180), productName:record.productName||confirmed.productName||'', brand:record.brand||confirmed.brand||''});
    return null;
  }
}
function v2840PublicProductBrainDetail(record={}){
  const card=record.memoryCard||v2840BuildMemoryCard(record,{});
  return {
    key:record.key||card.key||'',
    title:card.identity.productName||record.productName||'Prodotto',
    brand:card.identity.brand||record.brand||'',
    category:card.classification.category||record.category||'',
    format:card.identity.format||record.format||'',
    barcode:card.barcode||'',
    reliability:card.reliability||record.reliability||'bassa',
    confirmations:card.confirmations||record.confirmations||0,
    completeness:card.completeness||v2840Completion(card),
    profilePhoto:card.profilePhoto,
    fields:card,
    rawCompact:compactGlobalProductRecord(record)
  };
}
function publicServerBrainV2840({limit=200, q='', includeRaw=false}={}){
  ensureDbShape();
  const g=db.assistantBrain.globalProductMemory||{products:{}};
  const query=normalizeText(q||'');
  let products=Object.values(g.products||{}).map(r=>{ try{ v2842EnsureObjectFolder(r); v2842ApplyOwnerOverrides(r); v2840AttachMemoryCard(r,{}); }catch(_){ if(!r.memoryCard) v2840AttachMemoryCard(r,{}); } return r; });
  if(query){
    products=products.filter(p=>normalizeText([p.productName,p.brand,p.format,p.category,(p.barcodes||[]).join(' '),(p.evidenceTokens||[]).join(' ')].join(' ')).includes(query));
  }
  products=products.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)).slice(0,Math.max(1,Math.min(Number(limit)||200,1000))).map(v2840PublicProductBrainDetail);
  const errors=[...(db.assistantBrain.learningAudit||[]).filter(e=>/error|failed|reject|sync/i.test(String(e.type||e.reason||''))).slice(0,120), ...((db.assistantBrain.errorLearning?.corrections||[]).slice(0,80).map(e=>Object.assign({type:'user-correction'},e)))].slice(0,180);
  return {
    ok:true,
    version:'V28.43 Object Folder + Owner Lock Brain Pro',
    dbMode,
    databaseConnected:dbMode!=='file',
    generatedAt:Date.now(),
    stats:{count:Object.keys(g.products||{}).length, shown:products.length, confirmations:Number(g.confirmations||0), teacherHelp:Number(g.teacherHelp||0), localRecognitions:Number(g.localRecognitions||0), updatedAt:g.updatedAt||0},
    products,
    errors,
    recentAudit:(db.assistantBrain.learningAudit||[]).slice(0,80),
    knowledgeCache:{entries:Object.keys(db.assistantBrain?.knowledgeCache?.entries||{}).length,hits:db.assistantBrain?.knowledgeCache?.hits||0,barcodeHits:db.assistantBrain?.knowledgeCache?.barcodeHits||0,updatedAt:db.assistantBrain?.knowledgeCache?.updatedAt||0},
    barcodeBrain:db.assistantBrain?.barcodeBrain||null,
    errorLearning:{corrections:(db.assistantBrain?.errorLearning?.corrections||[]).length,patterns:Object.keys(db.assistantBrain?.errorLearning?.patterns||{}).length,updatedAt:db.assistantBrain?.errorLearning?.updatedAt||0}
  };
}
function matchGlobalProductMemory(query={}){
  const qName=normalizeText(query.productName||'');
  const qBrand=normalizeText(query.brand||'');
  const qCategory=String(query.category||'');
  const needle=normalizeText([query.productName,query.brand,query.size,query.category,query.detectedText].filter(Boolean).join(' '));
  if(!needle || needle.length<3) return null;
  const qTokens=new Set(productCoreTokens(needle));
  const products=Object.values(db.assistantBrain?.globalProductMemory?.products||{});
  let best=null;
  for(const p of products){
    const confirmations=Number(p.confirmations||0);
    const uniqueHouseholds=Object.keys(p.households||{}).length;
    if(confirmations<2 && uniqueHouseholds<2 && p.reliability!=='media' && p.reliability!=='alta') continue;
    const pName=normalizeText(p.productName||'');
    const pBrand=normalizeText(p.brand||'');
    const hayTokens=new Set(productCoreTokens(p.productName,p.brand,p.format,p.category,(p.evidenceTokens||[]).join(' '),(p.visibleEvidence||[]).join(' '),(p.detectedText||[]).join(' ')));
    let overlap=0; for(const t of qTokens){ if(hayTokens.has(t)) overlap++; }
    const brandMatch=!!(qBrand && pBrand && (pBrand.includes(qBrand)||qBrand.includes(pBrand)));
    const nameMatch=!!(qName && pName && (pName.includes(qName)||qName.includes(pName)));
    const categoryCompatible=!qCategory || !p.category || productCategoryFamily(qCategory)===productCategoryFamily(p.category);
    const strongQuery=productStrongTokens(query.productName,query.brand,query.detectedText);
    const strongProduct=productStrongTokens(p.productName,p.brand,(p.evidenceTokens||[]).join(' '));
    const strongOverlap=strongQuery.filter(t=>strongProduct.includes(t));
    const strongJaccard=tokenJaccard(strongQuery,strongProduct);
    if(qBrand && pBrand && brandLooksConflicting(qBrand,pBrand)) continue;
    if(!categoryCompatible && !brandMatch && strongJaccard<0.42) continue;
    let score=overlap + strongOverlap.length*1.7;
    if(brandMatch) score+=5;
    if(nameMatch) score+=6;
    if(categoryCompatible) score+=1.2; else score-=4;
    if(p.reliability==='alta') score+=1.5; else if(p.reliability==='media') score+=.8;
    if(p.teacherBypassEligible) score+=.8;
    // V27.89: il server suggerisce senza docente solo con identità forte o apprendimento maturo.
    const hasStrongIdentity=brandMatch || nameMatch || strongOverlap.length>=2 || strongJaccard>=0.42;
    if(!hasStrongIdentity) continue;
    if(!brandMatch && !nameMatch && !(strongOverlap.length>=2 && categoryCompatible)) continue;
    const normScore=score/Math.max(3, qTokens.size||1);
    const threshold=p.teacherBypassEligible ? 1.02 : 1.18;
    if(normScore>=threshold && (!best || normScore>best.score)) best={score:normScore, product:Object.assign(compactGlobalProductRecord(p), {matchReason:brandMatch?'brand_match':nameMatch?'name_match':'strong_tokens', matchedTokens:strongOverlap.slice(0,10), strongJaccard:Number(strongJaccard.toFixed(3))})};
  }
  return best;
}


// V27.93 Product Knowledge Feeder: arricchisce i prodotti confermati con fonti aperte.
// Regola: non sovrascrive i campi confermati dall'utente; aggiunge solo cultura interna
// (ingredienti, allergeni, nutrizione, fonte, categoria se generica).
const KNOWLEDGE_FEEDER_ENABLED = String(process.env.KNOWLEDGE_FEEDER_ENABLED || 'true').toLowerCase() !== 'false';
const KNOWLEDGE_FEEDER_TIMEOUT_MS = Number(process.env.KNOWLEDGE_FEEDER_TIMEOUT_MS || 3600);
const OPEN_FACTS_USER_AGENT = process.env.OPEN_FACTS_USER_AGENT || 'SpesaPronta/27.97 UltraErrorReductionCore (server-learning; contact: admin@spesapronta.local)';
const GENERIC_APP_CATEGORIES = new Set(['', 'food', 'drinks', 'house', 'pets', 'personal_care']);
function categoryIsFoodLike(cat=''){
  const c=String(cat||'');
  return !c || ['food','drinks','water','soft_drinks','juice','sports_energy_drinks','milk_drinks','coffee_tea','yogurt','dairy','eggs','pasta_rice','flour_baking','bakery','breakfast_cereals','breakfast_snacks','chocolate_sweets','spreads','jams_honey','sauces_condiments','oil_vinegar','spices_broths','preserves_jars','canned_fish_meat','legumes_canned','frozen','ice_cream','ready_meals','meat_deli','fish','fruit','veg','baby_food','diet_special'].includes(c);
}
function openFactsSourceForCategory(cat=''){
  const c=String(cat||'');
  if(c==='pet_food' || c==='pets') return {id:'open_pet_food_facts', label:'Open Pet Food Facts', base:'https://world.openpetfoodfacts.org'};
  if(c==='personal_care' || c==='hair_body' || c==='oral_care') return {id:'open_beauty_facts', label:'Open Beauty Facts', base:'https://world.openbeautyfacts.org'};
  if(c==='house' || c==='cleaning' || c==='laundry' || c==='dishwashing' || c==='paper_house' || c==='aquarium') return {id:'open_products_facts', label:'Open Products Facts', base:'https://world.openproductsfacts.org'};
  return {id:'open_food_facts', label:'Open Food Facts', base:'https://world.openfoodfacts.org'};
}
function knowledgeArray(v, limit=30){
  if(Array.isArray(v)) return v.map(x=>cleanVisionString(x)).filter(Boolean).slice(0,limit);
  return String(v||'').split(/[;,\n·]+/).map(x=>cleanVisionString(x)).filter(Boolean).slice(0,limit);
}
function cleanOpenTag(tag=''){
  return String(tag||'').replace(/^[a-z]{2}:/,'').replace(/-/g,' ').trim();
}
function buildProductKnowledgeQuery(confirmed={}){
  const parts=[confirmed.brand, confirmed.productName, confirmed.size || confirmed.format, confirmed.category]
    .map(x=>String(x||'').trim()).filter(Boolean);
  const compact=[confirmed.brand, confirmed.productName].map(x=>String(x||'').trim()).filter(Boolean).join(' ');
  return (compact || parts.join(' ')).replace(/\b(da confermare|non rilevato|prodotto|articolo)\b/ig,'').trim().slice(0,120);
}
function productKnowledgeFields(){
  return ['code','product_name','product_name_it','generic_name','generic_name_it','brands','quantity','categories','categories_tags','ingredients_text','ingredients_text_it','allergens','allergens_tags','traces','traces_tags','nutriments','nutriscore_grade','nova_group','image_url','image_front_url','packaging','packaging_tags','labels','labels_tags'].join(',');
}
async function fetchOpenFactsSearch(source, query){
  if(!query || query.length<3) return null;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), KNOWLEDGE_FEEDER_TIMEOUT_MS);
  try{
    const url=`${source.base}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5&fields=${encodeURIComponent(productKnowledgeFields())}`;
    const r=await fetch(url,{headers:{'User-Agent':OPEN_FACTS_USER_AGENT,'Accept':'application/json'},signal:ctrl.signal});
    if(!r.ok) return null;
    return await r.json().catch(()=>null);
  }catch(_){ return null; }
  finally{ clearTimeout(timer); }
}
function mapOpenFactsCategory(product={}, fallback='food'){
  const text=[product.product_name_it,product.product_name,product.generic_name_it,product.generic_name,product.brands,product.categories,(product.categories_tags||[]).map(cleanOpenTag).join(' ')].filter(Boolean).join(' ');
  const inferred=scoreRealityCategoryServer(text, fallback||'food');
  return inferred.category || fallback || 'food';
}
function scoreOpenFactsProduct(product={}, confirmed={}, source={}){
  const qName=productStrongTokens(confirmed.productName||'');
  const qBrand=productStrongTokens(confirmed.brand||'');
  const pName=productStrongTokens(product.product_name_it||product.product_name||product.generic_name_it||product.generic_name||'');
  const pBrand=productStrongTokens(product.brands||'');
  const nameOverlap=tokenJaccard(qName,pName);
  const brandOverlap=tokenJaccard(qBrand,pBrand);
  let score=0;
  if(nameOverlap) score += nameOverlap*6;
  if(brandOverlap) score += brandOverlap*5;
  if(qBrand.length && !brandOverlap && pBrand.length) score -= 2.5;
  if(product.ingredients_text_it || product.ingredients_text) score += 1;
  if(product.quantity) score += .5;
  if(product.categories || product.categories_tags?.length) score += .5;
  if(source.id==='open_food_facts' && categoryIsFoodLike(confirmed.category||'')) score += .6;
  return score;
}
function mergeKnowledgeLists(arr1=[], arr2=[]){
  return [...new Set([...(Array.isArray(arr1)?arr1:[]), ...(Array.isArray(arr2)?arr2:[])].map(x=>String(x||'').trim()).filter(Boolean))];
}
function normalizeNutrition(nutriments={}){
  if(!nutriments || typeof nutriments!=='object') return {};
  const pick={};
  for(const k of ['energy-kcal_100g','energy_100g','fat_100g','saturated-fat_100g','carbohydrates_100g','sugars_100g','fiber_100g','proteins_100g','salt_100g','sodium_100g']){
    if(nutriments[k]!==undefined && nutriments[k]!==null && String(nutriments[k])!=='') pick[k]=nutriments[k];
  }
  return pick;
}
function mapOpenFactsProduct(product={}, confirmed={}, source={}){
  const productName=cleanVisionString(product.product_name_it||product.product_name||product.generic_name_it||product.generic_name||'');
  const brand=cleanVisionString(String(product.brands||'').split(',')[0]||'');
  const quantity=cleanVisionString(product.quantity||'');
  const ingredientsText=cleanVisionString(product.ingredients_text_it||product.ingredients_text||'', '');
  const ingredients=ingredientsText ? knowledgeArray(ingredientsText, 60) : [];
  const allergens=[...knowledgeArray(product.allergens_tags||[],30).map(cleanOpenTag), ...knowledgeArray(product.allergens||[],30).map(cleanOpenTag)].filter(Boolean);
  const traces=[...knowledgeArray(product.traces_tags||[],30).map(cleanOpenTag), ...knowledgeArray(product.traces||[],30).map(cleanOpenTag)].filter(Boolean);
  const labels=knowledgeArray(product.labels_tags||[],20).map(cleanOpenTag);
  const category=mapOpenFactsCategory(product, confirmed.category||'food');
  const score=scoreOpenFactsProduct(product, confirmed, source);
  return {
    source: source.id,
    sourceLabel: source.label,
    code: cleanVisionString(product.code||''),
    productName,
    brand,
    quantity,
    category,
    ingredients,
    ingredientsText,
    allergens:[...new Set(allergens)].slice(0,40),
    traces:[...new Set(traces)].slice(0,40),
    nutrition: normalizeNutrition(product.nutriments||{}),
    labels,
    nutriscore: cleanVisionString(product.nutriscore_grade||''),
    novaGroup: product.nova_group||null,
    imageUrl: cleanVisionString(product.image_front_url||product.image_url||''),
    confidence: Number(Math.max(0, Math.min(0.96, score/10)).toFixed(2)),
    matchScore:Number(score.toFixed(3)),
    fetchedAt:Date.now()
  };
}
function mergeExternalKnowledgeIntoConfirmed(confirmed={}, knowledge=null){
  if(!knowledge || !knowledge.productName) return confirmed;
  const out=Object.assign({}, confirmed);
  const pm=Object.assign({}, out.productMemory||{});
  pm.productName = pm.productName || out.productName || knowledge.productName;
  pm.brand = pm.brand || out.brand || knowledge.brand || '';
  pm.format = pm.format || out.size || knowledge.quantity || '';
  if(GENERIC_APP_CATEGORIES.has(String(out.category||'')) && knowledge.category) out.category=knowledge.category;
  if(!out.size && knowledge.quantity) out.size=knowledge.quantity;
  if(!out.brand && knowledge.brand) out.brand=knowledge.brand;
  pm.category = out.category || pm.category || knowledge.category || '';
  pm.ingredients = mergeKnowledgeLists(pm.ingredients||[], knowledge.ingredients||[]).slice(0,80);
  pm.allergens = mergeKnowledgeLists(pm.allergens||[], [...(knowledge.allergens||[]), ...(knowledge.traces||[]).map(x=>'tracce: '+x)]).slice(0,60);
  pm.nutrition = Object.assign({}, pm.nutrition||{}, knowledge.nutrition||{});
  pm.source = mergeKnowledgeLists(pm.source||[], [knowledge.sourceLabel||knowledge.source, 'conferma utente']).slice(0,12);
  pm.externalKnowledge = Object.assign({}, pm.externalKnowledge||{}, {source:knowledge.source, sourceLabel:knowledge.sourceLabel, code:knowledge.code, confidence:knowledge.confidence, nutriscore:knowledge.nutriscore, novaGroup:knowledge.novaGroup, fetchedAt:knowledge.fetchedAt, license:'Open Facts family / open product data'});
  pm.needsWebVerification = false;
  out.productMemory=pm;
  out.knowledgeFeeder={enriched:true, source:knowledge.source, sourceLabel:knowledge.sourceLabel, confidence:knowledge.confidence, category:knowledge.category, ingredientsCount:(knowledge.ingredients||[]).length, allergensCount:(knowledge.allergens||[]).length+(knowledge.traces||[]).length, code:knowledge.code||''};
  out.visibleEvidence=mergeKnowledgeLists(out.visibleEvidence||[], [`${knowledge.sourceLabel}: ${knowledge.productName}${knowledge.brand?' - '+knowledge.brand:''}`]).slice(0,20);
  return out;
}
async function enrichConfirmedProductWithKnowledge(confirmed={}){
  ensureDbShape();
  const stats=db.assistantBrain.knowledgeFeeder=db.assistantBrain.knowledgeFeeder||{lookups:0,enriched:0,misses:0,errors:0,updatedAt:0,lastSources:[]};
  const source=openFactsSourceForCategory(confirmed.category||confirmed.productMemory?.category||'food');
  const query=buildProductKnowledgeQuery(confirmed);
  const barcode=bestBarcodeFromConfirmed(confirmed);
  if(!KNOWLEDGE_FEEDER_ENABLED || (!query && !barcode) || (source.id==='open_food_facts' && !categoryIsFoodLike(confirmed.category||''))) return {confirmed, knowledge:null, skipped:true, reason:'not_eligible_or_disabled'};
  const cacheKey=knowledgeCacheKey(source, confirmed, query);
  const cached=getKnowledgeCache(cacheKey);
  if(cached){
    if(cached.knowledge){
      const merged=mergeExternalKnowledgeIntoConfirmed(confirmed, cached.knowledge);
      merged.knowledgeFeeder=Object.assign({}, merged.knowledgeFeeder||{}, {cacheHit:true, barcode:barcode||'', source:cached.knowledge.source, sourceLabel:cached.knowledge.sourceLabel});
      return {confirmed:merged, knowledge:cached.knowledge, skipped:false, cacheHit:true};
    }
    return {confirmed:Object.assign({}, confirmed, {knowledgeFeeder:{enriched:false, source:source.id, query, barcode, reason:cached.reason||'cached_miss', cacheHit:true}}), knowledge:null, skipped:false, cacheHit:true};
  }
  stats.lookups=Number(stats.lookups||0)+1;
  stats.updatedAt=Date.now();
  try{
    let best=null;
    if(barcode){
      const p=await fetchOpenFactsByBarcode(source, barcode);
      if(p) best=Object.assign(mapOpenFactsProduct(Object.assign({},p,{code:p.code||barcode}), confirmed, source), {matchScore:9.5, confidence:'barcode', barcodeVerified:true});
    }
    if(!best){
      const data=await fetchOpenFactsSearch(source, query);
      const products=Array.isArray(data?.products)?data.products:[];
      for(const p of products){
        const k=mapOpenFactsProduct(p, confirmed, source);
        if(!k.productName && !k.brand) continue;
        if(!best || k.matchScore>best.matchScore) best=k;
      }
    }
    if(!best || best.matchScore<1.35){ stats.misses=Number(stats.misses||0)+1; setKnowledgeCache(cacheKey,{knowledge:null, reason:'no_reliable_match', query, barcode}); return {confirmed:Object.assign({}, confirmed, {knowledgeFeeder:{enriched:false, source:source.id, query, barcode, reason:'no_reliable_match'}}), knowledge:null, skipped:false}; }
    const mergedConfirmed=mergeExternalKnowledgeIntoConfirmed(Object.assign({}, confirmed, {barcode:barcode||confirmed.barcode||best.code||''}), best);
    stats.enriched=Number(stats.enriched||0)+1;
    stats.lastSources=Array.isArray(stats.lastSources)?stats.lastSources:[];
    stats.lastSources.unshift({at:Date.now(), source:best.source, query, barcode:barcode||best.code||'', productName:best.productName, brand:best.brand, category:best.category, confidence:best.confidence, cacheKey});
    stats.lastSources=stats.lastSources.slice(0,20);
    setKnowledgeCache(cacheKey,{knowledge:best, query, barcode:barcode||best.code||''});
    return {confirmed:mergedConfirmed, knowledge:best, skipped:false};
  }catch(err){ stats.errors=Number(stats.errors||0)+1; setKnowledgeCache(cacheKey,{knowledge:null, reason:'lookup_error', query, barcode, error:String(err?.message||err).slice(0,120)}); return {confirmed:Object.assign({}, confirmed, {knowledgeFeeder:{enriched:false, source:source.id, query, barcode, reason:'lookup_error'}}), knowledge:null, skipped:false, error:String(err?.message||err).slice(0,120)}; }
}

function publicGlobalBrain(){
  ensureDbShape();
  const brain=db.assistantBrain;
  const topProducts=Object.values(brain.productLearnings||{}).sort((a,b)=>b.count-a.count).slice(0,20).map(p=>({name:p.name, category:p.category, count:p.count, avgConfidence:p.count?Number((p.confidenceSum/p.count).toFixed(2)):null}));
  const topPhrases=Object.entries(brain.phrasePatterns||{}).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([phrase,count])=>({phrase,count}));
  return {version:brain.version||1, updatedAt:brain.updatedAt||0, topProducts, topPhrases, dailyStats:brain.dailyStats||{}, globalProductMemory:publicGlobalProductMemory(20), recentLearningAudit:(brain.learningAudit||[]).slice(0,30)};
}

async function learnAutonomyOnServer(h, payload={}){
  ensureDbShape();
  const mem=ensureHouseholdMemory(h);
  mem.visionBrain = mem.visionBrain || {version:41,serverSamples:[],productModels:{},productStats:{},serverSyncs:0};
  mem.voiceProfile = mem.voiceProfile || {version:41,heard:[],corrections:[],intentPhrases:{},fieldPhrases:{},productAliases:{},speakerStyle:{},serverSyncs:0};
  let confirmed=payload.confirmed||{};
  try{ confirmed=reinforceMonsterLearningServerV96(confirmed); payload.confirmed=confirmed; }catch(_){ }
  let knowledgeFeederResult=null;
  if(confirmed.productName){
    knowledgeFeederResult=await enrichConfirmedProductWithKnowledge(confirmed);
    confirmed=knowledgeFeederResult.confirmed||confirmed;
    payload.confirmed=confirmed;
    payload.learningAudit=Object.assign({}, payload.learningAudit||{}, {knowledgeFeeder:confirmed.knowledgeFeeder||knowledgeFeederResult.knowledge||null});
    const key=normalizeText([confirmed.productName,confirmed.brand,confirmed.size].filter(Boolean).join(' ')).slice(0,120);
    mem.visionBrain.serverSamples = Array.isArray(mem.visionBrain.serverSamples) ? mem.visionBrain.serverSamples : [];
    mem.visionBrain.serverSamples.unshift({
      key, productName:confirmed.productName, brand:confirmed.brand||'', size:confirmed.size||'', category:confirmed.category||'', unit:confirmed.unit||'', expiryDate:confirmed.expiryDate||'', damageNote:confirmed.damageNote||'', productMemory:confirmed.productMemory||null, confidence:confirmed.confidence||null, visualFeatures:confirmed.visualFeatures||null, visibleEvidence:(confirmed.visibleEvidence||[]).slice(0,10), detectedText:(confirmed.detectedText||[]).slice(0,10), cloudVision:!!confirmed.cloudVision, autonomousVision:!!confirmed.autonomousVision, at:Date.now()
    });
    if(confirmed.productMemory && confirmed.productMemory.productName){
      mem.productDeepMemory = Array.isArray(mem.productDeepMemory) ? mem.productDeepMemory : [];
      mem.productMemoryIndex = mem.productMemoryIndex || {};
      const pm=Object.assign({}, confirmed.productMemory, {serverSavedAt:Date.now()});
      const pmKey=pm.key || key;
      const oldIdx=mem.productDeepMemory.findIndex(x=>x.key===pmKey);
      if(oldIdx>=0) mem.productDeepMemory[oldIdx]=Object.assign({}, mem.productDeepMemory[oldIdx], pm); else mem.productDeepMemory.unshift(pm);
      mem.productDeepMemory=mem.productDeepMemory.slice(0,1200);
      mem.productMemoryIndex[pmKey]={productName:pm.productName,brand:pm.brand||'',format:pm.format||confirmed.size||'',category:pm.category||confirmed.category||'',allergens:pm.allergens||[],updatedAt:Date.now(),needsWebVerification:!!pm.needsWebVerification};
    }
    mem.visionBrain.serverSamples=mem.visionBrain.serverSamples.slice(0,900);
    const prod=db.assistantBrain.autonomousVision.products[key]||{key,productName:confirmed.productName,brand:confirmed.brand||'',sizes:{},categories:{},units:{},count:0,lastSeenAt:0};
    prod.count++; prod.lastSeenAt=Date.now();
    if(confirmed.size) prod.sizes[confirmed.size]=Number(prod.sizes[confirmed.size]||0)+1;
    if(confirmed.category) prod.categories[confirmed.category]=Number(prod.categories[confirmed.category]||0)+1;
    if(confirmed.unit) prod.units[confirmed.unit]=Number(prod.units[confirmed.unit]||0)+1;
    db.assistantBrain.autonomousVision.products[key]=prod;
    db.assistantBrain.autonomousVision.samples=Number(db.assistantBrain.autonomousVision.samples||0)+1;
    try{ confirmed=reinforceMonsterLearningServerV96(confirmed); payload.confirmed=confirmed; }catch(_){ }
    const globalProduct=upsertGlobalProductMemory(Object.assign({}, confirmed, {householdId:h.id, memoryVision:confirmed.memoryVision||confirmed.autonomousVision||false, localFirst:confirmed.localFirst||false}));
    payload.learningAudit=Object.assign({}, payload.learningAudit||{}, {teacherUsed:!!confirmed.cloudVision, memoryUpdated:!!globalProduct, recognizedByLocalOrServer:!!(confirmed.autonomousVision||confirmed.memoryVision||confirmed.localFirst), globalProduct});
  }
  const vp=payload.voiceProfile||{};
  if(Array.isArray(vp.heard)){
    const old=Array.isArray(mem.voiceProfile.heard)?mem.voiceProfile.heard:[];
    mem.voiceProfile.heard=[...vp.heard.slice(0,80),...old].slice(0,300);
  }
  if(Array.isArray(vp.corrections)){
    const old=Array.isArray(mem.voiceProfile.corrections)?mem.voiceProfile.corrections:[];
    mem.voiceProfile.corrections=[...vp.corrections.slice(0,80),...old].slice(0,300);
    db.assistantBrain.autonomousVision.corrections=Number(db.assistantBrain.autonomousVision.corrections||0)+vp.corrections.length;
  }
  for(const [k,v] of Object.entries(vp.intentPhrases||{})){ db.assistantBrain.autonomousVision.voice[k]=Number(db.assistantBrain.autonomousVision.voice[k]||0)+Number(v||1); }
  mem.visionBrain.serverSyncs=Number(mem.visionBrain.serverSyncs||0)+1; mem.visionBrain.serverLastSyncAt=Date.now();
  mem.voiceProfile.serverSyncs=Number(mem.voiceProfile.serverSyncs||0)+1; mem.updatedAt=Date.now(); h.updatedAt=Date.now(); db.assistantBrain.updatedAt=Date.now();
  return mem;
}
function autonomyStatusFor(h){
  const mem=ensureHouseholdMemory(h);
  const vb=mem.visionBrain||{}; const vp=mem.voiceProfile||{};
  const localProducts=new Set((vb.serverSamples||[]).map(x=>normalizeText(x.productName||'')).filter(Boolean));
  return {visionSamples:(vb.serverSamples||[]).length, products:localProducts.size, serverSyncs:Number(vb.serverSyncs||0), voiceHeard:(vp.heard||[]).length, voiceCorrections:(vp.corrections||[]).length, globalSamples:Number(db.assistantBrain?.autonomousVision?.samples||0)};
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
function serveFileDirect(req,res,fileName){
  if(req.method !== 'GET' && req.method !== 'HEAD') return false;
  const candidates=[path.join(STATIC_DIR,fileName), path.join(process.cwd(),fileName), path.join(process.cwd(),'public',fileName)];
  const file=candidates.find(f=>fs.existsSync(f) && fs.statSync(f).isFile());
  if(!file) return false;
  try{
    const data=fs.readFileSync(file);
    res.writeHead(200,{
      'Content-Type':contentType(file),
      'Content-Length':data.length,
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma':'no-cache',
      'Expires':'0',
      'X-Robots-Tag':'noindex, nofollow, noarchive'
    });
    if(req.method === 'HEAD') return res.end();
    res.end(data);
    return true;
  }catch{ return false; }
}
function serveStatic(req,res,url){
  if(req.method !== 'GET' && req.method !== 'HEAD') return false;
  if(url.pathname.startsWith('/api/')) return false;
  let pathname = decodeURIComponent(url.pathname);
  if(pathname === '/debug' || pathname === '/debug/') return serveFileDirect(req,res,'debug.html');
  if(pathname === '/debug.html') return serveFileDirect(req,res,'debug.html');
  if(pathname === '/clear-cache' || pathname === '/clear-cache/') return serveFileDirect(req,res,'clear-cache.html');
  if(pathname === '/') pathname = '/index.html';
  const target = path.normalize(path.join(STATIC_DIR, pathname));
  if(!target.startsWith(STATIC_DIR)) return false;
  let file = target;
  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if(!fs.existsSync(file)){
    const looksLikeAsset = /\.[a-zA-Z0-9]+$/.test(pathname) && !pathname.endsWith('.html');
    if(looksLikeAsset){
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      if(req.method === 'HEAD') return res.end();
      res.end('Not found');
      return true;
    }
    file = path.join(STATIC_DIR, 'index.html');
  }
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
function aiConnected(){ return Boolean(getOpenAiKeyV2836()); }
async function openAiResponse(payload, opts={}){
  // V28.39 max_output_tokens minimum guard: Responses API refuses values below 16.
  try{ if(payload && Object.prototype.hasOwnProperty.call(payload,'max_output_tokens')) payload.max_output_tokens=Math.max(16, Number(payload.max_output_tokens||16)); }catch(_){}
  const key=getOpenAiKeyV2836();
  if(!key) throw new Error('missing_openai_api_key');
  const candidates=openAiModelCandidatesV2836(payload?.model || (opts.kind==='vision'?OPENAI_VISION_MODEL:OPENAI_MODEL));
  let lastErr=null;
  for(const model of candidates){
    const ctrl = new AbortController();
    const timeout = setTimeout(()=>ctrl.abort(), OPENAI_TIMEOUT_MS);
    try{
      const body=JSON.stringify(Object.assign({}, payload, {model}));
      const res=await fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
        body,
        signal:ctrl.signal
      });
      if(!res.ok){
        const errText=await res.text().catch(()=>'');
        const err=new Error('openai_error_'+res.status+'_'+errText.slice(0,700));
        if(isRetryableOpenAiModelErrorV2836(res.status, errText) && candidates.length>1){
          lastErr=err;
          continue;
        }
        throw err;
      }
      const json=await res.json();
      const diag=openAiKeyDiagnosticV2836();
      lastOpenAiRuntimeV2836={ok:true,testedAt:Date.now(),model,status:'active',message:'OpenAI raggiunto correttamente',source:diag.source,maskedKey:diag.maskedKey};
      return json;
    }catch(err){
      lastErr=err;
      const c=classifyOpenAiErrorV2836(err);
      if(c.code==='openai_model_unavailable' && candidates.length>1) continue;
      if(c.code==='openai_network_timeout' && opts.kind==='health') throw err;
      if(c.code!=='openai_model_unavailable') throw err;
    } finally { clearTimeout(timeout); }
  }
  if(lastErr) throw lastErr;
  throw new Error('openai_no_model_candidate');
}
function outputText(resp){
  if(!resp) return '';
  if(resp.output_text) return resp.output_text;
  const chunks=[];
  for(const out of resp.output||[]) for(const c of out.content||[]) if(c.text) chunks.push(c.text);
  return chunks.join('\n').trim();
}
async function llmChatReply({message,state,settings,memory,globalMemory={}}){
  if(!getOpenAiKeyV2836()) return localAiReply({message,state,settings,memory});
  const compactState=(state||[]).map(i=>({id:i.id,name:itemName(i,settings?.lang||'it'),qty:i.qty,unit:i.unit,category:i.category,threshold:smartThreshold(i,settings,memory),recommended:recommendedQty(i,settings,memory),daysLeft:daysLeft(i,settings,memory)}));
  const payload={
    model:OPENAI_MODEL,
    input:[
      {role:'system',content:'Sei Spesa Pronta AI, un assistente domestico vocale e testuale stile ChatGPT. Rispondi in italiano, con tono caldo e pratico. Usa la memoria personale solo per aiutare quell’utente. Usa la memoria globale solo come esperienza anonima aggregata, senza nominare altri utenti e senza inventare dati privati. Puoi ragionare sui consumi, suggerire acquisti, spiegare foto, correggere quantità e preparare azioni sulla lista. Se non hai certezza, chiedi conferma.'},
      {role:'user',content:JSON.stringify({message,state:compactState,settings,memory:(memory||{}),globalAssistantExperience:globalMemory||{}}).slice(0,90000)}
    ]
  };
  try{
    const resp=await openAiResponse(payload,{kind:'chat'});
    return outputText(resp) || localAiReply({message,state,settings,memory});
  }catch(err){
    const c=classifyOpenAiErrorV2836(err);
    const diag=openAiKeyDiagnosticV2836();
    lastOpenAiRuntimeV2836={ok:false,testedAt:Date.now(),model:lastOpenAiRuntimeV2836.model||OPENAI_MODEL,status:c.code,message:c.message,source:diag.source,maskedKey:diag.maskedKey,raw:String(err?.message||err||'').slice(0,500)};
    return localAiReply({message,state,settings,memory});
  }
}
function extractJsonObject(text=''){
  const raw=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  try{ return JSON.parse(raw); }catch(_){ }
  const start=raw.indexOf('{'), end=raw.lastIndexOf('}');
  if(start>=0 && end>start){
    try{ return JSON.parse(raw.slice(start,end+1)); }catch(_){ }
  }
  return null;
}
function cleanVisionString(value, fallback=''){
  return String(value||fallback||'').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,80);
}
function cleanVisionArray(value, limit=12){
  if(Array.isArray(value)) return value.map(x=>cleanVisionString(x)).filter(Boolean).slice(0,limit);
  return String(value||'').split(/[;,\n·]+/).map(x=>cleanVisionString(x)).filter(Boolean).slice(0,limit);
}

function summarizeLearnedProducts(memory){
  const list=Array.isArray(memory?.learnedProducts) ? memory.learnedProducts : [];
  return list.slice(0,80).map(x=>({
    productName: cleanVisionString(x.productName||''),
    brand: cleanVisionString(x.brand||''),
    variant: cleanVisionString(x.variant||''),
    category: cleanVisionString(x.category||''),
    unit: cleanVisionString(x.unit||''),
    productType: cleanVisionString(x.productType||''),
    packageType: cleanVisionString(x.packageType||''),
    estimatedSize: cleanVisionString(x.estimatedSize||''),
    isLiquid: !!x.isLiquid,
    seenCount: Number(x.seenCount||0),
    aliases: Array.isArray(x.aliases)?x.aliases.map(a=>cleanVisionString(a)).filter(Boolean).slice(0,6):[],
    visualHints: Array.isArray(x.visualHints)?x.visualHints.map(a=>cleanVisionString(a)).filter(Boolean).slice(0,6):[],
    ingredients: cleanVisionArray(x.ingredients||[], 8),
    allergens: cleanVisionArray(x.allergens||[], 8),
    colors: cleanVisionArray(x.colors||[], 6)
  })).filter(x=>x.productName);
}

function normalizeVisionText(v=''){ return String(v||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function uniqueStrings(list=[], limit=10){ return [...new Set((list||[]).map(x=>cleanVisionString(x)).filter(Boolean))].slice(0,limit); }

const REAL_ALLOWED_CATEGORIES=new Set(['food','drinks','water','soft_drinks','juice','sports_energy_drinks','milk_drinks','coffee_tea','yogurt','dairy','eggs','pasta_rice','flour_baking','bakery','breakfast_cereals','breakfast_snacks','chocolate_sweets','spreads','jams_honey','sauces_condiments','oil_vinegar','spices_broths','preserves_jars','canned_fish_meat','legumes_canned','frozen','ice_cream','ready_meals','meat_deli','fish','fruit','veg','baby_food','diet_special','house','laundry','dishwashing','cleaning','paper_house','personal_care','oral_care','hair_body','pharmacy','pets','pet_food','aquarium','non_consumable']);
const REAL_DRINK_CATEGORIES=new Set(['drinks','water','soft_drinks','juice','sports_energy_drinks','milk_drinks','coffee_tea']);

function categoryEvidenceServer(result={}){
  return [result.productName,result.brand,result.variant,result.productType,result.packageType,result.category,result.estimatedSize,result.sizeDetectedRaw,result.unit,...(result.detectedText||[]),...(result.visibleEvidence||[])].filter(Boolean).join(' ');
}

const CATEGORY_PRIORITY_ORDER=['non_consumable','pharmacy','aquarium','pet_food','pets','cleaning','laundry','dishwashing','paper_house','oral_care','hair_body','personal_care','soft_drinks','sports_energy_drinks','water','juice','milk_drinks','coffee_tea','yogurt','sauces_condiments','oil_vinegar','spreads','jams_honey','chocolate_sweets','dairy','eggs','canned_fish_meat','legumes_canned','preserves_jars','pasta_rice','flour_baking','bakery','breakfast_cereals','breakfast_snacks','frozen','ice_cream','ready_meals','meat_deli','fish','fruit','veg','baby_food','diet_special','food','drinks','house'];
const CATEGORY_PHYSICAL_STATE_SERVER={water:'liquid_drink',soft_drinks:'liquid_drink',juice:'liquid_drink',sports_energy_drinks:'liquid_drink',milk_drinks:'liquid_drink',coffee_tea:'liquid_drink',drinks:'liquid_drink',yogurt:'creamy_food',sauces_condiments:'creamy_or_liquid_food',oil_vinegar:'liquid_food',spreads:'creamy_food',jams_honey:'creamy_food',dairy:'fresh_solid_or_creamy',eggs:'fragile_solid',pasta_rice:'dry_solid',flour_baking:'powder_or_mix',bakery:'dry_solid',breakfast_cereals:'dry_solid',breakfast_snacks:'dry_solid',chocolate_sweets:'solid_sweet',spices_broths:'powder_or_cube',preserves_jars:'preserved_food',canned_fish_meat:'preserved_protein',legumes_canned:'preserved_vegetal',frozen:'frozen',ice_cream:'frozen_sweet',ready_meals:'ready_meal',meat_deli:'fresh_protein',fish:'fresh_protein',fruit:'fresh_produce',veg:'fresh_produce',baby_food:'baby_food',diet_special:'special_food',laundry:'home_chemical',dishwashing:'home_chemical',cleaning:'home_chemical',paper_house:'paper',personal_care:'personal_care',oral_care:'personal_care',hair_body:'personal_care',pharmacy:'pharmacy',pet_food:'pet_food',pets:'pet_supply',aquarium:'aquarium',non_consumable:'not_consumable',food:'food',house:'house'};
function categoryPhysicalStateServer(cat=''){ return CATEGORY_PHYSICAL_STATE_SERVER[cat] || (REAL_DRINK_CATEGORIES.has(cat)?'liquid_drink':(REAL_ALLOWED_CATEGORIES.has(cat)?'food':'generic')); }
function scoreRealityCategoryServer(text='', fallback='food'){
  const n=normalizeVisionText(text||'');
  const scores={}; const evidence=[];
  const add=(cat,pts,rx,label)=>{ if(rx.test(n)){ scores[cat]=(scores[cat]||0)+pts; evidence.push(label||cat); } };
  if(!n) return {category:fallback||'food', score:0, evidence:[], physicalState:categoryPhysicalStateServer(fallback||'food')};
  add('non_consumable',30,/\b(cane|gatto vivo|persona|viso|mano|telecomando|tv|televisore|pantaloni|maglia|scarpe|sedia|tavolo|mobile|pavimento|divano|letto|porta|computer|auricolari)\b/,'oggetto non idoneo');
  add('soft_drinks',28,/\b(blues\s*cola|cola\s*blues|coca\s*cola|coca-cola|pepsi|fanta|sprite|cola|aranciata|gassosa|chinotto|tonica|cedrata|bibita\s*gassata|bevanda\s*gassata|soft\s*drink)\b/,'bibita gassata/cola');
  add('juice',32,/\b(t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|estath[eè]|the\s*fusion|th[eè]\s*fusion|t[eè]\s*fusion|bevanda\s+al\s+t[eè]|bevanda\s+al\s+the|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa)|t[eè]\s*(pesca|limone|rosa))\b/,'tè freddo/bevanda al tè');
  add('sports_energy_drinks',24,/\b(red\s*bull|monster|energy\s*drink|powerade|gatorade|integratore\s*salino|sport\s*drink|isotonica)\b/,'energy/sport drink');
  add('water',24,/\b(acqua|minerale|oligominerale|naturale|frizzante|effervescente\s*naturale|levissima|sant\s*anna|san\s*benedetto|vera|lete|ferrarelle|uliveto|rocchetta)\b/,'acqua');
  add('juice',22,/\b(succo|nettare|spremuta|bevanda\s+alla\s+frutta|t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|te\s*freddo|estath[eè]|estate|ice\s*tea|ice\s*the|the\s*fusion|th[eè]\s*fusion|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa))\b/,'succo/tè');
  add('milk_drinks',21,/\b(latte\s+uht|latte\s+intero|latte\s+parzialmente\s+scremato|latte\s+scremato|bevanda\s+al\s+latte|bevanda\s+vegetale|latte\s+di\s+(soia|mandorla|avena|riso))\b/,'latte/bevanda latte');
  add('coffee_tea',20,/\b(caffe|caff[eè]|capsule\s+caffe|cialde|nescafe|orzo|camomilla|tisane|infuso|t[eè]|the|tea|filtro\s+te)\b/,'caffè/tè');
  add('yogurt',26,/\b(yogurt|yoghurt|kefir|skyr|greco|fermenti\s*lattici|ayo\s*kefir)\b/,'yogurt/kefir');
  add('sauces_condiments',28,/\b(pesto|salsa|bbq|barbecue|ketchup|maionese|senape|condimento|sugo|passata|rag[uù]|pat[eè]|hummus|besciamella|glassa|pesto\s+di\s+pistacchi|salsa\s+barbecue)\b/,'salsa/condimento');
  add('oil_vinegar',25,/\b(olio|olio\s+evo|olio\s+extra\s+vergine|extra\s+vergine|aceto|balsamico|vinaigrette)\b/,'olio/aceto');
  add('spreads',24,/\b(nutella|crema\s+spalmabile|crema\s+nocciole|crema\s+al\s+pistacchio|spalmabile|burro\s+d\s*arachidi|peanut\s*butter)\b/,'crema spalmabile');
  add('jams_honey',22,/\b(marmellata|confettura|composta|miele|sciroppo\s+d\s*acero)\b/,'marmellata/miele');
  add('chocolate_sweets',22,/\b(cioccolat|cacao|tavoletta|pralina|caramell|dolce|dolci|cremino|torrone|torta|crostatina|merendina|biscotto\s+farcito|wafer\s+dolce)\b/,'cioccolata/dolci');
  add('dairy',23,/\b(mozzarella|formaggio|parmigiano|grana|ricotta|burro|panna|mascarpone|stracchino|latticini|galbanino|philadelphia|scamorza|provola|pecorino|asiago|gorgonzola)\b/,'latticini/formaggi');
  add('eggs',22,/\b(uova|uovo|confezione\s+uova)\b/,'uova');
  add('pasta_rice',22,/\b(pasta|spaghetti|penne|fusilli|rigatoni|riso|risotto|farro|orzo\s+perlato|cous\s*cous|gnocchi|lasagne|tagliatelle|semola)\b/,'pasta/riso/cereali');
  add('flour_baking',20,/\b(farina|lievito|zucchero|preparato\s+per\s+torta|preparato\s+per\s+pane|fecola|amido|vanillina|pangrattato)\b/,'farine/preparati');
  add('bakery',20,/\b(pane|panino|piadina|cracker|crackers|grissini|taralli|fette\s+biscottate|cornetto|brioche|toast|pan\s+bauletto|forno)\b/,'pane/forno');
  add('breakfast_cereals',20,/\b(cereali|corn\s*flakes|muesli|granola|fiocchi\s+d\s*avena|avena)\b/,'cereali colazione');
  add('breakfast_snacks',18,/\b(biscott|snack|patatine|pop\s*corn|barretta|wafer|chips|salatini|colazione)\b/,'snack/colazione');
  add('spices_broths',20,/\b(sale|pepe|spezie|origano|basilico|paprika|curcuma|cannella|dado|brodo|insaporitore|zafferano)\b/,'spezie/brodi');
  add('canned_fish_meat',23,/\b(tonno|sgombro\s+in\s+scatola|sardine|alici|carne\s+in\s+scatola)\b/,'conserva pesce/carne');
  add('legumes_canned',22,/\b(legumi|fagioli|ceci|lenticchie|piselli|mais|borlotti|cannellini)\b/,'legumi/mais');
  add('preserves_jars',16,/\b(pelati|polpa\s+di\s+pomodoro|conserva|sottolio|sottaceto|olive|capperi|barattolo|vasetto|vetro|lattina\s+alimentare)\b/,'conserve/barattoli');
  add('frozen',24,/\b(surgelat|congelat|pizza\s+surgelata|minestrone\s+surgelato|findus|frozen|bastoncini\s+surgelati)\b/,'surgelato');
  add('ice_cream',24,/\b(gelato|ghiacciolo|sorbetto|cono\s+gelato|vaschetta\s+gelato)\b/,'gelato');
  add('ready_meals',20,/\b(piatto\s+pronto|pronto\s+in\s+padella|insalata\s+pronta|lasagna\s+pronta|zuppa\s+pronta|tramezzino)\b/,'piatto pronto');
  add('meat_deli',22,/\b(prosciutto|salame|mortadella|wurstel|w[üu]rstel|carne|pollo|hamburger|salsiccia|bresaola|speck|tacchino|affettato)\b/,'carne/salumi');
  add('fish',22,/\b(pesce|salmone|merluzzo|gamber|orata|branzino|frutti\s+di\s+mare|seppia|calamari)\b/,'pesce');
  add('fruit',18,/\b(mela|mele|banana|banane|arancia|arance|limone|fragola|uva|pera|frutta|kiwi|pesca|albicocca|ciliegia|ananas|melone)\b/,'frutta');
  add('veg',18,/\b(insalata|lattuga|pomodoro|pomodori|zucchina|zucchine|melanzana|verdura|ortaggi|carota|cipolla|patata|broccoli|spinaci|finocchio|peperone)\b/,'verdura');
  add('baby_food',22,/\b(omogeneizzato|pannolini|latte\s+infanzia|baby\s+food|biberon|salviettine\s+bimbo)\b/,'infanzia');
  add('diet_special',18,/\b(senza\s+glutine|gluten\s*free|proteico|protein|senza\s+lattosio|vegano|vegetariano|bio|integrale)\b/,'speciale/dietetico');
  add('pet_food',24,/\b(crocchette|umido\s+cane|umido\s+gatto|pat[eè]\s+cane|pat[eè]\s+gatto|monge|trainer|royal\s+canin|purina|whiskas|felix|mangime\s+cane|mangime\s+gatto)\b/,'cibo animali');
  add('pets',18,/\b(lettiera|traversine|guinzaglio|collare|antiparassitario|pet\s*food|cane|gatto|animali)\b/,'animali');
  add('laundry',22,/\b(detersivo\s+lavatrice|ammorbidente|bucato|lavatrice|caps\s+lavatrice|perlana|dash)\b/,'bucato');
  add('dishwashing',22,/\b(detersivo\s+piatti|lavastoviglie|brillantante|sale\s+lavastoviglie|caps\s+lavastoviglie|finish|pril|svelto)\b/,'piatti/lavastoviglie');
  add('cleaning',22,/\b(candeggina|sgrassatore|pulizia|pavimenti|vetri|bagno|wc|disinfettante\s+casa|napisan|ace|chanteclair|amuchina\s+superfici)\b/,'pulizia casa');
  add('paper_house',20,/\b(scottex|carta\s+igienica|rotoloni|tovaglioli|fazzoletti|carta\s+casa|sacchetti|alluminio|pellicola)\b/,'carta casa');
  add('oral_care',22,/\b(dentifricio|spazzolino|collutorio|filo\s+interdentale|oral\s+b)\b/,'igiene orale');
  add('hair_body',20,/\b(shampoo|bagnoschiuma|docciaschiuma|sapone|deodorante|crema\s+corpo|gel\s+capelli|balsamo|rasoio|schiuma\s+barba)\b/,'capelli/corpo');
  add('personal_care',18,/\b(igiene|assorbenti|salviettine|cotone|crema\s+viso|detergente\s+intimo)\b/,'igiene persona');
  add('pharmacy',23,/\b(farmaco|medicina|tachipirina|oki|brufen|cerotti|disinfettante|farmacia|integratore|paracetamolo|ibuprofene|termometro|garze)\b/,'farmacia');
  add('aquarium',24,/\b(acquario|pesci|mangime\s+pesci|biocondizionatore|filtro\s+acquario|tetra|sera|askoll|carbone\s+attivo|cannolicchi)\b/,'acquario');
  add('drinks',3,/\b(bevanda|drink|bottiglia|lattina|brick|brik|liquido\s+da\s+bere)\b/,'supporto confezione bevanda');
  add('house',3,/\b(casa|flacone|spray|detergente)\b/,'supporto casa');
  const hasStrong=(cat)=>Number(scores[cat]||0)>=18;
  const drinkCats=['water','soft_drinks','juice','sports_energy_drinks','milk_drinks','coffee_tea','drinks'];
  const foodCats=['yogurt','dairy','eggs','pasta_rice','flour_baking','bakery','breakfast_cereals','breakfast_snacks','chocolate_sweets','spreads','jams_honey','sauces_condiments','oil_vinegar','spices_broths','preserves_jars','canned_fish_meat','legumes_canned','frozen','ice_cream','ready_meals','meat_deli','fish','fruit','veg','baby_food','diet_special'];
  const nonFoodCats=['pharmacy','aquarium','pet_food','pets','laundry','dishwashing','cleaning','paper_house','oral_care','hair_body','personal_care','house','non_consumable'];
  const strongFood=foodCats.some(hasStrong), strongNonFood=nonFoodCats.some(hasStrong), strongDrink=drinkCats.some(c=>c!=='drinks' && hasStrong(c));
  if(hasStrong('juice')){ scores.soft_drinks=Math.min(scores.soft_drinks||0, 2); scores.water=0; scores.drinks=0; }
  if(hasStrong('soft_drinks')){ scores.water=0; scores.drinks=0; }
  if(hasStrong('water') && !hasStrong('soft_drinks')){ scores.soft_drinks=Math.min(scores.soft_drinks||0, 2); }
  if(strongFood || strongNonFood){ scores.drinks=0; if(!strongDrink){ ['water','soft_drinks','juice','milk_drinks','coffee_tea','sports_energy_drinks'].forEach(c=>scores[c]=0); } }
  if(hasStrong('sauces_condiments')){ scores.preserves_jars=(scores.preserves_jars||0)*0.35; scores.spreads=(scores.spreads||0)*0.65; }
  if(hasStrong('oil_vinegar')) scores.sauces_condiments=(scores.sauces_condiments||0)*0.55;
  if(hasStrong('yogurt')){ scores.dairy=(scores.dairy||0)*0.6; scores.milk_drinks=0; }
  if(hasStrong('spreads')) scores.preserves_jars=(scores.preserves_jars||0)*0.45;
  if(hasStrong('jams_honey')){ scores.spreads=(scores.spreads||0)*0.55; scores.preserves_jars=(scores.preserves_jars||0)*0.45; }
  if(hasStrong('canned_fish_meat')) scores.preserves_jars=(scores.preserves_jars||0)*0.6;
  if(hasStrong('legumes_canned')) scores.preserves_jars=(scores.preserves_jars||0)*0.6;
  if(hasStrong('ice_cream')) scores.frozen=(scores.frozen||0)*0.55;
  let best=fallback||'food', bestScore=-1;
  for(const cat of CATEGORY_PRIORITY_ORDER){ const score=Number(scores[cat]||0); if(score>bestScore){ best=cat; bestScore=score; } }
  if(bestScore<4) best=fallback||'food';
  if(best==='drinks' && !strongDrink) best='food';
  if(best==='house' && (scores.laundry||scores.dishwashing||scores.cleaning||scores.paper_house)){
    best=['laundry','dishwashing','cleaning','paper_house'].sort((a,b)=>(scores[b]||0)-(scores[a]||0))[0];
    bestScore=scores[best]||bestScore;
  }
  const solidScore=foodCats.reduce((a,c)=>a+Number(scores[c]||0),0);
  const drinkScore=drinkCats.reduce((a,c)=>a+Number(scores[c]||0),0);
  return {category:best, score:Math.max(0,bestScore), evidence:[...new Set(evidence)].slice(0,8), solidScore, drinkScore, physicalState:categoryPhysicalStateServer(best)};
}


function inferRealityCategoryServer(text='', currentCategory=''){
  return scoreRealityCategoryServer(text,currentCategory||'food').category;
}
function applyRealityCategoryServer(result={}, features=null){
  if(!result) return result;
  const evidence=categoryEvidenceServer(result);
  const resolved=scoreRealityCategoryServer(evidence, result.category||'food');
  const oldCat=result.category||'';
  if(resolved.category) result.category=resolved.category;
  const n=normalizeVisionText(evidence);
  const rawDetectedText=Array.isArray(result.detectedText) ? result.detectedText.join(' ') : '';
  const rawVisibleEvidence=Array.isArray(result.visibleEvidence) ? result.visibleEvidence.join(' ') : '';
  const hasRealTextEvidence=normalizeVisionText([rawDetectedText,rawVisibleEvidence,result.variant,result.productType,result.packageType].filter(Boolean).join(' ')).length>2;
  const genericColaFallback=/\bbibita\s+tipo\s+cola\b/.test(n) && !/\b(blues\s*cola|cola\s*blues|coca\s*cola|coca-cola|pepsi|fanta|sprite|aranciata|chinotto|gassosa|cedrata|bibita\s*gassata|bevanda\s*gassata)\b/.test(n) && !hasRealTextEvidence;
  const teaEvidence=/\b(t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|estath[eè]|the\s*fusion|th[eè]\s*fusion|t[eè]\s*fusion|bevanda\s+al\s+t[eè]|bevanda\s+al\s+the|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa)|t[eè]\s*(pesca|limone|rosa))\b/.test(n);
  const colaEvidence=!genericColaFallback && /\b(blues\s*cola|cola\s*blues|coca\s*cola|coca-cola|pepsi|fanta|sprite|cola|aranciata|bibita\s*gassata|bevanda\s*gassata|chinotto|tonica|cedrata|gassosa)\b/.test(n);
  const waterEvidence=/\b(acqua|minerale|oligominerale|naturale|frizzante|levissima|sant\s*anna|san\s*benedetto|vera|lete|ferrarelle|uliveto|rocchetta)\b/.test(n);
  const foodNotDrink=/\b(pesto|salsa|bbq|barbecue|ketchup|maionese|yogurt|kefir|cioccolat|crema\s+spalmabile|condimento|sugo|pasta|riso|snack|biscott|formaggio|marmellata|confettura|olio|aceto|tonno|legumi|barattolo|vasetto)\b/.test(n);
  if(teaEvidence && !colaEvidence){
    result.category='juice'; result.isLiquid=true; result.physicalState='liquid_drink';
    if(!result.unit || result.unit==='pz' || result.unit==='conf') result.unit='bt';
    if(!result.productName || /^(bibita|bevanda|prodotto|acqua|latte)/i.test(String(result.productName||''))) result.productName='Tè freddo';
    if(/\bblues\b/.test(n) && (!result.brand || /generico/i.test(String(result.brand)))) result.brand='Blues';
    result.categoryGuardNote=(result.categoryGuardNote?result.categoryGuardNote+' · ':'')+'Blocco tè: esclusa cola/gassate perché il testo indica tè/thé/tea.';
  } else if(colaEvidence){
    result.category='soft_drinks'; result.isLiquid=true; result.physicalState='liquid_drink';
    if(!result.unit || result.unit==='pz') result.unit=/\blattina\b/.test(n)?'lattina':'bt';
    if(!result.productName || /acqua|bottiglia|prodotto da identificare/i.test(String(result.productName))) result.productName=/\bblues\s*cola|cola\s*blues\b/.test(n)?'Cola Blues':'Bibita gassata';
    if(/\bblues\s*cola|cola\s*blues\b/.test(n) && (!result.brand || /acqua|generico/i.test(String(result.brand)))) result.brand='Blues';
  } else if(waterEvidence && !foodNotDrink){
    result.category='water'; result.isLiquid=true; result.physicalState='liquid_drink';
    if(!result.unit || result.unit==='pz') result.unit='bt';
  }
  if(foodNotDrink && REAL_DRINK_CATEGORIES.has(result.category) && !colaEvidence && !waterEvidence){
    const recalc=scoreRealityCategoryServer(evidence.replace(/\b(bottiglia|liquido|squeeze|flacone)\b/g,''),'food');
    result.category=REAL_DRINK_CATEGORIES.has(recalc.category)?'food':recalc.category;
  }
  result.isLiquid=REAL_DRINK_CATEGORIES.has(result.category);
  result.physicalState=categoryPhysicalStateServer(result.category);
  if(result.isLiquid){
    if(!result.unit || result.unit==='pz') result.unit = result.category==='soft_drinks' ? (/\blattina\b/.test(n)?'lattina':'bt') : (result.category==='juice' || result.category==='milk_drinks' ? 'conf' : 'bt');
  } else if(result.unit==='bt' && /\b(pesto|salsa|bbq|barbecue|condimento|yogurt|crema|barattolo|vasetto|marmellata|confettura)\b/.test(n)){
    result.unit=/\b(barattolo|vasetto|vetro|pesto|crema|marmellata|confettura)\b/.test(n)?'vasetto':'pz';
  }
  result.categoryFamily=REAL_DRINK_CATEGORIES.has(result.category)?'beverage':(REAL_ALLOWED_CATEGORIES.has(result.category)?'food':result.category);
  result.categoryRuleSource='ontologia categorie realtà v27.92';
  result.categoryRuleEvidence=resolved.evidence||[];
  result.categoryPhysicalStateServer=result.physicalState;
  if(oldCat && oldCat!==result.category) result.categoryGuardNote=`Categoria corretta da ${oldCat} a ${result.category}: ${(resolved.evidence||[]).join(', ')}`;
  result=applyExpertCategoryBrainServerV95(result, resolved);
  return result;
}


// V27.96 Professional Product Category Brain
// Motore categorie con priorità: etichetta attuale > barcode/fonti verificate > categoria fisica > memoria/web/docente.
// La confezione aiuta, ma non decide mai da sola: bottiglia/vasetto/flacone non bastano per scegliere acqua, conserva o detergente.
const CATEGORY_EXPERT_RULES_V95_SERVER=[
  {cat:'non_consumable',pts:80,label:'non idoneo',rx:/\b(cane|gatto\s+vivo|animale\s+vivo|persona|viso|mano|telecomando|tv|televisore|monitor|pantaloni|jeans|maglia|scarpe|sedia|tavolo|mobile|pavimento|divano|letto|porta|computer|auricolari|cuffie|telefono\s+non\s+prodotto)\b/},
  {cat:'soft_drinks',pts:70,label:'cola/bibita gassata',rx:/\b(blues\s*cola|cola\s*blues|cola|coca\s*cola|coca-cola|pepsi|maxi\s*cola|fanta|sprite|7\s*up|aranciata|gassosa|chinotto|tonica|cedrata|limonata\s+gassata|bibita\s+gassata|bevanda\s+gassata|soft\s*drink)\b/,ban:/\b(pesto|salsa|bbq|barbecue|yogurt|kefir|sugo|olio|aceto|detersivo|shampoo)\b/},
  {cat:'water',pts:64,label:'acqua minerale',rx:/\b(acqua\s+(naturale|minerale|frizzante|oligominerale)|minerale|oligominerale|effervescente\s+naturale|levissima|sant\s*anna|san\s*benedetto|vera|lete|ferrarelle|uliveto|rocchetta|fiuggi)\b/,ban:/\b(cola|pepsi|fanta|sprite|aranciata|salsa|pesto|bbq|barbecue|detersivo|shampoo)\b/},
  {cat:'juice',pts:58,label:'succo/tè freddo',rx:/\b(succo|nettare|spremuta|ace\b|bevanda\s+alla\s+frutta|t[eè]\s*freddo|the\s*freddo|tea\s*freddo|ice\s*tea|estath[eè]|santal|yoga\s+succo|skipper)\b/},
  {cat:'sports_energy_drinks',pts:56,label:'energy/sport drink',rx:/\b(red\s*bull|monster|burn\b|energy\s*drink|powerade|gatorade|integratore\s*salino|sport\s*drink|isotonica|bevanda\s+energetica)\b/},
  {cat:'milk_drinks',pts:54,label:'latte da bere/bevanda latte',rx:/\b(latte\s+(uht|intero|parzialmente\s+scremato|scremato|fresco|alta\s+digeribilita)|bevanda\s+(vegetale|al\s+latte)|latte\s+di\s+(soia|mandorla|avena|riso|cocco)|latte\s+senza\s+lattosio)\b/,ban:/\b(yogurt|kefir|skyr|formaggio|ricotta|panna|burro)\b/},
  {cat:'coffee_tea',pts:50,label:'caffè/tè/infusi',rx:/\b(caffe|caff[eè]|capsule\s+caffe|cialde|nescafe|lavazza|kimbo|illy|orzo|camomilla|tisane|infuso|t[eè]|the|tea|filtro\s+t[eè])\b/},
  {cat:'yogurt',pts:66,label:'yogurt/kefir/skyr',rx:/\b(yogurt|yoghurt|kefir|skyr|greco|fermenti\s+lattici|ayo\s*kefir|yomo|muller|activia|danone\s+yogurt)\b/},
  {cat:'dairy',pts:58,label:'latticini/formaggi',rx:/\b(mozzarella|formaggio|parmigiano|grana|ricotta|burro|panna|mascarpone|stracchino|latticini|galbanino|philadelphia|scamorza|provola|pecorino|asiago|gorgonzola|fontina|emmental|caciotta|fiocchi\s+di\s+latte)\b/},
  {cat:'eggs',pts:50,label:'uova',rx:/\b(uova|uovo|confezione\s+uova|ovoprodotto)\b/},
  {cat:'sauces_condiments',pts:74,label:'salsa/condimento',rx:/\b(pesto|pesto\s+di\s+pistacchi?|pistacchio\s+pesto|salsa|salsa\s+bbq|bbq|barbecue|ketchup|maionese|senape|condimento|sugo|passata|rag[uù]|pat[eè]|hummus|besciamella|glassa\s+gastronomica|dressing|tabasco|soia\s+sauce|salsa\s+di\s+soia)\b/,ban:/\b(acqua|cola|pepsi|fanta|sprite|shampoo|detersivo)\b/},
  {cat:'oil_vinegar',pts:66,label:'olio/aceto',rx:/\b(olio\s+(evo|extra\s+vergine|extravergine|di\s+oliva|di\s+semi|di\s+girasole)|extra\s+vergine|aceto|balsamico|vinaigrette)\b/},
  {cat:'spreads',pts:60,label:'crema spalmabile',rx:/\b(nutella|nocciolata|crema\s+(spalmabile|nocciole|al\s+pistacchio|pistacchio|cacao)|spalmabile|burro\s+d\s*arachidi|peanut\s*butter)\b/,ban:/\b(pesto|salsa\s+bbq|ketchup|maionese)\b/},
  {cat:'jams_honey',pts:52,label:'marmellata/miele',rx:/\b(marmellata|confettura|composta|miele|sciroppo\s+d\s*acero)\b/},
  {cat:'chocolate_sweets',pts:56,label:'cioccolata/dolci',rx:/\b(cioccolat|cacao|tavoletta|pralina|caramell|dolce|dolci|cremino|torrone|torta|crostatina|merendina|biscotto\s+farcito|wafer\s+dolce|snack\s+dolce|gelatina\s+dolce)\b/},
  {cat:'pasta_rice',pts:54,label:'pasta/riso/cereali secchi',rx:/\b(pasta|spaghetti|penne|fusilli|rigatoni|riso|risotto|farro|orzo\s+perlato|cous\s*cous|gnocchi|lasagne|tagliatelle|semola|tortiglioni|paccheri)\b/},
  {cat:'flour_baking',pts:48,label:'farine/preparati',rx:/\b(farina|lievito|zucchero|preparato\s+per\s+(torta|pane|pizza)|fecola|amido|vanillina|pangrattato|cacao\s+amaro|budino\s+preparato)\b/},
  {cat:'bakery',pts:48,label:'pane/forno',rx:/\b(pane|panino|piadina|cracker|crackers|grissini|taralli|fette\s+biscottate|cornetto|brioche|toast|pan\s+bauletto|forno)\b/},
  {cat:'breakfast_cereals',pts:45,label:'cereali colazione',rx:/\b(cereali|corn\s*flakes|muesli|granola|fiocchi\s+d\s*avena|avena|cereali\s+colazione)\b/},
  {cat:'breakfast_snacks',pts:42,label:'snack/colazione',rx:/\b(biscott|snack|patatine|pop\s*corn|barretta|wafer|chips|salatini|colazione|crunchy|salato\s+snack)\b/},
  {cat:'spices_broths',pts:44,label:'spezie/brodi',rx:/\b(sale|pepe|spezie|origano|basilico|paprika|curcuma|cannella|dado|brodo|insaporitore|zafferano|aromi\s+per\s+arrosto)\b/},
  {cat:'canned_fish_meat',pts:52,label:'conserva pesce/carne',rx:/\b(tonno|sgombro\s+in\s+scatola|sardine|alici|carne\s+in\s+scatola|simmenthal)\b/},
  {cat:'legumes_canned',pts:48,label:'legumi/mais',rx:/\b(legumi|fagioli|ceci|lenticchie|piselli|mais|borlotti|cannellini|ceci\s+lessati)\b/},
  {cat:'preserves_jars',pts:36,label:'conserve/barattoli',rx:/\b(pelati|polpa\s+di\s+pomodoro|conserva|sottolio|sottaceto|olive|capperi|barattolo|vasetto|vetro|lattina\s+alimentare|funghi\s+sottolio)\b/,ban:/\b(pesto|salsa|bbq|crema\s+spalmabile|marmellata|miele|tonno|legumi)\b/},
  {cat:'frozen',pts:58,label:'surgelato',rx:/\b(surgelat|congelat|pizza\s+surgelata|minestrone\s+surgelato|findus|frozen|bastoncini\s+surgelati|spinaci\s+surgelati)\b/},
  {cat:'ice_cream',pts:58,label:'gelato',rx:/\b(gelato|ghiacciolo|sorbetto|cono\s+gelato|vaschetta\s+gelato|magnum|cornetto\s+algida)\b/},
  {cat:'ready_meals',pts:46,label:'piatto pronto',rx:/\b(piatto\s+pronto|pronto\s+in\s+padella|insalata\s+pronta|lasagna\s+pronta|zuppa\s+pronta|tramezzino|sandwich|meal\s+ready)\b/},
  {cat:'meat_deli',pts:52,label:'carne/salumi',rx:/\b(prosciutto|salame|mortadella|wurstel|w[üu]rstel|carne|pollo|hamburger|salsiccia|bresaola|speck|tacchino|affettato|pancetta|coppa|lonza)\b/},
  {cat:'fish',pts:50,label:'pesce',rx:/\b(pesce|salmone|merluzzo|gamber|orata|branzino|frutti\s+di\s+mare|seppia|calamari|tonno\s+fresco)\b/},
  {cat:'fruit',pts:38,label:'frutta',rx:/\b(mela|mele|banana|banane|arancia|arance|limone|fragola|uva|pera|frutta|kiwi|pesca|albicocca|ciliegia|ananas|melone|anguria)\b/},
  {cat:'veg',pts:38,label:'verdura',rx:/\b(insalata|lattuga|pomodoro|pomodori|zucchina|zucchine|melanzana|verdura|ortaggi|carota|cipolla|patata|broccoli|spinaci|finocchio|peperone|cavolfiore)\b/},
  {cat:'baby_food',pts:50,label:'infanzia',rx:/\b(omogeneizzato|pannolini|latte\s+infanzia|baby\s+food|biberon|salviettine\s+bimbo|mellin|plasmon)\b/},
  {cat:'diet_special',pts:34,label:'speciale/dietetico',rx:/\b(senza\s+glutine|gluten\s*free|proteico|protein|senza\s+lattosio|vegano|vegetariano|bio|integrale|keto|light)\b/},
  {cat:'pet_food',pts:58,label:'cibo animali',rx:/\b(crocchette|umido\s+cane|umido\s+gatto|pat[eè]\s+cane|pat[eè]\s+gatto|monge|trainer|royal\s+canin|purina|whiskas|felix|mangime\s+(cane|gatto)|bocconcini\s+(cane|gatto))\b/},
  {cat:'pets',pts:36,label:'accessori animali',rx:/\b(lettiera|traversine|guinzaglio|collare|antiparassitario|pet\s*supply|animali)\b/},
  {cat:'laundry',pts:58,label:'bucato',rx:/\b(detersivo\s+lavatrice|ammorbidente|bucato|lavatrice|caps\s+lavatrice|perlana|dash|omino\s+bianco|napisan\s+bucato)\b/},
  {cat:'dishwashing',pts:56,label:'piatti/lavastoviglie',rx:/\b(detersivo\s+piatti|lavastoviglie|brillantante|sale\s+lavastoviglie|caps\s+lavastoviglie|finish|pril|svelto|nelsen)\b/},
  {cat:'cleaning',pts:54,label:'pulizia casa',rx:/\b(candeggina|sgrassatore|pulizia|pavimenti|vetri|bagno|wc|disinfettante\s+casa|ace|chanteclair|amuchina\s+superfici|lysoform|mastro\s+lindo)\b/},
  {cat:'paper_house',pts:46,label:'carta casa',rx:/\b(scottex|carta\s+igienica|rotoloni|tovaglioli|fazzoletti|carta\s+casa|sacchetti|alluminio|pellicola|domopak)\b/},
  {cat:'oral_care',pts:48,label:'igiene orale',rx:/\b(dentifricio|spazzolino|collutorio|filo\s+interdentale|oral\s*b|az\b|sensodyne)\b/},
  {cat:'hair_body',pts:44,label:'capelli/corpo',rx:/\b(shampoo|bagnoschiuma|docciaschiuma|sapone|deodorante|crema\s+corpo|gel\s+capelli|balsamo|rasoio|schiuma\s+barba|dove\s+shampoo)\b/},
  {cat:'personal_care',pts:36,label:'igiene persona',rx:/\b(igiene|assorbenti|salviettine|cotone|crema\s+viso|detergente\s+intimo|nivea|lines)\b/},
  {cat:'pharmacy',pts:58,label:'farmacia/parafarmacia',rx:/\b(farmaco|medicina|tachipirina|oki|brufen|cerotti|disinfettante|farmacia|integratore|paracetamolo|ibuprofene|termometro|garze|collirio|sciroppo)\b/},
  {cat:'aquarium',pts:58,label:'acquario',rx:/\b(acquario|pesci|mangime\s+pesci|biocondizionatore|filtro\s+acquario|tetra|sera|askoll|carbone\s+attivo|cannolicchi|fertilizzante\s+acquario)\b/}
];
const CATEGORY_PACKAGING_HINTS_V95_SERVER=[
  {rx:/\b(lattina|can)\b/,hint:'lattina'}, {rx:/\b(brick|brik|tetra\s*pak)\b/,hint:'brick'}, {rx:/\b(bottiglia|pet)\b/,hint:'bottiglia'},
  {rx:/\b(vasetto|barattolo|vetro|jar)\b/,hint:'vasetto/barattolo'}, {rx:/\b(squeeze)\b/,hint:'squeeze'}, {rx:/\b(flacone|spray)\b/,hint:'flacone/spray'},
  {rx:/\b(busta|sacchetto)\b/,hint:'busta'}, {rx:/\b(scatola|box|astuccio)\b/,hint:'scatola'}
];
function expertCategoryDecisionServerV95(evidence='', fallback='food'){
  const n=normalizeVisionText(evidence||'');
  const scores={}; const reasons={};
  const packaging=[];
  for(const h of CATEGORY_PACKAGING_HINTS_V95_SERVER){ if(h.rx.test(n)) packaging.push(h.hint); }
  for(const r of CATEGORY_EXPERT_RULES_V95_SERVER){
    if(r.ban && r.ban.test(n)) continue;
    if(r.rx.test(n)){ scores[r.cat]=(scores[r.cat]||0)+r.pts; (reasons[r.cat]=reasons[r.cat]||[]).push(r.label); }
  }
  const strong=(cat,min=50)=>Number(scores[cat]||0)>=min;
  const foodLike=['yogurt','dairy','eggs','pasta_rice','flour_baking','bakery','breakfast_cereals','breakfast_snacks','chocolate_sweets','spreads','jams_honey','sauces_condiments','oil_vinegar','spices_broths','preserves_jars','canned_fish_meat','legumes_canned','frozen','ice_cream','ready_meals','meat_deli','fish','fruit','veg','baby_food','diet_special'];
  const drinkLike=['water','soft_drinks','juice','sports_energy_drinks','milk_drinks','coffee_tea','drinks'];
  const homeLike=['laundry','dishwashing','cleaning','paper_house','oral_care','hair_body','personal_care','pharmacy','pet_food','pets','aquarium'];
  if(strong('soft_drinks')){ scores.water=0; scores.drinks=0; }
  if(strong('sauces_condiments')){ scores.preserves_jars=(scores.preserves_jars||0)*0.25; scores.spreads=(scores.spreads||0)*0.55; scores.drinks=0; scores.water=0; }
  if(strong('spreads')){ scores.preserves_jars=(scores.preserves_jars||0)*0.35; scores.sauces_condiments=(scores.sauces_condiments||0)*0.7; }
  if(strong('jams_honey')){ scores.spreads=(scores.spreads||0)*0.45; scores.preserves_jars=(scores.preserves_jars||0)*0.45; }
  if(strong('oil_vinegar')){ scores.sauces_condiments=(scores.sauces_condiments||0)*0.45; }
  if(strong('yogurt')){ scores.milk_drinks=0; scores.dairy=(scores.dairy||0)*0.55; }
  if(strong('canned_fish_meat')||strong('legumes_canned')) scores.preserves_jars=(scores.preserves_jars||0)*0.45;
  if(strong('ice_cream')) scores.frozen=(scores.frozen||0)*0.45;
  const foodStrong=foodLike.some(c=>strong(c,42));
  const drinkStrong=drinkLike.some(c=>c!=='drinks' && strong(c,42));
  const homeStrong=homeLike.some(c=>strong(c,42));
  if((foodStrong||homeStrong) && !drinkStrong){ for(const c of drinkLike){ scores[c]=0; } }
  if(drinkStrong && !foodStrong && !homeStrong){ scores.food=0; }
  let best=fallback||'food', bestScore=0;
  for(const cat of CATEGORY_PRIORITY_ORDER){ const s=Number(scores[cat]||0); if(s>bestScore){ best=cat; bestScore=s; } }
  if(!bestScore){ best=fallback||'food'; }
  const sorted=Object.entries(scores).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,5).map(([category,score])=>({category,score:Number(score.toFixed ? score.toFixed(2) : score), reasons:reasons[category]||[]}));
  const confidence=bestScore>=70?.96:bestScore>=55?.9:bestScore>=40?.8:bestScore>=25?.66:.45;
  return {category:best, score:bestScore, confidence, candidates:sorted, packaging:[...new Set(packaging)], reasons:reasons[best]||[], physicalState:categoryPhysicalStateServer(best), engine:'v27.96 professional category brain'};
}
function applyExpertCategoryBrainServerV95(result={}, previousDecision=null){
  if(!result) return result;
  const evidence=categoryEvidenceServer(result);
  const decision=expertCategoryDecisionServerV95(evidence, result.category||'food');
  const old=result.category||'';
  if(decision.category && (decision.score>=25 || !old || old==='food' || old==='drinks' || old==='house')) result.category=decision.category;
  if(decision.score>=40 && old && old!==result.category) result.categoryGuardNote=`Categoria v27.96: ${old} → ${result.category} (${(decision.reasons||[]).join(', ')})`;
  result.categoryBrainV95={category:decision.category,confidence:decision.confidence,score:decision.score,physicalState:decision.physicalState,packaging:decision.packaging,candidates:decision.candidates,reasons:decision.reasons};
  result.categoryRuleSource='professional reality ontology v27.96';
  result.categoryRuleEvidence=[...(result.categoryRuleEvidence||[]),...(decision.reasons||[])].filter(Boolean).slice(0,10);
  result.physicalState=decision.physicalState;
  result.isLiquid=REAL_DRINK_CATEGORIES.has(result.category)||decision.physicalState==='liquid_food'||decision.physicalState==='creamy_or_liquid_food';
  const n=normalizeVisionText(evidence);
  if(result.category==='soft_drinks') result.unit=/\blattina\b/.test(n)?'lattina':(result.unit&&result.unit!=='pz'?result.unit:'bt');
  if(result.category==='water') result.unit=result.unit&&result.unit!=='pz'?result.unit:'bt';
  if(['sauces_condiments','spreads','jams_honey','yogurt','preserves_jars'].includes(result.category) && result.unit==='bt') result.unit=/\b(vasetto|barattolo|vetro|pesto|marmellata|crema)\b/.test(n)?'vasetto':'conf';
  if(decision.confidence<.68){ result.categoryNeedsVerification=true; result.needsManual=true; }
  try{
    db.assistantBrain.categoryBrainV95=db.assistantBrain.categoryBrainV95||{version:95,decisions:0,lowConfidence:0,last:[]};
    db.assistantBrain.categoryBrainV95.decisions++;
    if(decision.confidence<.68) db.assistantBrain.categoryBrainV95.lowConfidence++;
    db.assistantBrain.categoryBrainV95.last.unshift({at:Date.now(),category:result.category,score:decision.score,confidence:decision.confidence,reasons:decision.reasons,productName:result.productName||'',brand:result.brand||''});
    db.assistantBrain.categoryBrainV95.last=db.assistantBrain.categoryBrainV95.last.slice(0,30);
  }catch(_){ }
  return result;
}




// V27.96 MONSTER PRODUCT INTELLIGENCE - server side
function ensureMonsterBrainV96(){
  ensureDbShape();
  const b=db.assistantBrain.monsterBrainV96=db.assistantBrain.monsterBrainV96||{version:96, decisions:0, lowConfidence:0, correctionsLearned:0, teacherAvoided:0, productIdentities:{}, recurrentErrors:{}, fieldStats:{}, last:[], updatedAt:0};
  b.productIdentities=b.productIdentities||{}; b.recurrentErrors=b.recurrentErrors||{}; b.fieldStats=b.fieldStats||{}; b.last=Array.isArray(b.last)?b.last:[];
  return b;
}
const MONSTER_RULES_V96_SERVER = [
  ['non_consumable',120,/\b(cane|gatto\s+vivo|persona|viso|telecomando|tv|televisore|pantaloni|maglia|scarpe|sedia|tavolo|mobile|pavimento|divano|letto|porta|computer)\b/,'oggetto non idoneo'],
  ['soft_drinks',98,/\b(blues\s*cola|cola\s*blues|cola|coca\s*cola|coca-cola|pepsi|fanta|sprite|aranciata|gassosa|chinotto|tonica|cedrata|bibita\s+gassata|bevanda\s+gassata)\b/,'cola/bibita gassata'],
  ['water',78,/\b(acqua\s+(naturale|frizzante|minerale)|minerale|oligominerale|levissima|sant\s*anna|san\s*benedetto|ferrarelle|rocchetta|uliveto|lete)\b/,'acqua vera'],
  ['juice',76,/\b(succo|nettare|spremuta|estath[eè]|the\s*freddo|t[eè]\s*freddo|ice\s*tea|bevanda\s+alla\s+frutta)\b/,'succo/tè'],
  ['sports_energy_drinks',76,/\b(red\s*bull|monster\s+energy|burn\b|energy\s*drink|powerade|gatorade|isotonica|sport\s*drink)\b/,'energy/sport'],
  ['milk_drinks',72,/\b(latte\s+uht|latte\s+(intero|scremato|parzialmente)|bevanda\s+(vegetale|alla\s+soia|all\s*avena|al\s+riso)|latte\s+di\s+(soia|mandorla|avena|riso))\b/,'latte da bere'],
  ['coffee_tea',64,/\b(caff[eè]|capsule\s+caff[eè]|cialde|orzo|camomilla|tisane|infuso|filtro\s+te|t[eè]\s+caldo)\b/,'caffè/tè'],
  ['yogurt',95,/\b(yogurt|yoghurt|kefir|skyr|greco|fermenti\s+lattici|ayo\s*kefir)\b/,'yogurt/kefir'],
  ['sauces_condiments',96,/\b(pesto|salsa\s+bbq|salsa\s+barbecue|barbecue|bbq|ketchup|maionese|senape|condimento|sugo|passata|rag[uù]|besciamella|glassa|hummus)\b/,'salsa/condimento'],
  ['oil_vinegar',90,/\b(olio\s+extra\s+vergine|olio\s+evo|extra\s+vergine|olio\b|aceto|balsamico|vinaigrette)\b/,'olio/aceto'],
  ['spreads',92,/\b(nutella|crema\s+spalmabile|crema\s+(di|al|alla)\s+(nocciole|pistacchio|cacao)|burro\s+d\s*arachidi|peanut\s*butter|spalmabile)\b/,'crema spalmabile'],
  ['jams_honey',88,/\b(marmellata|confettura|composta|miele|sciroppo\s+d\s*acero)\b/,'marmellata/miele'],
  ['chocolate_sweets',82,/\b(cioccolat|cacao|tavoletta|pralina|caramell|dolci|merendina|torrone|wafer|biscotto\s+farcito)\b/,'cioccolata/dolci'],
  ['dairy',78,/\b(mozzarella|formaggio|parmigiano|grana|ricotta|burro|panna|mascarpone|stracchino|philadelphia|gorgonzola|latticini)\b/,'latticini'],
  ['eggs',74,/\b(uova|uovo|confezione\s+uova)\b/,'uova'],
  ['pasta_rice',74,/\b(pasta|spaghetti|penne|fusilli|rigatoni|riso|risotto|cous\s*cous|gnocchi|lasagne|tagliatelle)\b/,'pasta/riso'],
  ['flour_baking',66,/\b(farina|lievito|preparato\s+per\s+torta|fecola|amido|vanillina|pangrattato|zucchero\s+a\s+velo)\b/,'farine/preparati'],
  ['bakery',66,/\b(pane|panino|piadina|cracker|grissini|taralli|fette\s+biscottate|pan\s+bauletto|toast)\b/,'pane/forno'],
  ['breakfast_cereals',62,/\b(cereali|corn\s*flakes|muesli|granola|fiocchi\s+d\s*avena|avena)\b/,'cereali'],
  ['breakfast_snacks',58,/\b(biscott|snack|patatine|pop\s*corn|barretta|chips|salatini|cracker\s+snack)\b/,'snack'],
  ['spices_broths',62,/\b(sale|pepe|spezie|origano|basilico|paprika|curcuma|dado|brodo|insaporitore|zafferano)\b/,'spezie/brodi'],
  ['canned_fish_meat',72,/\b(tonno|sgombro\s+in\s+scatola|sardine|alici|carne\s+in\s+scatola|simmenthal)\b/,'conserve proteiche'],
  ['legumes_canned',66,/\b(fagioli|ceci|lenticchie|piselli|mais|borlotti|cannellini|legumi)\b/,'legumi/mais'],
  ['preserves_jars',46,/\b(pelati|polpa\s+di\s+pomodoro|sottolio|sottaceto|olive|capperi|conserva|barattolo|vasetto)\b/,'conserve/barattoli'],
  ['frozen',80,/\b(surgelat|congelat|pizza\s+surgelata|minestrone\s+surgelato|findus|bastoncini\s+surgelati)\b/,'surgelato'],
  ['ice_cream',82,/\b(gelato|ghiacciolo|sorbetto|cono\s+gelato|vaschetta\s+gelato|magnum|cornetto\s+algida)\b/,'gelato'],
  ['ready_meals',64,/\b(piatto\s+pronto|pronto\s+in\s+padella|lasagna\s+pronta|zuppa\s+pronta|tramezzino|sandwich)\b/,'piatto pronto'],
  ['meat_deli',74,/\b(prosciutto|salame|mortadella|wurstel|w[üu]rstel|carne|pollo|hamburger|salsiccia|bresaola|speck|affettato)\b/,'carne/salumi'],
  ['fish',70,/\b(pesce|salmone|merluzzo|gamber|orata|branzino|frutti\s+di\s+mare|calamari)\b/,'pesce'],
  ['fruit',55,/\b(mela|mele|banana|banane|arancia|limone|fragola|uva|pera|kiwi|ananas|melone|anguria|frutta)\b/,'frutta'],
  ['veg',55,/\b(insalata|lattuga|pomodoro|zucchina|melanzana|carota|cipolla|patata|broccoli|spinaci|peperone|verdura|ortaggi)\b/,'verdura'],
  ['baby_food',72,/\b(omogeneizzato|pannolini|latte\s+infanzia|baby\s+food|mellin|plasmon)\b/,'infanzia'],
  ['diet_special',42,/\b(senza\s+glutine|gluten\s*free|proteico|protein|senza\s+lattosio|vegano|vegetariano|bio|integrale|light)\b/,'speciale/dietetico'],
  ['pet_food',82,/\b(crocchette|umido\s+cane|umido\s+gatto|pat[eè]\s+cane|pat[eè]\s+gatto|monge|trainer|royal\s+canin|purina|whiskas|felix|mangime\s+(cane|gatto))\b/,'cibo animali'],
  ['pets',54,/\b(lettiera|traversine|guinzaglio|collare|antiparassitario)\b/,'accessori animali'],
  ['laundry',80,/\b(detersivo\s+lavatrice|ammorbidente|bucato|lavatrice|caps\s+lavatrice|dash|perlana|omino\s+bianco)\b/,'bucato'],
  ['dishwashing',78,/\b(detersivo\s+piatti|lavastoviglie|brillantante|sale\s+lavastoviglie|finish|pril|svelto|nelsen)\b/,'piatti/lavastoviglie'],
  ['cleaning',76,/\b(candeggina|sgrassatore|pulizia|pavimenti|vetri|bagno|wc|disinfettante\s+casa|ace|chanteclair|lysoform)\b/,'pulizia casa'],
  ['paper_house',66,/\b(scottex|carta\s+igienica|rotoloni|tovaglioli|fazzoletti|carta\s+casa|sacchetti|alluminio|pellicola)\b/,'carta casa'],
  ['oral_care',70,/\b(dentifricio|spazzolino|collutorio|filo\s+interdentale|oral\s*b|sensodyne)\b/,'igiene orale'],
  ['hair_body',68,/\b(shampoo|bagnoschiuma|docciaschiuma|sapone|deodorante|balsamo|rasoio|schiuma\s+barba)\b/,'capelli/corpo'],
  ['personal_care',55,/\b(assorbenti|salviettine|cotone|crema\s+viso|detergente\s+intimo|nivea|lines)\b/,'igiene persona'],
  ['pharmacy',82,/\b(farmaco|medicina|tachipirina|oki|brufen|cerotti|disinfettante|integratore|paracetamolo|ibuprofene|termometro|garze|collirio|sciroppo)\b/,'farmacia'],
  ['aquarium',82,/\b(acquario|mangime\s+pesci|biocondizionatore|filtro\s+acquario|tetra|sera|askoll|cannolicchi|fertilizzante\s+acquario)\b/,'acquario']
];
function monsterTextServerV96(result={}){ return [result.productName,result.brand,result.variant,result.productType,result.packageType,result.category,result.estimatedSize,result.sizeDetectedRaw,result.unit,...(result.detectedText||[]),...(result.visibleEvidence||[]),...(result.ingredients||[]),...(result.allergens||[])].filter(Boolean).join(' '); }
function monsterDetectPackagingServerV96(text=''){ const n=normalizeVisionText(text); const out=[]; [['lattina',/\b(lattina|can)\b/],['brick',/\b(brick|brik|tetra\s*pak)\b/],['bottiglia',/\b(bottiglia|pet)\b/],['vasetto',/\b(vasetto|barattolo|jar|vetro)\b/],['squeeze',/\b(squeeze)\b/],['flacone',/\b(flacone)\b/],['spray',/\b(spray)\b/],['busta',/\b(busta|sacchetto)\b/],['scatola',/\b(scatola|box|astuccio)\b/],['blister',/\b(blister)\b/]].forEach(([k,rx])=>{ if(rx.test(n)) out.push(k); }); return [...new Set(out)]; }
function monsterDetectMaterialServerV96(text=''){ const n=normalizeVisionText(text); const out=[]; [['vetro',/\b(vetro|glass)\b/],['plastica',/\b(plastica|pet|plastic)\b/],['cartone',/\b(cartone|cartoncino|tetra\s*pak|brick|brik)\b/],['alluminio',/\b(alluminio|latta|lattina)\b/],['carta',/\b(carta|paper)\b/]].forEach(([k,rx])=>{ if(rx.test(n)) out.push(k); }); return [...new Set(out)]; }
function monsterCategoryDecisionServerV96(result={}, fallback='food'){
  const text=monsterTextServerV96(result); const n=normalizeVisionText(text); const scores={}; const reasons={}; const add=(cat,pts,reason)=>{scores[cat]=(scores[cat]||0)+pts;(reasons[cat]=reasons[cat]||[]).push(reason)};
  for(const [cat,pts,rx,label] of MONSTER_RULES_V96_SERVER){ if(rx.test(n)) add(cat,pts,label); }
  const packaging=monsterDetectPackagingServerV96(text); const material=monsterDetectMaterialServerV96(text);
  if(packaging.includes('lattina') && /cola|bibita|energy|aranciata|pepsi|fanta|sprite/.test(n)) add('soft_drinks',12,'packaging coerente lattina');
  if(packaging.includes('bottiglia') && /acqua|minerale|naturale|frizzante/.test(n)) add('water',12,'packaging coerente bottiglia acqua');
  if(packaging.includes('vasetto') && /pesto|salsa|condimento|marmellata|crema|miele/.test(n)) add((scores.spreads||0)>(scores.sauces_condiments||0)?'spreads':'sauces_condiments',8,'vasetto coerente ma non decisivo');
  if((scores.soft_drinks||0)>=70){ scores.water=0; reasons.water=[]; }
  if((scores.sauces_condiments||0)>=70){ ['water','soft_drinks','drinks','preserves_jars'].forEach(c=>{scores[c]=(scores[c]||0)*0.1}); }
  if((scores.yogurt||0)>=70){ scores.milk_drinks=0; scores.dairy=(scores.dairy||0)*0.35; }
  if((scores.laundry||0)>=70 || (scores.cleaning||0)>=70 || (scores.dishwashing||0)>=70){ ['food','drinks','water','soft_drinks','juice','milk_drinks'].forEach(c=>scores[c]=0); }
  if((scores.pet_food||0)>=70){ ['food','meat_deli'].forEach(c=>scores[c]=(scores[c]||0)*0.2); }
  const candidates=Object.entries(scores).filter(([,s])=>Number(s)>0).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([category,score])=>({category,score:Number(score.toFixed(2)),reasons:reasons[category]||[]}));
  const best=candidates[0]?.category || fallback || result.category || 'food'; const bestScore=candidates[0]?.score||0; const second=candidates[1]?.score||0; const gap=bestScore-second;
  const confidence=bestScore>=92&&gap>=15?.98:bestScore>=78&&gap>=10?.93:bestScore>=62?.84:bestScore>=44?.70:.48;
  return {version:96,category:best,score:bestScore,confidence,candidates,reasons:reasons[best]||[],gap,packaging,material,physicalState:categoryPhysicalStateServer(best),source:'monster_product_intelligence_v27_96'};
}
function monsterExtractBarcodeServerV96(result={}){ const text=monsterTextServerV96(result).replace(/[Oo]/g,'0').replace(/[Il]/g,'1'); const hits=(text.match(/\b\d{8,14}\b/g)||[]).filter(x=>![1900,2000,2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030].includes(Number(x))); return hits.find(x=>x.length===13)||hits.find(x=>x.length===12)||hits.find(x=>x.length===8)||''; }
function monsterParseFormatServerV96(result={}){ const text=monsterTextServerV96(result).replace(/[Oo](?=\d)|(?<=\d)[Oo]/g,'0').replace(/,/g,'.'); const multi=text.match(/\b(\d{1,2})\s*[xX]\s*(\d+(?:\.\d+)?)\s*(l|lt|ml|g|kg)\b/i); if(multi) return {format:`${multi[1]} x ${multi[2]} ${multi[3].toUpperCase().replace('LT','L')}`, confidence:.92, source:'multi_pack'}; const m=text.match(/\b(?:peso\s*netto|netto|contenuto|formato|quantit[aà])?\s*(\d+(?:\.\d+)?)\s*(kg|g|gr|grammi|l|lt|litri|ml|cl)\b/i); if(m){ let unit=m[2].toLowerCase(); if(unit==='gr'||unit==='grammi') unit='g'; if(unit==='lt'||unit==='litri') unit='L'; return {format:`${m[1]} ${unit}`, confidence:.86, source:'label_format'}; } return null; }
function monsterExtractIngredientsServerV96(result={}){ const chunks=[...(result.detectedText||[]),...(result.visibleEvidence||[])].map(String); const joined=chunks.join(' | '); const n=normalizeVisionText(joined); const ingredients=[], allergens=[], traces=[]; const ingMatch=joined.match(/ingredienti?\s*[:\-]?\s*([^|]{8,420})/i); if(ingMatch) ingMatch[1].split(/[,;]+/).map(x=>x.trim()).filter(x=>x.length>1).slice(0,40).forEach(x=>ingredients.push(x)); [['glutine',/glutine|frumento|orzo|segale/],['latte',/latte|lattosio|siero\s+di\s+latte/],['uova',/uova|albume/],['soia',/soia/],['arachidi',/arachid/],['frutta a guscio',/frutta\s+a\s+guscio|nocciole|mandorle|pistacchi|noci|anacardi/],['sesamo',/sesamo/],['senape',/senape/],['sedano',/sedano/],['pesce',/pesce/],['crostacei',/crostacei|gamber/],['molluschi',/molluschi/],['solfiti',/solfiti|anidride\s+solforosa/]].forEach(([name,rx])=>{ if(rx.test(n)) allergens.push(name); }); const traceMatch=joined.match(/pu[oò]\s+contenere\s+([^|.]{3,220})/i); if(traceMatch) traceMatch[1].split(/[,;]+/).map(x=>x.trim()).filter(Boolean).slice(0,20).forEach(x=>traces.push(x)); return {ingredients:[...new Set(ingredients)],allergens:[...new Set(allergens)],traces:[...new Set(traces)]}; }
function monsterFieldConfidenceServerV96(result={}, decision=null){ const evidence=monsterTextServerV96(result); const text=normalizeVisionText(evidence); const fc=Object.assign({}, result.fieldConfidence||{}); const has=(v)=>String(v||'').trim().length>1 && !/da confermare|possibile|tipo|generico/i.test(String(v)); fc.productName=has(result.productName)?(/\b(?:pesto|cola|salsa|yogurt|kefir|selex|blues|saper|sapori)\b/.test(text)?.92:.76):.22; fc.brand=has(result.brand)?(/\b(selex|blues|saper|barilla|mulino|arborea|coca|pepsi|monge|finish|dash)\b/.test(text)?.9:.68):.18; fc.category=decision?.confidence||.45; fc.format=has(result.estimatedSize||result.size)?(/\d+\s*(g|kg|ml|l|lt)\b/i.test(result.estimatedSize||result.size)?.9:.62):.2; fc.expiry=result.expiryDate? .82 : (result.expiryConfidence||.2); fc.barcode=result.barcode?.length>=8?.98:.1; return fc; }
function applyMonsterProductIntelligenceServerV96(result={}){ if(!result||typeof result!=='object') return result; const decision=monsterCategoryDecisionServerV96(result,result.category||'food'); const old=result.category||''; if(decision.category&&(decision.confidence>=.62||!old||['food','drinks','house'].includes(old))) result.category=decision.category; result.categoryBrainV96=decision; result.categoryRuleSource='monster product intelligence v27.96'; result.categoryRuleEvidence=[...(result.categoryRuleEvidence||[]),...(decision.reasons||[])].filter(Boolean).slice(0,16); result.physicalState=decision.physicalState; result.packageHintsV96=decision.packaging; result.materialHintsV96=decision.material; if(decision.packaging.length&&!result.packageType) result.packageType=decision.packaging[0]; const barcode=monsterExtractBarcodeServerV96(result); if(barcode&&!result.barcode) result.barcode=barcode; const fmt=monsterParseFormatServerV96(result); if(fmt&&(!result.estimatedSize||/da confermare|possibile|0?5\s*l/i.test(String(result.estimatedSize)))){ result.estimatedSize=fmt.format; result.sizeConfidence=fmt.confidence; result.sizeDetectedRaw=fmt.format; } const extra=monsterExtractIngredientsServerV96(result); result.ingredients=[...new Set([...(result.ingredients||[]),...extra.ingredients])].slice(0,60); result.allergens=[...new Set([...(result.allergens||[]),...extra.allergens])].slice(0,40); result.possibleTraces=[...new Set([...(result.possibleTraces||[]),...extra.traces])].slice(0,30); result.fieldConfidence=monsterFieldConfidenceServerV96(result,decision); result.monsterQualityV96={version:96,status:decision.confidence>=.8?'strong':decision.confidence>=.62?'usable':'needs_more_evidence',confidence:decision.confidence,score:decision.score,gap:decision.gap,teacherPolicy:decision.confidence>=.85&&result.barcode?'teacher_not_needed_if_confirmed':'teacher_if_uncertain',antiContamination:true,storesPhotos:false}; if(decision.confidence<.62){ result.needsManual=true; result.categoryNeedsVerification=true; result.detailQuestion=result.detailQuestion||'Categoria non sicura: scansiona bene etichetta o correggi prima di confermare.'; } if(old&&result.category!==old) result.categoryGuardNote=`Categoria v27.96: ${old} → ${result.category} (${decision.reasons.join(', ')})`; result.isLiquid=REAL_DRINK_CATEGORIES.has(result.category)||['liquid_food','creamy_or_liquid_food'].includes(decision.physicalState); try{ const b=ensureMonsterBrainV96(); b.decisions++; if(decision.confidence<.62) b.lowConfidence++; b.last.unshift({at:Date.now(),productName:result.productName||'',brand:result.brand||'',category:result.category,score:decision.score,confidence:decision.confidence,reasons:decision.reasons}); b.last=b.last.slice(0,50); b.updatedAt=Date.now(); }catch(_){ } return result; }
function reinforceMonsterLearningServerV96(confirmed={}){ const b=ensureMonsterBrainV96(); const normalized=applyMonsterProductIntelligenceServerV96(Object.assign({},confirmed,{estimatedSize:confirmed.size||confirmed.estimatedSize||'',detectedText:confirmed.detectedText||[],visibleEvidence:confirmed.visibleEvidence||[]})); const key=productCanonicalKey(normalized.productName||confirmed.productName||'', normalized.brand||confirmed.brand||'') || normalizeVisionText([normalized.productName,normalized.brand,confirmed.size].join(' ')); if(key){ const rec=b.productIdentities[key]=b.productIdentities[key]||{key,count:0,categoryVotes:{},fieldConfidence:{},barcodes:[],errors:[],updatedAt:0}; rec.count++; rec.categoryVotes=voteMapAdd(rec.categoryVotes||{}, normalized.category||confirmed.category||''); rec.category=voteMapTop(rec.categoryVotes)||normalized.category||confirmed.category||''; rec.fieldConfidence=Object.assign({},rec.fieldConfidence,normalized.fieldConfidence||{}); const bc=bestBarcodeFromConfirmed(normalized)||normalized.barcode||confirmed.barcode||''; if(bc&&!rec.barcodes.includes(bc)) rec.barcodes.unshift(bc); rec.barcodes=rec.barcodes.slice(0,12); const corrections=confirmed.userCorrections||{}; for(const [field,info] of Object.entries(corrections)){ if(info?.edited){ const sig=`${field}:${normalizeVisionText(info.from||'')}=>${normalizeVisionText(info.to||'')}`.slice(0,150); b.recurrentErrors[sig]=Number(b.recurrentErrors[sig]||0)+1; rec.errors.unshift({at:Date.now(),field,from:info.from||'',to:info.to||''}); b.correctionsLearned++; } } rec.errors=rec.errors.slice(0,30); rec.updatedAt=Date.now(); } return normalized; }
try{ const __applyV95Server=applyExpertCategoryBrainServerV95; applyExpertCategoryBrainServerV95=function(result={},previousDecision=null){ return applyMonsterProductIntelligenceServerV96(__applyV95Server(result,previousDecision)); }; }catch(_){ }
try{ const __matchGlobalV95=matchGlobalProductMemory; matchGlobalProductMemory=function(query={}){ const q=applyMonsterProductIntelligenceServerV96(Object.assign({},query,{estimatedSize:query.size||query.estimatedSize||''})); const base=__matchGlobalV95(q)||__matchGlobalV95(query); if(!base?.product) return base; const p=base.product; const conflict=productIdentityConflict(p,q); if(conflict?.conflict && !q.barcode){ updateGlobalLearningAudit({type:'monster-match-rejected', reason:conflict.reason, query:{productName:q.productName,brand:q.brand,category:q.category}, match:{productName:p.productName,brand:p.brand,category:p.category}}); return null; } if(q.categoryBrainV96?.confidence>=.8 && p.category && productCategoryFamily(p.category)!==productCategoryFamily(q.category) && !q.barcode){ return null; } base.product.monsterMatchedV96=true; base.product.categoryBrainV96=q.categoryBrainV96||null; return base; }; }catch(_){ }

function offCategoryToAppServer(text='', fallback=''){
  const n=normalizeVisionText(text);
  if(!n) return fallback || 'food';
  if(/waters|water|eaux|acqua|mineral/.test(n)) return 'water';
  if(/sodas|carbonated|soft drinks|cola|bibite|gassate/.test(n)) return 'soft_drinks';
  if(/juices|nectars|iced tea|tea based beverages|succhi|te freddo/.test(n)) return 'juice';
  if(/milks|dairy drinks|milk drinks|latte/.test(n)) return 'milk_drinks';
  if(/yogurts|yoghurts|yogurt|skyr|kefir/.test(n)) return 'yogurt';
  if(/cheeses|dairy|formaggi|latticini|butter|burro/.test(n)) return 'dairy';
  if(/chocolate|chocolates|cocoa|sweets|desserts|cioccolat|dolci/.test(n)) return 'chocolate_sweets';
  if(/spreads|spread|crema spalmabile|hazelnut spread|pistachio spread/.test(n)) return 'spreads';
  if(/sauces|condiments|dressings|pesto|barbecue sauce|bbq|ketchup|mayonnaise|salse|condimenti/.test(n)) return 'sauces_condiments';
  if(/canned|preserves|jars|conserve|jarred|barattoli|vasetti|legumes/.test(n)) return 'preserves_jars';
  if(/pasta|rice|cereals and potatoes|riso|semolina/.test(n)) return 'pasta_rice';
  if(/breads|bakery|crackers|biscottes|pane|forno/.test(n)) return 'bakery';
  if(/snacks|breakfasts|biscuits|cookies|cereals|colazione|snack/.test(n)) return 'breakfast_snacks';
  if(/frozen|surgelati|ice creams|gelati/.test(n)) return 'frozen';
  if(/meats|deli|sausages|salumi|carne/.test(n)) return 'meat_deli';
  if(/fish|seafood|pesce/.test(n)) return 'fish';
  if(/fruits|frutta/.test(n)) return 'fruit';
  if(/vegetables|verdura|ortaggi/.test(n)) return 'veg';
  return inferRealityCategoryServer(text, fallback || 'food');
}
function categoryConfidenceServer(cat='', evidence=''){
  const inferred=inferRealityCategoryServer(evidence,'');
  if(inferred && inferred===cat) return .86;
  if(cat && cat!=='food' && cat!=='drinks') return .74;
  return .48;
}
async function fetchJsonWithTimeout(url, opts={}, timeoutMs=2600){
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const r=await fetch(url,Object.assign({},opts,{signal:controller.signal,headers:Object.assign({'User-Agent':'SpesaPronta/27.77 category lookup'},opts.headers||{})}));
    if(!r.ok) return null;
    return await r.json().catch(()=>null);
  }catch(_){ return null; }
  finally{ clearTimeout(t); }
}
function bestOffProduct(products=[], query=''){
  const qt=new Set(normalizeVisionText(query).split(' ').filter(x=>x.length>2));
  let best=null,bestScore=-1;
  for(const p of products||[]){
    const txt=normalizeVisionText([p.product_name,p.brands,p.categories,(p.categories_tags||[]).join(' ')].join(' '));
    let score=0; for(const t of qt){ if(txt.includes(t)) score++; }
    if(p.categories || (p.categories_tags||[]).length) score+=1.5;
    if(score>bestScore){ best=p; bestScore=score; }
  }
  return best;
}
async function internetCategoryLookupServer({productName='',brand='',productType='',packageType='',currentCategory='',detectedText=[],visibleEvidence=[]}={}){
  const evidence=[productName,brand,productType,packageType,currentCategory,...(detectedText||[]),...(visibleEvidence||[])].join(' ');
  const evidenceNorm=normalizeVisionText(evidence);
  const teaEvidence=/\b(t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|estath[eè]|the\s*fusion|th[eè]\s*fusion|t[eè]\s*fusion|bevanda\s+al\s+t[eè]|bevanda\s+al\s+the|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa)|t[eè]\s*(pesca|limone|rosa))\b/.test(evidenceNorm);
  const genericFallback=/\b(bibita\s+tipo\s+cola|bevanda\s+in\s+bottiglia\s+da\s+identificare|bottiglia\s+da\s+identificare|prodotto\s+da\s+identificare)\b/.test(evidenceNorm) && !brand && !(detectedText||[]).length && !(visibleEvidence||[]).length;
  const local=teaEvidence ? 'juice' : inferRealityCategoryServer(evidence,currentCategory||'food');
  if(genericFallback) return {category:currentCategory||'drinks', confidence:.32, source:'regole locali', reason:'Categoria non verificata: nome locale generico, serve etichetta/barcode/docente.'};
  const query=[brand,productName,productType].filter(Boolean).join(' ').trim();
  if(!query || query.length<3){
    return {category:local, confidence:categoryConfidenceServer(local,evidence), source:'regole locali', reason:'Categoria dedotta dai testi letti.'};
  }
  const url='https://world.openfoodfacts.org/cgi/search.pl?search_terms='+encodeURIComponent(query)+'&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,categories,categories_tags,ingredients_text,allergens_tags';
  const data=await fetchJsonWithTimeout(url,{},2600);
  const prod=bestOffProduct(data?.products||[], query);
  if(prod){
    const offText=[prod.product_name,prod.brands,prod.categories,(prod.categories_tags||[]).join(' ')].join(' ');
    let cat=offCategoryToAppServer(offText, local||currentCategory||'food');
    if(teaEvidence && cat==='soft_drinks') cat='juice';
    if(cat==='soft_drinks' && !/\b(coca\s*cola|coca-cola|pepsi|fanta|sprite|aranciata|chinotto|gassosa|cedrata|bibita\s*gassata|bevanda\s*gassata|cola\s*(zero|classica|original))\b/.test(normalizeVisionText([evidence,offText].join(' ')))) cat=local||currentCategory||'drinks';
    const ingredients=cleanVisionArray(String(prod.ingredients_text||'').split(/[,;]+/),30);
    const allergens=cleanVisionArray((prod.allergens_tags||[]).map(x=>String(x).replace(/^..:/,'')),20);
    return {category:cat, confidence:Math.max(.72,categoryConfidenceServer(cat, offText)), source:'internet OpenFoodFacts', reason:`Internet indica categoria ${cat} per ${prod.product_name||query}.`, ingredients, allergens, webProductName:prod.product_name||'', webBrand:prod.brands||''};
  }
  return {category:local, confidence:categoryConfidenceServer(local,evidence), source:'regole locali', reason:'Nessun riferimento internet rapido: categoria dedotta dai testi letti.'};
}

function pickDiverseVisionSeedProducts(products=[], limit=520){
  const out=[]; const seen=new Set();
  for(const p of products||[]){
    const key=[p.category||'',p.subcategory||'',p.brand||'',(p.formats||[])[0]||''].join('|');
    if(seen.has(key)) continue;
    seen.add(key); out.push(p);
    if(out.length>=limit) break;
  }
  if(out.length<limit){
    for(const p of products||[]){ if(out.includes(p)) continue; out.push(p); if(out.length>=limit) break; }
  }
  return out;
}
function buildVisionCandidatePool(catalog=[], settings={}, memory={}){
  const out=[];
  for(const item of (catalog||[]).slice(0,300)){
    const names=[];
    try{ names.push(itemName(item,settings?.lang||'it')); }catch(_){ }
    if(item?.names && typeof item.names==='object') names.push(...Object.values(item.names));
    out.push({
      source:'catalog',
      id:item.id||'',
      name: cleanVisionString(names.find(Boolean)||''),
      category: cleanVisionString(item.category||''),
      brand:'',
      aliases: uniqueStrings(names,8),
      unit: cleanVisionString(item.unit||''),
      estimatedSize: cleanVisionString(item.aiMeta?.estimatedSize || item.estimatedSize || '')
    });
  }
  for(const row of (Array.isArray(memory?.learnedProducts)?memory.learnedProducts:[]).slice(0,420)){
    out.push({
      source:'memory',
      id:row.key||'',
      name: cleanVisionString(row.productName||''),
      category: cleanVisionString(row.category||''),
      brand: cleanVisionString(row.brand||''),
      aliases: uniqueStrings([row.productName,row.brand,row.variant,...(row.aliases||[])],10),
      unit: cleanVisionString(row.unit||''),
      estimatedSize: cleanVisionString(row.estimatedSize||''),
      visualHints: uniqueStrings(row.visualHints||[],8)
    });
  }
  for(const p of pickDiverseVisionSeedProducts(VISION_SEED_MEMORY.products||[],520)){
    out.push({
      source:'seed', id:p.key||String(p.id||''), name:cleanVisionString(p.name||''), category:seedCategoryToAppServer(p.category||''), brand:p.brand==='Generico'?'':cleanVisionString(p.brand||''), aliases:uniqueStrings([p.name,p.brand,...(p.aliases||[])],10), unit:cleanVisionString(p.defaultUnit||''), estimatedSize:cleanVisionString((p.formats||[])[0]||''), visualHints:uniqueStrings([...(p.visualHints||[]),...(p.ocrKeywords||[])],10)
    });
  }
  return out.filter(x=>x.name);
}
function scoreVisionCandidate(result, candidate){
  const hay = normalizeVisionText([result.productName,result.brand,result.variant,result.productType,result.packageType,result.estimatedSize,...(result.detectedText||[]),...(result.visibleEvidence||[])].join(' '));
  const tokens = new Set(hay.split(/\s+/).filter(t=>t.length>=2));
  let score=0;
  const aliases=[candidate.name,...(candidate.aliases||[])].map(normalizeVisionText).filter(Boolean);
  for(const alias of aliases){
    if(!alias) continue;
    if(hay===alias) score+=8;
    if(hay.includes(alias) || alias.includes(hay)) score+=4;
    const parts=alias.split(/\s+/).filter(t=>t.length>=2);
    for(const p of parts){ if(tokens.has(p)) score += (p.length>=5?1.6:1); }
  }
  const brand=normalizeVisionText(candidate.brand||'');
  if(brand && tokens.has(brand)) score+=4;
  if(candidate.category && result.category && candidate.category===result.category) score+=1.2;
  for(const hint of (candidate.visualHints||[]).map(normalizeVisionText)){ if(hint && hay.includes(hint)) score+=1.4; }
  return Number(score.toFixed(2));
}
function applyVisionMatching(result, candidates){
  if(!result || !Array.isArray(candidates) || !candidates.length) return result;
  const evidenceText=normalizeVisionText([result.productName,result.brand,result.variant,result.productType,result.packageType,result.estimatedSize,...(result.detectedText||[]),...(result.visibleEvidence||[])].join(' '));
  const teaEvidence=/\b(t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|estath[eè]|the\s*fusion|th[eè]\s*fusion|t[eè]\s*fusion|bevanda\s+al\s+t[eè]|bevanda\s+al\s+the|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa)|t[eè]\s*(pesca|limone|rosa))\b/.test(evidenceText);
  const colaEvidence=!teaEvidence && /\b(blues\s*cola|cola\s*blues|coca cola|coca-cola|pepsi|fanta|sprite|cola\s*(zero|classica|original)|aranciata|bibita\s*gassata|bevanda\s*gassata|gassata)\b/.test(evidenceText);
  const ranked=candidates.map(c=>({candidate:c,score:scoreVisionCandidate(result,c)})).sort((a,b)=>b.score-a.score);
  let best=ranked[0];
  if(colaEvidence && best && (best.candidate.category==='water' || /acqua|water|minerale|naturale/.test(normalizeVisionText(best.candidate.name||'')))){
    best=ranked.find(x=>x.candidate.category==='soft_drinks' || /cola|bibita|gassata|pepsi|fanta|sprite/.test(normalizeVisionText([x.candidate.name,...(x.candidate.aliases||[])].join(' ')))) || null;
    result.productName=/\bblues\b/.test(evidenceText)?'Cola Blues':(result.productName||'Bibita tipo cola');
    if(/\bblues\b/.test(evidenceText)) result.brand='Blues';
    result.category='soft_drinks'; result.unit=result.unit&&result.unit!=='pz'?result.unit:'bt'; result.isLiquid=true;
  }
  if(best && best.score>=4.5){
    result.bestMatchName = best.candidate.name;
    result.bestMatchSource = best.candidate.source;
    result.bestMatchScore = best.score;
    if((!result.productName || result.productName.length<3 || result.confidence<0.78 || ['acqua','latte','pasta'].includes(normalizeVisionText(result.productName))) && best.candidate.name){
      result.productName = best.candidate.name;
    }
    if(!result.brand && best.candidate.brand) result.brand = best.candidate.brand;
    if(best.candidate.estimatedSize && (!result.estimatedSize || /da confermare|capienza/i.test(result.estimatedSize) || Number(result.sizeConfidence||0)<0.75)){
      result.estimatedSize = best.candidate.estimatedSize;
      result.sizeDetectedRaw = result.sizeDetectedRaw || 'memoria confermata utente';
      result.sizeConfidence = Math.max(Number(result.sizeConfidence||0), 0.82);
      result.detailQuestion = result.detailQuestion || 'Formato suggerito dalla memoria: conferma se corretto.';
    }
    if(!result.category || result.category==='food') result.category = best.candidate.category || result.category;
    result.confidence = Math.min(0.99, Math.max(result.confidence||0, 0.78 + Math.min(0.18,best.score/50)));
  }
  return result;
}
async function visionJsonCall(systemText, userText, image, opts={}){
  const maxTokens = Math.max(220, Math.min(900, Number(opts.maxTokens||650)));
  const payload={
    model:OPENAI_VISION_MODEL,
    max_output_tokens: maxTokens,
    input:[
      {role:'system',content:systemText},
      {role:'user',content:[{type:'input_text',text:userText},{type:'input_image',image_url:image}]}
    ]
  };
  const resp=await openAiResponse(payload);
  return extractJsonObject(outputText(resp));
}
function mergeVisionOutputs(primaryRaw, ocrRaw){
  const primary=normalizeVisionResult(primaryRaw||{});
  const ocr=normalizeVisionResult(ocrRaw||{});
  const merged=Object.assign({}, primary);
  const preferOcr = (!primary.productName || primary.confidence<0.8) && ocr.productName;
  if(preferOcr) merged.productName=ocr.productName;
  for(const f of ['brand','variant','estimatedSize','expiryDate','productType','packageType','damageType','sizeDetectedRaw','expiryDetectedRaw','detailQuestion']){ if(!merged[f] && ocr[f]) merged[f]=ocr[f]; }
  if(Number(ocr.sizeConfidence||0)>Number(primary.sizeConfidence||0)){ merged.estimatedSize=ocr.estimatedSize||merged.estimatedSize; merged.sizeDetectedRaw=ocr.sizeDetectedRaw||merged.sizeDetectedRaw; merged.sizeConfidence=ocr.sizeConfidence; }
  if(Number(ocr.expiryConfidence||0)>Number(primary.expiryConfidence||0)){ merged.expiryDate=ocr.expiryDate||merged.expiryDate; merged.expiryDetectedRaw=ocr.expiryDetectedRaw||merged.expiryDetectedRaw; merged.expiryConfidence=ocr.expiryConfidence; }
  if((!merged.category || merged.category==='food') && REAL_ALLOWED_CATEGORIES.has(ocr.category)) merged.category=ocr.category;
  if(!merged.isDamaged && ocr.isDamaged){ merged.isDamaged=true; merged.damageType=ocr.damageType||merged.damageType; }
  if(!merged.isLiquid && ocr.isLiquid) merged.isLiquid=true;
  if((!Number.isFinite(merged.quantity) || merged.quantity===1) && Number(ocr.quantity)>1) merged.quantity=ocr.quantity;
  if((!merged.unit || merged.unit==='pz') && ocr.unit) merged.unit=ocr.unit;
  merged.detectedText = uniqueStrings([...(primary.detectedText||[]), ...(ocr.detectedText||[]), ...(primary.visibleEvidence||[]), ...(ocr.visibleEvidence||[])], 10);
  merged.visibleEvidence = uniqueStrings([...(primary.visibleEvidence||[]), ...(ocr.visibleEvidence||[])], 8);
  merged.ingredients = uniqueStrings([...(primary.ingredients||[]), ...(ocr.ingredients||[])], 18);
  merged.allergens = uniqueStrings([...(primary.allergens||[]), ...(ocr.allergens||[])], 12);
  merged.possibleAllergens = uniqueStrings([...(primary.possibleAllergens||[]), ...(ocr.possibleAllergens||[])], 12);
  merged.colors = uniqueStrings([...(primary.colors||[]), ...(primary.dominantColors||[]), ...(ocr.colors||[]), ...(ocr.dominantColors||[])], 8);
  merged.nutrition = Object.assign({}, primary.nutrition||{}, ocr.nutrition||{});
  merged.ingredientsVerified = !!(primary.ingredientsVerified || ocr.ingredientsVerified || merged.ingredients.length);
  const agreeName = normalizeVisionText(primary.productName) && normalizeVisionText(primary.productName)===normalizeVisionText(ocr.productName);
  merged.confidence = Math.min(0.99, Math.max(primary.confidence||0, ocr.confidence||0, agreeName ? ((Math.max(primary.confidence||0,ocr.confidence||0))+0.06) : 0));
  if(merged.detectedText.length && merged.confidence<0.74) merged.confidence=Math.min(0.9, merged.confidence+0.05);
  merged.reason = primary.reason || ocr.reason || '';
  merged.shouldAskConfirmation = (primary.shouldAskConfirmation !== false) || (ocr.shouldAskConfirmation !== false);
  merged.needsManual = primary.needsManual || ocr.needsManual;
  merged.needsRetake = primary.needsRetake && ocr.needsRetake;
  if(Array.isArray(primary.items) && primary.items.length){
    merged.items = primary.items.map(it=>normalizeVisionResult(it));
  } else if(Array.isArray(ocr.items) && ocr.items.length){
    merged.items = ocr.items.map(it=>normalizeVisionResult(it));
  }
  if(Array.isArray(merged.items) && merged.items.length){ merged.multipleItems = merged.items.length>1; }
  return normalizeVisionResult(merged);
}

function isJunkVisionName(name=''){
  const n=normalizeVisionText(name).replace(/\s+/g,' ').trim();
  if(!n || n.length<3) return true;
  return /^(sto|ok|okay|si|no|conferma|prodotto|articolo|manual|live|manual live|auto live|foto|scatta|scatto|questo|questa|image|img|photo|camera|scanner|salta|salta ora|skip|dopo|non so|non lo so|nessuno|nessuna|avanti|procedi)$/.test(n) || /^(salta|skip|dopo|continua dopo|non so|non lo so|nessuno|nessuna)(\s+ora|\s+per ora)?$/.test(n) || /^\d+$/.test(n);
}
function canonicalVisionVolume(raw=''){
  const s=String(raw||'').toLowerCase().replace(',', '.').replace(/\s+/g,' ').trim();
  let m=s.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|litro|litri)\b/);
  if(m){ const l=Number(m[1]); if(Number.isFinite(l)&&l>0&&l<=10) return {text:(Number.isInteger(l)?String(l):String(l).replace('.',','))+' L', ml:Math.round(l*1000), raw:m[0], confidence:.93}; }
  m=s.match(/(\d{2,5})\s*(?:ml|millilitri|millilitro)\b/);
  if(m){ const ml=Number(m[1]); if(Number.isFinite(ml)&&ml>0&&ml<=10000){ return {text:(ml>=1000&&ml%500===0?(ml/1000).toString().replace('.',',')+' L':ml+' ml'), ml, raw:m[0], confidence:.92}; } }
  if(/due\s+litri|2\s*l|2l|2000\s*ml/.test(s)) return {text:'2 L', ml:2000, raw, confidence:.90};
  if(/un\s+litro\s+e\s+mezzo|uno\s+e\s+mezzo|litro\s+e\s+mezzo|1\.5\s*l|1\s*5\s*l|1500\s*ml/.test(s)) return {text:'1,5 L', ml:1500, raw, confidence:.88};
  if(/mezzo\s+litro|0\.5\s*l/.test(s)) return {text:'500 ml', ml:500, raw, confidence:.88};
  return null;
}
function extractVisionVolume(result={}){
  const sources=[result.estimatedSize,result.variant,result.productName,result.brand,result.productType,result.packageType,...(result.detectedText||[]),...(result.visibleEvidence||[])].filter(Boolean);
  for(const src of sources){ const v=canonicalVisionVolume(src); if(v) return v; }
  return null;
}
function canonicalVisionExpiry(raw=''){
  const text=String(raw||'').trim();
  let m=text.match(/(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})/);
  if(m){ let d=m[1].padStart(2,'0'), mo=m[2].padStart(2,'0'), y=m[3]; if(y.length===2) y='20'+y; return {text:`${d}/${mo}/${y}`, raw:m[0], confidence:.90}; }
  m=text.match(/(\d{1,2})[\/\-.\s](\d{2,4})/);
  if(m){ let mo=m[1].padStart(2,'0'), y=m[2]; if(y.length===2) y='20'+y; return {text:`${mo}/${y}`, raw:m[0], confidence:.72}; }
  return null;
}
function extractVisionExpiry(result={}){
  const sources=[result.expiryDate,result.expiryDetectedRaw,...(result.detectedText||[]),...(result.visibleEvidence||[])].filter(Boolean);
  for(const src of sources){ const e=canonicalVisionExpiry(src); if(e) return e; }
  return null;
}
function looksLikeBottleDrink(result={}){
  const n=normalizeVisionText([result.productName,result.brand,result.variant,result.productType,result.packageType,result.category,result.estimatedSize,...(result.detectedText||[]),...(result.visibleEvidence||[])].join(' '));
  return !!(result.isLiquid || result.category==='drinks' || /\b(acqua|bottiglia|bevanda|naturale|frizzante|vera|levissima|sant anna|rocchetta|lete|uliveto)\b/.test(n));
}
function sanitizeVisionDamage(result={}){
  const d=normalizeVisionText(result.damageType||'');
  const ev=normalizeVisionText([...(result.visibleEvidence||[]),...(result.detectedText||[])].join(' '));
  if(looksLikeBottleDrink(result) && /schiacciat|ammaccat|deformat/.test(d) && !/perdit|bucat|apert|rott|tappo rotto|liquido fuori/.test(d+' '+ev)){
    result.isDamaged=false;
    result.damageType='';
    result.detailQuestion=result.detailQuestion || 'La bottiglia può sembrare deformata dalla presa: conferma solo se è davvero danneggiata o perde.';
  }
  return result;
}
function enrichVisionDetails(result={}){
  if(isJunkVisionName(result.productName)){ result.productName=''; result.needsManual=true; result.shouldAskConfirmation=true; }
  const vol=extractVisionVolume(result);
  if(vol){
    result.estimatedSize=vol.text; result.sizeDetectedRaw=vol.raw; result.sizeConfidence=Math.max(Number(result.sizeConfidence||0), vol.confidence);
  } else if(looksLikeBottleDrink(result)){
    const n=normalizeVisionText([result.estimatedSize,...(result.visibleEvidence||[]),...(result.detectedText||[])].join(' '));
    if(/\b(grande|alta|large|famiglia|domestica|2 l|2l|2000)\b/.test(n)){ result.estimatedSize='2 L da confermare'; result.sizeConfidence=Math.max(Number(result.sizeConfidence||0),.62); }
    else if(/\b(piccola|small|500|mezzo litro)\b/.test(n)){ result.estimatedSize='500 ml da confermare'; result.sizeConfidence=Math.max(Number(result.sizeConfidence||0),.55); }
    else { result.estimatedSize=result.estimatedSize || 'Capienza da confermare'; result.sizeConfidence=Math.max(Number(result.sizeConfidence||0),.25); }
    result.needsManual=true; result.shouldAskConfirmation=true;
    result.detailQuestion=result.detailQuestion || 'Capienza non letta con certezza: mostra più vicino 2 L / 1,5 L / 500 ml oppure dimmela a voce.';
  }
  const exp=extractVisionExpiry(result);
  if(exp){ result.expiryDate=exp.text; result.expiryDetectedRaw=exp.raw; result.expiryConfidence=Math.max(Number(result.expiryConfidence||0), exp.confidence); }
  else if(!result.expiryDate){ result.expiryConfidence=Number(result.expiryConfidence||0); }
  sanitizeVisionDamage(result);
  return result;
}


function hasCentralConsumableEvidenceV2828(obj={}, result={}){
  const text=normalizeVisionText([
    obj.productName,obj.name,obj.product,obj.brand,obj.variant,obj.productType,obj.packageType,obj.objectType,obj.reason,
    result.productName,result.brand,result.variant,result.productType,result.packageType,result.category,
    ...(Array.isArray(obj.detectedText)?obj.detectedText:[]), ...(Array.isArray(obj.visibleEvidence)?obj.visibleEvidence:[]),
    ...(Array.isArray(result.detectedText)?result.detectedText:[]), ...(Array.isArray(result.visibleEvidence)?result.visibleEvidence:[])
  ].join(' '));
  return /\b(coca\s*cola|coca-cola|cola|pepsi|fanta|sprite|bibita|bevanda|acqua|latte|bottiglia|lattina|pesto|salsa|bbq|ketchup|maionese|sugo|condimento|olio|aceto|yogurt|kefir|detersivo|candeggina|shampoo|sapone|prodotto|etichetta|marca)\b/.test(text);
}
function repairCentralConsumableV2828(obj={}, result={}){
  if(!hasCentralConsumableEvidenceV2828(obj,result)) return result;
  const text=normalizeVisionText([obj.productName,obj.name,obj.product,obj.brand,obj.variant,obj.productType,obj.packageType,obj.reason,...(obj.detectedText||[]),...(obj.visibleEvidence||[]),result.productName,result.brand].join(' '));
  result.needsRetake=false;
  result.needsManual=true;
  result.shouldAskConfirmation=true;
  if(/\b(coca\s*cola|coca-cola)\b/.test(text)){
    result.productName=result.productName||'Coca-Cola';
    result.brand=result.brand||'Coca-Cola';
    result.category='soft_drinks';
    result.isLiquid=true;
    result.unit=result.unit&&result.unit!=='pz'?result.unit:'bt';
  }else if(/\bcola\b/.test(text)){
    result.productName=result.productName||'Cola';
    result.category='soft_drinks';
    result.isLiquid=true;
    result.unit=result.unit&&result.unit!=='pz'?result.unit:'bt';
  }
  if(!result.reason || /non idoneo|persona|sfondo|tavolo|piatto|pavimento/.test(normalizeVisionText(result.reason))){
    result.reason='Prodotto centrale rilevato: ignoro oggetti laterali e sfondo. Controlla e conferma i dati.';
  }
  return result;
}

function normalizeVisionResult(obj={}){
  const allowedCats=REAL_ALLOWED_CATEGORIES;
  const allowedUnits=new Set(['pz','pc','bt','lt','ml','kg','g','conf','pack','lattina','busta','scatola']);
  const result={
    needsRetake: !!obj.needsRetake,
    needsManual: !!obj.needsManual,
    reason: cleanVisionString(obj.reason, ''),
    productName: cleanVisionString(obj.productName || obj.name || obj.product || ''),
    brand: cleanVisionString(obj.brand || ''),
    variant: cleanVisionString(obj.variant || ''),
    quantity: Number(obj.quantity || obj.count || 1),
    unit: cleanVisionString(obj.unit || 'pz'),
    category: cleanVisionString(obj.category || 'food'),
    confidence: Math.max(0, Math.min(1, Number(obj.confidence ?? 0.1))),
    visibleEvidence: Array.isArray(obj.visibleEvidence) ? obj.visibleEvidence.map(x=>cleanVisionString(x)).filter(Boolean).slice(0,6) : [],
    expiryDate: cleanVisionString(obj.expiryDate || obj.expiry || obj.expirationDate || obj.expiration || obj.expiryText || ''),
    productType: cleanVisionString(obj.productType || obj.type || ''),
    packageType: cleanVisionString(obj.packageType || obj.shape || obj.container || ''),
    estimatedSize: cleanVisionString(obj.estimatedSize || obj.size || obj.sizeCandidate || obj.volume || ''),
    barcode: cleanVisionString(obj.barcode || obj.ean || obj.EAN || obj.code || obj.productCode || ''),
    sizeDetectedRaw: cleanVisionString(obj.sizeDetectedRaw || obj.sizeRaw || obj.volumeRaw || ''),
    sizeConfidence: Math.max(0, Math.min(1, Number(obj.sizeConfidence ?? obj.volumeConfidence ?? 0))),
    expiryDetectedRaw: cleanVisionString(obj.expiryDetectedRaw || obj.expiryRaw || obj.expirationRaw || obj.expiryText || ''),
    expiryConfidence: Math.max(0, Math.min(1, Number(obj.expiryConfidence ?? 0))),
    detailQuestion: cleanVisionString(obj.detailQuestion || obj.question || ''),
    detailScanNeeded: !!obj.detailScanNeeded,
    isLiquid: !!obj.isLiquid,
    isDamaged: !!obj.isDamaged,
    damageType: cleanVisionString(obj.damageType || ''),
    detectedText: Array.isArray(obj.detectedText) ? obj.detectedText.map(x=>cleanVisionString(x)).filter(Boolean).slice(0,8) : [],
    ingredients: cleanVisionArray(obj.ingredients || obj.ingredienti || [], 24),
    allergens: cleanVisionArray(obj.allergens || obj.allergeni || [], 18),
    possibleAllergens: cleanVisionArray(obj.possibleAllergens || obj.traces || obj.possibiliTracce || [], 18),
    colors: cleanVisionArray(obj.colors || obj.dominantColors || obj.coloriDominanti || [], 10),
    nutrition: (obj.nutrition && typeof obj.nutrition==='object') ? obj.nutrition : {},
    ingredientsVerified: !!obj.ingredientsVerified,
    bestMatchName: cleanVisionString(obj.bestMatchName || ''),
    bestMatchSource: cleanVisionString(obj.bestMatchSource || ''),
    bestMatchScore: Number(obj.bestMatchScore || 0),
    multipleItems: !!obj.multipleItems,
    shouldAskConfirmation: obj.shouldAskConfirmation !== false
  };
  if(Array.isArray(obj.items)){
    result.items=obj.items.slice(0,8).map(it=>normalizeVisionResult(Object.assign({},it,{items:undefined}))).filter(it=>!it.needsRetake || it.productName || it.reason);
    if(result.items.length) result.multipleItems = result.items.length>1;
  }
  const nonConsumableText=normalizeVisionText([obj.notConsumable?'notConsumable':'', obj.objectType||'', obj.reason||'', result.productName, result.category].join(' '));
  if(obj.notConsumable || /\b(cane|gatto|persona|volto|vestiti|pantaloni|maglia|telecomando|tv|televisore|schermo|mobile|sedia|tavolo|letto|scarpe|porta|pavimento|muro)\b/.test(nonConsumableText)){
    result.needsRetake=true;
    result.needsManual=false;
    result.shouldAskConfirmation=false;
    result.productName='';
    result.brand='';
    result.category='food';
    result.confidence=0;
    result.reason=result.reason || 'Oggetto non idoneo: non è un prodotto alimentare, casa, farmacia, animali o acquario.';
  }
  applyRealityCategoryServer(result);
  if(!Number.isFinite(result.quantity) || result.quantity<=0) result.quantity=1;
  if(!allowedCats.has(result.category)) result.category='food';
  if(!allowedUnits.has(result.unit)) result.unit='pz';
  if(result.productName && /^(image|img|foto|photo|screenshot|whatsapp|camera|pxl|dsc|dcim|\d{5,})/i.test(result.productName.replace(/\s+/g,''))) result.productName='';
  if(result.productName.length<2 && !result.needsRetake){ result.needsManual=true; result.shouldAskConfirmation=true; }
  enrichVisionDetails(result);
  if(result.confidence<0.72 && !result.needsRetake) result.shouldAskConfirmation=true;
  return result;
}


// V28.38 OCR heuristics: recupera formato/scadenza/barcode da detectedText/visibleEvidence
// quando il modello vede il testo ma non compila bene i campi strutturati.
function normalizeOcrDateV2838(s=''){
  const raw=String(s||'').trim();
  let m=raw.match(/\b(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})\b/);
  if(m){
    let d=m[1].padStart(2,'0'), mo=m[2].padStart(2,'0'), y=m[3];
    if(y.length===2) y=(Number(y)<50?'20':'19')+y;
    return `${d}/${mo}/${y}`;
  }
  m=raw.match(/\b(\d{1,2})[\.\/-](\d{2,4})\b/);
  if(m){ let mo=m[1].padStart(2,'0'), y=m[2]; if(y.length===2) y=(Number(y)<50?'20':'19')+y; return `${mo}/${y}`; }
  return '';
}
function applyOcrTextHeuristicsV2838(result={}, stage='auto'){
  try{
    const out=Object.assign({}, result||{});
    const parts=[out.productName,out.brand,out.variant,out.productType,out.packageType,out.estimatedSize,out.sizeDetectedRaw,out.expiryDetectedRaw,out.reason]
      .concat(Array.isArray(out.detectedText)?out.detectedText:[])
      .concat(Array.isArray(out.visibleEvidence)?out.visibleEvidence:[])
      .filter(Boolean).map(x=>String(x));
    const joined=parts.join(' | ');
    const lower=joined.toLowerCase();
    const sizeMatch=joined.match(/\b(\d{1,3}(?:[,.]\d{1,3})?)\s*(l|lt|litri|ml|cl|g|gr|kg)\b/i);
    if(sizeMatch && (!out.estimatedSize || /capienza|formato|confermare|non legg/i.test(String(out.estimatedSize)))){
      const n=sizeMatch[1].replace('.',',');
      let u=sizeMatch[2].toLowerCase();
      if(u==='litri'||u==='lt') u='L'; else if(u==='gr') u='g';
      else u = (u==='l'?'L':u);
      out.estimatedSize=`${n} ${u}`;
      out.sizeDetectedRaw=sizeMatch[0];
      out.sizeConfidence=Math.max(Number(out.sizeConfidence||0), .78);
    }
    const dateCandidate=(joined.match(/(?:scad|exp|tmc|entro|preferibilmente|lotto)?\s*\b\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}\b/i)||[])[0]
      || (joined.match(/(?:scad|exp|tmc|entro|preferibilmente)?\s*\b\d{1,2}[\.\/-]\d{2,4}\b/i)||[])[0] || '';
    const normDate=normalizeOcrDateV2838(dateCandidate);
    if(normDate && (!out.expiryDate || String(stage).toLowerCase()==='expiry')){
      out.expiryDate=normDate;
      out.expiryDetectedRaw=dateCandidate.trim();
      out.expiryConfidence=Math.max(Number(out.expiryConfidence||0), .74);
    }
    const codeCandidates=(joined.match(/(?:\d[\s\-\.]*){8,14}/g)||[])
      .map(x=>x.replace(/\D/g,''))
      .filter(x=>x.length>=8 && x.length<=14);
    if(codeCandidates.length && (!out.barcode || String(stage).toLowerCase()==='barcode')){
      out.barcode=codeCandidates.sort((a,b)=>b.length-a.length)[0];
      out.ean=out.ean||out.barcode;
    }
    if(/\b(acqua|naturale|minerale|oligominerale|sepina|vera|levissima|lete|sant\s*anna|uliveto|rocchetta)\b/i.test(joined)){
      if(!out.productName || /manual|prodotto|nome|salta|ora/i.test(String(out.productName))) out.productName='Acqua naturale';
      if(/sepina/i.test(joined) && !out.brand) out.brand='Sepina';
      out.category='water'; out.unit=out.unit||'bt'; out.isLiquid=true;
      out.confidence=Math.max(Number(out.confidence||0), .62);
      out.needsRetake=false; out.notConsumable=false;
    }
    if(/\b(coca\s*cola|coca-cola|cola|pepsi|fanta|sprite)\b/i.test(joined)){
      if(/coca/i.test(joined)){ out.productName=out.productName && !/manual|prodotto|nome|salta|ora/i.test(String(out.productName)) ? out.productName : 'Coca-Cola'; out.brand=out.brand||'Coca-Cola'; }
      out.category='soft_drinks'; out.unit=out.unit||'bt'; out.isLiquid=true;
      out.confidence=Math.max(Number(out.confidence||0), .66);
      out.needsRetake=false; out.notConsumable=false;
    }
    const extracted=[];
    if(out.estimatedSize) extracted.push('formato'); if(out.expiryDate) extracted.push('scadenza'); if(out.barcode) extracted.push('barcode');
    if(extracted.length){
      out.ocrHeuristicsV2838={extracted, stage:String(stage||'auto')};
      out.visibleEvidence=Array.isArray(out.visibleEvidence)?out.visibleEvidence:[];
      out.visibleEvidence.push(`OCR boost: ${extracted.join(', ')}`);
    }
    return out;
  }catch(_){ return result||{}; }
}

async function visionAnalyze({image,teacherImage='',fullImage='',teacherImageMeta=null,focusInstruction='',primarySubjectMode='',localGuess=null,catalog,settings,memory,stage='auto'}){
  if(!aiConnected()){
    return { needsManual:true, productName:'', quantity:1, unit:'pz', category:'food', confidence:.25, shouldAskConfirmation:true, cloudVision:false, cloudOffline:true, cloudError:'missing_openai_key', teacherInactive:true, teacherInactiveReason:'Docente OpenAI non attivo: chiave API mancante sul server.', reason:'Docente OpenAI non attivo: uso riconoscimento locale prudente.' };
  }
  const fullImageForServer = (fullImage && String(fullImage).startsWith('data:image/')) ? fullImage : image;
  const openAiTeacherImage = (teacherImage && String(teacherImage).startsWith('data:image/')) ? teacherImage : image;
  const teacherMeta = teacherImageMeta && typeof teacherImageMeta==='object' ? teacherImageMeta : null;
  const compact=(catalog||[]).map(i=>({id:i.id,name:itemName(i,settings?.lang||'it'),names:i.names,unit:i.unit,category:i.category,qty:i.qty})).slice(0,80);
  const learned=summarizeLearnedProducts(memory).slice(0,35);
  const candidates=buildVisionCandidatePool(catalog, settings, memory).slice(0,70);
  const oneShotPrompt=`Sei la Vision AI cloud di Spesa Pronta. Analizza la foto reale e rispondi SOLO con JSON valido.
OBIETTIVO: riconoscere prodotto, marca, formato/capienza, scadenza e stato con massima prudenza.
Regole severe anti-errore:
- PRIORITÀ SOGGETTO: se nella foto ci sono più oggetti, analizza SOLO il prodotto principale al centro dell'inquadratura o quello più grande/centrale. Ignora oggetti laterali, persone, piatti, tavolo, sfondo, mobili e prodotti secondari.
- Se al centro c'è una bottiglia/latta/confezione alimentare con etichetta leggibile, NON rispondere oggetto non idoneo solo perché nello sfondo c'è una persona, piatto, tavolo o un altro prodotto laterale.
- Se leggi testo centrale come Coca-Cola/Cola/Pepsi/Fanta/Sprite/acqua/latte, quello è il prodotto da analizzare; eventuali salse o oggetti laterali non devono influenzare nome, categoria o formato.
- Analizza SOLO prodotti idonei alla spesa/casa: alimentari, bevande, frutta/verdura, prodotti casa, farmacia, animali, acquario.
- Se vedi cane, gatto, persona, vestiti/pantaloni, telecomando, TV, mobili, pavimento, strumenti o oggetti non consumabili, NON creare un prodotto: rispondi con {"needsRetake":true,"notConsumable":true,"reason":"Oggetto non idoneo: aspetto un prodotto di consumo","productName":"","confidence":0}.
- NON inventare mai. Se non leggi un dettaglio, lascia il campo vuoto o scrivi "da confermare" e metti needsManual true.
- Il testo dell'etichetta vale più della forma e più della memoria.
- Per bottiglie/bevande devi distinguere capienza: 500 ml, 750 ml, 1 L, 1,5 L, 2 L, 2000 ml. Non mettere 500 ml se non lo leggi o se non sei certo che sia una bottiglia piccola.
- Se la bottiglia occupa gran parte dell'inquadratura ed è larga/alta, NON classificarla 500 ml: scegli '2 L da confermare' o '1,5 L / 2 L da confermare' e chiedi conferma.
- Cerca scadenze/TMC/EXP su etichetta, tappo, collo bottiglia, retro e base confezione. Se non leggibile, expiryDate vuota e detailQuestion chiara.
- Leggi anche ingredienti, allergeni, possibili tracce e valori nutrizionali se visibili. Se non sono leggibili non inventare: lascia array vuoti e metti needsManual true.
- Rileva colori dominanti e aspetto confezione per aiutare la memoria locale futura.
- Rileva danni veri: aperto, rotto, bucato, perdita, tappo rotto, etichetta illeggibile. Per bottiglie in plastica schiacciate dalla mano o naturalmente deformate, NON segnarle danneggiate: chiedi conferma.
- Non chiamare Coca-Cola se il rosso è solo sfondo: serve testo Coca-Cola o etichetta/prodotto centrale rosso.
- Scegli categoria con regole realtà precise, non a caso. Prima parole chiave etichetta/nome, poi forma confezione, poi memoria/web come supporto. Scegli categoria fra categorie reali: food, drinks, water, soft_drinks, juice, sports_energy_drinks, milk_drinks, coffee_tea, yogurt, dairy, eggs, pasta_rice, flour_baking, bakery, breakfast_cereals, breakfast_snacks, chocolate_sweets, spreads, jams_honey, sauces_condiments, oil_vinegar, spices_broths, preserves_jars, canned_fish_meat, legumes_canned, frozen, ice_cream, ready_meals, meat_deli, fish, fruit, veg, baby_food, diet_special, house, laundry, dishwashing, cleaning, paper_house, personal_care, oral_care, hair_body, pharmacy, pets, pet_food, aquarium. Usa drinks solo per bevande da bere; salsa/pesto/cioccolata/yogurt non devono diventare bevande solo perché sono in confezione o semiliquidi.
Schema JSON: {"needsRetake":boolean,"needsManual":boolean,"multipleItems":boolean,"shouldAskConfirmation":boolean,"reason":"breve in italiano","productName":"nome prodotto","brand":"marca","variant":"variante/gusto/formato","productType":"tipo prodotto","packageType":"tipo confezione","estimatedSize":"formato/capienza","sizeDetectedRaw":"testo volume letto","sizeConfidence":number,"expiryDate":"data visibile o vuota","expiryDetectedRaw":"testo data letto","expiryConfidence":number,"detailQuestion":"domanda se mancano capienza/scadenza/ingredienti","isLiquid":boolean,"isDamaged":boolean,"damageType":"tipo danno o vuota","quantity":number,"unit":"pz|bt|lattina|conf|kg|g|lt|ml|busta|scatola","category":"food|drinks|water|soft_drinks|juice|milk_drinks|yogurt|dairy|pasta_rice|bakery|breakfast_snacks|chocolate_sweets|spreads|sauces_condiments|preserves_jars|frozen|meat_deli|fish|fruit|veg|house|personal_care|pets|pharmacy|aquarium","confidence":number,"ingredients":["ingredienti letti o chiaramente dedotti dall etichetta"],"allergens":["allergeni evidenti o obbligatori letti"],"possibleAllergens":["possibili tracce lette"],"colors":["colori dominanti confezione"],"nutrition":{"kcal":"","proteine":"","carboidrati":"","grassi":""},"ingredientsVerified":boolean,"detectedText":["testi letti"],"visibleEvidence":["prove visive"],"items":[]}
Contesto utile, ma non deve sovrascrivere ciò che vedi nella foto:
Catalogo ridotto: ${JSON.stringify(compact).slice(0,12000)}
Prodotti imparati: ${JSON.stringify(learned).slice(0,9000)}
Candidati memoria: ${JSON.stringify(candidates).slice(0,9000)}`;
  const detailPrompt=`Sei OCR specialist di Spesa Pronta. Ignora lo sfondo e concentrati su etichetta, collo, tappo, retro e base del prodotto.
Leggi piccoli testi con attenzione: capienza/formato, scadenza/TMC/EXP, lotto, marca, variante. Se la data è sul tappo/collo e non leggibile, non inventare: chiedi scan ravvicinato della data.
Output SOLO JSON con gli stessi campi, includendo anche ingredients, allergens, possibleAllergens, colors e nutrition quando visibili. Regole:
- Per capienza cerca: 500 ml, 750 ml, 1 L, 1,5 L, 2 L, 2000 ml, cl, litri.
- Per scadenza cerca: dd/mm/yyyy, dd-mm-yyyy, dd/mm/yy, mm/yyyy, EXP, SCAD, TMC, da consumarsi entro/preferibilmente entro.
- Se un dato non è leggibile con sicurezza, non inventarlo e scrivi detailQuestion con istruzione pratica: avvicina, gira, inclina o mostra zona scadenza.
- detectedText deve contenere tutti i frammenti letti, anche incompleti.
- Se leggi una lista ingredienti o allergeni, copiala in forma sintetica negli array dedicati. Non inventare allergeni non visibili, salvo quelli evidenti dal nome del prodotto e marcali come possibili se non certi.
JSON: {"productName":"","brand":"","variant":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"ingredients":[],"allergens":[],"possibleAllergens":[],"colors":[],"nutrition":{},"ingredientsVerified":false,"detectedText":[],"visibleEvidence":[],"detailQuestion":"","needsManual":true,"shouldAskConfirmation":true,"confidence":0.1}`;
  const stageNameV2838=String(stage||'auto').toLowerCase();
  try{
    let primaryRaw=null, detailRaw=null;
    try{
      const stageName=stageNameV2838;
      if(stageName==='product'){
        const fastProductPrompt=`Analizza la foto prodotto. Rispondi SOLO JSON valido. PRIORITÀ: scegli il prodotto centrale/più grande, non oggetti laterali o sfondo. Se al centro c'è una bottiglia Coca-Cola/cola o altra confezione idonea, analizza quella e ignora persone/piatti/tavolo/salse laterali. Devi essere veloce: riconosci prodotto, marca, tipo, formato se leggibile e categoria reale. Non cercare di leggere tutta la tabella ingredienti se non è visibile. Se vedi cane, vestiti, telecomando, TV, mobili o oggetti non consumabili rispondi {"needsRetake":true,"notConsumable":true,"reason":"Oggetto non idoneo","productName":"","confidence":0}. Categoria: usa regole realtà professionali v27.96: scegli per prove dell etichetta, non per forma generica; confezione è solo indizio. Bevanda solo se è davvero da bere (acqua, cola, bibita gassata, succo, latte da bere). Se leggi Cola/Coca-Cola/Pepsi/Fanta/Sprite non classificarla come acqua: categoria soft_drinks, unit bt/lattina. Se leggi THE/THÉ/TÈ/ICE TEA/THÉ FUSION/PESCA/ROSA o Estathè è bevanda al tè: categoria juice, mai cola o bibite gassate solo per colore etichetta. Pesto/salsa/BBQ/ketchup/maionese/condimento = sauces_condiments; olio/aceto = oil_vinegar; yogurt/kefir = yogurt; cioccolata/dolci = chocolate_sweets; crema spalmabile = spreads; marmellata/miele = jams_honey; cibo animali = pet_food; bucato/piatti/pulizia/carta casa hanno categorie dedicate; barattolo/vasetto/bottiglia/flacone sono solo confezione, non categoria se il testo dice altro. Schema JSON: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","variant":"","productType":"","packageType":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"quantity":1,"unit":"pz","category":"food","confidence":0.1,"isLiquid":false,"isDamaged":false,"damageType":"","expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"barcode":"","detectedText":[],"visibleEvidence":[],"detailQuestion":"","reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. Analisi rapida prodotto.', fastProductPrompt, openAiTeacherImage, {maxTokens:520});
        detailRaw = null;
      }else if(stageName==='expiry'){
        const expiryPrompt=`OCR mirato SOLO scadenza V28.38. Rispondi SOLO JSON valido. Cerca date vicino a: SCAD, Scadenza, EXP, TMC, Da consumarsi entro, Preferibilmente entro, Lotto/L. Accetta formati dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, dd/mm/yy, mm/yyyy. Se vedi più date, scegli quella più vicina a SCAD/EXP/TMC; il lotto va in detectedText ma non in expiryDate. Non riscrivere nome/marca/categoria. detectedText deve contenere tutti i frammenti leggibili. Schema: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","estimatedSize":"","expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"detectedText":[],"visibleEvidence":[],"confidence":0.1,"category":"food","reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. OCR scadenza.', expiryPrompt, openAiTeacherImage, {maxTokens:340});
        detailRaw = null;
      }else if(stageName==='label'){
        const labelPrompt=`OCR mirato etichetta/ingredienti V28.38. Rispondi SOLO JSON valido e compatto. Concentrati SOLO sul prodotto principale e sulla sua etichetta, ignorando sfondo e oggetti vicini. Leggi con priorità: nome commerciale, marca/logo, variante/gusto, formato/capienza netta, categoria reale, ingredienti, allergeni, possibili tracce, barcode se visibile. detectedText deve contenere le righe/frammenti OCR letti anche se incompleti, senza inventare. Correggi solo errori OCR evidenti: O/0, I/1, l/1, S/5 quando serve per date, capienze e barcode. Se non sei sicuro lascia campo vuoto e spiega cosa rifotografare. Categoria: cola/bibita gassata solo con testo esplicito cola/coca/pepsi/fanta/sprite = soft_drinks; tè/thé/ice tea/the fusion = juice; acqua = water; latte = milk_drinks; yogurt/kefir = yogurt; pesto/salsa/BBQ/ketchup/maionese/sugo = sauces_condiments; crema spalmabile = spreads; olio/aceto = oil_vinegar; candeggina/detersivo/pulizia = cleaning/laundry/dishwashing. Schema: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","variant":"","productType":"","packageType":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"category":"food","ingredients":[],"allergens":[],"possibleAllergens":[],"barcode":"","detectedText":[],"visibleEvidence":[],"confidence":0.1,"reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. OCR etichetta low-cost.', labelPrompt, openAiTeacherImage, {maxTokens:620});
        detailRaw = null;
      }else if(stageName==='barcode'){
        const barcodePrompt=`OCR mirato SOLO codice a barre/EAN/UPC V28.38. Rispondi SOLO JSON valido. Cerca la sequenza numerica sotto o vicino al barcode: 8, 12, 13 o 14 cifre. Rimuovi spazi/trattini/punti e restituisci il codice completo in barcode/ean. Non inventare cifre mancanti. Se trovi testo prodotto collegato al barcode puoi proporre nome, marca, formato e categoria come miglioramento, ma non toccare ingredienti/scadenza. detectedText deve includere anche il numero grezzo letto. Schema: {"needsRetake":false,"needsManual":true,"barcode":"","ean":"","code":"","productCode":"","productName":"","brand":"","estimatedSize":"","category":"food","detectedText":[],"visibleEvidence":[],"confidence":0.1,"reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. OCR barcode.', barcodePrompt, openAiTeacherImage, {maxTokens:300});
        detailRaw = null;
      }else{
        // V28.03: anche in auto evito doppia chiamata pesante. Una sola analisi completa compatta.
        primaryRaw = await visionJsonCall('Rispondi solo con JSON valido. Analisi completa low-cost.', oneShotPrompt, openAiTeacherImage, {maxTokens:760});
        detailRaw = null;
      }
    }catch(firstErr){
      const shortPrompt=`Analizza la foto. Rispondi SOLO JSON. PRIORITÀ: prodotto centrale/più grande; ignora persone, piatti, tavolo, sfondo e oggetti laterali. Riconosci solo prodotti alimentari/casa/farmacia/animali/acquario. Se vedi cane, vestiti, telecomando, TV, mobili o oggetti non consumabili rispondi {"needsRetake":true,"notConsumable":true,"reason":"Oggetto non idoneo","productName":"","confidence":0}. Riconosci prodotto, marca, testo etichetta, capienza, categoria reale, scadenza, danni. Categoria: usa regole realtà professionali v27.96: scegli per prove dell etichetta, non per forma generica; confezione è solo indizio. Bevanda solo se è davvero da bere (acqua, cola, bibita gassata, succo, latte da bere). Se leggi Cola/Coca-Cola/Pepsi/Fanta/Sprite non classificarla come acqua: categoria soft_drinks, unit bt/lattina. Se leggi THE/THÉ/TÈ/ICE TEA/THÉ FUSION/PESCA/ROSA o Estathè è bevanda al tè: categoria juice, mai cola o bibite gassate solo per colore etichetta. Pesto/salsa/BBQ/ketchup/maionese/condimento = sauces_condiments; olio/aceto = oil_vinegar; yogurt/kefir = yogurt; cioccolata/dolci = chocolate_sweets; crema spalmabile = spreads; marmellata/miele = jams_honey; cibo animali = pet_food; bucato/piatti/pulizia/carta casa hanno categorie dedicate; barattolo/vasetto/bottiglia/flacone sono solo confezione, non categoria se il testo dice altro. Non inventare. Se capienza non leggibile lascia estimatedSize "Capienza da confermare". Se è bottiglia d'acqua, productName acqua naturale o acqua in bottiglia, category water, unit bt. Se è Cola/Blues/Pepsi/Fanta/Sprite, category soft_drinks, mai water. Schema: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","variant":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"quantity":1,"unit":"pz","category":"food","confidence":0.1,"isLiquid":false,"isDamaged":false,"damageType":"","expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"detectedText":[],"visibleEvidence":[],"detailQuestion":"","reason":""}`;
      primaryRaw = await visionJsonCall('Solo JSON valido.', shortPrompt, openAiTeacherImage, {maxTokens:560});
      detailRaw = null;
    }
    if(!primaryRaw && !detailRaw) throw new Error('empty_json_from_openai');
    let result=mergeVisionOutputs(primaryRaw||{}, detailRaw||{});
    result=applyVisionMatching(result, candidates);
    result=enrichVisionDetails(result);
    result=applyOcrTextHeuristicsV2838(result, stageNameV2838);
    result=repairCentralConsumableV2828(primaryRaw||{}, result);
    result.cloudVision=true;
    result.cloudOffline=false;
    result.cloudError='';
    if(!result.reason) result.reason='Cloud OpenAI ha analizzato la foto.';
    result.visionPipelineV2829={serverFullImage:true, openAiTeacherImage:!!teacherImage, teacherMeta, policy:'server_full_first_openai_slim_last'};
    return result;
  }catch(err){
    const classified=classifyOpenAiErrorV2836(err);
    const diag=openAiKeyDiagnosticV2836();
    lastOpenAiRuntimeV2836={ok:false,testedAt:Date.now(),model:lastOpenAiRuntimeV2836.model||OPENAI_VISION_MODEL,status:classified.code,message:classified.message,source:diag.source,maskedKey:diag.maskedKey,raw:String(err?.message||err||'').slice(0,500)};
    return {needsManual:true, shouldAskConfirmation:true, productName:'', quantity:1, unit:'pz', category:'food', confidence:.16, cloudVision:false, cloudOffline:true, cloudError:classified.code, cloudErrorMessage:classified.message, cloudFallback:true, teacherInactive:true, teacherInactiveReason:'Docente OpenAI non attivo: '+classified.message+'. Apri Diagnosi AI / OpenAI check per vedere la causa.', openAiDiagnostics:{keyConfigured:diag.configured,keySource:diag.source,maskedKey:diag.maskedKey,status:classified.code,message:classified.message}, reason:'Vision server/local-first attiva: controlla e completa i dati prima di salvare.'};
  }
}



// =============================================================
// V27.97 ULTRA ERROR REDUCTION CORE
// Obiettivo: abbassare al massimo la soglia di errore collegando
// categoria, barcode, memoria, docente, scadenza, ingredienti e sync.
// =============================================================
function ensureUltraBrainV97(){
  db.assistantBrain=db.assistantBrain||{};
  const b=db.assistantBrain.ultraBrainV97=db.assistantBrain.ultraBrainV97||{
    version:97,
    decisions:0,
    lowConfidence:0,
    rejectedMatches:0,
    teacherAvoided:0,
    teacherNeeded:0,
    barcodeFirst:0,
    expiryOnlyScans:0,
    fieldConfidenceStats:{},
    recurrentErrorRules:{},
    productTraining:{},
    last:[],
    updatedAt:0
  };
  b.fieldConfidenceStats=b.fieldConfidenceStats||{};
  b.recurrentErrorRules=b.recurrentErrorRules||{};
  b.productTraining=b.productTraining||{};
  b.last=Array.isArray(b.last)?b.last:[];
  return b;
}
function ultraTextServerV97(obj={}){
  return normalizeVisionText([
    obj.productName,obj.brand,obj.variant,obj.productType,obj.packageType,obj.category,obj.estimatedSize,obj.size,obj.unit,obj.barcode,obj.ean,
    ...(Array.isArray(obj.detectedText)?obj.detectedText:[]),
    ...(Array.isArray(obj.visibleEvidence)?obj.visibleEvidence:[]),
    ...(Array.isArray(obj.ingredients)?obj.ingredients:[]),
    ...(Array.isArray(obj.allergens)?obj.allergens:[]),
    ...(Array.isArray(obj.possibleAllergens)?obj.possibleAllergens:[]),
    ...(Array.isArray(obj.colors)?obj.colors:[])
  ].filter(Boolean).join(' '));
}
function ultraTokensV97(text=''){
  return [...new Set(normalizeVisionText(text).split(/\s+/).filter(t=>t.length>=2 && !/^(con|del|della|dello|delle|per|una|uno|the|and|prodotto|etichetta|marca|scadenza|formato|netto|ingredienti)$/.test(t)))];
}
const ULTRA_CATEGORY_RULES_V97=[
  {cat:'water',family:'bevande',physical:'liquid_drink',score:92,label:'acqua',rx:/\b(acqua|mineral[ea]|naturale|frizzante|oligominerale|levissima|vera|sant.anna|sangemini|rocchetta|lete|ferrarelle)\b/},
  {cat:'soft_drinks',family:'bevande',physical:'liquid_drink',score:96,label:'bibite gassate / cola',rx:/\b(cola|coca\s*cola|coca-cola|pepsi|fanta|sprite|aranciata|chinotto|cedrata|gassosa|bibita\s*gassata|blues\s*cola|cola\s*blues)\b/},
  {cat:'juice',family:'bevande',physical:'liquid_drink',score:108,label:'succhi e tè freddo',rx:/\b(succo|nettare|spremuta|smoothie|t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|estath[eè]|the\s*fusion|th[eè]\s*fusion|t[eè]\s*fusion|the\s*limone|the\s*pesca|th[eè]\s*pesca|t[eè]\s*pesca|bevanda\s+al\s+t[eè])\b/},
  {cat:'sports_energy_drinks',family:'bevande',physical:'liquid_drink',score:88,label:'energy/sport drink',rx:/\b(red\s*bull|monster\s*energy|energy\s*drink|burn\b|powerade|gatorade|isotonica|sport\s*drink|integratore\s*salino)\b/},
  {cat:'milk_drinks',family:'bevande',physical:'liquid_drink',score:78,label:'latte da bere',rx:/\b(latte\s*(intero|parzialmente|scremato|uht|fresco)|bevanda\s*(di|alla)\s*(soia|avena|mandorla|riso)|latte\s+senza\s+lattosio)\b/},
  {cat:'coffee_tea',family:'bevande',physical:'solid_or_powder',score:74,label:'caffè tè infusi',rx:/\b(caff[eè]|capsule|cialde|nespresso|lavazza|tisana|infuso|camomilla|t[eè]\s+caldo)\b/},
  {cat:'yogurt',family:'freschi',physical:'creamy_food',score:94,label:'yogurt/kefir/skyr',rx:/\b(yogurt|kefir|skyr|yomo|activia|greco\s*0|greco\s*2|drink\s*yogurt)\b/},
  {cat:'dairy',family:'freschi',physical:'solid_or_creamy_food',score:82,label:'latticini/formaggi',rx:/\b(formaggio|mozzarella|ricotta|stracchino|philadelphia|grana|parmigiano|pecorino|burro|panna|mascarpone|fiocchi\s+di\s+latte)\b/},
  {cat:'eggs',family:'freschi',physical:'solid_food',score:84,label:'uova',rx:/\b(uova|uovo|ovette|allevamento\s+a\s+terra|cat\s*a|cat\s*b)\b/},
  {cat:'pasta_rice',family:'dispensa',physical:'solid_food',score:86,label:'pasta/riso/cereali',rx:/\b(pasta|spaghetti|penne|fusilli|farfalle|riso|risotto|cous\s*cous|quinoa|orzo\b|farro\b)\b/},
  {cat:'flour_baking',family:'dispensa',physical:'powder',score:82,label:'farine/preparati',rx:/\b(farina|lievito|preparato\s+per|fecola|amido|semola|pan\s*grattato|pangrattato)\b/},
  {cat:'bakery',family:'forno',physical:'solid_food',score:78,label:'pane/forno',rx:/\b(pane|panini|piadina|focaccia|cracker|grissini|taralli|toast|tramezzini)\b/},
  {cat:'breakfast_cereals',family:'colazione',physical:'solid_food',score:74,label:'cereali colazione',rx:/\b(cereali|corn\s*flakes|muesli|granola|fiocchi\s+d.avena|avena)\b/},
  {cat:'breakfast_snacks',family:'colazione',physical:'solid_food',score:75,label:'colazione/snack',rx:/\b(biscotti|merendine|wafer|plumcake|croissant|cornetto|fette\s*biscottate|snack)\b/},
  {cat:'chocolate_sweets',family:'dolci',physical:'solid_or_creamy_food',score:92,label:'cioccolata/dolci',rx:/\b(cioccolat[ao]|cacao|tavoletta|praline|caramelle|gomme|torrone|dolci|fondente|nocciolato)\b/},
  {cat:'spreads',family:'dolci_condimenti',physical:'creamy_food',score:90,label:'creme spalmabili',rx:/\b(nutella|crema\s*spalmabile|crema\s+di\s*(pistacchio|nocciole|arachidi|mandorle)|burro\s+di\s+arachidi|spalmabile)\b/},
  {cat:'jams_honey',family:'dolci_condimenti',physical:'creamy_food',score:86,label:'marmellate/miele',rx:/\b(confettura|marmellata|composta|miele|sciroppo\s+d.acero)\b/},
  {cat:'sauces_condiments',family:'condimenti',physical:'creamy_or_liquid_food',score:97,label:'salse/condimenti',rx:/\b(pesto|pistacchi|pistacchio|salsa|bbq|barbecue|ketchup|maionese|senape|sugo|rag[uù]|condimento|besciamella|pat[eè]|hummus|guacamole|tahina|pesto\s+di\s+pistacchi)\b/},
  {cat:'oil_vinegar',family:'condimenti',physical:'liquid_food',score:88,label:'olio/aceto',rx:/\b(olio\s+(extra|extravergine|evo|di\s+semi|girasole|oliva)|aceto|balsamico|condimento\s+balsamico)\b/},
  {cat:'spices_broths',family:'condimenti',physical:'powder_or_solid_food',score:80,label:'spezie/sale/brodi',rx:/\b(sale|pepe|origano|paprika|curry|spezie|dado|brodo|insaporitore|zafferano|cannella|noce\s+moscata)\b/},
  {cat:'preserves_jars',family:'conserve',physical:'solid_or_liquid_food',score:72,label:'conserve/barattoli',rx:/\b(conserv[ae]|pelati|passata|pomodori\s+secchi|sott.olio|sottaceto|olive|carciofini|funghi\s+sott.olio)\b/},
  {cat:'canned_fish_meat',family:'conserve_proteiche',physical:'solid_food',score:86,label:'tonno/conserve proteiche',rx:/\b(tonno|sgombro|sardine|salmone\s+in\s+scatola|carne\s+in\s+scatola|simmenthal)\b/},
  {cat:'legumes_canned',family:'conserve',physical:'solid_food',score:82,label:'legumi/mais',rx:/\b(ceci|fagioli|lenticchie|piselli|mais|borlotti|cannellini)\b/},
  {cat:'frozen',family:'surgelati',physical:'frozen',score:88,label:'surgelati',rx:/\b(surgelat[oi]|congelat[oi]|frozen|pizza\s+surgelata|verdure\s+surgelate|bastoncini|spinaci\s+surgelati)\b/},
  {cat:'ice_cream',family:'surgelati',physical:'frozen',score:88,label:'gelati',rx:/\b(gelato|sorbetto|ghiacciolo|cornetto\s+algida|magnum)\b/},
  {cat:'ready_meals',family:'pronti',physical:'ready_meal',score:78,label:'piatti pronti',rx:/\b(piatto\s+pronto|pronto\s+in|lasagne|insalata\s+pronta|zuppe?\s+pronte|take\s*away)\b/},
  {cat:'meat_deli',family:'carne',physical:'solid_food',score:82,label:'carne/salumi',rx:/\b(prosciutto|salame|mortadella|bresaola|wurstel|salsiccia|pollo|hamburger|carne|tacchino|speck)\b/},
  {cat:'fish',family:'pesce',physical:'solid_food',score:78,label:'pesce',rx:/\b(pesce|salmone|merluzzo|orata|spigola|gamberi|tonno\s+fresco|calamari)\b/},
  {cat:'fruit',family:'ortofrutta',physical:'solid_food',score:72,label:'frutta',rx:/\b(mela|mele|banana|banane|arancia|arance|kiwi|fragole|uva|pera|pere|limone|limoni|frutta)\b/},
  {cat:'veg',family:'ortofrutta',physical:'solid_food',score:72,label:'verdura',rx:/\b(insalata|lattuga|pomodoro|pomodori|patate|carote|zucchine|melanzane|peperoni|verdura|ortaggi)\b/},
  {cat:'baby_food',family:'infanzia',physical:'baby',score:86,label:'infanzia',rx:/\b(omogeneizzato|infanzia|neonato|beb[eè]|latte\s+1|latte\s+2|pappa|plasmon)\b/},
  {cat:'diet_special',family:'speciali',physical:'special_food',score:76,label:'dietetici/senza glutine',rx:/\b(senza\s+glutine|gluten\s*free|proteico|protein|keto|light|zero\s+zuccheri|senza\s+lattosio)\b/},
  {cat:'laundry',family:'casa',physical:'house_chemical',score:92,label:'bucato',rx:/\b(detersivo\s+lavatrice|lavatrice|ammorbidente|bucato|caps\s+lavatrice|dash|ace\s+gentile|napisan\s+bucato)\b/},
  {cat:'dishwashing',family:'casa',physical:'house_chemical',score:90,label:'piatti/lavastoviglie',rx:/\b(piatti|lavastoviglie|finish|brillantante|sgrassatore\s+piatti|pastiglie\s+lavastoviglie)\b/},
  {cat:'cleaning',family:'casa',physical:'house_chemical',score:88,label:'pulizia casa',rx:/\b(detergente|sgrassatore|candeggina|disinfettante|pavimenti|bagno|superfici|anticalcare|spray\s+pulizia|pulizia)\b/},
  {cat:'paper_house',family:'casa',physical:'paper',score:82,label:'carta casa',rx:/\b(carta\s+igienica|scottex|rotoloni|tovaglioli|fazzoletti|carta\s+casa|asciugatutto)\b/},
  {cat:'oral_care',family:'igiene',physical:'personal_care',score:84,label:'igiene orale',rx:/\b(dentifricio|spazzolino|collutorio|filo\s+interdentale|oral\s*b)\b/},
  {cat:'hair_body',family:'igiene',physical:'personal_care',score:84,label:'capelli/corpo',rx:/\b(shampoo|balsamo|docciaschiuma|bagnoschiuma|sapone|deodorante|crema\s+corpo|gel\s+doccia)\b/},
  {cat:'pharmacy',family:'farmacia',physical:'health',score:82,label:'farmacia',rx:/\b(cerotti|farmaco|medicinale|tachipirina|oki|brufen|disinfettante\s+cute|garze|termometro|integratore)\b/},
  {cat:'pet_food',family:'animali',physical:'pet_food',score:90,label:'cibo animali',rx:/\b(crocchette|umido\s+cane|umido\s+gatto|monge|trainer|pedigree|whiskas|snack\s+cane|mangime\s+cane|mangime\s+gatto)\b/},
  {cat:'pets',family:'animali',physical:'pet_product',score:74,label:'animali',rx:/\b(lettiera|antiparassitario|collare|guinzaglio|seresto|scalibor|ciotola)\b/},
  {cat:'aquarium',family:'acquario',physical:'aquarium_product',score:88,label:'acquario',rx:/\b(acquario|mangime\s+pesci|biocondizionatore|batteri\s+acquario|test\s+no2|test\s+no3|fertilizzante\s+piante|co2|tetra\s+min)\b/}
];
const ULTRA_NON_ELIGIBLE_V97=/\b(cane|gatto|persona|volto|viso|mani|pantaloni|maglia|vestiti|scarpe|telecomando|tv|televisore|schermo|computer|telefono|mobile|sedia|tavolo|letto|porta|pavimento|muro|quadro|pianta\s+ornamentale)\b/;
function ultraPhysicalHintsV97(text=''){
  const n=normalizeVisionText(text); const hints=[];
  if(/\b(bottiglia|lattina|brick|tetra\s*pak|cartone\s+latte|bevanda|cola|acqua|succo|latte)\b/.test(n)) hints.push('liquid_container');
  if(/\b(vasetto|barattolo|squeeze|tubetto|crema|pesto|salsa|marmellata|miele|spalmabile)\b/.test(n)) hints.push('creamy_or_jar');
  if(/\b(busta|sacchetto|scatola|pacco|pasta|riso|biscotti|cereali|snack)\b/.test(n)) hints.push('solid_packaged');
  if(/\b(farina|polvere|preparato|cacao|lievito|spezie)\b/.test(n)) hints.push('powder');
  if(/\b(surgelat|congelat|gelato|freezer)\b/.test(n)) hints.push('frozen');
  if(/\b(flacone|spray|detergente|detersivo|shampoo|balsamo|sapone)\b/.test(n)) hints.push('chemical_or_personal_care');
  if(/\b(vetro)\b/.test(n)) hints.push('material_glass');
  if(/\b(plastica|pet)\b/.test(n)) hints.push('material_plastic');
  if(/\b(cartone|carta|tetra)\b/.test(n)) hints.push('material_cardboard');
  if(/\b(alluminio|lattina)\b/.test(n)) hints.push('material_metal');
  return [...new Set(hints)];
}
function ultraCategoryDecisionServerV97(result={}, fallback='food'){
  const text=ultraTextServerV97(result);
  const candidates=[];
  for(const r of ULTRA_CATEGORY_RULES_V97){
    if(r.rx.test(text)) candidates.push({category:r.cat, score:r.score, family:r.family, physicalState:r.physical, reason:r.label});
  }
  // Packaging is supportive only, never authoritative.
  const hints=ultraPhysicalHintsV97(text);
  if(hints.includes('liquid_container') && !candidates.some(c=>c.family==='bevande')) candidates.push({category:'drinks',score:32,family:'bevande',physicalState:'liquid_drink',reason:'contenitore liquido generico'});
  if(hints.includes('creamy_or_jar') && !candidates.some(c=>c.family==='condimenti'||c.category==='spreads'||c.category==='jams_honey')) candidates.push({category:'preserves_jars',score:28,family:'conserve',physicalState:'solid_or_liquid_food',reason:'vasetto/barattolo generico'});
  if(/\bcola\b/.test(text)) candidates.push({category:'soft_drinks',score:115,family:'bevande',physicalState:'liquid_drink',reason:'parola forte cola'});
  if(/\bpesto\b|pistacch/.test(text)) candidates.push({category:'sauces_condiments',score:112,family:'condimenti',physicalState:'creamy_or_liquid_food',reason:'parola forte pesto/pistacchio'});
  if(/\byogurt\b|\bkefir\b/.test(text)) candidates.push({category:'yogurt',score:112,family:'freschi',physicalState:'creamy_food',reason:'parola forte yogurt/kefir'});
  if(/\bdetersivo\b|\bsgrassatore\b|\bpulizia\b/.test(text)) candidates.push({category:'cleaning',score:108,family:'casa',physicalState:'house_chemical',reason:'parola forte prodotto pulizia'});
  if(!candidates.length) candidates.push({category:fallback||result.category||'food',score:20,family:productCategoryFamily(fallback||result.category||'food'),physicalState:'unknown',reason:'fallback prudente'});
  const grouped={};
  for(const c of candidates){
    const old=grouped[c.category];
    if(!old || c.score>old.score) grouped[c.category]=c;
  }
  const ranked=Object.values(grouped).sort((a,b)=>b.score-a.score).slice(0,5);
  const best=ranked[0]||{category:fallback||'food',score:0,physicalState:'unknown',reason:'nessuna prova'};
  const second=ranked[1]?.score||0;
  const gap=best.score-second;
  const confidence=Math.max(.18, Math.min(.99, (best.score/115) + Math.min(.15,gap/160)));
  return {version:97, category:best.category, score:best.score, confidence:Number(confidence.toFixed(2)), candidates:ranked, gap, physicalState:best.physicalState, packageHints:hints.filter(h=>!h.startsWith('material_')), materialHints:hints.filter(h=>h.startsWith('material_')).map(h=>h.replace('material_','')), reasons:ranked.map(r=>r.reason).filter(Boolean)};
}
function ultraNormalizeExpiryServerV97(raw=''){
  const s=String(raw||'').replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/[Ss]/g,'5').trim();
  let m=s.match(/\b(?:scad\.?|exp|tmc|entro|preferibilmente)?\s*(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})\b/i);
  if(m){ let d=m[1].padStart(2,'0'), mo=m[2].padStart(2,'0'), y=m[3]; if(y.length===2) y='20'+y; if(Number(mo)>=1&&Number(mo)<=12&&Number(d)>=1&&Number(d)<=31) return {text:`${d}/${mo}/${y}`,raw:s,confidence:.94,type:'day_month_year'}; }
  m=s.match(/\b(?:scad\.?|exp|tmc|entro|preferibilmente)?\s*(\d{1,2})[\/\-.\s](\d{2,4})\b/i);
  if(m){ let mo=m[1].padStart(2,'0'), y=m[2]; if(y.length===2) y='20'+y; if(Number(mo)>=1&&Number(mo)<=12) return {text:`${mo}/${y}`,raw:s,confidence:.88,type:'month_year'}; }
  const mesi={gennaio:'01',febbraio:'02',marzo:'03',aprile:'04',maggio:'05',giugno:'06',luglio:'07',agosto:'08',settembre:'09',ottobre:'10',novembre:'11',dicembre:'12',gen:'01',feb:'02',mar:'03',apr:'04',mag:'05',giu:'06',lug:'07',ago:'08',set:'09',ott:'10',nov:'11',dic:'12'};
  const n=normalizeVisionText(s); for(const [k,mo] of Object.entries(mesi)){ const r=new RegExp('\\b'+k+'\\s+(20\\d{2}|\\d{2})\\b'); const mm=n.match(r); if(mm){ let y=mm[1]; if(y.length===2)y='20'+y; return {text:`${mo}/${y}`,raw:s,confidence:.86,type:'text_month'}; } }
  return null;
}
function ultraExtractExpiryServerV97(result={}){
  const sources=[result.expiryDate,result.expiryDetectedRaw,...(Array.isArray(result.detectedText)?result.detectedText:[]),...(Array.isArray(result.visibleEvidence)?result.visibleEvidence:[])].filter(Boolean);
  let best=null;
  for(const x of sources){ const e=ultraNormalizeExpiryServerV97(x); if(e && (!best || e.confidence>best.confidence)) best=e; }
  return best;
}
function ultraExtractFormatServerV97(result={}){
  const text=ultraTextServerV97(result).replace(/[Oo](?=\d)|(?<=\d)[Oo]/g,'0').replace(/,/g,'.');
  const multi=text.match(/\b(\d{1,2})\s*[xX]\s*(\d+(?:\.\d+)?)\s*(kg|g|gr|grammi|l|lt|litri|ml|cl)\b/i);
  if(multi){ let u=multi[3].toLowerCase(); if(['gr','grammi'].includes(u))u='g'; if(['lt','litri'].includes(u))u='L'; return {format:`${multi[1]} x ${multi[2]} ${u}`,confidence:.95,source:'multi_pack'}; }
  const candidates=[];
  const rx=/\b(?:peso\s*netto|netto|contenuto|formato|quantit[aà]|volume)?\s*(\d+(?:\.\d+)?)\s*(kg|g|gr|grammi|l|lt|litri|ml|cl)\b/ig;
  let m; while((m=rx.exec(text))){ let u=m[2].toLowerCase(); if(['gr','grammi'].includes(u))u='g'; if(['lt','litri'].includes(u))u='L'; candidates.push({format:`${m[1]} ${u}`,confidence:/peso\s*netto|netto|contenuto|formato|volume/.test(m[0])?.92:.84,source:'label_format'}); }
  // Reject 0.5 L / 05 L when text looks creamy condiment and label has grams elsewhere.
  const condiment=/\b(pesto|salsa|bbq|maionese|ketchup|condimento|crema\s+di\s+pistacchio)\b/.test(text);
  if(condiment){
    const grams=candidates.find(c=>/\bg$|kg\b/.test(c.format));
    if(grams) return grams;
    const liters=candidates.find(c=>/\bL$|ml|cl/.test(c.format));
    if(liters) return Object.assign({},liters,{confidence:Math.min(liters.confidence,.55), needsConfirm:true});
  }
  return candidates.sort((a,b)=>b.confidence-a.confidence)[0]||null;
}
function ultraSeparateIngredientsAllergensServerV97(result={}){
  const text=[...(Array.isArray(result.detectedText)?result.detectedText:[]),...(Array.isArray(result.visibleEvidence)?result.visibleEvidence:[])].join(' | ');
  const norm=normalizeVisionText(text);
  const ingredients=new Set(Array.isArray(result.ingredients)?result.ingredients:[]);
  const allergens=new Set(Array.isArray(result.allergens)?result.allergens:[]);
  const traces=new Set([...(Array.isArray(result.possibleTraces)?result.possibleTraces:[]),...(Array.isArray(result.possibleAllergens)?result.possibleAllergens:[])]);
  const ing=text.match(/ingredienti?\s*[:\-]?\s*([^|]{8,520})/i); if(ing){ ing[1].split(/[,;]+/).map(x=>x.trim()).filter(x=>x.length>1).slice(0,60).forEach(x=>ingredients.add(x)); }
  const trace=text.match(/pu[oò]\s+contenere\s+([^|.]{3,260})/i); if(trace){ trace[1].split(/[,;]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>traces.add(x)); }
  const allergenBank=[['glutine',/\b(glutine|frumento|orzo|segale|avena)\b/],['latte',/\b(latte|lattosio|siero\s+di\s+latte|caseina)\b/],['uova',/\b(uova|uovo|albume)\b/],['soia',/\bsoia\b/],['arachidi',/arachid/],['frutta a guscio',/frutta\s+a\s+guscio|nocciole|mandorle|pistacchi|noci|anacardi/],['sesamo',/sesamo/],['senape',/senape/],['sedano',/sedano/],['pesce',/\bpesce\b/],['crostacei',/crostacei|gamber/],['molluschi',/molluschi/],['solfiti',/solfiti|anidride\s+solforosa/]];
  for(const [name,rx] of allergenBank){ if(rx.test(norm)){ if(/pu[oò]\s+contenere|tracce/.test(norm)) traces.add(name); else allergens.add(name); } }
  if(/\bpesto\b.*pistacch|pistacch.*\bpesto\b/.test(norm)) allergens.add('frutta a guscio');
  return {ingredients:[...ingredients].filter(Boolean).slice(0,80),allergens:[...allergens].filter(Boolean).slice(0,40),possibleTraces:[...traces].filter(Boolean).slice(0,40)};
}
function ultraFieldConfidenceServerV97(result={}, decision=null){
  const text=ultraTextServerV97(result); const n=normalizeVisionText(text);
  const fc=Object.assign({},result.fieldConfidence||{});
  const nonEmpty=v=>String(v||'').trim().length>1 && !/^(da confermare|possibile|generico|prodotto)$/i.test(String(v).trim());
  fc.productName=nonEmpty(result.productName)?(/\b(cola|pesto|salsa|yogurt|kefir|cioccolat|selex|blues|saper|sapori|barilla|mulino|rio\s+mare)\b/.test(n)?.96:.78):.18;
  fc.brand=nonEmpty(result.brand)?(/\b(selex|blues|saper|sapori|barilla|mulino|arborea|coca|pepsi|monge|finish|dash|rio\s+mare)\b/.test(n)?.94:.72):.16;
  fc.category=decision?.confidence||.42;
  fc.format=nonEmpty(result.estimatedSize||result.size)?(/\d+\s*(x\s*)?\d*\s*(g|kg|ml|l|lt|cl)\b/i.test(result.estimatedSize||result.size)?.92:.58):.16;
  fc.expiry=result.expiryDate?Math.max(Number(result.expiryConfidence||0),.82):.12;
  fc.barcode=(result.barcode||result.ean||'').length>=8?.99:.05;
  fc.ingredients=(result.ingredients||[]).length?((result.ingredientsVerified||/ingredienti/.test(n))?.9:.65):.15;
  fc.allergens=(result.allergens||[]).length?.82:((result.possibleTraces||[]).length?.62:.15);
  return fc;
}
function ultraApplyRealityV97(result={}, opts={}){
  if(!result || typeof result!=='object') return result;
  const text=ultraTextServerV97(result);
  if(ULTRA_NON_ELIGIBLE_V97.test(text) && !/\b(crocchette|mangime|snack\s+cane|cibo\s+cane|cibo\s+gatto)\b/.test(text)){
    Object.assign(result,{needsRetake:true,notConsumable:true,productName:'',brand:'',confidence:0,shouldAskConfirmation:false,reason:'Oggetto non idoneo: aspetto un prodotto alimentare, casa, farmacia, animali o acquario.'});
    return result;
  }
  const decision=ultraCategoryDecisionServerV97(result,result.category||'food');
  const oldCat=result.category||'';
  if(!oldCat || ['food','drinks','house','personal_care','pets'].includes(oldCat) || decision.confidence>=.62){ result.category=decision.category; }
  // Strong label rules override everything.
  if(/\b(t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|estath[eè]|the\s*fusion|th[eè]\s*fusion|t[eè]\s*fusion|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa)|bevanda\s+al\s+t[eè])\b/.test(text)){ result.category='juice'; result.isLiquid=true; result.unit=result.unit&&result.unit!=='pz'?result.unit:'bt'; if(!result.productName || /bibita|bevanda|cola|prodotto/i.test(String(result.productName))) result.productName='Tè freddo'; if(/\bblues\b/.test(text) && (!result.brand || /generico/i.test(String(result.brand)))) result.brand='Blues'; }
  if(/\b(blues\s*cola|cola\s*blues)\b/.test(text) && result.category!=='juice'){ result.productName=result.productName&&/cola/i.test(result.productName)?result.productName:'Cola Blues'; result.brand=result.brand&&/blues/i.test(result.brand)?result.brand:'Blues'; result.category='soft_drinks'; }
  if(/\bselex\b/.test(text) && /\b(bbq|barbecue|salsa)\b/.test(text)){ result.productName=/salsa/i.test(result.productName||'')?result.productName:'Salsa BBQ'; result.brand='Selex'; result.category='sauces_condiments'; }
  if(/\bpesto\b/.test(text) && /pistacch/.test(text)){ result.productName=/pesto/i.test(result.productName||'')?result.productName:'Pesto di Pistacchi'; if(/saper|sapori/.test(text)) result.brand='Saper di Sapori'; result.category='sauces_condiments'; }
  const barcode=monsterExtractBarcodeServerV96(result)||bestBarcodeFromConfirmed(result); if(barcode) result.barcode=barcode;
  const fmt=ultraExtractFormatServerV97(result); if(fmt && (!result.estimatedSize || Number(result.sizeConfidence||0)<fmt.confidence || /da confermare|possibile|05\s*l|0\.5\s*l/i.test(String(result.estimatedSize)))){ result.estimatedSize=fmt.format; result.size=fmt.format; result.sizeConfidence=fmt.confidence; result.sizeDetectedRaw=fmt.format; if(fmt.needsConfirm) result.sizeNeedsConfirmation=true; }
  const exp=ultraExtractExpiryServerV97(result); if(exp && (!result.expiryDate || exp.confidence>Number(result.expiryConfidence||0))){ result.expiryDate=exp.text; result.expiryDetectedRaw=exp.raw; result.expiryConfidence=exp.confidence; }
  const ia=ultraSeparateIngredientsAllergensServerV97(result); result.ingredients=ia.ingredients; result.allergens=ia.allergens; result.possibleTraces=ia.possibleTraces;
  result.categoryBrainV97=decision; result.ultraBrainV97={version:97,category:result.category,confidence:decision.confidence,score:decision.score,candidates:decision.candidates,physicalState:decision.physicalState,packageHints:decision.packageHints,materialHints:decision.materialHints,reasons:decision.reasons,priority:'label_current > barcode > user_confirmed > server_memory > web_teacher > visual_shape',antiContamination:true,storesPhotos:false};
  result.physicalState=decision.physicalState; result.packageHintsV97=decision.packageHints; result.materialHintsV97=decision.materialHints;
  result.fieldConfidence=ultraFieldConfidenceServerV97(result,decision);
  const minCore=Math.min(result.fieldConfidence.productName||0,result.fieldConfidence.category||0);
  result.ultraQualityV97={status:(result.barcode||minCore>=.8)?'strong':(minCore>=.58?'usable':'needs_more_evidence'),coreConfidence:Number(minCore.toFixed(2)),teacherPolicy:(result.barcode&&minCore>=.78)?'avoid_teacher_if_memory_confirmed':(minCore<.58?'teacher_or_better_label_needed':'teacher_only_on_conflict'),missingFields:['productName','brand','estimatedSize','expiryDate'].filter(f=>!result[f] && !(f==='estimatedSize'&&result.size)).slice(0,4)};
  if(result.ultraQualityV97.status==='needs_more_evidence'){ result.needsManual=true; result.shouldAskConfirmation=true; result.detailQuestion=result.detailQuestion||'Non sono abbastanza sicuro: fai una foto più leggibile dell’etichetta o correggi i campi prima di confermare.'; }
  try{ const b=ensureUltraBrainV97(); b.decisions++; if(result.ultraQualityV97.status==='needs_more_evidence') b.lowConfidence++; if(result.barcode) b.barcodeFirst++; b.last.unshift({at:Date.now(),productName:result.productName||'',brand:result.brand||'',category:result.category||'',status:result.ultraQualityV97.status,confidence:result.ultraQualityV97.coreConfidence,reasons:decision.reasons,candidates:decision.candidates?.slice(0,3)}); b.last=b.last.slice(0,80); b.updatedAt=Date.now(); }catch(_){ }
  return result;
}
function ultraIdentityConflictV97(a={},b={}){
  const ta=ultraTokensV97([a.productName,a.brand,a.category,a.format,a.size,(a.aliases||[]).join(' ')].join(' '));
  const tb=ultraTokensV97([b.productName,b.brand,b.category,b.format,b.size,(b.detectedText||[]).join(' '),(b.visibleEvidence||[]).join(' ')].join(' '));
  const A=new Set(ta), B=new Set(tb); const overlap=[...A].filter(x=>B.has(x));
  const strong=overlap.filter(x=>x.length>=4 && !/^(salsa|crema|vasetto|barattolo|bottiglia|prodotto|naturale)$/.test(x));
  const brandA=normalizeVisionText(a.brand||''), brandB=normalizeVisionText(b.brand||'');
  const nameA=normalizeVisionText(a.productName||''), nameB=normalizeVisionText(b.productName||'');
  if(a.barcode&&b.barcode&&a.barcode!==b.barcode) return {conflict:true,reason:'barcode diverso'};
  if(brandA&&brandB&&brandA!==brandB&&!brandA.includes(brandB)&&!brandB.includes(brandA)) return {conflict:true,reason:'marca diversa'};
  if(nameA&&nameB&&strong.length<2 && productCategoryFamily(a.category||'')!==productCategoryFamily(b.category||'')) return {conflict:true,reason:'nome/categoria non coerenti'};
  return {conflict:false,strongTokens:strong,overlap};
}
try{
  const __normalizeV96=normalizeVisionResult;
  normalizeVisionResult=function(obj){ return ultraApplyRealityV97(__normalizeV96(obj)); };
}catch(_){ }
try{
  const __visionAnalyzeV96=visionAnalyze;
  visionAnalyze=async function(args){
    const stage=String(args?.stage||'auto').toLowerCase();
    const result=await __visionAnalyzeV96(args);
    const out=ultraApplyRealityV97(result,{stage});
    if(/expiry|scadenza/.test(stage)){
      ensureUltraBrainV97().expiryOnlyScans++;
      const exp=ultraExtractExpiryServerV97(out);
      if(exp){ out.expiryDate=exp.text; out.expiryConfidence=exp.confidence; out.expiryDetectedRaw=exp.raw; out.detailQuestion='Scadenza letta: conferma se corretta.'; }
      out.expiryOnlyV97=true; // non usare questa foto per cambiare identità prodotto nel client
    }
    return out;
  };
}catch(_){ }
try{
  const __matchGlobalV96=matchGlobalProductMemory;
  matchGlobalProductMemory=function(query={}){
    const q=ultraApplyRealityV97(Object.assign({},query));
    const m=__matchGlobalV96(q)||__matchGlobalV96(query);
    if(!m?.product) return m;
    const conflict=ultraIdentityConflictV97(m.product,q);
    if(conflict.conflict && !(q.barcode && (m.product.barcodes||[]).includes(q.barcode))){
      ensureUltraBrainV97().rejectedMatches++;
      updateGlobalLearningAudit({type:'ultra-match-rejected-v97', reason:conflict.reason, query:{productName:q.productName,brand:q.brand,category:q.category,barcode:q.barcode||''}, match:{productName:m.product.productName,brand:m.product.brand,category:m.product.category,barcodes:m.product.barcodes||[]}});
      return null;
    }
    m.product.ultraMatchedV97=true; m.product.ultraMatchEvidence=conflict.strongTokens||[]; return m;
  };
}catch(_){ }
try{
  const __upsertGPMV96=upsertGlobalProductMemory;
  upsertGlobalProductMemory=function(confirmed={}){
    const c=ultraApplyRealityV97(Object.assign({},confirmed));
    const rec=__upsertGPMV96(c);
    try{
      const b=ensureUltraBrainV97();
      const key=productCanonicalKey(c.productName||'',c.brand||'')||normalizeVisionText([c.productName,c.brand,c.size].join(' '));
      if(key){
        const tr=b.productTraining[key]=b.productTraining[key]||{key,count:0,barcodes:[],categories:{},corrections:[],last:null,updatedAt:0};
        tr.count++; tr.categories=voteMapAdd(tr.categories||{},c.category||'');
        const bc=bestBarcodeFromConfirmed(c)||c.barcode||''; if(bc&&!tr.barcodes.includes(bc)) tr.barcodes.unshift(bc);
        if(c.userCorrections){ for(const [field,info] of Object.entries(c.userCorrections)){ if(info?.edited) tr.corrections.unshift({at:Date.now(),field,from:info.from||'',to:info.to||''}); } }
        tr.corrections=tr.corrections.slice(0,50); tr.last={productName:c.productName,brand:c.brand,category:c.category,quality:c.ultraQualityV97||null}; tr.updatedAt=Date.now();
      }
    }catch(_){ }
    return rec;
  };
}catch(_){ }



// =============================================================
// V27.98 Preflight Stability Check - server diagnostics
// =============================================================
function preflightSnapshotV98(){
  const gpm = publicGlobalProductMemory ? publicGlobalProductMemory(12) : {count:0,confirmations:0,products:[]};
  const queueInfo={serverQueue:false};
  const kCache=db.assistantBrain?.knowledgeCache||{};
  const keyDiag=openAiKeyDiagnosticV2836();
  const teacherUsable=openAiTeacherIsUsableV2836();
  const teacherMsg=openAiTeacherMessageV2836();
  const brain={version:'V28.39',name:'OpenAI Token Min Fix + Debug OpenAI Test',base:'Ultra Error Reduction Core V27.97 + Sync Handshake V27.99',categoryEngine:'ultra_error_reduction_core_v27_97', costGuardV2804:db.assistantBrain?.costGuardV2804||null,barcodePriority:'barcode > label > user correction > server memory > teacher',syncPolicy:'single item confirm + retry queue',testTools:'diagnostics_copy + server_sync_test + openai_live_check'};
  const checks=[
    {id:'openai_teacher',label:'Docente OpenAI',ok:teacherUsable,message:teacherMsg,diagnostics:keyDiag,lastRuntime:lastOpenAiRuntimeV2836},
    {id:'vision_backend',label:'Vision backend',ok:teacherUsable,message:teacherUsable?'Vision pronta dal backend':'Vision docente non disponibile: '+teacherMsg},
    {id:'database',label:'Database persistente',ok:dbMode!=='file',message:dbMode!=='file'?'Supabase/Postgres attivo':'Modalità file: memoria non persistente'},
    {id:'global_memory',label:'Memoria globale',ok:!!db.assistantBrain?.globalProductMemory,message:`${gpm.count||0} prodotti globali / ${gpm.confirmations||0} conferme`},
    {id:'barcode_brain',label:'Barcode brain',ok:!!db.assistantBrain?.barcodeBrain,message:`${(db.assistantBrain?.barcodeBrain?.barcodes||0)} barcode indicizzati`},
    {id:'knowledge_cache',label:'Knowledge cache',ok:!!db.assistantBrain?.knowledgeCache,message:`${Object.keys(kCache.entries||{}).length} cache / ${kCache.hits||0} hit`},
    {id:'error_learning',label:'Error learning',ok:!!db.assistantBrain?.errorLearning,message:`${(db.assistantBrain?.errorLearning?.corrections||[]).length} correzioni`}
  ];
  const ok=checks.filter(c=>c.ok).length;
  const status= ok===checks.length ? 'ready' : (ok>=4?'warn':'bad');
  return {ok:true,version:'V28.39',status,ready:status==='ready',brain,checks,teacherActive:teacherUsable,teacherConfigured:keyDiag.configured,teacherMessage:teacherMsg,openAiDiagnostics:keyDiag,lastOpenAiRuntime:lastOpenAiRuntimeV2836,dbMode,databaseConnected:dbMode!=='file',memoryReady:dbMode!=='file',globalProductMemory:gpm,knowledgeCache:{entries:Object.keys(kCache.entries||{}).length,hits:kCache.hits||0,barcodeHits:kCache.barcodeHits||0,updatedAt:kCache.updatedAt||0},barcodeBrain:db.assistantBrain?.barcodeBrain||null,errorLearning:{corrections:(db.assistantBrain?.errorLearning?.corrections||[]).length,patterns:Object.keys(db.assistantBrain?.errorLearning?.patterns||{}).length,updatedAt:db.assistantBrain?.errorLearning?.updatedAt||0},learningAudit:(db.assistantBrain.learningAudit||[]).slice(0,15),generatedAt:Date.now()};
}

const server = http.createServer(async (req,res)=>{
  if(req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;
  const body = await readBody(req);

  try {
    if((req.method === 'GET' || req.method === 'HEAD') && (pathName === '/debug.html' || pathName === '/debug' || pathName === '/debug/')){
      if(serveFileDirect(req,res,'debug.html')) return;
      return send(res,404,{error:'debug_page_missing',hint:'debug.html non trovato nel deploy'});
    }
    if((req.method === 'GET' || req.method === 'HEAD') && (pathName === '/server-brain.html' || pathName === '/server-brain' || pathName === '/brain' || pathName === '/brain/')){
      if(serveFileDirect(req,res,'server-brain.html')) return;
      return send(res,404,{error:'server_brain_page_missing',hint:'server-brain.html non trovato nel deploy'});
    }
    if((req.method === 'GET' || req.method === 'HEAD') && (pathName === '/clear-cache.html' || pathName === '/clear-cache' || pathName === '/clear-cache/')){
      if(serveFileDirect(req,res,'clear-cache.html')) return;
      return send(res,404,{error:'clear_cache_missing'});
    }
    if(req.method === 'GET' && pathName === '/api/health') return send(res, 200, { ok:true, service:'spesa-pronta-cloud', dbMode, dbConnected: dbMode !== 'file', time:new Date().toISOString() });

    if(req.method === 'GET' && pathName === '/api/db/status') {
      const users=Object.values(db.users||{});
      return send(res, 200, { ok:true, mode:dbMode, connected:dbMode !== 'file', users:users.length, verifiedUsers:users.filter(u=>u.emailVerified !== false && !u.emailVerifyTokenHash).length, pendingEmailUsers:users.filter(u=>u.emailVerified === false || u.emailVerifyTokenHash).length, households:Object.keys(db.households||{}).length });
    }





    if(req.method === 'POST' && (pathName === '/api/ai/test-sync' || pathName === '/ai/test-sync')){
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res,401,{ok:false,error:'unauthorized_household',message:'Account cloud non autorizzato'});
      const before=publicGlobalProductMemory(3);
      db.assistantBrain.diagnosticsTestSync=db.assistantBrain.diagnosticsTestSync||[];
      db.assistantBrain.diagnosticsTestSync.unshift({at:Date.now(),householdId,dbMode,globalCount:before.count||0,app:'v28.01-sync-hash-fix'});
      db.assistantBrain.diagnosticsTestSync=db.assistantBrain.diagnosticsTestSync.slice(0,40);
      await saveDb();
      return send(res,200,{ok:true,type:'test-sync',message:'Test sync riuscito: server, auth e database scrivono correttamente',dbMode,databaseConnected:dbMode!=='file',memoryReady:dbMode!=='file',globalProductMemory:before,generatedAt:Date.now()});
    }

    if((req.method === 'GET' || req.method === 'POST') && (pathName === '/api/ai/openai-check' || pathName === '/ai/openai-check')) {
      const result=await openAiHealthCheckV2836();
      return send(res, result.ok ? 200 : 200, Object.assign({type:'openai-check-v2837'}, result));
    }

    if(req.method === 'GET' && (pathName === '/api/ai/preflight' || pathName === '/ai/preflight')) {
      return send(res, 200, preflightSnapshotV98());
    }

    if(req.method === 'GET' && (pathName === '/api/ai/diagnostics' || pathName === '/ai/diagnostics')) {
      return send(res, 200, Object.assign(preflightSnapshotV98(), { diagnostics:{ learningAudit:(db.assistantBrain.learningAudit||[]).slice(0,120), globalProducts:publicGlobalProductMemory(30), knowledgeFeeder:db.assistantBrain.knowledgeFeeder||null, monsterBrainV96:db.assistantBrain.monsterBrainV96||null, ultraBrainV97:db.assistantBrain.ultraBrainV97||null } }));
    }

    if(req.method === 'POST' && (pathName === '/api/ai/server-brain/update' || pathName === '/ai/server-brain/update')) {
      const householdId=String(body.householdId||url.searchParams.get('householdId')||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res,401,{ok:false,error:'unauthorized_household',message:'Accesso negato: serve account cloud valido'});
      const ownerToken=String(process.env.SERVER_BRAIN_OWNER_TOKEN||process.env.ADMIN_TOKEN||'').trim();
      const providedOwnerToken=String(req.headers['x-owner-token']||body.ownerToken||url.searchParams.get('ownerToken')||'').trim();
      if(ownerToken && providedOwnerToken!==ownerToken) return send(res,403,{ok:false,error:'owner_token_required',message:'Modifica cervello bloccata: imposta/inserisci SERVER_BRAIN_OWNER_TOKEN'});
      const key=String(body.key||'').trim();
      const updates=(body.updates&&typeof body.updates==='object')?body.updates:{};
      const result=v2842UpdateOwnerOverride(key, updates, ownerToken?'server_owner':hashStable(String(householdId)).slice(0,12));
      if(!result.ok) return send(res,404,result);
      await saveDb();
      return send(res,200,result);
    }

    if(req.method === 'GET' && (pathName === '/api/ai/server-brain' || pathName === '/ai/server-brain')) {
      const householdId=String(url.searchParams.get('householdId')||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res,401,{ok:false,error:'unauthorized_household',message:'Accesso negato: serve account cloud valido per vedere il cervello server'});
      const limit=Number(url.searchParams.get('limit')||200);
      const q=String(url.searchParams.get('q')||'');
      return send(res,200,publicServerBrainV2840({limit,q}));
    }


    if(req.method === 'GET' && (pathName === '/api/ai/status' || pathName === '/ai/status')) {
      return send(res, 200, {
        ok:true,
        preflight:preflightSnapshotV98(),
        connected: openAiTeacherIsUsableV2836(),
        provider: openAiTeacherIsUsableV2836() ? 'openai' : 'local-fallback',
        model: OPENAI_MODEL,
        visionModel: OPENAI_VISION_MODEL,
        modelFallbacks: OPENAI_MODEL_FALLBACKS,
        visionReady: openAiTeacherIsUsableV2836(),
        teacherActive: openAiTeacherIsUsableV2836(),
        teacherConfigured: openAiKeyDiagnosticV2836().configured,
        teacherStatus: openAiTeacherIsUsableV2836() ? 'active' : 'inactive',
        teacherMessage: openAiTeacherMessageV2836(),
        openAiDiagnostics: openAiKeyDiagnosticV2836(),
        lastOpenAiRuntime: lastOpenAiRuntimeV2836,
        dbMode,
        databaseConnected: dbMode !== 'file',
        memoryReady: dbMode !== 'file',
        globalLearning: 'server_global_product_memory', globalProductMemory: publicGlobalProductMemory(10), knowledgeFeeder: db.assistantBrain.knowledgeFeeder||null, knowledgeCache:{entries:Object.keys(db.assistantBrain?.knowledgeCache?.entries||{}).length,hits:db.assistantBrain?.knowledgeCache?.hits||0,barcodeHits:db.assistantBrain?.knowledgeCache?.barcodeHits||0,updatedAt:db.assistantBrain?.knowledgeCache?.updatedAt||0}, barcodeBrain:db.assistantBrain?.barcodeBrain||null, categoryBrainV95:db.assistantBrain?.categoryBrainV95||null, monsterBrainV96:db.assistantBrain?.monsterBrainV96||null, ultraBrainV97:db.assistantBrain?.ultraBrainV97||null, errorLearning:{corrections:(db.assistantBrain?.errorLearning?.corrections||[]).length,patterns:Object.keys(db.assistantBrain?.errorLearning?.patterns||{}).length,updatedAt:db.assistantBrain?.errorLearning?.updatedAt||0}, learningQuality:{dedupe:'canonical_key_plus_barcode_conflict_guard', teacherBypass:'after_confirmations_barcode_and_field_confidence', knowledgeFeeder:'open_facts_family_with_barcode_and_cache_after_user_confirmation', storesPhotos:'lightweight_object_folder_photos_v2843_clearable_owner', storesVisualSignature:true, ownerOverridePriority:'server_owner_override_wins', categoryEngine:'ultra_error_reduction_core_v27_97', costGuardV2804:db.assistantBrain?.costGuardV2804||null, ultraErrorReduction:'active', preflightStability:'v28_04_cost_guard_pro', barcodePriority:'barcode > label > memory > teacher', fieldConfidence:'per_field_v97', visionPipelineV2829:'server_full_image_openai_slim_teacher_barcode_step_v2830'},
        smsReady: PHONE_VERIFY_READY,
        seedMemory:{version:VISION_SEED_MEMORY.version||'', products:(VISION_SEED_MEMORY.products||[]).length, totalProfiles:Number(VISION_MEGA_INDEX.totalProfiles||1000000), megaVersion:VISION_MEGA_INDEX.version||'', categories:(VISION_SEED_MEMORY.categories||[]).length, loaded:(VISION_SEED_MEMORY.products||[]).length>0},
        twilioVerifyReady: TWILIO_VERIFY_ENABLED,
        smsFromNumberReady: SMS_ENABLED,
        whatsappReady: WHATSAPP_ENABLED,
        note: openAiTeacherIsUsableV2836() ? 'AI Chat + Vision attive dal backend' : openAiTeacherMessageV2836()
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


    if(req.method === 'POST' && pathName === '/api/auth/delete-account'){
      const householdId=String(body.householdId||'').trim();
      const providedToken=String(body.token||'').trim() || String((req.headers.authorization||'').replace(/^Bearer\s+/i,'')).trim();
      const email=normalizeEmail(body.email||'');
      if(!householdId || !providedToken) return send(res, 400, { error:'missing_credentials' });
      const household=db.households?.[householdId];
      if(!household || String(household.token||'')!==providedToken) return send(res, 403, { error:'not_authorized' });
      const user=db.users?.[household.ownerUserId];
      if(!user) return send(res, 404, { error:'user_not_found' });
      if(email && normalizeEmail(user.email)!==email) return send(res, 400, { error:'email_mismatch' });
      delete db.households[householdId];
      delete db.users[user.id];
      await saveDb();
      return send(res, 200, { ok:true, deleted:true });
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


    if(req.method === 'POST' && pathName === '/api/auth/change-pending-email'){
      const oldEmail=normalizeEmail(body.oldEmail);
      const newEmail=normalizeEmail(body.newEmail);
      if(!oldEmail || !newEmail) return send(res, 400, { error:'missing_fields' });
      if(!isValidEmail(newEmail)) return send(res, 400, { error:'invalid_email' });
      const user=Object.values(db.users||{}).find(u=>normalizeEmail(u.email)===oldEmail && (u.emailVerified === false || u.emailVerifyTokenHash));
      if(!user) return send(res, 404, { error:'pending_user_not_found' });
      const duplicate=Object.values(db.users||{}).find(u=>u.id!==user.id && normalizeEmail(u.email)===newEmail);
      if(duplicate) return send(res, 409, { error:'email_exists' });
      const raw=token();
      user.email=newEmail;
      user.emailVerified=false;
      user.emailVerifyTokenHash=tokenHash(raw);
      user.emailVerifyTokenExpiresAt=Date.now()+24*60*60*1000;
      user.emailVerifySentAt=Date.now();
      await saveDb();
      sendVerificationEmail(user, raw);
      return send(res, 200, { ok:true, requiresEmailVerification:true, requiresPhoneVerification:user.phoneVerified!==true, email:newEmail, phoneMasked:maskPhone(user.phone||'') });
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


    if(req.method === 'POST' && pathName === '/api/ai/category-lookup'){
      const {productName='',brand='',variant='',productType='',packageType='',currentCategory='',detectedText=[],visibleEvidence=[]}=body;
      const result=await internetCategoryLookupServer({productName,brand,variant,productType,packageType,currentCategory,detectedText,visibleEvidence});
      return send(res,200,{ok:true,...result});
    }

    if(req.method === 'POST' && pathName === '/api/ai/vision'){
      const { image='', teacherImage='', teacherImageMeta=null, focusInstruction='', primarySubjectMode='', localGuess=null, catalog=[], settings={}, memory={}, stage='auto' } = body;
      if(!image || !String(image).startsWith('data:image/')) return send(res, 400, { error:'image_required' });
      let h=null;
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      if(householdId && db.households[householdId] && db.households[householdId].token===bearer) h=db.households[householdId];
      const activeMemory=h ? ensureHouseholdMemory(h) : memory;
      const result = await visionAnalyze({image:teacherImage&&String(teacherImage).startsWith('data:image/')?teacherImage:image, teacherImage, fullImage:image, teacherImageMeta, focusInstruction, primarySubjectMode, localGuess, catalog:h?(h.items||[]):catalog,settings:h?(h.settings||{}):settings,memory:activeMemory,stage});
      result.cloudVision = !!result.cloudVision && !result.cloudError;
      result.cloudOffline = !result.cloudVision;
      result.cloudFallback = false;
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


    if(req.method === 'POST' && (pathName === '/api/ai/learn/autonomy' || pathName === '/ai/learn/autonomy')){
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res, 401, {ok:false,error:'unauthorized_household'});
      try{
        const mem=await learnAutonomyOnServer(h, body.payload||{});
        await saveDb();
        return send(res, 200, {ok:true, saved:true, syncConfirmed:true, memory:mem, status:autonomyStatusFor(h), audit:(body.payload||{}).learningAudit||null, knowledgeFeeder:(body.payload||{}).confirmed?.knowledgeFeeder||null, globalProductMemory:publicGlobalProductMemory(10), persistent:true});
      }catch(syncErr){
        console.error('learn/autonomy failed', syncErr);
        updateGlobalLearningAudit({type:'learn-autonomy-server-error', productName:body.payload?.confirmed?.productName||'', brand:body.payload?.confirmed?.brand||'', reason:String(syncErr?.message||syncErr).slice(0,180)});
        return send(res, 500, {ok:false,error:'learn_autonomy_failed', reason:String(syncErr?.message||syncErr).slice(0,180)});
      }
    }

    if(req.method === 'GET' && pathName === '/api/ai/learning-status'){
      const householdId=String(url.searchParams.get('householdId')||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res, 401, {ok:false,error:'unauthorized_household'});
      return send(res, 200, {ok:true,status:autonomyStatusFor(h),memory:ensureHouseholdMemory(h)});
    }



    if(req.method === 'POST' && (pathName === '/api/ai/product-knowledge/lookup' || pathName === '/ai/product-knowledge/lookup')){
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res, 401, {ok:false,error:'unauthorized_household'});
      const lookup=await enrichConfirmedProductWithKnowledge(body.confirmed||body||{});
      await saveDb();
      return send(res,200,{ok:true, confirmed:lookup.confirmed, knowledge:lookup.knowledge, skipped:!!lookup.skipped, knowledgeFeeder:lookup.confirmed?.knowledgeFeeder||null});
    }

    if(req.method === 'POST' && (pathName === '/api/ai/global-products/match' || pathName === '/ai/global-products/match')){
      const match=matchGlobalProductMemory(body||{});
      return send(res,200,{ok:true, match:match?.product||null, score:match?.score||0, globalProductMemory:publicGlobalProductMemory(10)});
    }

    if(req.method === 'GET' && (pathName === '/api/ai/global-memory' || pathName === '/ai/global-memory')){
      return send(res, 200, { ok:true, globalExperience: publicGlobalBrain(), privacy:'aggregated_anonymous_only' });
    }

    if(req.method === 'GET' && pathName === '/api/ai/monster-brain'){
      return send(res, 200, { ok:true, monsterBrainV96: ensureMonsterBrainV96(), globalProductMemory: publicGlobalProductMemory(20), learningAudit:(db.assistantBrain.learningAudit||[]).slice(0,50) });
    }

    if(req.method === 'GET' && pathName === '/api/ai/ultra-brain'){
      return send(res, 200, { ok:true, ultraBrainV97: ensureUltraBrainV97(), monsterBrainV96: ensureMonsterBrainV96(), globalProductMemory: publicGlobalProductMemory(25), learningAudit:(db.assistantBrain.learningAudit||[]).slice(0,80), policy:'barcode+label authority, category multi-score, user correction strong learning' });
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


// =============================================================
// V28.03 SERVER LOW COST + CATEGORY ACCURACY
// Il server usa una tassonomia severa prima di memoria/web/docente.
// =============================================================
function serverV2803Evidence(result={}){
  return [result.productName,result.brand,result.variant,result.productType,result.packageType,result.category,result.estimatedSize,result.sizeDetectedRaw,result.unit,...(result.detectedText||[]),...(result.visibleEvidence||[])].filter(Boolean).join(' ');
}
function serverV2803Category(result={}){
  const n=normalizeVisionText(serverV2803Evidence(result));
  const score={}; const why={};
  const add=(cat,pts,label)=>{ score[cat]=(score[cat]||0)+pts; (why[cat]=why[cat]||[]).push(label); };
  const has=(rx)=>rx.test(n);
  if(has(/\b(cane|gatto vivo|persona|pantaloni|maglia|telecomando|tv|mobile|pavimento|divano|scarpe)\b/)) add('non_consumable',200,'non idoneo');
  if(has(/\b(coca\s*cola|coca-cola|cola\b|blues\s*cola|cola\s*blues|pepsi|fanta|sprite|aranciata|chinotto|gassosa|cedrata|bibita\s*gassata|bevanda\s*gassata)\b/)) add('soft_drinks',140,'bibita gassata');
  if(has(/\b(acqua|minerale|oligominerale|naturale|frizzante|levissima|sant\s*anna|san\s*benedetto|vera|lete|ferrarelle|uliveto|rocchetta)\b/)) add('water',95,'acqua');
  if(has(/\b(succo|nettare|spremuta|estath[eè]|t[eè]\s*freddo|the\s*freddo|th[eè]\s*freddo|ice\s*tea|ice\s*the|the\s*fusion|th[eè]\s*fusion|the\s*(pesca|limone|rosa)|th[eè]\s*(pesca|limone|rosa)|bevanda\s+al\s+t[eè])\b/)) add('juice',155,'succo/tè freddo');
  if(has(/\b(red\s*bull|monster|energy\s*drink|powerade|gatorade|isotonica)\b/)) add('sports_energy_drinks',120,'energy/sport drink');
  if(has(/\b(latte\s*uht|latte\s+parzialmente|latte\s+scremato|latte\s+intero|bevanda\s+al\s+latte|latte\s+di\s+(soia|avena|mandorla|riso))\b/)) add('milk_drinks',115,'latte/bevanda latte');
  if(has(/\b(yogurt|yoghurt|kefir|skyr|ayo\s*kefir)\b/)) add('yogurt',135,'yogurt/kefir');
  if(has(/\b(pesto|salsa|bbq|barbecue|ketchup|maionese|senape|condimento|sugo|passata|rag[uù]|besciamella|hummus)\b/)) add('sauces_condiments',135,'salsa/condimento');
  if(has(/\b(olio|extra\s+vergine|aceto|balsamico)\b/)) add('oil_vinegar',120,'olio/aceto');
  if(has(/\b(nutella|crema\s+spalmabile|crema\s+(al\s+)?pistacchio|crema\s+nocciole|burro\s+d\s*arachidi|spalmabile)\b/)) add('spreads',125,'crema spalmabile');
  if(has(/\b(marmellata|confettura|miele)\b/)) add('jams_honey',110,'marmellata/miele');
  if(has(/\b(cioccolat|cacao|tavoletta|caramell|merendina|biscott|wafer|dolc)\b/)) add('chocolate_sweets',95,'dolci/cioccolata');
  if(has(/\b(formaggio|mozzarella|ricotta|burro|panna|parmigiano|grana|mascarpone|stracchino|latticini)\b/)) add('dairy',105,'latticini');
  if(has(/\b(pasta|spaghetti|penne|fusilli|rigatoni|riso|cous\s*cous|gnocchi|lasagne)\b/)) add('pasta_rice',100,'pasta/riso');
  if(has(/\b(candeggina|sgrassatore|disinfettante\s+casa|detergente\s+superfici|pavimenti|bagno|wc|pulizia|dexal|ace|chanteclair)\b/)) add('cleaning',150,'pulizia casa');
  if(has(/\b(detersivo\s+lavatrice|lavatrice|ammorbidente|bucato|dash|perlana|candeggina\s+delicata)\b/)) add('laundry',150,'bucato');
  if(has(/\b(detersivo\s+piatti|lavastoviglie|brillantante|finish|pril|svelto)\b/)) add('dishwashing',145,'piatti/lavastoviglie');
  if(has(/\b(scottex|carta\s+igienica|rotoloni|tovaglioli|carta\s+casa|fazzoletti)\b/)) add('paper_house',120,'carta casa');
  if(has(/\b(shampoo|bagnoschiuma|deodorante|dentifricio|spazzolino|collutorio|sapone)\b/)) add(has(/dentifricio|spazzolino|collutorio/)?'oral_care':'hair_body',115,'igiene');
  if(has(/\b(farmaco|medicina|integratore|cerotti|tachipirina|oki|brufen|paracetamolo|ibuprofene|garze)\b/)) add('pharmacy',140,'farmacia');
  if(has(/\b(crocchette|umido\s+cane|umido\s+gatto|monge|royal\s*canin|purina|whiskas|felix|mangime\s+(cane|gatto))\b/)) add('pet_food',130,'cibo animali');
  if(has(/\b(acquario|mangime\s+pesci|biocondizionatore|batteri\s+acquario|askoll|sera|tetra)\b/)) add('aquarium',130,'acquario');
  if((score.juice||0)>100){ score.soft_drinks=0; score.water=0; }
  if((score.soft_drinks||0)>90) score.water=0;
  if((score.sauces_condiments||0)>90) ['water','drinks','soft_drinks','milk_drinks'].forEach(c=>score[c]=0);
  if((score.cleaning||0)>90 || (score.laundry||0)>90 || (score.dishwashing||0)>90) ['food','drinks','water','soft_drinks','juice','milk_drinks','yogurt','dairy'].forEach(c=>score[c]=0);
  const ranked=Object.entries(score).filter(([,s])=>s>0).sort((a,b)=>b[1]-a[1]);
  const best=ranked[0]?.[0]||result.category||'food'; const bestScore=ranked[0]?.[1]||0; const second=ranked[1]?.[1]||0;
  return {category:best, score:bestScore, gap:bestScore-second, confidence:bestScore>=120?.98:bestScore>=90?.94:bestScore>=65?.84:bestScore>=40?.68:.45, reasons:why[best]||[], candidates:ranked.slice(0,5).map(([category,score])=>({category,score,reasons:why[category]||[]})), source:'server_v28_03'};
}
try{
  if(typeof applyRealityCategoryServer==='function' && !global.__serverV2803CategoryWrapped){
    const __applyRealityCategoryServer=applyRealityCategoryServer;
    applyRealityCategoryServer=function(result={}){
      __applyRealityCategoryServer(result);
      const d=serverV2803Category(result);
      const old=result.category||'';
      if(d.category && (d.confidence>=.68 || !old || ['food','drinks','house'].includes(old))) result.category=d.category;
      result.categoryBrainV2803=d;
      result.categoryRuleSource='server_v28_03_low_cost_category_accuracy';
      if(old && old!==result.category) result.categoryGuardNote=`Categoria server V28.03: ${old} -> ${result.category}`;
      return result;
    };
    global.__serverV2803CategoryWrapped=true;
  }
}catch(_){ }


// =============================================================
// V28.04 COST GUARD PRO - server side
// Riduce prompt/token e tiene statistiche costi del docente.
// =============================================================
function ensureCostGuardV2804(){
  db.assistantBrain=db.assistantBrain||{};
  const c=db.assistantBrain.costGuardV2804=db.assistantBrain.costGuardV2804||{version:'V28.04',teacherCalls:0,lowCostCalls:0,blockedByCache:0,promptTrimmed:0,tokensSavedEstimate:0,last:[],updatedAt:0};
  c.last=Array.isArray(c.last)?c.last:[]; return c;
}
function recordCostGuardV2804(event={}){
  try{ const c=ensureCostGuardV2804(); c.last.unshift(Object.assign({at:Date.now()},event)); c.last=c.last.slice(0,80); c.updatedAt=Date.now(); }catch(_){ }
}
function trimVisionPromptV2804(userText=''){
  let txt=String(userText||''); const before=txt.length;
  // I blocchi catalogo/memoria sono utili ma enormi: in low-cost li sostituiamo con istruzioni compatte.
  txt=txt.replace(/Catalogo ridotto:\s*[\s\S]*?Prodotti imparati:/i,'Catalogo ridotto: []\nProdotti imparati:');
  txt=txt.replace(/Prodotti imparati:\s*[\s\S]*?Candidati memoria:/i,'Prodotti imparati: []\nCandidati memoria:');
  txt=txt.replace(/Candidati memoria:\s*[\s\S]*$/i,'Candidati memoria: []');
  // taglio di sicurezza: Vision deve ragionare dalla foto, non bruciare token su contesto gigante.
  if(txt.length>4200) txt=txt.slice(0,4200)+'\nRispondi SOLO JSON compatto.';
  const saved=Math.max(0,before-txt.length);
  if(saved>0){ const c=ensureCostGuardV2804(); c.promptTrimmed=Number(c.promptTrimmed||0)+1; c.tokensSavedEstimate=Number(c.tokensSavedEstimate||0)+Math.round(saved/4); }
  return txt;
}
try{
  if(typeof visionJsonCall==='function' && !global.__v2804VisionJsonWrapped){
    const originalVisionJsonCall=visionJsonCall;
    visionJsonCall=async function(systemText,userText,image,opts={}){
      const sys=String(systemText||''); const user=String(userText||'');
      const isExpiry=/scadenza|expiry|OCR scadenza/i.test(sys+' '+user);
      const isLabel=/etichetta|ingredienti|OCR etichetta/i.test(sys+' '+user);
      const isProduct=/prodotto|Analisi rapida prodotto/i.test(sys+' '+user);
      let max=isExpiry?220:(isLabel?380:(isProduct?340:420));
      if(opts && Number(opts.maxTokens)) max=Math.min(max, Number(opts.maxTokens));
      const trimmed=trimVisionPromptV2804(user);
      const c=ensureCostGuardV2804(); c.teacherCalls=Number(c.teacherCalls||0)+1; c.lowCostCalls=Number(c.lowCostCalls||0)+1; c.updatedAt=Date.now();
      recordCostGuardV2804({type:'vision-call',stage:isExpiry?'expiry':isLabel?'label':isProduct?'product':'auto',maxTokens:max,promptChars:trimmed.length,imageBytes:String(image||'').length});
      return originalVisionJsonCall.call(this,systemText,trimmed,image,Object.assign({},opts,{maxTokens:max}));
    };
    global.__v2804VisionJsonWrapped=true;
  }
}catch(_){ }


// =============================================================
// V28.05 SERVER PRODUCT COUNTER VERIFY
// Il contatore prodotti server ora usa una vista deduplicata reale:
// record raw, gruppi unici, duplicati probabili e barcode uniti.
// =============================================================
function v2805Norm(s=''){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function v2805Tokens(){
  const stop=new Set('prodotto alimentare alimento bevanda liquido solido confezione formato marca tipo variante bottiglia vasetto barattolo flacone busta scatola lattina tubo maxi uht lunga conservazione del della di da al alla con senza per il lo la le gli un una e in a ai ml l lt g gr kg pezzi pz'.split(' '));
  return Array.from(new Set(Array.from(arguments).join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(t=>t.length>2&&!stop.has(t))));
}
function v2805Jaccard(a=[],b=[]){ const A=new Set(a),B=new Set(b); if(!A.size||!B.size) return 0; let inter=0; for(const x of A) if(B.has(x)) inter++; return inter/(A.size+B.size-inter); }
function v2805FormatNorm(s=''){ return v2805Norm(s).replace(/\b0+(\d)/g,'$1').replace(/\s+/g,' ').trim(); }
function v2805ProductClusterKey(p={}){
  const bar=(Array.isArray(p.barcodes)?p.barcodes:[]).map(String).find(x=>/^\d{8,14}$/.test(x));
  const brand=v2805Norm(p.brand||p.brands?.[0]||'');
  const name=v2805Norm(p.productName||p.name||p.aliases?.[0]||'');
  const fmt=v2805FormatNorm(p.format||p.size||'');
  // Il barcode da solo identifica variante esatta, ma per contare reale usiamo anche nome/brand
  // così un prodotto salvato prima senza barcode può fondersi col record arricchito dopo.
  if(brand && name) return ['canon',brand,name,fmt].filter(Boolean).join('|');
  if(bar) return 'ean|'+bar;
  return ['loose',brand||'no-brand',name||'no-name',fmt].join('|');
}
function v2805LikelySameProduct(a={},b={}){
  const ab=(Array.isArray(a.barcodes)?a.barcodes:[]).filter(Boolean), bb=(Array.isArray(b.barcodes)?b.barcodes:[]).filter(Boolean);
  if(ab.length && bb.length && ab.some(x=>bb.includes(x))) return true;
  const brandA=v2805Norm(a.brand||''), brandB=v2805Norm(b.brand||'');
  const brandOk=brandA&&brandB&&(brandA.includes(brandB)||brandB.includes(brandA));
  const fmtA=v2805FormatNorm(a.format||''), fmtB=v2805FormatNorm(b.format||'');
  const fmtOk=!fmtA||!fmtB||fmtA===fmtB;
  const tokA=v2805Tokens(a.productName,a.brand,a.format,a.category,(a.evidenceTokens||[]).join(' '),(a.detectedText||[]).join(' '));
  const tokB=v2805Tokens(b.productName,b.brand,b.format,b.category,(b.evidenceTokens||[]).join(' '),(b.detectedText||[]).join(' '));
  const sim=v2805Jaccard(tokA,tokB);
  if(brandOk && fmtOk && sim>=0.42) return true;
  if(fmtOk && sim>=0.72) return true;
  return false;
}
function v2805DedupedGlobalProducts(limit=20){
  ensureDbShape();
  const g=db.assistantBrain.globalProductMemory||{products:{}};
  const raw=Object.values(g.products||{}).filter(Boolean).sort((a,b)=>Number(b.confirmations||0)-Number(a.confirmations||0));
  const clusters=[];
  for(const p of raw){
    let group=clusters.find(c=>c.items.some(x=>v2805LikelySameProduct(x,p)));
    if(!group){ group={key:v2805ProductClusterKey(p),items:[],confirmations:0,barcodes:new Set(),representative:p}; clusters.push(group); }
    group.items.push(p); group.confirmations+=Number(p.confirmations||0);
    (Array.isArray(p.barcodes)?p.barcodes:[]).forEach(b=>group.barcodes.add(String(b)));
    if(Number(p.confirmations||0)>Number(group.representative?.confirmations||0)) group.representative=p;
  }
  const products=clusters.sort((a,b)=>b.confirmations-a.confirmations).slice(0,limit).map(c=>{
    const r=compactGlobalProductRecord(c.representative||{});
    r.clusterSize=c.items.length; r.clusterConfirmations=c.confirmations; r.clusterBarcodes=Array.from(c.barcodes).slice(0,5);
    return r;
  });
  return {products,count:clusters.length,rawCount:raw.length,duplicatesPossible:Math.max(0,raw.length-clusters.length),confirmations:Number(g.confirmations||0),teacherHelp:Number(g.teacherHelp||0),localRecognitions:Number(g.localRecognitions||0),updatedAt:g.updatedAt||0,counterMode:'deduped_real_products_v28_05'};
}
try{
  if(typeof publicGlobalProductMemory==='function' && !global.__v2805PublicGpmWrapped){
    const oldPublicGlobalProductMemory=publicGlobalProductMemory;
    publicGlobalProductMemory=function(limit=20){
      try{ return v2805DedupedGlobalProducts(limit); }catch(err){ const fallback=oldPublicGlobalProductMemory(limit); return Object.assign({},fallback,{counterMode:'fallback_raw_count',counterError:String(err?.message||err)}); }
    };
    global.__v2805PublicGpmWrapped=true;
  }
}catch(_){ }
try{
  if(typeof preflightSnapshotV98==='function' && !global.__v2805PreflightWrapped){
    const oldPreflight=preflightSnapshotV98;
    preflightSnapshotV98=function(){ const out=oldPreflight(); out.serverProductCounterV2805=publicGlobalProductMemory(8); out.globalCount=out.serverProductCounterV2805.count; return out; };
    global.__v2805PreflightWrapped=true;
  }
}catch(_){ }

// =============================================================
// V28.41 TEA LABEL GUARD - evita cola/gassate da colore etichetta.
// Se l evidenza reale indica tè/thé/ice tea, vince juice; fallback locale generico non può diventare soft_drinks.
// =============================================================
