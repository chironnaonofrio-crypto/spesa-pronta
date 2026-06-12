
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
    const photos=arr(folder.photos,80);
    const current=folder.representativePhoto || photos.find(p=>p.id===folder.representativePhotoId) || null;
    const currentRaw=current?(current.thumbDataUrl||current.dataUrl||current.externalUrl||current.imageUrl||''):'';
    const currentSrc=currentRaw || profileSrc(f.profilePhoto);
    const isBadProfile=p=>/label|etichetta|barcode|ean|expiry|scadenza|ingredient|crop/i.test(String([p?.kind,p?.source,p?.id].join(' '))) && !/render_pro|product_white|product_transparent|product_front|owner_profile/i.test(String([p?.kind,p?.source,p?.id].join(' ')));
    const gallery=photos.length?`<div class="gallery">${photos.map(p=>{const src=p.thumbDataUrl||p.dataUrl||p.externalUrl||p.imageUrl||'';const active=p.id===folder.representativePhotoId;const allowed=!isBadProfile(p)&&!!src;const img=src?`<img src="${esc(src)}" alt="${esc(p.kind||'foto')}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'gph',textContent:'Anteprima alleggerita non disponibile'}))">`:`<div class="gph">Anteprima rimossa per RAM-safe<br>Rigenera o carica foto</div>`;return `<div class="gitem ${active?'active':''} ${src?'':'previewMissing'}">${img}<b>${esc(p.kind||'foto')}</b><small>${active?'Foto profilo attuale · ':''}score ${esc(p.score||0)} · ${esc(Math.round((p.bytes||0)/1024))} KB</small>${active?'<span class="activeBadge">SCELTA ORA</span>':(allowed?`<button class="ghost mini" data-rep-photo="${esc(p.id)}">Imposta come foto articolo</button>`:'<span class="chip warn">non usare come profilo</span>')}<button class="danger mini" data-delete-photo="${esc(p.id)}">Elimina foto</button></div>`}).join('')}</div>`:'<div class="empty">Nessuna foto reale salvata nella cartella. Puoi caricare/incollare qui la foto corretta oppure rigenerare il render GPU: la V31.7 mantiene preview leggere senza riempire la RAM.</div>';
    return `<div class="photoManager"><div class="photoPickerHero"><img class="currentProfile" id="ownerPhotoPreview" src="${esc(currentSrc)}" alt=""><div><h4>Foto profilo articolo</h4><p>Questa è l’immagine che rappresenta il prodotto nel cervello server. Se il server sceglie male, il titolare può correggerla: da quel momento questa foto vince sulla scelta automatica.</p><div class="chips"><span class="chip ${folder.profilePhotoLockedByOwner?'lock':'warn'}">${folder.profilePhotoLockedByOwner?'Foto bloccata dal titolare':'Scelta manuale consigliata'}</span><span class="chip ${photos.length?'ok':'warn'}">${photos.length} foto in cartella</span><span class="chip ok">preview leggere V31.7</span></div></div></div><div class="photoTools"><div class="photoNote">Ora il server non deve più rompere le immagini quando alleggerisce la RAM: conserva anteprime leggere, mentre le foto enormi vengono eliminate. Se una vecchia anteprima è già sparita, premi Render GPU PRO o carica una foto corretta.</div><div class="actions"><label class="fileBtn">📷 Carica foto corretta<input id="ownerPhotoFile" type="file" accept="image/*"></label><button class="primary" id="btnSaveOwnerPhoto">Salva come foto articolo</button></div><textarea id="ownerPhotoText" placeholder="Oppure incolla qui URL immagine https://... o data:image... base64 già compresso"></textarea><div class="photoPreviewRow" id="ownerPhotoPreviewRow"><img id="ownerPhotoPreviewSmall" alt=""><div>Foto pronta. Premi “Salva come foto articolo” per bloccarla nel cervello server.</div></div></div>${gallery}</div>`;
  }
  function renderOverview(f){return `<div class="section"><h3>🧾 Identità articolo</h3><div class="kv">${row('Nome',f.identity?.productName)}${row('Marca',f.identity?.brand)}${row('Formato',f.identity?.format)}${row('Categoria',f.classification?.category)}${row('Famiglia',f.classification?.categoryFamily)}${row('Unità',f.quantity?.unit)}${row('Barcode',f.barcode)}${row('Cartella oggetto',f.objectFolder?.folderId)}${row('Foto salvate',f.objectFolder?.photoCount)}${row('Aggiornato',fmtDate(f.timestamps?.updatedAt))}</div></div><div class="section"><h3>✅ Campi compilati</h3>${pills(f.filledFields,'Nessun campo compilato')}</div><div class="section"><h3>⚠️ Campi mancanti</h3>${pills(f.missingFields,'Nessun campo mancante')}</div><div class="section"><h3>🔎 Aspetto / firma</h3><div class="kv">${row('Colori',arr(f.visualAppearance?.colors,12).join(', '))}${row('Confezione',f.visualAppearance?.packageType||f.packaging)}${row('Tipo',f.visualAppearance?.productType)}${row('Firma visiva',f.visualAppearance?.visualSignature)}${row('Firma semantica',f.semanticVisualSignatureV2854?.signature)}${row('Regola firma',f.semanticVisualSignatureV2854?.rules)}</div></div>`}
  function renderData(f){return `<div class="section"><h3>🥫 Ingredienti</h3>${pills(f.ingredients,'Ingredienti non salvati')}</div><div class="section"><h3>🚨 Allergeni / tracce</h3>${pills([...(f.allergens||[]),...(f.possibleTraces||[])],'Allergeni o tracce non salvati')}</div><div class="section"><h3>👁️ Prove OCR / visive</h3>${pills([...(f.visibleEvidence||[]),...(f.detectedText||[])].slice(0,60),'Nessuna prova OCR salvata')}</div><div class="section"><h3>📦 Fonti / qualità</h3><div class="kv">${row('Affidabilità',f.reliability)}${row('Conferme',f.confirmations)}${row('Aiuto docente',f.teacherHelp)}${row('Riconoscimenti locali',f.localRecognitions)}${row('Fonti',Object.keys(f.sources||{}).join(', '))}</div></div>`}
  function renderSources(f){const ext=f.externalLearning||{};const refs=arr(ext.references||[],40);const imgs=arr(ext.referenceImages||[],40);const all=imgs.length?imgs:refs;const cards=all.length?`<div class="refGrid">${all.map(r=>`<div class="refCard">${r.imageUrl?`<img src="${esc(r.imageUrl)}" alt="">`:''}<b>${esc([r.productName,r.brand].filter(Boolean).join(' · ')||'Fonte esterna')}</b><small>${esc(r.sourceLabel||r.source||'Fonte')} ${r.code?'· EAN '+esc(r.code):''}</small><small>Score semantico: ${esc(ext.visualComparison?.semanticVisualScore??r.matchScore??r.confidence??'—')}</small>${r.imageUrl?`<a class="refLink" href="${esc(r.imageUrl)}" target="_blank" rel="noreferrer">Apri immagine riferimento</a>`:''}</div>`).join('')}</div>`:'<div class="empty">Nessuna fonte/foto riferimento esterna ancora salvata. Dopo barcode/API + conferma utente, qui vedrai le immagini e i dati usati dal server per imparare.</div>';return `<div class="section"><h3>🌍 Fonti esterne salvate</h3>${cards}</div><div class="section"><h3>🧠 Apprendimento da internet/API</h3><div class="kv">${row('Politica',ext.policy||'API propone, conferma utente/titolare rende memoria ufficiale')}${row('Stato confronto',ext.visualComparison?.status)}${row('Fonte riferimento',ext.visualComparison?.referenceSource)}${row('Foto riferimento',ext.visualComparison?.referenceImageUrl)}</div></div><div class="section"><h3>🧾 Fonti conoscenza</h3>${pills((f.knowledgeSources||[]).map(x=>[x.sourceLabel||x.source,x.category,x.confidence].filter(Boolean).join(' · ')),'Nessuna fonte conoscenza salvata')}</div>`}

  function renderVirtual(f){
    const product=currentProduct()||{};
    const folder=f.objectFolder||{};
    const refs=arr(folder.referenceCandidatesV3000||folder.referenceImagesV3000||[],20);
    const fallback=profileSrc(product.profilePhoto||f.profilePhoto||folder.representativePhoto);
    function srcOf(o){ if(!o) return ''; if(typeof o==='string') return o; return o.renderPro2D||o.renderPro||o.productTransparent||o.productWhite||o.transparentDataUrl||o.whiteDataUrl||o.displayUrl||o.imageDataUrl||o.dataUrl||o.thumbDataUrl||o.externalUrl||o.imageUrl||o.url||''; }
    const id=f.identity||{};
    const gpu=folder.gpuVisionV31||f.gpuVisionV31||{};
    const gpuImgs=gpu.images||{};
    const model=gpu.model3D||gpu.render360||folder.render360V3000||f.render360V3000||{};
    const frames=arr(model.frames||gpu.render3d?.frames||gpu.render3dFrames||[],36);
    const renderSrc=gpuImgs.renderPro2D||gpuImgs.renderPro||gpuImgs.productTransparent||gpuImgs.productWhite||model.front||fallback;
    const labelSrc=gpuImgs.labelOnly||gpuImgs.labelCrop||'';
    const front=model.front||gpuImgs.renderPro2D||gpuImgs.productTransparent||gpuImgs.productWhite||fallback;
    const back=model.back||'';
    const teacher=gpu.teacherOpenAI||gpu.openAiTeacher||{called:false,reason:'not_needed',result:'Nessuna chiamata OpenAI eseguita in questa analisi.'};
    const barcode=gpu.barcodeCandidate||gpu.product?.barcode||gpu.product?.ean||gpu.barcode||'';
    const labelText=gpu.labelBox?`${gpu.labelBox.confidence||'—'}% · ${gpu.labelBox.method||'label_only'}`:'non ancora rilevata';
    const refsStatus=refs.length?refs.length+' fonti':'fonti non ancora salvate';
    const candidatesHtml=refs.length?`<div class="v30RefGrid">${refs.slice(0,8).map(r=>`<div class="v30RefCard"><img src="${esc(srcOf(r)||fallback)}" data-fallback-src="${esc(fallback)}" alt="reference"><b>${esc(r.productName||r.title||'Reference')}</b><small>${esc(r.brand||'')} ${r.source?'· '+esc(r.source):''}</small><small>score ${esc(r.score||'—')}</small></div>`).join('')}</div>`:'<div class="empty">Nessuna fonte salvata. Il server usa prima foto profilo/frontale; fonti esterne solo per dettagli mancanti.</div>';
    const gpuSummary=gpu&&gpu.ok?`<div class="gpuBox"><h4><span>⚡ GPU Vision V31.7 · pipeline PRO V32</span><small>${esc(gpu.version||'31.7')}</small></h4><div class="gpuFacts"><span>${gpu.images?.renderPro2D?'render 2D pronto':'render da creare'}</span><span>${labelSrc?'etichetta pronta':'etichetta da estrarre'}</span><span>${model.front?'3D V32 pronto':'3D da creare'}</span><span>profilo: solo manuale</span></div></div>`:`<div class="gpuBox"><h4><span>⚡ GPU Vision V31.7</span><small>pronta</small></h4><div class="gpuFacts"><span class="warn">Usa i tre pulsanti: Render PRO, Etichetta, Render 360° 3D. Ogni funzione salva in memoria senza cambiare profilo da sola.</span></div></div>`;
    return `<div class="section"><h3>🧊 Render AI · GPU Vision V31.7</h3>
      <div class="v30Actions"><button class="primary" id="btnGpuRenderPro">Render PRO</button><button class="primary" id="btnGpuLabelOnly">Etichetta</button><button class="primary" id="btnGpu3DRender">Render 360° 3D</button><button class="ghost" id="btnGpuRenderForce">Rigenera Render PRO</button><button class="ghost" data-open-photos="1">Apri tab Foto</button><button class="ghost" id="btnGpuHealth">Test GPU</button></div>
      <div class="v30Info">V31.7: collegata al worker RunPod V32: Render PRO usa /render-pro, Etichetta usa /label-pro, Render 360° 3D usa /render-3d con fronte + retro e frames orbit generati dalla GPU.</div>
      ${gpuSummary}
      <div class="renderPipeline">
        <div class="v30Card"><h4><span>Render PRO 2D</span><small>${gpu.cached?'memoria':'profilo/frontale'}</small></h4><div class="renderBigImage"><img id="gpuRenderMain" src="${esc(renderSrc)}" alt="Render PRO 2D"></div><div class="saveDuo"><button class="ghost" id="btnSaveGpuGallery" ${renderSrc?'':'disabled'}>Salva foto in galleria</button><button class="primary" id="btnSaveGpuProfileMain" ${renderSrc?'':'disabled'}>Imposta come foto profilo</button></div><div class="gpuSourceNote">Il salvataggio in galleria non cambia la foto profilo. Il profilo cambia solo con il pulsante dedicato.</div></div>
        <div class="v30Card"><h4><span>Etichetta articolo</span><small>${labelSrc?'label':'da estrarre'}</small></h4><div class="labelStage">${labelSrc?`<img id="gpuLabelOnlyImg" src="${esc(labelSrc)}" alt="Solo etichetta">`:'<div class="empty">Premi Etichetta: il server sceglie la foto migliore tra fronte/retro e ritaglia solo la label.</div>'}</div><div class="v30Facts"><span>etichetta: ${esc(labelText)}</span><span>barcode: ${esc(barcode||'non rilevato')}</span></div></div>
        <div class="v30Card"><h4><span>Render 360° 3D</span><small>${esc(model.mode||'v32_depth_orbit')}</small></h4>${frames.length?`<div class="pro3dStage"><img class="pro3dFrameImg" id="gpu3dFrame" src="${esc(frames[0])}" alt="Frame 3D V32"></div>`:`<div class="pro3dStage"><div class="pro3dModel" id="gpu3dModel"><div class="pro3dShadow"></div><div class="pro3dSide pro3dLeft"></div><div class="pro3dSide pro3dRight"></div><div class="pro3dPlane pro3dFront"><img src="${esc(front||renderSrc||fallback)}" alt="Fronte 3D"></div><div class="pro3dPlane pro3dBack"><img src="${esc(back||front||renderSrc||fallback)}" alt="Retro 3D"></div></div></div>`}<script type="application/json" id="gpu3dFramesJson">${esc(JSON.stringify(frames))}