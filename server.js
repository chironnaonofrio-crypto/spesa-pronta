import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { URL } from 'url';

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
let db = loadDb();

function loadDb(){ try { return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); } catch { return { users:{}, households:{} }; } }
function saveDb(){ fs.writeFileSync(DB_PATH, JSON.stringify(db,null,2)); }
function id(prefix){ return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function token(){ return crypto.randomBytes(24).toString('hex'); }
function hash(pwd){ return crypto.createHash('sha256').update(String(pwd)).digest('hex'); }
function safeUser(u){ return { id:u.id, username:u.username, email:u.email, firstName:u.firstName || '', lastName:u.lastName || '' }; }

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
    res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': data.length, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400' });
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
function smartThreshold(item, settings={}){
  if(settings.autoSmart === false) return item.baseThreshold || 1;
  const people = Number(settings.people || 1);
  const animals = Number(settings.animals || 0);
  let th = item.baseThreshold || 1;
  if(item.perPersonMin) th = Math.max(th, Math.ceil(item.perPersonMin * people));
  if(item.perAnimalMin) th = Math.max(th, Math.ceil(item.perAnimalMin * animals));
  if(item.usage >= 6) th = Math.max(th, (item.baseThreshold || 1) + 2);
  if(item.kind === 'water') th = Math.max(th, people * 2);
  if(item.kind === 'petfood') th = Math.max(th, animals * 4);
  return th;
}
function isBuy(item, settings){ return Number(item.qty||0) <= smartThreshold(item, settings); }
function shoppingList(household){
  return (household.items||[]).filter(i=>isBuy(i, household.settings||{})).map(i=>({ id:i.id, name:itemName(i, household.settings?.lang||'it'), qty:i.qty, unit:i.unit, image:i.image }));
}
function findItem(household, product){
  const p = String(product||'').toLowerCase().trim();
  return (household.items||[]).find(i => {
    const names = Object.values(i.names||{}).map(x=>String(x).toLowerCase());
    return names.includes(p) || names.some(n=>n.includes(p)) || String(i.id).toLowerCase()===p;
  });
}
function alexaSpeak(text){ return { version:'1.0', response:{ outputSpeech:{ type:'PlainText', text }, shouldEndSession:true } }; }


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
async function llmChatReply({message,state,settings,memory}){
  const key=process.env.OPENAI_API_KEY;
  if(!key) return localAiReply({message,state,settings,memory});
  const compactState=(state||[]).map(i=>({id:i.id,name:itemName(i,settings?.lang||'it'),qty:i.qty,unit:i.unit,category:i.category,threshold:smartThreshold(i,settings)}));
  const payload={
    model:OPENAI_MODEL,
    input:[{role:'system',content:'Sei Spesa Pronta AI, assistente domestico caldo e pratico. Ricordi chat, consumi e preferenze. Rispondi in italiano. Puoi suggerire modifiche ma non inventare dati. Se serve una modifica alla lista, descrivila chiaramente.'},{role:'user',content:JSON.stringify({message,state:compactState,settings,memory:(memory||{})}).slice(0,60000)}]
  };
  const resp=await openAiResponse(payload);
  return outputText(resp) || localAiReply({message,state,settings,memory});
}
async function visionAnalyze({image,catalog,settings,memory}){
  if(!process.env.OPENAI_API_KEY){
    return { needsManual:true, productName:'', quantity:1, unit:'pz', category:'food', confidence:.25, reason:'Backend AI Vision non collegato: inserisci nome e quantità manualmente.' };
  }
  const compact=(catalog||[]).map(i=>({id:i.id,names:i.names,unit:i.unit,category:i.category,qty:i.qty})).slice(0,200);
  const prompt='Analizza la foto di un prodotto della spesa. Rispondi SOLO JSON valido con: needsRetake boolean, reason string, productName string, quantity number, unit string, category tra food/drinks/pets/house/pharmacy/aquarium/fruit/veg, confidence 0..1. Se foto sfocata, buia, prodotto non identificabile o quantità non stimabile, needsRetake true e reason breve. Se il prodotto sembra già nel catalogo usa lo stesso nome.';
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
    if(req.method === 'GET' && pathName === '/api/health') return send(res, 200, { ok:true, service:'spesa-pronta-cloud', time:new Date().toISOString() });

    if(req.method === 'GET' && pathName === '/api/ai/status') {
      return send(res, 200, {
        ok:true,
        connected: aiConnected(),
        provider: aiConnected() ? 'openai' : 'local-fallback',
        model: OPENAI_MODEL,
        visionModel: OPENAI_VISION_MODEL,
        visionReady: aiConnected(),
        note: aiConnected() ? 'AI Chat + Vision attive dal backend' : 'Manca OPENAI_API_KEY: usa motore locale e inserimento guidato foto'
      });
    }

    if(req.method === 'POST' && pathName === '/api/auth/register'){
      const { firstName='', lastName='', username,email,password,people=1,animals=0,autoSmart=true,items=[], aiMemory=null } = body;
      if(!username || !email || !password) return send(res, 400, { error:'missing_fields' });
      const found = Object.values(db.users).find(u=>u.email===email);
      if(found) return send(res, 409, { error:'email_exists' });
      const userId=id('user'), householdId=id('home'), tkn=token();
      db.users[userId]={ id:userId, firstName, lastName, username, email, passwordHash:hash(password), householdId };
      db.households[householdId]={ id:householdId, ownerUserId:userId, token:tkn, settings:{ people, animals, autoSmart, alexaConnected:false, lang:'it' }, items, aiMemory: aiMemory || {messages:[],facts:[],events:[],scanHistory:[]}, updatedAt:Date.now() };
      saveDb();
      return send(res, 200, { ok:true, user:safeUser(db.users[userId]), householdId, token:tkn });
    }

    if(req.method === 'POST' && pathName === '/api/auth/login'){
      const { email,password } = body;
      const user = Object.values(db.users).find(u=>u.email===email && u.passwordHash===hash(password));
      if(!user) return send(res, 401, { error:'invalid_credentials' });
      const h = db.households[user.householdId];
      return send(res, 200, { ok:true, user:safeUser(user), householdId:h.id, token:h.token, settings:h.settings, items:h.items, aiMemory:h.aiMemory||null });
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
        saveDb();
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


    if(req.method === 'POST' && pathName === '/api/ai/chat'){
      const { message='', state=[], settings={}, memory={} } = body;
      const reply = await llmChatReply({message,state,settings,memory});
      return send(res, 200, { ok:true, reply });
    }

    if(req.method === 'POST' && pathName === '/api/ai/vision'){
      const { image='', catalog=[], settings={}, memory={} } = body;
      if(!image || !String(image).startsWith('data:image/')) return send(res, 400, { error:'image_required' });
      const result = await visionAnalyze({image,catalog,settings,memory});
      return send(res, 200, { ok:true, result });
    }

    const aiAnalysisMatch = pathName.match(/^\/api\/households\/([^/]+)\/ai-analysis$/);
    if(req.method === 'GET' && aiAnalysisMatch){
      const householdId = aiAnalysisMatch[1];
      const h = db.households[householdId];
      if(!h) return send(res, 404, { error:'household_not_found' });
      const bearer = (req.headers.authorization||'').replace(/^Bearer\s+/, '');
      if(h.token !== bearer) return send(res, 401, { error:'unauthorized' });
      const analysis=(h.items||[]).map(i=>({id:i.id,name:itemName(i,h.settings?.lang||'it'),qty:i.qty,unit:i.unit,threshold:smartThreshold(i,h.settings),toBuy:isBuy(i,h.settings)}));
      return send(res, 200, {ok:true, analysis, memory:h.aiMemory||{}});
    }

    if(req.method === 'POST' && pathName === '/api/alexa'){
      const householdId = url.searchParams.get('householdId') || body?.session?.user?.accessToken || body?.householdId;
      const h = db.households[householdId] || Object.values(db.households)[0];
      if(!h) return send(res, 200, alexaSpeak('Account Spesa Pronta non collegato.'));
      const intent = body?.request?.intent?.name || body?.intent || '';
      const slots = body?.request?.intent?.slots || body?.slots || {};
      const product = slots.Product?.value || slots.product?.value || body?.product;
      const qty = Number(slots.Quantity?.value || slots.quantity?.value || body?.qty || 0);
      const unit = slots.Unit?.value || slots.unit?.value || body?.unit;

      if(intent === 'ReadListIntent' || intent === 'ReadShoppingListIntent'){
        const list = shoppingList(h);
        if(!list.length) return send(res, 200, alexaSpeak('La lista della spesa è vuota.'));
        return send(res, 200, alexaSpeak('Devi comprare: ' + list.map(x=>`${x.name}, ${x.qty} ${x.unit||''}`).join('; ') + '.'));
      }
      if(intent === 'AddItemIntent'){
        const item = findItem(h, product);
        if(!item) return send(res, 200, alexaSpeak(`Non trovo ${product}. Apri l'app e aggiungilo al catalogo.`));
        item.qty = 0; item.updatedAt = Date.now(); item.usage = Number(item.usage||0)+1; h.updatedAt=Date.now(); saveDb();
        return send(res, 200, alexaSpeak(`Ok, ho aggiunto ${itemName(item,h.settings?.lang)} alla lista della spesa.`));
      }
      if(intent === 'SetQuantityIntent' || intent === 'UpdateItemIntent'){
        const item = findItem(h, product);
        if(!item) return send(res, 200, alexaSpeak(`Non trovo ${product}.`));
        if(!Number.isFinite(qty)) return send(res, 200, alexaSpeak('Dimmi una quantità valida.'));
        item.qty = qty; if(unit) item.unit = unit; item.updatedAt = Date.now(); h.updatedAt=Date.now(); saveDb();
        return send(res, 200, alexaSpeak(`Ok, ${itemName(item,h.settings?.lang)} ora è a ${item.qty} ${item.unit||''}.`));
      }
      if(intent === 'ResetListIntent'){
        h.items = (h.items||[]).map(i => ({ ...i, qty: i.recommendedBuy || i.maxQty || 5, updatedAt:Date.now() }));
        h.updatedAt=Date.now(); saveDb();
        return send(res, 200, alexaSpeak('Perfetto, ho segnato la spesa come fatta.'));
      }
      return send(res, 200, alexaSpeak('Puoi chiedermi cosa devi comprare, aggiungere un prodotto o modificare una quantità.'));
    }

    if(serveStatic(req,res,url)) return;
    return send(res, 404, { error:'not_found' });
  } catch(err) {
    console.error(err);
    return send(res, 500, { error:'server_error' });
  }
});

server.listen(PORT, ()=>console.log(`Spesa Pronta all-in-one running on http://localhost:${PORT}`));
