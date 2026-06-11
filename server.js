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
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.4-mini'; // V28.51: vision default cheap/pro, chat can stay stronger
const OPENAI_MODEL_FALLBACKS = String(process.env.OPENAI_MODEL_FALLBACKS || 'gpt-5.4-mini,gpt-5.4-nano,gpt-5.5').split(',').map(s=>s.trim()).filter(Boolean);
// V28.51 PRO Cost Firewall: la Vision non deve mai bruciare token enormi per una singola foto.
const VISION_COST_SAVER_MODE = !/^false$/i.test(String(process.env.VISION_COST_SAVER_MODE || 'true'));
const VISION_MAX_OUTPUT_TOKENS = Math.max(80, Math.min(360, Number(process.env.VISION_MAX_OUTPUT_TOKENS || 240)));
const VISION_EXPIRY_MAX_OUTPUT_TOKENS = Math.max(60, Math.min(220, Number(process.env.VISION_EXPIRY_MAX_OUTPUT_TOKENS || 120)));
const VISION_LABEL_MAX_OUTPUT_TOKENS = Math.max(120, Math.min(380, Number(process.env.VISION_LABEL_MAX_OUTPUT_TOKENS || 260)));
const VISION_MICRO_MAX_OUTPUT_TOKENS = Math.max(60, Math.min(220, Number(process.env.VISION_MICRO_MAX_OUTPUT_TOKENS || 120)));
const VISION_ALLOW_SECOND_OPENAI_PASS = /^true$/i.test(String(process.env.VISION_ALLOW_SECOND_OPENAI_PASS || 'false'));
const VISION_PROMPT_CONTEXT_CHARS = Math.max(600, Math.min(5000, Number(process.env.VISION_PROMPT_CONTEXT_CHARS || 1800)));
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
  const keys=Object.keys(corrections).filter(k=>{ const c=corrections[k]; if(!c || !c.edited) return false; return normalizeText(c.from||'') !== normalizeText(c.to||''); });
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
  const userConfirmedV2858=!!(confirmed.userConfirmed||confirmed.confirmedAt);
  const c=Math.max(Number(confirmed.confidence||0), userConfirmedV2858 ? 0.74 : 0);
  if(c>0) old.confidence=Number((((Number(old.confidence||0)*(old.confirmations-1))+c)/old.confirmations).toFixed(3));
  const uniqueHouseholds=Object.keys(old.households||{}).length;
  old.reliability=(old.confirmations>=6 || uniqueHouseholds>=3)?'alta':(old.confirmations>=1 || uniqueHouseholds>=1)?'media':'bassa';
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
function v2845SafePhotoUrl(v=''){
  const s=String(v||'').trim();
  if(!s) return '';
  if(v2842IsDataImage(s)) return '';
  if(!/^https?:\/\//i.test(s)) return '';
  if(s.length>1200) return '';
  if(/[<>\"']/g.test(s)) return '';
  return s;
}
function v2845AttachOwnerProfilePhoto(record={}, updates={}, actor=''){
  const folder=v2842EnsureObjectFolder(record);
  const dataUrl=v2842SafeImageDataUrl(updates.profilePhotoDataUrl||updates.profilePhotoBase64||updates.representativePhotoDataUrl||'', 780000);
  const externalUrl=v2845SafePhotoUrl(updates.profilePhotoUrl||updates.representativePhotoUrl||'');
  if(!dataUrl && !externalUrl) return null;
  const sample={
    id:'',
    at:v2842Now(),
    kind:'owner_profile',
    dataUrl,
    thumbDataUrl:dataUrl,
    externalUrl,
    bytes:dataUrl?v2842ImageBytes(dataUrl):0,
    visualSignature:v2840CleanString(updates.visualSignature||record.visualSignature||'',220),
    colors:v2840List(updates.colors, record.colors).slice(0,18),
    visibleEvidence:['Foto profilo scelta manualmente dal titolare server'],
    detectedText:[],
    source:'server_owner_profile_photo',
    score:999
  };
  sample.id='owner_ph_'+hashStable([dataUrl.slice(0,900),dataUrl.slice(-900),externalUrl,record.key||record.canonicalKey||record.productName||'',Date.now()].join('|')).slice(0,18);
  folder.photos=Array.isArray(folder.photos)?folder.photos:[];
  folder.photos=folder.photos.filter(p=>!(p.id===sample.id || (dataUrl && p.dataUrl===dataUrl) || (externalUrl && p.externalUrl===externalUrl)));
  folder.photos.unshift(sample);
  folder.photos=folder.photos.slice(0,30);
  folder.representativePhotoId=sample.id;
  folder.representativePhoto=Object.assign({}, sample);
  folder.profilePhotoLockedByOwner=true;
  folder.hasRealProfilePhoto=true;
  folder.photoCount=folder.photos.length;
  folder.updatedAt=v2842Now();
  record.profilePhoto=Object.assign({}, sample);
  record.ownerProfilePhoto=Object.assign({}, sample);
  record.sources=Object.assign({}, record.sources||{}, {ownerProfilePhoto:Number(record.sources?.ownerProfilePhoto||0)+1});
  updateGlobalLearningAudit({type:'owner-profile-photo-updated-v2845', key:record.key||record.canonicalKey||'', productName:record.productName||'', brand:record.brand||'', actor, mode:dataUrl?'uploaded_data_url':'external_url'});
  return sample;
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
  record.learningQuality=Object.assign({}, record.learningQuality||{}, {ownerLocked:true, ownerPriority:'server_owner_override > user_confirmation > barcode > label > memory > teacher', photoPriority:'owner_selected_profile_photo > server_auto_best_photo', clearableFields:true});
  record.sources=Object.assign({}, record.sources||{}, {ownerOverride:Number(record.sources?.ownerOverride||0)+1});
  return record;
}

function v2874DeleteObjectPhotos(record={}, photoIds=[], actor=''){
  const folder=v2842EnsureObjectFolder(record);
  const ids=[...new Set(v2840List(photoIds).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!ids.length) return {ok:false,error:'photo_id_required',message:'Nessuna foto selezionata'};
  folder.photos=Array.isArray(folder.photos)?folder.photos:[];
  const removed=folder.photos.filter(p=>ids.includes(String(p.id||'')));
  if(!removed.length) return {ok:false,error:'photo_not_found',message:'Foto non trovata nella cartella oggetto'};
  folder.photos=folder.photos.filter(p=>!ids.includes(String(p.id||'')));
  const repStillThere=folder.representativePhotoId && folder.photos.find(p=>String(p.id||'')===String(folder.representativePhotoId||''));
  if(!repStillThere){
    const best=folder.photos.find(p=>p.kind==='product_front' && (p.dataUrl||p.externalUrl)) || folder.photos.find(p=>p.dataUrl||p.externalUrl) || null;
    if(best){
      folder.representativePhotoId=best.id;
      folder.representativePhoto=Object.assign({}, best);
      folder.hasRealProfilePhoto=!!(best.dataUrl||best.externalUrl);
      record.profilePhoto=Object.assign({}, best);
      if(record.ownerProfilePhoto && ids.includes(String(record.ownerProfilePhoto.id||''))) record.ownerProfilePhoto=null;
    }else{
      folder.representativePhotoId='';
      folder.representativePhoto=null;
      folder.hasRealProfilePhoto=false;
      record.profilePhoto=null;
      if(record.ownerProfilePhoto && ids.includes(String(record.ownerProfilePhoto.id||''))) record.ownerProfilePhoto=null;
    }
    folder.profilePhotoLockedByOwner=false;
    if(record.ownerOverrides){
      record.ownerOverrides.profilePhotoLockedByOwner=false;
      record.ownerOverrides.representativePhotoId=folder.representativePhotoId||'';
    }
  }
  folder.photoCount=folder.photos.length;
  folder.updatedAt=v2842Now();
  record.updatedAt=v2842Now();
  record.ownerOverrideHistory=Array.isArray(record.ownerOverrideHistory)?record.ownerOverrideHistory:[];
  record.ownerOverrideHistory.unshift({at:v2842Now(), actor:actor||'server_owner', fields:['deletePhoto'], removedPhotoIds:ids.slice(0,20), removedCount:removed.length, remainingPhotoCount:folder.photoCount});
  record.ownerOverrideHistory=record.ownerOverrideHistory.slice(0,30);
  v2840AttachMemoryCard(record,{});
  updateGlobalLearningAudit({type:'owner-photo-deleted-v2874', key:record.key||'', productName:record.productName||'', brand:record.brand||'', actor, removedPhotoIds:ids.slice(0,10), removedCount:removed.length, remainingPhotoCount:folder.photoCount});
  return {ok:true, removedCount:removed.length, removedPhotos:removed.map(p=>({id:p.id||'',kind:p.kind||'',source:p.source||''})), remainingPhotoCount:folder.photoCount};
}

function v2842UpdateOwnerOverride(key='', updates={}, actor=''){
  ensureDbShape();
  const g=db.assistantBrain.globalProductMemory||{products:{}};
  const record=g.products[key];
  if(!record) return {ok:false,error:'product_not_found'};
  const deletePhotoIds=[...new Set(v2840List(updates?.deletePhotoIds, updates?.deletePhotoId).map(x=>String(x||'').trim()).filter(Boolean))];
  let deletePhotoResult=null;
  if(updates && updates.clearOwnerLock){
    record.ownerOverrides={enabled:false, version:'V28.43_owner_locked_values', fields:{}, lockedFields:[], clearedAt:v2842Now(), updatedBy:actor||'server_owner'};
    record.lockedByOwner=false;
    record.learningQuality=Object.assign({}, record.learningQuality||{}, {ownerLocked:false, ownerPriority:'disabled_by_owner'});
    v2840AttachMemoryCard(record,{});
    record.updatedAt=v2842Now(); g.updatedAt=v2842Now();
    updateGlobalLearningAudit({type:'owner-override-cleared', key:record.key||key, productName:record.productName||'', brand:record.brand||'', actor});
    return {ok:true, product:v2840PublicProductBrainDetail(record)};
  }
  if(deletePhotoIds.length){
    deletePhotoResult=v2874DeleteObjectPhotos(record, deletePhotoIds, actor||'server_owner');
    if(!deletePhotoResult.ok) return deletePhotoResult;
  }
  const allowed=['productName','brand','format','category','unit','barcode','ingredients','allergens','possibleTraces','colors','labels','nutrition','visualSignature','packaging','packageType','productType'];
  const fields={};
  const hasFieldUpdates=allowed.some(k=>Object.prototype.hasOwnProperty.call(updates||{},k));
  const wantsRepChange=!!(updates&&updates.representativePhotoId);
  const wantsPhotoChange=!!(updates&&(updates.profilePhotoDataUrl || updates.profilePhotoBase64 || updates.profilePhotoUrl || updates.representativePhotoDataUrl || updates.representativePhotoUrl));
  for(const k of allowed){
    if(Object.prototype.hasOwnProperty.call(updates,k)){
      const v=v2842CleanOverrideValue(k,updates[k]);
      if(v==null) continue;
      if(k==='productName' && !String(v||'').trim()) continue;
      fields[k]=v;
    }
  }
  if(deletePhotoResult && !hasFieldUpdates && !wantsRepChange && !wantsPhotoChange){
    v2840AttachMemoryCard(record,{});
    record.updatedAt=v2842Now(); g.updatedAt=v2842Now();
    return {ok:true, product:v2840PublicProductBrainDetail(record), photoDelete:deletePhotoResult};
  }
  const prev=record.ownerOverrides||{};
  const before=Object.assign({}, prev.fields||{});
  record.ownerOverrides={enabled:true, version:'V28.43_owner_locked_values', fields:Object.assign({}, prev.fields||{}, fields), lockedFields:[...new Set([...(prev.lockedFields||[]), ...Object.keys(fields)])], updatedAt:v2842Now(), updatedBy:actor||'server_owner'};
  let ownerPhotoChange=null;
  if(updates.representativePhotoId){
    const f=v2842EnsureObjectFolder(record);
    const selected=f.photos.find(p=>p.id===updates.representativePhotoId);
    if(selected){
      f.representativePhotoId=updates.representativePhotoId;
      f.representativePhoto=Object.assign({}, selected);
      f.profilePhotoLockedByOwner=true;
      f.hasRealProfilePhoto=!!(selected.dataUrl||selected.externalUrl);
      record.profilePhoto=Object.assign({}, selected);
      record.ownerOverrides.representativePhotoId=updates.representativePhotoId;
      record.ownerOverrides.profilePhotoLockedByOwner=true;
      ownerPhotoChange=selected;
    } else {
      return {ok:false,error:'representative_photo_not_found',message:'Foto non trovata nella cartella oggetto'};
    }
  }
  if(updates.profilePhotoDataUrl || updates.profilePhotoBase64 || updates.profilePhotoUrl || updates.representativePhotoDataUrl || updates.representativePhotoUrl){
    ownerPhotoChange=v2845AttachOwnerProfilePhoto(record, updates, actor||'server_owner');
    if(!ownerPhotoChange) return {ok:false,error:'invalid_profile_photo',message:'Foto profilo non valida: usa JPG/PNG/WebP base64 leggero oppure URL https'};
    record.ownerOverrides.representativePhotoId=ownerPhotoChange.id;
    record.ownerOverrides.profilePhotoLockedByOwner=true;
  }
  record.ownerOverrideHistory=Array.isArray(record.ownerOverrideHistory)?record.ownerOverrideHistory:[];
  record.ownerOverrideHistory.unshift({at:v2842Now(), actor:actor||'server_owner', fields:Object.keys(fields), representativePhotoId:(ownerPhotoChange?.id||updates.representativePhotoId||''), photoChanged:!!ownerPhotoChange, before:v2840SmallObject(before,30), after:v2840SmallObject(record.ownerOverrides.fields,30)});
  record.ownerOverrideHistory=record.ownerOverrideHistory.slice(0,30);
  v2842ApplyOwnerOverrides(record);
  v2840AttachMemoryCard(record,{});
  record.updatedAt=v2842Now(); g.updatedAt=v2842Now();
  updateGlobalLearningAudit({type:'owner-override-updated', key:record.key||key, productName:record.productName||'', brand:record.brand||'', lockedFields:record.ownerOverrides.lockedFields, actor, fieldCount:Object.keys(fields).length, photoChanged:!!ownerPhotoChange, representativePhotoId:ownerPhotoChange?.id||updates.representativePhotoId||''});
  return {ok:true, product:v2840PublicProductBrainDetail(record), photoDelete:deletePhotoResult};
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

function v2844BrainCategorySearchText(category=''){
  const c=String(category||'').trim();
  const map={
    milk_drinks:'latte bevande latte milk drinks latte uht latte fresco',
    water:'acqua acqua naturale acqua minerale',
    juice:'succhi tè the thé tea ice tea bevande non gassate',
    soft_drinks:'bibite gassate cola coca cola pepsi fanta sprite',
    sauces_condiments:'salse condimenti sughi ketchup maionese bbq',
    laundry:'bucato detersivo lavatrice candeggina ammorbidente',
    cleaning:'pulizia casa detergente disinfettante',
    dishwashing:'piatti lavastoviglie detersivo piatti',
    meat_deli:'salumi affettati carne gastronomia',
    spreads:'creme spalmabili crema spalmabile',
    yogurt:'yogurt kefir',
    oil_vinegar:'olio aceto',
    chocolate_sweets:'cioccolata dolci snack biscotti merendine',
    pet_food:'animali cibo animali cane gatto crocchette',
    aquarium:'acquario pesci tartarughe'
  };
  return [c,map[c]||''].join(' ');
}
function v2844BrainPrimarySearchBlob(record={}){
  const card=record.memoryCard||{};
  const id=card.identity||{};
  const cls=card.classification||{};
  const qty=card.quantity||{};
  const va=card.visualAppearance||{};
  const oo=record.ownerOverrides?.fields||{};
  return normalizeVisionText([
    record.productName, record.brand, record.format, record.category, record.unit, (record.barcodes||[]).join(' '),
    card.title, id.productName, id.brand, id.format, (id.aliases||[]).join(' '), (id.brands||[]).join(' '),
    cls.category, cls.categoryFamily, v2844BrainCategorySearchText(cls.category||record.category||''), qty.unit,
    card.barcode, (card.barcodes||[]).join(' '),
    oo.productName, oo.brand, oo.format, oo.category, oo.barcode,
    va.productType, va.packageType, va.visualSignature, (va.colors||[]).join(' '), record.packaging, record.packageType, record.productType,
    (record.labels||[]).join(' '), (card.labels||[]).join(' '), (record.evidenceTokens||[]).join(' ')
  ].filter(Boolean).join(' '));
}
function v2844BrainDeepSearchBlob(record={}){
  const card=record.memoryCard||{};
  return normalizeVisionText([
    v2844BrainPrimarySearchBlob(record),
    (record.ingredients||[]).join(' '), (record.allergens||[]).join(' '), (record.possibleTraces||[]).join(' '),
    (card.ingredients||[]).join(' '), (card.allergens||[]).join(' '), (card.possibleTraces||[]).join(' '),
    (record.visibleEvidence||[]).join(' '), (record.detectedText||[]).join(' '),
    (card.visibleEvidence||[]).join(' '), (card.detectedText||[]).join(' '), JSON.stringify(record.nutrition||card.nutrition||{})
  ].filter(Boolean).join(' '));
}
function v2844BrainSearchScore(record={}, q='', deep=false){
  const query=normalizeVisionText(q||'');
  if(!query) return 1;
  const digits=query.replace(/\D/g,'');
  if(/^\d{6,14}$/.test(digits)){
    const bc=[record.barcode,(record.barcodes||[]).join(' '),record.memoryCard?.barcode,(record.memoryCard?.barcodes||[]).join(' ')].join(' ');
    return String(bc||'').includes(digits) ? 999 : 0;
  }
  const parts=query.split(/\s+/).filter(Boolean);
  if(!parts.length) return 1;
  const primary=v2844BrainPrimarySearchBlob(record);
  const hay=deep ? v2844BrainDeepSearchBlob(record) : primary;
  for(const t of parts){ if(!hay.includes(t)) return 0; }
  const name=normalizeVisionText([record.productName,record.brand,record.memoryCard?.identity?.productName,record.memoryCard?.identity?.brand].filter(Boolean).join(' '));
  let score=0;
  for(const t of parts){
    if(primary.split(' ').includes(t)) score+=24; else if(primary.includes(t)) score+=12; else score+=2;
    if(name.split(' ').includes(t)) score+=38; else if(name.includes(t)) score+=20;
  }
  score += Number(record.confirmations||0)*0.2;
  if(record.ownerOverrides?.enabled) score+=4;
  return score;
}

function publicServerBrainV2840({limit=200, q='', includeRaw=false}={}){
  ensureDbShape();
  const g=db.assistantBrain.globalProductMemory||{products:{}};
  const query=normalizeText(q||'');
  let products=Object.values(g.products||{}).map(r=>{ try{ v2842EnsureObjectFolder(r); v2842ApplyOwnerOverrides(r); v2840AttachMemoryCard(r,{}); }catch(_){ if(!r.memoryCard) v2840AttachMemoryCard(r,{}); } return r; });
  const deepSearch = !!includeRaw || String(arguments[0]?.deep||'').toLowerCase()==='true' || String(arguments[0]?.deep||'')==='1';
  if(query){
    products=products.map(p=>Object.assign(p,{__brainSearchScoreV2844:v2844BrainSearchScore(p,q,deepSearch)})).filter(p=>Number(p.__brainSearchScoreV2844||0)>0);
  }
  products=products.sort((a,b)=> query ? (Number(b.__brainSearchScoreV2844||0)-Number(a.__brainSearchScoreV2844||0) || Number(b.updatedAt||0)-Number(a.updatedAt||0)) : (Number(b.updatedAt||0)-Number(a.updatedAt||0))).slice(0,Math.max(1,Math.min(Number(limit)||200,1000))).map(v2840PublicProductBrainDetail);
  const errors=[...(db.assistantBrain.learningAudit||[]).filter(e=>/error|failed|reject|sync/i.test(String(e.type||e.reason||''))).slice(0,120), ...((db.assistantBrain.errorLearning?.corrections||[]).slice(0,80).map(e=>Object.assign({type:'user-correction'},e)))].slice(0,180);
  return {
    ok:true,
    version:'V28.45 Brain Premium Photo Owner Console',
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
  const strongHomeEvidence=/\b(candeggina|dexal|grandi\s+del\s+risparmio|colori\s+sicuri|detersivo|bucato|lavatrice|sgrassatore|detergente|pulizia|disinfettante|profumo\s+fiori\s+di\s+campo)\b/.test(evidenceNorm);
  const genericFallback=/\b(bibita\s+tipo\s+cola|bevanda\s+in\s+bottiglia\s+da\s+identificare|bottiglia\s+da\s+identificare|prodotto\s+da\s+identificare|prodotto\s+in\s+confezione\s+verde\s+da\s+identificare|bevanda\s+da\s+identificare|articolo\s+da\s+identificare|verdura)\b/.test(evidenceNorm) && !brand && !(detectedText||[]).length && !(visibleEvidence||[]).length;
  const local=strongHomeEvidence ? inferRealityCategoryServer(evidence,'laundry') : (teaEvidence ? 'juice' : inferRealityCategoryServer(evidence,currentCategory||'food'));
  if(strongHomeEvidence) return {category:local, confidence:.92, source:'regole locali forti', reason:'Testo forte prodotto casa/bucato: non uso OpenFoodFacts alimentare.'};
  if(genericFallback) return {category:(currentCategory&&currentCategory!=='veg'?currentCategory:'food'), confidence:.24, source:'regole locali', reason:'Categoria non verificata: risultato locale generico, serve etichetta/barcode/docente.'};
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
  // V28.51 PRO Cost Firewall: prompt e output sempre compatti.
  const requested = Number(opts.maxTokens || VISION_MAX_OUTPUT_TOKENS || 220);
  const stage = String(opts.stage || '').toLowerCase();
  const cap = stage === 'expiry' ? VISION_EXPIRY_MAX_OUTPUT_TOKENS : (stage === 'label' ? VISION_LABEL_MAX_OUTPUT_TOKENS : VISION_MAX_OUTPUT_TOKENS);
  const maxTokens = VISION_COST_SAVER_MODE ? Math.max(16, Math.min(cap, requested)) : Math.max(16, Math.min(900, requested));
  const maxPromptChars = VISION_COST_SAVER_MODE ? Math.max(1200, Number(process.env.VISION_MAX_PROMPT_CHARS || 5200)) : 90000;
  const compactUserText = String(userText || '').slice(0, maxPromptChars);
  const payload={
    model:OPENAI_VISION_MODEL,
    max_output_tokens: maxTokens,
    input:[
      {role:'system',content:String(systemText||'').slice(0,900)},
      {role:'user',content:[{type:'input_text',text:compactUserText},{type:'input_image',image_url:image}]}
    ]
  };
  const resp=await openAiResponse(payload, {kind:'vision'});
  const out=extractJsonObject(outputText(resp));
  if(out && typeof out==='object') out.openAiCostFirewallV2851={maxTokens, promptChars:compactUserText.length, model:OPENAI_VISION_MODEL, stage:stage||'auto', secondPassAllowed:VISION_ALLOW_SECOND_OPENAI_PASS};
  return out;
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
Catalogo ridotto: ${JSON.stringify(compact.slice(0,12)).slice(0,VISION_PROMPT_CONTEXT_CHARS)}
Prodotti imparati: ${JSON.stringify(learned.slice(0,12)).slice(0,VISION_PROMPT_CONTEXT_CHARS)}
Candidati memoria: ${JSON.stringify(candidates.slice(0,16)).slice(0,VISION_PROMPT_CONTEXT_CHARS)}`;
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
        const fastProductPrompt=`Analizza la foto prodotto. Rispondi SOLO JSON valido. PRIORITÀ: scegli il prodotto centrale/più grande, non oggetti laterali o sfondo. Se al centro c'è una bottiglia Coca-Cola/cola o altra confezione idonea, analizza quella e ignora persone/piatti/tavolo/salse laterali. Devi essere veloce: riconosci prodotto, marca, tipo, formato se leggibile e categoria reale. Non cercare di leggere tutta la tabella ingredienti se non è visibile. Se vedi cane, vestiti, telecomando, TV, mobili o oggetti non consumabili rispondi {"needsRetake":true,"notConsumable":true,"reason":"Oggetto non idoneo","productName":"","confidence":0}. Categoria: usa regole realtà professionali v27.96: scegli per prove dell etichetta, non per forma generica; confezione è solo indizio. Bevanda solo se è davvero da bere (acqua, cola, bibita gassata, succo, latte da bere). Se leggi Cola/Coca-Cola/Pepsi/Fanta/Sprite non classificarla come acqua: categoria soft_drinks, unit bt/lattina. Se leggi THE/THÉ/TÈ/ICE TEA/THÉ FUSION/PESCA/ROSA o Estathè è bevanda al tè: categoria juice, mai cola o bibite gassate solo per colore etichetta. Pesto/salsa/BBQ/ketchup/maionese/condimento = sauces_condiments; olio/aceto = oil_vinegar; yogurt/kefir = yogurt; cioccolata/dolci = chocolate_sweets; crema spalmabile = spreads; marmellata/miele = jams_honey; cibo animali = pet_food; bucato/piatti/pulizia/carta casa hanno categorie dedicate; Dexal/Candeggina Delicata/Grandi del risparmio/colori sicuri = prodotto casa/bucato, mai bevanda/succo/tè/verdura; barattolo/vasetto/bottiglia/flacone sono solo confezione, non categoria se il testo dice altro. Schema JSON: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","variant":"","productType":"","packageType":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"quantity":1,"unit":"pz","category":"food","confidence":0.1,"isLiquid":false,"isDamaged":false,"damageType":"","expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"barcode":"","detectedText":[],"visibleEvidence":[],"detailQuestion":"","reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. Analisi rapida prodotto.', fastProductPrompt, openAiTeacherImage, {maxTokens:220, stage:'product'});
        detailRaw = null;
      }else if(stageName==='expiry'){
        const expiryPrompt=`OCR mirato SOLO SCADENZA V28.57 PRO. Rispondi SOLO JSON valido. Non dire mai che è foto prodotto/etichetta: la missione è leggere eventuali numeri/data presenti. Se non trovi data, riporta comunque detectedText e reason pratico senza cambiare prodotto. Devi leggere anche date stampate a puntini/dot-matrix sul collo o tappo di bottiglie, tipo 16/08/20, 16/08/2026, 16-08-26, 16.08.26, 160826. Cerca date vicino a: SCAD, Scadenza, EXP, TMC, Da consumarsi entro, Preferibilmente entro, Lotto/L. Se ci sono due righe, la riga con formato data è expiryDate; la riga lunga numerica tipo lotto/batch va in detectedText e NON in expiryDate. Non riscrivere nome/marca/categoria durante scansione scadenza. Se leggi 16/08/20 restituisci expiryDate 16/08/2020 e expiryDetectedRaw 16/08/20. Se non sei sicuro lascia expiryDate vuota ma detectedText deve contenere TUTTI i caratteri letti. Schema: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","estimatedSize":"","expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"detectedText":[],"visibleEvidence":[],"confidence":0.1,"category":"food","reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. OCR scadenza.', expiryPrompt, openAiTeacherImage, {maxTokens:VISION_EXPIRY_MAX_OUTPUT_TOKENS, stage:'expiry'});
        detailRaw = null;
      }else if(stageName==='label'){
        const labelPrompt=`OCR mirato etichetta/ingredienti V28.38. Rispondi SOLO JSON valido e compatto. Concentrati SOLO sul prodotto principale e sulla sua etichetta, ignorando sfondo e oggetti vicini. Leggi con priorità: nome commerciale, marca/logo, variante/gusto, formato/capienza netta, categoria reale, ingredienti, allergeni, possibili tracce, barcode se visibile. detectedText deve contenere le righe/frammenti OCR letti anche se incompleti, senza inventare. Correggi solo errori OCR evidenti: O/0, I/1, l/1, S/5 quando serve per date, capienze e barcode. Se non sei sicuro lascia campo vuoto e spiega cosa rifotografare. Categoria: cola/bibita gassata solo con testo esplicito cola/coca/pepsi/fanta/sprite = soft_drinks; tè/thé/ice tea/the fusion = juice; acqua = water; latte = milk_drinks; yogurt/kefir = yogurt; pesto/salsa/BBQ/ketchup/maionese/sugo = sauces_condiments; crema spalmabile = spreads; olio/aceto = oil_vinegar; candeggina/detersivo/pulizia = cleaning/laundry/dishwashing; Dexal Candeggina Delicata Maxi / candeggina delicata / colori sicuri = laundry o cleaning, mai food/drinks/juice/veg. Schema: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","variant":"","productType":"","packageType":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"category":"food","ingredients":[],"allergens":[],"possibleAllergens":[],"barcode":"","detectedText":[],"visibleEvidence":[],"confidence":0.1,"reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. OCR etichetta low-cost.', labelPrompt, openAiTeacherImage, {maxTokens:VISION_LABEL_MAX_OUTPUT_TOKENS, stage:'label'});
        detailRaw = null;
      }else if(stageName==='barcode'){
        const barcodePrompt=`OCR mirato SOLO codice a barre/EAN/UPC V28.38. Rispondi SOLO JSON valido. Cerca la sequenza numerica sotto o vicino al barcode: 8, 12, 13 o 14 cifre. Rimuovi spazi/trattini/punti e restituisci il codice completo in barcode/ean. Non inventare cifre mancanti. Se trovi testo prodotto collegato al barcode puoi proporre nome, marca, formato e categoria come miglioramento, ma non toccare ingredienti/scadenza. detectedText deve includere anche il numero grezzo letto. Schema: {"needsRetake":false,"needsManual":true,"barcode":"","ean":"","code":"","productCode":"","productName":"","brand":"","estimatedSize":"","category":"food","detectedText":[],"visibleEvidence":[],"confidence":0.1,"reason":""}`;
        primaryRaw = await visionJsonCall('Solo JSON valido. OCR barcode.', barcodePrompt, openAiTeacherImage, {maxTokens:120, stage:'barcode'});
        detailRaw = null;
      }else{
        // V28.03: anche in auto evito doppia chiamata pesante. Una sola analisi completa compatta.
        primaryRaw = await visionJsonCall('Rispondi solo con JSON valido. Analisi completa low-cost.', oneShotPrompt, openAiTeacherImage, {maxTokens:260, stage:'auto'});
        detailRaw = null;
      }
    }catch(firstErr){
      const shortPrompt=`Analizza la foto. Rispondi SOLO JSON. PRIORITÀ: prodotto centrale/più grande; ignora persone, piatti, tavolo, sfondo e oggetti laterali. Riconosci solo prodotti alimentari/casa/farmacia/animali/acquario. Se vedi cane, vestiti, telecomando, TV, mobili o oggetti non consumabili rispondi {"needsRetake":true,"notConsumable":true,"reason":"Oggetto non idoneo","productName":"","confidence":0}. Riconosci prodotto, marca, testo etichetta, capienza, categoria reale, scadenza, danni. Se leggi Dexal, Candeggina Delicata, Grandi del risparmio o colori sicuri è prodotto casa/bucato. Categoria: usa regole realtà professionali v27.96: scegli per prove dell etichetta, non per forma generica; confezione è solo indizio. Bevanda solo se è davvero da bere (acqua, cola, bibita gassata, succo, latte da bere). Se leggi Cola/Coca-Cola/Pepsi/Fanta/Sprite non classificarla come acqua: categoria soft_drinks, unit bt/lattina. Se leggi THE/THÉ/TÈ/ICE TEA/THÉ FUSION/PESCA/ROSA o Estathè è bevanda al tè: categoria juice, mai cola o bibite gassate solo per colore etichetta. Pesto/salsa/BBQ/ketchup/maionese/condimento = sauces_condiments; olio/aceto = oil_vinegar; yogurt/kefir = yogurt; cioccolata/dolci = chocolate_sweets; crema spalmabile = spreads; marmellata/miele = jams_honey; cibo animali = pet_food; bucato/piatti/pulizia/carta casa hanno categorie dedicate; Dexal/Candeggina Delicata/Grandi del risparmio/colori sicuri = prodotto casa/bucato, mai bevanda/succo/tè/verdura; barattolo/vasetto/bottiglia/flacone sono solo confezione, non categoria se il testo dice altro. Non inventare. Se capienza non leggibile lascia estimatedSize "Capienza da confermare". Se è bottiglia d'acqua, productName acqua naturale o acqua in bottiglia, category water, unit bt. Se è Cola/Blues/Pepsi/Fanta/Sprite, category soft_drinks, mai water. Schema: {"needsRetake":false,"needsManual":true,"productName":"","brand":"","variant":"","estimatedSize":"","sizeDetectedRaw":"","sizeConfidence":0,"quantity":1,"unit":"pz","category":"food","confidence":0.1,"isLiquid":false,"isDamaged":false,"damageType":"","expiryDate":"","expiryDetectedRaw":"","expiryConfidence":0,"detectedText":[],"visibleEvidence":[],"detailQuestion":"","reason":""}`;
      primaryRaw = await visionJsonCall('Solo JSON valido.', shortPrompt, openAiTeacherImage, {maxTokens:220, stage:'auto'});
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
  const brain={version:'V28.49',name:'PRO ChatGPT-Level Vision Judge',base:'Ultra Error Reduction Core V27.97 + Sync Handshake V27.99',categoryEngine:'ultra_error_reduction_core_v27_97', costGuardV2804:db.assistantBrain?.costGuardV2804||null,barcodePriority:'barcode > label > user correction > server memory > teacher',syncPolicy:'single item confirm + retry queue',testTools:'diagnostics_copy + server_sync_test + openai_live_check'};
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
  return {ok:true,version:'V28.49',status,ready:status==='ready',brain,checks,teacherActive:teacherUsable,teacherConfigured:keyDiag.configured,teacherMessage:teacherMsg,openAiDiagnostics:keyDiag,lastOpenAiRuntime:lastOpenAiRuntimeV2836,dbMode,databaseConnected:dbMode!=='file',memoryReady:dbMode!=='file',globalProductMemory:gpm,knowledgeCache:{entries:Object.keys(kCache.entries||{}).length,hits:kCache.hits||0,barcodeHits:kCache.barcodeHits||0,updatedAt:kCache.updatedAt||0},barcodeBrain:db.assistantBrain?.barcodeBrain||null,errorLearning:{corrections:(db.assistantBrain?.errorLearning?.corrections||[]).length,patterns:Object.keys(db.assistantBrain?.errorLearning?.patterns||{}).length,updatedAt:db.assistantBrain?.errorLearning?.updatedAt||0},learningAudit:(db.assistantBrain.learningAudit||[]).slice(0,15),generatedAt:Date.now()};
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

    if(req.method === 'GET' && (pathName === '/api/ai/cost-meter' || pathName === '/ai/cost-meter')) {
      return send(res, 200, { ok:true, version:'V28.54', costMeter:db.assistantBrain?.proCostMeterV2854||null, generatedAt:Date.now() });
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



    if(req.method === 'POST' && (pathName === '/api/ai/server-brain/delete' || pathName === '/ai/server-brain/delete')) {
      const householdId=String(body.householdId||url.searchParams.get('householdId')||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res,401,{ok:false,error:'unauthorized_household',message:'Accesso negato: serve account cloud valido'});
      const ownerToken=String(process.env.SERVER_BRAIN_OWNER_TOKEN||process.env.ADMIN_TOKEN||'').trim();
      const providedOwnerToken=String(req.headers['x-owner-token']||body.ownerToken||url.searchParams.get('ownerToken')||'').trim();
      if(ownerToken && providedOwnerToken!==ownerToken) return send(res,403,{ok:false,error:'owner_token_required',message:'Eliminazione bloccata: inserisci SERVER_BRAIN_OWNER_TOKEN'});
      const key=String(body.key||'').trim();
      const confirmText=String(body.confirmText||body.confirm||'').trim();
      const result=v2867DeleteBrainProduct(key, {actor:ownerToken?'server_owner':hashStable(String(householdId)).slice(0,12), confirmText});
      if(!result.ok) return send(res, result.error==='product_not_found'?404:400, result);
      await saveDb();
      return send(res,200,result);
    }

    if((req.method === 'GET' || req.method === 'POST') && (pathName === '/api/ai/server-brain/render' || pathName === '/ai/server-brain/render')) {
      const householdId=String(body.householdId||url.searchParams.get('householdId')||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res,401,{ok:false,error:'unauthorized_household',message:'Accesso negato: serve account cloud valido'});
      const key=String(body.key||url.searchParams.get('key')||'').trim();
      const background=String(body.background||url.searchParams.get('background')||'transparent').trim();
      const result=v2867RenderBrainProduct(key, {background});
      if(!result.ok) return send(res,404,result);
      return send(res,200,result);
    }

    if(req.method === 'GET' && (pathName === '/api/ai/server-brain' || pathName === '/ai/server-brain')) {
      const householdId=String(url.searchParams.get('householdId')||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      if(!h) return send(res,401,{ok:false,error:'unauthorized_household',message:'Accesso negato: serve account cloud valido per vedere il cervello server'});
      const limit=Number(url.searchParams.get('limit')||200);
      const q=String(url.searchParams.get('q')||'');
      return send(res,200,publicServerBrainV2840({limit,q,deep:url.searchParams.get('deep')||''}));
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
        globalLearning: 'server_global_product_memory', globalProductMemory: publicGlobalProductMemory(10), knowledgeFeeder: db.assistantBrain.knowledgeFeeder||null, knowledgeCache:{entries:Object.keys(db.assistantBrain?.knowledgeCache?.entries||{}).length,hits:db.assistantBrain?.knowledgeCache?.hits||0,barcodeHits:db.assistantBrain?.knowledgeCache?.barcodeHits||0,updatedAt:db.assistantBrain?.knowledgeCache?.updatedAt||0}, barcodeBrain:db.assistantBrain?.barcodeBrain||null, categoryBrainV95:db.assistantBrain?.categoryBrainV95||null, monsterBrainV96:db.assistantBrain?.monsterBrainV96||null, ultraBrainV97:db.assistantBrain?.ultraBrainV97||null, errorLearning:{corrections:(db.assistantBrain?.errorLearning?.corrections||[]).length,patterns:Object.keys(db.assistantBrain?.errorLearning?.patterns||{}).length,updatedAt:db.assistantBrain?.errorLearning?.updatedAt||0}, learningQuality:{dedupe:'canonical_key_plus_barcode_conflict_guard', teacherBypass:'after_confirmations_barcode_and_field_confidence', knowledgeFeeder:'open_facts_family_with_barcode_and_cache_after_user_confirmation', storesPhotos:'lightweight_object_folder_photos_v2845_owner_selectable_profile_photo', storesVisualSignature:true, ownerOverridePriority:'server_owner_override_wins', categoryEngine:'ultra_error_reduction_core_v27_97', costGuardV2804:db.assistantBrain?.costGuardV2804||null, ultraErrorReduction:'active', preflightStability:'v28_04_cost_guard_pro', barcodePriority:'barcode > label > memory > teacher', fieldConfidence:'per_field_v97', visionPipelineV2829:'server_full_image_openai_slim_teacher_barcode_step_v2830'},
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


    if(req.method === 'POST' && pathName === '/api/ai/pixel-ocr-judge'){
      const { image='', stage='auto', localGuess=null, clientPixel=null, clientOcr=null } = body || {};
      if(!image || !String(image).startsWith('data:image/')) return send(res, 400, { ok:false, error:'image_required' });
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      const h=(householdId && db.households[householdId] && db.households[householdId].token===bearer) ? db.households[householdId] : null;
      const result=await serverPixelOcrJudgeV2864({ image, stage, localGuess, clientPixel, clientOcr, household:h }).catch(err=>({ok:false,error:'pixel_ocr_judge_failed',reason:String(err?.message||err).slice(0,180)}));
      return send(res, 200, Object.assign({ok:true}, result||{}));
    }

    if(req.method === 'POST' && pathName === '/api/ai/vision'){
      const { image='', teacherImage='', teacherImageMeta=null, identityImageV2850='', focusInstruction='', primarySubjectMode='', localGuess=null, catalog=[], settings={}, memory={}, stage='auto' } = body;
      if(!image || !String(image).startsWith('data:image/')) return send(res, 400, { error:'image_required' });
      let h=null;
      const householdId=String(body.householdId||'').trim();
      const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
      if(householdId && db.households[householdId] && db.households[householdId].token===bearer) h=db.households[householdId];
      const activeMemory=h ? ensureHouseholdMemory(h) : memory;
      const result = await visionAnalyze({image:teacherImage&&String(teacherImage).startsWith('data:image/')?teacherImage:image, teacherImage, identityImageV2850, fullImage:image, teacherImageMeta, focusInstruction, primarySubjectMode, localGuess, catalog:h?(h.items||[]):catalog,settings:h?(h.settings||{}):settings,memory:activeMemory,stage});
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
  if(has(/\b(candeggina|candeggina\s+delicata|sgrassatore|disinfettante\s+casa|detergente\s+superfici|pavimenti|bagno|wc|pulizia|dexal|ace|chanteclair|grandi\s+del\s+risparmio|colori\s+sicuri|profumo\s+fiori\s+di\s+campo)\b/)) add('cleaning',165,'pulizia casa/candeggina');
  if(has(/\b(detersivo\s+lavatrice|lavatrice|ammorbidente|bucato|dash|perlana|candeggina\s+delicata|colori\s+sicuri|profumo\s+fiori\s+di\s+campo)\b/)) add('laundry',170,'bucato/candeggina delicata');
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


// =============================================================
// V28.47 SERVER UNIVERSAL VISION COMMON-SENSE CORE
// Non più correzioni prodotto-per-prodotto: regole di buon senso generali.
// Colore/confezione sono indizi visivi, NON identità articolo e NON categoria.
// =============================================================
(function(){
  const V='28.47';
  function norm(s){ try{ return normalizeVisionText(s||''); }catch(_){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); } }
  function arr(v){ return Array.isArray(v)?v.filter(Boolean):[]; }
  function evidence(r={}){ return norm([r.productName,r.brand,r.variant,r.productType,r.packageType,r.category,r.estimatedSize,r.sizeDetectedRaw,r.unit,r.reason,r.detailQuestion,...arr(r.detectedText),...arr(r.visibleEvidence),...arr(r.ingredients),...arr(r.colors),r.visualSignature].filter(Boolean).join(' ')); }
  const RX={
    cleaning:/\b(candeggina|bleach|detersivo|detergente|sgrassatore|disinfettante|pulizia|pavimenti|bagno|wc|superfici|bucato|lavatrice|ammorbidente|piatti|lavastoviglie|brillantante|profumo fiori di campo|colori sicuri|grandi del risparmio|ace|dexal|chanteclair|lysoform|mastro lindo)\b/,
    laundry:/\b(candeggina delicata|bucato|lavatrice|ammorbidente|detersivo lavatrice|colori sicuri|profumo fiori di campo)\b/,
    dish:/\b(piatti|lavastoviglie|brillantante|caps lavastoviglie|detersivo piatti|finish|pril|svelto)\b/,
    water:/\b(acqua|minerale|oligominerale|naturale|frizzante|effervescente|levissima|sant anna|san benedetto|vera|lete|ferrarelle|uliveto|rocchetta)\b/,
    teaJuice:/\b(succo|nettare|spremuta|bevanda alla frutta|te freddo|the freddo|the fusion|the fusione|th[eè] fusion|t[eè] fusion|ice tea|estathe|estath[eè]|pesca e rosa|limone)\b/,
    soft:/\b(coca cola|coca-cola|pepsi|fanta|sprite|cola zero|cola classica|aranciata|chinotto|gassosa|cedrata|bibita gassata|bevanda gassata)\b/,
    milk:/\b(latte uht|latte intero|latte parzialmente scremato|latte scremato|latte senza lattosio|bevanda al latte|milk drink|latte 500 ml|latte 1 l)\b/,
    sauce:/\b(pesto|salsa|bbq|barbecue|ketchup|maionese|senape|condimento|sugo|passata|rag[uù]|besciamella|hummus)\b/,
    produce:/\b(insalata|lattuga|pomodoro|pomodori|zucchina|zucchine|melanzana|melanzane|carota|carote|cipolla|cipolle|patata|patate|broccoli|spinaci|finocchio|peperone|peperoni|ortaggi|verdura fresca|frutta fresca|mela|banana|arancia|limone|fragola|uva|pera|kiwi|albicocca|ciliegia|ananas|melone)\b/
  };
  function genericName(name=''){
    const n=norm(name);
    return !n || (/\b(prodotto|articolo|oggetto|confezione|bottiglia|flacone|bevanda|manual|auto|live|da identificare|nome prodotto|verdura|frutta|cibo|alimento|house|food|drinks)\b/.test(n) && !/\b(latte|pesto|salsa|candeggina|detersivo|acqua|cola|the|te|succo|yogurt|pasta|riso|tonno|olio|aceto|shampoo|sapone|dentifricio)\b/.test(n));
  }
  function infer(t=''){
    t=norm(t);
    if(!t) return '';
    if(RX.laundry.test(t)) return 'laundry';
    if(RX.dish.test(t)) return 'dishwashing';
    if(RX.cleaning.test(t)) return 'cleaning';
    if(RX.soft.test(t) && !RX.teaJuice.test(t)) return 'soft_drinks';
    if(RX.teaJuice.test(t)) return 'juice';
    if(RX.water.test(t) && !RX.cleaning.test(t)) return 'water';
    if(RX.milk.test(t)) return 'milk_drinks';
    if(RX.sauce.test(t)) return 'sauces_condiments';
    if(RX.produce.test(t) && !RX.cleaning.test(t)) return /\b(mela|banana|arancia|limone|fragola|uva|pera|kiwi|albicocca|ciliegia|ananas|melone)\b/.test(t)?'fruit':'veg';
    return '';
  }
  function strongFor(cat='', t=''){
    t=norm(t);
    if(cat==='laundry') return RX.laundry.test(t) || (RX.cleaning.test(t)&&/\b(bucato|lavatrice|candeggina delicata|colori sicuri)\b/.test(t));
    if(cat==='cleaning') return RX.cleaning.test(t);
    if(cat==='dishwashing') return RX.dish.test(t);
    if(cat==='water') return RX.water.test(t);
    if(cat==='juice') return RX.teaJuice.test(t);
    if(cat==='soft_drinks') return RX.soft.test(t);
    if(cat==='milk_drinks') return RX.milk.test(t);
    if(cat==='sauces_condiments') return RX.sauce.test(t);
    if(cat==='veg'||cat==='fruit') return RX.produce.test(t) && !RX.cleaning.test(t);
    return true;
  }
  function realIdentity(r={}){
    const txt=evidence(r);
    if(!genericName(r.productName||'') && (norm(r.brand||'') || infer(txt) || /\b\d{8,14}\b/.test(txt))) return true;
    if((arr(r.detectedText).join(' ')+arr(r.visibleEvidence).join(' ')).trim().length>=5 && infer(txt)) return true;
    return false;
  }
  function apply(r={}){
    if(!r || typeof r!=='object') return r;
    const txt=evidence(r);
    const strong=infer(txt);
    r.commonSenseCoreV2847={active:true,strongCategory:strong||'',realIdentity:realIdentity(r),policy:'label/barcode/owner values beat color and shape'};
    if(strong){
      if(r.category!==strong) r.categoryGuardNoteV2847=`Categoria corretta da conoscenza generale: ${r.category||'vuota'} -> ${strong}`;
      r.category=strong;
      if(strong==='laundry'||strong==='cleaning'||strong==='dishwashing'){
        r.isLiquid=false;
        if(genericName(r.productName||'')) r.productName='Prodotto casa da identificare';
        r.needsManual=true; r.shouldAskConfirmation=true; r.confidence=Math.max(Number(r.confidence||0), .62);
      }
      if(strong==='juice'||strong==='soft_drinks'||strong==='water'||strong==='milk_drinks'){
        r.isLiquid=true; if(!r.unit||r.unit==='pz') r.unit='bt';
      }
    }
    if((r.category==='veg'||/\bverdura\b/.test(norm(r.productName||''))) && !RX.produce.test(txt)){
      r.category=RX.cleaning.test(txt)?(RX.laundry.test(txt)?'laundry':'cleaning'):(RX.teaJuice.test(txt)?'juice':(RX.water.test(txt)?'water':(RX.milk.test(txt)?'milk_drinks':'house')));
      if(/\bverdura\b/.test(norm(r.productName||''))||genericName(r.productName||'')) r.productName='Prodotto da identificare';
      r.needsManual=true; r.shouldAskConfirmation=true; r.confidence=Math.min(Number(r.confidence||.35), .42); r.categoryWebNeeded=false; r.forceTeacher=true;
      r.reason='Conoscenza generale server: il colore non basta per dire verdura. Serve etichetta leggibile/Docente o conferma manuale.';
    }
    if((r.category==='juice'&&!strongFor('juice',txt))||(r.category==='soft_drinks'&&!strongFor('soft_drinks',txt))||(r.category==='water'&&!strongFor('water',txt))){
      if(!RX.teaJuice.test(txt)&&!RX.soft.test(txt)&&!RX.water.test(txt)&&!RX.milk.test(txt)){
        r.category=RX.cleaning.test(txt)?(RX.laundry.test(txt)?'laundry':'cleaning'):'drinks';
        r.needsManual=true; r.shouldAskConfirmation=true; r.confidence=Math.min(Number(r.confidence||.4), .52); r.categoryWebNeeded=false;
        r.reason='Conoscenza generale server: non trasformo colore/forma in categoria bevanda precisa senza testo reale.';
      }
    }
    if(!realIdentity(r)&&Number(r.confidence||0)<0.58&&!r.cloudVision&&!r.memoryVision){
      r.needsManual=true; r.shouldAskConfirmation=true; r.forceTeacher=true; r.categoryWebNeeded=false;
      if(genericName(r.productName||'')) r.productName='Prodotto da identificare';
      r.detailQuestion=r.detailQuestion||'Serve foto frontale ravvicinata o docente server/OpenAI: il locale non deve inventare.';
    }
    return r;
  }
  try{
    if(typeof normalizeVisionResult==='function' && !global.__v2847NormalizeVisionWrapped){
      const prev=normalizeVisionResult;
      normalizeVisionResult=function(obj){ return apply(prev.call(this,obj)); };
      global.__v2847NormalizeVisionWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof applyRealityCategoryServer==='function' && !global.__v2847RealityCategoryWrapped){
      const prev=applyRealityCategoryServer;
      applyRealityCategoryServer=function(result){ const out=prev.call(this,result); return apply(out||result); };
      global.__v2847RealityCategoryWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof visionAnalyze==='function' && !global.__v2847VisionAnalyzeWrapped){
      const prev=visionAnalyze;
      visionAnalyze=async function(payload){ const r=await prev.call(this,payload); return apply(r); };
      global.__v2847VisionAnalyzeWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof internetCategoryLookupServer==='function' && !global.__v2847CategoryLookupWrapped){
      const prev=internetCategoryLookupServer;
      internetCategoryLookupServer=async function(payload={}){
        const probe={productName:payload.productName||'',brand:payload.brand||'',productType:payload.productType||'',packageType:payload.packageType||'',category:payload.currentCategory||'',detectedText:payload.detectedText||[],visibleEvidence:payload.visibleEvidence||[]};
        const txt=evidence(probe);
        if(genericName(probe.productName||'') && !infer(txt)) return {ok:true,category:payload.currentCategory||'food',confidence:.12,source:'server_common_sense_v2847',reason:'Bloccato: nome/categoria generici senza evidenza reale'};
        const out=await prev.call(this,payload);
        if(out&&out.category){
          if((out.category==='veg'||out.category==='fruit')&&!RX.produce.test(txt)) return {ok:true,category:payload.currentCategory||'food',confidence:.1,source:'server_common_sense_v2847',reason:'Bloccato: ortofrutta senza prove reali'};
          if((out.category==='juice'||out.category==='soft_drinks'||out.category==='water')&&!(RX.teaJuice.test(txt)||RX.soft.test(txt)||RX.water.test(txt)||RX.milk.test(txt))) return {ok:true,category:payload.currentCategory||'drinks',confidence:.1,source:'server_common_sense_v2847',reason:'Bloccato: bevanda precisa senza testo reale'};
          if(infer(txt)) out.category=infer(txt);
        }
        return out;
      };
      global.__v2847CategoryLookupWrapped=true;
    }
  }catch(_){ }
  console.log('[Spesa Pronta] V28.47 Universal Vision Common-Sense Core active');
})();


// =============================================================
// V28.48 PRO VISION KNOWLEDGE FUSION CORE
// Obiettivo: far ragionare la Vision come un cervello generale, non come fix prodotto-per-prodotto.
// - Ontologia ampia di prodotti casa/spesa/igiene/animali/acquario.
// - Open Facts multi-source: Food + Products + Beauty + Pet Food, con barcode-first e cache.
// - Adattatore opzionale per motore visivo esterno/Home Brain, disattivo se non configurato.
// - Anti-allucinazione: colore/forma non possono mai creare nome/categoria precisa.
// =============================================================
(function(){
  const V='28.48';
  function norm(s){ try{ return normalizeVisionText(s||''); }catch(_){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); } }
  function list(v){ return Array.isArray(v)?v.filter(Boolean):[]; }
  function ev(r={}){ return norm([r.productName,r.brand,r.variant,r.productType,r.packageType,r.category,r.estimatedSize,r.sizeDetectedRaw,r.unit,r.reason,r.detailQuestion,...list(r.detectedText),...list(r.visibleEvidence),...list(r.ingredients),...list(r.allergens),...list(r.colors),r.visualSignature].filter(Boolean).join(' ')); }
  function rxWord(words){ return new RegExp('\\b('+words.join('|')+')\\b','i'); }
  const TAX={
    cleaning:{cat:'cleaning',rx:/(candeggina|bleach|detersivo|detergente|sgrassatore|disinfettante|igienizzante|pulizia|pavimenti|bagno|wc|vetri|superfici|anticalcare|muffa|spray multiuso|mastro lindo|chanteclair|lysoform|ace|dexal|quasar|smac|napisan)/i,family:'house',source:'products'},
    laundry:{cat:'laundry',rx:/(bucato|lavatrice|ammorbidente|candeggina delicata|detersivo lavatrice|caps lavatrice|tabs lavatrice|colori sicuri|profumo fiori|lavanda|lana seta|smacchiatore)/i,family:'house',source:'products'},
    dishwashing:{cat:'dishwashing',rx:/(piatti|lavastoviglie|brillantante|pastiglie lavastoviglie|tabs lavastoviglie|detersivo piatti|finish|pril|svelto|nelsen)/i,family:'house',source:'products'},
    paper_house:{cat:'paper_house',rx:/(carta igienica|carta casa|scottex|rotoloni|tovaglioli|fazzoletti|alluminio|pellicola|sacchetti freezer|sacchi spazzatura)/i,family:'house',source:'products'},
    water:{cat:'water',rx:/(acqua|minerale|oligominerale|naturale|frizzante|effervescente|levissima|sant.?anna|san benedetto|vera|lete|ferrarelle|uliveto|rocchetta|panna|evian)/i,family:'drinks',source:'food'},
    soft_drinks:{cat:'soft_drinks',rx:/(coca.?cola|pepsi|fanta|sprite|cola zero|cola classica|aranciata|chinotto|gassosa|cedrata|tonica|bibita gassata|bevanda gassata|soft drink|soda)/i,family:'drinks',source:'food'},
    juice:{cat:'juice',rx:/(succo|nettare|spremuta|bevanda alla frutta|t[eè] freddo|the freddo|th[eè] freddo|ice tea|ice the|estath[eè]|th[eè] fusion|the fusion|pesca e rosa|ace succo|multivitaminico)/i,family:'drinks',source:'food'},
    milk_drinks:{cat:'milk_drinks',rx:/(latte uht|latte fresco|latte intero|latte parzialmente scremato|latte scremato|senza lattosio|bevanda al latte|milk drink)/i,family:'drinks',source:'food'},
    yogurt:{cat:'yogurt',rx:/(yogurt|kefir|skyr|actimel|activia|yomo|muller|mila|fage|greco)/i,family:'food',source:'food'},
    dairy:{cat:'dairy',rx:/(mozzarella|formaggio|parmigiano|grana|ricotta|stracchino|philadelphia|burro|panna da cucina|mascarpone|provola|scamorza|fontina|emmental)/i,family:'food',source:'food'},
    eggs:{cat:'eggs',rx:/(uova|uovo|ovoprodotto|albumi|tuorlo)/i,family:'food',source:'food'},
    pasta_rice:{cat:'pasta_rice',rx:/(pasta|spaghetti|penne|fusilli|rigatoni|orecchiette|riso|risotto|cous cous|quinoa|gnocchi secchi)/i,family:'food',source:'food'},
    flour_baking:{cat:'flour_baking',rx:/(farina|semola|lievito|zucchero|fecola|amido|preparato per torta|pangrattato|vanillina|cacao amaro)/i,family:'food',source:'food'},
    bakery:{cat:'bakery',rx:/(pane|pan bauletto|piadina|taralli|cracker|grissini|fette biscottate|cornetto|brioche|panini)/i,family:'food',source:'food'},
    cereals:{cat:'breakfast_cereals',rx:/(cereali|corn flakes|muesli|granola|fiocchi d avena|avena|nesquik cereal)/i,family:'food',source:'food'},
    sweets:{cat:'chocolate_sweets',rx:/(cioccolato|cioccolata|cacao|tavoletta|pralina|caramelle|dolci|merendina|biscotti|wafer|torrone|cremino|nutella biscuits)/i,family:'food',source:'food'},
    spreads:{cat:'spreads',rx:/(crema spalmabile|nutella|nocciolata|burro di arachidi|crema pistacchio|pistacchio spalmabile)/i,family:'food',source:'food'},
    jams_honey:{cat:'jams_honey',rx:/(marmellata|confettura|miele|composta|sciroppo d acero)/i,family:'food',source:'food'},
    sauces:{cat:'sauces_condiments',rx:/(pesto|salsa|bbq|barbecue|ketchup|maionese|senape|condimento|sugo|passata|rag[uù]|besciamella|hummus|tabasco|salsa soia)/i,family:'food',source:'food'},
    oil_vinegar:{cat:'oil_vinegar',rx:/(olio|extravergine|extra vergine|evo|aceto|balsamico|glassa gastronomica)/i,family:'food',source:'food'},
    preserves:{cat:'preserves_jars',rx:/(pelati|polpa di pomodoro|passata|conserva|barattolo|sottoli|sottaceti|olive|capperi|mais|legumi|ceci|fagioli|lenticchie)/i,family:'food',source:'food'},
    canned_protein:{cat:'canned_fish_meat',rx:/(tonno|sgombro|salmone in scatola|carne in scatola|simmenthal|filetti di acciughe)/i,family:'food',source:'food'},
    frozen:{cat:'frozen',rx:/(surgelato|surgelati|congelato|congelati|findus|4 salti|bastoncini|spinaci surgelati|pizza surgelata)/i,family:'food',source:'food'},
    ready:{cat:'ready_meals',rx:/(piatto pronto|lasagne|insalata russa|gastronomia|zuppa pronta|vellutata|risotto pronto|cous cous pronto)/i,family:'food',source:'food'},
    meat:{cat:'meat_deli',rx:/(prosciutto|salame|mortadella|bresaola|wurstel|salsiccia|pollo|tacchino|hamburger|carne|speck|pancetta)/i,family:'food',source:'food'},
    fish:{cat:'fish',rx:/(pesce|orata|spigola|merluzzo|gamberi|salmone fresco|tonno fresco|cozze|vongole)/i,family:'food',source:'food'},
    fruit:{cat:'fruit',rx:/(mela|mele|banana|banane|arancia|arance|limone|limoni|fragola|fragole|uva|pera|pere|kiwi|albicocca|ciliegia|ananas|melone|anguria|frutta fresca)/i,family:'fresh',source:'none'},
    veg:{cat:'veg',rx:/(insalata|lattuga|pomodoro|pomodori|zucchina|zucchine|melanzana|melanzane|carota|carote|cipolla|cipolle|patata|patate|broccoli|spinaci|finocchio|peperone|peperoni|ortaggi|verdura fresca)/i,family:'fresh',source:'none'},
    personal:{cat:'personal_care',rx:/(sapone|bagnoschiuma|docciaschiuma|deodorante|crema corpo|shampoo|balsamo|gel capelli|rasoio|schiuma barba|assorbenti)/i,family:'beauty',source:'beauty'},
    oral:{cat:'oral_care',rx:/(dentifricio|spazzolino|collutorio|filo interdentale|oral b|mentadent|az|sensodyne|colgate)/i,family:'beauty',source:'beauty'},
    pharmacy:{cat:'pharmacy',rx:/(tachipirina|ibuprofene|farmaco|medicinale|cerotti|disinfettante cute|integratore|vitamina|garza|termometro|spray nasale)/i,family:'pharmacy',source:'none'},
    pet_food:{cat:'pet_food',rx:/(crocchette|umido cane|umido gatto|pat[eè] cane|pat[eè] gatto|monge|royal canin|purina|friskies|whiskas|cibo cane|cibo gatto)/i,family:'pets',source:'pet'},
    aquarium:{cat:'aquarium',rx:/(acquario|pesci|mangime pesci|biocondizionatore|batteri acquario|fertilizzante acquario|sera|tetra|askoll)/i,family:'aquarium',source:'products'}
  };
  const GENERIC=/\b(prodotto|articolo|oggetto|confezione|bottiglia|flacone|bevanda|manual|auto|live|da identificare|nome prodotto|verdura|frutta|cibo|alimento|house|food|drinks|categoria)\b/i;
  function inferCategory(text=''){
    const t=norm(text); if(!t) return {category:'',confidence:0,sourceHint:'unknown',family:'unknown',reasons:[]};
    const hits=[];
    for(const [id,row] of Object.entries(TAX)){ if(row.rx.test(t)) hits.push({id,category:row.cat,sourceHint:row.source,family:row.family}); }
    // conflitti: prodotto casa vince sempre su alimentare generico, etichetta tea vince su cola se ci sono parole tè/tea.
    const prefer=(cats)=>hits.find(h=>cats.includes(h.category));
    let best=prefer(['laundry','dishwashing','cleaning','paper_house','oral_care','personal_care','pharmacy','pet_food','aquarium']) || prefer(['juice','soft_drinks','water','milk_drinks']) || hits[0];
    if(/(t[eè]|the|th[eè]|ice tea|estath[eè])/i.test(t) && best?.category==='soft_drinks') best=hits.find(h=>h.category==='juice')||best;
    if(best) return {category:best.category, confidence:.86, sourceHint:best.sourceHint, family:best.family, reasons:hits.map(h=>h.category).slice(0,8)};
    return {category:'',confidence:0,sourceHint:'unknown',family:'unknown',reasons:[]};
  }
  function hasConcreteIdentity(r={}){
    const t=ev(r); const name=norm(r.productName||'');
    if(/\b\d{8,14}\b/.test(t)) return true;
    if(name && !GENERIC.test(name) && name.length>=3) return true;
    if(norm(r.brand||'').length>=2 && inferCategory(t).category) return true;
    if((list(r.detectedText).join(' ')+list(r.visibleEvidence).join(' ')).trim().length>=6 && inferCategory(t).category) return true;
    return false;
  }
  function blockImpossibleCategory(r={}){
    const t=ev(r); const inf=inferCategory(t); const old=r.category||'';
    r.proKnowledgeCoreV2848={active:true,inferredCategory:inf.category||'',confidence:inf.confidence||0,sourceHint:inf.sourceHint||'',concreteIdentity:hasConcreteIdentity(r),policy:'owner_lock > barcode > label/OCR > multi-source APIs > memory > teacher; color/shape never identity'};
    if(inf.category){
      r.category=inf.category;
      r.categoryRuleSource='pro_common_knowledge_v2848';
      r.categoryRuleEvidence=Array.from(new Set([...(r.categoryRuleEvidence||[]), ...inf.reasons, 'OCR/common-knowledge:'+inf.category])).slice(0,16);
      if(old && old!==inf.category) r.categoryGuardNoteV2848=`Categoria corretta da cervello PRO: ${old} -> ${inf.category}`;
    }
    const cat=String(r.category||'');
    const produceEvidence=TAX.fruit.rx.test(t)||TAX.veg.rx.test(t);
    if((cat==='veg'||cat==='fruit'||/\bverdura\b/i.test(String(r.productName||''))) && !produceEvidence){
      r.category=inf.category && inf.category!=='veg' && inf.category!=='fruit' ? inf.category : 'house';
      if(GENERIC.test(String(r.productName||''))) r.productName='Prodotto da identificare';
      r.needsManual=true; r.shouldAskConfirmation=true; r.forceTeacher=true; r.categoryWebNeeded=false; r.confidence=Math.min(Number(r.confidence||.3), .38);
      r.reason='Cervello PRO: blocco ortofrutta falsa. Verde/forma non valgono come prova; servono etichetta/barcode/docente.';
    }
    if(['soft_drinks','juice','water','milk_drinks'].includes(cat)){
      const drinkOk=TAX.soft_drinks.rx.test(t)||TAX.juice.rx.test(t)||TAX.water.rx.test(t)||TAX.milk_drinks.rx.test(t);
      if(!drinkOk && !hasConcreteIdentity(r)){ r.category='drinks'; r.needsManual=true; r.shouldAskConfirmation=true; r.categoryWebNeeded=false; r.confidence=Math.min(Number(r.confidence||.4), .45); }
    }
    if(!hasConcreteIdentity(r) && !inf.category && Number(r.confidence||0)<.62){
      if(GENERIC.test(String(r.productName||'')) || !r.productName) r.productName='Prodotto da identificare';
      r.needsManual=true; r.shouldAskConfirmation=true; r.forceTeacher=true; r.categoryWebNeeded=false;
      r.detailQuestion=r.detailQuestion||'Foto frontale più vicina o barcode: il cervello PRO non inventa senza prove.';
    }
    if(/\b(prodotto|confezione|bottiglia|flacone).{0,35}(verde|rossa|blu|gialla)/i.test(t) && !inf.category){
      r.categoryWebNeeded=false; r.forceTeacher=true; r.needsManual=true; r.shouldAskConfirmation=true;
    }
    return r;
  }
  const SOURCES=[
    {id:'open_food_facts',label:'Open Food Facts',base:'https://world.openfoodfacts.org',kind:'food'},
    {id:'open_products_facts',label:'Open Products Facts',base:'https://world.openproductsfacts.org',kind:'products'},
    {id:'open_beauty_facts',label:'Open Beauty Facts',base:'https://world.openbeautyfacts.org',kind:'beauty'},
    {id:'open_pet_food_facts',label:'Open Pet Food Facts',base:'https://world.openpetfoodfacts.org',kind:'pet'}
  ];
  function sourceOrderForConfirmed(c={}){
    const t=ev(c); const inf=inferCategory(t); let first='food';
    if(['cleaning','laundry','dishwashing','paper_house','aquarium'].includes(inf.category)) first='products';
    if(['personal_care','oral_care','hair_body'].includes(inf.category)) first='beauty';
    if(['pet_food','pets'].includes(inf.category)) first='pet';
    if(c.category && ['cleaning','laundry','dishwashing','paper_house','aquarium','house'].includes(c.category)) first='products';
    if(c.category && ['personal_care','oral_care','hair_body'].includes(c.category)) first='beauty';
    if(c.category && ['pet_food','pets'].includes(c.category)) first='pet';
    const order=[first,'food','products','beauty','pet'];
    return SOURCES.slice().sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)).filter((v,i,a)=>a.findIndex(x=>x.kind===v.kind)===i);
  }
  function scoreKnowledgeV2848(k={}, confirmed={}, source={}){
    const base=Number(k.matchScore||0);
    const t=norm([confirmed.productName,confirmed.brand,confirmed.category,...list(confirmed.detectedText),...list(confirmed.visibleEvidence)].join(' '));
    const kt=norm([k.productName,k.brand,k.category,k.sourceLabel].join(' '));
    const inf=inferCategory(t+' '+kt);
    let s=base;
    if(k.barcodeVerified || k.confidence==='barcode') s+=6;
    if(confirmed.brand && k.brand && norm(confirmed.brand)===norm(k.brand)) s+=3;
    if(confirmed.productName && k.productName){
      const q=new Set(norm(confirmed.productName).split(/\s+/).filter(x=>x.length>=3));
      const p=new Set(norm(k.productName).split(/\s+/).filter(x=>x.length>=3));
      let hit=0; q.forEach(x=>{ if(p.has(x)) hit++; });
      s += hit*1.6;
    }
    if(inf.category && k.category && inf.category===k.category) s+=2.2;
    if(source.kind==='products' && ['cleaning','laundry','dishwashing','paper_house','aquarium'].includes(inf.category)) s+=2.8;
    if(source.kind==='beauty' && ['personal_care','oral_care','hair_body'].includes(inf.category)) s+=2.4;
    if(source.kind==='pet' && ['pet_food','pets'].includes(inf.category)) s+=2.4;
    if(source.kind==='food' && ['cleaning','laundry','dishwashing','paper_house','personal_care','oral_care','pet_food','aquarium'].includes(inf.category)) s-=5;
    return Number(s.toFixed(3));
  }
  async function multiSourceKnowledgeLookup(confirmed={}){
    if(!KNOWLEDGE_FEEDER_ENABLED) return {knowledge:null,skipped:true,reason:'disabled'};
    const query=buildProductKnowledgeQuery(confirmed); const barcode=bestBarcodeFromConfirmed(confirmed);
    if(!query && !barcode) return {knowledge:null,skipped:true,reason:'missing_query'};
    const srcs=sourceOrderForConfirmed(confirmed);
    const cacheKey='multi_v2848|'+(barcode?'ean|'+barcode:'q|'+norm([confirmed.brand,confirmed.productName,confirmed.size,query].filter(Boolean).join(' ')).slice(0,160));
    const cached=getKnowledgeCache(cacheKey); if(cached) return Object.assign({cacheHit:true}, cached);
    let best=null; const attempts=[];
    for(const source of srcs){
      try{
        let k=null;
        if(barcode){ const p=await fetchOpenFactsByBarcode(source, barcode); if(p) k=Object.assign(mapOpenFactsProduct(Object.assign({},p,{code:p.code||barcode}), confirmed, source), {matchScore:9.5, confidence:'barcode', barcodeVerified:true}); }
        if(!k && query){
          const data=await fetchOpenFactsSearch(source, query);
          const products=Array.isArray(data?.products)?data.products:[];
          for(const p of products){ const row=mapOpenFactsProduct(p, confirmed, source); if(!row.productName && !row.brand) continue; row.source=source.id; row.sourceLabel=source.label; row.matchScore=scoreKnowledgeV2848(row, confirmed, source); if(!k || row.matchScore>k.matchScore) k=row; }
        }
        if(k){ k.source=source.id; k.sourceLabel=source.label; k.matchScore=scoreKnowledgeV2848(k, confirmed, source); attempts.push({source:source.id,score:k.matchScore,name:k.productName,brand:k.brand,category:k.category}); if(!best || k.matchScore>best.matchScore) best=k; }
        else attempts.push({source:source.id,miss:true});
      }catch(err){ attempts.push({source:source.id,error:String(err?.message||err).slice(0,80)}); }
    }
    if(!best || Number(best.matchScore||0)<1.5){ const val={knowledge:null,attempts,reason:'no_reliable_multi_source_match'}; setKnowledgeCache(cacheKey,val); return val; }
    const val={knowledge:best,attempts,reason:'multi_source_match'}; setKnowledgeCache(cacheKey,val); return val;
  }
  async function externalVisualAssist(payload={}, result={}){
    const url=String(process.env.HOME_BRAIN_URL || process.env.VISION_EXTERNAL_MATCH_URL || '').trim();
    if(!url || !payload?.image || !String(payload.image).startsWith('data:image/')) return null;
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(), Number(process.env.VISION_EXTERNAL_MATCH_TIMEOUT_MS||2600));
    try{
      const body={image:payload.image, stage:payload.stage||'product', current:result, evidence:{productName:result.productName||'',brand:result.brand||'',category:result.category||'',detectedText:result.detectedText||[],visibleEvidence:result.visibleEvidence||[]}, source:'spesa_pronta_render_v2848'};
      const headers={'Content-Type':'application/json'}; if(process.env.HOME_BRAIN_TOKEN||process.env.VISION_EXTERNAL_MATCH_TOKEN) headers.Authorization='Bearer '+String(process.env.HOME_BRAIN_TOKEN||process.env.VISION_EXTERNAL_MATCH_TOKEN);
      const r=await fetch(String(url).replace(/\/$/,'')+'/api/home/analyze-product',{method:'POST',headers,body:JSON.stringify(body),signal:ctrl.signal});
      if(!r.ok) return null; const data=await r.json().catch(()=>null); if(!data||data.ok===false) return null;
      return data.result || data.product || data;
    }catch(_){ return null; }
    finally{ clearTimeout(timer); }
  }
  function mergeTrustedAssist(base={}, assist={}, source='assist'){
    if(!assist || typeof assist!=='object') return base;
    const out=Object.assign({}, base); const t=ev(assist); const inf=inferCategory(t || ev(base));
    const conf=Number(assist.confidence||assist.matchConfidence||0);
    const strong=hasConcreteIdentity(assist) || inf.category || conf>=.78;
    if(!strong) return base;
    for(const k of ['productName','brand','variant','productType','packageType','estimatedSize','sizeDetectedRaw','unit','barcode','expiryDate']) if(assist[k] && (!out[k] || /da confermare|identificare/i.test(String(out[k])) || conf>=.82)) out[k]=assist[k];
    if(inf.category || assist.category) out.category=inf.category || assist.category;
    if(Array.isArray(assist.detectedText)) out.detectedText=[...new Set([...(out.detectedText||[]),...assist.detectedText])].slice(0,20);
    if(Array.isArray(assist.visibleEvidence)) out.visibleEvidence=[...new Set([...(out.visibleEvidence||[]),...assist.visibleEvidence, source])].slice(0,20); else out.visibleEvidence=[...new Set([...(out.visibleEvidence||[]), source])].slice(0,20);
    out.confidence=Math.max(Number(out.confidence||0), Math.min(.96, conf||.74)); out.needsManual=out.confidence<.92; out.shouldAskConfirmation=true;
    out.proAssistV2848={source,confidence:conf||null,accepted:true};
    return blockImpossibleCategory(out);
  }
  try{ if(typeof normalizeVisionResult==='function' && !global.__v2848NormalizeVisionWrapped){ const prev=normalizeVisionResult; normalizeVisionResult=function(obj){ return blockImpossibleCategory(prev.call(this,obj)); }; global.__v2848NormalizeVisionWrapped=true; } }catch(_){ }
  try{ if(typeof applyRealityCategoryServer==='function' && !global.__v2848RealityCategoryWrapped){ const prev=applyRealityCategoryServer; applyRealityCategoryServer=function(result){ return blockImpossibleCategory(prev.call(this,result)||result); }; global.__v2848RealityCategoryWrapped=true; } }catch(_){ }
  try{ if(typeof internetCategoryLookupServer==='function' && !global.__v2848InternetCategoryWrapped){ const prev=internetCategoryLookupServer; internetCategoryLookupServer=async function(payload={}){ const confirmed={productName:payload.productName||'',brand:payload.brand||'',category:payload.currentCategory||'',productType:payload.productType||'',packageType:payload.packageType||'',detectedText:payload.detectedText||[],visibleEvidence:payload.visibleEvidence||[]}; const local=blockImpossibleCategory(Object.assign({},confirmed)); const ms=await multiSourceKnowledgeLookup(confirmed).catch(()=>null); if(ms?.knowledge){ const k=ms.knowledge; const cat=blockImpossibleCategory({productName:k.productName,brand:k.brand,category:k.category,detectedText:confirmed.detectedText,visibleEvidence:[k.sourceLabel||k.source]}).category || k.category; return {category:cat,confidence:Math.max(.78, Number(k.confidence==='barcode' ? .96 : (k.confidence||.75))),source:'multi-source '+(k.sourceLabel||k.source),reason:'Confronto API multi-source PRO V28.48',ingredients:k.ingredients||[],allergens:[...(k.allergens||[]),...(k.traces||[])],webProductName:k.productName||'',webBrand:k.brand||'',attempts:ms.attempts||[]}; } const out=await prev.call(this,payload); return blockImpossibleCategory(Object.assign({},out,{productName:confirmed.productName,brand:confirmed.brand,detectedText:confirmed.detectedText,visibleEvidence:confirmed.visibleEvidence})); }; global.__v2848InternetCategoryWrapped=true; } }catch(_){ }
  try{ if(typeof enrichConfirmedProductWithKnowledge==='function' && !global.__v2848KnowledgeFeederWrapped){ const prev=enrichConfirmedProductWithKnowledge; enrichConfirmedProductWithKnowledge=async function(confirmed={}){ let base=blockImpossibleCategory(Object.assign({},confirmed)); const ms=await multiSourceKnowledgeLookup(base).catch(()=>null); if(ms?.knowledge){ const merged=mergeExternalKnowledgeIntoConfirmed(base, ms.knowledge); merged.knowledgeFeeder=Object.assign({}, merged.knowledgeFeeder||{}, {multiSource:true, version:'V28.48', attempts:ms.attempts||[], source:ms.knowledge.source, sourceLabel:ms.knowledge.sourceLabel}); return {confirmed:blockImpossibleCategory(merged), knowledge:ms.knowledge, skipped:false, multiSource:true, attempts:ms.attempts||[]}; } const old=await prev.call(this,base); if(old&&old.confirmed) old.confirmed=blockImpossibleCategory(old.confirmed); return old; }; global.__v2848KnowledgeFeederWrapped=true; } }catch(_){ }
  try{ if(typeof visionAnalyze==='function' && !global.__v2848VisionAnalyzeWrapped){ const prev=visionAnalyze; visionAnalyze=async function(payload={}){ let r=blockImpossibleCategory(await prev.call(this,payload)); if(payload?.image && !r.visualSignature){ r.visualSignature='sha256:'+hashStable(String(payload.image).slice(0,250000)).slice(0,32); }
      const weak=!hasConcreteIdentity(r) || Number(r.confidence||0)<.62 || r.forceTeacher || /identificare|da confermare/i.test(String(r.productName||'')+' '+String(r.estimatedSize||''));
      if(weak){ const ext=await externalVisualAssist(payload,r).catch(()=>null); if(ext) r=mergeTrustedAssist(r,ext,'external/home-brain visual assist V28.48'); }
      r=blockImpossibleCategory(r); r.proVisionV2848=Object.assign({}, r.proVisionV2848||{}, {knowledgeCore:true, multiSourceApis:'open_facts_family', externalVisualAssistConfigured:!!(process.env.HOME_BRAIN_URL||process.env.VISION_EXTERNAL_MATCH_URL), noColorHallucination:true}); return r; }; global.__v2848VisionAnalyzeWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.48 PRO Vision Knowledge Fusion Core active');
})();
// =============================================================
// V28.49 PRO CHATGPT-LEVEL VISION JUDGE
// Obiettivo: ragionamento generale tipo docente, non fix singoli prodotti.
// - Separa identita' prodotto da ingredienti/allergeni/tracce: le tracce NON creano nome/categoria.
// - Categorie solo da prove forti: OCR/etichetta, barcode, memoria owner, API prodotto affidabili.
// - Colori/forma/confezione sono indizi deboli e non possono mai decidere da soli.
// - Visual API opzionali e low-cost: disattive senza env, timeout corto, cache, mai usate per inventare nome.
// =============================================================
(function(){
  const V='28.49';
  function n(s){ try{ return normalizeVisionText(s||''); }catch(_){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); } }
  function a(v){ return Array.isArray(v)?v.filter(Boolean):[]; }
  function uniq(v,limit=40){ return [...new Set((Array.isArray(v)?v:[v]).flat().map(x=>String(x||'').trim()).filter(Boolean))].slice(0,limit); }
  function first(v){ return Array.isArray(v)?(v[0]||''):(v||''); }
  function cleanVisibleEvidenceForIdentity(r={}){ return a(r.visibleEvidence).filter(x=>!/^(PRO\s+V|Cervello PRO|server_|client_|external\/home-brain|huggingface:|google_vision:)/i.test(String(x||'').trim())); }
  function textIdentity(r={}){
    return n([
      r.productName,r.brand,r.variant,r.productType,r.packageType,r.category,r.estimatedSize,r.sizeDetectedRaw,r.size,r.format,r.unit,r.barcode,r.ean,r.code,r.productCode,
      ...(r.barcodes||[]), ...(r.detectedText||[]), ...cleanVisibleEvidenceForIdentity(r), ...(r.labels||[]), r.packaging
    ].filter(Boolean).join(' '));
  }
  function textDeep(r={}){
    return n([textIdentity(r), ...(r.ingredients||[]), r.ingredientsText, ...(r.allergens||[]), ...(r.possibleTraces||[]), ...(r.traces||[]), ...(r.colors||[])].filter(Boolean).join(' '));
  }
  function hasWord(txt, words){ return new RegExp('\\b('+words.join('|')+')\\b','i').test(txt||''); }
  const GENERIC_NAME=/\b(prodotto|articolo|oggetto|confezione|bottiglia|flacone|barattolo|vasetto|busta|scatola|pack|bevanda|cibo|alimento|verdura|frutta|manual|auto|live|da identificare|nome prodotto|unknown|generico)\b/i;
  const COLOR_ONLY=/\b(verde|rosso|blu|azzurro|giallo|arancione|nero|bianco|viola|rosa|colore|colori|chiaro|scuro|bottiglia|flacone|barattolo|vasetto|busta|scatola)\b/i;
  const LEX={
    laundry:{cat:'laundry',family:'house',weight:9,rx:/(bucato|lavatrice|ammorbidente|candeggina delicata|detersivo lavatrice|detergente lavatrice|caps lavatrice|pods lavatrice|lavaggi|colori sicuri|capi colorati|smacchiatore|igienizzante bucato|lana e seta|profuma bucato)/i},
    cleaning:{cat:'cleaning',family:'house',weight:8,rx:/(candeggina|bleach|detersivo|detergente|sgrassatore|disinfettante|igienizzante|pulizia|pavimenti|bagno|wc|vetri|superfici|anticalcare|antimuffa|muffa|spray multiuso|pulitore|sanificante|cloro|ipoclorito|dexal|ace|chanteclair|lysoform|quasar|mastro lindo|ajax|napisan|smac)/i},
    dishwashing:{cat:'dishwashing',family:'house',weight:8,rx:/(lavastoviglie|brillantante|pastiglie lavastoviglie|tabs lavastoviglie|caps lavastoviglie|detersivo piatti|piatti concentrato|svelto|nelsen|finish|pril|fairy piatti)/i},
    paper_house:{cat:'paper_house',family:'house',weight:6,rx:/(carta igienica|carta casa|rotoloni|scottex|tovaglioli|fazzoletti|pellicola|alluminio|sacchetti freezer|sacchi spazzatura|carta forno)/i},
    insect_home:{cat:'cleaning',family:'house',weight:5,rx:/(insetticida|zanzare|mosche|formiche|scarafaggi|antitarme|repellente insetti)/i},
    water:{cat:'water',family:'drinks',weight:7,rx:/(acqua minerale|acqua naturale|acqua frizzante|acqua effervescente|oligominerale|levissima|sant.?anna|san benedetto|vera|lete|ferrarelle|uliveto|rocchetta|panna|evian|vitasnella)/i},
    tea_juice:{cat:'juice',family:'drinks',weight:7,rx:/(succo|nettare|spremuta|bevanda alla frutta|t[eè] freddo|the freddo|th[eè] freddo|ice tea|ice the|estath[eè]|th[eè] fusion|the fusion|pesca e rosa|ace succo|multivitaminico|arancia rossa|pera succo|albicocca succo)/i},
    soft_drinks:{cat:'soft_drinks',family:'drinks',weight:7,rx:/(coca.?cola|pepsi|fanta|sprite|aranciata|chinotto|gassosa|cedrata|tonica|cola zero|bibita gassata|bevanda gassata|soft drink|soda|red bull|monster energy|energy drink)/i},
    milk_drinks:{cat:'milk_drinks',family:'drinks',weight:7,rx:/(latte uht|latte fresco|latte intero|latte scremato|latte parzialmente scremato|latte alta digeribilita|senza lattosio|bevanda al latte|latte microfiltrato)/i},
    coffee_tea:{cat:'coffee_tea',family:'food',weight:6,rx:/(caffe|caff[eè]|capsule caffe|cialde caffe|te in filtri|t[eè] in filtri|camomilla|infuso|tisane|orzo solubile)/i},
    yogurt:{cat:'yogurt',family:'food',weight:7,rx:/(yogurt|kefir|skyr|actimel|activia|yomo|muller|fage|greco bianco|fermenti lattici)/i},
    dairy:{cat:'dairy',family:'food',weight:6,rx:/(mozzarella|formaggio|parmigiano|grana|ricotta|stracchino|philadelphia|burro|panna da cucina|mascarpone|provola|scamorza|emmental|pecorino|gorgonzola|fiocchi di latte)/i},
    eggs:{cat:'eggs',family:'food',weight:6,rx:/(uova|uovo|albumi|tuorlo|ovoprodotto)/i},
    pasta_rice:{cat:'pasta_rice',family:'food',weight:6,rx:/(pasta|spaghetti|penne|fusilli|rigatoni|orecchiette|tagliatelle|riso|risotto|cous cous|quinoa|gnocchi secchi)/i},
    flour_baking:{cat:'flour_baking',family:'food',weight:5,rx:/(farina|semola|zucchero|lievito|fecola|amido|pangrattato|preparato per torta|vanillina|cacao amaro|zucchero a velo)/i},
    bakery:{cat:'bakery',family:'food',weight:5,rx:/(pane|pan bauletto|piadina|cracker|grissini|taralli|fette biscottate|cornetto|brioche|panini|toast)/i},
    breakfast_cereals:{cat:'breakfast_cereals',family:'food',weight:5,rx:/(cereali|corn flakes|muesli|granola|fiocchi d avena|avena|nesquik cereal|kellogg|fitness cereali)/i},
    sweets:{cat:'chocolate_sweets',family:'food',weight:5,rx:/(cioccolato|cioccolata|tavoletta|pralina|caramelle|dolci|merendina|biscotti|wafer|torrone|cremino|snack dolce|crostatina)/i},
    spreads:{cat:'spreads',family:'food',weight:5,rx:/(crema spalmabile|nutella|nocciolata|burro di arachidi|crema pistacchio|pistacchio spalmabile)/i},
    jams_honey:{cat:'jams_honey',family:'food',weight:5,rx:/(marmellata|confettura|miele|composta|sciroppo d acero)/i},
    sauces:{cat:'sauces_condiments',family:'food',weight:6,rx:/(pesto|salsa|sugo|passata|rag[uù]|bbq|barbecue|ketchup|maionese|senape|condimento|besciamella|hummus|salsa soia|tabasco|pat[eè] olive)/i},
    oil_vinegar:{cat:'oil_vinegar',family:'food',weight:6,rx:/(olio extravergine|olio extra vergine|olio evo|olio di oliva|olio di semi|aceto|balsamico|glassa gastronomica)/i},
    spices_broths:{cat:'spices_broths',family:'food',weight:5,rx:/(sale|pepe|spezie|origano|basilico secco|rosmarino|dado|brodo|zafferano|paprika|curry|cannella)/i},
    preserves:{cat:'preserves_jars',family:'food',weight:5,rx:/(pelati|polpa di pomodoro|passata|conserva|sottoli|sottaceti|olive|capperi|mais|ceci|fagioli|lenticchie|legumi|piselli in scatola)/i},
    canned_protein:{cat:'canned_fish_meat',family:'food',weight:5,rx:/(tonno|sgombro|salmone in scatola|filetti di acciughe|carne in scatola|simmenthal)/i},
    frozen:{cat:'frozen',family:'food',weight:5,rx:/(surgelato|surgelati|congelato|congelati|findus|4 salti|bastoncini|spinaci surgelati|pizza surgelata|minestrone surgelato)/i},
    ready:{cat:'ready_meals',family:'food',weight:4,rx:/(piatto pronto|lasagne|zuppa pronta|vellutata|insalata russa|gastronomia|risotto pronto|meal prep)/i},
    meat:{cat:'meat_deli',family:'food',weight:5,rx:/(prosciutto|salame|mortadella|bresaola|wurstel|salsiccia|pollo|tacchino|hamburger|carne|speck|pancetta|affettato)/i},
    fish:{cat:'fish',family:'food',weight:5,rx:/(pesce|orata|spigola|merluzzo|gamberi|salmone fresco|tonno fresco|cozze|vongole|polpo|calamari)/i},
    fruit:{cat:'fruit',family:'fresh',weight:6,rx:/(mela|mele|banana|banane|arancia|arance|limone|limoni|fragola|fragole|uva|pera|pere|kiwi|albicocca|ciliegia|ananas|melone|anguria|frutta fresca|clementine|mandarini)/i},
    veg:{cat:'veg',family:'fresh',weight:6,rx:/(insalata|lattuga|pomodoro|pomodori|zucchina|zucchine|melanzana|melanzane|carota|carote|cipolla|cipolle|patata|patate|broccoli|spinaci|finocchio|peperone|peperoni|ortaggi|verdura fresca|rucola|cetriolo|cavolfiore)/i},
    baby:{cat:'baby_food',family:'food',weight:5,rx:/(omogeneizzato|latte crescita|pappa|biscotto bambini|baby food|mellin|plasmon|hipp)/i},
    beauty:{cat:'personal_care',family:'beauty',weight:6,rx:/(sapone|bagnoschiuma|docciaschiuma|deodorante|crema corpo|shampoo|balsamo|gel capelli|rasoio|schiuma barba|assorbenti|salviette intime|detergente intimo)/i},
    oral:{cat:'oral_care',family:'beauty',weight:6,rx:/(dentifricio|spazzolino|collutorio|filo interdentale|oral b|mentadent|az|sensodyne|colgate|parodontax)/i},
    pharmacy:{cat:'pharmacy',family:'pharmacy',weight:5,rx:/(tachipirina|ibuprofene|farmaco|medicinale|cerotti|garza|disinfettante cute|integratore|vitamina|termometro|spray nasale|paracetamolo)/i},
    pet_food:{cat:'pet_food',family:'pets',weight:6,rx:/(crocchette|umido cane|umido gatto|pat[eè] cane|pat[eè] gatto|monge|royal canin|purina|whiskas|friskies|cibo cane|cibo gatto|snack cane|snack gatto)/i},
    aquarium:{cat:'aquarium',family:'aquarium',weight:6,rx:/(acquario|pesci|mangime pesci|biocondizionatore|batteri acquario|fertilizzante acquario|sera|tetra|askoll|jbl acquario)/i}
  };
  const CAT_SUPPORT={
    laundry:/(bucato|lavatrice|ammorbidente|candeggina|detersivo|colori sicuri|capi|smacchiatore)/i,
    cleaning:/(candeggina|detersivo|detergente|sgrassatore|disinfettante|pulizia|pavimenti|bagno|wc|vetri|anticalcare|muffa)/i,
    dishwashing:/(lavastoviglie|brillantante|piatti|pastiglie|tabs|svelto|finish|pril)/i,
    water:/(acqua|minerale|naturale|frizzante|oligominerale)/i,
    juice:/(succo|nettare|t[eè]|the|th[eè]|ice tea|spremuta|bevanda alla frutta)/i,
    soft_drinks:/(cola|pepsi|fanta|sprite|aranciata|gassosa|chinotto|gassata|soda|energy drink)/i,
    milk_drinks:/(latte uht|latte fresco|latte intero|latte scremato|bevanda al latte|senza lattosio)/i,
    yogurt:/(yogurt|kefir|skyr|fermenti)/i,
    dairy:/(mozzarella|formaggio|parmigiano|grana|ricotta|burro|panna|mascarpone)/i,
    veg:LEX.veg.rx,
    fruit:LEX.fruit.rx,
    pet_food:LEX.pet_food.rx,
    aquarium:LEX.aquarium.rx,
    personal_care:LEX.beauty.rx,
    oral_care:LEX.oral.rx
  };
  const FOOD_CATS=new Set(['food','drinks','water','soft_drinks','juice','milk_drinks','coffee_tea','yogurt','dairy','eggs','pasta_rice','flour_baking','bakery','breakfast_cereals','chocolate_sweets','spreads','jams_honey','sauces_condiments','oil_vinegar','spices_broths','preserves_jars','canned_fish_meat','frozen','ready_meals','meat_deli','fish','fruit','veg','baby_food']);
  const HOUSE_CATS=new Set(['house','cleaning','laundry','dishwashing','paper_house']);
  function infer(text=''){
    const t=n(text); const hits=[];
    for(const row of Object.values(LEX)){ if(row.rx.test(t)){ hits.push({cat:row.cat,family:row.family,weight:row.weight}); } }
    if(!hits.length) return {cat:'',confidence:0,family:'',hits:[]};
    const totals={}; const families={};
    for(const h of hits){ totals[h.cat]=(totals[h.cat]||0)+h.weight; families[h.cat]=h.family; }
    // casa/igiene vince su food generico, per evitare candeggina->verdura/bevanda.
    const sorted=Object.entries(totals).map(([cat,score])=>({cat,score,family:families[cat]})).sort((x,y)=>y.score-x.score);
    const house=sorted.find(x=>x.family==='house'||x.family==='beauty'||x.family==='pharmacy'||x.family==='pets'||x.family==='aquarium');
    const best=house && house.score>=6 ? house : sorted[0];
    const confidence=Math.max(.72, Math.min(.94, best.score/10));
    return {cat:best.cat,confidence,family:best.family,hits:sorted.slice(0,8)};
  }
  function categorySupportedByIdentity(cat='', idText=''){
    if(!cat) return false;
    if(CAT_SUPPORT[cat]) return CAT_SUPPORT[cat].test(idText||'');
    const inf=infer(idText); return inf.cat===cat || (FOOD_CATS.has(cat)&&inf.family==='food') || (HOUSE_CATS.has(cat)&&inf.family==='house');
  }
  function ingredientOnlyTrap(cat='', idText='', deep=''){
    if(!cat || categorySupportedByIdentity(cat,idText)) return false;
    const d=n(deep), i=n(idText);
    if(['milk_drinks','dairy','yogurt'].includes(cat) && /\b(latte|lattosio|milk|siero di latte|proteine del latte|tracce di latte)\b/i.test(d) && !/\b(latte uht|latte fresco|yogurt|kefir|mozzarella|formaggio|burro|panna)\b/i.test(i)) return true;
    if(['eggs'].includes(cat) && /\b(uova|uovo|albumi|tracce di uova)\b/i.test(d) && !/\b(uova|uovo|albumi)\b/i.test(i)) return true;
    if(['fruit','veg'].includes(cat) && /\b(frutta|verdura|vegetale|ortaggi)\b/i.test(d) && !categorySupportedByIdentity(cat,i)) return true;
    return false;
  }
  function concreteIdentity(r={}){
    const id=textIdentity(r); const name=n(r.productName||''); const brand=n(r.brand||'');
    if(/\b\d{8,14}\b/.test(id)) return true;
    if(name && !GENERIC_NAME.test(name) && name.length>=3) return true;
    if(brand.length>=2 && infer(id).cat) return true;
    const evidence=[...(r.detectedText||[]),...(r.visibleEvidence||[])].join(' ').trim();
    if(evidence.length>=8 && infer(id).cat) return true;
    return false;
  }
  function shouldTeacher(r={}){
    return !concreteIdentity(r) || /identificare|da confermare/i.test(String(r.productName||'')) || Number(r.confidence||0)<.66 || r.forceTeacher;
  }
  function enforce(r={}, source='server'){
    if(!r || typeof r!=='object') return r;
    const out=Object.assign({}, r); const id=textIdentity(out); const deep=textDeep(out); const inf=infer(id); const before=String(out.category||'');
    const warnings=[]; let corrected=false;
    if(inf.cat){
      if(before && before!==inf.cat) warnings.push(`categoria corretta: ${before} -> ${inf.cat}`);
      out.category=inf.cat; out.categoryRuleSource='pro_semantic_judge_v2849'; out.categoryWebNeeded=false; corrected=true;
      out.confidence=Math.max(Number(out.confidence||0), Math.min(.93, inf.confidence));
    }
    if(before && !inf.cat && ingredientOnlyTrap(before,id,deep)){
      warnings.push('blocco ingrediente/traccia usata come identita');
      out.category=FOOD_CATS.has(before)?'food':(HOUSE_CATS.has(before)?'house':'');
      out.needsManual=true; out.shouldAskConfirmation=true; out.forceTeacher=true; out.categoryWebNeeded=false; out.confidence=Math.min(Number(out.confidence||.4),.42); corrected=true;
    }
    if(['veg','fruit'].includes(String(out.category||'')) && !categorySupportedByIdentity(out.category,id)){
      warnings.push('blocco ortofrutta senza nome reale di frutta/verdura');
      out.category=inf.cat && !['veg','fruit'].includes(inf.cat)?inf.cat:'food'; out.needsManual=true; out.shouldAskConfirmation=true; out.forceTeacher=true; out.categoryWebNeeded=false; out.confidence=Math.min(Number(out.confidence||.4),.38); corrected=true;
      if(!out.productName || GENERIC_NAME.test(String(out.productName))) out.productName='Prodotto da identificare';
    }
    if(['water','juice','soft_drinks','milk_drinks'].includes(String(out.category||'')) && !categorySupportedByIdentity(out.category,id)){
      warnings.push('blocco bevanda precisa senza prova etichetta');
      out.category='drinks'; out.needsManual=true; out.shouldAskConfirmation=true; out.forceTeacher=true; out.categoryWebNeeded=false; out.confidence=Math.min(Number(out.confidence||.45),.45); corrected=true;
    }
    if((HOUSE_CATS.has(before)||FOOD_CATS.has(before)) && inf.family==='house' && FOOD_CATS.has(before)){
      warnings.push('prodotto casa batte contaminazione alimentare');
      out.category=inf.cat; corrected=true;
    }
    const generic=!concreteIdentity(out);
    const justColor=COLOR_ONLY.test(id) && !inf.cat && !/\b\d{8,14}\b/.test(id);
    if(generic && (justColor || Number(out.confidence||0)<.66)){
      if(!out.productName || GENERIC_NAME.test(String(out.productName))) out.productName='Prodotto da identificare';
      out.needsManual=true; out.shouldAskConfirmation=true; out.forceTeacher=true; out.categoryWebNeeded=false;
      out.detailQuestion=out.detailQuestion||'Serve etichetta leggibile, barcode o docente: il cervello PRO non inventa da colore/forma.';
      out.confidence=Math.min(Number(out.confidence||.42), .48);
    }
    out.visibleEvidence=Array.isArray(out.visibleEvidence)?out.visibleEvidence:[];
    for(const w of warnings){ if(!out.visibleEvidence.includes('PRO V28.49: '+w)) out.visibleEvidence.push('PRO V28.49: '+w); }
    out.proVisionJudgeV2849={active:true,source,identityTextLength:id.length,inferredCategory:inf.cat||'',inferredFamily:inf.family||'',confidence:inf.confidence||0,concreteIdentity:concreteIdentity(out),teacherRequired:shouldTeacher(out),corrected,blocked:warnings,policy:'owner values > barcode > current label/OCR > Open Facts/API > server memory > OpenAI teacher; ingredients/traces and colors never define identity'};
    return out;
  }
  function dataUrlInfo(dataUrl=''){
    const m=String(dataUrl||'').match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if(!m) return null;
    const b64=m[2].replace(/\s+/g,'');
    return {mime:m[1].toLowerCase(),base64:b64,bytes:Math.round(b64.length*3/4)};
  }
  function labelsToAssist(labels=[], provider='visual_api'){
    const clean=uniq((labels||[]).map(x=>typeof x==='string'?x:(x.label||x.name||x.description||x.class||x.concept||'')),20);
    if(!clean.length) return null;
    const txt=n(clean.join(' ')); const inf=infer(txt);
    // Le API visive esterne validano solo famiglia/categoria ampia; non inventano nome o marca.
    return {confidence:.64, category:inf.cat||'', visibleEvidence:clean.map(x=>provider+': '+x).slice(0,12), detectedText:[], proVisualLabelsV2849:clean, source:provider, matchConfidence:inf.cat?0.68:0.55};
  }
  async function callHuggingFaceLabels(dataUrl=''){
    const enabled=/^true$/i.test(String(process.env.VISION_VISUAL_APIS_ENABLED||process.env.HF_VISION_ENABLED||'false'));
    const token=String(process.env.HF_API_TOKEN||process.env.HUGGINGFACE_API_TOKEN||process.env.HUGGING_FACE_HUB_TOKEN||'').trim();
    if(!enabled || !token) return null;
    const info=dataUrlInfo(dataUrl); if(!info || info.bytes>Number(process.env.VISION_EXTERNAL_MAX_IMAGE_BYTES||900000)) return null;
    const model=String(process.env.HF_VISION_MODEL||'google/vit-base-patch16-224').trim();
    const url=String(process.env.HF_VISION_API_URL||`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`).trim();
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(), Number(process.env.VISION_EXTERNAL_MATCH_TIMEOUT_MS||2600));
    try{
      const buf=Buffer.from(info.base64,'base64');
      const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':info.mime,'Accept':'application/json'},body:buf,signal:ctrl.signal});
      if(!r.ok) return null;
      const data=await r.json().catch(()=>null); const arr=Array.isArray(data)?data:(Array.isArray(data?.labels)?data.labels:[]);
      const labels=arr.map(x=>({label:x.label||x.name||'',score:x.score||x.confidence||0})).filter(x=>x.label).slice(0,10);
      return labelsToAssist(labels,'huggingface');
    }catch(_){ return null; } finally{ clearTimeout(timer); }
  }
  async function callGoogleVisionLabels(dataUrl=''){
    const enabled=/^true$/i.test(String(process.env.VISION_PAID_APIS_ENABLED||process.env.GOOGLE_VISION_ENABLED||'false'));
    const key=String(process.env.GOOGLE_VISION_API_KEY||'').trim();
    if(!enabled || !key) return null;
    const info=dataUrlInfo(dataUrl); if(!info || info.bytes>Number(process.env.VISION_EXTERNAL_MAX_IMAGE_BYTES||900000)) return null;
    const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(), Number(process.env.VISION_EXTERNAL_MATCH_TIMEOUT_MS||2600));
    try{
      const body={requests:[{image:{content:info.base64},features:[{type:'LABEL_DETECTION',maxResults:8},{type:'OBJECT_LOCALIZATION',maxResults:8}]}]};
      const r=await fetch('https://vision.googleapis.com/v1/images:annotate?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body),signal:ctrl.signal});
      if(!r.ok) return null; const data=await r.json().catch(()=>null); const resp=data?.responses?.[0]||{};
      const labels=[...(resp.labelAnnotations||[]).map(x=>x.description), ...(resp.localizedObjectAnnotations||[]).map(x=>x.name)].filter(Boolean).slice(0,14);
      return labelsToAssist(labels,'google_vision');
    }catch(_){ return null; } finally{ clearTimeout(timer); }
  }
  async function visualApisAssist(payload={}, baseResult={}){
    if(!payload?.image || !String(payload.image).startsWith('data:image/')) return null;
    const id=textIdentity(baseResult); const cacheKey='visual_v2849|'+hashStable(String(payload.image).slice(0,180000)+id).slice(0,32);
    try{ const c=typeof getKnowledgeCache==='function'?getKnowledgeCache(cacheKey):null; if(c?.assist) return Object.assign({cacheHit:true}, c.assist); }catch(_){ }
    const attempts=[]; let assist=null;
    for(const fn of [callHuggingFaceLabels, callGoogleVisionLabels]){
      const row=await fn(payload.image).catch(()=>null);
      attempts.push({adapter:fn.name,hit:!!row,category:row?.category||''});
      if(row && (row.category || (row.visibleEvidence||[]).length)){ assist=row; break; }
    }
    if(assist){ assist.attempts=attempts; try{ if(typeof setKnowledgeCache==='function') setKnowledgeCache(cacheKey,{assist,updatedAt:Date.now()}); }catch(_){ } return assist; }
    try{ if(typeof setKnowledgeCache==='function') setKnowledgeCache(cacheKey,{assist:null,attempts,reason:'no_visual_api_hit',updatedAt:Date.now()}); }catch(_){ }
    return null;
  }
  function mergeAssist(base={}, assist=null){
    if(!assist) return base;
    const out=Object.assign({},base); const inf=infer(textIdentity(assist));
    out.visibleEvidence=uniq([...(out.visibleEvidence||[]),...(assist.visibleEvidence||[])],24);
    out.proExternalVisualV2849={source:assist.source||'visual_api',labels:assist.proVisualLabelsV2849||[],category:assist.category||'',attempts:assist.attempts||[],cacheHit:!!assist.cacheHit,policy:'visual labels validate only broad family, never product identity'};
    if(!categorySupportedByIdentity(out.category||'', textIdentity(out)) && assist.category && inf.cat){
      out.category=inf.cat; out.needsManual=true; out.shouldAskConfirmation=true; out.confidence=Math.max(Number(out.confidence||0), .62);
    }
    return enforce(out,'external_visual_api');
  }
  try{ if(typeof normalizeVisionResult==='function' && !global.__v2849NormalizeVisionWrapped){ const prev=normalizeVisionResult; normalizeVisionResult=function(obj){ return enforce(prev.call(this,obj),'normalize'); }; global.__v2849NormalizeVisionWrapped=true; } }catch(_){ }
  try{ if(typeof applyRealityCategoryServer==='function' && !global.__v2849RealityCategoryWrapped){ const prev=applyRealityCategoryServer; applyRealityCategoryServer=function(result){ return enforce(prev.call(this,result)||result,'reality_category'); }; global.__v2849RealityCategoryWrapped=true; } }catch(_){ }
  try{ if(typeof internetCategoryLookupServer==='function' && !global.__v2849InternetCategoryWrapped){ const prev=internetCategoryLookupServer; internetCategoryLookupServer=async function(payload={}){ const guarded=enforce({productName:payload.productName||'',brand:payload.brand||'',category:payload.currentCategory||'',productType:payload.productType||'',packageType:payload.packageType||'',detectedText:payload.detectedText||[],visibleEvidence:payload.visibleEvidence||[]},'category_lookup_pre'); if(guarded.category && guarded.proVisionJudgeV2849?.concreteIdentity){ return {ok:true,category:guarded.category,confidence:Math.max(.76,guarded.proVisionJudgeV2849.confidence||0),source:'pro_semantic_judge_v2849',reason:'Categoria decisa da OCR/etichetta/marca, senza ricerca sprecata',proVisionJudgeV2849:guarded.proVisionJudgeV2849}; } const out=await prev.call(this,payload); return enforce(Object.assign({},out,{productName:payload.productName||'',brand:payload.brand||'',detectedText:payload.detectedText||[],visibleEvidence:payload.visibleEvidence||[]}), 'category_lookup_post'); }; global.__v2849InternetCategoryWrapped=true; } }catch(_){ }
  try{ if(typeof enrichConfirmedProductWithKnowledge==='function' && !global.__v2849KnowledgeWrapped){ const prev=enrichConfirmedProductWithKnowledge; enrichConfirmedProductWithKnowledge=async function(confirmed={}){ const guarded=enforce(Object.assign({},confirmed),'knowledge_pre'); const old=await prev.call(this,guarded); if(old&&old.confirmed) old.confirmed=enforce(old.confirmed,'knowledge_post'); return old; }; global.__v2849KnowledgeWrapped=true; } }catch(_){ }
  try{ if(typeof visionAnalyze==='function' && !global.__v2849VisionAnalyzeWrapped){ const prev=visionAnalyze; visionAnalyze=async function(payload={}){ let r=enforce(await prev.call(this,payload),'vision_post'); if(payload?.image && !r.visualSignature){ r.visualSignature='sha256:'+hashStable(String(payload.image).slice(0,280000)).slice(0,40); }
      if(shouldTeacher(r)){ const va=await visualApisAssist(payload,r).catch(()=>null); if(va) r=mergeAssist(r,va); }
      r=enforce(r,'vision_final'); r.proVisionV2849=Object.assign({}, r.proVisionV2849||{}, {semanticJudge:true, ingredientTraceIsolation:true, externalVisualApisConfigured:!!(process.env.HOME_BRAIN_URL||process.env.VISION_EXTERNAL_MATCH_URL||process.env.HF_API_TOKEN||process.env.GOOGLE_VISION_API_KEY), visualApisEnabled:/^true$/i.test(String(process.env.VISION_VISUAL_APIS_ENABLED||process.env.HF_VISION_ENABLED||process.env.VISION_PAID_APIS_ENABLED||process.env.GOOGLE_VISION_ENABLED||'false')), noPaidApiWithoutFlag:true, noColorShapeIdentity:true}); return r; }; global.__v2849VisionAnalyzeWrapped=true; } }catch(_){ }
  try{ if(typeof preflightSnapshotV98==='function' && !global.__v2849PreflightWrapped){ const prev=preflightSnapshotV98; preflightSnapshotV98=function(){ const snap=prev.call(this); snap.version='V28.49'; snap.brain=Object.assign({}, snap.brain||{}, {version:'V28.49', name:'PRO ChatGPT-Level Vision Judge', semanticJudge:'identity_vs_ingredients_isolated', visualApiAdapters:{homeBrain:!!process.env.HOME_BRAIN_URL,generic:!!process.env.VISION_EXTERNAL_MATCH_URL,huggingFace:!!process.env.HF_API_TOKEN,googleVision:!!process.env.GOOGLE_VISION_API_KEY,paidEnabled:/^true$/i.test(String(process.env.VISION_PAID_APIS_ENABLED||process.env.GOOGLE_VISION_ENABLED||'false'))}}); return snap; }; global.__v2849PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.49 PRO ChatGPT-Level Vision Judge active');
})();



// =============================================================
// V28.50 PRO EXPIRY + MICRO IDENTITY TEACHER
// Correzione strutturale:
// - OCR scadenze a puntini/dot-matrix, anche senza parole SCAD/EXP.
// - Se il server locale non ha identità forte, usa una micro-chiamata OpenAI a basso token
//   sulla foto compressa/leggera solo per nome, marca e categoria, poi lascia API/cache fare il resto.
// - Mai inventare nome/categoria da colore o forma.
// =============================================================
(function(){
  const V='28.50';
  function norm2850(s){
    try{ return normalizeVisionText(s||''); }
    catch(_){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
  }
  function validExpiryParts2850(d,mo,y){
    d=Number(d); mo=Number(mo); y=Number(y);
    if(!Number.isFinite(d)||!Number.isFinite(mo)||!Number.isFinite(y)) return false;
    if(d<1||d>31||mo<1||mo>12) return false;
    if(y<2000||y>2055) return false;
    return true;
  }
  function fmtDate2850(d,mo,y){
    d=String(Number(d)).padStart(2,'0'); mo=String(Number(mo)).padStart(2,'0');
    y=String(y); if(y.length===2) y=(Number(y)<70?'20':'19')+y;
    return validExpiryParts2850(d,mo,y) ? `${d}/${mo}/${y}` : '';
  }
  function expiryFromText2850(input=''){
    const raw=String(input||'');
    if(!raw.trim()) return null;
    const clean=raw
      .replace(/[Oo]/g,'0')
      .replace(/[Il|]/g,'1')
      .replace(/[‚·•]/g,'.')
      .replace(/[–—_]/g,'-');
    const candidates=[];
    const push=(rawText,d,mo,y,confidence,kind)=>{
      const text=fmtDate2850(d,mo,y);
      if(text) candidates.push({text, raw:String(rawText||'').trim(), confidence, kind});
    };
    // Date classiche: 16/08/20, 16-08-2026, 16.08.26
    for(const m of clean.matchAll(/(^|[^0-9])([0-3]?\d)\s*[\/\.\-]\s*([01]?\d)\s*[\/\.\-]\s*(\d{2,4})(?!\d)/g)){
      push(m[0],m[2],m[3],m[4],.96,'separated');
    }
    // Date con spazi: SCAD 16 08 26 oppure stampa a puntini letta come spazi.
    for(const m of clean.matchAll(/(?:scad|scadenza|exp|tmc|entro|best\s*before|bb)?\s*\b([0-3]?\d)\s+([01]?\d)\s+(\d{2,4})\b/gi)){
      push(m[0],m[1],m[2],m[3],/scad|exp|tmc|entro/i.test(m[0])?.92:.78,'spaced');
    }
    // Date compatte: 160826 / 16082026 solo in contesto scadenza o se isolata corta.
    for(const m of clean.matchAll(/(?:scad|scadenza|exp|tmc|entro)?\s*\b(\d{6}|\d{8})\b/gi)){
      const s=m[1];
      if(s.length===6) push(m[0],s.slice(0,2),s.slice(2,4),s.slice(4,6),/scad|exp|tmc|entro/i.test(m[0])?.86:.68,'compact6');
      if(s.length===8) push(m[0],s.slice(0,2),s.slice(2,4),s.slice(4,8),/scad|exp|tmc|entro/i.test(m[0])?.90:.72,'compact8');
    }
    if(!candidates.length) return null;
    candidates.sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0));
    return candidates[0];
  }
  function applyExpiry2850(result={}, stage='auto'){
    const out=Object.assign({}, result||{});
    const sources=[out.expiryDate,out.expiryDetectedRaw,out.reason,out.detailQuestion]
      .concat(Array.isArray(out.detectedText)?out.detectedText:[])
      .concat(Array.isArray(out.visibleEvidence)?out.visibleEvidence:[])
      .filter(Boolean);
    let best=null;
    for(const s of sources){ const e=expiryFromText2850(s); if(e && (!best || e.confidence>best.confidence)) best=e; }
    if(best && (!out.expiryDate || String(stage||'').toLowerCase()==='expiry' || best.confidence>Number(out.expiryConfidence||0))){
      out.expiryDate=best.text;
      out.expiryDetectedRaw=best.raw;
      out.expiryConfidence=Math.max(Number(out.expiryConfidence||0), best.confidence);
      out.needsRetake=false;
      out.visibleEvidence=Array.isArray(out.visibleEvidence)?out.visibleEvidence:[];
      out.visibleEvidence.push(`Scadenza OCR PRO letta: ${best.raw} → ${best.text}`);
      out.proExpiryV2850={ok:true, raw:best.raw, expiryDate:best.text, confidence:best.confidence, kind:best.kind, stage:String(stage||'auto')};
    }else{
      out.proExpiryV2850=Object.assign({}, out.proExpiryV2850||{}, {ok:false, stage:String(stage||'auto'), policy:'se non legge data, non inventa; chiede foto più ravvicinata'});
    }
    return out;
  }
  function weakIdentity2850(r={}){
    const name=norm2850(r.productName||'');
    const brand=norm2850(r.brand||'');
    const cat=norm2850(r.category||'');
    const evidence=norm2850([r.productName,r.brand,r.variant,r.productType,r.packageType,r.reason,...(r.detectedText||[]),...(r.visibleEvidence||[])].join(' '));
    const generic=/^(|prodotto|prodotto da identificare|articolo|alimento|bevanda|bottiglia|confezione|oggetto|manual|foto|verdura|food|drinks|house)$/i.test(name) || /da identificare|da confermare|sembra|potrebbe|incerto/.test(name+' '+evidence);
    const noStrongText=!(/[a-z]{4,}/.test(evidence) && !/confezione|bottiglia|colore|verde|rosso|blu|chiaro|trasparente|formato|scadenza|lotto/.test(evidence.replace(/\b[a-z]{1,3}\b/g,'')));
    return generic || Number(r.confidence||0)<.58 || (!brand && noStrongText) || ['food','drinks','house',''].includes(cat);
  }
  async function microIdentityTeacher2850(payload={}, current={}){
    if(!payload || String(payload.stage||'auto').toLowerCase()==='expiry' || String(payload.stage||'auto').toLowerCase()==='barcode') return null;
    if(!aiConnected()) return null;
    const img = (payload.identityImageV2850 && String(payload.identityImageV2850).startsWith('data:image/'))
      ? payload.identityImageV2850
      : ((payload.teacherImage && String(payload.teacherImage).startsWith('data:image/')) ? payload.teacherImage : payload.image);
    if(!img || !String(img).startsWith('data:image/')) return null;
    const prompt=`MICRO IDENTIFICAZIONE PRODOTTO V28.50. Rispondi SOLO JSON valido. Usa pochissime parole. Obiettivo: leggere il nome/marca/categoria del prodotto centrale. Non leggere ingredienti/tracce/scadenza. Se il nome non è visibile, lascia productName vuoto. Non inventare da colore o forma. Categoria solo se supportata da etichetta/oggetto evidente. Schema: {"productName":"","brand":"","variant":"","category":"food|drinks|water|soft_drinks|juice|milk_drinks|coffee_tea|yogurt|dairy|sauces_condiments|spreads|pasta_rice|bakery|breakfast_snacks|chocolate_sweets|frozen|meat_deli|fish|fruit|veg|laundry|dishwashing|cleaning|paper_house|personal_care|oral_care|pharmacy|pet_food|pets|aquarium|house","estimatedSize":"","detectedText":[],"visibleEvidence":[],"confidence":0,"reason":""}`;
    try{
      const raw=await visionJsonCall('Sei un lettore etichetta ultra economico. SOLO JSON valido.', prompt, img, {maxTokens:VISION_MICRO_MAX_OUTPUT_TOKENS, stage:'micro'});
      const r=normalizeVisionResult(raw||{});
      const t=norm2850([r.productName,r.brand,r.category,...(r.detectedText||[]),...(r.visibleEvidence||[])].join(' '));
      if(!t || weakIdentity2850(r)) return null;
      r.proMicroIdentityV2850={used:true, maxTokens:VISION_MICRO_MAX_OUTPUT_TOKENS, policy:'low_token_identity_only_no_ingredients_no_expiry', source:'openai_micro_teacher'};
      return r;
    }catch(err){
      return {proMicroIdentityV2850:{used:false,error:String(err?.message||err).slice(0,160)}};
    }
  }
  function mergeMicroIdentity2850(base={}, micro=null){
    if(!micro || !micro.productName && !micro.brand && !micro.category) return base;
    const out=Object.assign({}, base||{});
    if(micro.productName && weakIdentity2850(out)) out.productName=micro.productName;
    if(micro.brand && (!out.brand || /generico|marca/i.test(out.brand))) out.brand=micro.brand;
    if(micro.variant && !out.variant) out.variant=micro.variant;
    if(micro.estimatedSize && (!out.estimatedSize || /confermare|formato/i.test(out.estimatedSize))) out.estimatedSize=micro.estimatedSize;
    if(micro.category && (!out.category || ['food','drinks','house','veg'].includes(out.category) || weakIdentity2850(out))) out.category=micro.category;
    out.detectedText=[...(out.detectedText||[]),...(micro.detectedText||[])].filter(Boolean).slice(0,18);
    out.visibleEvidence=[...(out.visibleEvidence||[]),...(micro.visibleEvidence||[]), 'Identità migliorata da micro docente low-token'].filter(Boolean).slice(0,18);
    out.confidence=Math.max(Number(out.confidence||0), Math.min(.78, Number(micro.confidence||0)+.05));
    out.needsManual=true;
    out.shouldAskConfirmation=true;
    out.cloudVision=!!out.cloudVision || true;
    out.proMicroIdentityV2850=micro.proMicroIdentityV2850 || {used:true};
    return out;
  }
  try{
    if(typeof applyOcrTextHeuristicsV2838==='function' && !global.__v2850ApplyOcrWrapped){
      const prev=applyOcrTextHeuristicsV2838;
      applyOcrTextHeuristicsV2838=function(result,stage){ return applyExpiry2850(prev.call(this,result,stage),stage); };
      global.__v2850ApplyOcrWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof visionAnalyze==='function' && !global.__v2850VisionAnalyzeWrapped){
      const prev=visionAnalyze;
      visionAnalyze=async function(payload={}){
        let r=await prev.call(this,payload);
        r=applyExpiry2850(r,payload.stage||'auto');
        if(weakIdentity2850(r)){
          // V28.51: niente doppia chiamata OpenAI di default. Se il primo docente ha già girato, non fare il micro-docente extra.
          if(!VISION_ALLOW_SECOND_OPENAI_PASS && (r.cloudVision || r.visionPipelineV2829?.openAiTeacherImage)){
            r.proMicroIdentityV2850=Object.assign({}, r.proMicroIdentityV2850||{}, {used:false, blocked:true, reason:'second_openai_pass_blocked_by_v2851_cost_firewall'});
          }else{
            const micro=await microIdentityTeacher2850(payload,r).catch(()=>null);
            if(micro && !micro.proMicroIdentityV2850?.error) r=mergeMicroIdentity2850(r,micro);
            else if(micro?.proMicroIdentityV2850) r.proMicroIdentityV2850=micro.proMicroIdentityV2850;
          }
        }
        r.proVisionV2850=Object.assign({}, r.proVisionV2850||{}, {expiryDotMatrix:true, microIdentityTeacher:true, lowTokenPolicy:'micro identity only when local/server identity is weak', noMoneyWaste:'one tiny identity call only if needed; paid external APIs still disabled by default'});
        return r;
      };
      global.__v2850VisionAnalyzeWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof preflightSnapshotV98==='function' && !global.__v2850PreflightWrapped){
      const prev=preflightSnapshotV98;
      preflightSnapshotV98=function(){ const snap=prev.call(this); snap.version='V28.52'; snap.brain=Object.assign({}, snap.brain||{}, {version:'V28.52', name:'PRO Cost Firewall + Barcode/OpenFacts/Expiry Safety', expiryDotMatrix:true, microIdentityLowToken:true, costFirewall:true, secondPassAllowed:VISION_ALLOW_SECOND_OPENAI_PASS, visionModel:OPENAI_VISION_MODEL}); return snap; };
      global.__v2850PreflightWrapped=true;
    }
  }catch(_){ }
  console.log('[Spesa Pronta] V28.51 PRO Cost Firewall + Expiry Safety active');
})();


// =============================================================
// V28.52 PRO BARCODE + OPEN FACTS LOW COST ROUTING
// Obiettivo: costi bassi e precisione alta.
// - Barcode/GTIN validato con checksum GS1 prima di usarlo.
// - Barcode -> Open Facts family prima di OpenAI.
// - Etichetta -> Open Facts family quando abbiamo già nome/barcode, senza nuova chiamata OpenAI.
// - Scadenza -> parser interno più severo: accetta solo pattern data plausibili, non lotti.
// =============================================================
(function(){
  const V='28.52';
  function digitsV2852(v){ return String(v||'').replace(/\D+/g,''); }
  function gtinCheckDigitV2852(body){
    const s=String(body||'').replace(/\D+/g,''); let sum=0;
    for(let i=s.length-1, pos=0; i>=0; i--, pos++) sum += Number(s[i]) * (pos%2===0 ? 3 : 1);
    return String((10 - (sum % 10)) % 10);
  }
  function validGtinV2852(code){
    const s=digitsV2852(code);
    if(!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
    if(/^(\d)\1+$/.test(s)) return false;
    return gtinCheckDigitV2852(s.slice(0,-1)) === s.slice(-1);
  }
  function barcodeCandidatesV2852(...parts){
    const raw=parts.flatMap(p=>Array.isArray(p)?p:[p]).filter(Boolean).join(' ');
    const out=[]; const re=/(?:^|\D)(\d[\d\s.\-]{6,20}\d)(?!\d)/g; let m;
    while((m=re.exec(raw))){ const c=digitsV2852(m[1]); if(c.length>=8&&c.length<=14&&!/^0+$/.test(c)) out.push(c); }
    const unique=[...new Set(out)];
    const valid=unique.filter(validGtinV2852);
    return valid.length ? valid : [];
  }
  function allOpenFactsSourcesV2852(preferredCat=''){
    const seen=new Set(); const arr=[];
    const add=(s)=>{ if(s&&s.id&&!seen.has(s.id)){ seen.add(s.id); arr.push(s); } };
    try{ add(openFactsSourceForCategory(preferredCat)); }catch(_){ }
    add({id:'open_food_facts', label:'Open Food Facts', base:'https://world.openfoodfacts.org'});
    add({id:'open_products_facts', label:'Open Products Facts', base:'https://world.openproductsfacts.org'});
    add({id:'open_beauty_facts', label:'Open Beauty Facts', base:'https://world.openbeautyfacts.org'});
    add({id:'open_pet_food_facts', label:'Open Pet Food Facts', base:'https://world.openpetfoodfacts.org'});
    return arr;
  }
  async function lookupBarcodeOpenFactsV2852(barcode, context={}){
    const code=digitsV2852(barcode);
    if(!validGtinV2852(code)) return {ok:false, reason:'invalid_gtin_checksum', barcode:code};
    const cacheKey='v2852|barcode|'+code+'|'+String(context.category||'');
    try{ const cached=getKnowledgeCache(cacheKey); if(cached) return Object.assign({cacheHit:true}, cached); }catch(_){ }
    const sources=allOpenFactsSourcesV2852(context.category||'');
    const attempts=[];
    for(const source of sources){
      try{
        const product=await fetchOpenFactsByBarcode(source, code);
        attempts.push({source:source.id, hit:!!product});
        if(product){
          const k=mapOpenFactsProduct(Object.assign({}, product, {code: product.code || code}), Object.assign({}, context, {barcode:code}), source);
          k.matchScore=10; k.confidence=.98; k.barcodeVerified=true; k.code=code;
          const row={ok:true, barcode:code, source:source.id, sourceLabel:source.label, knowledge:k, attempts, updatedAt:Date.now()};
          try{ setKnowledgeCache(cacheKey,row); }catch(_){ }
          return row;
        }
      }catch(err){ attempts.push({source:source.id, hit:false, error:String(err?.message||err).slice(0,80)}); }
    }
    const miss={ok:false, barcode:code, reason:'barcode_not_found_in_open_facts_family', attempts, updatedAt:Date.now()};
    try{ setKnowledgeCache(cacheKey,miss); }catch(_){ }
    return miss;
  }
  function resultFromOpenFactsV2852(lookup={}, stage='barcode'){
    const k=lookup.knowledge||{};
    const category=k.category || (stage==='barcode'?'food':'');
    return {
      needsRetake:false, needsManual:true, shouldAskConfirmation:true,
      productName:k.productName||'', brand:k.brand||'', estimatedSize:k.quantity||'', sizeDetectedRaw:k.quantity||'',
      category:category||'food', quantity:1, unit:k.quantity ? 'conf' : 'pz', barcode:lookup.barcode||k.code||'', ean:lookup.barcode||k.code||'',
      confidence:k.productName ? .96 : .72,
      ingredients:k.ingredients||[], allergens:k.allergens||[], possibleAllergens:k.traces||[], nutrition:k.nutrition||{},
      detectedText:[lookup.barcode||k.code||'', k.productName||'', k.brand||'', k.quantity||'', k.sourceLabel||lookup.sourceLabel||''].filter(Boolean),
      visibleEvidence:[`Barcode verificato checksum: ${lookup.barcode||k.code||''}`, `${lookup.sourceLabel||k.sourceLabel||'Open Facts'}: ${[k.productName,k.brand,k.quantity].filter(Boolean).join(' · ')}`].filter(Boolean),
      cloudVision:false, cloudOffline:false, cloudFallback:false, localFirst:true, memoryVision:false,
      reason: k.productName ? 'Barcode verificato: dati recuperati da Open Facts senza spendere OpenAI.' : 'Barcode valido letto: prodotto da confermare manualmente.',
      knowledgeFeeder:{enriched:!!k.productName, source:k.source||lookup.source, sourceLabel:k.sourceLabel||lookup.sourceLabel, confidence:k.confidence||.98, category:k.category||'', code:lookup.barcode||k.code||'', barcodeVerified:true},
      productMemory:{barcode:lookup.barcode||k.code||'', productName:k.productName||'', brand:k.brand||'', format:k.quantity||'', category:k.category||'', ingredients:k.ingredients||[], allergens:k.allergens||[], possibleTraces:k.traces||[], nutrition:k.nutrition||{}, externalKnowledge:k},
      barcodeAnalysisV2852:{ok:true, validChecksum:true, source:lookup.source, attempts:lookup.attempts||[], policy:'barcode_gtin_checksum_then_open_facts_no_openai'}
    };
  }
  async function lowCostLabelFactsV2852(payload={}){
    const lg=payload.localGuess||{};
    const context={
      productName:lg.productName||lg.name||'', brand:lg.brand||'', size:lg.estimatedSize||lg.size||lg.format||'', category:lg.category||'',
      barcode:lg.barcode||lg.ean||lg.code||lg.productCode||''
    };
    const bc=barcodeCandidatesV2852(context.barcode, ...(Array.isArray(lg.detectedText)?lg.detectedText:[]), ...(Array.isArray(lg.visibleEvidence)?lg.visibleEvidence:[]))[0]||'';
    if(bc){
      const lookup=await lookupBarcodeOpenFactsV2852(bc, context);
      if(lookup.ok) return resultFromOpenFactsV2852(lookup,'label');
      return {needsRetake:false, needsManual:true, shouldAskConfirmation:true, productName:context.productName||'', brand:context.brand||'', estimatedSize:context.size||'', category:context.category||'food', barcode:bc, ean:bc, confidence:.55, cloudVision:false, localFirst:true, reason:'Barcode valido ma non trovato nelle API Open Facts: completa/controlla manualmente.', barcodeAnalysisV2852:lookup};
    }
    if((context.productName||context.brand) && typeof enrichConfirmedProductWithKnowledge==='function'){
      const enriched=await enrichConfirmedProductWithKnowledge(Object.assign({}, context, {productName:context.productName, brand:context.brand, category:context.category||'food'})).catch(()=>null);
      if(enriched?.knowledge){
        const c=enriched.confirmed||{}; const k=enriched.knowledge||{};
        return {needsRetake:false, needsManual:true, shouldAskConfirmation:true, productName:c.productName||k.productName||context.productName, brand:c.brand||k.brand||context.brand, estimatedSize:c.size||k.quantity||context.size, category:c.category||k.category||context.category||'food', confidence:.82, ingredients:c.productMemory?.ingredients||k.ingredients||[], allergens:c.productMemory?.allergens||k.allergens||[], possibleAllergens:k.traces||[], nutrition:c.productMemory?.nutrition||k.nutrition||{}, detectedText:[context.productName,context.brand,k.productName,k.brand,k.quantity].filter(Boolean), visibleEvidence:[`${k.sourceLabel||'Open Facts'}: ${[k.productName,k.brand,k.quantity].filter(Boolean).join(' · ')}`], cloudVision:false, localFirst:true, reason:'Etichetta arricchita da Open Facts tramite nome/marca già noti, senza OpenAI.', knowledgeFeeder:c.knowledgeFeeder||{enriched:true,source:k.source,sourceLabel:k.sourceLabel}};
      }
    }
    return {needsRetake:false, needsManual:true, shouldAskConfirmation:true, productName:context.productName||'', brand:context.brand||'', estimatedSize:context.size||'', category:context.category||'food', confidence:.42, cloudVision:false, localFirst:true, reason:'Etichetta non mandata a OpenAI: servono nome o barcode per interrogare Open Facts a costo basso.', proLabelV2852:{noOpenAI:true, reason:'missing_name_or_barcode_for_open_facts'}};
  }
  function expiryFromEvidenceV2852(r={}){
    const fields=[r.expiryDate,r.expiryDetectedRaw,r.reason,r.detailQuestion]
      .concat(Array.isArray(r.detectedText)?r.detectedText:[])
      .concat(Array.isArray(r.visibleEvidence)?r.visibleEvidence:[])
      .filter(Boolean);
    const text=fields.join(' · ').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[‚·•]/g,'.');
    const out=[];
    const add=(raw,d,m,y,conf)=>{ d=Number(d); m=Number(m); y=String(y); if(y.length===2) y=(Number(y)<70?'20':'19')+y; y=Number(y); if(d>=1&&d<=31&&m>=1&&m<=12&&y>=2000&&y<=2055) out.push({raw:String(raw).trim(), text:`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`, confidence:conf}); };
    for(const m of text.matchAll(/(?:scad(?:enza)?|exp|tmc|entro|bb|best before)?\s*([^0-9]|^)([0-3]?\d)\s*[\/\.\-]\s*([01]?\d)\s*[\/\.\-]\s*(\d{2,4})(?!\d)/gi)) add(m[0],m[2],m[3],m[4],/scad|exp|tmc|entro|best/i.test(m[0])?.97:.9);
    for(const m of text.matchAll(/(?:scad(?:enza)?|exp|tmc|entro|bb|best before)\s*(\d{2})(\d{2})(\d{2,4})/gi)) add(m[0],m[1],m[2],m[3],.82);
    out.sort((a,b)=>b.confidence-a.confidence);
    return out[0]||null;
  }
  try{
    if(typeof visionAnalyze==='function' && !global.__v2852VisionAnalyzeWrapped){
      const prev=visionAnalyze;
      visionAnalyze=async function(payload={}){
        const stage=String(payload.stage||'auto').toLowerCase();
        const lg=payload.localGuess||{};
        const bc=barcodeCandidatesV2852(lg.barcode,lg.ean,lg.code,lg.productCode, ...(Array.isArray(lg.detectedText)?lg.detectedText:[]), ...(Array.isArray(lg.visibleEvidence)?lg.visibleEvidence:[]))[0]||'';
        if(stage==='barcode' && bc){
          const lookup=await lookupBarcodeOpenFactsV2852(bc, lg);
          if(lookup.ok) return resultFromOpenFactsV2852(lookup,'barcode');
          return {needsRetake:false, needsManual:true, shouldAskConfirmation:true, barcode:bc, ean:bc, productName:lg.productName||'', brand:lg.brand||'', estimatedSize:lg.estimatedSize||lg.size||'', category:lg.category||'food', confidence:.58, cloudVision:false, localFirst:true, reason:'Barcode valido letto dal dispositivo, ma non trovato nelle API Open Facts. Controlla manualmente.', barcodeAnalysisV2852:lookup};
        }
        if(stage==='label' || stage==='ingredients'){
          const low=await lowCostLabelFactsV2852(payload).catch(()=>null);
          if(low && (low.knowledgeFeeder?.enriched || low.barcode || low.proLabelV2852)) return low;
        }
        let r=await prev.call(this,payload);
        const found=barcodeCandidatesV2852(r.barcode,r.ean,r.code,r.productCode, ...(Array.isArray(r.detectedText)?r.detectedText:[]), ...(Array.isArray(r.visibleEvidence)?r.visibleEvidence:[]))[0]||'';
        if(found){
          const lookup=await lookupBarcodeOpenFactsV2852(found, r).catch(()=>null);
          if(lookup?.ok){
            const bres=resultFromOpenFactsV2852(lookup,stage);
            r=Object.assign({}, r, bres, {detectedText:[...(r.detectedText||[]),...(bres.detectedText||[])].filter(Boolean).slice(0,24), visibleEvidence:[...(r.visibleEvidence||[]),...(bres.visibleEvidence||[])].filter(Boolean).slice(0,24), confidence:Math.max(Number(r.confidence||0), Number(bres.confidence||0))});
          }else{
            r.barcode=found; r.ean=found; r.barcodeAnalysisV2852=lookup||{ok:false,barcode:found,reason:'lookup_failed'};
          }
        }else if(r.barcode || r.ean || r.code || r.productCode){
          r.barcodeAnalysisV2852={ok:false, validChecksum:false, reason:'barcode_rejected_invalid_checksum', raw:[r.barcode,r.ean,r.code,r.productCode].filter(Boolean).join(' ')};
          r.barcode=''; r.ean='';
        }
        if(stage==='expiry'){
          const exp=expiryFromEvidenceV2852(r);
          if(exp && (!r.expiryDate || exp.confidence>=Number(r.expiryConfidence||0))){ r.expiryDate=exp.text; r.expiryDetectedRaw=exp.raw; r.expiryConfidence=exp.confidence; r.proExpiryV2852={ok:true, internalParser:true, raw:exp.raw, expiryDate:exp.text, confidence:exp.confidence}; }
          else r.proExpiryV2852=Object.assign({}, r.proExpiryV2852||{}, {ok:!!r.expiryDate, internalParser:true, policy:'accetta solo date plausibili, non lotti/batch'});
        }
        r.proVisionV2852=Object.assign({}, r.proVisionV2852||{}, {costPlan:'product_openai_240_max; label_open_facts_when_identity_exists; expiry_internal_parser_plus_optional_low_token; barcode_gtin_checksum_open_facts_first', openAiWasteGuard:true});
        return r;
      };
      global.__v2852VisionAnalyzeWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof preflightSnapshotV98==='function' && !global.__v2852PreflightWrapped){
      const prev=preflightSnapshotV98;
      preflightSnapshotV98=function(){ const snap=prev.call(this); snap.version='V28.52'; snap.brain=Object.assign({}, snap.brain||{}, {version:'V28.52', name:'PRO Barcode + Open Facts Low Cost Routing', barcode:'GTIN checksum + Open Facts first', label:'Open Facts when identity/barcode exists, no automatic OpenAI label spend', expiry:'internal date parser + skip expiry button'}); return snap; };
      global.__v2852PreflightWrapped=true;
    }
  }catch(_){ }
  console.log('[Spesa Pronta] V28.52 PRO Barcode/OpenFacts/Expiry low-cost routing active');
})();


// =============================================================
// V28.53 PRO EXTERNAL KNOWLEDGE -> SERVER MEMORY LEARNING LOOP
// Obiettivo: quando il server consulta Open Facts / fonti esterne non deve solo "guardare".
// Deve trasformare il risultato utile in memoria interna DOPO conferma utente/titolare:
// - foto riferimento API salvata nella cartella oggetto;
// - firma visiva semantica da nome/marca/barcode/categoria/fonte;
// - fonti e candidati ispezionabili nel Cervello Server;
// - barcode senza nome -> lookup API prima di perdere l'apprendimento.
// =============================================================
(function(){
  const V='28.53';
  const EXTERNAL_KNOWLEDGE_LEARNING_ENABLED = String(process.env.EXTERNAL_KNOWLEDGE_LEARNING_ENABLED || 'true').toLowerCase() !== 'false';
  const EXTERNAL_REFERENCE_IMAGE_ENABLED = String(process.env.EXTERNAL_REFERENCE_IMAGE_ENABLED || 'true').toLowerCase() !== 'false';

  function v2853GtinCheckDigit(body=''){
    const digits=String(body||'').replace(/\D+/g,'');
    let sum=0;
    for(let i=digits.length-1,pos=0;i>=0;i--,pos++) sum += Number(digits[i]) * (pos%2===0 ? 3 : 1);
    return String((10 - (sum % 10)) % 10);
  }
  function v2853ValidGtin(code=''){
    const s=String(code||'').replace(/\D+/g,'');
    if(!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
    if(/^(\d)\1+$/.test(s)) return false;
    return v2853GtinCheckDigit(s.slice(0,-1)) === s.slice(-1);
  }

  function v2853CleanUrl(v=''){
    const s=String(v||'').trim();
    if(!s || !/^https?:\/\//i.test(s) || s.length>1400 || /[<>"']/g.test(s)) return '';
    return s;
  }
  function v2853List(...xs){
    try{ return v2840List(...xs); }catch(_){ return xs.flatMap(x=>Array.isArray(x)?x:String(x||'').split(/[;,\n]+/)).map(x=>String(x||'').trim()).filter(Boolean); }
  }
  function v2853Clean(v='',n=180){
    try{ return v2840CleanString(v,n); }catch(_){ return String(v||'').trim().slice(0,n); }
  }
  function v2853ReferenceFromKnowledge(k={}, reason='open_facts_lookup'){
    const imageUrl=v2853CleanUrl(k.imageUrl||k.image_front_url||k.image_url||'');
    return {
      version:'V28.53_external_reference',
      role:'api_reference_product',
      source:v2853Clean(k.source||'',80),
      sourceLabel:v2853Clean(k.sourceLabel||k.source||'Fonte prodotto esterna',120),
      reason,
      code:v2853Clean(k.code||k.barcode||'',32),
      productName:v2853Clean(k.productName||'',160),
      brand:v2853Clean(k.brand||'',120),
      quantity:v2853Clean(k.quantity||k.format||'',80),
      category:v2853Clean(k.category||'',80),
      imageUrl,
      confidence:k.confidence ?? null,
      matchScore:k.matchScore ?? null,
      barcodeVerified:!!k.barcodeVerified,
      fetchedAt:Number(k.fetchedAt||Date.now()),
      importedAt:Date.now()
    };
  }
  function v2853SignatureParts(confirmed={}, ref={}){
    const pm=confirmed.productMemory||{};
    return [
      ref.productName, ref.brand, ref.quantity, ref.category, ref.code, ref.sourceLabel,
      confirmed.productName, confirmed.brand, confirmed.size, confirmed.format, confirmed.category, confirmed.barcode,
      pm.productName, pm.brand, pm.format, pm.category, pm.barcode,
      ...(confirmed.detectedText||[]), ...(confirmed.visibleEvidence||[]),
      ...(pm.ingredients||[]).slice(0,12), ...(pm.allergens||[]).slice(0,10)
    ].filter(Boolean).join(' ');
  }
  function v2853SemanticVisualSignature(confirmed={}, ref={}){
    const raw=v2853SignatureParts(confirmed,ref);
    const tokens=(typeof productCoreTokens==='function'?productCoreTokens(raw):raw.toLowerCase().split(/\W+/)).filter(Boolean).slice(0,24);
    const hash=(typeof hashStable==='function'?hashStable(raw):String(Math.abs(raw.split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0)))).slice(0,18);
    return `extsig:${hash}:${tokens.join('|')}`.slice(0,260);
  }
  function v2853SemanticMatchScore(confirmed={}, ref={}){
    const a=(typeof productStrongTokens==='function'?productStrongTokens([confirmed.productName,confirmed.brand,confirmed.size,confirmed.category,(confirmed.detectedText||[]).join(' '),(confirmed.visibleEvidence||[]).join(' ')].join(' ')):[]);
    const b=(typeof productStrongTokens==='function'?productStrongTokens([ref.productName,ref.brand,ref.quantity,ref.category,ref.code].join(' ')):[]);
    let overlap=0;
    try{ overlap=tokenJaccard(a,b); }catch(_){
      const A=new Set(a), B=new Set(b); const inter=[...A].filter(x=>B.has(x)).length; const uni=new Set([...A,...B]).size||1; overlap=inter/uni;
    }
    let score=overlap;
    if(ref.code && String(ref.code)===String(bestBarcodeFromConfirmed(confirmed)||'')) score=Math.max(score,.98);
    if(ref.barcodeVerified) score=Math.max(score,.94);
    if(ref.brand && confirmed.brand && normalizeText(ref.brand)===normalizeText(confirmed.brand)) score=Math.max(score,.72);
    return Number(Math.max(0,Math.min(.99,score)).toFixed(3));
  }
  function v2853DedupeRefs(refs=[]){
    const out=[]; const seen=new Set();
    for(const r of refs||[]){
      if(!r) continue;
      const key=[r.source||'',r.code||'',r.imageUrl||'',normalizeText([r.productName,r.brand,r.quantity].filter(Boolean).join(' '))].join('|');
      if(seen.has(key)) continue; seen.add(key); out.push(r);
    }
    return out.slice(0,18);
  }
  function v2853EnrichConfirmedWithReference(confirmed={}, knowledge=null, reason='external_lookup'){
    if(!EXTERNAL_KNOWLEDGE_LEARNING_ENABLED) return confirmed;
    const k=knowledge || confirmed.knowledgeFeeder?.knowledge || confirmed.productMemory?.externalKnowledge || null;
    if(!k) return confirmed;
    const ref=v2853ReferenceFromKnowledge(k, reason);
    if(!ref.productName && !ref.brand && !ref.code && !ref.imageUrl) return confirmed;
    const out=Object.assign({}, confirmed);
    const pm=Object.assign({}, out.productMemory||{});
    const sig=v2853SemanticVisualSignature(out, ref);
    const semanticScore=v2853SemanticMatchScore(out, ref);
    pm.externalKnowledge=Object.assign({}, pm.externalKnowledge||{}, k, {
      productName:k.productName||pm.externalKnowledge?.productName||'',
      brand:k.brand||pm.externalKnowledge?.brand||'',
      quantity:k.quantity||pm.externalKnowledge?.quantity||'',
      category:k.category||pm.externalKnowledge?.category||'',
      imageUrl:ref.imageUrl||pm.externalKnowledge?.imageUrl||'',
      referenceLearned:true,
      learnedBy:'V28.53_external_knowledge_loop',
      semanticVisualScore:semanticScore
    });
    pm.externalReferences=v2853DedupeRefs([...(pm.externalReferences||[]), ref]);
    pm.externalReferenceImages=v2853DedupeRefs([...(pm.externalReferenceImages||[]), ref].filter(x=>x.imageUrl));
    pm.referenceImageUrl = pm.referenceImageUrl || ref.imageUrl || '';
    pm.imageUrl = pm.imageUrl || ref.imageUrl || '';
    pm.visualSignature = pm.visualSignature || sig;
    pm.referenceVisualSignature = sig;
    pm.referenceVisualMatch = {semanticScore, mode:'semantic_identity_plus_barcode', imagePixelComparison:false, note:'Foto riferimento API salvata; confronto pixel/embedding demandato a Home Brain/API visuale opzionale.'};
    const sample={
      kind:'external_reference',
      externalUrl:ref.imageUrl,
      visualSignature:sig,
      colors:[],
      visibleEvidence:[`${ref.sourceLabel||ref.source}: ${[ref.productName,ref.brand,ref.quantity].filter(Boolean).join(' · ')}`, ref.code?`Barcode/API code: ${ref.code}`:''].filter(Boolean),
      detectedText:[ref.productName,ref.brand,ref.quantity,ref.category,ref.code].filter(Boolean),
      source:'external_api_reference_v2853',
      score: ref.barcodeVerified ? 96 : Math.round(70 + semanticScore*20)
    };
    if(ref.imageUrl && EXTERNAL_REFERENCE_IMAGE_ENABLED){
      out.photoSamples=[...(Array.isArray(out.photoSamples)?out.photoSamples:[]), sample].slice(0,18);
      pm.photoSamples=[...(Array.isArray(pm.photoSamples)?pm.photoSamples:[]), sample].slice(0,18);
      pm.objectFolder=Object.assign({}, pm.objectFolder||{}, {photos:[...(pm.objectFolder?.photos||[]), sample].slice(0,18)});
    }
    out.productMemory=pm;
    out.imageUrl = out.imageUrl || ref.imageUrl || '';
    out.visualSignature = out.visualSignature || sig;
    out.visibleEvidence=v2853List(out.visibleEvidence, `Fonte esterna salvata nel cervello: ${ref.sourceLabel||ref.source}`, ref.imageUrl?'Foto riferimento API collegata':'').slice(0,30);
    out.detectedText=v2853List(out.detectedText, ref.productName, ref.brand, ref.quantity, ref.code).slice(0,30);
    out.knowledgeFeeder=Object.assign({}, out.knowledgeFeeder||{}, {
      enriched:true,
      source:ref.source||out.knowledgeFeeder?.source||'',
      sourceLabel:ref.sourceLabel||out.knowledgeFeeder?.sourceLabel||'',
      confidence:ref.confidence||out.knowledgeFeeder?.confidence||null,
      category:ref.category||out.knowledgeFeeder?.category||'',
      code:ref.code||out.knowledgeFeeder?.code||'',
      externalReferenceImage:ref.imageUrl||'',
      referenceLearning:true,
      semanticVisualScore:semanticScore,
      policy:'external_api_proposes; user_or_owner_confirmation_turns_it_into_server_memory'
    });
    out.externalLearningV2853={active:true, pendingUntilUserConfirmation:true, reference:ref, semanticVisualSignature:sig, semanticVisualScore:semanticScore, policy:'API esterna propone dati/foto; conferma utente/titolare rende memoria ufficiale.'};
    return out;
  }
  function v2853FinalizeRecord(record={}, confirmed={}){
    if(!record || !EXTERNAL_KNOWLEDGE_LEARNING_ENABLED) return record;
    const refs=v2853DedupeRefs(v2853List(record.externalReferences, confirmed.productMemory?.externalReferences, confirmed.productMemory?.externalReferenceImages).map(x=>typeof x==='object'?x:null).filter(Boolean));
    // v2840List converte oggetti in stringhe, quindi ricostruisci dai campi diretti se necessario.
    const direct=[];
    for(const r of [ ...(record.externalReferences||[]), ...(confirmed.productMemory?.externalReferences||[]), ...(confirmed.productMemory?.externalReferenceImages||[]) ]) if(r&&typeof r==='object') direct.push(r);
    const pmK=confirmed.productMemory?.externalKnowledge;
    if(pmK && typeof pmK==='object') direct.push(v2853ReferenceFromKnowledge(pmK,'confirmed_external_knowledge'));
    record.externalReferences=v2853DedupeRefs([...(record.externalReferences||[]), ...direct]);
    record.externalReferenceImages=record.externalReferences.filter(r=>r.imageUrl).slice(0,12);
    record.externalKnowledge=Object.assign({}, record.externalKnowledge||{}, pmK&&typeof pmK==='object'?pmK:{});
    record.referenceVisualSignatures=Array.isArray(record.referenceVisualSignatures)?record.referenceVisualSignatures:[];
    const ref=record.externalReferences[0]||null;
    if(ref){
      const sig=v2853SemanticVisualSignature(confirmed, ref);
      if(!record.referenceVisualSignatures.find(x=>x.signature===sig)) record.referenceVisualSignatures.unshift({signature:sig, at:Date.now(), source:'external_reference_v2853', sourceLabel:ref.sourceLabel||ref.source||'', imageUrl:ref.imageUrl||''});
      record.referenceVisualSignatures=record.referenceVisualSignatures.slice(0,18);
      record.visualComparisonV2853={status:'reference_saved', semanticVisualScore:v2853SemanticMatchScore(confirmed,ref), referenceSource:ref.sourceLabel||ref.source||'', referenceImageUrl:ref.imageUrl||'', policy:'server memory can compare against this reference later; owner values still win'};
      record.sources=Object.assign({}, record.sources||{}, {externalKnowledgeReference:Number(record.sources?.externalKnowledgeReference||0)+1});
    }
    try{ v2842MergeObjectFolder(record, confirmed); }catch(_){ }
    try{ v2840AttachMemoryCard(record, confirmed); }catch(_){ }
    if(record.memoryCard){
      record.memoryCard.externalLearning={version:'V28.53', references:record.externalReferences||[], referenceImages:record.externalReferenceImages||[], visualComparison:record.visualComparisonV2853||null, policy:'fonti esterne + foto riferimento diventano memoria solo dopo conferma'};
    }
    updateGlobalLearningAudit({type:'external-reference-learned-v2853', key:record.key||'', productName:record.productName||'', brand:record.brand||'', references:(record.externalReferences||[]).length, images:(record.externalReferenceImages||[]).length});
    return record;
  }
  async function v2853LookupBarcodeAllOpenFacts(barcode, context={}){
    const code=String(barcode||'').replace(/\D+/g,'');
    if(!v2853ValidGtin(code)) return null;
    const sources=[]; const seen=new Set();
    const add=s=>{ if(s&&s.id&&!seen.has(s.id)){ seen.add(s.id); sources.push(s); } };
    try{ add(openFactsSourceForCategory(context.category||'')); }catch(_){ }
    add({id:'open_food_facts', label:'Open Food Facts', base:'https://world.openfoodfacts.org'});
    add({id:'open_products_facts', label:'Open Products Facts', base:'https://world.openproductsfacts.org'});
    add({id:'open_beauty_facts', label:'Open Beauty Facts', base:'https://world.openbeautyfacts.org'});
    add({id:'open_pet_food_facts', label:'Open Pet Food Facts', base:'https://world.openpetfoodfacts.org'});
    for(const source of sources){
      try{
        const p=await fetchOpenFactsByBarcode(source, code);
        if(p) return Object.assign(mapOpenFactsProduct(Object.assign({},p,{code:p.code||code}), Object.assign({},context,{barcode:code}), source), {barcodeVerified:true, confidence:.98, matchScore:10, code});
      }catch(_){ }
    }
    return null;
  }
  try{
    if(typeof mergeExternalKnowledgeIntoConfirmed==='function' && !global.__v2853MergeExternalWrapped){
      const prevMerge=mergeExternalKnowledgeIntoConfirmed;
      mergeExternalKnowledgeIntoConfirmed=function(confirmed={}, knowledge=null){
        const out=prevMerge.call(this, confirmed, knowledge);
        return v2853EnrichConfirmedWithReference(out, knowledge, 'merge_external_knowledge');
      };
      global.__v2853MergeExternalWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2853UpsertWrapped){
      const prevUpsert=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        const enriched=v2853EnrichConfirmedWithReference(confirmed, null, 'upsert_confirmed_memory');
        const compact=prevUpsert.call(this, enriched);
        try{
          const g=db.assistantBrain.globalProductMemory||{products:{}};
          const record=compact?.key ? g.products[compact.key] : null;
          if(record){ v2853FinalizeRecord(record,enriched); record.updatedAt=Date.now(); g.products[record.key]=record; g.updatedAt=Date.now(); return compactGlobalProductRecord(record); }
        }catch(e){ updateGlobalLearningAudit({type:'external-reference-finalize-error-v2853', reason:String(e?.message||e).slice(0,180)}); }
        return compact;
      };
      global.__v2853UpsertWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof learnAutonomyOnServer==='function' && !global.__v2853LearnWrapped){
      const prevLearn=learnAutonomyOnServer;
      learnAutonomyOnServer=async function(h,payload={}){
        try{
          let c=Object.assign({}, payload.confirmed||{});
          const barcode=(typeof bestBarcodeFromConfirmed==='function'?bestBarcodeFromConfirmed(c):'');
          if(barcode && !c.productName){
            const k=await v2853LookupBarcodeAllOpenFacts(barcode,c).catch(()=>null);
            if(k){ c=mergeExternalKnowledgeIntoConfirmed(Object.assign({},c,{barcode}),k); }
          } else if(c.productMemory?.externalKnowledge){
            c=v2853EnrichConfirmedWithReference(c,c.productMemory.externalKnowledge,'learn_confirmed_existing_external');
          }
          payload.confirmed=c;
        }catch(e){ updateGlobalLearningAudit({type:'external-reference-learn-pre-error-v2853', reason:String(e?.message||e).slice(0,180)}); }
        return prevLearn.call(this,h,payload);
      };
      global.__v2853LearnWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof preflightSnapshotV98==='function' && !global.__v2853PreflightWrapped){
      const prev=preflightSnapshotV98;
      preflightSnapshotV98=function(){
        const snap=prev.call(this);
        snap.version='V28.53';
        snap.brain=Object.assign({}, snap.brain||{}, {
          version:'V28.53',
          name:'PRO External Knowledge Learning Loop',
          externalKnowledgeLearning:EXTERNAL_KNOWLEDGE_LEARNING_ENABLED,
          referenceImages:EXTERNAL_REFERENCE_IMAGE_ENABLED,
          policy:'Open Facts/API/web propone dati e foto; conferma utente/titolare trasforma tutto in cartella oggetto server.'
        });
        return snap;
      };
      global.__v2853PreflightWrapped=true;
    }
  }catch(_){ }
  console.log('[Spesa Pronta] V28.53 PRO external knowledge -> server memory learning loop active');
})();


// =============================================================
// V28.54 PRO COST METER + SEMANTIC VISUAL SIGNATURE CORE
// Obiettivo:
// - vedere chiaramente dove si spende: OpenAI vs API gratuite Open Facts vs memoria server.
// - trasformare ogni fonte esterna confermata in una firma visiva semantica leggibile.
// - non usare ingredienti/tracce/colore come identità primaria del prodotto.
// =============================================================
(function(){
  const V='28.54';
  function v2854Now(){ return Date.now(); }
  function v2854Short(v,n=180){ return String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,n); }
  function v2854KbFromImage(data=''){
    const s=String(data||'');
    if(!s.startsWith('data:image/')) return 0;
    const b64=s.split(',')[1]||'';
    return Math.round((b64.length*0.75)/1024);
  }
  function v2854EnsureMeter(){
    ensureDbShape();
    const b=db.assistantBrain=db.assistantBrain||{};
    const m=b.proCostMeterV2854=b.proCostMeterV2854||{
      version:'V28.54',
      policy:'OpenAI solo se memoria/barcode/Open Facts non bastano. Open Facts e checksum barcode sono segnati come costo token zero.',
      openAiCalls:0, openAiFailures:0, openAiMaxTokensRequested:0, openAiPromptChars:0, openAiImageKB:0,
      openFactsCalls:0, openFactsHits:0, openFactsMisses:0, openFactsFailures:0,
      barcodeLookups:0, barcodeValidations:0, freeLookups:0,
      byStage:{}, bySource:{}, last:[], updatedAt:0
    };
    m.byStage=m.byStage||{}; m.bySource=m.bySource||{}; m.last=Array.isArray(m.last)?m.last:[];
    return m;
  }
  function v2854StageInc(m,stage,field){
    stage=v2854Short(stage||'auto',40); m.byStage[stage]=m.byStage[stage]||{openAi:0, openFacts:0, hits:0, failures:0, imageKB:0, maxTokens:0};
    m.byStage[stage][field]=Number(m.byStage[stage][field]||0)+1;
  }
  function v2854SourceInc(m,source,field){
    source=v2854Short(source||'unknown',60); m.bySource[source]=m.bySource[source]||{calls:0,hits:0,misses:0,failures:0};
    m.bySource[source][field]=Number(m.bySource[source][field]||0)+1;
  }
  function v2854Record(type,data={}){
    try{
      const m=v2854EnsureMeter();
      const ev=Object.assign({at:v2854Now(), type, version:'V28.54'}, data||{});
      if(type==='openai_vision'){
        m.openAiCalls++; if(ev.ok===false) m.openAiFailures++;
        m.openAiMaxTokensRequested+=Number(ev.maxTokens||0); m.openAiPromptChars+=Number(ev.promptChars||0); m.openAiImageKB+=Number(ev.imageKB||0);
        v2854StageInc(m,ev.stage||'auto','openAi');
        const st=m.byStage[v2854Short(ev.stage||'auto',40)]; st.imageKB+=Number(ev.imageKB||0); st.maxTokens+=Number(ev.maxTokens||0); if(ev.ok===false) st.failures++;
      }else if(type==='open_facts_barcode' || type==='open_facts_search'){
        m.openFactsCalls++; m.freeLookups++;
        if(type==='open_facts_barcode') m.barcodeLookups++;
        if(ev.hit){ m.openFactsHits++; v2854SourceInc(m,ev.source,'hits'); }
        else { m.openFactsMisses++; v2854SourceInc(m,ev.source,'misses'); }
        v2854SourceInc(m,ev.source,'calls');
        if(ev.ok===false){ m.openFactsFailures++; v2854SourceInc(m,ev.source,'failures'); }
        v2854StageInc(m,ev.stage||type,'openFacts');
      }else if(type==='barcode_validation'){
        m.barcodeValidations++;
      }
      m.last.unshift(ev); m.last=m.last.slice(0,80); m.updatedAt=v2854Now();
      return m;
    }catch(_){ return null; }
  }
  function v2854PublicMeter(){
    const m=v2854EnsureMeter();
    return {
      version:m.version,
      policy:m.policy,
      openAiCalls:m.openAiCalls||0,
      openAiFailures:m.openAiFailures||0,
      openAiMaxTokensRequested:m.openAiMaxTokensRequested||0,
      openAiPromptChars:m.openAiPromptChars||0,
      openAiImageKB:m.openAiImageKB||0,
      openFactsCalls:m.openFactsCalls||0,
      openFactsHits:m.openFactsHits||0,
      openFactsMisses:m.openFactsMisses||0,
      openFactsFailures:m.openFactsFailures||0,
      barcodeLookups:m.barcodeLookups||0,
      barcodeValidations:m.barcodeValidations||0,
      freeLookups:m.freeLookups||0,
      byStage:m.byStage||{}, bySource:m.bySource||{}, last:(m.last||[]).slice(0,25), updatedAt:m.updatedAt||0,
      interpretation:'Se openAiCalls resta 0, quella scansione non ha speso token OpenAI. Open Facts/Barcode sono lookup a costo token zero.'
    };
  }

  function v2854Tokens(...parts){
    const raw=parts.flatMap(p=>Array.isArray(p)?p:[p]).filter(Boolean).join(' ');
    const toks=(typeof productStrongTokens==='function'?productStrongTokens(raw):String(raw).toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean);
    const banned=new Set(['contiene','tracce','puo','può','latte','glutine','soia','uova','frutta','guscio','ingredienti','allergeni','verde','rosso','blu','bianco','nero','giallo','arancione','colore','bottiglia','barattolo','vasetto','flacone','confezione','etichetta']);
    return [...new Set(toks.filter(t=>t.length>2 && !banned.has(t)))].slice(0,20);
  }
  function v2854Family(category=''){
    try{ return productCategoryFamily(category||'')||''; }catch(_){ return String(category||''); }
  }
  function v2854SemanticSignature(confirmed={}, record={}, ref={}){
    const pm=confirmed.productMemory||{};
    const barcode=(typeof bestBarcodeFromConfirmed==='function'?bestBarcodeFromConfirmed(confirmed):'') || (record.barcodes||[])[0] || pm.barcode || ref.code || '';
    const productName=v2854Short(confirmed.productName||record.productName||pm.productName||ref.productName||'',120);
    const brand=v2854Short(confirmed.brand||record.brand||pm.brand||ref.brand||'',90);
    const category=v2854Short(confirmed.category||record.category||pm.category||ref.category||'',80);
    const family=v2854Family(category);
    const format=v2854Short(confirmed.size||confirmed.format||confirmed.estimatedSize||record.format||pm.format||ref.quantity||'',80);
    const packageType=v2854Short(confirmed.packageType||pm.packageType||record.packageType||record.packaging||'',90);
    const productType=v2854Short(confirmed.productType||pm.productType||record.productType||'',90);
    const colors=[...new Set([...(confirmed.colors||[]),...(pm.colors||[]),...(record.colors||[])].map(x=>v2854Short(x,40)).filter(Boolean))].slice(0,8);
    const strongText=v2854Tokens(productName,brand,category,format,productType,packageType,barcode,(confirmed.detectedText||[]).join(' '),(confirmed.visibleEvidence||[]).join(' '),ref.productName,ref.brand,ref.quantity,ref.code);
    const identityRaw=[brand,productName,format,category,barcode,strongText.join('|')].filter(Boolean).join(' | ');
    const hash=(typeof hashStable==='function'?hashStable(identityRaw):String(Math.abs(identityRaw.split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0)))).slice(0,22);
    return {
      version:'V28.54_semantic_visual_signature',
      hash,
      signature:`semsig:v2854:${family||'generic'}:${hash}`,
      identity:{productName,brand,category,categoryFamily:family,format,barcode},
      visual:{productType,packageType,colors,strongText},
      reference:{source:ref.sourceLabel||ref.source||'', imageUrl:ref.imageUrl||'', code:ref.code||''},
      rules:'identità = nome/marca/barcode/categoria/formato/testi forti; ingredienti/tracce/colori/confezione aiutano ma non comandano.'
    };
  }
  function v2854AttachSignature(record={}, confirmed={}){
    try{
      const ref=(record.externalReferences||[])[0] || confirmed.productMemory?.externalKnowledge || {};
      const sig=v2854SemanticSignature(confirmed,record,ref);
      record.semanticVisualSignatureV2854=sig;
      if(!record.ownerOverrides?.fields?.visualSignature){ record.visualSignature=sig.signature; }
      record.objectFolder=record.objectFolder||{};
      try{ if(typeof v2842EnsureObjectFolder==='function') v2842EnsureObjectFolder(record); }catch(_){ }
      const vf=record.objectFolder.visualSignatures=Array.isArray(record.objectFolder.visualSignatures)?record.objectFolder.visualSignatures:[];
      if(!vf.find(x=>x.signature===sig.signature)) vf.unshift({signature:sig.signature, semantic:sig, at:v2854Now(), source:'server_semantic_signature_v2854'});
      record.objectFolder.visualSignatures=vf.slice(0,24);
      record.memoryCard=record.memoryCard||{};
      record.memoryCard.semanticVisualSignatureV2854=sig;
      record.memoryCard.visualAppearance=Object.assign({}, record.memoryCard.visualAppearance||{}, {visualSignature:sig.signature, semanticVisualSignature:sig});
      record.sources=Object.assign({}, record.sources||{}, {semanticSignatureV2854:Number(record.sources?.semanticSignatureV2854||0)+1});
      return sig;
    }catch(e){ try{ updateGlobalLearningAudit({type:'semantic-signature-error-v2854', reason:String(e?.message||e).slice(0,180)}); }catch(_){} return null; }
  }

  try{
    if(typeof visionJsonCall==='function' && !global.__v2854VisionJsonMeterWrapped){
      const prev=visionJsonCall;
      visionJsonCall=async function(systemText,userText,image,opts={}){
        const start=v2854Now();
        const stage=String(opts.stage||'auto').toLowerCase();
        const maxTokens=Number(opts.maxTokens||0);
        const promptChars=String(userText||'').length;
        const imageKB=v2854KbFromImage(image);
        try{
          const out=await prev.call(this,systemText,userText,image,opts);
          v2854Record('openai_vision',{ok:true, stage, maxTokens, promptChars, imageKB, ms:v2854Now()-start, model:OPENAI_VISION_MODEL, reason:opts.reason||opts.mode||''});
          if(out && typeof out==='object') out.costMeterV2854={openAiCall:true, stage, maxTokens, imageKB, ms:v2854Now()-start, policy:'una chiamata conteggiata dal firewall costi V28.54'};
          return out;
        }catch(err){
          v2854Record('openai_vision',{ok:false, stage, maxTokens, promptChars, imageKB, ms:v2854Now()-start, model:OPENAI_VISION_MODEL, error:String(err?.message||err).slice(0,160)});
          throw err;
        }
      };
      global.__v2854VisionJsonMeterWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof fetchOpenFactsByBarcode==='function' && !global.__v2854OpenFactsBarcodeMeterWrapped){
      const prev=fetchOpenFactsByBarcode;
      fetchOpenFactsByBarcode=async function(source, code){
        const start=v2854Now();
        const src=source?.id||source?.label||'';
        try{
          const out=await prev.call(this,source,code);
          v2854Record('open_facts_barcode',{ok:true, hit:!!out, source:src, code:v2854Short(code,20), ms:v2854Now()-start, cost:'token_zero'});
          return out;
        }catch(err){
          v2854Record('open_facts_barcode',{ok:false, hit:false, source:src, code:v2854Short(code,20), ms:v2854Now()-start, error:String(err?.message||err).slice(0,120), cost:'token_zero'});
          throw err;
        }
      };
      global.__v2854OpenFactsBarcodeMeterWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof fetchOpenFactsSearch==='function' && !global.__v2854OpenFactsSearchMeterWrapped){
      const prev=fetchOpenFactsSearch;
      fetchOpenFactsSearch=async function(source, query){
        const start=v2854Now();
        const src=source?.id||source?.label||'';
        try{
          const out=await prev.call(this,source,query);
          const products=Array.isArray(out?.products)?out.products.length:0;
          v2854Record('open_facts_search',{ok:true, hit:products>0, products, source:src, query:v2854Short(query,90), ms:v2854Now()-start, cost:'token_zero'});
          return out;
        }catch(err){
          v2854Record('open_facts_search',{ok:false, hit:false, source:src, query:v2854Short(query,90), ms:v2854Now()-start, error:String(err?.message||err).slice(0,120), cost:'token_zero'});
          throw err;
        }
      };
      global.__v2854OpenFactsSearchMeterWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2854UpsertSignatureWrapped){
      const prev=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        const compact=prev.call(this,confirmed);
        try{
          const g=db.assistantBrain.globalProductMemory||{products:{}};
          const key=compact?.key || ((typeof bestBarcodeFromConfirmed==='function'&&bestBarcodeFromConfirmed(confirmed)) ? `ean:${bestBarcodeFromConfirmed(confirmed)}` : '');
          const record=(key&&g.products?.[key]) || Object.values(g.products||{}).find(r=>r.productName===compact?.productName && r.brand===compact?.brand) || null;
          if(record){
            const sig=v2854AttachSignature(record, confirmed);
            if(sig){ updateGlobalLearningAudit({type:'semantic-signature-saved-v2854', key:record.key||'', productName:record.productName||'', brand:record.brand||'', signature:sig.signature}); }
            record.updatedAt=v2854Now(); g.updatedAt=v2854Now();
          }
        }catch(e){ try{ updateGlobalLearningAudit({type:'semantic-signature-upsert-error-v2854', reason:String(e?.message||e).slice(0,180)}); }catch(_){} }
        return compact;
      };
      global.__v2854UpsertSignatureWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof v2840PublicProductBrainDetail==='function' && !global.__v2854PublicBrainDetailWrapped){
      const prev=v2840PublicProductBrainDetail;
      v2840PublicProductBrainDetail=function(record={}){
        if(!record.semanticVisualSignatureV2854){ try{ v2854AttachSignature(record,{}); }catch(_){ } }
        const out=prev.call(this,record);
        out.semanticVisualSignatureV2854=record.semanticVisualSignatureV2854||null;
        if(out.fields) out.fields.semanticVisualSignatureV2854=record.semanticVisualSignatureV2854||null;
        return out;
      };
      global.__v2854PublicBrainDetailWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof publicServerBrainV2840==='function' && !global.__v2854PublicServerBrainWrapped){
      const prev=publicServerBrainV2840;
      publicServerBrainV2840=function(opts={}){
        const out=prev.call(this,opts);
        out.version='V28.54 Brain Premium + Cost Meter + Semantic Signatures';
        out.costMeterV2854=v2854PublicMeter();
        return out;
      };
      global.__v2854PublicServerBrainWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof preflightSnapshotV98==='function' && !global.__v2854PreflightWrapped){
      const prev=preflightSnapshotV98;
      preflightSnapshotV98=function(){
        const snap=prev.call(this);
        snap.version='V28.54';
        snap.costMeterV2854=v2854PublicMeter();
        snap.brain=Object.assign({}, snap.brain||{}, {
          version:'V28.54',
          name:'PRO Cost Meter + Semantic Visual Signature Core',
          costMeter:'openai_calls_vs_free_openfacts_visible',
          semanticVisualSignature:'server_identity_signature_saved_after_confirmation',
          policy:'barcode/Open Facts/memoria prima; OpenAI solo micro-identità quando non basta; ingredienti/tracce/colori non comandano identità.'
        });
        return snap;
      };
      global.__v2854PreflightWrapped=true;
    }
  }catch(_){ }

  try{ v2854EnsureMeter(); }catch(_){ }
  console.log('[Spesa Pronta] V28.54 PRO Cost Meter + Semantic Visual Signature Core active');
})();


// =============================================================
// V28.57 PRO EXPIRY MISSION LOCK SERVER
// La foto scadenza non cambia identità prodotto: estrae solo date plausibili,
// anche se OCR/OpenAI restituisce testo a puntini o spaziato.
// =============================================================
(function(){
  const V='V28.57';
  function cleanDateTextV2857(raw=''){
    let s=String(raw||'');
    s=s.replace(/[\u2010-\u2015]/g,'-').replace(/[•·∙●]/g,'.').replace(/[\\]/g,'/');
    s=s.replace(/[OoQ]/g,'0').replace(/[Il|!]/g,'1').replace(/[‚,;]/g,'.');
    for(let i=0;i<3;i++){
      s=s.replace(/(\d)\s+(\d)(?=\s*[\/\.\-])/g,'$1$2');
      s=s.replace(/([\/\.\-]\s*\d)\s+(\d)/g,'$1$2');
      s=s.replace(/(\d)\s*([\/\.\-])\s*(\d)/g,'$1$2$3');
    }
    return s;
  }
  function normYear(y){ y=String(y||'').replace(/\D/g,''); return y.length===2 ? ((Number(y)<70?'20':'19')+y) : y; }
  function valid(d,m,y){ d=Number(d); m=Number(m); y=Number(y); if(!(d>=1&&d<=31&&m>=1&&m<=12&&y>=2000&&y<=2059)) return false; const days=[31,((y%4===0&&y%100!==0)||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31]; return d<=days[m-1]; }
  function add(list,raw,d,m,y,confidence,kind){ y=normYear(y); if(valid(d,m,y)) list.push({raw:String(raw||'').trim(), text:`${String(Number(d)).padStart(2,'0')}/${String(Number(m)).padStart(2,'0')}/${y}`, confidence, kind}); }
  function expiryFromTextV2857(raw=''){
    const text=cleanDateTextV2857(raw); if(!text.trim()) return null;
    const out=[];
    for(const m of text.matchAll(/(?:scad(?:e|enza)?|exp|tmc|bb|best\s*before|entro|consumarsi|preferibilmente)?[^0-9]{0,12}\b([0-3]?\d)\s*[\/\.\-]\s*([01]?\d)\s*[\/\.\-]\s*(\d{2,4})\b/gi)) add(out,m[0],m[1],m[2],m[3],/(scad|exp|tmc|best|entro|consum|prefer)/i.test(m[0])?.98:.93,'separator');
    for(const m of text.matchAll(/(?:scad(?:e|enza)?|exp|tmc|bb|best\s*before|entro|consumarsi|preferibilmente)?[^0-9]{0,12}\b([0-3]\d)\s+([01]\d)\s+(\d{2,4})\b/gi)) add(out,m[0],m[1],m[2],m[3],/(scad|exp|tmc|best|entro|consum|prefer)/i.test(m[0])?.92:.78,'spaced');
    for(const m of text.matchAll(/(?:scad(?:e|enza)?|exp|tmc|bb|best\s*before|entro|consumarsi|preferibilmente)\D{0,10}([0-3]\d)([01]\d)(\d{2,4})\b/gi)) add(out,m[0],m[1],m[2],m[3],.84,'compact_with_keyword');
    const compactOnly=text.trim().match(/^([0-3]\d)([01]\d)(\d{2}|\d{4})$/); if(compactOnly) add(out,compactOnly[0],compactOnly[1],compactOnly[2],compactOnly[3],.72,'compact_only');
    for(const m of text.matchAll(/(?:scad(?:e|enza)?|exp|tmc|bb|best\s*before|entro|preferibilmente)?[^0-9]{0,10}\b([01]?\d)\s*[\/\.\-]\s*(20\d{2}|\d{2})\b(?!\s*[\/\.\-]\s*\d)/gi)){
      const mo=Number(m[1]); const y=normYear(m[2]); if(mo>=1&&mo<=12&&Number(y)>=2000&&Number(y)<=2059) out.push({raw:String(m[0]).trim(), text:`${String(mo).padStart(2,'0')}/${y}`, confidence:/(scad|exp|tmc|best|entro|prefer)/i.test(m[0])?.82:.65, kind:'month_year'});
    }
    out.sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)); return out[0]||null;
  }
  function expiryFromResultV2857(r={}){
    const fields=[r.expiryDate,r.expiry,r.expirationDate,r.expiration,r.expiryText,r.expiryDetectedRaw,r.bestBefore,r.bestBeforeText,r.reason,r.detailQuestion]
      .concat(Array.isArray(r.detectedText)?r.detectedText:[])
      .concat(Array.isArray(r.visibleEvidence)?r.visibleEvidence:[])
      .filter(Boolean);
    return expiryFromTextV2857(fields.join(' | '));
  }
  try{
    if(typeof visionAnalyze==='function' && !global.__v2857VisionAnalyzeWrapped){
      const prev=visionAnalyze;
      visionAnalyze=async function(payload={}){
        const stage=String(payload.stage||'auto').toLowerCase();
        const r=await prev.call(this,payload);
        if(stage==='expiry' && r && typeof r==='object'){
          const exp=expiryFromResultV2857(r);
          r.proExpiryMissionLockV2857=Object.assign({}, r.proExpiryMissionLockV2857||{}, {stage:'expiry', identityFrozen:true, parser:'dot_matrix_space_separator'});
          if(exp){
            r.expiryDate=exp.text; r.expiryDetectedRaw=exp.raw; r.expiryConfidence=Math.max(Number(r.expiryConfidence||0), Number(exp.confidence||.85));
            r.needsRetake=false; r.needsManual=true; r.shouldAskConfirmation=true;
            r.reason='Scadenza letta: controlla e conferma se corretta.';
            r.proExpiryMissionLockV2857.ok=true; r.proExpiryMissionLockV2857.expiryDate=exp.text; r.proExpiryMissionLockV2857.raw=exp.raw; r.proExpiryMissionLockV2857.confidence=exp.confidence; r.proExpiryMissionLockV2857.kind=exp.kind;
          }else{
            r.reason='Non ho isolato una data di scadenza sicura. La foto resta nello step scadenza: avvicina solo la data stampata, inclina per togliere riflessi, oppure compila manualmente/salta.';
            r.needsRetake=false; r.needsManual=true; r.shouldAskConfirmation=true;
            r.proExpiryMissionLockV2857.ok=false;
          }
          // In modalità scadenza il server non deve proporre identità nuove.
          r.productName=''; r.brand=''; r.category=r.category||'';
        }
        return r;
      };
      global.__v2857VisionAnalyzeWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof preflightSnapshotV98==='function' && !global.__v2857PreflightWrapped){
      const prev=preflightSnapshotV98;
      preflightSnapshotV98=function(){ const snap=prev.call(this); snap.version='V28.57'; snap.brain=Object.assign({}, snap.brain||{}, {version:'V28.57', name:'PRO Expiry Mission Lock + Dot-Matrix Reader', expiry:'missione solo scadenza, parser date puntini/spazi, niente loop foto prodotto'}); return snap; };
      global.__v2857PreflightWrapped=true;
    }
  }catch(_){ }
  console.log('[Spesa Pronta] V28.57 PRO Expiry Mission Lock active');
})();


// =============================================================
// V28.58 PRO Server Memory Recognition
// Una conferma utente reale deve già diventare memoria positiva utilizzabile.
// La memoria propone solo se ha identità concreta: barcode, nome/marca o token forti.
// =============================================================
try{
  const __prevMatchGlobalProductMemoryV2858 = matchGlobalProductMemory;
  function v2858MatchBlob(r={}){
    const card=r.memoryCard||{};
    const id=card.identity||{};
    const va=card.visualAppearance||{};
    return normalizeVisionText([
      r.productName,r.brand,r.format,r.category,r.unit,(r.aliases||[]).join(' '),(r.brands||[]).join(' '),(r.barcodes||[]).join(' '),
      id.productName,id.brand,id.format,(id.aliases||[]).join(' '),(id.brands||[]).join(' '),
      r.visualSignature,va.visualSignature,r.packaging,r.packageType,r.productType,va.productType,va.packageType,
      (r.evidenceTokens||[]).join(' '),(r.visibleEvidence||[]).join(' '),(r.detectedText||[]).join(' '),(r.colors||[]).join(' '),
      (r.objectFolder?.visualSignatures||[]).map(x=>x.signature||x).join(' ')
    ].filter(Boolean).join(' '));
  }
  function v2858ConcreteTokens(text=''){
    const stop=new Set(['prodotto','articolo','confezione','bottiglia','flacone','barattolo','vasetto','plastica','vetro','etichetta','tappo','verde','rosso','blu','bianco','nero','giallo','chiaro','scuro','trasparente','grande','piccolo','formato','categoria','marca','campo','manuale','scadenza','ingredienti','allergeni','tracce']);
    return [...new Set(normalizeVisionText(text).split(/\s+/).filter(t=>t.length>=3 && !stop.has(t) && !/^\d+$/.test(t)))];
  }
  matchGlobalProductMemory=function(query={}){
    const base=__prevMatchGlobalProductMemoryV2858(query);
    if(base?.product) return base;
    ensureDbShape();
    const barcode=bestBarcodeFromConfirmed(query)||String(query.barcode||query.ean||query.code||query.productCode||'').replace(/\D+/g,'');
    const qText=normalizeVisionText([
      query.productName,query.brand,query.size,query.format,query.category,query.visualSignature,
      ...(Array.isArray(query.detectedText)?query.detectedText:[query.detectedText||'']),
      ...(Array.isArray(query.visibleEvidence)?query.visibleEvidence:[query.visibleEvidence||'']),
      ...(Array.isArray(query.colors)?query.colors:[])
    ].filter(Boolean).join(' '));
    if(!barcode && qText.length<3) return null;
    const qName=normalizeVisionText(query.productName||'');
    const qBrand=normalizeVisionText(query.brand||'');
    const qTokens=v2858ConcreteTokens(qText);
    const products=Object.values(db.assistantBrain?.globalProductMemory?.products||{});
    let best=null;
    for(const p of products){
      const confirmations=Number(p.confirmations||0);
      if(confirmations<1 && p.reliability!=='media' && p.reliability!=='alta') continue;
      const bc=[p.barcode,(p.barcodes||[]).join(' '),p.memoryCard?.barcode,(p.memoryCard?.barcodes||[]).join(' ')].join(' ').replace(/\D+/g,' ');
      if(barcode && bc.includes(barcode)){
        const score=9.9+Math.min(1,confirmations/10);
        if(!best || score>best.score) best={score, product:Object.assign(compactGlobalProductRecord(p),{matchReason:'barcode_exact_memory_v2858', matchedTokens:[barcode], strongJaccard:1, confirmations})};
        continue;
      }
      const blob=v2858MatchBlob(p);
      const pTokens=v2858ConcreteTokens(blob);
      const overlap=qTokens.filter(t=>pTokens.includes(t));
      const j=tokenJaccard(qTokens,pTokens);
      const pName=normalizeVisionText(p.productName||'');
      const pBrand=normalizeVisionText(p.brand||'');
      const nameMatch=!!(qName && pName && (pName.includes(qName)||qName.includes(pName)));
      const brandMatch=!!(qBrand && pBrand && (pBrand.includes(qBrand)||qBrand.includes(pBrand)));
      if(qBrand && pBrand && brandLooksConflicting(qBrand,pBrand)) continue;
      const concrete=barcode || nameMatch || brandMatch || overlap.length>=2 || j>=0.38;
      if(!concrete) continue;
      const oneConfirmationStrict = confirmations<=1 && !(nameMatch || brandMatch || overlap.length>=2 || j>=0.44);
      if(oneConfirmationStrict) continue;
      let score=overlap.length*1.15 + j*4 + confirmations*.35;
      if(nameMatch) score+=4.5;
      if(brandMatch) score+=3.5;
      if(p.reliability==='alta') score+=1.3; else if(p.reliability==='media') score+=.9;
      if(score<2.2) continue;
      if(!best || score>best.score) best={score, product:Object.assign(compactGlobalProductRecord(p),{matchReason:confirmations<=1?'one_user_confirmation_memory_v2858':'server_memory_v2858', matchedTokens:overlap.slice(0,10), strongJaccard:Number(j.toFixed(3)), confirmations})};
    }
    if(best){
      try{ updateGlobalLearningAudit({type:'v2858-memory-match', productName:best.product.productName, brand:best.product.brand, score:Number(best.score.toFixed(3)), reason:best.product.matchReason, confirmations:best.product.confirmations}); }catch(_){ }
    }
    return best;
  };
  try{ const prevPreflightV2858=preflightSnapshotV98; preflightSnapshotV98=function(){ const s=prevPreflightV2858.call(this); s.version='V28.58'; s.brain=Object.assign({},s.brain||{},{oneConfirmationMemory:true, barcodeStep2:true, smartSummaryHidden:true}); return s; }; }catch(_){ }
}catch(e){ console.warn('V28.58 server memory patch failed', e && e.message); }

// =============================================================
// V28.60 PRO Real Visual Memory Match
// Trasforma la firma foto in un confronto immagini gratuito: nessun token OpenAI.
// La memoria visiva diventa utilizzabile già dalla seconda scansione se la foto è simile.
// =============================================================
(function(){
  function n(v,d=0){ v=Number(v); return Number.isFinite(v)?v:d; }
  function short(v,m=180){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,m); }
  function sigArr(sig=''){ return String(sig||'').split('-').map(x=>Number(x)).filter(x=>Number.isFinite(x)); }
  function sigDist(a='',b=''){
    const aa=sigArr(a), bb=sigArr(b); if(!aa.length || !bb.length || aa.length!==bb.length) return 99;
    let s=0; for(let i=0;i<aa.length;i++) s+=Math.abs(aa[i]-bb[i]); return s/aa.length;
  }
  function compactFeature(f={}){
    if(!f || typeof f!=='object') return null;
    const out={
      signature:short(f.signature||'',140), centerSignature:short(f.centerSignature||f.objectCenterSignature||'',140), labelSignature:short(f.labelSignature||'',140),
      objectWidth:n(f.objectWidth), objectHeight:n(f.objectHeight), objectCoverage:n(f.objectCoverage), edge:n(f.edge), verticality:n(f.verticality,1),
      bottleLike:!!f.bottleLike, largeBottleLike:!!f.largeBottleLike, colorKey:short(f.colorKey||'',70),
      center:f.center&&typeof f.center==='object'?{r:n(f.center.r),g:n(f.center.g),b:n(f.center.b),red:n(f.center.red),blue:n(f.center.blue),green:n(f.center.green),white:n(f.center.white),dark:n(f.center.dark),clear:n(f.center.clear),lum:n(f.center.lum)}:null,
      label:f.label&&typeof f.label==='object'?{r:n(f.label.r),g:n(f.label.g),b:n(f.label.b),red:n(f.label.red),blue:n(f.label.blue),green:n(f.label.green),white:n(f.label.white),dark:n(f.label.dark),clear:n(f.label.clear),lum:n(f.label.lum)}:null,
      width:n(f.width), height:n(f.height), version:'V28.60_free_visual_fingerprint'
    };
    if(!out.signature && !out.centerSignature && !out.colorKey && !out.objectHeight) return null;
    return out;
  }
  function numDiff(a,b,scale=1){ return Math.min(1, Math.abs(n(a)-n(b))/Math.max(.0001,scale)); }
  function colorDist(a={},b={}){
    if(!a||!b) return .35;
    const dr=numDiff(a.r,b.r,255), dg=numDiff(a.g,b.g,255), db=numDiff(a.b,b.b,255);
    return Math.min(1, (dr+dg+db)/3);
  }
  function featureDistance(a={},b={}){
    a=compactFeature(a)||{}; b=compactFeature(b)||{};
    let total=0, w=0;
    const add=(d,wt)=>{ if(Number.isFinite(Number(d))){ total+=Math.min(1,Math.max(0,d))*wt; w+=wt; } };
    if(a.centerSignature && b.centerSignature) add(Math.min(1,sigDist(a.centerSignature,b.centerSignature)/16), .30);
    if(a.labelSignature && b.labelSignature) add(Math.min(1,sigDist(a.labelSignature,b.labelSignature)/16), .20);
    if(a.signature && b.signature) add(Math.min(1,sigDist(a.signature,b.signature)/16), .16);
    add(numDiff(a.objectWidth,b.objectWidth,.65), .10);
    add(numDiff(a.objectHeight,b.objectHeight,.75), .13);
    add(numDiff(a.objectCoverage,b.objectCoverage,.55), .06);
    add(numDiff(Math.min(80,a.edge),Math.min(80,b.edge),80), .05);
    add(numDiff(Math.min(4,a.verticality),Math.min(4,b.verticality),4), .04);
    if(a.colorKey && b.colorKey) add(a.colorKey===b.colorKey?0:.18, .07);
    if(a.center&&b.center) add(colorDist(a.center,b.center), .08);
    if(a.label&&b.label) add(colorDist(a.label,b.label), .08);
    if(!!a.bottleLike!==!!b.bottleLike) add(.32,.06); else add(0,.03);
    if(!!a.largeBottleLike!==!!b.largeBottleLike) add(.24,.04); else add(0,.02);
    return w ? Math.min(1,total/w) : 1;
  }
  function featureSamples(record={}){
    const out=[];
    const push=(f,source='')=>{ const c=compactFeature(f); if(c) out.push({features:c,source}); };
    (record.objectFolder?.visualFeatureSamples||[]).forEach(s=>push(s.features||s.visualFeatures||s, s.source||'object_folder'));
    (record.confirmedExamples||[]).forEach(s=>push(s.visualFeatures, 'confirmed_example'));
    push(record.visualFeatures,'record');
    push(record.memoryCard?.visualFeatures,'memory_card');
    // fallback: firma semantica precedente come indizio debole, non basta da sola.
    const sig=record.visualSignature || record.memoryCard?.visualAppearance?.visualSignature;
    if(sig) push({signature:sig, colorKey:(record.colors||[]).slice(0,3).join('|')}, 'old_signature_fallback');
    return out.slice(0,48);
  }
  function visualMatch(query={}){
    try{
      ensureDbShape();
      const q=compactFeature(query.visualFeatures||query.visualFingerprint||query.features||{}); if(!q) return null;
      const products=Object.values(db.assistantBrain?.globalProductMemory?.products||{});
      const ranked=[];
      for(const p of products){
        const confirmations=Number(p.confirmations||0); if(confirmations<1 && p.reliability!=='media' && p.reliability!=='alta') continue;
        const samples=featureSamples(p); if(!samples.length) continue;
        let best=null;
        for(const s of samples){
          const dist=featureDistance(q,s.features); const sim=1-dist;
          if(!best || sim>best.similarity) best={similarity:sim, distance:dist, source:s.source};
        }
        if(!best) continue;
        // Soglia prudente: con una sola conferma accettiamo solo foto molto simili.
        const threshold = confirmations<=1 ? .74 : .68;
        if(best.similarity < threshold) continue;
        let score=best.similarity*10 + Math.min(2,confirmations*.35);
        if(p.reliability==='alta') score+=1.1; else if(p.reliability==='media') score+=.7;
        ranked.push({score, product:p, match:best, confirmations, sampleCount:samples.length});
      }
      ranked.sort((a,b)=>b.score-a.score);
      const top=ranked[0]; if(!top) return null;
      const second=ranked[1];
      const margin=second ? (top.match.similarity-second.match.similarity) : .25;
      if(top.confirmations<=1 && margin<.015 && top.match.similarity<.84) return null;
      const compact=compactGlobalProductRecord(top.product);
      compact.visualMemoryMatchV2860={active:true, similarity:Number(top.match.similarity.toFixed(3)), distance:Number(top.match.distance.toFixed(3)), margin:Number(margin.toFixed(3)), sampleCount:top.sampleCount, source:top.match.source, policy:'confronto gratuito tra impronte immagine salvate; niente OpenAI'};
      compact.matchReason='free_visual_memory_v2860';
      compact.teacherBypassEligible=true;
      compact.reliability=compact.reliability||'media';
      try{ updateGlobalLearningAudit({type:'v2860-free-visual-memory-match', productName:compact.productName, brand:compact.brand, similarity:compact.visualMemoryMatchV2860.similarity, confirmations:top.confirmations, sampleCount:top.sampleCount}); }catch(_){}
      return {score:top.score, product:compact};
    }catch(e){ try{ updateGlobalLearningAudit({type:'v2860-visual-match-error', reason:String(e?.message||e).slice(0,160)}); }catch(_){} return null; }
  }

  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2860UpsertVisualWrapped){
      const prev=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        const compact=prev.call(this,confirmed);
        try{
          ensureDbShape();
          const g=db.assistantBrain.globalProductMemory||{products:{}};
          const key=compact?.key || (confirmed.barcode?`ean:${confirmed.barcode}`:'');
          const rec=(key&&g.products?.[key]) || Object.values(g.products||{}).find(r=>normalizeVisionText(r.productName||'')===normalizeVisionText(compact?.productName||confirmed.productName||'') && normalizeVisionText(r.brand||'')===normalizeVisionText(compact?.brand||confirmed.brand||''));
          if(rec){
            rec.objectFolder=rec.objectFolder||{photos:[],visualSignatures:[]};
            const c=compactFeature(confirmed.visualFeatures || confirmed.productMemory?.visualFeatures || {});
            if(c){
              rec.objectFolder.visualFeatureSamples=Array.isArray(rec.objectFolder.visualFeatureSamples)?rec.objectFolder.visualFeatureSamples:[];
              const duplicate=rec.objectFolder.visualFeatureSamples.some(s=>featureDistance(c,s.features||s)<.035);
              if(!duplicate) rec.objectFolder.visualFeatureSamples.unshift({features:c, at:Date.now(), source:'user_confirmed_front_v2860', productName:confirmed.productName||rec.productName||'', brand:confirmed.brand||rec.brand||''});
              rec.objectFolder.visualFeatureSamples=rec.objectFolder.visualFeatureSamples.slice(0,36);
              rec.visualFeatures=c;
              rec.freeVisualMemoryV2860={active:true, samples:rec.objectFolder.visualFeatureSamples.length, updatedAt:Date.now(), policy:'foto confermate trasformate in impronte numeriche gratuite'};
              rec.learningQuality=Object.assign({},rec.learningQuality||{}, {freeVisualRecognition:true, visualSamples:rec.objectFolder.visualFeatureSamples.length, enoughForLocalRecognition:true});
              updateGlobalLearningAudit({type:'v2860-visual-fingerprint-saved', productName:rec.productName, brand:rec.brand, samples:rec.objectFolder.visualFeatureSamples.length});
            }
          }
        }catch(e){ try{ updateGlobalLearningAudit({type:'v2860-visual-fingerprint-save-error', reason:String(e?.message||e).slice(0,160)}); }catch(_){} }
        return compact;
      };
      global.__v2860UpsertVisualWrapped=true;
    }
  }catch(_){ }

  try{
    if(typeof matchGlobalProductMemory==='function' && !global.__v2860MatchVisualWrapped){
      const prev=matchGlobalProductMemory;
      matchGlobalProductMemory=function(query={}){
        const base=prev.call(this,query);
        if(base?.product) return base;
        const vm=visualMatch(query||{});
        return vm || null;
      };
      global.__v2860MatchVisualWrapped=true;
    }
  }catch(_){ }

  try{ const prev=preflightSnapshotV98; if(typeof prev==='function' && !global.__v2860PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.60'; s.brain=Object.assign({},s.brain||{},{version:'V28.61', freeVisualMemory:'active', visualFingerprintMatch:'server-side numeric image fingerprints, zero OpenAI tokens'}); return s; }; global.__v2860PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.60 PRO Real Visual Memory Match active');
})();

// =============================================================
// V28.61 PRO Deep Visual Memory Match
// Match gratuito più profondo: ROI oggetto + label + hash percettivi + istogrammi.
// =============================================================
(function(){
  function n(v,d=0){ v=Number(v); return Number.isFinite(v)?v:d; }
  function clean(v,m=180){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,m); }
  function arrNums(a){ return Array.isArray(a)?a.map(x=>Number(x)).filter(x=>Number.isFinite(x)):[]; }
  function sigArr(sig=''){ return String(sig||'').split('-').map(x=>Number(x)).filter(x=>Number.isFinite(x)); }
  function sigDistance(a='',b=''){
    const aa=sigArr(a), bb=sigArr(b); if(!aa.length || !bb.length || aa.length!==bb.length) return null;
    let s=0; for(let i=0;i<aa.length;i++) s+=Math.abs(aa[i]-bb[i]); return Math.min(1,(s/aa.length)/16);
  }
  function bitCount4(x){ x&=15; return [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4][x]||0; }
  function hammingHex(a='',b=''){
    a=String(a||''); b=String(b||''); if(!a||!b||a.length!==b.length) return null;
    let diff=0,total=a.length*4;
    for(let i=0;i<a.length;i++){ const x=parseInt(a[i],16), y=parseInt(b[i],16); if(!Number.isFinite(x)||!Number.isFinite(y)) return null; diff+=bitCount4(x^y); }
    return diff/Math.max(1,total);
  }
  function histDist(a=[],b=[]){
    a=arrNums(a); b=arrNums(b); if(!a.length||!b.length||a.length!==b.length) return null;
    let s=0; for(let i=0;i<a.length;i++) s+=Math.abs(a[i]-b[i]); return Math.min(1,s/2000);
  }
  function stripeDist(a='',b=''){
    const aa=String(a||'').split('|').filter(Boolean), bb=String(b||'').split('|').filter(Boolean); if(!aa.length||aa.length!==bb.length) return null;
    let s=0,c=0;
    for(let i=0;i<aa.length;i++){
      const x=aa[i].split('.').map(Number), y=bb[i].split('.').map(Number); if(x.length!==y.length) continue;
      for(let j=0;j<x.length;j++){ if(Number.isFinite(x[j])&&Number.isFinite(y[j])){ s+=Math.abs(x[j]-y[j]); c++; } }
    }
    return c?Math.min(1,(s/c)/10):null;
  }
  function bboxDist(a={},b={}){
    if(!a||!b) return null;
    const keys=['w','h','aspect','area']; let s=0,c=0;
    keys.forEach(k=>{ if(Number.isFinite(Number(a[k]))&&Number.isFinite(Number(b[k]))){ const scale=k==='aspect'?4:1; s+=Math.min(1,Math.abs(Number(a[k])-Number(b[k]))/scale); c++; } });
    return c?s/c:null;
  }
  function deepOf(f={}){ return f?.visualDeepV2861 || f?.deepVisualV2861 || f?.features?.visualDeepV2861 || null; }
  function compactV2861(f={}){
    if(!f||typeof f!=='object') return null;
    const d=deepOf(f)||{};
    const bbox=f.objectBBoxV2861 || d.bbox || {};
    const out={
      signature:clean(f.signature||d.oldSignature||'',160), centerSignature:clean(f.centerSignature||d.centerSignature||'',160), labelSignature:clean(f.labelSignature||d.labelSignature||'',160), colorKey:clean(f.colorKey||d.colorKey||'',90),
      objectWidth:n(f.objectWidth), objectHeight:n(f.objectHeight), objectCoverage:n(f.objectCoverage), edge:n(f.edge), verticality:n(f.verticality,1), bottleLike:!!f.bottleLike, largeBottleLike:!!f.largeBottleLike,
      visualDeepV2861:{
        version:'V28.61_deep_visual_fingerprint',
        objectHashH:clean(d.objectHashH||'',32), objectHashV:clean(d.objectHashV||'',32), centerHashH:clean(d.centerHashH||'',32), centerHashV:clean(d.centerHashV||'',32), labelHashH:clean(d.labelHashH||'',32), labelHashV:clean(d.labelHashV||'',32), upperHashH:clean(d.upperHashH||'',32), lowerHashH:clean(d.lowerHashH||'',32),
        objectGrid:clean(d.objectGrid||'',260), centerGrid:clean(d.centerGrid||'',260), labelGrid:clean(d.labelGrid||'',220),
        objectHist:arrNums(d.objectHist||[]).slice(0,27), labelHist:arrNums(d.labelHist||[]).slice(0,27), stripeSignature:clean(d.stripeSignature||'',140), labelStripeSignature:clean(d.labelStripeSignature||'',100),
        bbox:{w:n(bbox.w),h:n(bbox.h),aspect:n(bbox.aspect),area:n(bbox.area)}
      },
      version:'V28.61_deep_visual_memory'
    };
    const hasDeep=Object.values(out.visualDeepV2861).some(v=>Array.isArray(v)?v.length:!!v);
    if(!out.signature && !out.centerSignature && !out.labelSignature && !out.colorKey && !hasDeep) return null;
    return out;
  }
  function legacyDist(a={},b={}){
    let total=0,w=0; const add=(d,wt)=>{ if(d!==null && d!==undefined && Number.isFinite(Number(d))){ total+=Math.min(1,Math.max(0,Number(d)))*wt; w+=wt; } };
    add(sigDistance(a.centerSignature,b.centerSignature),.22); add(sigDistance(a.labelSignature,b.labelSignature),.18); add(sigDistance(a.signature,b.signature),.12);
    ['objectWidth','objectHeight','objectCoverage','verticality'].forEach(k=>{ if(Number.isFinite(Number(a[k]))&&Number.isFinite(Number(b[k]))) add(Math.min(1,Math.abs(Number(a[k])-Number(b[k]))/(k==='verticality'?4:1)),.06); });
    if(a.colorKey&&b.colorKey) add(a.colorKey===b.colorKey?0:.2,.05);
    if(!!a.bottleLike!==!!b.bottleLike) add(.35,.04); else add(0,.025);
    return w?total/w:1;
  }
  function deepDistance(a={},b={}){
    a=compactV2861(a)||{}; b=compactV2861(b)||{}; const da=a.visualDeepV2861||{}, db=b.visualDeepV2861||{};
    let total=0,w=0; const add=(d,wt)=>{ if(d!==null && d!==undefined && Number.isFinite(Number(d))){ total+=Math.min(1,Math.max(0,Number(d)))*wt; w+=wt; } };
    add(hammingHex(da.labelHashH,db.labelHashH),.18); add(hammingHex(da.labelHashV,db.labelHashV),.12);
    add(hammingHex(da.objectHashH,db.objectHashH),.12); add(hammingHex(da.objectHashV,db.objectHashV),.10);
    add(hammingHex(da.centerHashH,db.centerHashH),.08); add(hammingHex(da.centerHashV,db.centerHashV),.06);
    add(sigDistance(da.labelGrid,db.labelGrid),.13); add(sigDistance(da.objectGrid,db.objectGrid),.10); add(sigDistance(da.centerGrid,db.centerGrid),.06);
    add(histDist(da.labelHist,db.labelHist),.08); add(histDist(da.objectHist,db.objectHist),.06);
    add(stripeDist(da.stripeSignature,db.stripeSignature),.05); add(stripeDist(da.labelStripeSignature,db.labelStripeSignature),.05);
    add(bboxDist(da.bbox,db.bbox),.09);
    add(legacyDist(a,b),.18);
    return w?Math.min(1,total/w):legacyDist(a,b);
  }
  function featureSamplesV2861(record={}){
    const out=[]; const push=(f,source='')=>{ const c=compactV2861(f); if(c) out.push({features:c,source}); };
    (record.objectFolder?.visualFeatureSamples||[]).forEach(s=>push(s.features||s.visualFeatures||s, s.source||'object_folder'));
    (record.confirmedExamples||[]).forEach(s=>push(s.visualFeatures, 'confirmed_example'));
    push(record.visualFeatures,'record'); push(record.memoryCard?.visualFeatures,'memory_card');
    return out.slice(0,64);
  }
  function visualMatchV2861(query={}){
    try{
      ensureDbShape(); const q=compactV2861(query.visualFeatures||query.visualFingerprint||query.features||{}); if(!q) return null;
      const products=Object.values(db.assistantBrain?.globalProductMemory?.products||{}); const ranked=[];
      for(const p of products){
        const confirmations=Number(p.confirmations||0); if(confirmations<1 && p.reliability!=='media' && p.reliability!=='alta') continue;
        const samples=featureSamplesV2861(p); if(!samples.length) continue;
        let best=null;
        for(const s of samples){ const dist=deepDistance(q,s.features); const sim=1-dist; if(!best || sim>best.similarity) best={similarity:sim,distance:dist,source:s.source}; }
        if(!best) continue;
        // Soglie PRO: abbastanza permissive per stesso prodotto/frontale, ma richiedono somiglianza reale.
        const threshold=confirmations<=1 ? .76 : .70;
        if(best.similarity<threshold) continue;
        let score=best.similarity*10 + Math.min(2.5,confirmations*.42);
        if(p.reliability==='alta') score+=1.25; else if(p.reliability==='media') score+=.85;
        if(p.ownerOverrides?.locked) score+=.35;
        ranked.push({score,product:p,match:best,confirmations,sampleCount:samples.length});
      }
      ranked.sort((a,b)=>b.score-a.score); const top=ranked[0]; if(!top) return null;
      const second=ranked[1]; const margin=second ? (top.match.similarity-second.match.similarity) : .30;
      if(top.confirmations<=1 && margin<.012 && top.match.similarity<.86) return null;
      const compact=compactGlobalProductRecord(top.product);
      compact.visualMemoryMatchV2861={active:true, similarity:Number(top.match.similarity.toFixed(3)), distance:Number(top.match.distance.toFixed(3)), margin:Number(margin.toFixed(3)), sampleCount:top.sampleCount, source:top.match.source, engine:'deep_hash_bbox_label_hist_v2861', policy:'match gratuito: ROI prodotto + etichetta + silhouette + colore; zero OpenAI'};
      compact.matchReason='deep_visual_memory_v2861'; compact.teacherBypassEligible=true; compact.reliability=compact.reliability||'media';
      try{ updateGlobalLearningAudit({type:'v2861-deep-visual-memory-match', productName:compact.productName, brand:compact.brand, similarity:compact.visualMemoryMatchV2861.similarity, confirmations:top.confirmations, sampleCount:top.sampleCount}); }catch(_){ }
      return {score:top.score, product:compact};
    }catch(e){ try{ updateGlobalLearningAudit({type:'v2861-visual-match-error', reason:String(e?.message||e).slice(0,180)}); }catch(_){} return null; }
  }
  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2861UpsertVisualWrapped){
      const prev=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        const compact=prev.call(this,confirmed);
        try{
          ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}};
          const key=compact?.key || (confirmed.barcode?`ean:${confirmed.barcode}`:'');
          const rec=(key&&g.products?.[key]) || Object.values(g.products||{}).find(r=>normalizeVisionText(r.productName||'')===normalizeVisionText(compact?.productName||confirmed.productName||'') && normalizeVisionText(r.brand||'')===normalizeVisionText(compact?.brand||confirmed.brand||''));
          const c=compactV2861(confirmed.visualFeatures || confirmed.productMemory?.visualFeatures || {});
          if(rec && c){
            rec.objectFolder=rec.objectFolder||{photos:[],visualSignatures:[],visualFeatureSamples:[]};
            rec.objectFolder.visualFeatureSamples=Array.isArray(rec.objectFolder.visualFeatureSamples)?rec.objectFolder.visualFeatureSamples:[];
            const duplicate=rec.objectFolder.visualFeatureSamples.some(s=>deepDistance(c,s.features||s)<.028);
            if(!duplicate) rec.objectFolder.visualFeatureSamples.unshift({features:c, at:Date.now(), source:'user_confirmed_deep_visual_v2861', productName:confirmed.productName||rec.productName||'', brand:confirmed.brand||rec.brand||''});
            rec.objectFolder.visualFeatureSamples=rec.objectFolder.visualFeatureSamples.slice(0,54);
            rec.visualFeatures=c; rec.deepVisualMemoryV2861={active:true,samples:rec.objectFolder.visualFeatureSamples.length,updatedAt:Date.now(),engine:'deep_hash_bbox_label_hist',cost:'zero_openai_tokens'};
            rec.learningQuality=Object.assign({},rec.learningQuality||{}, {deepVisualRecognition:true, visualSamples:rec.objectFolder.visualFeatureSamples.length, enoughForLocalRecognition:true});
            updateGlobalLearningAudit({type:'v2861-deep-visual-fingerprint-saved', productName:rec.productName, brand:rec.brand, samples:rec.objectFolder.visualFeatureSamples.length});
          }
        }catch(e){ try{ updateGlobalLearningAudit({type:'v2861-deep-visual-save-error', reason:String(e?.message||e).slice(0,180)}); }catch(_){} }
        return compact;
      };
      global.__v2861UpsertVisualWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof matchGlobalProductMemory==='function' && !global.__v2861MatchVisualWrapped){
      const prev=matchGlobalProductMemory;
      matchGlobalProductMemory=function(query={}){
        if(query?.visualOnly || /v2861|deep_visual/i.test(String(query?.matchMode||''))){ const deep=visualMatchV2861(query||{}); if(deep) return deep; }
        const base=prev.call(this,query); if(base?.product) return base;
        return visualMatchV2861(query||{}) || null;
      };
      global.__v2861MatchVisualWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function' && !global.__v2861PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.61'; s.brain=Object.assign({},s.brain||{},{version:'V28.61', deepVisualMemory:'active', visualEngine:'ROI + label hash + histogram + silhouette', openAiTokens:'zero for memory match'}); return s; }; global.__v2861PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.61 PRO Deep Visual Memory Match active');
})();
// =============================================================
// V28.62 PRO Visual Truth Memory server patch
// Match gratuito più permissivo ma controllato, con ancore visive: liquido scuro/label forte.
// =============================================================
(function(){
  function n(v,d=0){ v=Number(v); return Number.isFinite(v)?v:d; }
  function clean(v,m=180){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,m); }
  function arrNums(a){ return Array.isArray(a)?a.map(Number).filter(Number.isFinite):[]; }
  function bitCount4(x){ x&=15; return [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4][x]||0; }
  function hammingHex(a='',b=''){ a=String(a||''); b=String(b||''); if(!a||!b||a.length!==b.length) return null; let diff=0,total=a.length*4; for(let i=0;i<a.length;i++){ const x=parseInt(a[i],16), y=parseInt(b[i],16); if(!Number.isFinite(x)||!Number.isFinite(y)) return null; diff+=bitCount4(x^y); } return diff/Math.max(1,total); }
  function sigArr(s=''){ return String(s||'').split('-').map(Number).filter(Number.isFinite); }
  function sigDistance(a='',b=''){ const aa=sigArr(a),bb=sigArr(b); if(!aa.length||aa.length!==bb.length) return null; let s=0; for(let i=0;i<aa.length;i++) s+=Math.abs(aa[i]-bb[i]); return Math.min(1,(s/aa.length)/16); }
  function gridDistance(a='',b=''){ const aa=String(a||'').split('-').map(Number).filter(Number.isFinite), bb=String(b||'').split('-').map(Number).filter(Number.isFinite); if(!aa.length||aa.length!==bb.length) return null; let s=0; for(let i=0;i<aa.length;i++) s+=Math.abs(aa[i]-bb[i]); return Math.min(1,(s/aa.length)/16); }
  function histDist(a=[],b=[]){ a=arrNums(a); b=arrNums(b); if(!a.length||!b.length||a.length!==b.length) return null; let s=0; for(let i=0;i<a.length;i++) s+=Math.abs(a[i]-b[i]); return Math.min(1,s/2000); }
  function bboxDist(a={},b={}){ const keys=['w','h','aspect','area']; let s=0,c=0; for(const k of keys){ if(Number.isFinite(Number(a?.[k]))&&Number.isFinite(Number(b?.[k]))){ s+=Math.min(1,Math.abs(Number(a[k])-Number(b[k]))/(k==='aspect'?4:1)); c++; } } return c?s/c:null; }
  function stripeDist(a='',b=''){ const aa=String(a||'').split('|').filter(Boolean), bb=String(b||'').split('|').filter(Boolean); if(!aa.length||aa.length!==bb.length) return null; let s=0,c=0; for(let i=0;i<aa.length;i++){ const x=aa[i].split('.').map(Number), y=bb[i].split('.').map(Number); if(x.length!==y.length) continue; for(let j=0;j<x.length;j++){ if(Number.isFinite(x[j])&&Number.isFinite(y[j])){ s+=Math.abs(x[j]-y[j]); c++; } } } return c?Math.min(1,(s/c)/10):null; }
  function deepOf(f={}){ return f?.visualDeepV2861||f?.deepVisualV2861||f?.features?.visualDeepV2861||null; }
  function compactAnchors(a={}){ if(!a||typeof a!=='object') return null; return {version:'V28.62',bottleLikely:!!a.bottleLikely,darkBeverageLike:!!a.darkBeverageLike,colaLike:!!a.colaLike,waterImpossible:!!a.waterImpossible,waterLike:!!a.waterLike,darkLiquidScore:n(a.darkLiquidScore),labelBandScore:n(a.labelBandScore),strongLabelColor:n(a.strongLabelColor),clearWaterScore:n(a.clearWaterScore)}; }
  function compact(f={}){ if(!f||typeof f!=='object') return null; const d=deepOf(f)||{}, bbox=f.objectBBoxV2861||d.bbox||{}; const out={signature:clean(f.signature||d.oldSignature||'',160),centerSignature:clean(f.centerSignature||d.centerSignature||'',160),labelSignature:clean(f.labelSignature||d.labelSignature||'',160),colorKey:clean(f.colorKey||d.colorKey||'',90),objectWidth:n(f.objectWidth),objectHeight:n(f.objectHeight),objectCoverage:n(f.objectCoverage),edge:n(f.edge),verticality:n(f.verticality,1),bottleLike:!!f.bottleLike,largeBottleLike:!!f.largeBottleLike,visualAnchorsV2862:compactAnchors(f.visualAnchorsV2862||f.anchorsV2862||f.features?.visualAnchorsV2862),visualDeepV2861:{objectHashH:clean(d.objectHashH||'',32),objectHashV:clean(d.objectHashV||'',32),centerHashH:clean(d.centerHashH||'',32),centerHashV:clean(d.centerHashV||'',32),labelHashH:clean(d.labelHashH||'',32),labelHashV:clean(d.labelHashV||'',32),upperHashH:clean(d.upperHashH||'',32),lowerHashH:clean(d.lowerHashH||'',32),objectGrid:clean(d.objectGrid||'',260),centerGrid:clean(d.centerGrid||'',260),labelGrid:clean(d.labelGrid||'',220),objectHist:arrNums(d.objectHist||[]).slice(0,27),labelHist:arrNums(d.labelHist||[]).slice(0,27),stripeSignature:clean(d.stripeSignature||'',140),labelStripeSignature:clean(d.labelStripeSignature||'',100),bbox:{w:n(bbox.w),h:n(bbox.h),aspect:n(bbox.aspect),area:n(bbox.area)}}}; const has=out.signature||out.centerSignature||out.labelSignature||out.colorKey||out.visualAnchorsV2862||Object.values(out.visualDeepV2861).some(v=>Array.isArray(v)?v.length:!!v); return has?out:null; }
  function inferAnchors(f={}){ const c=compact(f); if(!c) return null; if(c.visualAnchorsV2862) return c.visualAnchorsV2862; const darkish=String(c.colorKey||'').split('-').some(x=>Number(x)<=3); const bbox=c.visualDeepV2861?.bbox||{}; const bottle=!!(c.bottleLike||c.largeBottleLike||bbox.aspect>1.35); return {version:'V28.62_inferred',bottleLikely:bottle,darkBeverageLike:!!(darkish&&bottle),colaLike:false,waterImpossible:!!darkish,waterLike:false,darkLiquidScore:darkish ? .3 : 0,labelBandScore:.25,clearWaterScore:0}; }
  function distance(a={},b={}){ a=compact(a)||{}; b=compact(b)||{}; const da=a.visualDeepV2861||{}, db=b.visualDeepV2861||{}; let total=0,w=0; const add=(d,wt)=>{ if(d!==null&&d!==undefined&&Number.isFinite(Number(d))){ total+=Math.min(1,Math.max(0,Number(d)))*wt; w+=wt; } }; add(hammingHex(da.labelHashH,db.labelHashH),.20); add(hammingHex(da.labelHashV,db.labelHashV),.13); add(hammingHex(da.objectHashH,db.objectHashH),.11); add(hammingHex(da.objectHashV,db.objectHashV),.09); add(gridDistance(da.labelGrid,db.labelGrid),.14); add(gridDistance(da.objectGrid,db.objectGrid),.08); add(histDist(da.labelHist,db.labelHist),.09); add(histDist(da.objectHist,db.objectHist),.05); add(stripeDist(da.stripeSignature,db.stripeSignature),.045); add(stripeDist(da.labelStripeSignature,db.labelStripeSignature),.055); add(bboxDist(da.bbox,db.bbox),.08); add(sigDistance(a.labelSignature,b.labelSignature),.12); add(sigDistance(a.centerSignature,b.centerSignature),.10); add(sigDistance(a.signature,b.signature),.05); if(a.colorKey&&b.colorKey) add(a.colorKey===b.colorKey?0:.18,.035); if(!!a.bottleLike!==!!b.bottleLike) add(.28,.025); const aa=a.visualAnchorsV2862, ab=b.visualAnchorsV2862; if(aa&&ab){ add((!!aa.darkBeverageLike===!!ab.darkBeverageLike)?0:.22,.05); add((!!aa.colaLike===!!ab.colaLike)?0:.18,.04); add(Math.abs(n(aa.darkLiquidScore)-n(ab.darkLiquidScore)),.045); add(Math.abs(n(aa.labelBandScore)-n(ab.labelBandScore)),.04); } return w?Math.min(1,total/w):1; }
  function samples(record={}){ const out=[]; const push=(f,source='')=>{ const c=compact(f); if(c) out.push({features:c,source}); }; (record.objectFolder?.visualFeatureSamples||[]).forEach(s=>push(s.features||s.visualFeatures||s,s.source||'object_folder')); (record.confirmedExamples||[]).forEach(s=>push(s.visualFeatures,'confirmed_example')); push(record.visualFeatures,'record'); push(record.memoryCard?.visualFeatures,'memory_card'); return out.slice(0,80); }
  function visualMatch(query={}){ try{ ensureDbShape(); const q=compact(query.visualFeatures||query.visualFingerprint||query.features||{}); if(!q) return null; const qA=q.visualAnchorsV2862||inferAnchors(q)||{}; const ranked=[]; for(const p of Object.values(db.assistantBrain?.globalProductMemory?.products||{})){ const confirmations=Number(p.confirmations||0); if(confirmations<1&&p.reliability!=='media'&&p.reliability!=='alta') continue; const ss=samples(p); if(!ss.length) continue; let best=null; for(const s of ss){ const dist=distance(q,s.features); const sim=1-dist; const sA=s.features.visualAnchorsV2862||inferAnchors(s.features)||{}; const anchorCompat=(qA.darkBeverageLike&&sA.darkBeverageLike)||(qA.colaLike&&sA.colaLike)||(qA.waterLike&&sA.waterLike&&!qA.waterImpossible&&!sA.waterImpossible); const score=sim+(anchorCompat?.045:0); if(!best||score>best.score) best={similarity:sim,distance:dist,source:s.source,anchorCompat,score}; } if(!best) continue; const txt=normalizeVisionText([p.productName,p.brand,p.category,(p.aliases||[]).join(' ')].join(' ')); const productLooksCola=/\b(cola|coca cola|pepsi|fanta|sprite|bibita|soft drink)\b/.test(txt)||/soft_drinks|drinks/.test(String(p.category||'')); let threshold=confirmations<=1?.68:.62; if(best.anchorCompat) threshold-=.05; if(qA.darkBeverageLike&&productLooksCola) threshold-=.04; if(qA.waterLike&&/\bacqua\b|water/.test(txt)) threshold-=.035; threshold=Math.max(.56,threshold); if(best.similarity<threshold) continue; let score=best.similarity*10+Math.min(3,confirmations*.45)+(best.anchorCompat?.85:0); if(p.reliability==='alta') score+=1.2; else if(p.reliability==='media') score+=.8; if(p.ownerOverrides?.locked) score+=.45; if(qA.darkBeverageLike&&productLooksCola) score+=.9; ranked.push({score,product:p,match:best,confirmations,sampleCount:ss.length,threshold}); }
    ranked.sort((a,b)=>b.score-a.score); const top=ranked[0]; if(!top) return null; const second=ranked[1], margin=second?(top.match.similarity-second.match.similarity):.30; if(second&&margin<.006&&top.match.similarity<.83) return null; const c=compactGlobalProductRecord(top.product); c.visualMemoryMatchV2862={active:true,similarity:Number(top.match.similarity.toFixed(3)),distance:Number(top.match.distance.toFixed(3)),margin:Number(margin.toFixed(3)),sampleCount:top.sampleCount,source:top.match.source,threshold:Number(top.threshold.toFixed(3)),anchorCompat:!!top.match.anchorCompat,engine:'visual_truth_deep_memory_v2862',policy:'match gratuito prima di OpenAI'}; c.matchReason='deep_visual_memory_v2862'; c.teacherBypassEligible=true; c.reliability=c.reliability||'media'; try{ updateGlobalLearningAudit({type:'v2862-visual-memory-match',productName:c.productName,brand:c.brand,similarity:c.visualMemoryMatchV2862.similarity,confirmations:top.confirmations,sampleCount:top.sampleCount}); }catch(_){} return {score:top.score,product:c}; }catch(e){ try{ updateGlobalLearningAudit({type:'v2862-visual-match-error',reason:String(e?.message||e).slice(0,180)}); }catch(_){} return null; } }
  try{ if(typeof upsertGlobalProductMemory==='function'&&!global.__v2862UpsertWrapped){ const prev=upsertGlobalProductMemory; upsertGlobalProductMemory=function(confirmed={}){ const out=prev.call(this,confirmed); try{ ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; const key=out?.key||(confirmed.barcode?`ean:${confirmed.barcode}`:''); const rec=(key&&g.products?.[key])||Object.values(g.products||{}).find(r=>normalizeVisionText(r.productName||'')===normalizeVisionText(out?.productName||confirmed.productName||'')&&normalizeVisionText(r.brand||'')===normalizeVisionText(out?.brand||confirmed.brand||'')); const f=compact(confirmed.visualFeatures||confirmed.productMemory?.visualFeatures||{}); if(rec&&f){ rec.objectFolder=rec.objectFolder||{photos:[],visualSignatures:[],visualFeatureSamples:[]}; rec.objectFolder.visualFeatureSamples=Array.isArray(rec.objectFolder.visualFeatureSamples)?rec.objectFolder.visualFeatureSamples:[]; const dup=rec.objectFolder.visualFeatureSamples.some(s=>distance(f,s.features||s)<.022); if(!dup) rec.objectFolder.visualFeatureSamples.unshift({features:f,at:Date.now(),source:'user_confirmed_visual_truth_v2862',productName:confirmed.productName||rec.productName||'',brand:confirmed.brand||rec.brand||''}); rec.objectFolder.visualFeatureSamples=rec.objectFolder.visualFeatureSamples.slice(0,72); rec.visualFeatures=f; rec.visualTruthV2862={active:true,samples:rec.objectFolder.visualFeatureSamples.length,updatedAt:Date.now(),engine:'deep_visual_plus_anchors',cost:'zero_openai_tokens'}; rec.learningQuality=Object.assign({},rec.learningQuality||{},{visualTruthRecognition:true,visualSamples:rec.objectFolder.visualFeatureSamples.length,enoughForLocalRecognition:true}); updateGlobalLearningAudit({type:'v2862-visual-truth-fingerprint-saved',productName:rec.productName,brand:rec.brand,samples:rec.objectFolder.visualFeatureSamples.length}); } }catch(e){ try{ updateGlobalLearningAudit({type:'v2862-visual-save-error',reason:String(e?.message||e).slice(0,180)}); }catch(_){} } return out; }; global.__v2862UpsertWrapped=true; } }catch(_){ }
  try{ if(typeof matchGlobalProductMemory==='function'&&!global.__v2862MatchWrapped){ const prev=matchGlobalProductMemory; matchGlobalProductMemory=function(query={}){ if(query?.visualOnly||/v2862|visual_truth/i.test(String(query?.matchMode||''))){ const hit=visualMatch(query||{}); if(hit) return hit; } const base=prev.call(this,query); if(base?.product) return base; return visualMatch(query||{})||null; }; global.__v2862MatchWrapped=true; } }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2862PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.62'; s.brain=Object.assign({},s.brain||{},{version:'V28.62',visualTruthGuard:'active',freeVisualMemory:'adaptive',waterBlock:'dark_liquid_bottle_cannot_be_water',openAiTokens:'zero for memory match'}); return s; }; global.__v2862PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.62 PRO Visual Truth Memory active');
})();

// =============================================================
// V28.63 PRO True Product Vision Server Gate
// La memoria visiva è utile solo se non contraddice la foto attuale.
// Input nuovo: visualEvidenceV2863 / visualAnchorsV2863 / OCR gratuito client.
// =============================================================
(function(){
  const V='V28.63';
  function nrm(v=''){ try{ return typeof normalizeVisionText==='function'?normalizeVisionText(v):String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }catch(_){ return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); } }
  function familyFromText(v=''){
    const t=nrm(v);
    if(!t) return '';
    if(/\b(candeggina|detersivo|ammorbidente|sgrassatore|detergente|lavatrice|bucato|piatti|lavastoviglie|shampoo|sapone|dexal)\b/.test(t)) return 'home';
    if(/\b(acqua|water|minerale|naturale|frizzante|oligominerale|sant\s*anna|santanna|san\s*benedetto|levissima|vera|lete|ferrarelle|uliveto|rocchetta|fonte)\b/.test(t)) return 'water';
    if(/\b(cola|coca|coca\s*cola|pepsi|blues\s*cola|fanta|sprite|aranciata|gassata|soft\s*drink|lemon\s*taste)\b/.test(t)) return 'cola';
    if(/\b(the|te|tea|th[eè]|ice\s*tea|fusion|estathe|pesca|limone)\b/.test(t)) return 'tea';
    if(/\b(succo|nectar|ace|arancia|pera|mela|ananas)\b/.test(t)) return 'juice';
    if(/\b(latte|uht|parzialmente|scremato|intero|yogurt|kefir)\b/.test(t)) return 'milk';
    if(/\b(pesto|salsa|sugo|condimento|pistacchio|pistacchi|vasetto|barattolo)\b/.test(t)) return 'sauce';
    if(/\b(pasta|spaghetti|penne|fusilli|riso|farina)\b/.test(t)) return 'dry_food';
    return '';
  }
  function categoryFamily(cat=''){
    const t=nrm(cat);
    if(/water|acqua/.test(t)) return 'water';
    if(/soft|cola|gass|drink|beverage|bibit/.test(t)) return 'cola';
    if(/juice|succo/.test(t)) return 'juice';
    if(/tea|the|te/.test(t)) return 'tea';
    if(/milk|latte|dairy/.test(t)) return 'milk';
    if(/laundry|clean|house|home|bucato|pulizia/.test(t)) return 'home';
    if(/sauce|condiment|pesto|sugo/.test(t)) return 'sauce';
    return '';
  }
  function candidateFamily(p={}){ return familyFromText([p.productName,p.brand,p.variant,p.productType,p.packageType,p.categoryFamily,(p.aliases||[]).join(' '),(p.brands||[]).join(' ')].filter(Boolean).join(' ')) || categoryFamily(p.category||''); }
  function queryFamily(q={}){
    const ev=q.currentVisualEvidenceV2863||q.visualEvidenceV2863||q.visualFeatures?.visualEvidenceV2863||q.productMemory?.visualEvidenceV2863||{};
    const a=q.visualFeatures?.visualAnchorsV2863||q.visualFeatures?.visualAnchorsV2862||q.visualAnchorsV2863||q.productMemory?.visualAnchorsV2863||{};
    const text=[ev.text,(ev.tokens||[]).join(' '),q.productName,q.brand,q.category,(Array.isArray(q.detectedText)?q.detectedText.join(' '):q.detectedText||''),(Array.isArray(q.visibleEvidence)?q.visibleEvidence.join(' '):q.visibleEvidence||'')].join(' ');
    let fam=familyFromText(text);
    if(!fam && (a.waterLike||a.clearWaterLike) && !(a.colaLike||a.darkBeverageLike)) fam='water';
    if(!fam && (a.colaLike||a.darkBeverageLike) && !(a.waterLike||a.clearWaterLike)) fam='cola';
    return fam;
  }
  function conflictFamilies(a='',b=''){
    if(!a||!b||a===b) return false;
    const drinks=['water','cola','tea','juice','milk'];
    if(drinks.includes(a)&&drinks.includes(b)) return true;
    if(a==='home'||b==='home') return true;
    if((a==='sauce'&&drinks.includes(b))||(b==='sauce'&&drinks.includes(a))) return true;
    return false;
  }
  function visualHardConflict(q={},p={}){
    const qf=queryFamily(q), pf=candidateFamily(p);
    if(conflictFamilies(qf,pf)) return {conflict:true,queryFamily:qf,candidateFamily:pf,reason:'family_conflict'};
    const a=q.visualFeatures?.visualAnchorsV2863||q.visualFeatures?.visualAnchorsV2862||q.visualAnchorsV2863||{};
    const candText=nrm([p.productName,p.brand,p.category,(p.aliases||[]).join(' ')].join(' '));
    const candCola=/\b(cola|coca|pepsi|fanta|sprite|gassata|soft\s*drink|blues)\b/.test(candText)||pf==='cola';
    const candWater=/\b(acqua|water|sant\s*anna|santanna|minerale|naturale|frizzante)\b/.test(candText)||pf==='water';
    if((a.waterLike||a.clearWaterLike) && candCola && !(a.colaLike||a.darkBeverageLike)) return {conflict:true,queryFamily:qf||'water_visual',candidateFamily:pf||'cola',reason:'water_anchors_vs_cola_candidate'};
    if((a.colaLike||a.darkBeverageLike) && candWater && !(a.waterLike||a.clearWaterLike)) return {conflict:true,queryFamily:qf||'cola_visual',candidateFamily:pf||'water',reason:'cola_anchors_vs_water_candidate'};
    return {conflict:false,queryFamily:qf,candidateFamily:pf,reason:''};
  }
  function hitSimilarity(product={}){ const vm=product.visualMemoryMatchV2863||product.visualMemoryMatchV2862||product.visualMemoryMatchV2861||product.visualMemoryMatchV2860||{}; return Number(vm.similarity||0); }
  try{
    if(typeof matchGlobalProductMemory==='function' && !global.__v2863MatchWrapped){
      const prev=matchGlobalProductMemory;
      matchGlobalProductMemory=function(query={}){
        const hit=prev.call(this,query||{});
        if(!hit?.product) return hit;
        try{
          const gate=visualHardConflict(query||{},hit.product||{});
          if(gate.conflict){
            try{ updateGlobalLearningAudit({type:'v2863-memory-blocked-current-photo-conflict', candidate:hit.product.productName||'', brand:hit.product.brand||'', queryFamily:gate.queryFamily, candidateFamily:gate.candidateFamily, reason:gate.reason, similarity:hitSimilarity(hit.product)}); }catch(_){ }
            return null;
          }
          // Se la richiesta è visualOnly e non esiste nessuna prova testuale/famiglia attuale,
          // un match basso non deve precompilare un prodotto diverso solo perché la bottiglia è simile.
          const visualOnly=!!query.visualOnly || /visual/i.test(String(query.matchMode||''));
          const qf=gate.queryFamily, pf=gate.candidateFamily, sim=hitSimilarity(hit.product);
          if(visualOnly && sim && sim<.86 && (!qf || !pf || qf!==pf)){
            try{ updateGlobalLearningAudit({type:'v2863-memory-blocked-low-visual-no-current-agreement', candidate:hit.product.productName||'', brand:hit.product.brand||'', queryFamily:qf, candidateFamily:pf, similarity:sim}); }catch(_){ }
            return null;
          }
          if(hit.product){ hit.product.visualMemoryMatchV2863=Object.assign({}, hit.product.visualMemoryMatchV2863||hit.product.visualMemoryMatchV2862||{}, {currentPhotoGate:'passed', queryFamily:qf||'', candidateFamily:pf||'', engine:'true_product_visual_ocr_v2863', policy:'foto attuale/OCR gratuito battono memoria in conflitto'}); hit.product.matchReason=hit.product.matchReason||'true_product_visual_ocr_v2863'; }
        }catch(_){ }
        return hit;
      };
      global.__v2863MatchWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2863UpsertWrapped){
      const prev=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        const out=prev.call(this,confirmed);
        try{
          ensureDbShape();
          const g=db.assistantBrain.globalProductMemory||{products:{}};
          const key=out?.key||(confirmed.barcode?`ean:${confirmed.barcode}`:'');
          const rec=(key&&g.products?.[key])||Object.values(g.products||{}).find(r=>nrm(r.productName||'')===nrm(out?.productName||confirmed.productName||'')&&nrm(r.brand||'')===nrm(out?.brand||confirmed.brand||''));
          if(rec){
            const ev=confirmed.visualFeatures?.visualEvidenceV2863||confirmed.productMemory?.visualEvidenceV2863||null;
            const an=confirmed.visualFeatures?.visualAnchorsV2863||confirmed.productMemory?.visualAnchorsV2863||null;
            rec.trueProductVisionV2863={active:true, currentPhotoAuthority:true, freeOcrEvidence:!!ev?.text, family:ev?.family||candidateFamily(rec)||'', updatedAt:Date.now(), policy:'owner/user-confirmed identity + current-photo visual evidence'};
            if(ev){ rec.objectFolder=rec.objectFolder||{}; rec.objectFolder.visualEvidenceSamplesV2863=Array.isArray(rec.objectFolder.visualEvidenceSamplesV2863)?rec.objectFolder.visualEvidenceSamplesV2863:[]; rec.objectFolder.visualEvidenceSamplesV2863.unshift({text:String(ev.text||'').slice(0,300),family:ev.family||'',tokens:(ev.tokens||[]).slice(0,25),at:Date.now(),source:'user_confirmed_free_ocr_v2863'}); rec.objectFolder.visualEvidenceSamplesV2863=rec.objectFolder.visualEvidenceSamplesV2863.slice(0,24); }
            if(an){ rec.objectFolder=rec.objectFolder||{}; rec.objectFolder.visualAnchorSamplesV2863=Array.isArray(rec.objectFolder.visualAnchorSamplesV2863)?rec.objectFolder.visualAnchorSamplesV2863:[]; rec.objectFolder.visualAnchorSamplesV2863.unshift({anchors:an,at:Date.now(),source:'user_confirmed_anchors_v2863'}); rec.objectFolder.visualAnchorSamplesV2863=rec.objectFolder.visualAnchorSamplesV2863.slice(0,32); }
            try{ updateGlobalLearningAudit({type:'v2863-true-product-evidence-saved', productName:rec.productName, brand:rec.brand, family:rec.trueProductVisionV2863.family, freeOcr:!!ev?.text}); }catch(_){ }
          }
        }catch(e){ try{ updateGlobalLearningAudit({type:'v2863-save-evidence-error', reason:String(e?.message||e).slice(0,180)}); }catch(_){} }
        return out;
      };
      global.__v2863UpsertWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2863PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.63'; s.brain=Object.assign({},s.brain||{},{version:'V28.63', trueProductVision:'active', freeBrowserOcr:'client-side optional', memoryConflictShield:'current photo/ocr family blocks wrong memory', openAiTokens:'zero for visual memory gate'}); return s; }; global.__v2863PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.63 PRO True Product Vision Server Gate active');
})();


// =============================================================
// V28.64 PRO Human-Like Pixel OCR Reasoning Engine
// Motore gratuito/server-first: pixel -> OCR -> identità -> campi.
// OpenAI resta docente finale, NON motore principale.
// =============================================================
const V2864_VERSION = 'V28.64';
let __sharpV2864Promise = null;
function v2864EnvTrue(name){ return /^(1|true|yes|on)$/i.test(String(process.env[name]||'')); }
function v2864Norm(v=''){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/['’`]/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
}
function v2864Words(v=''){ return [...new Set(v2864Norm(v).split(/\s+/).filter(x=>x.length>=2).slice(0,80))]; }
function v2864DataUrlBuffer(dataUrl=''){
  const m=String(dataUrl||'').match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if(!m) return null;
  try{ return Buffer.from(m[1],'base64'); }catch(_){ return null; }
}
async function v2864Sharp(){
  if(!__sharpV2864Promise){
    __sharpV2864Promise = import('sharp').then(m=>m.default||m).catch(err=>null);
  }
  return __sharpV2864Promise;
}
function v2864Lum(r,g,b){ return .2126*r+.7152*g+.0722*b; }
function v2864Sat(r,g,b){ const max=Math.max(r,g,b), min=Math.min(r,g,b); return max?((max-min)/max):0; }
function v2864ColorName(r,g,b){
  const max=Math.max(r,g,b), min=Math.min(r,g,b), lum=v2864Lum(r,g,b), sat=v2864Sat(r,g,b);
  if(lum<52) return 'nero/scuro';
  if(lum>210 && sat<.18) return 'bianco/chiaro';
  if(sat<.16) return lum>142?'trasparente/chiaro':'grigio';
  if(r>g*1.25 && r>b*1.18) return r>190&&g>105?'arancio/rosso':'rosso';
  if(g>r*1.12 && g>b*.86) return 'verde';
  if(b>r*.92 && b>g*.86) return 'blu/azzurro';
  if(r>150&&g>130&&b<90) return 'giallo';
  if(r>120&&b>120&&g<115) return 'viola';
  return 'misto';
}
function v2864AvgRegion(data,w,h,box){
  const x0=Math.max(0,Math.floor(box.x||0)), y0=Math.max(0,Math.floor(box.y||0));
  const x1=Math.min(w,Math.ceil((box.x||0)+(box.w||w))), y1=Math.min(h,Math.ceil((box.y||0)+(box.h||h)));
  const buckets={}, rgb={r:0,g:0,b:0,n:0}; let dark=0, clear=0, white=0, saturated=0, edge=0;
  for(let y=y0;y<y1;y+=1){
    for(let x=x0;x<x1;x+=1){
      const i=(y*w+x)*4, r=data[i], g=data[i+1], b=data[i+2];
      const lum=v2864Lum(r,g,b), sat=v2864Sat(r,g,b);
      const name=v2864ColorName(r,g,b); buckets[name]=(buckets[name]||0)+1;
      rgb.r+=r; rgb.g+=g; rgb.b+=b; rgb.n++;
      if(lum<75) dark++; if(lum>142 && sat<.20) clear++; if(lum>195 && sat<.22) white++; if(sat>.32) saturated++;
      if(x+1<x1){ const j=(y*w+x+1)*4; edge+=Math.abs(lum-v2864Lum(data[j],data[j+1],data[j+2])); }
      if(y+1<y1){ const k=((y+1)*w+x)*4; edge+=Math.abs(lum-v2864Lum(data[k],data[k+1],data[k+2])); }
    }
  }
  const n=Math.max(1,rgb.n), top=Object.entries(buckets).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,count])=>({name,ratio:Number((count/n).toFixed(3))}));
  return {avg:{r:Math.round(rgb.r/n),g:Math.round(rgb.g/n),b:Math.round(rgb.b/n)}, topColors:top, dark:Number((dark/n).toFixed(3)), clear:Number((clear/n).toFixed(3)), white:Number((white/n).toFixed(3)), saturated:Number((saturated/n).toFixed(3)), edge:Number((edge/(n*2)).toFixed(2)), pixels:n};
}
function v2864ObjectBox(data,w,h){
  const sampleBoxes=[{x:0,y:0,w:w*.12,h:h*.12},{x:w*.88,y:0,w:w*.12,h:h*.12},{x:0,y:h*.88,w:w*.12,h:h*.12},{x:w*.88,y:h*.88,w:w*.12,h:h*.12}];
  const bg=sampleBoxes.map(b=>v2864AvgRegion(data,w,h,b).avg).reduce((a,c)=>({r:a.r+c.r,g:a.g+c.g,b:a.b+c.b}),{r:0,g:0,b:0}); bg.r/=4; bg.g/=4; bg.b/=4;
  let minX=w,minY=h,maxX=0,maxY=0,count=0,centerCount=0;
  for(let y=0;y<h;y+=2){ for(let x=0;x<w;x+=2){
    const i=(y*w+x)*4, r=data[i],g=data[i+1],b=data[i+2];
    const d=Math.abs(r-bg.r)+Math.abs(g-bg.g)+Math.abs(b-bg.b); const sat=v2864Sat(r,g,b); const lum=v2864Lum(r,g,b);
    const central=(x>w*.18&&x<w*.82&&y>h*.05&&y<h*.95);
    if((central && (d>42 || sat>.25 || lum<70)) || (x>w*.28&&x<w*.72&&y>h*.08&&y<h*.94&&d>28)){
      minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); count++; if(central) centerCount++;
    }
  }}
  const coverage=count/Math.max(1,(w*h/4));
  if(!count || coverage<.035){ return {x:Math.round(w*.18),y:Math.round(h*.08),w:Math.round(w*.64),h:Math.round(h*.84),coverage:Number(coverage.toFixed(3)),fallback:true}; }
  const padX=w*.04, padY=h*.04;
  minX=Math.max(0,minX-padX); minY=Math.max(0,minY-padY); maxX=Math.min(w,maxX+padX); maxY=Math.min(h,maxY+padY);
  return {x:Math.round(minX),y:Math.round(minY),w:Math.round(Math.max(8,maxX-minX)),h:Math.round(Math.max(8,maxY-minY)),coverage:Number(coverage.toFixed(3)),fallback:false,centerCount};
}
async function v2864PixelProfile(dataUrl=''){
  const sharp=await v2864Sharp(); const buf=v2864DataUrlBuffer(dataUrl);
  if(!sharp || !buf) return {available:false, reason:!sharp?'sharp_not_available':'invalid_image'};
  const img=sharp(buf,{failOn:'none'}).rotate();
  const meta=await img.metadata().catch(()=>({}));
  const maxW=320, maxH=420;
  const raw=await img.resize({width:maxW,height:maxH,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const d=raw.data, w=raw.info.width, h=raw.info.height;
  const box=v2864ObjectBox(d,w,h);
  const obj=v2864AvgRegion(d,w,h,box);
  const label={x:box.x+box.w*.10,y:box.y+box.h*.34,w:box.w*.80,h:box.h*.28};
  const upper={x:box.x+box.w*.15,y:box.y,w:box.w*.70,h:box.h*.26};
  const lower={x:box.x+box.w*.15,y:box.y+box.h*.62,w:box.w*.70,h:box.h*.32};
  const center={x:box.x+box.w*.25,y:box.y+box.h*.08,w:box.w*.50,h:box.h*.84};
  const labelStats=v2864AvgRegion(d,w,h,label), upperStats=v2864AvgRegion(d,w,h,upper), lowerStats=v2864AvgRegion(d,w,h,lower), centerStats=v2864AvgRegion(d,w,h,center);
  const aspect=box.h/Math.max(1,box.w);
  const darkLiquid = aspect>1.35 && lowerStats.dark>.28 && centerStats.dark>.16;
  const clearLiquid = aspect>1.25 && centerStats.clear>.34 && lowerStats.dark<.22 && obj.saturated<.28;
  const coloredLabel = labelStats.saturated>.16 || labelStats.edge>15;
  const transparentContainer = obj.clear>.20 || centerStats.clear>.25 || upperStats.clear>.25;
  const bottleLike = aspect>1.35 && box.h>h*.45 && box.w<w*.62;
  const rectangularPack = aspect<1.35 && box.w>w*.32 && box.h>h*.22;
  const homeContainer = /verde|blu\/azzurro|bianco\/chiaro/.test((obj.topColors||[]).map(c=>c.name).join(' ')) && aspect>1.15 && !darkLiquid && coloredLabel;
  const visualFamily = darkLiquid ? 'dark_liquid_bottle' : (clearLiquid ? 'clear_liquid_bottle' : (homeContainer ? 'home_container' : (rectangularPack?'pack_box':'unknown')));
  return {available:true, engine:'sharp_pixel_profile_v2864', meta:{width:meta.width||0,height:meta.height||0,format:meta.format||''}, resized:{w,h}, objectBox:box, objectAspect:Number(aspect.toFixed(3)), object:obj, label:labelStats, upper:upperStats, lower:lowerStats, center:centerStats, anchors:{bottleLike,darkLiquid,clearLiquid,transparentContainer,coloredLabel,rectangularPack,homeContainer,longProduct:bottleLike||aspect>1.7, visibleContent:darkLiquid||clearLiquid, liquidLikely:darkLiquid||clearLiquid, solidLikely:rectangularPack&&!transparentContainer, visualFamily}, colors:[...(obj.topColors||[]).map(c=>c.name),...(labelStats.topColors||[]).map(c=>c.name)].filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,8)};
}
function v2864ExtractSize(text=''){
  const raw=String(text||'');
  let m=raw.match(/\b(\d{1,2}(?:[,.]\d{1,2})?)\s*(l|lt|litri|litro)\b/i);
  if(m) return `${m[1].replace('.',',')} L`.replace(',0 L',' L');
  m=raw.match(/\b(\d{2,4})\s*(ml|cl|g|gr|kg)\b/i);
  if(m) return `${m[1]} ${m[2].toLowerCase()==='gr'?'g':m[2].toLowerCase()}`;
  return '';
}
function v2864CategoryFromText(text='', pixel=null){
  const t=v2864Norm(text);
  const rules=[
    ['laundry',/\b(candeggina|detersivo|ammorbidente|bucato|lavatrice|colori\s+sicuri|igienizzante\s+bucato)\b/],
    ['cleaning',/\b(sgrassatore|detergente|pavimenti|bagno|wc|disinfettante|pulizia|multiuso|spray\s+pulitore)\b/],
    ['dishwashing',/\b(lavastoviglie|piatti|brillantante|tabs|pastiglie\s+lavastoviglie)\b/],
    ['personal_care',/\b(shampoo|bagnoschiuma|sapone|deodorante|crema|dentifricio|collutorio)\b/],
    ['water',/\b(acqua|naturale|minerale|frizzante|oligominerale|sant\s*anna|santanna|san\s*benedetto|levissima|vera|lete|ferrarelle|uliveto|rocchetta)\b/],
    ['soft_drinks',/\b(cola|coca\s*cola|coca-cola|pepsi|fanta|sprite|aranciata|gassosa|chinotto|lemon\s*taste|bibita\s+gassata)\b/],
    ['juice',/\b(succo|nettare|spremuta|ace|bevanda\s+alla\s+frutta|t[eè]\s*freddo|the\s*freddo|ice\s*tea|estathe|th[eè])\b/],
    ['milk_drinks',/\b(latte\s+uht|latte\s+(intero|scremato|parzialmente)|bevanda\s+vegetale|senza\s+lattosio)\b/],
    ['yogurt',/\b(yogurt|kefir|skyr)\b/],
    ['sauces_condiments',/\b(pesto|salsa|sugo|condimento|bbq|barbecue|ketchup|maionese|senape|passata)\b/],
    ['pasta_rice',/\b(pasta|spaghetti|penne|fusilli|riso|farina)\b/],
    ['pet_food',/\b(crocchette|umido\s+(cane|gatto)|mangime\s+(cane|gatto))\b/],
    ['aquarium',/\b(acquario|mangime\s+pesci|biocondizionatore|filtro\s+acquario)\b/]
  ];
  for(const [cat,rx] of rules) if(rx.test(t)) return cat;
  if(pixel?.anchors?.darkLiquid) return 'drinks';
  if(pixel?.anchors?.clearLiquid) return 'water';
  if(pixel?.anchors?.homeContainer) return 'house';
  return 'food';
}
function v2864BrandFromText(text=''){
  const raw=String(text||''); const t=v2864Norm(raw);
  const brands=[
    ["Sant'Anna",/\b(sant\s*anna|santanna)\b/],['San Benedetto',/\bsan\s*benedetto\b/],['Levissima',/\blevissima\b/],['Vera',/\bvera\b/],['Ferrarelle',/\bferrarelle\b/],['Rocchetta',/\brocchetta\b/],['Uliveto',/\buliveto\b/],['Lete',/\blete\b/],
    ['Blues',/\bblues\b/],['Coca-Cola',/\bcoca\s*cola|coca-cola\b/],['Pepsi',/\bpepsi\b/],['Fanta',/\bfanta\b/],['Sprite',/\bsprite\b/],
    ['Dexal',/\bdexal\b/],['Chanteclair',/\bchanteclair\b/],['Ace',/\bace\b/],['Dash',/\bdash\b/],['Finish',/\bfinish\b/],['Svelto',/\bsvelto\b/],
    ['Selex',/\bselex\b/],['Barilla',/\bbarilla\b/],['Divella',/\bdivella\b/],['Garofalo',/\bgarofalo\b/],['Rummo',/\brummo\b/],['Saper di Sapori',/\bsaper\s+di\s+sapori\b/]
  ];
  for(const [name,rx] of brands) if(rx.test(t)) return name;
  const lines=raw.split(/[\n\r|]+/).map(x=>x.trim()).filter(Boolean);
  const good=lines.find(l=>/^[A-ZÀ-Ü][A-Za-zÀ-ÿ'’\s&.-]{2,22}$/.test(l) && !/ingredient|valori|scaden|lotto|netto|litri|naturale|minerale/i.test(l));
  return good ? good.replace(/\s+/g,' ').slice(0,28) : '';
}
function v2864ProductTypeFromText(text='', cat='food', brand=''){
  const t=v2864Norm(text);
  if(cat==='laundry' && /candeggina/.test(t)) return /delicata/.test(t)?'candeggina delicata':'candeggina';
  if(cat==='laundry' && /detersivo/.test(t)) return 'detersivo bucato';
  if(cat==='cleaning') return 'prodotto pulizia';
  if(cat==='water') return /frizzante/.test(t)?'acqua frizzante':/naturale/.test(t)?'acqua naturale':'acqua';
  if(cat==='soft_drinks') return /cola/.test(t)?'bibita cola':'bibita gassata';
  if(cat==='juice') return /t[eè]|the|tea|th[eè]/.test(t)?'tè freddo':'succo/bevanda frutta';
  if(cat==='milk_drinks') return 'latte/bevanda latte';
  if(cat==='sauces_condiments') return /pesto/.test(t)?'pesto':'salsa/condimento';
  return '';
}
function v2864LikelyNameFromText(text='', cat='food', brand='', type=''){
  const t=v2864Norm(text);
  if(brand==="Sant'Anna" || /\bsant\s*anna|santanna\b/.test(t)) return "Acqua Sant'Anna";
  if(brand==='Blues' && /\bcola\b/.test(t)) return 'Cola Blues';
  if(brand==='Dexal' && /candeggina/.test(t)) return /maxi/.test(t)?'Dexal Candeggina Delicata Maxi':'Dexal Candeggina Delicata';
  if(brand==='Coca-Cola') return 'Coca-Cola';
  if(cat==='water') return brand ? `Acqua ${brand}` : 'Acqua in bottiglia';
  if(cat==='soft_drinks') return brand ? `${type||'Bibita'} ${brand}`.trim() : (type||'Bibita gassata');
  if(cat==='laundry'||cat==='cleaning'||cat==='dishwashing') return [brand,type||'Prodotto casa'].filter(Boolean).join(' ').trim();
  const lines=String(text||'').split(/[\n\r|]+/).map(x=>x.trim()).filter(x=>x.length>=3 && x.length<=42);
  const bad=/\b(ingredienti|valori|energia|grassi|carboidrati|zuccheri|proteine|sale|lotto|scad|exp|tmc|conservare|prodotto\s+da|distribuito|servizio|nutrizionali|barcode|ean)\b/i;
  const size=/\b\d+[,.]?\d*\s*(ml|cl|l|lt|g|kg|%)\b/i;
  const candidate=lines.find(l=>!bad.test(l) && !size.test(l) && /[a-zA-ZÀ-ÿ]{3}/.test(l));
  if(candidate){
    const clean=candidate.replace(/[^A-Za-zÀ-ÿ0-9'’&.\-\s]/g,' ').replace(/\s+/g,' ').trim();
    if(clean && (!brand || !v2864Norm(clean).includes(v2864Norm(brand)))) return brand ? `${clean} ${brand}`.trim().slice(0,48) : clean.slice(0,48);
    return clean.slice(0,48);
  }
  return [brand,type].filter(Boolean).join(' ').trim();
}
function v2864FieldsFromText(text='', pixel=null){
  const brand=v2864BrandFromText(text); const cat=v2864CategoryFromText(text,pixel); const type=v2864ProductTypeFromText(text,cat,brand); const name=v2864LikelyNameFromText(text,cat,brand,type); const size=v2864ExtractSize(text);
  const t=v2864Norm(text); const ocrStrong=!!(name && (brand || /\b(acqua|cola|candeggina|detersivo|pesto|latte|succo|the|tea|santanna|sant\s*anna)\b/.test(t)));
  const conf=ocrStrong ? (brand?.length? .88 : .78) : (pixel?.anchors?.darkLiquid||pixel?.anchors?.clearLiquid ? .48 : .32);
  const isLiquid=['water','soft_drinks','juice','milk_drinks','drinks'].includes(cat);
  const unit=isLiquid?'bt':(['laundry','cleaning','dishwashing','house'].includes(cat)?'conf':'pz');
  return {productName:name,brand,productType:type,category:cat,estimatedSize:size||'',unit,isLiquid,confidence:conf,ocrStrong};
}
async function v2864OcrSpace(dataUrl=''){
  const key=String(process.env.OCR_SPACE_API_KEY||'').trim();
  if(!key || !(v2864EnvTrue('OCR_SPACE_ENABLED')||v2864EnvTrue('OCR_EXTERNAL_ENABLED'))) return null;
  const params=new URLSearchParams();
  params.set('apikey', key); params.set('base64Image', String(dataUrl||'')); params.set('language', process.env.OCR_SPACE_LANGUAGE||'ita'); params.set('isOverlayRequired','true'); params.set('OCREngine', process.env.OCR_SPACE_ENGINE||'2'); params.set('scale','true'); params.set('detectOrientation','true');
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(), Number(process.env.OCR_SPACE_TIMEOUT_MS||6500));
  try{
    const r=await fetch('https://api.ocr.space/parse/image',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params,signal:ctrl.signal});
    const j=await r.json().catch(()=>null); if(!r.ok || !j) return {provider:'ocr_space',ok:false,error:`http_${r.status}`};
    const txt=(j.ParsedResults||[]).map(x=>x.ParsedText||'').filter(Boolean).join('\n').trim();
    const lines=(j.ParsedResults||[]).flatMap(p=>(p.TextOverlay?.Lines||[]).map(l=>l.LineText||'')).filter(Boolean);
    return {provider:'ocr_space',ok:!!txt,text:txt,lines,rawExitCode:j.OCRExitCode||0,error:Array.isArray(j.ErrorMessage)?j.ErrorMessage.join('; '):(j.ErrorMessage||'')};
  }catch(e){ return {provider:'ocr_space',ok:false,error:String(e?.message||e).slice(0,120)}; } finally{ clearTimeout(timer); }
}
async function v2864GoogleVisionOcr(dataUrl=''){
  const key=String(process.env.GOOGLE_VISION_API_KEY||'').trim();
  if(!key || !(v2864EnvTrue('GOOGLE_VISION_OCR_ENABLED')||v2864EnvTrue('VISION_PAID_APIS_ENABLED'))) return null;
  const base64=String(dataUrl||'').replace(/^data:image\/[a-z0-9.+-]+;base64,/i,'');
  const body={requests:[{image:{content:base64},features:[{type:'TEXT_DETECTION',maxResults:1}],imageContext:{languageHints:['it','en']}}]};
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(), Number(process.env.GOOGLE_VISION_TIMEOUT_MS||5500));
  try{
    const r=await fetch('https://vision.googleapis.com/v1/images:annotate?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal});
    const j=await r.json().catch(()=>null); if(!r.ok || !j) return {provider:'google_vision_ocr',ok:false,error:`http_${r.status}`};
    const text=j.responses?.[0]?.fullTextAnnotation?.text || j.responses?.[0]?.textAnnotations?.[0]?.description || '';
    return {provider:'google_vision_ocr',ok:!!text,text,lines:String(text||'').split(/[\n\r]+/).filter(Boolean)};
  }catch(e){ return {provider:'google_vision_ocr',ok:false,error:String(e?.message||e).slice(0,120)}; } finally{ clearTimeout(timer); }
}
async function v2864ExternalOcr(dataUrl=''){
  const providers=[]; let best='';
  const space=await v2864OcrSpace(dataUrl).catch(e=>({provider:'ocr_space',ok:false,error:String(e?.message||e)})); if(space){ providers.push(space); if(space.ok && space.text.length>best.length) best=space.text; }
  const google=await v2864GoogleVisionOcr(dataUrl).catch(e=>({provider:'google_vision_ocr',ok:false,error:String(e?.message||e)})); if(google){ providers.push(google); if(google.ok && google.text.length>best.length) best=google.text; }
  return {text:best, providers:providers.map(p=>({provider:p.provider,ok:!!p.ok,chars:String(p.text||'').length,error:p.error||''}))};
}
function v2864ResultFromJudge(fields={}, pixel=null, ocrText='', stage='product'){
  const detectedText=String(ocrText||'').split(/[\n\r|]+/).map(x=>x.trim()).filter(Boolean).slice(0,14);
  const confidence=Number(fields.confidence||0);
  const result={needsRetake:false,needsManual:confidence<.92,shouldAskConfirmation:true,productName:fields.productName||'',brand:fields.brand||'',variant:'',productType:fields.productType||'',packageType:pixel?.anchors?.bottleLike?'bottiglia':(pixel?.anchors?.homeContainer?'flacone/confezione':'confezione'),estimatedSize:fields.estimatedSize||'',quantity:1,unit:fields.unit||'pz',category:fields.category||'food',confidence,isLiquid:!!fields.isLiquid,cloudVision:false,cloudOffline:false,cloudFallback:false,autonomousVision:true,localFirst:true,teacherSkipped:true,proPixelOcrV2864:{active:true,server:true,ocrStrong:!!fields.ocrStrong,cost:'zero_openai_tokens',pixelEngine:pixel?.engine||'',policy:'pixel+OCR attuale > memoria > forma/colore'},visualFeatures:{serverPixelV2864:pixel,visualEvidenceV2864:{text:ocrText,tokens:v2864Words(ocrText).slice(0,50),category:fields.category||'',brand:fields.brand||'',productName:fields.productName||''}},detectedText,visibleEvidence:[],colors:pixel?.colors||[],reason:''};
  if(fields.ocrStrong){ result.reason='Vision PRO V28.64: letto testo reale sull’etichetta e compilato i campi senza OpenAI.'; result.visibleEvidence.push('OCR etichetta reale'); }
  else if(pixel?.anchors?.darkLiquid){ result.productName=result.productName||'Bevanda scura in bottiglia da identificare'; result.category=result.category==='food'?'drinks':result.category; result.reason='Vision PRO V28.64: pixel indicano bottiglia con contenuto scuro, ma senza testo certo non invento marca/nome.'; result.needsManual=true; }
  else if(pixel?.anchors?.clearLiquid){ result.productName=result.productName||'Acqua/bevanda chiara in bottiglia da confermare'; result.category=result.category==='food'?'water':result.category; result.reason='Vision PRO V28.64: pixel indicano bottiglia chiara/liquido trasparente; serve etichetta o barcode per nome preciso.'; result.needsManual=true; }
  else if(pixel?.anchors?.homeContainer){ result.productName=result.productName||'Prodotto casa da identificare'; result.category=result.category==='food'?'house':result.category; result.reason='Vision PRO V28.64: forma/colore indicano prodotto casa, ma serve testo etichetta per nome preciso.'; result.needsManual=true; }
  else { result.reason='Vision PRO V28.64: analisi pixel gratuita completata, ma serve etichetta/barcode/docente per identità certa.'; result.needsManual=true; }
  if(result.estimatedSize) result.visibleEvidence.push('Formato letto: '+result.estimatedSize);
  if(result.brand) result.visibleEvidence.push('Marca letta: '+result.brand);
  if(result.productType) result.visibleEvidence.push('Tipo letto: '+result.productType);
  if(pixel?.anchors?.darkLiquid) result.visibleEvidence.push('Contenuto visibile: liquido scuro');
  if(pixel?.anchors?.clearLiquid) result.visibleEvidence.push('Contenuto visibile: liquido chiaro/trasparente');
  if(pixel?.anchors?.bottleLike) result.visibleEvidence.push('Forma: bottiglia/prodotto lungo');
  if(pixel?.colors?.length) result.visibleEvidence.push('Colori pixel: '+pixel.colors.slice(0,5).join(', '));
  return result;
}
async function serverPixelOcrJudgeV2864({image='',stage='auto',localGuess=null,clientPixel=null,clientOcr=null,household=null}={}){
  const pixel=await v2864PixelProfile(image).catch(e=>({available:false,reason:String(e?.message||e).slice(0,120)}));
  let text=''; const providers=[];
  if(clientOcr?.text){ text=String(clientOcr.text||''); providers.push({provider:'client_ocr',ok:true,chars:text.length}); }
  if(localGuess?.visualFeatures?.visualEvidenceV2864?.text && String(localGuess.visualFeatures.visualEvidenceV2864.text).length>text.length){ text=String(localGuess.visualFeatures.visualEvidenceV2864.text); providers.push({provider:'local_guess_visualEvidenceV2864',ok:true,chars:text.length}); }
  if(localGuess?.visualFeatures?.visualEvidenceV2863?.text && String(localGuess.visualFeatures.visualEvidenceV2863.text).length>text.length){ text=String(localGuess.visualFeatures.visualEvidenceV2863.text); providers.push({provider:'local_guess_visualEvidenceV2863',ok:true,chars:text.length}); }
  const ext=await v2864ExternalOcr(image).catch(()=>({text:'',providers:[]}));
  providers.push(...(ext.providers||[])); if(ext.text && ext.text.length>text.length) text=ext.text;
  const fields=v2864FieldsFromText(text,pixel);
  let result=v2864ResultFromJudge(fields,pixel,text,stage);
  const strong=!!(fields.ocrStrong && result.productName && result.brand && Number(result.confidence||0)>=.78);
  const useful=strong || !!(fields.ocrStrong && result.productName && Number(result.confidence||0)>=.72);
  result.proPixelOcrV2864=Object.assign({},result.proPixelOcrV2864||{},{providers,strong,useful,stage:String(stage||'auto'),externalOcrEnabled:providers.some(p=>/ocr_space|google/.test(p.provider||'')),sharpAvailable:!!pixel?.available});
  try{ if(useful) updateGlobalLearningAudit({type:'v2864-pixel-ocr-useful',productName:result.productName,brand:result.brand,category:result.category,providers:providers.map(p=>p.provider).join(','),openai:false}); }catch(_){ }
  return {ok:true,version:V2864_VERSION,pixel,ocr:{text,providers},fields,result,strong,useful,cost:{openai:0,ocrExternalConfigured:providers.some(p=>/ocr_space|google/.test(p.provider||''))}};
}
function v2864MergePixelResult(base={}, judge=null){
  if(!judge?.result) return base||{};
  const r=Object.assign({}, base||{}); const p=judge.result; const pc=Number(p.confidence||0), bc=Number(r.confidence||0);
  const pStrong=!!judge.strong || (p.proPixelOcrV2864?.ocrStrong && pc>=.72);
  if(pStrong || pc>bc+.18 || (!r.productName && p.productName)){
    for(const k of ['productName','brand','productType','packageType','estimatedSize','unit','category','isLiquid']) if(p[k] && (!r[k] || pStrong || /^(food|drinks|house|pz|conf|bt)$/i.test(String(r[k])))) r[k]=p[k];
    r.confidence=Math.max(bc,pc); r.needsManual=pc<.92; r.shouldAskConfirmation=true;
    r.cloudVision=false; r.cloudOffline=false; r.cloudFallback=false; r.teacherSkipped=true; r.localFirst=true; r.autonomousVision=true;
    r.reason=p.reason||r.reason;
  }
  r.detectedText=[...(Array.isArray(r.detectedText)?r.detectedText:[]),...(Array.isArray(p.detectedText)?p.detectedText:[])].filter(Boolean).slice(0,24);
  r.visibleEvidence=[...(Array.isArray(r.visibleEvidence)?r.visibleEvidence:[]),...(Array.isArray(p.visibleEvidence)?p.visibleEvidence:[])].filter(Boolean).slice(0,24);
  r.visualFeatures=Object.assign({},r.visualFeatures||{},p.visualFeatures||{});
  r.proPixelOcrV2864=Object.assign({},r.proPixelOcrV2864||{},p.proPixelOcrV2864||{}, {merged:true});
  return r;
}
(function(){
  try{
    if(typeof visionAnalyze==='function' && !global.__v2864VisionAnalyzeWrapped){
      const prev=visionAnalyze;
      visionAnalyze=async function(payload={}){
        const stage=String(payload?.stage||'auto').toLowerCase();
        const judge=await serverPixelOcrJudgeV2864({image:payload.fullImage||payload.image,stage,localGuess:payload.localGuess}).catch(()=>null);
        if(judge?.useful && judge?.result && /^(auto|product|manual|live)?$/.test(stage||'auto')){
          return Object.assign({},judge.result,{serverPixelOcrJudgeV2864:judge,reason:judge.result.reason||'Vision PRO V28.64: riconosciuto da pixel+OCR server, OpenAI non usato.'});
        }
        let out=await prev.call(this,payload);
        out=v2864MergePixelResult(out,judge);
        out.serverPixelOcrJudgeV2864=judge?{version:judge.version,strong:!!judge.strong,useful:!!judge.useful,ocrChars:String(judge.ocr?.text||'').length,pixel:judge.pixel?{available:!!judge.pixel.available,anchors:judge.pixel.anchors,colors:judge.pixel.colors}:null,cost:judge.cost}:null;
        return out;
      };
      global.__v2864VisionAnalyzeWrapped=true;
    }
  }catch(e){ console.warn('[Spesa Pronta] V28.64 wrap visionAnalyze failed', e?.message||e); }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2864PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.64'; s.brain=Object.assign({},s.brain||{},{version:'V28.65',humanLikePixelOcr:'active',sharpPixelEngine:'optional dependency sharp',ocrRouter:'client OCR + OCR.space optional + Google Vision optional',openAiPolicy:'only after memory/barcode/pixel/OCR fail'}); return s; }; global.__v2864PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.64 PRO Human-Like Pixel OCR Reasoning Engine active');
})();


// =============================================================
// V28.65 PRO OCR Quality Gate + ROI Crop Visual Judge
// - OCR.space non riceve più la foto intera come prima scelta: usa crop etichetta/oggetto.
// - Non vince più il testo OCR spazzatura più lungo: vince il testo più affidabile.
// - Non compila mai nome/marca/scadenza da garbage OCR o "famiglia visiva".
// =============================================================
const V2865_VERSION = 'V28.65';
function v2865OcrQuality(text=''){
  const s=String(text||''); const compact=s.replace(/\s+/g,''); const chars=compact.length||1;
  const norm=v2864Norm(s); const tokens=norm.split(/\s+/).filter(Boolean);
  const symbolCount=(compact.match(/[<>=_~{}[\]\\|^€$§]/g)||[]).length;
  const digits=(compact.match(/\d/g)||[]).length;
  const letters=(compact.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
  const good=tokens.filter(t=>t.length>=3 && /[a-z]/.test(t));
  const singles=tokens.filter(t=>t.length===1).length;
  const knownMatches=(norm.match(/\b(blues|cola|coca|pepsi|fanta|sprite|sant\s*anna|santanna|acqua|naturale|minerale|dexal|candeggina|delicata|maxi|detersivo|lavatrice|bucato|pesto|salsa|selex|barilla|latte|yogurt|the|tea|succo)\b/g)||[]).length;
  const hasSize=/\b\d{1,2}(?:[,.]\d{1,2})?\s*(l|lt|ml|cl|g|kg)\b/i.test(s);
  const looksDate=/\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}\b/.test(s);
  let score=0;
  score += Math.min(35, good.length*5);
  score += Math.min(50, knownMatches*18);
  if(hasSize) score += 10;
  if(looksDate) score += 6;
  if(letters/chars < .42 && !knownMatches) score -= 28;
  if(symbolCount/chars > .12) score -= 40;
  if(singles > Math.max(3, tokens.length*.42) && !knownMatches) score -= 25;
  if(/(?:=\s*){2,}|(?:_\s*){2,}|[<>]{2,}|\b[bcdfghjklmnpqrstvwxyz]\s+[bcdfghjklmnpqrstvwxyz]\s+[bcdfghjklmnpqrstvwxyz]\b/i.test(s) && !knownMatches) score -= 35;
  if(digits > letters*1.8 && !looksDate && !hasSize && !knownMatches) score -= 22;
  return {score, chars, letters, symbolRatio:Number((symbolCount/chars).toFixed(3)), tokens:tokens.length, goodWords:good.length, knownHits:knownMatches, hasSize, looksDate, low:score<18};
}
function v2865HasIdentityText(text=''){
  return /\b(blues|cola|coca|pepsi|fanta|sprite|sant\s*anna|santanna|dexal|candeggina|delicata|maxi|acqua|naturale|minerale|pesto|selex|barilla)\b/i.test(String(text||''));
}
function v2865BadName(v=''){
  const n=v2864Norm(v);
  return !!n && /famiglia\s+visiva|visual\s+family|attuale\s+cola|manual\s+live|server\s+local|fallback\s+locale|autonomia\s+locale|conoscenza\s+generale\s+vision|liquido\s+bevanda/.test(n);
}
function v2865BadBrand(v=''){
  const s=String(v||'').trim(); if(!s) return false;
  const n=v2864Norm(s); if(v2865HasIdentityText(n)) return false;
  const toks=n.split(/\s+/).filter(Boolean);
  if(/[<>=_~{}[\]\\|]/.test(s)) return true;
  if(toks.length>=3 && toks.filter(t=>t.length<=2).length>=Math.ceil(toks.length*.6)) return true;
  if(/^[A-Z]\s+[A-Z]{1,3}\s+[A-Z]\s+[A-Z]$/i.test(s)) return true;
  if(/\b(sas|nall|oy|br|ea|uh)\b/i.test(s) && toks.length<=5) return true;
  return false;
}
function v2865ValidExpiry(text='', source=''){
  const s=String(text||'').trim(); if(!s) return true;
  if(/^0?1[\/\-.]0?1[\/\-.]20?00$/.test(s)) return false;
  const now=new Date().getFullYear();
  const m=s.match(/(?:^|\b)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\b|$)/);
  if(m){ const d=Number(m[1]), mo=Number(m[2]), y=Number(m[3]); if(!(d>=1&&d<=31&&mo>=1&&mo<=12)) return false; if(y<now-3 || y>now+15) return false; }
  const m2=s.match(/(?:^|\b)(\d{1,2})[\/\-.](\d{4})(?:\b|$)/);
  if(m2){ const mo=Number(m2[1]), y=Number(m2[2]); if(!(mo>=1&&mo<=12) || y<now-3 || y>now+15) return false; }
  const q=v2865OcrQuality(source||s); if(q.low && !/scad|exp|tmc|entro|best|preferibil/i.test(source||'')) return false;
  return true;
}
try{
  const __ultraNormalizeExpiryServerV97=ultraNormalizeExpiryServerV97;
  ultraNormalizeExpiryServerV97=function(raw=''){
    const e=__ultraNormalizeExpiryServerV97(raw);
    return (e && v2865ValidExpiry(e.text, raw)) ? e : null;
  };
}catch(_){ }
const __v2864BrandFromTextV2865 = v2864BrandFromText;
v2864BrandFromText=function(text=''){
  const q=v2865OcrQuality(text);
  if(q.low && !v2865HasIdentityText(text)) return '';
  const b=__v2864BrandFromTextV2865(text);
  return v2865BadBrand(b) ? '' : b;
};
const __v2864LikelyNameFromTextV2865 = v2864LikelyNameFromText;
v2864LikelyNameFromText=function(text='',cat='food',brand='',type=''){
  const q=v2865OcrQuality(text);
  if(q.low && !v2865HasIdentityText(text)) return '';
  const name=__v2864LikelyNameFromTextV2865(text,cat,brand,type);
  return v2865BadName(name) ? '' : name;
};
const __v2864FieldsFromTextV2865 = v2864FieldsFromText;
v2864FieldsFromText=function(text='',pixel=null){
  const q=v2865OcrQuality(text);
  const trusted=(!q.low || v2865HasIdentityText(text));
  let f=__v2864FieldsFromTextV2865(trusted ? text : '', pixel) || {};
  if(!trusted){
    const a=pixel?.anchors||{};
    f.productName=''; f.brand=''; f.productType=''; f.estimatedSize=''; f.ocrStrong=false; f.confidence=(a.darkLiquid||a.clearLiquid)?.43:.24;
    if(a.darkLiquid){ f.category='drinks'; f.isLiquid=true; f.unit='bt'; }
    else if(a.clearLiquid){ f.category='water'; f.isLiquid=true; f.unit='bt'; }
    else if(a.homeContainer){ f.category='house'; f.isLiquid=false; f.unit='conf'; }
  }
  if(v2865BadName(f.productName)) f.productName='';
  if(v2865BadBrand(f.brand)) f.brand='';
  if(f.expiryDate && !v2865ValidExpiry(f.expiryDate,text)) f.expiryDate='';
  f.ocrQualityV2865=q; f.ocrTrustedV2865=trusted;
  return f;
};
async function v2865BuildOcrVariants(dataUrl='', pixel=null){
  const sharp=await v2864Sharp(); const buf=v2864DataUrlBuffer(dataUrl);
  if(!sharp || !buf) return [{name:'full_original',dataUrl}];
  const base=await sharp(buf,{failOn:'none'}).rotate().resize({width:1100,height:1100,fit:'inside',withoutEnlargement:true}).jpeg({quality:78,mozjpeg:true}).toBuffer({resolveWithObject:true});
  const w=base.info.width, h=base.info.height;
  const baseBuf=base.data;
  const pr=pixel?.objectBox && pixel?.resized ? {x:pixel.objectBox.x/Math.max(1,pixel.resized.w), y:pixel.objectBox.y/Math.max(1,pixel.resized.h), w:pixel.objectBox.w/Math.max(1,pixel.resized.w), h:pixel.objectBox.h/Math.max(1,pixel.resized.h)} : {x:.16,y:.05,w:.68,h:.90};
  function clampBox(b){
    const left=Math.max(0,Math.min(w-2,Math.round(b.x*w))), top=Math.max(0,Math.min(h-2,Math.round(b.y*h)));
    const right=Math.max(left+2,Math.min(w,Math.round((b.x+b.w)*w))), bottom=Math.max(top+2,Math.min(h,Math.round((b.y+b.h)*h)));
    return {left,top,width:right-left,height:bottom-top};
  }
  async function mk(name,b,enhance=true){
    const ex=clampBox(b); let pipe=sharp(baseBuf,{failOn:'none'}).extract(ex).resize({width:900,height:520,fit:'inside',withoutEnlargement:false});
    if(enhance) pipe=pipe.grayscale().normalize().sharpen({sigma:.9}).linear(1.18,-8);
    const out=await pipe.jpeg({quality:74,mozjpeg:true}).toBuffer();
    return {name,dataUrl:'data:image/jpeg;base64,'+out.toString('base64'),bytes:out.length};
  }
  const label={x:pr.x+pr.w*.06,y:pr.y+pr.h*.30,w:pr.w*.88,h:pr.h*.38};
  const labelWide={x:Math.max(0,pr.x-pr.w*.05),y:pr.y+pr.h*.24,w:Math.min(1,pr.w*1.10),h:pr.h*.48};
  const objectCenter={x:pr.x+pr.w*.02,y:pr.y+pr.h*.05,w:pr.w*.96,h:pr.h*.88};
  const genericLabel={x:.08,y:.24,w:.84,h:.50};
  const list=[];
  for(const spec of [['label_enhanced',label,true],['label_wide',labelWide,true],['object_center',objectCenter,false],['generic_label',genericLabel,true]]){
    try{ const v=await mk(spec[0],spec[1],spec[2]); if(v.bytes<950000) list.push(v); }catch(_){ }
  }
  if(!list.length) list.push({name:'full_resized',dataUrl:'data:image/jpeg;base64,'+baseBuf.toString('base64'),bytes:baseBuf.length});
  return list;
}
const __v2864OcrSpaceV2865=v2864OcrSpace;
v2864ExternalOcr=async function(dataUrl='', pixel=null){
  const providers=[]; const candidates=[];
  const variants=await v2865BuildOcrVariants(dataUrl,pixel).catch(()=>[{name:'full_original',dataUrl}]);
  const max=Math.max(1,Math.min(4,Number(process.env.OCR_SPACE_MAX_CROPS||2)||2));
  for(const v of variants.slice(0,max)){
    const r=await __v2864OcrSpaceV2865(v.dataUrl).catch(e=>({provider:'ocr_space',ok:false,error:String(e?.message||e).slice(0,120)}));
    if(r){ const q=v2865OcrQuality(r.text||''); providers.push({provider:'ocr_space',variant:v.name,ok:!!r.ok,chars:String(r.text||'').length,score:q.score,error:r.error||'',bytes:v.bytes||0}); if(r.ok && String(r.text||'').trim()) candidates.push({text:r.text,provider:'ocr_space',variant:v.name,score:q.score,quality:q}); }
    if(candidates.some(c=>c.score>=54 && v2865HasIdentityText(c.text))) break;
  }
  const google=await v2864GoogleVisionOcr(dataUrl).catch(e=>({provider:'google_vision_ocr',ok:false,error:String(e?.message||e).slice(0,120)}));
  if(google){ const q=v2865OcrQuality(google.text||''); providers.push({provider:'google_vision_ocr',ok:!!google.ok,chars:String(google.text||'').length,score:q.score,error:google.error||''}); if(google.ok && String(google.text||'').trim()) candidates.push({text:google.text,provider:'google_vision_ocr',variant:'full',score:q.score,quality:q}); }
  const best=candidates.sort((a,b)=>b.score-a.score || String(b.text).length-String(a.text).length)[0];
  return {text:(best && (best.score>=18 || v2865HasIdentityText(best.text))) ? best.text : '', providers, best:best?{provider:best.provider,variant:best.variant,score:best.score,quality:best.quality}:null, rejected:candidates.filter(c=>c!==best).slice(0,4).map(c=>({provider:c.provider,variant:c.variant,score:c.score,chars:String(c.text||'').length}))};
};
const __serverPixelOcrJudgeV2864_V2865=serverPixelOcrJudgeV2864;
serverPixelOcrJudgeV2864=async function({image='',stage='auto',localGuess=null,clientPixel=null,clientOcr=null,household=null}={}){
  const pixel=await v2864PixelProfile(image).catch(e=>({available:false,reason:String(e?.message||e).slice(0,120)}));
  const candidates=[]; const providers=[];
  function addCandidate(text,provider,extra={}){ if(!text) return; const q=v2865OcrQuality(text); providers.push({provider,ok:true,chars:String(text||'').length,score:q.score,...extra}); candidates.push({text:String(text||''),provider,score:q.score,quality:q,...extra}); }
  if(clientOcr?.text) addCandidate(clientOcr.text,'client_ocr');
  if(localGuess?.visualFeatures?.visualEvidenceV2864?.text) addCandidate(localGuess.visualFeatures.visualEvidenceV2864.text,'local_guess_visualEvidenceV2864');
  if(localGuess?.visualFeatures?.visualEvidenceV2863?.text) addCandidate(localGuess.visualFeatures.visualEvidenceV2863.text,'local_guess_visualEvidenceV2863');
  const ext=await v2864ExternalOcr(image,pixel).catch(()=>({text:'',providers:[]}));
  providers.push(...(ext.providers||[]));
  if(ext.text) addCandidate(ext.text, ext.best?.provider||'external_ocr_best', {variant:ext.best?.variant||'', external:true});
  const best=candidates.sort((a,b)=>b.score-a.score || String(b.text).length-String(a.text).length)[0];
  const bestTrusted=!!(best && (best.score>=18 || v2865HasIdentityText(best.text)));
  const text=bestTrusted ? best.text : '';
  const fields=v2864FieldsFromText(text,pixel);
  let result=v2864ResultFromJudge(fields,pixel,text,stage);
  if(!bestTrusted){
    result.detectedText=[];
    result.visibleEvidence=(result.visibleEvidence||[]).filter(x=>!/OCR etichetta reale/i.test(x));
    result.visibleEvidence.unshift('OCR scartato: testo non affidabile');
    result.reason='Vision PRO V28.65: OCR non affidabile, non compilo nome/marca da rumore. Uso solo pixel e chiedo etichetta/barcode.';
    if(pixel?.anchors?.darkLiquid){ result.productName='Bevanda scura in bottiglia da identificare'; result.category='drinks'; result.isLiquid=true; result.unit='bt'; result.confidence=Math.min(Number(result.confidence||0),.48); }
    else if(pixel?.anchors?.clearLiquid){ result.productName='Acqua/bevanda chiara in bottiglia da confermare'; result.category='water'; result.isLiquid=true; result.unit='bt'; result.confidence=Math.min(Number(result.confidence||0),.48); }
    else if(pixel?.anchors?.homeContainer){ result.productName='Prodotto casa da identificare'; result.category='house'; result.unit='conf'; result.confidence=Math.min(Number(result.confidence||0),.42); }
    result.needsManual=true; result.shouldAskConfirmation=true;
  }
  if(v2865BadName(result.productName)) result.productName='Prodotto da identificare';
  if(v2865BadBrand(result.brand)) result.brand='';
  const strong=!!(fields.ocrStrong && result.productName && result.brand && Number(result.confidence||0)>=.78 && bestTrusted);
  const useful=strong || !!(fields.ocrStrong && result.productName && Number(result.confidence||0)>=.72 && bestTrusted);
  result.proPixelOcrV2864=Object.assign({},result.proPixelOcrV2864||{},{providers,strong,useful,stage:String(stage||'auto'),externalOcrEnabled:providers.some(p=>/ocr_space|google/.test(p.provider||'')),sharpAvailable:!!pixel?.available,qualityGateV2865:{bestTrusted,best:best?{provider:best.provider,score:best.score,chars:String(best.text||'').length,variant:best.variant||''}:null,policy:'highest_quality_ocr_not_longest_text'}});
  result.proOcrQualityGateV2865={active:true,bestTrusted,bestQuality:best?.quality||null,rejected:!bestTrusted,cost:'zero_openai_tokens'};
  try{ if(useful) updateGlobalLearningAudit({type:'v2865-pixel-ocr-useful',productName:result.productName,brand:result.brand,category:result.category,providers:providers.map(p=>p.provider+':' + (p.score??'')).join(','),openai:false}); }catch(_){ }
  return {ok:true,version:V2865_VERSION,pixel,ocr:{text,providers,best:best?{provider:best.provider,score:best.score,variant:best.variant||'',trusted:bestTrusted}:null},fields,result,strong,useful,cost:{openai:0,ocrExternalConfigured:providers.some(p=>/ocr_space|google/.test(p.provider||'')),ocrCrops:providers.filter(p=>p.provider==='ocr_space').length}};
};
try{
  const prev=preflightSnapshotV98;
  if(typeof prev==='function'&&!global.__v2865PreflightWrapped){
    preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.65'; s.brain=Object.assign({},s.brain||{},{version:'V28.65',ocrQualityGate:'active',ocrSpaceRoiCrop:'active',badOcrRejected:'active',liveGuidance:'fixed'}); return s; };
    global.__v2865PreflightWrapped=true;
  }
}catch(_){ }
console.log('[Spesa Pronta] V28.65 PRO OCR Quality Gate + ROI Crop Visual Judge active');


// =============================================================
// V28.66 PRO Single Vision Truth + Brand Shield + Brain Dedupe
// - Una sola identità vera: foto/OCR attuale > titolare > barcode/API > memoria > docente.
// - "Cola" non diventa mai Coca-Cola senza testo/barcode ufficiale Coca-Cola.
// - Il Cervello Server unisce duplicati reali (stesso barcode o stessa identità forte).
// - Le schede memoria vengono sanificate prima del match/lista.
// =============================================================
const V2866_VERSION = 'V28.66';
function v2866Clean(v='', max=260){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function v2866Norm(v=''){
  try{ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); }
  catch(_){ return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
}
function v2866List(...vals){
  const out=[]; const push=x=>{ if(x==null) return; if(Array.isArray(x)) return x.forEach(push); if(typeof x==='object') return; String(x).split(/\n|\s*[;,]\s*/).forEach(y=>{ const c=v2866Clean(y,180); if(c) out.push(c); }); };
  vals.forEach(push); return [...new Set(out)].slice(0,140);
}
function v2866RecordEvidenceText(r={}, extra={}){
  const card=r.memoryCard||{}; const id=card.identity||{}; const va=card.visualAppearance||{}; const oo=r.ownerOverrides?.fields||{};
  const photos=(r.objectFolder?.photos||[]).slice(0,10).flatMap(p=>[p.visualSignature,(p.detectedText||[]).join(' '),(p.visibleEvidence||[]).join(' '),(p.colors||[]).join(' ')]);
  return [r.productName,r.brand,r.format,r.category,r.unit,(r.aliases||[]).join(' '),(r.brands||[]).join(' '),(r.evidenceTokens||[]).join(' '),(r.visibleEvidence||[]).join(' '),(r.detectedText||[]).join(' '),id.productName,id.brand,id.format,va.productType,va.packageType,va.visualSignature,(va.colors||[]).join(' '),oo.productName,oo.brand,oo.format,oo.category,oo.barcode,photos.join(' '),extra.productName,extra.brand,extra.productType,extra.category,(extra.detectedText||[]).join(' '),(extra.visibleEvidence||[]).join(' '),extra.ocrText,extra.text].filter(Boolean).join(' ');
}
function v2866ProofText(r={}, extra={}){
  const card=r.memoryCard||{}; const va=card.visualAppearance||{}; const oo=r.ownerOverrides?.fields||{};
  const photos=(r.objectFolder?.photos||[]).slice(0,10).flatMap(p=>[(p.detectedText||[]).join(' '),(p.visibleEvidence||[]).join(' ')]);
  return [(r.evidenceTokens||[]).join(' '),(r.visibleEvidence||[]).join(' '),(r.detectedText||[]).join(' '),va.visualSignature,oo.productName,oo.brand,oo.barcode,photos.join(' '),(extra.detectedText||[]).join(' '),(extra.visibleEvidence||[]).join(' '),extra.ocrText,extra.text,extra.barcode,extra.ean,extra.code].filter(Boolean).join(' ');
}
function v2866HasOfficialCocaEvidence(text=''){
  const t=v2866Norm(text);
  return /\bcoca\s+cola\b|\bcoca\b.*\bcola\b|\bcoke\b|\bthe\s+coca\s+cola\s+company\b/.test(t);
}
function v2866HasBluesEvidence(text=''){
  const t=v2866Norm(text);
  return /\bblues\b|\bcola\s+blues\b|\bblues\s+cola\b/.test(t);
}
function v2866HasColaEvidence(text=''){
  return /\bcola\b|\blemon\s+taste\b|\bbibita\s+cola\b|\bsoft\s*drinks?\b/.test(v2866Norm(text));
}
function v2866GenericColaName(v=''){
  const t=v2866Norm(v);
  return !t || /^(bibita|bevanda)(\s+tipo)?\s+cola|^cola\s*\/|^cola$|^bibita\s+gassata|^prodotto\s+da\s+identificare/.test(t);
}
function v2866NormalizeFormat(v=''){
  let s=String(v||'').toLowerCase().replace(/,/g,'.').replace(/litri|litro|lt\.?/g,'l').replace(/millilitri|millilitro/g,'ml').replace(/\s+/g,' ').trim();
  let m=s.match(/(\d+(?:\.\d+)?)\s*(l|ml|cl|kg|g)\b/); if(!m) return v2866Norm(s).slice(0,24);
  let n=Number(m[1]); const u=m[2]; if(!Number.isFinite(n)) return `${m[1]} ${u}`;
  if(u==='cl') return `${Math.round(n*10)} ml`;
  const num=(String(n).replace(/\.0$/,'')); return `${num} ${u}`;
}
function v2866CoreName(v=''){
  const t=v2866Norm(v).replace(/\b(blues|coca|cola|sant|anna|dexal|tipo|bibita|bevanda|gassata|soft|drinks?|the|company|marca|formato|capienza|prodotto|identificare|da|confermare)\b/g,' ').replace(/\s+/g,' ').trim();
  const all=v2866Norm(v);
  if(/\bcandeggina\b/.test(all)) return ['candeggina',/delicata/.test(all)?'delicata':'',/maxi/.test(all)?'maxi':''].filter(Boolean).join(' ');
  if(/\bcola\b/.test(all)) return ['cola',/lemon|limone/.test(all)?'lemon':''].filter(Boolean).join(' ');
  if(/\bacqua\b|\bsant\s*anna\b|\bsantanna\b/.test(all)) return ['acqua',/sant\s*anna|santanna/.test(all)?'santanna':''].filter(Boolean).join(' ');
  return (t.split(/\s+/).filter(x=>x.length>2).slice(0,5).join(' ') || all.split(/\s+/).slice(0,5).join(' ')).slice(0,80);
}
function v2866CategoryFam(cat=''){
  try{ return productCategoryFamily(cat||''); }catch(_){ const t=v2866Norm(cat); if(/water|soft|drink|juice|milk|cola|bev/.test(t)) return 'drinks'; if(/clean|laundry|house|bucato/.test(t)) return 'house'; return t||'food'; }
}
function v2866SanitizeIdentityObject(obj={}, extra={}){
  if(!obj || typeof obj!=='object') return obj;
  const evidence=v2866RecordEvidenceText(obj, extra);
  const n=v2866Norm(evidence);
  const proof=v2866ProofText(obj, extra);
  const officialCoca=v2866HasOfficialCocaEvidence(proof) || (!!obj.ownerOverrides?.enabled && /^coca[\s-]*cola$/i.test(String(obj.ownerOverrides?.fields?.brand||obj.ownerOverrides?.fields?.productName||'')));
  const blues=v2866HasBluesEvidence(evidence);
  const cola=v2866HasColaEvidence(evidence);
  obj.proBrandShieldV2866=Object.assign({}, obj.proBrandShieldV2866||{}, {checked:true, officialCoca, bluesEvidence:blues, colaEvidence:cola, rule:'Coca-Cola solo con testo/barcode ufficiale; Cola generica non decide la marca'});
  if(/^coca[\s-]*cola$/i.test(String(obj.brand||'')) && !officialCoca){
    obj.proBrandShieldV2866.correctedBrandFrom='Coca-Cola';
    obj.brand = blues ? 'Blues' : '';
  }
  if(/^coca[\s-]*cola$/i.test(String(obj.productName||'')) && !officialCoca){
    obj.proBrandShieldV2866.correctedNameFrom='Coca-Cola';
    obj.productName = blues ? 'Cola Blues' : 'Bibita cola da confermare';
  }
  if(cola && blues){
    if(!obj.brand || /^coca[\s-]*cola$/i.test(String(obj.brand||''))) obj.brand='Blues';
    if(v2866GenericColaName(obj.productName||'') || /^bibita\s+tipo\s+cola$/i.test(String(obj.productName||''))) obj.productName = /lemon\s*taste|limone/.test(n) ? 'Cola - Lemon Taste' : 'Cola Blues';
  }
  if(/^bibita\s+tipo\s+cola$/i.test(String(obj.productName||'')) && !obj.brand){
    obj.productName='Bibita cola da confermare';
  }
  if(obj.category==='soft_drinks' && !obj.unit) obj.unit='bt';
  return obj;
}
function v2866SanitizeRecord(record={}){
  if(!record || typeof record!=='object') return record;
  v2866SanitizeIdentityObject(record, {});
  record.aliases=Array.isArray(record.aliases)?record.aliases:[]; record.brands=Array.isArray(record.brands)?record.brands:[];
  if(record.brand && !record.brands.includes(record.brand)) record.brands.unshift(record.brand);
  if(record.productName && !record.aliases.includes(record.productName)) record.aliases.unshift(record.productName);
  const photos=Number(record.objectFolder?.photos?.length||record.objectFolder?.photoCount||0);
  const confirmations=Number(record.confirmations||0);
  if(record.ownerOverrides?.enabled || record.lockedByOwner) record.reliability='alta';
  else if(confirmations>=1 && photos>=1) record.reliability = record.reliability==='alta'?'alta':'media';
  if(record.memoryCard?.identity){
    record.memoryCard.identity.productName=record.productName||record.memoryCard.identity.productName;
    record.memoryCard.identity.brand=record.brand||record.memoryCard.identity.brand;
    record.memoryCard.identity.format=record.format||record.memoryCard.identity.format;
  }
  record.learningQuality=Object.assign({},record.learningQuality||{},{brandShieldV2866:true,dedupeV2866:true,currentPhotoAuthority:'foto/OCR attuale battono memoria se in conflitto'});
  return record;
}
function v2866MergeArrays(a,b,limit=120){ return [...new Set([...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])].map(x=>typeof x==='string'?v2866Clean(x,260):x).filter(Boolean))].slice(0,limit); }
function v2866MergeVotes(a={}, b={}){ const out=Object.assign({},a||{}); for(const [k,v] of Object.entries(b||{})){ if(!k) continue; out[k]=Number(out[k]||0)+Number(v||0); } return out; }
function v2866RecordScore(r={}){ return (r.ownerOverrides?.enabled?10000:0)+(r.lockedByOwner?5000:0)+Number(r.confirmations||0)*50+Number(r.objectFolder?.photos?.length||0)*8+(Array.isArray(r.barcodes)&&r.barcodes.length?90:0)+(r.reliability==='alta'?60:r.reliability==='media'?30:0)+Number(r.updatedAt||0)/1e13; }
function v2866CanMerge(a={}, b={}){
  if(!a||!b||a===b) return false;
  const aBc=v2866List(a.barcodes,a.barcode).find(x=>/\d{8,14}/.test(String(x||'')));
  const bBc=v2866List(b.barcodes,b.barcode).find(x=>/\d{8,14}/.test(String(x||'')));
  if(aBc && bBc && aBc===bBc) return true;
  const ea=v2866RecordEvidenceText(a), eb=v2866RecordEvidenceText(b);
  const aOfficial=v2866HasOfficialCocaEvidence(ea), bOfficial=v2866HasOfficialCocaEvidence(eb);
  const aBrand=v2866Norm(a.brand||''), bBrand=v2866Norm(b.brand||'');
  if(aBrand && bBrand && aBrand!==bBrand){
    if(!((aBrand==='coca cola'&&!aOfficial)||(bBrand==='coca cola'&&!bOfficial))) return false;
  }
  const coreA=v2866CoreName([a.productName,(a.aliases||[]).join(' ')].join(' '));
  const coreB=v2866CoreName([b.productName,(b.aliases||[]).join(' ')].join(' '));
  if(!coreA || !coreB) return false;
  const coreSame=coreA===coreB || coreA.includes(coreB) || coreB.includes(coreA);
  if(!coreSame) return false;
  const fmtA=v2866NormalizeFormat(a.format||''), fmtB=v2866NormalizeFormat(b.format||'');
  if(fmtA && fmtB && fmtA!==fmtB) return false;
  const famA=v2866CategoryFam(a.category), famB=v2866CategoryFam(b.category);
  if(famA && famB && famA!==famB){
    const drinkish=new Set(['drinks','water','soft_drinks','juice']);
    const homeish=new Set(['house','cleaning','laundry','dishwashing','paper_house']);
    if(!((drinkish.has(famA)&&drinkish.has(famB)) || (homeish.has(famA)&&homeish.has(famB)))) return false;
  }
  return !!(aBrand || bBrand || fmtA || fmtB || aBc || bBc);
}
function v2866MergeRecordInto(target={}, src={}){
  v2866SanitizeRecord(target); v2866SanitizeRecord(src);
  target.aliases=v2866MergeArrays(target.aliases,[src.productName,src.aliases].flat(),40);
  target.brands=v2866MergeArrays(target.brands,[src.brand,src.brands].flat(),30);
  target.barcodes=v2866MergeArrays(target.barcodes,src.barcodes,20);
  ['ingredients','allergens','possibleTraces','traces','colors','labels','visibleEvidence','detectedText','evidenceTokens','knowledgeSources','conflictRejects','confirmedExamples'].forEach(k=>{ target[k]=v2866MergeArrays(target[k],src[k], k==='confirmedExamples'?80:120); });
  ['nameVotes','brandVotes','formatVotes','categoryVotes','unitVotes'].forEach(k=>{ target[k]=v2866MergeVotes(target[k],src[k]); });
  if(!target.productName || v2866GenericColaName(target.productName)) target.productName=src.productName||target.productName;
  if(!target.brand) target.brand=src.brand||target.brand;
  if(!target.format) target.format=src.format||target.format;
  if(!target.category || target.category==='food') target.category=src.category||target.category;
  if(!target.unit || target.unit==='pz') target.unit=src.unit||target.unit;
  target.confirmations=Math.max(Number(target.confirmations||0),0)+Math.max(Number(src.confirmations||0),0);
  target.teacherHelp=Number(target.teacherHelp||0)+Number(src.teacherHelp||0);
  target.localRecognitions=Number(target.localRecognitions||0)+Number(src.localRecognitions||0);
  target.households=Object.assign({},src.households||{},target.households||{});
  target.sources=Object.assign({},src.sources||{},target.sources||{});
  target.objectFolder=target.objectFolder||{}; src.objectFolder=src.objectFolder||{};
  target.objectFolder.photos=v2866MergeArrays(target.objectFolder.photos,src.objectFolder.photos,60);
  target.objectFolder.visualSignatures=v2866MergeArrays(target.objectFolder.visualSignatures,src.objectFolder.visualSignatures,40);
  target.objectFolder.visualFeatureSamples=v2866MergeArrays(target.objectFolder.visualFeatureSamples,src.objectFolder.visualFeatureSamples,80);
  if(!target.objectFolder.representativePhoto && src.objectFolder.representativePhoto) target.objectFolder.representativePhoto=src.objectFolder.representativePhoto;
  if(!target.objectFolder.representativePhotoId && src.objectFolder.representativePhotoId) target.objectFolder.representativePhotoId=src.objectFolder.representativePhotoId;
  target.objectFolder.photoCount=(target.objectFolder.photos||[]).length;
  target.objectFolder.hasRealProfilePhoto=!!((target.objectFolder.representativePhoto||{}).dataUrl||(target.objectFolder.representativePhoto||{}).externalUrl||(target.objectFolder.photos||[]).some(p=>p.dataUrl||p.externalUrl));
  target.duplicateMergedV2866=Array.isArray(target.duplicateMergedV2866)?target.duplicateMergedV2866:[];
  target.duplicateMergedV2866.unshift({at:Date.now(),fromKey:src.key||'',productName:src.productName||'',brand:src.brand||'',format:src.format||''});
  target.duplicateMergedV2866=target.duplicateMergedV2866.slice(0,30);
  target.updatedAt=Math.max(Number(target.updatedAt||0),Number(src.updatedAt||0),Date.now());
  v2866SanitizeRecord(target);
  try{ updateFieldConfidence(target); v2840AttachMemoryCard(target,{}); }catch(_){ }
  return target;
}
function v2866DedupeGlobalProductMemory(){
  try{
    ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; g.products=g.products||{};
    const records=Object.values(g.products); records.forEach(v2866SanitizeRecord);
    let merges=0;
    for(let i=0;i<records.length;i++){
      const a=records[i]; if(!a || !g.products[a.key]) continue;
      for(let j=i+1;j<records.length;j++){
        const b=records[j]; if(!b || !g.products[b.key]) continue;
        if(!v2866CanMerge(a,b)) continue;
        const target=v2866RecordScore(a)>=v2866RecordScore(b)?a:b; const src=target===a?b:a;
        v2866MergeRecordInto(target,src);
        const srcKey=src.key; if(srcKey && g.products[srcKey] && srcKey!==target.key) delete g.products[srcKey];
        g.products[target.key||productMemoryGlobalKey(target.productName,target.brand,target.format)]=target;
        merges++; records[j]=null;
      }
    }
    if(merges){ g.updatedAt=Date.now(); updateGlobalLearningAudit({type:'v2866-brain-dedupe-merged',merges,policy:'same barcode or same strong identity/brand/format'}); try{ saveDb().catch(()=>{}); }catch(_){ } }
    return merges;
  }catch(e){ try{ updateGlobalLearningAudit({type:'v2866-dedupe-error',reason:String(e?.message||e).slice(0,180)}); }catch(_){} return 0; }
}
(function(){
  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2866UpsertWrapped){
      const prev=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        v2866SanitizeIdentityObject(confirmed, confirmed.productMemory||{});
        const out=prev.call(this,confirmed);
        try{ ensureDbShape(); Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(v2866SanitizeRecord); v2866DedupeGlobalProductMemory(); }catch(_){ }
        return out;
      };
      global.__v2866UpsertWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof matchGlobalProductMemory==='function' && !global.__v2866MatchWrapped){
      const prev=matchGlobalProductMemory;
      matchGlobalProductMemory=function(query={}){
        v2866SanitizeIdentityObject(query, query.productMemory||{});
        try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(v2866SanitizeRecord); }catch(_){ }
        const hit=prev.call(this,query||{});
        if(hit?.product){ v2866SanitizeIdentityObject(hit.product,query||{}); }
        return hit;
      };
      global.__v2866MatchWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof publicServerBrainV2840==='function' && !global.__v2866ServerBrainWrapped){
      const prev=publicServerBrainV2840;
      publicServerBrainV2840=function(opts={}){
        v2866DedupeGlobalProductMemory();
        try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(r=>{ v2866SanitizeRecord(r); try{ v2840AttachMemoryCard(r,{}); }catch(_){} }); }catch(_){ }
        const out=prev.call(this,opts||{});
        out.version='V28.66 PRO Single Vision Truth + Brain Dedupe';
        out.dedupeV2866={active:true,policy:'barcode + identità forte + brand/formato, niente duplicati Cola/Dexal'};
        return out;
      };
      global.__v2866ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof serverPixelOcrJudgeV2864==='function' && !global.__v2866PixelJudgeWrapped){
      const prev=serverPixelOcrJudgeV2864;
      serverPixelOcrJudgeV2864=async function(args={}){
        const out=await prev.call(this,args||{});
        if(out?.result) v2866SanitizeIdentityObject(out.result,{ocrText:out.ocr?.text||'', text:out.ocr?.text||''});
        if(out?.fields) v2866SanitizeIdentityObject(out.fields,{ocrText:out.ocr?.text||''});
        if(out) out.version=V2866_VERSION;
        return out;
      };
      global.__v2866PixelJudgeWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof visionAnalyze==='function' && !global.__v2866VisionAnalyzeWrapped){
      const prev=visionAnalyze;
      visionAnalyze=async function(payload={}){
        const out=await prev.call(this,payload||{});
        return v2866SanitizeIdentityObject(out||{}, payload||{});
      };
      global.__v2866VisionAnalyzeWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2866PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.66'; s.brain=Object.assign({},s.brain||{},{version:'V28.66',singleVisionTruth:'active',brandShield:'cola_not_coca_without_official_evidence',brainDedupe:'active',visionBridge:'VisionAI + Pixel/OCR judge + memoria server sanificati in uscita'}); return s; }; global.__v2866PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.66 PRO Single Vision Truth + Brand Shield + Brain Dedupe active');
})();

// =============================================================
// V28.67 PRO Human Reasoning Bus + Virtual Product Render + Owner Delete
// Obiettivo: far dialogare VisionAI, OCR, pixel judge, memoria e console titolare.
// - OCR.space riceve crop migliori e il server valuta qualita' prima di compilare.
// - Ogni scheda espone un "ragionamento umano" leggibile.
// - Il Cervello Server puo' generare un render virtuale del prodotto.
// - Il titolare puo' eliminare articoli errati/duplicati dalla memoria server.
// =============================================================
const V2867_VERSION = 'V28.67';
function v2867Str(v='', max=220){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function v2867Norm(v=''){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); }
function v2867List(...vals){
  const out=[]; const push=x=>{ if(x==null) return; if(Array.isArray(x)) return x.forEach(push); if(typeof x==='object') return; String(x).split(/\n|\s*[;,]\s*/).forEach(y=>{ const c=v2867Str(y,180); if(c) out.push(c); }); };
  vals.forEach(push); return [...new Set(out)].slice(0,120);
}
function v2867Xml(v=''){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').slice(0,160); }
function v2867HexForColor(name='', fallback='#dbeafe'){
  const n=v2867Norm(name);
  if(/nero|scuro|black|dark/.test(n)) return '#111827';
  if(/blu|azzurro|blue/.test(n)) return '#1d4ed8';
  if(/giallo|yellow|oro/.test(n)) return '#facc15';
  if(/rosso|red/.test(n)) return '#ef4444';
  if(/arancio|orange/.test(n)) return '#f97316';
  if(/verde|green/.test(n)) return '#10b981';
  if(/viola|purple/.test(n)) return '#7c3aed';
  if(/bianco|chiaro|white|trasparente|clear/.test(n)) return '#f8fafc';
  if(/grigio|gray|grey/.test(n)) return '#94a3b8';
  return fallback;
}
function v2867RecordEvidence(record={}, card={}, extra={}){
  return [record.productName,record.brand,record.format,record.category,record.productType,record.packageType,record.packaging,card?.identity?.productName,card?.identity?.brand,card?.identity?.format,card?.classification?.category,card?.visualAppearance?.productType,card?.visualAppearance?.packageType,card?.visualAppearance?.visualSignature,extra.ocrText,extra.text,...v2867List(record.detectedText,record.visibleEvidence,card?.detectedText,card?.visibleEvidence,record.evidenceTokens)].filter(Boolean).join(' ');
}
function v2867OfficialCocaEvidence(text=''){ return /\bcoca\s+cola\b|\bcoca-cola\b|\bcoke\b|\bthe\s+coca\s+cola\s+company\b/.test(v2867Norm(text)); }
function v2867HasBlues(text=''){ return /\bblues\b|\bblues\s+cola\b|\bcola\s+blues\b/.test(v2867Norm(text)); }
function v2867ProductShape(card={}, record={}){
  const cat=v2867Norm(card?.classification?.category||record.category||'');
  const fam=v2867Norm(card?.classification?.categoryFamily||record.categoryFamily||'');
  const pkg=v2867Norm([card?.visualAppearance?.packageType,card?.packaging,record.packageType,record.packaging,card?.visualAppearance?.visualSignature].filter(Boolean).join(' '));
  const ev=v2867Norm(v2867RecordEvidence(record,card));
  if(/flacone|tanica|candeggina|detersivo|bucato|laundry|cleaning|detergente|ammorbidente/.test(pkg+' '+cat+' '+ev)) return 'detergent_jug';
  if(/bottiglia|bottle|cola|acqua|drink|soft|juice|t[eè]|the|bevanda|water/.test(pkg+' '+cat+' '+fam+' '+ev)) return 'bottle';
  if(/vasetto|barattolo|jar|pesto|salsa|spread|condiment/.test(pkg+' '+cat+' '+ev)) return 'jar';
  if(/busta|sacchetto|pouch|bag/.test(pkg+' '+ev)) return 'pouch';
  if(/scatola|box|cartone|cereal|pasta|riso|farina/.test(pkg+' '+cat+' '+ev)) return 'box';
  return 'package';
}
function v2867RenderSpec(card={}, record={}){
  const colors=v2867List(card?.visualAppearance?.colors,record.colors,record.memoryCard?.visualAppearance?.colors).slice(0,8);
  const ev=v2867Norm(v2867RecordEvidence(record,card));
  const shape=v2867ProductShape(card,record);
  let body='#e5e7eb', body2='#f8fafc', label='#1d4ed8', label2='#facc15', cap='#facc15', content='none', contentColor='#0f172a';
  if(colors.length){ body=v2867HexForColor(colors[0],body); label=v2867HexForColor(colors[1]||colors[0],label); label2=v2867HexForColor(colors[2]||colors[1]||'bianco',label2); }
  if(/cola|liquido\s+scuro|dark_liquid|bibita\s+cola|lemon\s*taste/.test(ev)){ content='liquido scuro'; contentColor='#171717'; body='#dbeafe'; label='#1e3a8a'; label2='#facc15'; cap='#facc15'; }
  if(/acqua|sant\s*anna|naturale|minerale|clear_liquid/.test(ev)){ content='liquido chiaro'; contentColor='rgba(125,211,252,.42)'; body='#e0f2fe'; label='#38bdf8'; label2='#ffffff'; cap='#60a5fa'; }
  if(/dexal|candeggina|detersivo|laundry|bucato/.test(ev)){ body='#21c7bd'; body2='#7dd3fc'; label='#ef4444'; label2='#ffffff'; cap='#2563eb'; content='non visibile'; }
  if(/pesto|salsa|condimento/.test(ev)){ body='#f8fafc'; label='#16a34a'; label2='#fde68a'; cap='#14532d'; content='cremoso/solido'; }
  const name=v2867Str(card?.identity?.productName||record.productName||'Prodotto',48);
  const brand=v2867Str(card?.identity?.brand||record.brand||'',34);
  const format=v2867Str(card?.identity?.format||record.format||'',20);
  const cat=v2867Str(card?.classification?.category||record.category||'',34);
  return {version:V2867_VERSION,shape,bodyColor:body,secondaryBodyColor:body2,labelColor:label,labelAccentColor:label2,capColor:cap,content,contentColor,name,brand,format,category:cat,source:'server_memory_fields_plus_pixel_ocr_evidence',colors};
}
function v2867VirtualSvg(spec={}, opts={}){
  const bg=String(opts.background||'transparent').toLowerCase();
  const bgRect=bg==='white'?`<rect width="480" height="640" rx="36" fill="#ffffff"/>`:'';
  const name=v2867Xml(spec.name||'Prodotto'), brand=v2867Xml(spec.brand||''), format=v2867Xml(spec.format||''), cat=v2867Xml(spec.category||'');
  const labelText1=brand||name.split(' ')[0]||'Prodotto';
  const labelText2=brand?name:name.replace(new RegExp('^'+brand+'\\s*','i'),'');
  let obj='';
  if(spec.shape==='detergent_jug'){
    obj=`<path d="M150 175 Q150 126 199 114 L309 126 Q343 132 350 174 L379 507 Q383 562 327 578 L147 578 Q97 570 104 516 Z" fill="${spec.bodyColor}" stroke="#0f3760" stroke-opacity=".18" stroke-width="8"/><path d="M286 162 Q360 160 366 232 Q368 293 314 315 Q295 322 286 302 Q335 286 331 237 Q328 198 286 198 Z" fill="#f8fafc" fill-opacity=".82"/><rect x="173" y="66" width="116" height="66" rx="18" fill="${spec.capColor}"/><rect x="136" y="274" width="216" height="154" rx="28" fill="${spec.labelColor}"/><path d="M136 274 L352 274 L316 428 L136 428 Z" fill="${spec.labelAccentColor}" opacity=".72"/>`;
  } else if(spec.shape==='box'){
    obj=`<rect x="122" y="112" width="236" height="420" rx="28" fill="${spec.bodyColor}" stroke="#0f3760" stroke-opacity=".14" stroke-width="8"/><rect x="146" y="238" width="188" height="160" rx="22" fill="${spec.labelColor}"/><rect x="160" y="256" width="160" height="36" rx="18" fill="${spec.labelAccentColor}" opacity=".85"/>`;
  } else if(spec.shape==='jar'){
    obj=`<rect x="164" y="118" width="152" height="72" rx="18" fill="${spec.capColor}"/><path d="M134 190 L346 190 L328 542 Q325 578 288 582 L192 582 Q155 578 152 542 Z" fill="${spec.bodyColor}" stroke="#0f3760" stroke-opacity=".13" stroke-width="8"/><rect x="152" y="302" width="176" height="120" rx="24" fill="${spec.labelColor}"/>`;
  } else if(spec.shape==='pouch'){
    obj=`<path d="M132 98 L348 98 Q365 330 342 574 L138 574 Q115 330 132 98 Z" fill="${spec.bodyColor}" stroke="#0f3760" stroke-opacity=".14" stroke-width="8"/><rect x="154" y="250" width="172" height="146" rx="26" fill="${spec.labelColor}"/><path d="M150 115 Q240 160 330 115" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="12"/>`;
  } else {
    obj=`<rect x="202" y="62" width="76" height="68" rx="16" fill="${spec.capColor}"/><path d="M185 118 Q185 166 158 206 Q133 244 132 305 L132 526 Q132 578 184 592 L296 592 Q348 578 348 526 L348 305 Q347 244 322 206 Q295 166 295 118 Z" fill="${spec.bodyColor}" stroke="#0f3760" stroke-opacity=".14" stroke-width="8"/><path d="M158 300 L322 300 L322 540 Q296 556 240 556 Q184 556 158 540 Z" fill="${spec.contentColor}" opacity="${spec.content==='liquido chiaro'?'.36':'.86'}"/><rect x="139" y="282" width="202" height="148" rx="28" fill="${spec.labelColor}"/><path d="M139 282 L341 282 L310 430 L139 430 Z" fill="${spec.labelAccentColor}" opacity=".78"/>`;
  }
  const txt=`<text x="240" y="330" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="900" fill="#ffffff">${v2867Xml(labelText1).slice(0,18)}</text><text x="240" y="370" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="900" fill="#08203e">${v2867Xml(labelText2||cat).slice(0,22)}</text><text x="240" y="410" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="20" font-weight="900" fill="#08203e">${format}</text>`;
  const footer=`<text x="240" y="620" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="800" fill="#64748b">Render virtuale · ${v2867Xml(spec.shape)} · ${v2867Xml(spec.content)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">${bgRect}<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0f172a" flood-opacity=".18"/></filter></defs><g filter="url(#s)">${obj}${txt}</g>${footer}</svg>`;
}
function v2867GenerateVirtualRender(card={}, record={}, opts={}){
  const spec=v2867RenderSpec(card,record);
  const svg=v2867VirtualSvg(spec,opts||{});
  return {version:V2867_VERSION,background:String(opts.background||'transparent'),spec,svgDataUri:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),svg};
}
function v2867BuildHumanReasoning(card={}, record={}, confirmed={}){
  const ev=v2867RecordEvidence(record,card,confirmed);
  const n=v2867Norm(ev);
  const shape=v2867ProductShape(card,record);
  const colors=v2867List(card?.visualAppearance?.colors,record.colors).slice(0,10);
  const textTokens=[...new Set((v2867List(record.detectedText,record.visibleEvidence,card.detectedText,card.visibleEvidence,record.evidenceTokens).join(' ')+' '+ev).split(/\s+/).map(x=>v2867Str(x,40)).filter(x=>/[A-Za-zÀ-ÿ0-9]{3}/.test(x)))].slice(0,30);
  const content=/liquido\s+scuro|dark_liquid|cola|bibita/.test(n)?'liquido scuro visibile':(/acqua|naturale|clear_liquid|trasparente/.test(n)?'liquido chiaro/trasparente visibile':(/candeggina|detersivo|flacone|laundry|cleaning/.test(n)?'contenuto non visibile o prodotto casa in flacone':'contenuto non certo'));
  const nonFood=/candeggina|detersivo|detergente|ammorbidente|bucato|pulizia|lavatrice|laundry|cleaning|dishwashing/.test(n);
  const identityEvidence=[];
  if(card?.identity?.productName) identityEvidence.push('nome confermato: '+card.identity.productName);
  if(card?.identity?.brand) identityEvidence.push('marca confermata: '+card.identity.brand);
  if(card?.barcode) identityEvidence.push('barcode/EAN presente');
  if(textTokens.length) identityEvidence.push('testi/etichette: '+textTokens.slice(0,10).join(', '));
  return {version:V2867_VERSION,mission:'vedere + leggere + ragionare prima di memoria/OpenAI',subject:{shape,packageType:card?.visualAppearance?.packageType||record.packageType||'',format:card?.identity?.format||record.format||'',category:card?.classification?.category||record.category||''},appearance:{colors,content,visualSignature:card?.visualAppearance?.visualSignature||record.visualSignature||''},identityEvidence,decisionRules:['testo attuale/barcode/valori titolare vincono sulla memoria vecchia','forma e colore sono indizi, non identità','ingredienti/allergeni/tracce non decidono il nome prodotto',nonFood?'prodotto non alimentare rilevato da parole di pulizia/bucato':'categoria alimentare/bevanda solo se coerente con testo/barcode/foto'],riskFlags:[!card?.identity?.brand?'marca da verificare':'',!card?.barcode?'EAN mancante':'',!card?.objectFolder?.photoCount?'foto reali mancanti':''].filter(Boolean),engines:{pixelJudge:'V28.67 human reasoning bus',ocr:'client OCR + OCR.space crop router + quality gate',memory:'cartella oggetto + valori titolare + dedupe',openai:'docente finale solo se prove gratuite non bastano'}};
}
function v2867EnhanceCard(card={}, record={}, confirmed={}){
  if(!card || typeof card!=='object') return card;
  try{ card.humanReasoningV2867=v2867BuildHumanReasoning(card,record,confirmed); }catch(_){ }
  try{ card.virtualRenderV2867=v2867GenerateVirtualRender(card,record,{background:'transparent'}); }catch(_){ }
  return card;
}
function v2867HumanFieldCorrection(fields={}, text='', pixel=null){
  const f=Object.assign({},fields||{}); const t=v2867Norm(text); const px=pixel?.anchors||{};
  const officialCoca=v2867OfficialCocaEvidence(text); const blues=v2867HasBlues(text); const cola=/\bcola\b|\blemon\s*taste\b/.test(t);
  if(blues && cola){ f.brand='Blues'; f.category='soft_drinks'; f.productType='bibita cola'; f.productName=/lemon\s*taste|limone/.test(t)?'Cola - Lemon Taste':'Cola Blues'; f.unit='bt'; f.isLiquid=true; f.confidence=Math.max(Number(f.confidence||0),.84); f.ocrStrong=true; }
  if(cola && !officialCoca && /^coca[\s-]*cola$/i.test(String(f.brand||''))) f.brand=blues?'Blues':'';
  if(cola && !officialCoca && /^coca[\s-]*cola$/i.test(String(f.productName||''))) f.productName=blues?'Cola Blues':'Bibita cola da confermare';
  if(/\bsant\s*anna\b|\bsantanna\b/.test(t)){ f.brand="Sant'Anna"; f.category='water'; f.productType=/frizzante/.test(t)?'acqua frizzante':'acqua naturale'; f.productName="Acqua Sant'Anna"; f.unit='bt'; f.isLiquid=true; f.confidence=Math.max(Number(f.confidence||0),.90); f.ocrStrong=true; }
  if(/\bdexal\b/.test(t) && /\bcandeggina\b/.test(t)){ f.brand='Dexal'; f.category='laundry'; f.productType=/delicata/.test(t)?'candeggina delicata':'candeggina'; f.productName=/maxi/.test(t)?'Dexal Candeggina Delicata Maxi':'Dexal Candeggina Delicata'; f.unit='conf'; f.isLiquid=true; f.confidence=Math.max(Number(f.confidence||0),.91); f.ocrStrong=true; }
  if(!text && px.darkLiquid){ f.productName='Bevanda scura in bottiglia da identificare'; f.brand=''; f.category='drinks'; f.unit='bt'; f.isLiquid=true; f.confidence=Math.min(Number(f.confidence||0)||.46,.50); }
  if(!text && px.clearLiquid){ f.productName='Acqua/bevanda chiara in bottiglia da confermare'; f.brand=''; f.category='water'; f.unit='bt'; f.isLiquid=true; f.confidence=Math.min(Number(f.confidence||0)||.46,.50); }
  f.humanReasoningV2867={corrected:true,officialCoca,bluesEvidence:blues,colaEvidence:cola,policy:'brand/nome solo da testo reale, barcode, memoria coerente o titolare'};
  return f;
}
async function v2867BuildOcrVariants(dataUrl='', pixel=null){
  const sharp=await v2864Sharp(); const buf=v2864DataUrlBuffer(dataUrl);
  if(!sharp || !buf) return [{name:'full_original',dataUrl,bytes:String(dataUrl||'').length}];
  const base=await sharp(buf,{failOn:'none'}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:84,mozjpeg:true}).toBuffer({resolveWithObject:true});
  const w=base.info.width, h=base.info.height, baseBuf=base.data;
  const pr=pixel?.objectBox && pixel?.resized ? {x:pixel.objectBox.x/Math.max(1,pixel.resized.w), y:pixel.objectBox.y/Math.max(1,pixel.resized.h), w:pixel.objectBox.w/Math.max(1,pixel.resized.w), h:pixel.objectBox.h/Math.max(1,pixel.resized.h)} : {x:.12,y:.04,w:.76,h:.92};
  const clamp=b=>{ const left=Math.max(0,Math.min(w-2,Math.round(b.x*w))), top=Math.max(0,Math.min(h-2,Math.round(b.y*h))); const right=Math.max(left+2,Math.min(w,Math.round((b.x+b.w)*w))), bottom=Math.max(top+2,Math.min(h,Math.round((b.y+b.h)*h))); return {left,top,width:right-left,height:bottom-top}; };
  async function mk(name,b,mode='contrast'){
    const ex=clamp(b); let pipe=sharp(baseBuf,{failOn:'none'}).extract(ex).resize({width:1400,height:850,fit:'inside',withoutEnlargement:false});
    if(mode==='contrast') pipe=pipe.grayscale().normalize().sharpen({sigma:1.05}).linear(1.25,-12);
    else if(mode==='hard') pipe=pipe.grayscale().normalize().sharpen({sigma:1.35}).threshold(154).median(1);
    else if(mode==='color') pipe=pipe.modulate({brightness:1.08,saturation:1.08}).sharpen({sigma:1.0}).normalize();
    else if(mode==='soft') pipe=pipe.grayscale().normalize().sharpen({sigma:.65});
    const out=await pipe.jpeg({quality:80,mozjpeg:true}).toBuffer();
    return {name,mode,dataUrl:'data:image/jpeg;base64,'+out.toString('base64'),bytes:out.length};
  }
  const boxes={
    label_main:{x:pr.x+pr.w*.04,y:pr.y+pr.h*.30,w:pr.w*.92,h:pr.h*.40},
    label_wide:{x:Math.max(0,pr.x-pr.w*.08),y:pr.y+pr.h*.22,w:Math.min(1,pr.w*1.16),h:pr.h*.52},
    label_upper:{x:pr.x+pr.w*.02,y:pr.y+pr.h*.18,w:pr.w*.96,h:pr.h*.36},
    label_lower:{x:pr.x+pr.w*.02,y:pr.y+pr.h*.44,w:pr.w*.96,h:pr.h*.36},
    product_center:{x:pr.x,y:pr.y+pr.h*.04,w:pr.w,h:pr.h*.88},
    full_center:{x:.04,y:.10,w:.92,h:.76}
  };
  const specs=[['label_main_contrast',boxes.label_main,'contrast'],['label_wide_color',boxes.label_wide,'color'],['label_upper_hard',boxes.label_upper,'hard'],['label_lower_contrast',boxes.label_lower,'contrast'],['product_center_soft',boxes.product_center,'soft'],['full_center_color',boxes.full_center,'color']];
  const out=[];
  for(const spec of specs){ try{ const v=await mk(...spec); if(v.bytes<930000) out.push(v); }catch(_){ } }
  if(!out.length) out.push({name:'full_resized',mode:'fallback',dataUrl:'data:image/jpeg;base64,'+baseBuf.toString('base64'),bytes:baseBuf.length});
  return out;
}
function v2867DeleteBrainProduct(key='', opts={}){
  ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; g.products=g.products||{};
  const k=String(key||'').trim(); if(!k) return {ok:false,error:'missing_key'};
  const rec=g.products[k]; if(!rec) return {ok:false,error:'product_not_found'};
  const confirm=String(opts.confirmText||'').trim().toUpperCase();
  if(confirm!=='ELIMINA' && confirm!=='DELETE') return {ok:false,error:'confirm_required',message:'Per eliminare scrivi ELIMINA'};
  const compact=compactGlobalProductRecord(rec);
  db.assistantBrain.deletedProductsV2867=Array.isArray(db.assistantBrain.deletedProductsV2867)?db.assistantBrain.deletedProductsV2867:[];
  db.assistantBrain.deletedProductsV2867.unshift({at:Date.now(),actor:opts.actor||'server_owner',key:k,product:compact,objectFolderId:rec.objectFolder?.folderId||''});
  db.assistantBrain.deletedProductsV2867=db.assistantBrain.deletedProductsV2867.slice(0,200);
  try{ for(const b of v2867List(rec.barcodes,rec.barcode)){ const digits=String(b).replace(/\D/g,''); if(digits && db.assistantBrain.barcodeBrain?.products) delete db.assistantBrain.barcodeBrain.products[digits]; } }catch(_){ }
  delete g.products[k]; g.updatedAt=Date.now(); g.count=Object.keys(g.products||{}).length;
  updateGlobalLearningAudit({type:'v2867-brain-product-deleted',key:k,productName:compact.productName||'',brand:compact.brand||'',actor:opts.actor||'server_owner'});
  return {ok:true,deleted:true,product:compact,stats:{count:Object.keys(g.products||{}).length,updatedAt:g.updatedAt},version:V2867_VERSION};
}
function v2867RenderBrainProduct(key='', opts={}){
  ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; const rec=g.products[String(key||'').trim()];
  if(!rec) return {ok:false,error:'product_not_found'};
  try{ v2842EnsureObjectFolder(rec); v2842ApplyOwnerOverrides(rec); v2840AttachMemoryCard(rec,{}); }catch(_){ }
  const card=rec.memoryCard||v2840BuildMemoryCard(rec,{}); const render=v2867GenerateVirtualRender(card,rec,opts||{}); const reasoning=v2867BuildHumanReasoning(card,rec,{});
  return {ok:true,version:V2867_VERSION,key:rec.key||key,title:rec.productName||card.identity?.productName||'Prodotto',render,reasoning,fields:v2840PublicProductBrainDetail(rec).fields};
}
(function(){
  try{
    if(typeof v2840BuildMemoryCard==='function' && !global.__v2867CardWrapped){
      const prev=v2840BuildMemoryCard;
      v2840BuildMemoryCard=function(record={}, confirmed={}){ const card=prev.call(this,record,confirmed)||{}; return v2867EnhanceCard(card,record,confirmed); };
      global.__v2867CardWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof v2864FieldsFromText==='function' && !global.__v2867FieldsWrapped){
      const prev=v2864FieldsFromText;
      v2864FieldsFromText=function(text='',pixel=null){ return v2867HumanFieldCorrection(prev.call(this,text,pixel)||{}, text, pixel); };
      global.__v2867FieldsWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof v2864ExternalOcr==='function' && !global.__v2867OcrWrapped){
      v2864ExternalOcr=async function(dataUrl='', pixel=null){
        const providers=[]; const candidates=[];
        const variants=await v2867BuildOcrVariants(dataUrl,pixel).catch(()=>[{name:'full_original',dataUrl,bytes:String(dataUrl||'').length}]);
        const max=Math.max(1,Math.min(6,Number(process.env.OCR_SPACE_MAX_CROPS||4)||4));
        for(const v of variants.slice(0,max)){
          const r=await v2864OcrSpace(v.dataUrl).catch(e=>({provider:'ocr_space',ok:false,error:String(e?.message||e).slice(0,120)}));
          if(r){ const q=v2865OcrQuality(r.text||''); providers.push({provider:'ocr_space',variant:v.name,mode:v.mode||'',ok:!!r.ok,chars:String(r.text||'').length,score:q.score,error:r.error||'',bytes:v.bytes||0,engine:'v2867_roi_router'}); if(r.ok && String(r.text||'').trim()) candidates.push({text:r.text,provider:'ocr_space',variant:v.name,mode:v.mode||'',score:q.score,quality:q,bytes:v.bytes||0}); }
          if(candidates.some(c=>c.score>=58 && v2865HasIdentityText(c.text))) break;
        }
        const google=await v2864GoogleVisionOcr(dataUrl).catch(e=>({provider:'google_vision_ocr',ok:false,error:String(e?.message||e).slice(0,120)}));
        if(google){ const q=v2865OcrQuality(google.text||''); providers.push({provider:'google_vision_ocr',ok:!!google.ok,chars:String(google.text||'').length,score:q.score,error:google.error||''}); if(google.ok && String(google.text||'').trim()) candidates.push({text:google.text,provider:'google_vision_ocr',variant:'full',score:q.score,quality:q}); }
        candidates.sort((a,b)=> (v2865HasIdentityText(b.text)?10:0)-(v2865HasIdentityText(a.text)?10:0) || b.score-a.score || String(b.text).length-String(a.text).length);
        const best=candidates[0];
        return {text:(best && (best.score>=20 || v2865HasIdentityText(best.text))) ? best.text : '', providers, best:best?{provider:best.provider,variant:best.variant,mode:best.mode||'',score:best.score,quality:best.quality,bytes:best.bytes||0}:null, rejected:candidates.filter(c=>c!==best).slice(0,6).map(c=>({provider:c.provider,variant:c.variant,score:c.score,chars:String(c.text||'').length})), router:'v2867_detailed_pixel_ocr_router'};
      };
      global.__v2867OcrWrapped=true;
    }
  }catch(e){ try{ updateGlobalLearningAudit({type:'v2867-ocr-router-error',reason:String(e?.message||e).slice(0,180)}); }catch(_){} }
  try{
    if(typeof serverPixelOcrJudgeV2864==='function' && !global.__v2867PixelJudgeWrapped){
      const prev=serverPixelOcrJudgeV2864;
      serverPixelOcrJudgeV2864=async function(args={}){
        const out=await prev.call(this,args||{});
        try{
          if(out?.fields) out.fields=v2867HumanFieldCorrection(out.fields,out.ocr?.text||'',out.pixel||null);
          if(out?.result){ Object.assign(out.result, v2867HumanFieldCorrection(out.result,out.ocr?.text||'',out.pixel||null)); out.result.humanReasoningV2867=v2867BuildHumanReasoning(v2840BuildMemoryCard({productName:out.result.productName,brand:out.result.brand,format:out.result.estimatedSize,category:out.result.category,unit:out.result.unit,colors:out.result.colors||[],detectedText:out.result.detectedText||[],visibleEvidence:out.result.visibleEvidence||[]},{}),{productName:out.result.productName,brand:out.result.brand,format:out.result.estimatedSize,category:out.result.category,unit:out.result.unit,colors:out.result.colors||[],detectedText:out.result.detectedText||[],visibleEvidence:out.result.visibleEvidence||[]},{ocrText:out.ocr?.text||''}); out.result.proHumanReasoningV2867={active:true,source:'server_pixel_ocr_judge',ocrRouter:out.ocr?.best?.provider||'',policy:'vede pixel + legge etichetta + ragiona campi prima della memoria'}; }
          if(out) out.version=V2867_VERSION;
        }catch(_){ }
        return out;
      };
      global.__v2867PixelJudgeWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof upsertGlobalProductMemory==='function' && !global.__v2867UpsertWrapped){
      const prev=upsertGlobalProductMemory;
      upsertGlobalProductMemory=function(confirmed={}){
        if(confirmed && typeof confirmed==='object'){
          confirmed.humanReasoningV2867=confirmed.humanReasoningV2867||{source:'client/server confirmation',policy:'confirmed fields become object memory'};
          if(confirmed.productMemory) confirmed.productMemory.reasoningBusV2867={pixel:true,ocr:true,barcode:true,openFacts:true,owner:true,memory:true,version:V2867_VERSION};
        }
        const out=prev.call(this,confirmed);
        try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(r=>{ v2866SanitizeRecord(r); v2842EnsureObjectFolder(r); const card=v2840AttachMemoryCard(r,{}); r.humanReasoningV2867=card?.humanReasoningV2867||v2867BuildHumanReasoning(card||{},r,{}); r.virtualRenderV2867=card?.virtualRenderV2867||v2867GenerateVirtualRender(card||{},r,{}); }); }catch(_){ }
        return out;
      };
      global.__v2867UpsertWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof publicServerBrainV2840==='function' && !global.__v2867ServerBrainWrapped){
      const prev=publicServerBrainV2840;
      publicServerBrainV2840=function(opts={}){
        try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(r=>{ v2842EnsureObjectFolder(r); v2840AttachMemoryCard(r,{}); r.humanReasoningV2867=r.memoryCard?.humanReasoningV2867; r.virtualRenderV2867=r.memoryCard?.virtualRenderV2867; }); }catch(_){ }
        const out=prev.call(this,opts||{});
        out.version='V28.67 PRO Human Reasoning Bus + Virtual Render';
        out.reasoningBusV2867={active:true,policy:'unico bus dati: pixel/OCR/barcode/OpenFacts/memoria/owner -> scheda finale',ocrRouter:'OCR.space multi-crop quality gate',virtualRender:'shape+colors+label render from learned fields',ownerDelete:true};
        return out;
      };
      global.__v2867ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2867PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.67'; s.brain=Object.assign({},s.brain||{},{version:'V28.67',humanReasoningBus:'active',ocrSpaceRouter:'multi-crop enhanced ROI + quality gate',virtualProductRender:'active in server brain',ownerDelete:'active',engineBridge:'VisionAI + Pixel/OCR + Memory + OpenFacts pass through final truth bus'}); return s; }; global.__v2867PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.67 PRO Human Reasoning Bus + OCR.space Router + Virtual Render + Owner Delete active');
})();

// =============================================================
// V28.68 PRO Realistic Product Render + Human Pixel Understanding
// Obiettivo: il render non deve sembrare un disegnino generico.
// Deve mostrare forma, proporzioni, colori, etichetta e contenuto
// come il server li ha realmente interpretati dalla memoria prodotto.
// =============================================================
const V2868_VERSION = 'V28.68';
function v2868Clean(v='', max=180){ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function v2868Norm(v=''){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); }
function v2868Xml(v=''){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').slice(0,240); }
function v2868List(...vals){
  const out=[]; const push=x=>{ if(x==null) return; if(Array.isArray(x)) return x.forEach(push); if(typeof x==='object') return; String(x).split(/\n|\s*[;,]\s*/).forEach(y=>{ const c=v2868Clean(y,180); if(c) out.push(c); }); };
  vals.forEach(push); return [...new Set(out)].slice(0,160);
}
const v2868PrevRenderSpec = (typeof v2867RenderSpec==='function') ? v2867RenderSpec : null;
const v2868PrevHumanReasoning = (typeof v2867BuildHumanReasoning==='function') ? v2867BuildHumanReasoning : null;
function v2868Color(word='', fallback='#e5e7eb'){
  const n=v2868Norm(word);
  if(/turchese|turquoise|teal|acqua marina|verde acqua/.test(n)) return '#22c7bd';
  if(/celeste|ciano|cyan|azzurro chiaro|sky/.test(n)) return '#7dd3fc';
  if(/blu scuro|navy|blue dark|dark blue/.test(n)) return '#123a86';
  if(/blu|blue|azzurro/.test(n)) return '#2563eb';
  if(/giallo|yellow|oro|gold|limone/.test(n)) return '#facc15';
  if(/rosso|red/.test(n)) return '#ef4444';
  if(/rosa|pink|salmon|salmone/.test(n)) return '#f4a7ad';
  if(/arancio|orange/.test(n)) return '#fb923c';
  if(/verde|green/.test(n)) return '#10b981';
  if(/nero|black|scuro|dark|marrone|brown/.test(n)) return '#161616';
  if(/bianco|white|chiaro|trasparente|clear/.test(n)) return '#f8fafc';
  if(/grigio|grey|gray|silver/.test(n)) return '#94a3b8';
  return fallback;
}
function v2868Evidence(record={}, card={}, extra={}){
  return [record.productName,record.brand,record.format,record.category,record.productType,record.packageType,record.packaging,record.visualSignature,card?.identity?.productName,card?.identity?.brand,card?.identity?.format,card?.classification?.category,card?.visualAppearance?.productType,card?.visualAppearance?.packageType,card?.visualAppearance?.visualSignature,extra.text,extra.ocrText,...v2868List(record.detectedText,record.visibleEvidence,record.evidenceTokens,card?.detectedText,card?.visibleEvidence,card?.evidenceTokens,record.objectFolder?.photos?.flatMap?.(p=>[p.visualSignature,(p.colors||[]).join(' '),(p.detectedText||[]).join(' '),(p.visibleEvidence||[]).join(' ')])||[])].filter(Boolean).join(' ');
}
function v2868BestVisualSample(record={}){
  const f=record.objectFolder||{};
  const samples=[record.visualFeatures,record.memoryCard?.visualFeatures,record.deepVisualMemoryV2861?.sample,record.freeVisualMemoryV2860?.sample];
  (f.visualFeatureSamples||[]).forEach(s=>samples.push(s.features||s.visualFeatures||s));
  const s=samples.find(x=>x&&typeof x==='object')||{};
  const deep=s.visualDeepV2861||s.deepVisualV2861||{};
  const bbox=s.objectBBoxV2861||deep.bbox||{};
  const aspect = Number(bbox.aspect || s.objectAspect || ((s.objectHeight&&s.objectWidth)?Number(s.objectHeight)/Math.max(1,Number(s.objectWidth)):0)) || 0;
  return {raw:s,deep,bbox,aspect,coverage:Number(s.objectCoverage||bbox.area||0)||0};
}
function v2868ProductFamily(ev='', shape=''){
  const n=v2868Norm(ev);
  if(/dexal|candeggina|detersivo|detergente|bucato|laundry|cleaning|ammorbidente|lavatrice/.test(n)) return 'detergent_jug';
  if(/sant\s*anna|santanna|acqua naturale|acqua minerale|water/.test(n)) return 'water_bottle';
  if(/\bcola\b|lemon\s*taste|soft\s*drinks|bibita cola/.test(n)) return 'cola_bottle';
  if(/pesto|salsa|condimento|sugo|spread/.test(n)) return 'jar';
  if(/box|scatola|cartone|cereali|pasta|riso|farina/.test(n)) return 'box';
  if(/busta|sacchetto|pouch|bag/.test(n)) return 'pouch';
  if(/bottle|bottiglia|bevanda|drink|liquido/.test(n) || shape==='bottle') return 'generic_bottle';
  return shape||'package';
}
function v2868DominantPalette(card={}, record={}, family='', ev=''){
  const colors=v2868List(card?.visualAppearance?.colors,record.colors,record.memoryCard?.visualAppearance?.colors,record.objectFolder?.representativePhoto?.colors).slice(0,12);
  let body='#f8fafc', body2='#dbeafe', label='#1d4ed8', label2='#facc15', cap='#facc15', liquid='#161616', liquidOpacity='.88', content='non visibile';
  const n=v2868Norm(ev);
  if(colors.length){ body=v2868Color(colors[0],body); label=v2868Color(colors[1]||colors[0],label); label2=v2868Color(colors[2]||colors[1]||'bianco',label2); cap=v2868Color(colors[3]||colors[2]||colors[1]||'',cap); }
  if(family==='cola_bottle'){
    body='#dbeafe'; body2='#f8fbff'; label='#163b8f'; label2='#facc15'; cap='#f3ca18'; liquid='#15110d'; liquidOpacity='.90'; content='liquido scuro';
    if(/blues/.test(n)){ label='#153b8b'; label2='#f3c51b'; }
  }
  if(family==='water_bottle'){
    body='#e0f2fe'; body2='#f8fbff'; label='#38bdf8'; label2='#ffffff'; cap='#93c5fd'; liquid='#7dd3fc'; liquidOpacity='.28'; content='liquido chiaro';
    if(/sant\s*anna|santanna/.test(n)){ label='#64d6e6'; label2='#ef4444'; cap='#9ed7ff'; }
  }
  if(family==='detergent_jug'){
    body='#22c7bd'; body2='#7dd3fc'; label='#f3a6ad'; label2='#ffffff'; cap='#2563eb'; liquid='#ffffff'; liquidOpacity='.0'; content='non visibile';
  }
  if(family==='jar') { body='#f8fafc'; body2='#ecfccb'; label='#16a34a'; label2='#fde68a'; cap='#14532d'; liquid='#4d7c0f'; liquidOpacity='.55'; content='cremoso/solido'; }
  return {colors,body,body2,label,label2,cap,liquid,liquidOpacity,content};
}
function v2868SplitText(txt='', max=18, lines=2){
  const words=v2868Clean(txt,90).split(/\s+/).filter(Boolean); const out=[''];
  for(const w of words){ const i=out.length-1; if((out[i]+' '+w).trim().length<=max) out[i]=(out[i]+' '+w).trim(); else if(out.length<lines) out.push(w); else out[i]=(out[i]+' '+w).trim(); }
  return out.filter(Boolean).map(x=>x.slice(0,max+8));
}
function v2868RenderSpec(card={}, record={}){
  const base=v2868PrevRenderSpec?v2868PrevRenderSpec(card,record):{};
  const ev=v2868Evidence(record,card);
  const shape=base.shape||((typeof v2867ProductShape==='function')?v2867ProductShape(card,record):'package');
  const family=v2868ProductFamily(ev, shape);
  const palette=v2868DominantPalette(card,record,family,ev);
  const sample=v2868BestVisualSample(record);
  const name=v2868Clean(card?.identity?.productName||record.productName||base.name||'Prodotto',70);
  const brand=v2868Clean(card?.identity?.brand||record.brand||base.brand||'',48);
  const format=v2868Clean(card?.identity?.format||record.format||base.format||'',24);
  const category=v2868Clean(card?.classification?.category||record.category||base.category||'',44);
  const aspect=sample.aspect || (family==='detergent_jug'?1.55:(family.includes('bottle')?3.15:1.75));
  const photoCount=Number(record.objectFolder?.photos?.length||card?.objectFolder?.photoCount||0);
  const hasRealPhoto=!!(record.objectFolder?.representativePhoto?.dataUrl||record.objectFolder?.representativePhoto?.externalUrl||card?.objectFolder?.hasRealProfilePhoto);
  const visualFacts=[];
  if(family.includes('bottle')) visualFacts.push('profilo verticale da bottiglia');
  if(family==='detergent_jug') visualFacts.push('flacone con manico laterale');
  if(palette.content) visualFacts.push('contenuto: '+palette.content);
  if(palette.colors.length) visualFacts.push('palette da memoria: '+palette.colors.slice(0,6).join(', '));
  if(sample.aspect) visualFacts.push('proporzione oggetto: '+Number(sample.aspect).toFixed(2));
  if(hasRealPhoto) visualFacts.push('derivato da foto reale salvata');
  return Object.assign({},base,{version:V2868_VERSION,engine:'realistic_virtual_product_render_v2868',family,shape:family==='generic_bottle'?'bottle':family,bodyColor:palette.body,secondaryBodyColor:palette.body2,labelColor:palette.label,labelAccentColor:palette.label2,capColor:palette.cap,content:palette.content,contentColor:palette.liquid,contentOpacity:palette.liquidOpacity,name,brand,format,category,aspect,photoCount,hasRealPhoto,renderQuality:{level:hasRealPhoto&&photoCount>=2?'alta':hasRealPhoto?'media':'stimata',photoAware:hasRealPhoto,visualSamples:Number(record.objectFolder?.visualFeatureSamples?.length||0),pixelAspect:sample.aspect||null,objectCoverage:sample.coverage||null},visualFacts,source:'server_memory_plus_real_photo_pixel_clues_v2868',colors:palette.colors});
}
function v2868LabelLines(spec={}){
  const brand=v2868Clean(spec.brand||'',28), name=v2868Clean(spec.name||'',56), fmt=v2868Clean(spec.format||'',20);
  let main=brand||name.split(' ')[0]||'Prodotto';
  let second=brand?name.replace(new RegExp('^'+brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\s*','i'),''):name;
  if(spec.family==='cola_bottle'){ main=brand||'Blues'; second=/lemon/i.test(name)?'Cola · Lemon Taste':(name||'Cola'); }
  if(spec.family==='water_bottle'){ main=brand||"Sant'Anna"; second=/acqua/i.test(name)?name:'Acqua naturale'; }
  if(spec.family==='detergent_jug'){ main=brand||'Dexal'; second=name.replace(new RegExp('^'+(brand||'Dexal').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\s*','i'),'')||'Candeggina delicata'; }
  const small=v2868SplitText(second,22,2);
  return {main:v2868Clean(main,24),small,format:fmt};
}
function v2868BottleSvg(spec={}){
  const l=v2868LabelLines(spec); const water=spec.family==='water_bottle'; const cola=spec.family==='cola_bottle';
  const labelY=cola?455:430, labelH=cola?170:150;
  const ridges=water?`<g opacity=".35" stroke="#7aa9c7" stroke-width="5" fill="none"><path d="M250 250 Q360 228 470 250"/><path d="M235 330 Q360 305 485 330"/><path d="M228 660 Q360 690 492 660"/><path d="M235 735 Q360 765 485 735"/></g>`:'';
  const lemon=cola?`<circle cx="506" cy="503" r="28" fill="#facc15" opacity=".95"/><circle cx="520" cy="488" r="10" fill="#fff7ad" opacity=".8"/><path d="M520 486 L542 472" stroke="#123a86" stroke-width="5" stroke-linecap="round"/>`:'';
  const brandCapsule=cola?`<rect x="306" y="468" width="108" height="38" rx="19" fill="#e7f2ff" opacity=".92"/><text x="360" y="493" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="23" font-weight="900" fill="#24539d">${v2868Xml(l.main)}</text>`:`<text x="360" y="480" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="40" font-weight="1000" fill="#ffffff">${v2868Xml(l.main)}</text>`;
  const labelText=cola?`<text x="360" y="565" text-anchor="middle" font-family="Georgia,serif" font-size="92" font-style="italic" font-weight="900" fill="#ffffff" stroke="#08245a" stroke-width="2">Cola</text><text x="360" y="617" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="23" font-weight="1000" fill="#071b3b">${v2868Xml(l.small.join(' ').replace(/^cola\s*/i,'')||'LEMON TASTE')}</text>`:`${l.small.map((x,i)=>`<text x="360" y="${530+i*34}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${i?28:34}" font-weight="1000" fill="#07345d">${v2868Xml(x)}</text>`).join('')}<text x="360" y="615" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="900" fill="#07345d">${v2868Xml(l.format)}</text>`;
  return `<g filter="url(#shadow)">
    <rect x="315" y="78" width="90" height="88" rx="18" fill="url(#capGrad)"/><g opacity=".28" stroke="#8a6d00" stroke-width="3">${[330,345,360,375,390].map(x=>`<path d="M${x} 86 L${x} 158"/>`).join('')}</g>
    <path id="bottleBody" d="M296 150 Q298 215 266 265 Q228 326 224 420 L224 760 Q224 841 286 866 Q322 881 360 881 Q398 881 434 866 Q496 841 496 760 L496 420 Q492 326 454 265 Q422 215 424 150 Z" fill="url(#glassGrad)" stroke="#6f99b8" stroke-opacity=".38" stroke-width="8"/>
    <clipPath id="bodyClip"><path d="M296 150 Q298 215 266 265 Q228 326 224 420 L224 760 Q224 841 286 866 Q322 881 360 881 Q398 881 434 866 Q496 841 496 760 L496 420 Q492 326 454 265 Q422 215 424 150 Z"/></clipPath>
    <g clip-path="url(#bodyClip)"><rect x="220" y="${water?420:310}" width="280" height="555" fill="${spec.contentColor}" opacity="${spec.contentOpacity||'.7'}"/><path d="M220 ${water?430:320} Q360 ${water?408:296} 500 ${water?430:320}" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="14"/></g>
    ${ridges}
    <path d="M285 167 Q360 189 435 167" fill="none" stroke="#ffffff" stroke-opacity=".65" stroke-width="10"/>
    <path d="M265 245 Q305 218 326 166" fill="none" stroke="#ffffff" stroke-opacity=".42" stroke-width="9" stroke-linecap="round"/>
    <g transform="translate(0,0)"><path d="M232 ${labelY} Q360 ${labelY-38} 488 ${labelY} L488 ${labelY+labelH} Q360 ${labelY+labelH+40} 232 ${labelY+labelH} Z" fill="${spec.labelColor}"/><path d="M232 ${labelY} Q360 ${labelY-38} 488 ${labelY} L488 ${labelY+46} Q360 ${labelY+12} 232 ${labelY+46} Z" fill="${spec.labelAccentColor}" opacity=".96"/><path d="M232 ${labelY+labelH-48} Q360 ${labelY+labelH-12} 488 ${labelY+labelH-48} L488 ${labelY+labelH} Q360 ${labelY+labelH+40} 232 ${labelY+labelH} Z" fill="${spec.labelAccentColor}" opacity=".96"/>${brandCapsule}${labelText}${lemon}<path d="M238 ${labelY+10} Q360 ${labelY-24} 482 ${labelY+10}" fill="none" stroke="#ffffff" stroke-opacity=".40" stroke-width="7"/></g>
    <ellipse cx="360" cy="886" rx="118" ry="22" fill="#08203e" opacity=".12"/>
  </g>`;
}
function v2868DetergentSvg(spec={}){
  const l=v2868LabelLines(spec);
  const textLines=v2868SplitText(l.small.join(' '),21,3);
  return `<g filter="url(#shadow)">
    <rect x="294" y="72" width="132" height="78" rx="20" fill="url(#capGrad)"/><g opacity=".24" stroke="#07235c" stroke-width="4">${[310,330,350,370,390,410].map(x=>`<path d="M${x} 82 L${x} 140"/>`).join('')}</g>
    <path fill-rule="evenodd" d="M230 160 Q232 112 280 112 L474 126 Q544 135 558 220 L600 746 Q608 838 516 867 L213 867 Q125 844 137 748 L176 285 Q182 202 230 160 Z M458 214 Q536 220 538 307 Q541 393 466 430 Q432 447 412 416 Q485 381 483 311 Q482 251 444 248 Z" fill="url(#jugGrad)" stroke="#0f766e" stroke-opacity=".28" stroke-width="9"/>
    <path d="M458 214 Q536 220 538 307 Q541 393 466 430 Q432 447 412 416 Q485 381 483 311 Q482 251 444 248 Z" fill="#f7fbff" opacity=".88"/>
    <path d="M192 215 Q250 185 342 187" stroke="#ffffff" stroke-opacity=".48" stroke-width="13" fill="none" stroke-linecap="round"/>
    <path d="M188 452 L535 430 L512 635 Q386 696 184 650 Z" fill="${spec.labelColor}" rx="30"/>
    <path d="M188 452 L535 430 L502 506 Q381 548 184 530 Z" fill="${spec.labelAccentColor}" opacity=".86"/>
    <path d="M440 430 L535 430 L516 633 L465 654 Q492 558 440 430 Z" fill="#ef4444" opacity=".95"/>
    <text x="360" y="505" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="54" font-weight="1000" fill="#ffffff" stroke="#b91c1c" stroke-width="1.6">${v2868Xml(l.main)}</text>
    ${textLines.map((x,i)=>`<text x="360" y="${565+i*33}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${i?25:28}" font-weight="1000" fill="#072044">${v2868Xml(x)}</text>`).join('')}
    <text x="360" y="668" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="1000" fill="#061b32">${v2868Xml(l.format)}</text>
    <path d="M180 770 Q330 835 535 770" fill="none" stroke="#0f766e" stroke-opacity=".22" stroke-width="10"/>
    <ellipse cx="360" cy="888" rx="178" ry="25" fill="#08203e" opacity=".12"/>
  </g>`;
}
function v2868GenericSvg(spec={}){
  const l=v2868LabelLines(spec);
  return `<g filter="url(#shadow)"><rect x="210" y="170" width="300" height="600" rx="42" fill="url(#boxGrad)" stroke="#0f3760" stroke-opacity=".18" stroke-width="8"/><rect x="240" y="350" width="240" height="190" rx="30" fill="${spec.labelColor}"/><path d="M240 350 L480 350 L438 540 L240 540 Z" fill="${spec.labelAccentColor}" opacity=".7"/><text x="360" y="425" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="1000" fill="#ffffff">${v2868Xml(l.main)}</text>${l.small.map((x,i)=>`<text x="360" y="${475+i*34}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="26" font-weight="900" fill="#08203e">${v2868Xml(x)}</text>`).join('')}<text x="360" y="582" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="1000" fill="#08203e">${v2868Xml(l.format)}</text><ellipse cx="360" cy="796" rx="150" ry="24" fill="#08203e" opacity=".12"/></g>`;
}
function v2868VirtualSvg(spec={}, opts={}){
  const bg=String(opts.background||'transparent').toLowerCase();
  const bgRect=bg==='white'?`<rect width="720" height="960" rx="42" fill="#ffffff"/>`:`<rect width="720" height="960" rx="42" fill="rgba(255,255,255,0)"/>`;
  const swatches=[spec.bodyColor,spec.labelColor,spec.labelAccentColor,spec.capColor,spec.contentColor].filter(Boolean).slice(0,5).map((c,i)=>`<circle cx="${70+i*34}" cy="88" r="13" fill="${c}" stroke="#ffffff" stroke-width="4"/>`).join('');
  const obj=spec.family==='detergent_jug'?v2868DetergentSvg(spec):(spec.family==='cola_bottle'||spec.family==='water_bottle'||spec.family==='generic_bottle'||spec.shape==='bottle'?v2868BottleSvg(spec):v2868GenericSvg(spec));
  const facts=(spec.visualFacts||[]).slice(0,3).map((x,i)=>`<text x="360" y="${905+i*22}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="800" fill="#64748b">${v2868Xml(x)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">${bgRect}<defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#0f172a" flood-opacity=".24"/></filter>
    <linearGradient id="glassGrad" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ffffff" stop-opacity=".78"/><stop offset=".45" stop-color="${spec.bodyColor}" stop-opacity=".52"/><stop offset="1" stop-color="#cbd5e1" stop-opacity=".78"/></linearGradient>
    <linearGradient id="capGrad" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#fff7ad"/><stop offset="1" stop-color="${spec.capColor}"/></linearGradient>
    <linearGradient id="jugGrad" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${spec.secondaryBodyColor}"/><stop offset=".38" stop-color="${spec.bodyColor}"/><stop offset="1" stop-color="#0faaa3"/></linearGradient>
    <linearGradient id="boxGrad" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${spec.secondaryBodyColor}"/><stop offset="1" stop-color="${spec.bodyColor}"/></linearGradient>
  </defs><rect x="28" y="24" width="664" height="912" rx="48" fill="#f8fbff" opacity="${bg==='white'?'.55':'.78'}"/>${swatches}<text x="360" y="74" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="1000" fill="#0f2745">Render V28.68 · interpretazione visiva</text>${obj}<text x="360" y="872" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="1000" fill="#0f2745">${v2868Xml(spec.family)} · qualità ${v2868Xml(spec.renderQuality?.level||'stimata')}</text>${facts}</svg>`;
}
function v2868GenerateVirtualRender(card={}, record={}, opts={}){
  const spec=v2868RenderSpec(card,record);
  const svg=v2868VirtualSvg(spec,opts||{});
  return {version:V2868_VERSION,background:String(opts.background||'transparent'),spec,svgDataUri:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),svg,upgrade:'render realistico con silhouette, palette, contenuto, etichetta e prove pixel/foto'};
}
function v2868BuildHumanReasoning(card={}, record={}, confirmed={}){
  const prev=v2868PrevHumanReasoning?v2868PrevHumanReasoning(card,record,confirmed):{};
  const spec=v2868RenderSpec(card,record);
  const proof=v2868List(prev.identityEvidence,spec.visualFacts,record.detectedText,record.visibleEvidence).slice(0,50);
  const rules=v2868List(prev.decisionRules,[
    'prima vedo silhouette, contenuto e colori; poi leggo etichetta/barcode; solo dopo uso memoria',
    'il render deve mostrare esattamente cosa il server crede di aver capito',
    'foto reale e valori titolare correggono il modello visivo futuro'
  ]).slice(0,20);
  return Object.assign({},prev,{version:V2868_VERSION,renderUnderstanding:{family:spec.family,shape:spec.shape,content:spec.content,colors:[spec.bodyColor,spec.labelColor,spec.labelAccentColor,spec.capColor],quality:spec.renderQuality,visualFacts:spec.visualFacts},identityEvidence:proof,decisionRules:rules,engines:Object.assign({},prev.engines||{},{render:'V28.68 realistic SVG render from learned photo/pixel/OCR fields',pixelJudge:'V28.68 shape+content+palette reasoning bus'})});
}
function v2868RenderBrainProduct(key='', opts={}){
  ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; const rec=g.products[String(key||'').trim()];
  if(!rec) return {ok:false,error:'product_not_found'};
  try{ v2842EnsureObjectFolder(rec); v2842ApplyOwnerOverrides(rec); v2840AttachMemoryCard(rec,{}); }catch(_){ }
  const card=rec.memoryCard||v2840BuildMemoryCard(rec,{}); const render=v2868GenerateVirtualRender(card,rec,opts||{}); const reasoning=v2868BuildHumanReasoning(card,rec,{});
  try{ rec.virtualRenderV2868=render; rec.humanReasoningV2868=reasoning; if(rec.memoryCard){ rec.memoryCard.virtualRenderV2868=render; rec.memoryCard.humanReasoningV2868=reasoning; rec.memoryCard.virtualRenderV2867=render; rec.memoryCard.humanReasoningV2867=reasoning; } }catch(_){ }
  return {ok:true,version:V2868_VERSION,key:rec.key||key,title:rec.productName||card.identity?.productName||'Prodotto',render,reasoning,fields:v2840PublicProductBrainDetail(rec).fields};
}
(function(){
  try{ v2867RenderSpec=v2868RenderSpec; v2867VirtualSvg=v2868VirtualSvg; v2867GenerateVirtualRender=v2868GenerateVirtualRender; v2867BuildHumanReasoning=v2868BuildHumanReasoning; v2867RenderBrainProduct=v2868RenderBrainProduct; }catch(_){ }
  try{
    if(typeof v2840BuildMemoryCard==='function' && !global.__v2868CardWrapped){
      const prev=v2840BuildMemoryCard;
      v2840BuildMemoryCard=function(record={}, confirmed={}){ const card=prev.call(this,record,confirmed)||{}; try{ card.humanReasoningV2868=v2868BuildHumanReasoning(card,record,confirmed); card.virtualRenderV2868=v2868GenerateVirtualRender(card,record,{background:'transparent'}); card.humanReasoningV2867=card.humanReasoningV2868; card.virtualRenderV2867=card.virtualRenderV2868; }catch(_){} return card; };
      global.__v2868CardWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof publicServerBrainV2840==='function' && !global.__v2868ServerBrainWrapped){
      const prev=publicServerBrainV2840;
      publicServerBrainV2840=function(opts={}){ try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(r=>{ v2842EnsureObjectFolder(r); const card=v2840AttachMemoryCard(r,{}); if(card){ r.humanReasoningV2868=card.humanReasoningV2868; r.virtualRenderV2868=card.virtualRenderV2868; r.humanReasoningV2867=card.humanReasoningV2868; r.virtualRenderV2867=card.virtualRenderV2868; } }); }catch(_){} const out=prev.call(this,opts||{}); out.version='V28.68 PRO Realistic Human Visual Render'; out.reasoningBusV2868={active:true,policy:'render realistico = forma + contenuto + palette + etichetta + prove foto reali',renderEngine:'V28.68 realistic SVG product twin',humanUnderstanding:'server mostra cosa crede di vedere, così il titolare può correggere'}; return out; };
      global.__v2868ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2868PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this); s.version='V28.68'; s.brain=Object.assign({},s.brain||{},{version:'V28.68',realisticVirtualRender:'active',humanPixelUnderstanding:'shape+content+label+palette',renderTwin:'active in server brain',ocrSpaceRouter:'V28.67+ enhanced remains active'}); return s; }; global.__v2868PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.68 PRO Realistic Product Render + Human Pixel Understanding active');
})();


// V28.69 PRO Clean Diagnostics Console + True Error Separation
const V2869_VERSION = 'V28.69';
function v2869CleanText(v=''){
  return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();
}
function v2869NormValue(v=''){
  try{ return normalizeText(v2869CleanText(v)).replace(/\s+/g,' ').trim(); }
  catch(_){ return v2869CleanText(v).toLowerCase().replace(/\s+/g,' ').trim(); }
}
function v2869CorrectionChanged(info={}){
  if(!info || !info.edited) return false;
  return v2869NormValue(info.from||'') !== v2869NormValue(info.to||'');
}
function v2869CleanCorrectionEntry(entry={}){
  const clean=Object.assign({}, entry||{}, {corrections:{}});
  for(const [k,info] of Object.entries(entry?.corrections||{})){
    if(v2869CorrectionChanged(info)) clean.corrections[k]=info;
  }
  return Object.keys(clean.corrections||{}).length ? clean : null;
}
function v2869IsRealServerError(event={}){
  const type=v2869CleanText(event.type||'').toLowerCase();
  const reason=v2869CleanText(event.reason||event.message||event.error||'').toLowerCase();
  const blob=(type+' '+reason).trim();
  if(!blob) return false;
  if(type==='user-correction') return false;
  if(/correction|confirmed|learned|saved|useful|updated|merged|deleted|match$|matched|recognition|photo-updated/.test(type)) return false;
  if(/blocked|rejected|reject|guard|conflict/.test(type)) return false;
  return /(error|failed|failure|exception|timeout|invalid|unauthorized|not_authorized|server_not_reachable|payload_invalid|sync_fail|fetch-failed|fetch-error)/i.test(blob);
}
function v2869IsGuardEvent(event={}){
  const type=v2869CleanText(event.type||'').toLowerCase();
  const reason=v2869CleanText(event.reason||'').toLowerCase();
  return /blocked|rejected|reject|guard|conflict/.test(type+' '+reason) && !v2869IsRealServerError(event);
}
function v2869DecorateBrainConsole(out={}){
  ensureDbShape();
  const audit=Array.isArray(db.assistantBrain.learningAudit)?db.assistantBrain.learningAudit:[];
  const corrections=(db.assistantBrain.errorLearning?.corrections||[]).map(v2869CleanCorrectionEntry).filter(Boolean).slice(0,220);
  const realErrors=audit.filter(v2869IsRealServerError).slice(0,160);
  const guardEvents=audit.filter(v2869IsGuardEvent).slice(0,120);
  const learningEvents=audit.filter(e=>!v2869IsRealServerError(e)).slice(0,160);
  out.version='V28.69 PRO Clean Diagnostics Console';
  out.errors=realErrors;
  out.serverErrors=realErrors;
  out.corrections=corrections;
  out.learningCorrections=corrections;
  out.guardEvents=guardEvents;
  out.learningEvents=learningEvents;
  out.diagnosticCountsV2869={
    realErrors:realErrors.length,
    corrections:corrections.length,
    guardEvents:guardEvents.length,
    learningEvents:learningEvents.length,
    note:'Le correzioni utente e le guardie anti-falso positivo non sono più contate come errori.'
  };
  out.consolePolicyV2869={
    realErrors:'Solo fallimenti veri: error, failed, timeout, invalid, unauthorized, sync fail.',
    corrections:'Modifiche utente/titolare che insegnano al cervello; non sono errori.',
    guardEvents:'Blocchi corretti del cervello quando evita match o categorie pericolose; non sono errori.'
  };
  return out;
}
try{
  if(typeof publicServerBrainV2840==='function' && !global.__v2869BrainConsoleWrapped){
    const prevPublicServerBrainV2840 = publicServerBrainV2840;
    publicServerBrainV2840 = function(opts={}){
      const out = prevPublicServerBrainV2840.call(this, opts||{}) || {};
      return v2869DecorateBrainConsole(out);
    };
    global.__v2869BrainConsoleWrapped=true;
  }
}catch(_){ }
try{
  if(typeof recordUserCorrectionLearning==='function' && !global.__v2869CorrectionLearningWrapped){
    const prevRecordUserCorrectionLearning = recordUserCorrectionLearning;
    recordUserCorrectionLearning = function(confirmed={}){
      const corrections=confirmed.userCorrections||{};
      const filtered={};
      for(const [k,info] of Object.entries(corrections||{})){
        if(v2869CorrectionChanged(info)) filtered[k]=info;
      }
      if(!Object.keys(filtered).length) return;
      return prevRecordUserCorrectionLearning.call(this, Object.assign({}, confirmed, {userCorrections:filtered}));
    };
    global.__v2869CorrectionLearningWrapped=true;
  }
}catch(_){ }
try{
  const prevPreflightV2869 = (typeof preflightSnapshotV98==='function') ? preflightSnapshotV98 : null;
  if(prevPreflightV2869 && !global.__v2869PreflightWrapped){
    preflightSnapshotV98=function(){
      const s=prevPreflightV2869.call(this)||{};
      s.version='V28.69';
      s.brain=Object.assign({},s.brain||{},{version:'V28.69',cleanDiagnosticsConsole:'active',correctionsAreLearningNotErrors:true});
      return s;
    };
    global.__v2869PreflightWrapped=true;
  }
}catch(_){ }
console.log('[Spesa Pronta] V28.69 PRO Clean Diagnostics Console active');

// =============================================================
// V28.70 PRO MASTER Human Visual Twin
// Obiettivo: rendere il gemello virtuale molto piu' vicino a cio' che
// un umano vede: silhouette precisa, proporzioni, tappo, etichetta,
// colori, contenuto e indizi visivi derivati dalle foto reali salvate.
// =============================================================
const V2870_VERSION = 'V28.70';

const v2870PrevRenderSpec = (typeof v2868RenderSpec==='function') ? v2868RenderSpec : null;
const v2870PrevBuildHumanReasoning = (typeof v2868BuildHumanReasoning==='function') ? v2868BuildHumanReasoning : null;
function v2870Safe(v='', max=220){
  try{ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
  catch(_){ return ''; }
}
function v2870Norm(v=''){
  return v2870Safe(v,400).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’'`]/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
}
function v2870Xml(v='', max=260){
  return v2870Safe(v,max).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function v2870Arr(v, n=80){
  const out=[]; const push=x=>{ if(x==null) return; if(Array.isArray(x)) return x.forEach(push); if(typeof x==='object') return; String(x).split(/\n|\s*[;,]\s*/).forEach(y=>{ const c=v2870Safe(y,180); if(c) out.push(c); }); };
  push(v); return [...new Set(out)].slice(0,n);
}
function v2870First(...vals){ for(const v of vals){ const s=v2870Safe(v,120); if(s) return s; } return ''; }
function v2870IsLight(hex=''){
  const h=String(hex||'').replace('#',''); if(!/^[0-9a-f]{6}$/i.test(h)) return false;
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return (r*299+g*587+b*114)/1000 > 170;
}
function v2870TextColor(hex=''){ return v2870IsLight(hex)?'#08203e':'#ffffff'; }
function v2870MaybeColor(word='', fallback='#e5e7eb'){
  try{ return typeof v2868Color==='function' ? v2868Color(word,fallback) : fallback; }
  catch(_){ return fallback; }
}
function v2870Evidence(record={}, card={}){
  try{ if(typeof v2868Evidence==='function') return v2868Evidence(record,card); }catch(_){ }
  return [record.productName,record.brand,record.format,record.category,record.packageType,record.visualSignature,card?.identity?.productName,card?.identity?.brand].filter(Boolean).join(' ');
}
function v2870ColorList(record={}, card={}){
  const photos = record.objectFolder?.photos || [];
  const raw = [
    card?.visualAppearance?.colors, record.colors, record.memoryCard?.visualAppearance?.colors,
    record.objectFolder?.representativePhoto?.colors,
    ...photos.map(p=>p.colors), ...photos.map(p=>p.palette), record.visualFeatures?.colors,
    record.freeVisualMemoryV2860?.sample?.colors, record.deepVisualMemoryV2861?.sample?.colors
  ];
  const colors=[];
  raw.forEach(x=>v2870Arr(x,20).forEach(y=>colors.push(y)));
  return [...new Set(colors)].slice(0,18);
}
function v2870Family(ev='', baseFamily='', shape=''){
  const n=v2870Norm(ev+' '+baseFamily+' '+shape);
  if(/dexal|candeggina|detersivo|detergente|laundry|cleaning|bucato|flacone|detergent/.test(n)) return 'detergent_jug_master';
  if(/cola|lemon taste|soft drinks|bibita cola|blues/.test(n)) return 'cola_bottle_master';
  if(/sant anna|santanna|acqua minerale|acqua naturale|water bottle/.test(n)) return 'water_bottle_master';
  if(/pesto|salsa|sugo|condiment|barattolo|vaso|jar/.test(n)) return 'jar_master';
  if(/scatola|box|cartone|pasta|riso|cereali/.test(n)) return 'box_master';
  if(/busta|sacchetto|pouch|bag/.test(n)) return 'pouch_master';
  if(/bottle|bottiglia|liquido|bevanda|drink/.test(n)) return 'bottle_master';
  return 'package_master';
}
function v2870Palette(spec={}, record={}, card={}, family=''){
  const ev=v2870Evidence(record,card);
  const colors=v2870ColorList(record,card);
  let body=spec.bodyColor||'#f8fafc', body2=spec.secondaryBodyColor||'#dbeafe', label=spec.labelColor||'#1d4ed8', label2=spec.labelAccentColor||'#facc15', label3='#ffffff', cap=spec.capColor||'#facc15', content=spec.content||'non visibile', contentColor=spec.contentColor||'#161616', contentOpacity=spec.contentOpacity||'.7';
  if(colors.length){
    body=v2870MaybeColor(colors[0],body); label=v2870MaybeColor(colors[1]||colors[0],label); label2=v2870MaybeColor(colors[2]||colors[1]||'',label2); cap=v2870MaybeColor(colors[3]||colors[2]||colors[1]||'',cap);
  }
  const n=v2870Norm(ev+' '+colors.join(' '));
  if(family==='cola_bottle_master'){
    body='#e9f4ff'; body2='#bcd7ef'; label='#123a86'; label2='#f4ca16'; label3='#fff4a3'; cap='#f2c51a'; content='liquido scuro'; contentColor='#130f0c'; contentOpacity='.92';
    if(/blu scuro|navy/.test(n)) label='#0f347d';
  } else if(family==='water_bottle_master'){
    body='#edf8ff'; body2='#bee6ff'; label='#42cddd'; label2='#ef4444'; label3='#ffffff'; cap='#9ddcff'; content='liquido chiaro'; contentColor='#a7e7ff'; contentOpacity='.24';
  } else if(family==='detergent_jug_master'){
    body='#21c7bd'; body2='#73efe6'; label='#f4a7ad'; label2='#f8fafc'; label3='#ef4444'; cap='#2563eb'; content='non visibile'; contentColor='#ffffff'; contentOpacity='0';
    if(/turchese|verde acqua|teal/.test(n)) body='#20c6bc';
  } else if(family==='jar_master'){
    body='#f8fafc'; body2='#ecfccb'; label='#16a34a'; label2='#fde68a'; label3='#ffffff'; cap='#14532d'; content='cremoso/solido'; contentColor='#4d7c0f'; contentOpacity='.55';
  }
  return {colors,body,body2,label,label2,label3,cap,content,contentColor,contentOpacity};
}
function v2870LabelModel(spec={}, record={}, card={}){
  const name=v2870First(card?.identity?.productName,record.productName,spec.name,'Prodotto');
  const brand=v2870First(card?.identity?.brand,record.brand,spec.brand,'');
  const fmt=v2870First(card?.identity?.format,record.format,spec.format,'');
  const family=spec.family||'';
  let main=brand||name.split(/\s+/)[0]||'Prodotto', hero=name, subtitle='', micro='';
  if(family==='cola_bottle_master'){
    main=brand || (/blues/i.test(name)?'Blues':'');
    hero='Cola'; subtitle=/lemon/i.test(name)?'Lemon Taste':v2870Safe(name.replace(/cola/ig,'').replace(/[-–]/g,' '),32)||'Bibita cola'; micro='gusto limone';
  } else if(family==='water_bottle_master'){
    main=brand || (/sant/i.test(name)?"Sant'Anna":''); hero=/acqua/i.test(name)?'Acqua':'Acqua'; subtitle=/naturale/i.test(name)?'Naturale':'Acqua minerale'; micro=brand||"Sant'Anna";
  } else if(family==='detergent_jug_master'){
    main=brand||'Dexal'; hero=v2870Safe(name.replace(new RegExp('^'+(main||'Dexal').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*','i'),'').replace(/maxi/ig,'').trim(),44)||'Candeggina delicata'; subtitle=/maxi/i.test(name)?'MAXI':'pulizia casa'; micro=/color/i.test(v2870Evidence(record,card))?'colori sicuri':'';
  } else {
    hero=name; subtitle=brand; micro='';
  }
  return {brand:v2870Safe(main,28), hero:v2870Safe(hero,46), subtitle:v2870Safe(subtitle,38), micro:v2870Safe(micro,32), format:v2870Safe(fmt,22)};
}
function v2870RenderSpec(card={}, record={}){
  const prev=v2870PrevRenderSpec ? v2870PrevRenderSpec(card,record) : {};
  const ev=v2870Evidence(record,card);
  const family=v2870Family(ev, prev.family, prev.shape);
  const palette=v2870Palette(prev,record,card,family);
  const sample=(typeof v2868BestVisualSample==='function') ? v2868BestVisualSample(record) : {};
  const photoCount=Number(record.objectFolder?.photos?.length||card?.objectFolder?.photoCount||prev.photoCount||0);
  const hasRealPhoto=!!(record.objectFolder?.representativePhoto?.dataUrl||record.objectFolder?.representativePhoto?.externalUrl||card?.objectFolder?.hasRealProfilePhoto||prev.hasRealPhoto);
  const label=v2870LabelModel(Object.assign({},prev,{family}),record,card);
  const facts=[];
  if(family.includes('bottle')) facts.push('silhouette: bottiglia verticale con spalle/collo');
  if(family==='detergent_jug_master') facts.push('silhouette: flacone/tanica con manico laterale');
  if(palette.content) facts.push('contenuto visibile: '+palette.content);
  if(hasRealPhoto) facts.push('render guidato da foto reale salvata');
  if(photoCount) facts.push(photoCount+' foto reali/campioni nel cervello');
  if(palette.colors.length) facts.push('palette appresa: '+palette.colors.slice(0,6).join(', '));
  const aspect = Number(prev.aspect||sample.aspect||0) || (family==='detergent_jug_master'?1.58:(family.includes('bottle')?3.20:1.7));
  return Object.assign({},prev,{version:V2870_VERSION,engine:'pro_master_human_visual_twin_v2870',family,shape:family.replace(/_master$/,''),bodyColor:palette.body,secondaryBodyColor:palette.body2,labelColor:palette.label,labelAccentColor:palette.label2,labelThirdColor:palette.label3,capColor:palette.cap,content:palette.content,contentColor:palette.contentColor,contentOpacity:palette.contentOpacity,labelModel:label,name:v2870First(card?.identity?.productName,record.productName,prev.name),brand:v2870First(card?.identity?.brand,record.brand,prev.brand),format:v2870First(card?.identity?.format,record.format,prev.format),category:v2870First(card?.classification?.category,record.category,prev.category),aspect,photoCount,hasRealPhoto,colors:palette.colors,visualFacts:facts,renderQuality:{level:hasRealPhoto&&photoCount>=3?'pro-master':hasRealPhoto?'alta':'stimata',photoAware:hasRealPhoto,visualSamples:Number(record.objectFolder?.visualFeatureSamples?.length||prev.renderQuality?.visualSamples||0),pixelAspect:sample.aspect||prev.renderQuality?.pixelAspect||null,objectCoverage:sample.coverage||prev.renderQuality?.objectCoverage||null,humanLike:'silhouette + label + content + color layers'}});
}
function v2870SVGDefs(spec={}){
  return `<defs>
    <filter id="v2870Shadow" x="-30%" y="-30%" width="170%" height="170%"><feDropShadow dx="0" dy="28" stdDeviation="24" flood-color="#0f172a" flood-opacity=".26"/></filter>
    <filter id="v2870Soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <linearGradient id="v2870Glass" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ffffff" stop-opacity=".88"/><stop offset=".36" stop-color="${spec.bodyColor}" stop-opacity=".55"/><stop offset=".70" stop-color="${spec.secondaryBodyColor}" stop-opacity=".35"/><stop offset="1" stop-color="#d7e6f5" stop-opacity=".88"/></linearGradient>
    <linearGradient id="v2870Cap" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#fff6a6"/><stop offset=".52" stop-color="${spec.capColor}"/><stop offset="1" stop-color="#b88600"/></linearGradient>
    <linearGradient id="v2870Jug" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${spec.secondaryBodyColor}"/><stop offset=".44" stop-color="${spec.bodyColor}"/><stop offset="1" stop-color="#069e98"/></linearGradient>
    <linearGradient id="v2870Label" x1="0" x2="1"><stop stop-color="${spec.labelColor}"/><stop offset=".55" stop-color="${spec.labelColor}"/><stop offset="1" stop-color="${spec.labelAccentColor}"/></linearGradient>
    <radialGradient id="v2870Gloss" cx="30%" cy="18%" r="70%"><stop stop-color="#ffffff" stop-opacity=".66"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>`;
}
function v2870Swatches(spec={}){
  return [spec.bodyColor,spec.labelColor,spec.labelAccentColor,spec.labelThirdColor,spec.capColor,spec.contentColor].filter(Boolean).slice(0,6).map((c,i)=>`<circle cx="${80+i*38}" cy="92" r="13" fill="${c}" stroke="#fff" stroke-width="4"/><circle cx="${80+i*38}" cy="92" r="15" fill="none" stroke="#0f2745" stroke-opacity=".08"/>`).join('');
}
function v2870MasterBottleSvg(spec={}){
  const l=spec.labelModel||{}; const family=spec.family||''; const cola=family==='cola_bottle_master'; const water=family==='water_bottle_master';
  const labelFill = cola?'#123a86':(water?spec.labelColor:spec.labelColor);
  const band = spec.labelAccentColor||'#facc15';
  const textColor = cola?'#ffffff':v2870TextColor(labelFill);
  const waterRidges = water ? `<g opacity=".42" stroke="#6aa7cc" stroke-width="5" fill="none"><path d="M270 278 Q450 246 630 278"/><path d="M248 360 Q450 324 652 360"/><path d="M240 690 Q450 728 660 690"/><path d="M253 798 Q450 835 647 798"/></g>` : '';
  const bubbles = cola ? `<g opacity=".28" fill="#fff8c7">${[315,372,515,590,640].map((x,i)=>`<circle cx="${x}" cy="${330+i*74}" r="${4+(i%3)*2}"/>`).join('')}</g>` : '';
  const lemon = cola ? `<g transform="translate(690 564)"><circle r="40" fill="#facc15"/><circle r="28" fill="none" stroke="#fff8b5" stroke-width="4" opacity=".65"/><path d="M-22 0 H22 M0 -22 V22" stroke="#eab308" stroke-width="3" opacity=".55"/><path d="M18 -20 L52 -42" stroke="#123a86" stroke-width="7" stroke-linecap="round"/></g>` : '';
  const colaLabelText = cola ? `<text x="450" y="610" text-anchor="middle" font-family="Georgia,serif" font-size="132" font-style="italic" font-weight="900" fill="#fff" stroke="#061d52" stroke-width="3">Cola</text><text x="450" y="672" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="1000" fill="#071b3b">${v2870Xml(l.subtitle||'LEMON TASTE')}</text><text x="450" y="708" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="900" fill="#071b3b" opacity=".78">${v2870Xml(l.micro||'')}</text>` : `<text x="450" y="555" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="1000" fill="${textColor}">${v2870Xml(l.brand||l.hero)}</text><text x="450" y="612" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="950" fill="${textColor}" opacity=".96">${v2870Xml(l.hero)}</text><text x="450" y="666" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="900" fill="${textColor}" opacity=".86">${v2870Xml(l.subtitle)}</text>`;
  const brandCapsule = cola ? `<rect x="382" y="496" width="136" height="46" rx="23" fill="#e9f4ff" opacity=".96"/><text x="450" y="526" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="29" font-weight="1000" fill="#24539d">${v2870Xml(l.brand||'Blues')}</text>` : '';
  return `<g filter="url(#v2870Shadow)">
    <ellipse cx="450" cy="1102" rx="165" ry="32" fill="#0f172a" opacity=".14"/>
    <rect x="392" y="74" width="116" height="102" rx="24" fill="url(#v2870Cap)"/><g opacity=".30" stroke="#6f5600" stroke-width="4">${[408,427,446,465,484,502].map(x=>`<path d="M${x} 88 L${x} 162"/>`).join('')}</g>
    <path d="M366 156 Q371 234 325 304 Q270 388 266 505 L266 922 Q266 1024 346 1060 Q392 1080 450 1080 Q508 1080 554 1060 Q634 1024 634 922 L634 505 Q630 388 575 304 Q529 234 534 156 Z" fill="url(#v2870Glass)" stroke="#7faac6" stroke-opacity=".48" stroke-width="10"/>
    <clipPath id="v2870BottleClip"><path d="M366 156 Q371 234 325 304 Q270 388 266 505 L266 922 Q266 1024 346 1060 Q392 1080 450 1080 Q508 1080 554 1060 Q634 1024 634 922 L634 505 Q630 388 575 304 Q529 234 534 156 Z"/></clipPath>
    <g clip-path="url(#v2870BottleClip)"><rect x="250" y="${water?475:330}" width="400" height="740" fill="${spec.contentColor}" opacity="${spec.contentOpacity||'.8'}"/><path d="M250 ${water?488:345} Q450 ${water?452:300} 650 ${water?488:345}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="16"/>${bubbles}<rect x="260" y="160" width="390" height="920" fill="url(#v2870Gloss)" opacity=".58"/></g>
    ${waterRidges}
    <path d="M355 172 Q450 205 545 172" fill="none" stroke="#fff" stroke-opacity=".72" stroke-width="13"/><path d="M330 298 Q370 248 390 170" fill="none" stroke="#fff" stroke-opacity=".44" stroke-width="11" stroke-linecap="round"/>
    <g><path d="M282 505 Q450 458 618 505 L618 748 Q450 808 282 748 Z" fill="${labelFill}"/><path d="M282 505 Q450 458 618 505 L618 570 Q450 522 282 570 Z" fill="${band}"/><path d="M282 688 Q450 735 618 688 L618 748 Q450 808 282 748 Z" fill="${band}"/><path d="M292 518 Q450 475 608 518" fill="none" stroke="#fff" stroke-opacity=".48" stroke-width="8"/>${brandCapsule}${colaLabelText}${lemon}</g>
    <text x="450" y="830" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="29" font-weight="1000" fill="#10233f" opacity=".90">${v2870Xml(l.format)}</text>
  </g>`;
}
function v2870MasterJugSvg(spec={}){
  const l=spec.labelModel||{};
  return `<g filter="url(#v2870Shadow)">
    <ellipse cx="450" cy="1104" rx="220" ry="34" fill="#0f172a" opacity=".14"/>
    <rect x="374" y="76" width="152" height="88" rx="24" fill="url(#v2870Cap)"/><g opacity=".28" stroke="#08204a" stroke-width="4">${[392,414,436,458,480,502].map(x=>`<path d="M${x} 88 L${x} 150"/>`).join('')}</g>
    <path fill-rule="evenodd" d="M284 156 Q294 104 354 104 L570 122 Q650 132 668 242 L712 910 Q724 1032 606 1070 L278 1070 Q162 1038 178 912 L224 334 Q235 212 284 156 Z M564 236 Q666 244 672 356 Q677 474 579 524 Q532 548 504 510 Q597 462 596 366 Q595 282 548 278 Z" fill="url(#v2870Jug)" stroke="#08766f" stroke-opacity=".32" stroke-width="11"/>
    <path d="M564 236 Q666 244 672 356 Q677 474 579 524 Q532 548 504 510 Q597 462 596 366 Q595 282 548 278 Z" fill="#f7fbff" opacity=".92"/>
    <path d="M246 250 Q320 205 440 210" stroke="#fff" stroke-opacity=".55" stroke-width="18" fill="none" stroke-linecap="round"/>
    <path d="M230 505 L636 478 L607 744 Q461 812 228 762 Z" fill="${spec.labelColor}"/>
    <path d="M230 505 L636 478 L600 575 Q455 618 228 600 Z" fill="${spec.labelAccentColor}" opacity=".92"/>
    <path d="M522 480 L636 478 L610 742 L548 766 Q580 635 522 480 Z" fill="${spec.labelThirdColor||'#ef4444'}" opacity=".96"/>
    <rect x="278" y="518" width="310" height="80" rx="24" fill="#fff" opacity=".88" transform="rotate(-3 433 558)"/>
    <text x="450" y="575" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="60" font-weight="1000" fill="#b4232c" stroke="#fff" stroke-width="1.2">${v2870Xml(l.brand||'Dexal')}</text>
    <text x="450" y="650" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="1000" fill="#071b3b">${v2870Xml(l.hero)}</text>
    <text x="450" y="693" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="1000" fill="#071b3b">${v2870Xml(l.subtitle)}</text>
    <text x="450" y="760" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="36" font-weight="1000" fill="#071b3b">${v2870Xml(l.format)}</text>
    <path d="M240 925 Q440 1002 662 922" fill="none" stroke="#08766f" stroke-opacity=".22" stroke-width="13"/>
  </g>`;
}
function v2870GenericMasterSvg(spec={}){
  const l=spec.labelModel||{};
  return `<g filter="url(#v2870Shadow)"><ellipse cx="450" cy="1010" rx="165" ry="30" fill="#0f172a" opacity=".12"/><rect x="260" y="220" width="380" height="650" rx="56" fill="${spec.bodyColor}" stroke="#0f3760" stroke-opacity=".18" stroke-width="10"/><rect x="300" y="415" width="300" height="220" rx="32" fill="url(#v2870Label)"/><text x="450" y="500" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="54" font-weight="1000" fill="${v2870TextColor(spec.labelColor)}">${v2870Xml(l.brand||'Prodotto')}</text><text x="450" y="565" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="32" font-weight="950" fill="${v2870TextColor(spec.labelColor)}">${v2870Xml(l.hero)}</text><text x="450" y="626" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="27" font-weight="900" fill="${v2870TextColor(spec.labelColor)}">${v2870Xml(l.format)}</text></g>`;
}
function v2870VirtualSvg(spec={}, opts={}){
  const bg=String(opts.background||'transparent').toLowerCase();
  const bgRect=bg==='white'?`<rect width="900" height="1200" rx="54" fill="#ffffff"/>`:`<rect width="900" height="1200" rx="54" fill="rgba(255,255,255,0)"/>`;
  const title=`<text x="450" y="74" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="31" font-weight="1000" fill="#0f2745">Render V28.70 · gemello visivo PRO MASTER</text>`;
  const sw=v2870Swatches(spec);
  let obj='';
  if(spec.family==='detergent_jug_master') obj=v2870MasterJugSvg(spec);
  else if(/bottle_master/.test(spec.family)||spec.shape==='bottle') obj=v2870MasterBottleSvg(spec);
  else obj=v2870GenericMasterSvg(spec);
  const facts=(spec.visualFacts||[]).slice(0,3).map((x,i)=>`<text x="450" y="${1145+i*22}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="850" fill="#64748b">${v2870Xml(x,120)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">${bgRect}${v2870SVGDefs(spec)}<rect x="36" y="30" width="828" height="1128" rx="58" fill="#f8fbff" opacity="${bg==='white'?'.52':'.80'}"/>${sw}${title}${obj}<text x="450" y="1118" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="19" font-weight="1000" fill="#0f2745">${v2870Xml(spec.shape)} · qualità ${v2870Xml(spec.renderQuality?.level||'stimata')}</text>${facts}</svg>`;
}
function v2870GenerateVirtualRender(card={}, record={}, opts={}){
  const spec=v2870RenderSpec(card,record);
  const svg=v2870VirtualSvg(spec,opts||{});
  return {version:V2870_VERSION,background:String(opts.background||'transparent'),spec,svgDataUri:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),svg,upgrade:'PRO MASTER: silhouette piu umana, etichetta stratificata, contenuto visibile, dettagli tappo/manico e layout mobile-safe'};
}
function v2870BuildHumanReasoning(card={}, record={}, confirmed={}){
  const prev=v2870PrevBuildHumanReasoning ? v2870PrevBuildHumanReasoning(card,record,confirmed) : {};
  const spec=v2870RenderSpec(card,record);
  const proof=v2870Arr([prev.identityEvidence,spec.visualFacts,record.detectedText,record.visibleEvidence,record.evidenceTokens],70);
  const rules=v2870Arr([prev.decisionRules,[
    'il server prima costruisce un gemello visivo: silhouette, contenuto, colori, tappo, etichetta',
    'il render PRO MASTER serve a verificare se il cervello ha davvero interpretato il prodotto',
    'se il gemello e sbagliato, valori titolare e foto corretta aggiornano subito la memoria ufficiale'
  ]],30);
  return Object.assign({},prev,{version:V2870_VERSION,renderUnderstanding:{family:spec.family,shape:spec.shape,content:spec.content,colors:[spec.bodyColor,spec.labelColor,spec.labelAccentColor,spec.labelThirdColor,spec.capColor],quality:spec.renderQuality,visualFacts:spec.visualFacts},identityEvidence:proof,decisionRules:rules,engines:Object.assign({},prev.engines||{},{render:'V28.70 PRO MASTER virtual twin: silhouette/content/label/color layers',pixelJudge:'V28.70 human visual twin uses learned photo facts + owner values'})});
}
function v2870RenderBrainProduct(key='', opts={}){
  ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; const rec=g.products[String(key||'').trim()];
  if(!rec) return {ok:false,error:'product_not_found'};
  try{ v2842EnsureObjectFolder(rec); v2842ApplyOwnerOverrides(rec); v2840AttachMemoryCard(rec,{}); }catch(_){ }
  const card=rec.memoryCard||v2840BuildMemoryCard(rec,{}); const render=v2870GenerateVirtualRender(card,rec,opts||{}); const reasoning=v2870BuildHumanReasoning(card,rec,{});
  try{ rec.virtualRenderV2870=render; rec.humanReasoningV2870=reasoning; rec.virtualRenderV2868=render; rec.humanReasoningV2868=reasoning; rec.virtualRenderV2867=render; rec.humanReasoningV2867=reasoning; if(rec.memoryCard){ rec.memoryCard.virtualRenderV2870=render; rec.memoryCard.humanReasoningV2870=reasoning; rec.memoryCard.virtualRenderV2868=render; rec.memoryCard.humanReasoningV2868=reasoning; rec.memoryCard.virtualRenderV2867=render; rec.memoryCard.humanReasoningV2867=reasoning; } }catch(_){ }
  return {ok:true,version:V2870_VERSION,key:rec.key||key,title:rec.productName||card.identity?.productName||'Prodotto',render,reasoning,fields:v2840PublicProductBrainDetail(rec).fields};
}
(function(){
  try{ v2867RenderSpec=v2870RenderSpec; v2867VirtualSvg=v2870VirtualSvg; v2867GenerateVirtualRender=v2870GenerateVirtualRender; v2867BuildHumanReasoning=v2870BuildHumanReasoning; v2867RenderBrainProduct=v2870RenderBrainProduct; }catch(_){ }
  try{ v2868RenderSpec=v2870RenderSpec; v2868VirtualSvg=v2870VirtualSvg; v2868GenerateVirtualRender=v2870GenerateVirtualRender; v2868BuildHumanReasoning=v2870BuildHumanReasoning; v2868RenderBrainProduct=v2870RenderBrainProduct; }catch(_){ }
  try{
    if(typeof v2840BuildMemoryCard==='function' && !global.__v2870CardWrapped){
      const prev=v2840BuildMemoryCard;
      v2840BuildMemoryCard=function(record={}, confirmed={}){ const card=prev.call(this,record,confirmed)||{}; try{ card.humanReasoningV2870=v2870BuildHumanReasoning(card,record,confirmed); card.virtualRenderV2870=v2870GenerateVirtualRender(card,record,{background:'transparent'}); card.humanReasoningV2868=card.humanReasoningV2870; card.virtualRenderV2868=card.virtualRenderV2870; card.humanReasoningV2867=card.humanReasoningV2870; card.virtualRenderV2867=card.virtualRenderV2870; }catch(_){} return card; };
      global.__v2870CardWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof publicServerBrainV2840==='function' && !global.__v2870ServerBrainWrapped){
      const prev=publicServerBrainV2840;
      publicServerBrainV2840=function(opts={}){ try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(r=>{ v2842EnsureObjectFolder(r); const card=v2840AttachMemoryCard(r,{}); if(card){ r.humanReasoningV2870=v2870BuildHumanReasoning(card,r,{}); r.virtualRenderV2870=v2870GenerateVirtualRender(card,r,{background:'transparent'}); r.humanReasoningV2868=r.humanReasoningV2870; r.virtualRenderV2868=r.virtualRenderV2870; r.humanReasoningV2867=r.humanReasoningV2870; r.virtualRenderV2867=r.virtualRenderV2870; } }); }catch(_){} const out=prev.call(this,opts||{}); out.version='V28.70 PRO MASTER Human Visual Twin'; out.reasoningBusV2870={active:true,policy:'gemello virtuale PRO MASTER = silhouette + contenuto + colori + etichetta + prove foto reali',renderEngine:'V28.70 mobile-safe realistic SVG twin',humanUnderstanding:'il render deve far capire al titolare cosa il server crede di vedere'}; return out; };
      global.__v2870ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2870PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this)||{}; s.version='V28.70'; s.brain=Object.assign({},s.brain||{},{version:'V28.70',proMasterVisualTwin:'active',mobileSafeRender:'active',humanLikeRender:'silhouette+content+label+colors'}); return s; }; global.__v2870PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.70 PRO MASTER Human Visual Twin active');
})();

// =============================================================
// V28.71 PRO MASTER Real Pixel Twin
// Obiettivo: non solo disegno SVG. Il cervello espone un gemello
// foto-realistico guidato da pixel reali: foto utente / immagine Open Facts
// come texture, sagoma semantica, dettagli di etichetta e layout mobile-safe.
// =============================================================
const V2871_VERSION = 'V28.71';
const v2871PrevRenderSpec = (typeof v2870RenderSpec==='function') ? v2870RenderSpec : null;
const v2871PrevGenerateVirtualRender = (typeof v2870GenerateVirtualRender==='function') ? v2870GenerateVirtualRender : null;
const v2871PrevBuildHumanReasoning = (typeof v2870BuildHumanReasoning==='function') ? v2870BuildHumanReasoning : null;
function v2871Safe(v='', max=320){
  try{ return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
  catch(_){ return ''; }
}
function v2871Xml(v='', max=360){
  return v2871Safe(v,max).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function v2871Arr(v, n=80){
  const out=[]; const push=x=>{ if(x==null) return; if(Array.isArray(x)) return x.forEach(push); if(typeof x==='object') return; String(x).split(/\n|\s*[;,]\s*/).forEach(y=>{ const c=v2871Safe(y,220); if(c) out.push(c); }); };
  push(v); return [...new Set(out)].slice(0,n);
}
function v2871IsDataImage(v=''){ return /^data:image\/(png|jpe?g|webp);base64,/i.test(String(v||'')); }
function v2871SafeUrl(v=''){
  const s=String(v||'').trim();
  if(v2871IsDataImage(s)) return s;
  if(/^https?:\/\//i.test(s) && !/[<>"']/g.test(s) && s.length<1400) return s;
  return '';
}
function v2871PickReferencePhoto(record={}, card={}){
  const folder=record.objectFolder||card.objectFolder||{};
  const photos=Array.isArray(folder.photos)?folder.photos:[];
  const reps=[folder.representativePhoto, record.profilePhoto, record.ownerProfilePhoto, card.profilePhoto].filter(Boolean);
  const candidates=[];
  const add=(obj={}, kind='')=>{
    if(!obj || typeof obj!=='object') return;
    const data=v2871SafeUrl(obj.dataUrl||obj.thumbDataUrl||obj.imageUrl||obj.svgDataUri||'');
    const ext=v2871SafeUrl(obj.externalUrl||obj.imageUrl||'');
    if(data) candidates.push({uri:data, kind:kind||obj.kind||obj.type||'photo', isData:v2871IsDataImage(data), source:obj.source||obj.note||'', score:Number(obj.score||0)});
    if(ext && ext!==data) candidates.push({uri:ext, kind:kind||obj.kind||obj.type||'external', isData:false, source:obj.source||obj.note||'', score:Number(obj.score||0)});
  };
  reps.forEach(x=>add(x,'representative'));
  photos.filter(p=>p.kind==='product_front').slice(0,6).forEach(p=>add(p,'product_front'));
  photos.slice(0,10).forEach(p=>add(p,p.kind||'photo'));
  const refs=[];
  (record.externalReferenceImages||[]).forEach(r=>refs.push(r));
  (record.externalReferences||[]).forEach(r=>refs.push(r));
  (card.externalReferenceImages||[]).forEach(r=>refs.push(r));
  const pm=record.productMemory||card.productMemory||{};
  if(pm.imageUrl||pm.referenceImageUrl) refs.push({imageUrl:pm.imageUrl||pm.referenceImageUrl, source:'product_memory'});
  refs.slice(0,10).forEach(r=>add({imageUrl:r.imageUrl||r.externalUrl, source:r.sourceLabel||r.source||'Open Facts'}, 'api_reference'));
  add({imageUrl:record.imageUrl||record.productImageUrl||''}, 'record_image');
  const best=candidates.sort((a,b)=>Number(b.isData)-Number(a.isData) || Number(b.score||0)-Number(a.score||0))[0]||null;
  return best ? Object.assign(best,{available:true}) : {available:false, uri:'', kind:'none', isData:false};
}
function v2871DetailLevel(record={}, card={}, ref={}){
  const photoCount=Number(record.objectFolder?.photos?.length||card.objectFolder?.photoCount||0);
  const samples=Number(record.objectFolder?.visualFeatureSamples?.length||card.objectFolder?.visualSignatures?.length||0);
  let score=35;
  if(ref?.available) score+=28;
  if(ref?.isData) score+=10;
  if(photoCount>=3) score+=12; else if(photoCount>0) score+=6;
  if(samples>=2) score+=8;
  if(record.ownerOverrides?.enabled || card.ownerOverrides?.enabled) score+=7;
  return Math.max(0, Math.min(100, score));
}
function v2871RenderSpec(card={}, record={}){
  const base=v2871PrevRenderSpec ? v2871PrevRenderSpec(card,record) : {};
  const ref=v2871PickReferencePhoto(record, card);
  const score=v2871DetailLevel(record, card, ref);
  const facts=v2871Arr([base.visualFacts, ref.available ? `texture pixel reale: ${ref.kind}` : '', ref.available&&!ref.isData ? 'immagine riferimento web/API disponibile' : '', 'render V28.71 usa foto reale come texture quando possibile'], 16);
  const quality = ref.available ? (score>=78?'pro-master-real':'foto-reale') : (base.renderQuality?.level||'stimata');
  return Object.assign({}, base, {
    version: V2871_VERSION,
    engine: 'pro_master_real_pixel_twin_v2871',
    renderMode: ref.available ? 'photo_texture_plus_semantic_silhouette' : 'semantic_vector_fallback',
    referencePhotoAvailable: !!ref.available,
    referencePhotoKind: ref.kind||'none',
    referencePhotoIsData: !!ref.isData,
    referencePhotoSource: ref.source||'',
    referenceImageUrl: (!ref.isData && ref.uri) ? ref.uri : '',
    photoTextureUri: ref.isData ? ref.uri : '',
    detailScore: score,
    visualFacts: facts,
    renderQuality: Object.assign({}, base.renderQuality||{}, {
      level: quality,
      score,
      target: '8/10 realismo: texture foto reale + sagoma + etichetta + colori + contenuto',
      photoTexture: !!ref.available,
      referenceKind: ref.kind||'none'
    })
  });
}
function v2871SVGDefs(spec={}){
  const photo=v2871Xml(spec.photoTextureUri||'', 1200000);
  const imageDef=photo ? `<pattern id="v2871PhotoTexture" patternUnits="objectBoundingBox" width="1" height="1"><image href="${photo}" x="0" y="0" width="900" height="1200" preserveAspectRatio="xMidYMid slice"/></pattern>` : '';
  return `<defs>
    <filter id="v2871SoftShadow" x="-20%" y="-20%" width="140%" height="145%"><feDropShadow dx="0" dy="28" stdDeviation="24" flood-color="#071b32" flood-opacity=".22"/><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#071b32" flood-opacity=".18"/></filter>
    <linearGradient id="v2871Glass" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ffffff" stop-opacity=".68"/><stop offset=".32" stop-color="${v2871Xml(spec.bodyColor||'#e8f2ff')}" stop-opacity=".36"/><stop offset=".8" stop-color="#ffffff" stop-opacity=".20"/><stop offset="1" stop-color="#b7d6ee" stop-opacity=".42"/></linearGradient>
    <linearGradient id="v2871Cap" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff3a5"/><stop offset=".52" stop-color="${v2871Xml(spec.capColor||'#facc15')}"/><stop offset="1" stop-color="#b68400"/></linearGradient>
    <linearGradient id="v2871Label" x1="0" x2="1"><stop stop-color="${v2871Xml(spec.labelColor||'#123a86')}"/><stop offset=".55" stop-color="${v2871Xml(spec.labelAccentColor||'#facc15')}"/><stop offset="1" stop-color="${v2871Xml(spec.labelThirdColor||'#ffffff')}"/></linearGradient>
    <radialGradient id="v2871Liquid" cx="38%" cy="16%" r="85%"><stop stop-color="#48301c" stop-opacity=".96"/><stop offset=".45" stop-color="${v2871Xml(spec.contentColor||'#17110d')}" stop-opacity=".96"/><stop offset="1" stop-color="#050505" stop-opacity=".98"/></radialGradient>
    <linearGradient id="v2871JugBody" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#67fff4"/><stop offset=".32" stop-color="${v2871Xml(spec.bodyColor||'#21c7bd')}"/><stop offset="1" stop-color="#059a91"/></linearGradient>
    ${imageDef}
  </defs>`;
}
function v2871LabelModel(spec={}){
  const prev=spec.labelModel||{};
  const brand=v2871Safe(prev.brand||spec.brand||'',40);
  const name=v2871Safe(prev.hero||spec.name||'',80);
  const subtitle=v2871Safe(prev.subtitle||'',52);
  const fmt=v2871Safe(prev.format||spec.format||'',22);
  return {brand, hero:name, subtitle, format:fmt};
}
function v2871BottleMasterSvg(spec={}){
  const l=v2871LabelModel(spec); const photo=!!spec.photoTextureUri;
  const labelOpacity=photo?'.58':'1';
  const textureFill=photo?'url(#v2871PhotoTexture)':'url(#v2871Glass)';
  return `<g filter="url(#v2871SoftShadow)">
    <ellipse cx="450" cy="1112" rx="190" ry="28" fill="#071b32" opacity=".16"/>
    <clipPath id="v2871BottleClip"><path d="M386 116 L514 116 L524 220 Q584 266 624 382 Q658 478 660 662 L660 944 Q660 1034 590 1076 Q528 1114 450 1114 Q372 1114 310 1076 Q240 1034 240 944 L240 662 Q242 478 276 382 Q316 266 376 220 Z"/></clipPath>
    <path d="M386 116 L514 116 L524 220 Q584 266 624 382 Q658 478 660 662 L660 944 Q660 1034 590 1076 Q528 1114 450 1114 Q372 1114 310 1076 Q240 1034 240 944 L240 662 Q242 478 276 382 Q316 266 376 220 Z" fill="${textureFill}" clip-path="url(#v2871BottleClip)"/>
    ${photo?`<rect x="235" y="116" width="430" height="1000" fill="url(#v2871PhotoTexture)" clip-path="url(#v2871BottleClip)" opacity=".94"/>`:''}
    ${!photo?`<path d="M258 410 Q450 360 642 410 L642 1052 Q450 1118 258 1052 Z" fill="url(#v2871Liquid)" opacity="${v2871Xml(spec.contentOpacity||'.88')}" clip-path="url(#v2871BottleClip)"/>`:''}
    <path d="M386 116 L514 116 L524 220 Q584 266 624 382 Q658 478 660 662 L660 944 Q660 1034 590 1076 Q528 1114 450 1114 Q372 1114 310 1076 Q240 1034 240 944 L240 662 Q242 478 276 382 Q316 266 376 220 Z" fill="none" stroke="#7fb0d4" stroke-opacity=".68" stroke-width="10"/>
    <rect x="370" y="52" width="160" height="92" rx="24" fill="url(#v2871Cap)"/><g opacity=".32" stroke="#805e00" stroke-width="4">${[392,414,436,458,480,502].map(x=>`<path d="M${x} 66 L${x} 132"/>`).join('')}</g>
    <path d="M286 325 Q346 238 390 128" fill="none" stroke="#fff" stroke-opacity=".42" stroke-width="16" stroke-linecap="round"/><path d="M330 230 Q450 274 570 230" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="11"/>
    <g opacity="${labelOpacity}"><path d="M276 548 Q450 496 624 548 L624 752 Q450 816 276 752 Z" fill="url(#v2871Label)"/><path d="M276 548 Q450 496 624 548 L624 606 Q450 562 276 606 Z" fill="${v2871Xml(spec.labelAccentColor||'#facc15')}" opacity=".86"/><path d="M276 704 Q450 754 624 704 L624 752 Q450 816 276 752 Z" fill="${v2871Xml(spec.labelAccentColor||'#facc15')}" opacity=".92"/>
      <rect x="380" y="558" width="140" height="42" rx="21" fill="#e9f5ff" opacity=".96"/><text x="450" y="586" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="1000" fill="#224d96">${v2871Xml(l.brand||spec.brand||'Brand')}</text>
      <text x="450" y="680" text-anchor="middle" font-family="Georgia,serif" font-size="98" font-style="italic" font-weight="900" fill="#ffffff" stroke="#071b52" stroke-width="2.4">${/cola/i.test(l.hero||spec.name||'')?'Cola':v2871Xml((l.hero||spec.name||'Prodotto').slice(0,12))}</text>
      <text x="450" y="735" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="26" font-weight="1000" fill="#081a35">${v2871Xml(l.subtitle||(/lemon/i.test((l.hero||'')+' '+(spec.name||''))?'LEMON TASTE':''))}</text>
    </g>
    <text x="450" y="850" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="32" font-weight="1000" fill="#10233f" opacity=".86">${v2871Xml(l.format||spec.format||'')}</text>
  </g>`;
}
function v2871JugMasterSvg(spec={}){
  const l=v2871LabelModel(spec); const photo=!!spec.photoTextureUri; const textureFill=photo?'url(#v2871PhotoTexture)':'url(#v2871JugBody)';
  return `<g filter="url(#v2871SoftShadow)">
    <ellipse cx="450" cy="1110" rx="232" ry="30" fill="#071b32" opacity=".16"/>
    <clipPath id="v2871JugClip"><path fill-rule="evenodd" d="M296 138 Q318 82 390 82 L596 112 Q678 126 694 236 L734 914 Q745 1036 626 1080 L282 1080 Q158 1040 174 912 L224 320 Q238 200 296 138 Z M574 224 Q680 230 692 352 Q704 482 584 542 Q532 568 498 518 Q598 470 594 360 Q592 268 544 260 Z"/></clipPath>
    <path fill-rule="evenodd" d="M296 138 Q318 82 390 82 L596 112 Q678 126 694 236 L734 914 Q745 1036 626 1080 L282 1080 Q158 1040 174 912 L224 320 Q238 200 296 138 Z M574 224 Q680 230 692 352 Q704 482 584 542 Q532 568 498 518 Q598 470 594 360 Q592 268 544 260 Z" fill="${textureFill}" clip-path="url(#v2871JugClip)"/>
    ${photo?`<rect x="155" y="80" width="610" height="1010" fill="url(#v2871PhotoTexture)" clip-path="url(#v2871JugClip)" opacity=".96"/>`:''}
    <path fill-rule="evenodd" d="M296 138 Q318 82 390 82 L596 112 Q678 126 694 236 L734 914 Q745 1036 626 1080 L282 1080 Q158 1040 174 912 L224 320 Q238 200 296 138 Z M574 224 Q680 230 692 352 Q704 482 584 542 Q532 568 498 518 Q598 470 594 360 Q592 268 544 260 Z" fill="none" stroke="#08766f" stroke-opacity=".46" stroke-width="11"/>
    <rect x="374" y="52" width="154" height="90" rx="24" fill="url(#v2871Cap)"/><g opacity=".32" stroke="#08204a" stroke-width="4">${[394,416,438,460,482,504].map(x=>`<path d="M${x} 66 L${x} 130"/>`).join('')}</g>
    <path d="M246 246 Q320 204 454 212" stroke="#fff" stroke-opacity=".52" stroke-width="18" fill="none" stroke-linecap="round"/>
    <g opacity="${photo?'.62':'1'}"><path d="M230 500 L642 474 L616 760 Q468 826 226 770 Z" fill="${v2871Xml(spec.labelColor||'#f5b1b8')}"/><path d="M230 500 L642 474 L606 578 Q460 622 228 602 Z" fill="${v2871Xml(spec.labelAccentColor||'#ffffff')}" opacity=".94"/><path d="M522 476 L642 474 L618 758 L548 782 Q584 640 522 476 Z" fill="${v2871Xml(spec.labelThirdColor||'#ef4444')}" opacity=".96"/>
      <rect x="280" y="520" width="320" height="86" rx="24" fill="#fff" opacity=".88" transform="rotate(-3 440 563)"/><text x="450" y="578" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="1000" fill="#b4232c">${v2871Xml(l.brand||spec.brand||'Dexal')}</text>
      <text x="450" y="660" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="1000" fill="#071b3b">${v2871Xml(l.hero||'CANDEGGINA DELICATA')}</text><text x="450" y="704" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="30" font-weight="1000" fill="#071b3b">${v2871Xml(l.subtitle||'MAXI')}</text><text x="450" y="770" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="36" font-weight="1000" fill="#071b3b">${v2871Xml(l.format||spec.format||'')}</text></g>
  </g>`;
}
function v2871VirtualSvg(spec={}, opts={}){
  const bg=String(opts.background||'transparent').toLowerCase();
  const bgRect=bg==='white'?`<rect width="900" height="1200" rx="38" fill="#ffffff"/>`:'';
  const intro=`<text x="450" y="60" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="1000" fill="#0f2745">Gemello V28.71 · REAL PIXEL TWIN</text>`;
  let obj='';
  if((spec.family||'').includes('detergent_jug')) obj=v2871JugMasterSvg(spec);
  else if((spec.family||'').includes('bottle') || spec.shape==='bottle') obj=v2871BottleMasterSvg(spec);
  else obj=(typeof v2870GenericMasterSvg==='function')?v2870GenericMasterSvg(spec):'';
  const source=spec.referencePhotoAvailable?'texture foto reale + sagoma semantica':'fallback vettoriale da memoria';
  const badge=`<g><rect x="250" y="1128" width="400" height="36" rx="18" fill="#eef6ff" stroke="#d8e8fb"/><text x="450" y="1152" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="16" font-weight="1000" fill="#16427d">${v2871Xml(source)} · score ${Number(spec.detailScore||0)}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">${bgRect}${v2871SVGDefs(spec)}${intro}${obj}${badge}</svg>`;
}
function v2871GenerateVirtualRender(card={}, record={}, opts={}){
  const spec=v2871RenderSpec(card,record);
  const svg=v2871VirtualSvg(spec, opts||{});
  return {version:V2871_VERSION,background:String(opts.background||'transparent'),spec,svgDataUri:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),svg,upgrade:'REAL PIXEL TWIN: usa foto reale/API come texture quando disponibile, con sagoma e ragionamento semantico.'};
}
function v2871BuildHumanReasoning(card={}, record={}, confirmed={}){
  const prev=v2871PrevBuildHumanReasoning ? v2871PrevBuildHumanReasoning(card,record,confirmed) : {};
  const spec=v2871RenderSpec(card,record);
  const rules=v2871Arr([prev.decisionRules, [
    'V28.71: il gemello non nasce solo da forme disegnate, ma usa pixel reali salvati o immagini Open Facts/API come texture.',
    'Il server decide la sagoma con famiglia visiva + OCR + memoria + valori titolare, poi la confronta con foto reale.',
    'Se il gemello foto-reale non somiglia al prodotto, correggi foto profilo o valori titolare: quei dati diventano verità ufficiale.'
  ]], 40);
  return Object.assign({}, prev, {
    version: V2871_VERSION,
    renderUnderstanding: Object.assign({}, prev.renderUnderstanding||{}, {version:V2871_VERSION, mode:spec.renderMode, realPixelTexture:!!spec.referencePhotoAvailable, referenceKind:spec.referencePhotoKind, detailScore:spec.detailScore, target:'realismo >= 8/10'}),
    decisionRules: rules,
    engines: Object.assign({}, prev.engines||{}, {render:'V28.71 REAL PIXEL TWIN: foto reale/API + sagoma semantica + overlay leggibile', pixelJudge:'V28.71 render usa il pixel reale salvato come prova visiva primaria'})
  });
}
function v2871RenderBrainProduct(key='', opts={}){
  ensureDbShape(); const g=db.assistantBrain.globalProductMemory||{products:{}}; const rec=g.products[String(key||'').trim()];
  if(!rec) return {ok:false,error:'product_not_found'};
  try{ v2842EnsureObjectFolder(rec); v2842ApplyOwnerOverrides(rec); v2840AttachMemoryCard(rec,{}); }catch(_){ }
  const card=rec.memoryCard||v2840BuildMemoryCard(rec,{}); const render=v2871GenerateVirtualRender(card,rec,opts||{}); const reasoning=v2871BuildHumanReasoning(card,rec,{});
  try{ rec.virtualRenderV2871=render; rec.humanReasoningV2871=reasoning; rec.virtualRenderV2870=render; rec.humanReasoningV2870=reasoning; rec.virtualRenderV2868=render; rec.humanReasoningV2868=reasoning; rec.virtualRenderV2867=render; rec.humanReasoningV2867=reasoning; if(rec.memoryCard){ rec.memoryCard.virtualRenderV2871=render; rec.memoryCard.humanReasoningV2871=reasoning; rec.memoryCard.virtualRenderV2870=render; rec.memoryCard.humanReasoningV2870=reasoning; rec.memoryCard.virtualRenderV2868=render; rec.memoryCard.humanReasoningV2868=reasoning; rec.memoryCard.virtualRenderV2867=render; rec.memoryCard.humanReasoningV2867=reasoning; } }catch(_){ }
  return {ok:true,version:V2871_VERSION,key:rec.key||key,title:rec.productName||card.identity?.productName||'Prodotto',render,reasoning,fields:v2840PublicProductBrainDetail(rec).fields};
}
(function(){
  try{ v2867RenderSpec=v2871RenderSpec; v2867VirtualSvg=v2871VirtualSvg; v2867GenerateVirtualRender=v2871GenerateVirtualRender; v2867BuildHumanReasoning=v2871BuildHumanReasoning; v2867RenderBrainProduct=v2871RenderBrainProduct; }catch(_){ }
  try{ v2868RenderSpec=v2871RenderSpec; v2868VirtualSvg=v2871VirtualSvg; v2868GenerateVirtualRender=v2871GenerateVirtualRender; v2868BuildHumanReasoning=v2871BuildHumanReasoning; v2868RenderBrainProduct=v2871RenderBrainProduct; }catch(_){ }
  try{ v2870RenderSpec=v2871RenderSpec; v2870VirtualSvg=v2871VirtualSvg; v2870GenerateVirtualRender=v2871GenerateVirtualRender; v2870BuildHumanReasoning=v2871BuildHumanReasoning; v2870RenderBrainProduct=v2871RenderBrainProduct; }catch(_){ }
  try{
    if(typeof v2840BuildMemoryCard==='function' && !global.__v2871CardWrapped){
      const prev=v2840BuildMemoryCard;
      v2840BuildMemoryCard=function(record={}, confirmed={}){ const card=prev.call(this,record,confirmed)||{}; try{ card.humanReasoningV2871=v2871BuildHumanReasoning(card,record,confirmed); card.virtualRenderV2871=v2871GenerateVirtualRender(card,record,{background:'transparent'}); card.humanReasoningV2870=card.humanReasoningV2871; card.virtualRenderV2870=card.virtualRenderV2871; card.humanReasoningV2868=card.humanReasoningV2871; card.virtualRenderV2868=card.virtualRenderV2871; card.humanReasoningV2867=card.humanReasoningV2871; card.virtualRenderV2867=card.virtualRenderV2871; }catch(_){} return card; };
      global.__v2871CardWrapped=true;
    }
  }catch(_){ }
  try{
    if(typeof publicServerBrainV2840==='function' && !global.__v2871ServerBrainWrapped){
      const prev=publicServerBrainV2840;
      publicServerBrainV2840=function(opts={}){ try{ Object.values(db.assistantBrain?.globalProductMemory?.products||{}).forEach(r=>{ v2842EnsureObjectFolder(r); const card=v2840AttachMemoryCard(r,{}); if(card){ r.humanReasoningV2871=v2871BuildHumanReasoning(card,r,{}); r.virtualRenderV2871=v2871GenerateVirtualRender(card,r,{background:'transparent'}); r.humanReasoningV2870=r.humanReasoningV2871; r.virtualRenderV2870=r.virtualRenderV2871; r.humanReasoningV2868=r.humanReasoningV2871; r.virtualRenderV2868=r.virtualRenderV2871; r.humanReasoningV2867=r.humanReasoningV2871; r.virtualRenderV2867=r.virtualRenderV2871; } }); }catch(_){} const out=prev.call(this,opts||{}); out.version='V28.71 PRO MASTER Real Pixel Twin'; out.reasoningBusV2871={active:true,policy:'render real-pixel = foto reale/API come texture + sagoma semantica + valori titolare',renderEngine:'V28.71 REAL PIXEL TWIN mobile-safe',humanUnderstanding:'il render deve sembrare quanto più reale possibile e mostrare il pixel che il server ha imparato'}; return out; };
      global.__v2871ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2871PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this)||{}; s.version='V28.71'; s.brain=Object.assign({},s.brain||{},{version:'V28.71',realPixelTwin:'active',renderUsesRealPhotos:'active',mobileSafeRender:'strong'}); return s; }; global.__v2871PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.71 PRO MASTER Real Pixel Twin active');
})();


// =============================================================
// V28.73 PRO Real Photo Twin Mobile Fix
// Obiettivo: il Cervello Server non deve mai mostrare un render bianco.
// La UI usa prima la foto reale con <img>; il server espone alias V28.73
// e segnala che il gemello reale è mobile-safe/direct-photo-first.
// =============================================================
(function(){
  const V2872_VERSION='V28.73';
  try{
    const prev=v2867RenderBrainProduct;
    if(typeof prev==='function' && !global.__v2872RenderWrapped){
      v2867RenderBrainProduct=function(key='', opts={}){
        const out=prev.call(this,key,opts)||{};
        try{
          if(out.ok){
            out.version=V2872_VERSION;
            if(out.render){
              out.render.version=V2872_VERSION;
              out.render.mobileFix='real-photo-direct-first: browser <img> fallback, no blank SVG pattern';
              out.render.spec=Object.assign({},out.render.spec||{},{version:V2872_VERSION,renderMode:(out.render.spec?.renderMode||'')+' + direct_photo_viewer'});
            }
            if(out.reasoning){
              out.reasoning.version=V2872_VERSION;
              out.reasoning.engines=Object.assign({},out.reasoning.engines||{},{render:'V28.73 direct real photo first + semantic SVG fallback'});
            }
            if(out.fields){
              out.fields.virtualRenderV2872=out.render;
              out.fields.humanReasoningV2872=out.reasoning;
            }
          }
        }catch(_){ }
        return out;
      };
      global.__v2872RenderWrapped=true;
    }
  }catch(_){ }
  try{
    const prev=publicServerBrainV2840;
    if(typeof prev==='function' && !global.__v2872ServerBrainWrapped){
      publicServerBrainV2840=function(opts={}){
        const out=prev.call(this,opts||{})||{};
        try{
          out.version='V28.73 PRO Real Photo Twin Mobile Fix';
          out.reasoningBusV2872={active:true,policy:'foto reale diretta prima del render SVG; niente pannelli bianchi su mobile',renderEngine:'V28.73 direct-photo-first + semantic fallback',mobileSafe:true};
          (out.products||[]).forEach(p=>{ const f=p.fields||{}; if(f.virtualRenderV2871 && !f.virtualRenderV2872) f.virtualRenderV2872=f.virtualRenderV2871; if(f.humanReasoningV2871 && !f.humanReasoningV2872) f.humanReasoningV2872=f.humanReasoningV2871; });
        }catch(_){ }
        return out;
      };
      global.__v2872ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2872PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this)||{}; s.version=V2872_VERSION; s.brain=Object.assign({},s.brain||{},{version:V2872_VERSION,realPhotoTwinMobileFix:'active',renderBlankGuard:'active'}); return s; }; global.__v2872PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.73 PRO Real Photo Twin Mobile Fix active');
})();


// =============================================================
// V28.74 PRO Photo Delete + Render Retry
// Opzioni premium: elimina foto sbagliate dalla cartella articolo
// e forza una nuova richiesta render dal Cervello Server.
// =============================================================
(function(){
  const V2874_VERSION='V28.74';
  try{
    const prev=v2867RenderBrainProduct;
    if(typeof prev==='function' && !global.__v2874RenderWrapped){
      v2867RenderBrainProduct=function(key='', opts={}){
        const out=prev.call(this,key,opts)||{};
        try{
          if(out.ok){
            out.version=V2874_VERSION;
            if(out.render){
              out.render.version=V2874_VERSION;
              out.render.retryAvailable=true;
              out.render.renderRetryMode='manual_safe_retry';
            }
            if(out.reasoning){
              out.reasoning.version=V2874_VERSION;
              out.reasoning.engines=Object.assign({},out.reasoning.engines||{},{render:'V28.74 direct real photo first + retry render'});
            }
            if(out.fields){
              out.fields.virtualRenderV2872=out.render;
              out.fields.humanReasoningV2872=out.reasoning;
            }
          }
        }catch(_){ }
        return out;
      };
      global.__v2874RenderWrapped=true;
    }
  }catch(_){ }
  try{
    const prev=publicServerBrainV2840;
    if(typeof prev==='function' && !global.__v2874ServerBrainWrapped){
      publicServerBrainV2840=function(opts={}){
        const out=prev.call(this,opts||{})||{};
        try{
          out.version='V28.74 PRO Photo Delete + Render Retry';
          out.reasoningBusV2874={active:true,policy:'foto sbagliate eliminabili + render rigenerabile manualmente',renderEngine:'V28.74 retry-safe real-photo-first',mobileSafe:true};
        }catch(_){ }
        return out;
      };
      global.__v2874ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2874PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this)||{}; s.version=V2874_VERSION; s.brain=Object.assign({},s.brain||{},{version:V2874_VERSION,photoDelete:'active',renderRetry:'active'}); return s; }; global.__v2874PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.74 PRO Photo Delete + Render Retry active');
})();

// =============================================================
// V28.78 PRO CSS Render Always Visible
// La UI mostra un render inline sempre visibile anche se immagini esterne/SVG falliscono.
// =============================================================
(function(){
  const V2875_VERSION='V28.78';
  try{
    const prev=publicServerBrainV2840;
    if(typeof prev==='function' && !global.__v2875ServerBrainWrapped){
      publicServerBrainV2840=function(opts={}){
        const out=prev.call(this,opts||{})||{};
        try{
          out.version='V28.78 PRO CSS Render Always Visible';
          out.reasoningBusV2875={active:true,policy:'render inline sempre visibile + foto eliminabili + retry render',renderEngine:'V28.78 hard HTML/SVG fallback first',mobileSafe:true};
        }catch(_){ }
        return out;
      };
      global.__v2875ServerBrainWrapped=true;
    }
  }catch(_){ }
  try{ const prev=preflightSnapshotV98; if(typeof prev==='function'&&!global.__v2875PreflightWrapped){ preflightSnapshotV98=function(){ const s=prev.call(this)||{}; s.version=V2875_VERSION; s.brain=Object.assign({},s.brain||{},{version:V2875_VERSION,mobileRenderStack:'active'}); return s; }; global.__v2875PreflightWrapped=true; } }catch(_){ }
  console.log('[Spesa Pronta] V28.78 PRO CSS Render Always Visible active');
})();

console.log('[Spesa Pronta] V28.78 Render Tab Surgical Fix active');
