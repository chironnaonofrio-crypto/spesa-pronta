
(function(){
  const SETTINGS_KEY='spesa-pronta-final:settings:v19';
  const OWNER_TOKEN_KEY='spesa-pronta:server-brain-owner-token:v1';
  const state={brain:null,all:[],filtered:[],selectedKey:'',tab:'overview',clientErrors:[],includeDeep:false,lastQuery:'',pendingOwnerPhotoDataUrl:''};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const arr=(v,n=999)=>Array.isArray(v)?v.filter(x=>x!==undefined&&x!==null&&String(x).trim()!=='').slice(0,n):(v?[v].slice(0,n):[]);
  const joinList=v=>arr(v).join(', ');
  const parseList=s=>String(s||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean).slice(0,120);
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const tokens=s=>norm(s).split(/\s+/).filter(t=>t.length>0);
  const fmtDate=n=>n?new Date(Number(n)).toLocaleString('it-IT'):'—';
  function redact(txt){return String(txt||'').replace(/Bearer\s+[A-Za-z0-9._-]+/g,'Bearer ***').replace(/(sk-[A-Za-z0-9_-]{12,})/g,'sk-***').replace(/(DATABASE_URL|SUPABASE|TOKEN|PASSWORD|SECRET|KEY)["'\s:=]+[^,"'\s]+/gi,'$1: ***')}
  function logErr(type,data){state.clientErrors.unshift({at:Date.now(),type,data});state.clientErrors=state.clientErrors.slice(0,80);renderClientErrors();}
  window.addEventListener('error',e=>logErr('runtime-error',{message:e.message,source:e.filename,line:e.lineno,col:e.colno}));
  window.addEventListener('unhandledrejection',e=>logErr('promise-error',{reason:String(e.reason?.message||e.reason||'')}));
  function getSettings(){try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}catch{return {}}}
  function apiBase(){return (getSettings().apiEndpoint||'/api').replace(/\/$/,'')||'/api'}
  function getOwnerToken(){return $('ownerToken')?.value || localStorage.getItem(OWNER_TOKEN_KEY)||''}
  function setOwnerToken(v){localStorage.setItem(OWNER_TOKEN_KEY,String(v||''));}
  async function fetchJson(url,opt){const r=await fetch(url,Object.assign({cache:'no-store'},opt||{}));let data=null;try{data=await r.json()}catch{data={raw:await r.text().catch(()=> '')}}return {ok:r.ok,status:r.status,data};}
  function profileSrc(photo){if(!photo) return placeholder('Prodotto'); if(typeof photo==='string') return photo; return photo.dataUrl||photo.thumbDataUrl||photo.externalUrl||photo.imageUrl||placeholder('Prodotto');}
  function placeholder(label){const t=encodeURIComponent(String(label||'Prodotto').slice(0,28));return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'><defs><linearGradient id='g' x1='0' x2='1'><stop stop-color='%23eaf5ff'/><stop offset='1' stop-color='%23e9fff5'/></linearGradient></defs><rect width='220' height='220' rx='52' fill='url(%23g)'/><circle cx='110' cy='85' r='34' fill='%23ffffff' stroke='%23cfe3f8' stroke-width='5'/><path d='M68 150c18-28 66-28 84 0' fill='none' stroke='%231266f1' stroke-width='10' stroke-linecap='round'/><text x='110' y='198' font-size='15' font-family='Arial' text-anchor='middle' fill='%2362768f' font-weight='700'>${t}</text></svg>`}
  function chipClass(v){if(String(v).toLowerCase().includes('alta')||Number(v)>=82) return 'ok'; if(String(v).toLowerCase().includes('media')||Number(v)>=55) return 'warn'; return 'bad';}
  function row(k,v){return `<b>${esc(k)}</b><span>${esc((v===undefined||v===null||v==='')?'—':v)}</span>`}
  function pills(v,empty='—'){const a=arr(v,90);return a.length?`<div class="pillWrap">${a.map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>`:`<div class="empty">${esc(empty)}</div>`}
  function categoryText(c){const map={milk_drinks:'latte bevande latte milk drinks',water:'acqua naturale minerale',juice:'succhi tè the tea bevande non gassate',soft_drinks:'bibite gassate cola fanta sprite pepsi',sauces_condiments:'salse condimenti sughi',laundry:'bucato detersivo lavatrice candeggina',cleaning:'pulizia casa detergente',dishwashing:'piatti lavastoviglie',meat_deli:'salumi carne affettati',spreads:'creme spalmabili',yogurt:'yogurt kefir',oil_vinegar:'olio aceto'};return [c,map[c]||''].join(' ')}
  function primarySearchText(p){const f=p.fields||{};const id=f.identity||{};const cls=f.classification||{};const q=f.quantity||{};const va=f.visualAppearance||{};const oo=f.ownerOverrides?.fields||{};return [
    p.title,p.brand,p.category,p.format,p.barcode,
    id.productName,id.brand,id.format,arr(id.aliases).join(' '),arr(id.brands).join(' '),
    cls.category,cls.categoryFamily,categoryText(cls.category),q.unit,
    f.barcode,arr(f.barcodes).join(' '),
    oo.productName,oo.brand,oo.format,oo.category,oo.barcode,
    va.productType,va.packageType,va.visualSignature,arr(va.colors).join(' '),f.packaging,
    arr(f.labels).join(' '),arr(f.evidenceTokens).join(' ')
  ].join(' ')}
  function deepSearchText(p){const f=p.fields||{};return [primarySearchText(p),arr(f.ingredients).join(' '),arr(f.allergens).join(' '),arr(f.possibleTraces).join(' '),arr(f.visibleEvidence).join(' '),arr(f.detectedText).join(' '),JSON.stringify(f.nutrition||{})].join(' ')}
  function productScore(p,q){const qs=tokens(q);if(!qs.length) return 1;const primary=norm(primarySearchText(p));const deep=norm(deepSearchText(p));const source=state.includeDeep?deep:primary;const barcodeOnly=/^\d{6,14}$/.test(norm(q).replace(/\s/g,''));if(barcodeOnly){const digits=norm(q).replace(/\D/g,'');return (String(p.barcode||'')+arr(p.fields?.barcodes).join(' ')).includes(digits)?999:0;}
    let score=0;for(const t of qs){if(!source.includes(t)) return 0;if(primary.includes(t)) score+=20; else score+=3;}
    const name=norm([p.title,p.fields?.identity?.productName,p.brand,p.fields?.identity?.brand].join(' '));
    const cat=norm(categoryText(p.category||p.fields?.classification?.category||''));
    for(const t of qs){if(name.split(' ').includes(t)) score+=35; else if(name.includes(t)) score+=22; if(cat.split(' ').includes(t)) score+=8;}
    score += Number(p.confirmations||0)*.2 + Number(p.completeness?.percent||0)/100;
    if(p.fields?.ownerOverrides?.enabled) score+=2;
    return score;
  }
  function applyFilter(){const q=$('search').value.trim();state.lastQuery=q;const scored=(state.all||[]).map(p=>({p,score:productScore(p,q)})).filter(x=>x.score>0);scored.sort((a,b)=>b.score-a.score || String(a.p.title).localeCompare(String(b.p.title),'it'));state.filtered=scored.map(x=>x.p);if(state.selectedKey && !state.filtered.find(p=>p.key===state.selectedKey)) state.selectedKey=state.filtered[0]?.key||'';if(!state.selectedKey) state.selectedKey=state.filtered[0]?.key||'';render();}
  function currentProduct(){return (state.filtered||[]).find(p=>p.key===state.selectedKey) || (state.all||[]).find(p=>p.key===state.selectedKey) || null;}
  function renderMetrics(){
    const products=state.all||[]; const shown=state.filtered||[];
    let photos=0,locked=0,conf=0;
    for(const p of products){photos+=Number(p.fields?.objectFolder?.photoCount||0); if(p.fields?.ownerOverrides?.enabled) locked++; conf+=Number(p.confirmations||0);}
    const cm=state.brain?.costMeterV2854||{};
    const serverErrors=arr(state.brain?.errors,200).length;
    const corrections=arr(state.brain?.corrections,400).length;
    $('mCount').textContent=products.length;
    $('mShown').textContent=shown.length;
    $('mPhotos').textContent=photos;
    $('mLocked').textContent=locked;
    $('mConfirm').textContent=conf;
    $('mErrors').textContent=serverErrors + state.clientErrors.length;
    if($('mCorrections')) $('mCorrections').textContent=corrections;
    if($('mOpenAi')) $('mOpenAi').textContent=String(cm.openAiCalls??0);
    if($('mOpenFacts')) $('mOpenFacts').textContent=String(cm.openFactsCalls??0)+' / '+String(cm.openFactsHits??0);
    $('listCount').textContent=`${shown.length} risultat${shown.length===1?'o':'i'}`;
  }
  function renderProducts(){const box=$('products');const list=state.filtered||[];if(!list.length){box.innerHTML=`<div class="empty">Nessun prodotto trovato. La ricerca precisa mostra solo articoli collegati davvero a nome, marca, barcode, formato o categoria. Prova a pulire la ricerca o attivare “Cerca anche ingredienti/allergeni/OCR”.</div>`;return;}box.innerHTML=list.map(p=>{const f=p.fields||{};const src=profileSrc(p.profilePhoto);return `<div class="product ${p.key===state.selectedKey?'active':''}" data-key="${esc(p.key)}"><img class="photo" src="${esc(src)}" alt=""><div><div class="pTitle">${esc(p.title||'Prodotto')}</div><div class="pMeta">${esc(p.brand||'—')} · ${esc(p.format||'—')} · ${esc(p.category||'—')}</div><div class="chips"><span class="chip ${chipClass(p.reliability)}">${esc(p.reliability||'bassa')}</span><span class="chip ${chipClass(p.completeness?.percent)}">${Number(p.completeness?.percent||0)}% campi</span>${f.objectFolder?.photoCount?`<span class="chip ok">${f.objectFolder.photoCount} foto</span>`:`<span class="chip warn">foto mancanti</span>`}${f.ownerOverrides?.enabled?'<span class="chip lock">titolare</span>':''}</div></div></div>`}).join('');box.querySelectorAll('.product').forEach(el=>el.onclick=()=>{state.selectedKey=el.dataset.key;state.tab='overview';render();setTimeout(()=>document.getElementById('detail')?.scrollIntoView({behavior:'smooth',block:'start'}),80);});}
  function buildEditor(f){return `<div class="section"><h3>✍️ Modifica valori titolare</h3><p class="subtitle" style="margin:0 0 12px">Quando salvi qui, questi valori vincono su memoria, barcode, etichetta e OpenAI.</p><div class="chips" style="margin-bottom:12px">${f.ownerOverrides?.enabled?'<span class="chip lock">Valori titolare attivi</span>':'<span class="chip warn">Non ancora bloccato</span>'}</div><div class="editor">
      <label>Nome<input id="edProductName" value="${esc(f.identity?.productName||'')}"></label>
      <label>Marca<input id="edBrand" value="${esc(f.identity?.brand||'')}"></label>
      <label>Formato<input id="edFormat" value="${esc(f.identity?.format||'')}"></label>
      <label>Categoria<input id="edCategory" value="${esc(f.classification?.category||'')}"></label>
      <label>Unità<input id="edUnit" value="${esc(f.quantity?.unit||'')}"></label>
      <label>Barcode/EAN<input id="edBarcode" value="${esc(f.barcode||'')}"></label>
      <label class="wide">Firma visiva<input id="edSignature" value="${esc(f.visualAppearance?.visualSignature||'')}"></label>
      <label>Confezione<input id="edPackaging" value="${esc(f.visualAppearance?.packageType||f.packaging||'')}"></label>
      <label>Tipo prodotto<input id="edProductType" value="${esc(f.visualAppearance?.productType||'')}"></label>
      <label class="wide">Ingredienti<textarea id="edIngredients">${esc(joinList(f.ingredients))}</textarea></label>
      <label class="wide">Allergeni<textarea id="edAllergens">${esc(joinList(f.allergens))}</textarea></label>
      <label class="wide">Tracce possibili<textarea id="edTraces">${esc(joinList(f.possibleTraces))}</textarea></label>
      <label class="wide">Colori / aspetto<textarea id="edColors">${esc(joinList(f.visualAppearance?.colors))}</textarea></label>
    </div><div class="saveBar"><button class="primary" id="btnSaveOwner">Salva valori titolare</button><button class="ghost" id="btnClearOwner">Sblocca valori titolare</button><button class="ghost" id="btnCopyProductJson">Copia JSON articolo</button><button class="danger" id="btnDeleteBrainProduct">Elimina articolo dal cervello</button></div><div class="section dangerZone"><h3>🗑️ Zona pericolosa</h3><p class="subtitle">Elimina solo articoli errati o duplicati. L’azione rimuove la scheda dal cervello server, compresa foto profilo e firme collegate.</p></div></div>`}
  function renderGallery(f){
    const folder=f.objectFolder||{};
    const photos=arr(folder.photos,60);
    const current=folder.representativePhoto || photos.find(p=>p.id===folder.representativePhotoId) || photos[0] || null;
    const currentSrc=current?(current.thumbDataUrl||current.dataUrl||current.externalUrl||''):profileSrc(f.profilePhoto);
    const gallery=photos.length?`<div class="gallery">${photos.map(p=>{const src=p.thumbDataUrl||p.dataUrl||p.externalUrl||'';const active=p.id===folder.representativePhotoId;return `<div class="gitem ${active?'active':''}"><img src="${esc(src)}" alt=""><b>${esc(p.kind||'foto')}</b><small>${active?'Foto profilo attuale · ':''}score ${esc(p.score||0)} · ${esc(Math.round((p.bytes||0)/1024))} KB</small>${active?'<span class="activeBadge">SCELTA ORA</span>':`<button class="ghost mini" data-rep-photo="${esc(p.id)}">Imposta come foto articolo</button>`}<button class="danger mini" data-delete-photo="${esc(p.id)}">Elimina foto</button></div>`}).join('')}</div>`:'<div class="empty">Nessuna foto reale salvata nella cartella. Puoi comunque caricare/incollare qui la foto corretta e bloccarla come immagine ufficiale dell’articolo.</div>';
    return `<div class="photoManager"><div class="photoPickerHero"><img class="currentProfile" id="ownerPhotoPreview" src="${esc(currentSrc)}" alt=""><div><h4>Foto profilo articolo</h4><p>Questa è l’immagine che rappresenta il prodotto nel cervello server. Se il server sceglie male, il titolare può correggerla: da quel momento questa foto vince sulla scelta automatica.</p><div class="chips"><span class="chip ${folder.profilePhotoLockedByOwner?'lock':'warn'}">${folder.profilePhotoLockedByOwner?'Foto bloccata dal titolare':'Scelta automatica server'}</span><span class="chip ${photos.length?'ok':'warn'}">${photos.length} foto in cartella</span></div></div></div><div class="photoTools"><div class="photoNote">Puoi scegliere una foto già salvata sotto, oppure caricare/incollare una foto migliore. Ideale: prodotto frontale, etichetta leggibile, poca confusione intorno.</div><div class="actions"><label class="fileBtn">📷 Carica foto corretta<input id="ownerPhotoFile" type="file" accept="image/*"></label><button class="primary" id="btnSaveOwnerPhoto">Salva come foto articolo</button></div><textarea id="ownerPhotoText" placeholder="Oppure incolla qui URL immagine https://... o data:image... base64 già compresso"></textarea><div class="photoPreviewRow" id="ownerPhotoPreviewRow"><img id="ownerPhotoPreviewSmall" alt=""><div>Foto pronta. Premi “Salva come foto articolo” per bloccarla nel cervello server.</div></div></div>${gallery}</div>`;
  }
  function renderOverview(f){return `<div class="section"><h3>🧾 Identità articolo</h3><div class="kv">${row('Nome',f.identity?.productName)}${row('Marca',f.identity?.brand)}${row('Formato',f.identity?.format)}${row('Categoria',f.classification?.category)}${row('Famiglia',f.classification?.categoryFamily)}${row('Unità',f.quantity?.unit)}${row('Barcode',f.barcode)}${row('Cartella oggetto',f.objectFolder?.folderId)}${row('Foto salvate',f.objectFolder?.photoCount)}${row('Aggiornato',fmtDate(f.timestamps?.updatedAt))}</div></div><div class="section"><h3>✅ Campi compilati</h3>${pills(f.filledFields,'Nessun campo compilato')}</div><div class="section"><h3>⚠️ Campi mancanti</h3>${pills(f.missingFields,'Nessun campo mancante')}</div><div class="section"><h3>🔎 Aspetto / firma</h3><div class="kv">${row('Colori',arr(f.visualAppearance?.colors,12).join(', '))}${row('Confezione',f.visualAppearance?.packageType||f.packaging)}${row('Tipo',f.visualAppearance?.productType)}${row('Firma visiva',f.visualAppearance?.visualSignature)}${row('Firma semantica',f.semanticVisualSignatureV2854?.signature)}${row('Regola firma',f.semanticVisualSignatureV2854?.rules)}</div></div>`}
  function renderData(f){return `<div class="section"><h3>🥫 Ingredienti</h3>${pills(f.ingredients,'Ingredienti non salvati')}</div><div class="section"><h3>🚨 Allergeni / tracce</h3>${pills([...(f.allergens||[]),...(f.possibleTraces||[])],'Allergeni o tracce non salvati')}</div><div class="section"><h3>👁️ Prove OCR / visive</h3>${pills([...(f.visibleEvidence||[]),...(f.detectedText||[])].slice(0,60),'Nessuna prova OCR salvata')}</div><div class="section"><h3>📦 Fonti / qualità</h3><div class="kv">${row('Affidabilità',f.reliability)}${row('Conferme',f.confirmations)}${row('Aiuto docente',f.teacherHelp)}${row('Riconoscimenti locali',f.localRecognitions)}${row('Fonti',Object.keys(f.sources||{}).join(', '))}</div></div>`}
  function renderSources(f){const ext=f.externalLearning||{};const refs=arr(ext.references||[],40);const imgs=arr(ext.referenceImages||[],40);const all=imgs.length?imgs:refs;const cards=all.length?`<div class="refGrid">${all.map(r=>`<div class="refCard">${r.imageUrl?`<img src="${esc(r.imageUrl)}" alt="">`:''}<b>${esc([r.productName,r.brand].filter(Boolean).join(' · ')||'Fonte esterna')}</b><small>${esc(r.sourceLabel||r.source||'Fonte')} ${r.code?'· EAN '+esc(r.code):''}</small><small>Score semantico: ${esc(ext.visualComparison?.semanticVisualScore??r.matchScore??r.confidence??'—')}</small>${r.imageUrl?`<a class="refLink" href="${esc(r.imageUrl)}" target="_blank" rel="noreferrer">Apri immagine riferimento</a>`:''}</div>`).join('')}</div>`:'<div class="empty">Nessuna fonte/foto riferimento esterna ancora salvata. Dopo barcode/API + conferma utente, qui vedrai le immagini e i dati usati dal server per imparare.</div>';return `<div class="section"><h3>🌍 Fonti esterne salvate</h3>${cards}</div><div class="section"><h3>🧠 Apprendimento da internet/API</h3><div class="kv">${row('Politica',ext.policy||'API propone, conferma utente/titolare rende memoria ufficiale')}${row('Stato confronto',ext.visualComparison?.status)}${row('Fonte riferimento',ext.visualComparison?.referenceSource)}${row('Foto riferimento',ext.visualComparison?.referenceImageUrl)}</div></div><div class="section"><h3>🧾 Fonti conoscenza</h3>${pills((f.knowledgeSources||[]).map(x=>[x.sourceLabel||x.source,x.category,x.confidence].filter(Boolean).join(' · ')),'Nessuna fonte conoscenza salvata')}</div>`}

  function renderVirtual(f){
    const product=currentProduct()||{};
    const vr=f.virtualRenderV2872||f.virtualRenderV2871||f.virtualRenderV2870||f.virtualRenderV2868||f.virtualRenderV2867||{};
    const spec=vr.spec||{};
    const reason=f.humanReasoningV2872||f.humanReasoningV2871||f.humanReasoningV2870||f.humanReasoningV2868||f.humanReasoningV2867||{};
    const folder=f.objectFolder||{};
    function okSvg(svg){const x=String(svg||''); if(!/^\s*<svg[\s>]/i.test(x)) return ''; return x.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/\son\w+\s*=\s*"[^"]*"/gi,'').replace(/\son\w+\s*=\s*'[^']*'/gi,'');}
    function isGoodImg(uri){uri=String(uri||'').trim(); if(!uri) return false; if(/^data:image\/(png|jpe?g|webp);base64,/i.test(uri)) return uri.length>1200; if(/^https?:\/\//i.test(uri) && !/[<>"']/g.test(uri)) return true; return false;}
    function pushImg(cand, uri, kind, score){uri=String(uri||'').trim(); if(!isGoodImg(uri)) return; cand.push({uri,kind:kind||'foto',score:Number(score||0),real:/^data:image\/(png|jpe?g|webp);base64,/i.test(uri)});}
    function addObj(cand, obj, kind, score){
      if(!obj) return;
      if(typeof obj==='string') return pushImg(cand,obj,kind,score);
      if(typeof obj!=='object') return;
      pushImg(cand,obj.dataUrl||obj.fullDataUrl||obj.originalDataUrl||obj.thumbDataUrl||obj.imageDataUrl,kind||obj.kind||obj.type,Number(score||obj.score||0)+6);
      pushImg(cand,obj.externalUrl||obj.imageUrl||obj.url||obj.src||obj.uri,kind||obj.kind||obj.type,Number(score||obj.score||0));
      if(obj.photo) addObj(cand,obj.photo,kind||obj.kind||'photo',Number(score||0)+1);
      if(obj.image) addObj(cand,obj.image,kind||obj.kind||'image',Number(score||0)+1);
    }
    function bestPhoto(){
      const cand=[];
      addObj(cand,folder.ownerProfilePhoto||folder.representativePhoto,'foto profilo/titolare',100);
      addObj(cand,product.profilePhoto,'foto profilo scheda',96);
      addObj(cand,f.profilePhoto,'foto profilo memoria',94);
      arr(folder.photos,80).filter(p=>/front|product|profilo|representative/i.test(String(p.kind||p.type||p.role||''))).forEach((p,i)=>addObj(cand,p,p.kind||'foto frontale',90-i));
      arr(folder.photos,80).forEach((p,i)=>addObj(cand,p,p.kind||'foto reale',70-i));
      arr(f.externalReferenceImages,30).concat(arr(f.externalReferences,30),arr(f.externalLearning?.referenceImages,30),arr(f.externalLearning?.references,30)).forEach((r,i)=>addObj(cand,{imageUrl:r.imageUrl||r.externalUrl||r.url,source:r.sourceLabel||r.source},r.sourceLabel||'Open Facts/API',55-i));
      addObj(cand,spec.photoTextureUri,'texture server',82);
      addObj(cand,spec.referenceImageUrl,'immagine riferimento server',50);
      const seen=new Set();
      return cand.filter(x=>{const k=x.uri.slice(0,120); if(seen.has(k)) return false; seen.add(k); return true;}).sort((a,b)=>Number(b.real)-Number(a.real)||b.score-a.score)[0]||null;
    }
    function guideSvg(){
      const kind=String(spec.family||spec.shape||f.classification?.category||'').toLowerCase();
      const isJug=/detergent|jug|clean|laundry/.test(kind);
      const outline=isJug?'M23 13 C26 7 35 6 46 7 C61 8 76 12 79 25 L88 86 C90 95 83 100 72 101 L29 101 C17 99 14 94 16 84 L20 28 C20 22 21 17 23 13 Z M66 20 C78 20 83 29 82 41 C81 54 70 60 62 56 C71 51 72 43 72 34 C72 26 69 22 66 20 Z':'M43 8 L57 8 L59 19 C69 25 75 42 76 59 L76 88 C76 99 64 105 50 105 C36 105 24 99 24 88 L24 59 C25 42 31 25 41 19 Z';
      const label=isJug?'<path class="labelZone" d="M25 48 L76 46 L73 72 C58 78 40 78 24 73 Z"/>':'<path class="labelZone" d="M28 51 Q50 45 72 51 L72 70 Q50 77 28 70 Z"/>';
      return `<svg class="realPhotoGuide" viewBox="0 0 100 110" preserveAspectRatio="none" aria-hidden="true"><path class="outline" d="${outline}"/>${label}</svg>`;
    }
    function safeProfileImage(){
      // V28.75: il dettaglio in alto riesce già a mostrare la foto.
      // Quindi il Render AI usa quella stessa fonte come fallback obbligatorio: mai più riquadro bianco.
      const candidates=[];
      try{ candidates.push(profileSrc(product.profilePhoto)); }catch{}
      try{ candidates.push(profileSrc(f.profilePhoto)); }catch{}
      try{ candidates.push(profileSrc(folder.ownerProfilePhoto||folder.representativePhoto)); }catch{}
      for(const c of candidates){
        const u=String(c||'').trim();
        if(u && (u.startsWith('data:image') || /^https?:\/\//i.test(u))) return u;
      }
      return candidates.find(Boolean)||placeholder(product.title||f.identity?.productName||'Prodotto');
    }
    function hardTwinSvg(){
      const name=String(f.identity?.productName||product.title||'Prodotto').slice(0,34);
      const brand=String(f.identity?.brand||product.brand||'').slice(0,22);
      const fmt=String(f.identity?.format||product.format||spec.format||'').slice(0,14);
      const cat=String(f.classification?.category||product.category||spec.category||'').toLowerCase();
      const shape=String(spec.shape||spec.family||reason.subject?.shape||cat||'').toLowerCase();
      const isDet=/detergent|jug|clean|laundry|candegg|detersiv/.test(shape+' '+cat+' '+name);
      const isDark=/cola|dark|scuro/.test(shape+' '+cat+' '+name+' '+String(spec.content||''));
      const isWater=/water|acqua|sant/.test(shape+' '+cat+' '+name);
      const body=isDet?'#20c6bb':isWater?'#dff4ff':'#e9f4ff';
      const body2=isDet?'#16a99f':isWater?'#eefbff':'#cfe4f7';
      const liquid=isDark?'#1c1715':(isWater?'#bdefff':'#111827');
      const cap=isDet?'#2668d9':(/yellow|giallo|cola|lemon/.test(shape+' '+name)?'#f3c515':'#2d6cdf');
      const labelA=isDet?'#f4b9bd':(/cola|lemon|soft/.test(shape+' '+cat+' '+name)?'#123a86':'#1d8ce3');
      const labelB=isDet?'#ffffff':(/cola|lemon/.test(shape+' '+cat+' '+name)?'#f7c71e':'#ffffff');
      const safe=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      const title=safe(name||'Prodotto');
      const brandTxt=safe(brand||'');
      const fmtTxt=safe(fmt||'');
      const obj = isDet
        ? `<g transform="translate(120,70)">
             <path d="M86 36 C92 20 118 18 155 22 C214 28 245 74 242 145 L231 410 C229 449 202 474 151 480 L62 480 C22 474 2 450 9 409 L31 94 C34 60 51 42 86 36 Z" fill="${body}" stroke="#0f8f86" stroke-width="8"/>
             <path d="M177 58 C225 57 252 91 248 139 C244 194 193 214 156 190 C196 179 207 151 204 116 C202 84 190 66 177 58 Z" fill="#f7ffff" opacity=".93" stroke="#0f8f86" stroke-width="7"/>
             <rect x="84" y="0" width="92" height="45" rx="16" fill="${cap}"/>
             <path d="M45 220 C105 205 179 206 226 218 L215 330 C151 355 83 350 34 330 Z" fill="${labelA}" stroke="#e75f62" stroke-width="4"/>
             <path d="M48 220 C103 211 170 213 224 220 L220 260 C162 248 97 250 42 264 Z" fill="${labelB}" opacity=".94"/>
             <text x="130" y="257" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="33" font-weight="1000" fill="#b52828">${brandTxt||'Dexal'}</text>
             <text x="130" y="306" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="1000" fill="#0c2c55">${title}</text>
             <text x="130" y="354" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="1000" fill="#071b32">${fmtTxt}</text>
             <path d="M46 78 C92 60 165 56 216 86" fill="none" stroke="#ffffff" stroke-width="12" opacity=".42" stroke-linecap="round"/>
           </g>`
        : `<g transform="translate(150,55)">
             <rect x="92" y="0" width="92" height="56" rx="17" fill="${cap}"/>
             <path d="M84 49 L192 49 L202 95 C252 125 278 209 278 304 L278 435 C278 493 219 525 138 525 C57 525 -2 493 -2 435 L-2 304 C-2 209 24 125 74 95 Z" fill="${body}" stroke="#afc7dc" stroke-width="8"/>
             <path d="M26 320 C76 300 203 300 250 320 L250 405 C196 425 80 425 26 405 Z" fill="${liquid}" opacity=".95"/>
             <path d="M26 255 C77 238 199 238 250 255 L250 326 C191 345 86 346 26 326 Z" fill="${labelA}" stroke="#082d67" stroke-width="3"/>
             <path d="M28 255 C78 240 199 240 248 255 L248 286 C191 274 86 274 28 286 Z" fill="${labelB}" opacity=".98"/>
             <text x="138" y="282" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="1000" fill="#ffffff">${brandTxt||'Blues'}</text>
             <text x="138" y="332" text-anchor="middle" font-family="Georgia,serif" font-size="76" font-weight="900" fill="#ffffff" stroke="#0b2a63" stroke-width="3">${/cola/i.test(title)?'Cola':title}</text>
             <text x="138" y="376" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="25" font-weight="1000" fill="#071b32">${/lemon|cola/i.test(title)?'Lemon Taste':fmtTxt}</text>
             <path d="M30 88 C78 66 195 64 244 92" fill="none" stroke="#ffffff" stroke-width="14" opacity=".42" stroke-linecap="round"/>
           </g>`;
      return `<svg class="hardTwinSvg" viewBox="0 0 600 690" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Render garantito ${safe(name)}">
        <defs><filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0b2442" flood-opacity=".18"/></filter></defs>
        <rect x="0" y="0" width="600" height="690" rx="38" fill="#f8fbff"/>
        <text x="300" y="46" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="1000" fill="#10233f">Render garantito V28.75</text>
        <g filter="url(#shadow)">${obj}</g>
        <text x="300" y="650" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="900" fill="#60748e">${safe(shape||cat||'forma interpretata')} · ${safe(spec.content||reason.appearance?.content||'contenuto stimato')}</text>
      </svg>`;
    }

    function realTwinHtml(){
      const p=bestPhoto();
      const fallbackSrc=safeProfileImage();
      const src=(p&&p.uri)||fallbackSrc;
      const title=esc([f.identity?.brand,f.identity?.productName].filter(Boolean).join(' · ')||product.title||'Foto reale articolo');
      const facts=[(p&&p.kind)||'foto profilo garantita', spec.shape||spec.family||'', spec.content||reason.appearance?.content||'', spec.format||reason.subject?.format||''].filter(Boolean).slice(0,5);
      const note=p?'pixel reali dalla cartella oggetto':'fallback foto profilo scheda: il server mostra comunque la foto reale disponibile';
      return `<div class="realPhotoTwinCard"><div class="realPhotoViewport safeTwin"><img class="realPhotoImg safeTwinImg" src="${esc(src)}" data-fallback-src="${esc(fallbackSrc)}" alt="${title}" loading="eager" decoding="async">${guideSvg()}<div class="realPhotoFallback empty">La foto non è stata caricata dal browser. Apro il fallback profilo o scegli/carica la foto corretta nella tab Foto.</div></div><div class="safePhotoStatus"><span>${esc(note)}</span>${facts.map(x=>`<span>${esc(x)}</span>`).join('')}</div></div>`;
    }
    const realHtml=realTwinHtml();
    const synthetic=okSvg(vr.svg)||`<img class="virtualRender" id="virtualRenderImg" src="${esc(vr.svgDataUri||placeholder(f.identity?.productName||'Render AI'))}" alt="Render virtuale articolo">`;
    const boxes=[
      ['Motore', vr.version||spec.version||'V28.75'], ['Modalità', spec.renderMode||'real_photo_direct_first'], ['Score realismo', spec.detailScore!=null?`${spec.detailScore}/100`:'—'], ['Texture reale', spec.referencePhotoAvailable?'sì':'foto diretta/browser'], ['Fonte immagine', spec.referencePhotoKind||spec.referencePhotoSource||'foto cartella/profilo'], ['Famiglia', spec.family||spec.shape||reason.subject?.shape], ['Forma', spec.shape||reason.subject?.shape], ['Corpo', spec.bodyColor], ['Etichetta', [spec.labelColor,spec.labelAccentColor,spec.labelThirdColor].filter(Boolean).join(' / ')], ['Tappo', spec.capColor], ['Contenuto', spec.content||reason.appearance?.content], ['Categoria', spec.category||reason.subject?.category], ['Formato', spec.format||reason.subject?.format], ['Qualità render', spec.renderQuality?.level||vr.version], ['Foto reali', spec.photoCount??folder.photoCount??'—'], ['Campioni visivi', spec.renderQuality?.visualSamples??'—']
    ];
    const rulePills=pills(reason.decisionRules||[],'Nessuna regola salvata');
    const evidence=pills(reason.identityEvidence||[],'Nessuna prova identità salvata');
    const risks=pills(reason.riskFlags||[],'Nessun rischio evidente');
    return `<div class="section"><h3>🧊 Gemello visivo VISIBILE SEMPRE</h3><div class="renderHero"><div class="realRenderGrid"><div class="hardTwinStage"><div class="renderStageHead"><span>Render sempre visibile</span><span class="photoRealBadge">fallback anti-vuoto</span></div>${hardTwinSvg()}<div class="hardTwinNote"><span>non dipende da immagini esterne</span><span>usa dati articolo</span><span>mobile-safe</span></div></div><div class="renderStage real"><div class="renderStageHead"><span>Foto reale garantita</span><span class="photoRealBadge">mai più bianco</span></div>${realHtml}</div><div class="renderStage"><div class="renderStageHead"><span>Gemello semantico server</span><small>forma + colore + etichetta</small></div><div class="virtualRenderFrame" id="virtualRenderFrame">${synthetic}</div></div></div><div class="renderSpec"><p class="subtitle" style="margin:0 0 10px">V28.75 HARD RENDER mostra sempre un render garantito costruito direttamente in HTML/SVG: anche se foto reale o SVG server falliscono, non resta mai bianco. Sotto trovi comunque foto reale e gemello semantico.</p><div class="kv">${boxes.map(x=>row(x[0],x[1])).join('')}</div><div class="renderActions"><button class="primary" id="btnRegenerateRender">Rigenera render</button><button class="ghost" id="btnRenderTransparent">Sfondo trasparente</button><button class="ghost" id="btnRenderWhite">Sfondo bianco</button><button class="ghost" id="btnOpenRenderImage">Apri grande</button><button class="ghost" id="btnCopyRenderSvg">Copia SVG</button></div></div></div></div><div class="section"><h3>🧠 Ragionamento umano server</h3><div class="reasonGrid"><div class="reasonBox"><b>Prove identità</b>${evidence}</div><div class="reasonBox"><b>Regole decisionali</b>${rulePills}</div><div class="reasonBox"><b>Rischi/attenzioni</b>${risks}</div><div class="reasonBox"><b>Motori collegati</b><div class="kv">${row('Pixel',reason.engines?.pixelJudge)}${row('OCR',reason.engines?.ocr)}${row('Memoria',reason.engines?.memory)}${row('OpenAI',reason.engines?.openai)}</div></div></div></div><div class="section"><h3>📐 Specifica render</h3><div class="json">${esc(redact(JSON.stringify(vr,null,2)))}</div></div>`;
  }


  function renderJson(f){return `<div class="section"><h3>🧬 JSON completo scheda</h3><div class="json">${esc(redact(JSON.stringify(f,null,2)))}</div></div>`}
  function renderDetail(){const p=currentProduct();const d=$('detail');if(!p){d.innerHTML='<div class="detailBody"><div class="empty">Nessun dettaglio disponibile.</div></div>';return;}const f=p.fields||{};const src=profileSrc(p.profilePhoto);d.innerHTML=`<div class="detailTop"><img class="photo" src="${esc(src)}" alt=""><div><h2>${esc(p.title||'Prodotto')}</h2><p class="detailMeta">${esc(p.brand||'—')} · ${esc(p.format||'—')} · ${esc(p.category||'—')}</p><div class="chips"><span class="chip ${chipClass(p.reliability)}">Affidabilità ${esc(p.reliability||'bassa')}</span><span class="chip ${chipClass(p.completeness?.percent)}">Completo ${p.completeness?.percent||0}%</span>${f.ownerOverrides?.enabled?'<span class="chip lock">Valori titolare</span>':''}${f.objectFolder?.hasRealProfilePhoto?'<span class="chip ok">Foto reale</span>':'<span class="chip warn">Foto profilo da migliorare</span>'}</div><div class="actions" style="margin-top:10px"><button class="ghost mini" data-open-photos="1">📸 Cambia foto articolo</button></div></div></div><div class="tabs"><button class="tab ${state.tab==='overview'?'active':''}" data-tab="overview">Panoramica</button><button class="tab ${state.tab==='edit'?'active':''}" data-tab="edit">Modifica</button><button class="tab ${state.tab==='photos'?'active':''}" data-tab="photos">Foto</button><button class="tab ${state.tab==='render'?'active':''}" data-tab="render">Render AI</button><button class="tab ${state.tab==='data'?'active':''}" data-tab="data">Dati</button><button class="tab ${state.tab==='sources'?'active':''}" data-tab="sources">Fonti API</button><button class="tab ${state.tab==='json'?'active':''}" data-tab="json">JSON</button></div><div class="detailBody" id="detailBody"></div>`;
    const body=$('detailBody');
    body.innerHTML = state.tab==='edit' ? buildEditor(f) : state.tab==='photos' ? `<div class="section"><h3>📸 Cartella foto oggetto</h3>${renderGallery(f)}</div>` : state.tab==='render' ? renderVirtual(f) : state.tab==='data' ? renderData(f) : state.tab==='sources' ? renderSources(f) : state.tab==='json' ? renderJson(f) : renderOverview(f);
    d.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderDetail();});
    d.querySelectorAll('[data-open-photos]').forEach(b=>b.onclick=()=>{state.tab='photos';renderDetail();setTimeout(()=>$('detail')?.scrollIntoView({behavior:'smooth',block:'start'}),40);});
    d.querySelectorAll('[data-rep-photo]').forEach(btn=>btn.onclick=()=>saveOwnerUpdate({representativePhotoId:btn.dataset.repPhoto},'Foto articolo scelta dal titolare ✅'));
    d.querySelectorAll('[data-delete-photo]').forEach(btn=>btn.onclick=()=>deletePhotoFromBrain(btn.dataset.deletePhoto));
    d.querySelector('#ownerPhotoFile')?.addEventListener('change',handleOwnerPhotoFile);
    d.querySelector('#btnSaveOwnerPhoto')?.addEventListener('click',saveManualOwnerPhoto);
    d.querySelectorAll('.realPhotoImg').forEach(img=>img.addEventListener('error',()=>{
      const fb=img.getAttribute('data-fallback-src')||'';
      if(fb && img.src!==fb){ img.src=fb; return; }
      img.closest('.realPhotoTwinCard')?.classList.add('imgFailed');
      logErr('real-photo-render-load-error',{src:String(img.src||'').slice(0,160)});
    }));
    d.querySelector('#btnSaveOwner')?.addEventListener('click',()=>saveOwnerUpdate({productName:val('edProductName'),brand:val('edBrand'),format:val('edFormat'),category:val('edCategory'),unit:val('edUnit'),barcode:val('edBarcode'),visualSignature:val('edSignature'),packaging:val('edPackaging'),packageType:val('edPackaging'),productType:val('edProductType'),ingredients:parseList(val('edIngredients')),allergens:parseList(val('edAllergens')),possibleTraces:parseList(val('edTraces')),colors:parseList(val('edColors'))},'Valori titolare salvati ✅'));
    d.querySelector('#btnClearOwner')?.addEventListener('click',()=>{if(confirm('Sbloccare i valori titolare per questo articolo?')) saveOwnerUpdate({clearOwnerLock:true},'Valori titolare sbloccati ✅')});
    d.querySelector('#btnCopyProductJson')?.addEventListener('click',()=>copyText(JSON.stringify(f,null,2),'JSON articolo copiato ✅'));
    d.querySelector('#btnDeleteBrainProduct')?.addEventListener('click',deleteBrainProduct);
    d.querySelector('#btnRegenerateRender')?.addEventListener('click',()=>refreshVirtualRender('transparent',{retry:true}));
    d.querySelector('#btnRenderTransparent')?.addEventListener('click',()=>refreshVirtualRender('transparent'));
    d.querySelector('#btnRenderWhite')?.addEventListener('click',()=>refreshVirtualRender('white'));
    d.querySelector('#btnOpenRenderImage')?.addEventListener('click',()=>{const r=f.virtualRenderV2872||f.virtualRenderV2871||f.virtualRenderV2870||f.virtualRenderV2868||f.virtualRenderV2867||{}; const img=d.querySelector('.realPhotoImg'); const src=(img&&img.src)||r.svgDataUri||''; const w=window.open('about:blank','_blank'); if(w){w.document.write('<title>Render AI</title><body style="margin:0;background:#f4f8ff;display:grid;place-items:center;min-height:100vh"><img style="max-width:96vw;max-height:96vh;object-fit:contain;border-radius:22px" src="'+String(src).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></body>');} });
    d.querySelector('#btnCopyRenderSvg')?.addEventListener('click',()=>copyText((f.virtualRenderV2872||f.virtualRenderV2871||f.virtualRenderV2870||f.virtualRenderV2868||f.virtualRenderV2867)?.svg||JSON.stringify(f.virtualRenderV2872||f.virtualRenderV2871||f.virtualRenderV2870||f.virtualRenderV2868||f.virtualRenderV2867||{},null,2),'Render SVG copiato ✅'));
  }
  function isOwnerPhotoDataUrl(s){return /^data:image\/(png|jpe?g|webp);base64,/i.test(String(s||''));}
  function isOwnerPhotoUrl(s){return /^https?:\/\//i.test(String(s||'').trim());}
  function readFileAsDataUrl(file){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||''));fr.onerror=()=>reject(fr.error||new Error('file_read_failed'));fr.readAsDataURL(file);});}
  function imageFromDataUrl(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('image_load_failed'));img.src=dataUrl;});}
  async function compressOwnerPhoto(file){
    if(!file) throw new Error('file_missing');
    if(!/^image\//i.test(file.type||'')) throw new Error('not_image');
    if(file.size>8*1024*1024) throw new Error('image_too_large');
    const raw=await readFileAsDataUrl(file);
    const img=await imageFromDataUrl(raw);
    const max=900;
    const scale=Math.min(1,max/Math.max(img.width||1,img.height||1));
    const w=Math.max(1,Math.round((img.width||1)*scale));
    const h=Math.max(1,Math.round((img.height||1)*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
    let out=canvas.toDataURL('image/jpeg',0.78);
    if(out.length>760000) out=canvas.toDataURL('image/jpeg',0.64);
    if(out.length>760000) throw new Error('compressed_image_too_large');
    return out;
  }
  async function handleOwnerPhotoFile(ev){
    try{
      const file=ev.target.files&&ev.target.files[0];
      if(!file) return;
      const dataUrl=await compressOwnerPhoto(file);
      state.pendingOwnerPhotoDataUrl=dataUrl;
      const big=$('ownerPhotoPreview'), small=$('ownerPhotoPreviewSmall'), row=$('ownerPhotoPreviewRow'), text=$('ownerPhotoText');
      if(big) big.src=dataUrl; if(small) small.src=dataUrl; if(row) row.style.display='grid'; if(text) text.value='';
    }catch(e){logErr('owner-photo-file-error',{error:e.message||String(e)});alert('Foto non valida o troppo pesante. Prova con una foto più leggera.');}
  }
  async function saveManualOwnerPhoto(){
    const raw=val('ownerPhotoText').trim();
    const updates={};
    if(state.pendingOwnerPhotoDataUrl){ updates.profilePhotoDataUrl=state.pendingOwnerPhotoDataUrl; }
    else if(isOwnerPhotoDataUrl(raw)){ updates.profilePhotoDataUrl=raw; }
    else if(isOwnerPhotoUrl(raw)){ updates.profilePhotoUrl=raw; }
    else { alert('Carica una foto oppure incolla un URL https / data:image valido.'); return; }
    await saveOwnerUpdate(updates,'Foto articolo bloccata dal titolare ✅');
    state.pendingOwnerPhotoDataUrl='';
  }
  function val(id){return document.getElementById(id)?.value||''}
  function renderServerErrors(){const e=arr(state.brain?.errors,200);$('serverErrors').textContent=e.length?redact(JSON.stringify(e.slice(0,160),null,2)):'Nessun errore vero server registrato. Le correzioni utente non vengono più contate come errori.';}
  function renderCorrections(){const c=arr(state.brain?.corrections,500);const g=arr(state.brain?.guardEvents,120);const payload={correzioni:c.slice(0,120),guardie:g.slice(0,80),nota:'Questi sono eventi di apprendimento/guardia, non errori server.'};$('learningCorrections').textContent=(c.length||g.length)?redact(JSON.stringify(payload,null,2)):'Nessuna correzione/apprendimento da mostrare.';}
  function renderClientErrors(){$('clientErrors').textContent=state.clientErrors.length?redact(JSON.stringify(state.clientErrors,null,2)):'Nessun errore pagina registrato.';}
  function render(){renderMetrics();renderProducts();renderDetail();renderServerErrors();renderCorrections();renderClientErrors();$('filterText').textContent=state.includeDeep?'Ricerca profonda attiva: include anche ingredienti, allergeni, tracce, OCR e JSON prodotto.':'Ricerca identità attiva: non include ingredienti/allergeni, così “latte” non mostra prodotti con sole tracce di latte.';}
  async function load(){const s=getSettings();if(!s.householdId||!s.token){$('notice').className='notice bad';$('notice').innerHTML='<span>🔒</span><div><b>Account cloud non trovato.</b><span> Apri l’app, fai login/sync e poi rientra qui.</span></div>';logErr('missing-auth',{householdId:!!s.householdId,token:!!s.token});state.all=[];state.filtered=[];render();return;}const limit=1000;const endpoints=[`${apiBase()}/ai/server-brain?householdId=${encodeURIComponent(s.householdId)}&limit=${limit}`,`/api/ai/server-brain?householdId=${encodeURIComponent(s.householdId)}&limit=${limit}`];let last=null;for(const url of endpoints){try{const r=await fetchJson(url,{headers:{Authorization:'Bearer '+s.token}});last=r;if(r.ok&&r.data?.ok){state.brain=r.data;state.all=arr(r.data.products,1000);$('notice').className='notice ok';$('notice').innerHTML=`<span>✅</span><div><b>Cervello caricato.</b><span> ${state.all.length} prodotti letti. Ricerca precisa, modifica titolare, render AI ed elimina articolo pronti.</span></div>`;applyFilter();return;}logErr('server-brain-fetch-failed',{url,status:r.status,body:r.data});}catch(e){logErr('server-brain-fetch-error',{url,error:e.message||String(e)});}}$('notice').className='notice bad';$('notice').innerHTML='<span>⚠️</span><div><b>Non sono riuscito a leggere il cervello server.</b><span> Controlla login, endpoint e token dalla Diagnosi AI.</span></div>';state.brain=last?.data||null;state.all=[];state.filtered=[];render();}

  async function refreshVirtualRender(background='transparent', opts={}){
    const s=getSettings();const p=currentProduct();if(!p){alert('Seleziona un prodotto');return;}
    const ownerToken=getOwnerToken();
    const retry=opts&&opts.retry?'1':'0';
    const stamp=Date.now();
    const endpoints=[`${apiBase()}/ai/server-brain/render?householdId=${encodeURIComponent(s.householdId)}&key=${encodeURIComponent(p.key)}&background=${encodeURIComponent(background)}&retry=${retry}&ts=${stamp}`,`/api/ai/server-brain/render?householdId=${encodeURIComponent(s.householdId)}&key=${encodeURIComponent(p.key)}&background=${encodeURIComponent(background)}&retry=${retry}&ts=${stamp}`];
    for(const url of endpoints){try{const headers={Authorization:'Bearer '+s.token};if(ownerToken)headers['X-Owner-Token']=ownerToken;const r=await fetchJson(url,{headers,cache:'no-store'});if(r.ok&&r.data?.ok){p.fields.virtualRenderV2872=r.data.render;p.fields.humanReasoningV2872=r.data.reasoning;p.fields.virtualRenderV2871=r.data.render;p.fields.humanReasoningV2871=r.data.reasoning;p.fields.virtualRenderV2870=r.data.render;p.fields.humanReasoningV2870=r.data.reasoning;p.fields.virtualRenderV2868=r.data.render;p.fields.humanReasoningV2868=r.data.reasoning;p.fields.virtualRenderV2867=r.data.render;p.fields.humanReasoningV2867=r.data.reasoning;renderDetail();$('notice').className='notice ok';$('notice').innerHTML=`<span>🧊</span><div><b>${opts&&opts.retry?'Render rigenerato.':'Render aggiornato.'}</b><span> Il gemello virtuale usa forma, colori, etichetta e dati attuali del cervello.</span></div>`;return;}logErr('render-fetch-failed',{url,status:r.status,body:r.data,retry});}catch(e){logErr('render-fetch-error',{url,error:e.message||String(e),retry});}}
    alert(opts&&opts.retry?'Rigenerazione render non riuscita. Copia errori e mandameli.':'Render non generato. Copia errori e mandameli.');
  }
  async function deleteBrainProduct(){
    const s=getSettings();const p=currentProduct();if(!p){alert('Seleziona un prodotto');return;}
    const name=p.title||p.fields?.identity?.productName||'articolo';
    const typed=prompt(`Per eliminare definitivamente "${name}" dal Cervello Server scrivi ELIMINA`,'');
    if(String(typed||'').trim().toUpperCase()!=='ELIMINA') return;
    const ownerToken=getOwnerToken();const payload={householdId:s.householdId,key:p.key,ownerToken,confirmText:'ELIMINA'};
    const endpoints=[`${apiBase()}/ai/server-brain/delete`,`/api/ai/server-brain/delete`];
    for(const url of endpoints){try{const headers={'Content-Type':'application/json',Authorization:'Bearer '+s.token};if(ownerToken) headers['X-Owner-Token']=ownerToken;const r=await fetchJson(url,{method:'POST',headers,body:JSON.stringify(payload)});if(r.ok&&r.data?.ok){$('notice').className='notice ok';$('notice').innerHTML=`<span>🗑️</span><div><b>Articolo eliminato dal cervello.</b><span> ${esc(name)} rimosso dalla memoria server.</span></div>`;state.selectedKey='';await load();return;}logErr('brain-delete-failed',{url,status:r.status,body:r.data});}catch(e){logErr('brain-delete-error',{url,error:e.message||String(e)});}}
    alert('Eliminazione non riuscita. Copia errori e mandameli.');
  }

  async function deletePhotoFromBrain(photoId){
    const p=currentProduct();
    if(!p||!photoId){alert('Foto non trovata');return;}
    const ok=confirm('Vuoi eliminare questa foto dal cervello server? Se era sbagliata verrà rimossa dalla cartella articolo.');
    if(!ok) return;
    await saveOwnerUpdate({deletePhotoId:photoId},'Foto eliminata dal cervello ✅');
  }

  async function saveOwnerUpdate(updates,msg){const s=getSettings();const p=currentProduct();if(!p){alert('Seleziona un prodotto');return;}const ownerToken=getOwnerToken();const payload={householdId:s.householdId,key:p.key,updates,ownerToken};const endpoints=[`${apiBase()}/ai/server-brain/update`,`/api/ai/server-brain/update`];for(const url of endpoints){try{const headers={'Content-Type':'application/json',Authorization:'Bearer '+s.token};if(ownerToken) headers['X-Owner-Token']=ownerToken;const r=await fetchJson(url,{method:'POST',headers,body:JSON.stringify(payload)});if(r.ok&&r.data?.ok){$('notice').className='notice ok';$('notice').innerHTML=`<span>✅</span><div><b>${esc(msg||'Aggiornato')}</b><span> Rileggo la memoria server…</span></div>`;const keep=p.key;await load();state.selectedKey=keep;applyFilter();return;}logErr('owner-update-failed',{url,status:r.status,body:r.data});}catch(e){logErr('owner-update-error',{url,error:e.message||String(e)});}}alert('Salvataggio non riuscito. Copia errori e mandameli.');render();}
  async function copyText(txt,msg){try{await navigator.clipboard.writeText(redact(txt));alert(msg||'Copiato ✅')}catch{const ta=document.createElement('textarea');ta.value=redact(txt);document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();alert(msg||'Copiato ✅')}}
  let searchTimer=null;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(applyFilter,80);});$('search').addEventListener('keydown',e=>{if(e.key==='Enter')applyFilter();});$('deepSearch').addEventListener('change',e=>{state.includeDeep=!!e.target.checked;applyFilter();});$('ownerToken').value=getOwnerToken();$('ownerToken').addEventListener('input',e=>setOwnerToken(e.target.value));$('btnRefresh').onclick=load;$('btnClearSearch').onclick=()=>{$('search').value='';$('deepSearch').checked=false;state.includeDeep=false;applyFilter();};$('btnCopy').onclick=()=>copyText(JSON.stringify(state.brain||{},null,2),'Report cervello copiato ✅');$('btnCopyErrors').onclick=()=>copyText(JSON.stringify({realServerErrors:state.brain?.errors||[],learningCorrections:state.brain?.corrections||[],guardEvents:state.brain?.guardEvents||[],clientErrors:state.clientErrors,diagnosticCounts:state.brain?.diagnosticCountsV2869||null},null,2),'Console diagnostica copiata ✅');$('btnScrollSelected').onclick=()=>document.getElementById('detail')?.scrollIntoView({behavior:'smooth',block:'start'});
  renderClientErrors();load();
})();
