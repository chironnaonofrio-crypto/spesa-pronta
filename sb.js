
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
    return `<div class="photoManager"><div class="photoPickerHero"><img class="currentProfile" id="ownerPhotoPreview" src="${esc(currentSrc)}" alt=""><div><h4>Foto profilo articolo</h4><p>Questa è l’immagine che rappresenta il prodotto nel cervello server. Se il server sceglie male, il titolare può correggerla: da quel momento questa foto vince sulla scelta automatica.</p><div class="chips"><span class="chip ${folder.profilePhotoLockedByOwner?'lock':'warn'}">${folder.profilePhotoLockedByOwner?'Foto bloccata dal titolare':'Scelta manuale consigliata'}</span><span class="chip ${photos.length?'ok':'warn'}">${photos.length} foto in cartella</span><span class="chip ok">preview leggere V31.10</span></div></div></div><div class="photoTools"><div class="photoNote">Ora il server non deve più rompere le immagini quando alleggerisce la RAM: conserva anteprime leggere, mentre le foto enormi vengono eliminate. Se una vecchia anteprima è già sparita, premi Render GPU PRO o carica una foto corretta.</div><div class="actions"><label class="fileBtn">📷 Carica foto corretta<input id="ownerPhotoFile" type="file" accept="image/*"></label><button class="primary" id="btnSaveOwnerPhoto">Salva come foto articolo</button></div><textarea id="ownerPhotoText" placeholder="Oppure incolla qui URL immagine https://... o data:image... base64 già compresso"></textarea><div class="photoPreviewRow" id="ownerPhotoPreviewRow"><img id="ownerPhotoPreviewSmall" alt=""><div>Foto pronta. Premi “Salva come foto articolo” per bloccarla nel cervello server.</div></div></div>${gallery}</div>`;
  }
  function renderOverview(f){return `<div class="section"><h3>🧾 Identità articolo</h3><div class="kv">${row('Nome',f.identity?.productName)}${row('Marca',f.identity?.brand)}${row('Formato',f.identity?.format)}${row('Categoria',f.classification?.category)}${row('Famiglia',f.classification?.categoryFamily)}${row('Unità',f.quantity?.unit)}${row('Barcode',f.barcode)}${row('Cartella oggetto',f.objectFolder?.folderId)}${row('Foto salvate',f.objectFolder?.photoCount)}${row('Aggiornato',fmtDate(f.timestamps?.updatedAt))}</div></div><div class="section"><h3>✅ Campi compilati</h3>${pills(f.filledFields,'Nessun campo compilato')}</div><div class="section"><h3>⚠️ Campi mancanti</h3>${pills(f.missingFields,'Nessun campo mancante')}</div><div class="section"><h3>🔎 Aspetto / firma</h3><div class="kv">${row('Colori',arr(f.visualAppearance?.colors,12).join(', '))}${row('Confezione',f.visualAppearance?.packageType||f.packaging)}${row('Tipo',f.visualAppearance?.productType)}${row('Firma visiva',f.visualAppearance?.visualSignature)}${row('Firma semantica',f.semanticVisualSignatureV2854?.signature)}${row('Regola firma',f.semanticVisualSignatureV2854?.rules)}</div></div>`}
  function renderData(f){return `<div class="section"><h3>🥫 Ingredienti</h3>${pills(f.ingredients,'Ingredienti non salvati')}</div><div class="section"><h3>🚨 Allergeni / tracce</h3>${pills([...(f.allergens||[]),...(f.possibleTraces||[])],'Allergeni o tracce non salvati')}</div><div class="section"><h3>👁️ Prove OCR / visive</h3>${pills([...(f.visibleEvidence||[]),...(f.detectedText||[])].slice(0,60),'Nessuna prova OCR salvata')}</div><div class="section"><h3>📦 Fonti / qualità</h3><div class="kv">${row('Affidabilità',f.reliability)}${row('Conferme',f.confirmations)}${row('Aiuto docente',f.teacherHelp)}${row('Riconoscimenti locali',f.localRecognitions)}${row('Fonti',Object.keys(f.sources||{}).join(', '))}</div></div>`}
  function renderSources(f){const ext=f.externalLearning||{};const refs=arr(ext.references||[],40);const imgs=arr(ext.referenceImages||[],40);const all=imgs.length?imgs:refs;const cards=all.length?`<div class="refGrid">${all.map(r=>`<div class="refCard">${r.imageUrl?`<img src="${esc(r.imageUrl)}" alt="">`:''}<b>${esc([r.productName,r.brand].filter(Boolean).join(' · ')||'Fonte esterna')}</b><small>${esc(r.sourceLabel||r.source||'Fonte')} ${r.code?'· EAN '+esc(r.code):''}</small><small>Score semantico: ${esc(ext.visualComparison?.semanticVisualScore??r.matchScore??r.confidence??'—')}</small>${r.imageUrl?`<a class="refLink" href="${esc(r.imageUrl)}" target="_blank" rel="noreferrer">Apri immagine riferimento</a>`:''}</div>`).join('')}</div>`:'<div class="empty">Nessuna fonte/foto riferimento esterna ancora salvata. Dopo barcode/API + conferma utente, qui vedrai le immagini e i dati usati dal server per imparare.</div>';return `<div class="section"><h3>🌍 Fonti esterne salvate</h3>${cards}</div><div class="section"><h3>🧠 Apprendimento da internet/API</h3><div class="kv">${row('Politica',ext.policy||'API propone, conferma utente/titolare rende memoria ufficiale')}${row('Stato confronto',ext.visualComparison?.status)}${row('Fonte riferimento',ext.visualComparison?.referenceSource)}${row('Foto riferimento',ext.visualComparison?.referenceImageUrl)}</div></div><div class="section"><h3>🧾 Fonti conoscenza</h3>${pills((f.knowledgeSources||[]).map(x=>[x.sourceLabel||x.source,x.category,x.confidence].filter(Boolean).join(' · ')),'Nessuna fonte conoscenza salvata')}</div>`}

  function renderVirtual(f){
    const product=currentProduct()||{};
    const folder=f.objectFolder||{};
    const fallback=profileSrc(product.profilePhoto||f.profilePhoto||folder.representativePhoto);
    const gpu=(folder.gpuVisionV33||f.gpuVisionV33||folder.gpuVisionV31||f.gpuVisionV31||{});
    const imgs=gpu.images||{};
    const model=gpu.model3D||gpu.render360||folder.render360V3000||{};
    const gpuFresh=/31\.10|33\.2|premium-fix|quality/i.test(String([gpu.version,gpu.engine,gpu.renderPipelineVersion,gpu.profilePolicy].filter(Boolean).join(' ')));
    const labelMethod=String(gpu.labelBox?.method||'');
    const labelFresh=gpuFresh && /v33_1|v33|v31_10|anchor_component|label_only/i.test(labelMethod);
    const renderSrc=gpuFresh?(imgs.productWhite||imgs.productTransparent||imgs.renderPro2D||imgs.renderPro||fallback):fallback;
    const labelSrc=labelFresh?(imgs.labelOnly||imgs.labelCrop||''):'';
    const isReal3D=!!(model.realMeshGlb && model.glbDataUrl);
    const frames=Array.isArray(model.frames)?model.frames:[];
    const id=f.identity||{};
    const gpuSummary=gpu&&gpu.ok?`<div class="gpuBox"><h4><span>⚡ GPU Vision V31.10.1 · V33.2.1 QUALITY</span><small>${esc(gpu.version||'V33 richiesto')}</small></h4><div class="gpuFacts"><span>${gpuFresh&&renderSrc&&renderSrc!==fallback?'render 2D pronto':'render da creare'}</span><span>${labelSrc?'etichetta solo-label pronta':'etichetta da estrarre'}</span><span>${isReal3D?'GLB reale pronto':'3D reale da creare'}</span><span>profilo: solo manuale</span></div></div>`:`<div class="gpuBox"><h4><span>⚡ GPU Vision V31.10</span><small>modalità severa</small></h4><div class="gpuFacts"><span class="warn">Premi Render PRO / Etichetta / Render 360° 3D. Uso V33.2: veloce, solo-label, GLB reale.</span></div></div>`;
    const real3dSrc=(model.glbEndpoint||(`/api/gpu-vision/model-3d?key=${encodeURIComponent(String(p.key||''))}`)); const real3dHtml=isReal3D?`<model-viewer class="real3dViewer" src="${esc(real3dSrc)}" poster="${esc(renderSrc&&renderSrc!==fallback?renderSrc:'')}" camera-controls touch-action="pan-y" auto-rotate rotation-per-second="24deg" shadow-intensity="1.25" exposure="1.05" camera-orbit="45deg 68deg 145%" field-of-view="32deg" interaction-prompt="auto" ar ar-modes="webxr scene-viewer quick-look"></model-viewer><div class="renderActions"><a class="ghost" href="${esc(real3dSrc)}" target="_blank" rel="noreferrer">Apri modello 3D</a><a class="ghost" href="${esc(real3dSrc)}" download="spesa-pronta-prodotto.glb">Scarica GLB</a></div><div class="v30Facts"><span class="ok">GLB reale</span><span>${esc(model.engine||'TripoSR')}</span><span>${esc(model.note||'mesh generata da RunPod V33.2')}</span></div>`:(frames.length?`<div class="pro3dStage"><img class="pro3dFrameImg" id="gpu3dFrame" src="${esc(frames[0])}" alt="Frame V33"></div><textarea id="gpu3dFramesJson" hidden readonly>${esc(JSON.stringify(frames))}</textarea><div class="pro3dControls"><input id="gpu3dRange" type="range" min="0" max="${frames.length-1}" value="0"><div class="gpu360Hint" id="gpu3dLabel">Frame GPU: 1/${frames.length}</div></div><div class="v30Facts"><span class="warn">frame senza GLB</span><span>premi Render 360° 3D dopo upgrade V33 completo</span></div>`:`<div class="real3dEmpty">Nessun 3D reale pronto.<br>Premi “Render 360° 3D”. Se RunPod V33 non genera GLB, vedrai un errore chiaro: non mostro più il finto 3D piatto.</div>`);
    return `<div class="section"><h3>🧊 Render AI · GPU Vision V31.10 REAL 3D</h3>
      <div class="v30Actions"><button class="primary" id="btnGpuRenderPro">Render PRO</button><button class="primary" id="btnGpuLabelOnly">Etichetta</button><button class="primary" id="btnGpu3DRender">Render 360° 3D</button><button class="ghost" id="btnGpuRenderForce">Rigenera Render PRO</button><button class="ghost" data-open-photos="1">Apri tab Foto</button><button class="ghost" id="btnGpuHealth">Test GPU</button></div>
      <div class="v30Info">V31.10 QUALITY: Render PRO veloce con V33.2, Etichetta solo-label e 3D reale GLB. Render/label vecchi vengono nascosti: Render 3D non cancella più l’etichetta e il viewer GLB ha link diretto di sicurezza.</div>${gpuSummary}
      <div class="v30Grid">
        <div class="v30Card"><h4><span>Render PRO 2D</span><small>profilo/frontale</small></h4><div class="v30Stage"><img class="v30Img" id="v30OfficialRenderImg" src="${esc(renderSrc)}" data-fallback-src="${esc(fallback)}" alt="Render PRO"></div><div class="renderActions"><button class="ghost" id="btnGpuSaveGallery">Salva foto in galleria</button><button class="primary" id="btnGpuSetProfile">Imposta come foto profilo</button></div><div class="v30Facts"><span>salvataggio galleria ≠ profilo</span><span>profilo solo manuale</span></div></div>
        <div class="v30Card"><h4><span>Etichetta articolo</span><small>label</small></h4><div class="v30Stage">${labelSrc?`<img class="v30Img" src="${esc(labelSrc)}" alt="Etichetta articolo">`:'<div class="empty">Premi Etichetta: cerco solo la label tra le foto articolo.</div>'}</div><div class="v30Facts"><span>${labelSrc?'solo etichetta rilevata':'non ancora rilevata'}</span><span>${esc(labelMethod||'V33.2 label')}</span></div></div>
      </div>
      <div class="v30Card" style="margin-top:12px"><h4><span>Render 360° 3D reale</span><small>${esc(model.mode||'GLB mesh')}</small></h4>${real3dHtml}</div>
      <div class="v30Card" style="margin-top:12px"><h4><span>Fonti + docente OpenAI</span><small>audit</small></h4><div class="kv">${row('OpenAI chiamata',gpu.teacherOpenAI?.called?'sì':'no')}${row('Risultato docente',gpu.teacherOpenAI?.result||gpu.teacherOpenAI?.reason||'non chiamata')}${row('Worker',gpu.version||'—')}${row('3D reale',isReal3D?'sì':'no')}${row('Nome',id.productName||product.title)}${row('Marca',id.brand||product.brand)}${row('Formato',id.format||product.format)}${row('Categoria',f.classification?.category||product.category)}</div></div>
    </div>`;
  }

  async function loadV30ReferenceRender(force=false, sourceUrl=''){
    const p=currentProduct(); const s=getSettings(); const img=$('v30OfficialRenderImg'), status=$('v30OfficialStatus'), facts=$('v30OfficialFacts'), refBox=$('v30ReferenceList'), refStatus=$('v30ReferenceStatus');
    if(!p||!img) return;
    if(status) status.textContent=force?'cerco…':'controllo…';
    if(facts) facts.innerHTML='<span class="warn">cerco reference reali e creo render ufficiale</span>';
    try{
      const ownerToken=getOwnerToken(); const payload={householdId:s.householdId,key:p.key,sourceUrl};
      const endpoints=[`${apiBase()}/ai/server-brain/reference-render/search`,`/api/ai/server-brain/reference-render/search`];
      for(const url of endpoints){
        const headers={'Content-Type':'application/json',Authorization:'Bearer '+s.token}; if(ownerToken) headers['X-Owner-Token']=ownerToken;
        const r=await fetchJson(url,{method:'POST',headers,body:JSON.stringify(payload),cache:'no-store'});
        if(r.ok&&r.data?.ok){
          const o=r.data.officialRender||r.data.render||{}; const src=o.transparentDataUrl||o.officialDataUrl||o.officialRenderDataUrl||o.whiteDataUrl||o.studioDataUrl||''; if(src) img.src=src;
          if(status) status.textContent=o.quality?.level||o.mode||'ok';
          if(facts) facts.innerHTML=`<span class="ok">${esc(o.quality?.message||'render ufficiale salvato')}</span><span>score ${esc(o.quality?.score||o.qualityScore||'—')}</span><span>${esc(o.source||o.reference?.source||'reference')}</span>`;
          const refs=arr(r.data.references||r.data.candidates,12); if(refStatus) refStatus.textContent=refs.length?refs.length+' fonti':'fonti salvate';
          if(refBox&&refs.length){ refBox.innerHTML=`<div class="v30RefGrid">${refs.slice(0,8).map(ref=>`<div class="v30RefCard"><img src="${esc(ref.displayUrl||ref.imageDataUrl||ref.imageUrl||'')}" alt="reference"><b>${esc(ref.productName||ref.title||'Reference')}</b><small>${esc(ref.brand||'')} ${ref.source?'· '+esc(ref.source):''}</small><small>score ${esc(ref.score||'—')}</small><button class="ghost mini" data-v30-use-ref="${esc(ref.imageUrl||'')}">Usa come render</button></div>`).join('')}</div>`; v30BindReferenceButtons(); }
          p.fields.objectFolder=p.fields.objectFolder||{}; p.fields.objectFolder.officialRenderV3000=o; p.fields.objectFolder.referenceImagesV3000=refs; p.fields.objectFolder.referenceCandidatesV3000=refs;
          $('notice').className='notice ok'; $('notice').innerHTML='<span>🧊</span><div><b>Render ufficiale V30 creato.</b><span> Salvato nel cervello server senza OpenAI.</span></div>';
          return;
        }
        const msg=r.data?.message||r.data?.googleTest?.message||r.data?.error||'ricerca fallita';
        const cfg=r.data?.configured?`api ${r.data.configured.apiKey?'ok':'NO'} · cx ${r.data.configured.cx?'ok':'NO'}`:'';
        const g=r.data?.googleTest?`Google: ${r.data.googleTest.error||'ok'} · risultati ${r.data.googleTest.count||0}${r.data.googleTest.blocked?' · API Google bloccata':''}`:'';
        if(status) status.textContent='diagnosi';
        if(facts) facts.innerHTML=`<span class="warn">${esc(msg)}</span>${cfg?`<span>${esc(cfg)}</span>`:''}${g?`<span>${esc(g)}</span>`:''}`;
        logErr('v30-generate-official-failed',{url,status:r.status,body:r.data});
      }
    }catch(e){ logErr('v30-generate-official-error',{error:e.message||String(e)}); if(facts) facts.innerHTML=`<span class="warn">errore pagina: ${esc(e.message||String(e))}</span>`; }
    if(status) status.textContent='non riuscito';
  }
  async function loadRealPixelRender(force=false){ return loadV30ReferenceRender(force); }

  async function v30TestGoogleApi(){
    const p=currentProduct(); const f=p?.fields||{}; const id=f.identity||{};
    const q=[id.brand||p?.brand,id.productName||p?.title,id.format||p?.format].filter(Boolean).join(' ')||'Dexal Candeggina Delicata Maxi';
    const status=$('v30OfficialStatus'), facts=$('v30OfficialFacts'), refBox=$('v30ReferenceList'), refStatus=$('v30ReferenceStatus');
    if(status) status.textContent='test Google';
    if(facts) facts.innerHTML='<span class="warn">test Google CSE in corso</span>';
    try{
      const r=await fetchJson(`/api/ai/google-cse-test?q=${encodeURIComponent(q)}`,{cache:'no-store'});
      const data=r.data||{};
      if(status) status.textContent=data.ok?'Google ok':'Google errore';
      if(facts) facts.innerHTML=`<span class="${data.ok?'ok':'warn'}">${data.ok?'Google CSE risponde':(data.googleApiBlocked?'Google JSON API bloccata: provo harvester automatico':'Google CSE/harvester non risponde')}</span><span>api ${data.configured?.apiKey?'ok':'NO'} · cx ${data.configured?.cx?'ok':'NO'}</span><span>risultati ${esc(data.count||0)} / total ${esc(data.totalResults||0)}</span>${data.error?`<span>${esc(data.error)}</span>`:''}${data.message?`<span>${esc(data.message)}</span>`:''}`;
      const items=arr(data.items,8);
      if(refStatus) refStatus.textContent=items.length?items.length+' test':'test';
      if(refBox&&items.length){ refBox.innerHTML=`<div class="v30RefGrid">${items.map(it=>`<div class="v30RefCard"><img src="${esc(it.link||'')}" alt="test"><b>${esc(it.title||'Risultato Google')}</b><small>${esc(it.displayLink||'')}</small><button class="ghost mini" data-v30-use-ref="${esc(it.link||'')}">Usa come render</button></div>`).join('')}</div>`; v30BindReferenceButtons(); }
    }catch(e){ if(status) status.textContent='test fallito'; if(facts) facts.innerHTML=`<span class="warn">${esc(e.message||String(e))}</span>`; }
  }

  function v30BindReferenceButtons(){ document.querySelectorAll('[data-v30-use-ref]').forEach(btn=>btn.onclick=()=>importV30ReferenceUrl(btn.getAttribute('data-v30-use-ref')||'')); }
  async function importV30ReferenceUrl(urlArg=''){
    const p=currentProduct(); const s=getSettings(); if(!p) return;
    const url=String(urlArg||$('v30ImportUrl')?.value||prompt('Incolla URL immagine prodotto da Google / sito / supermercato','')||'').trim(); if(!url) return;
    const img=$('v30OfficialRenderImg'), status=$('v30OfficialStatus'), facts=$('v30OfficialFacts'); if(status) status.textContent='importo URL'; if(facts) facts.innerHTML='<span class="warn">scarico immagine e pulisco render</span>';
    try{
      const ownerToken=getOwnerToken(); const payload={householdId:s.householdId,key:p.key,imageUrl:url,generate:true}; const endpoints=[`${apiBase()}/ai/server-brain/reference-render/import`,`/api/ai/server-brain/reference-render/import`];
      for(const ep of endpoints){ const headers={'Content-Type':'application/json',Authorization:'Bearer '+s.token}; if(ownerToken) headers['X-Owner-Token']=ownerToken; const r=await fetchJson(ep,{method:'POST',headers,body:JSON.stringify(payload),cache:'no-store'}); if(r.ok&&r.data?.ok){ const o=r.data.officialRender||r.data.generated?.officialRender||r.data.render||{}; const src=o.transparentDataUrl||o.officialDataUrl||o.whiteDataUrl||r.data.reference?.displayUrl||''; if(img&&src) img.src=src; if(status) status.textContent=o.quality?.level||'importato'; if(facts) facts.innerHTML=`<span class="ok">URL importato come render ufficiale</span><span>${esc(r.data.reference?.source||'URL titolare')}</span>`; p.fields.objectFolder=p.fields.objectFolder||{}; p.fields.objectFolder.officialRenderV3000=o; p.fields.objectFolder.referenceCandidatesV3000=arr(r.data.candidates||r.data.references,12); p.fields.objectFolder.referenceImagesV3000=p.fields.objectFolder.referenceCandidatesV3000; return; } logErr('v30-import-url-failed',{url:ep,status:r.status,body:r.data}); }
    }catch(e){ logErr('v30-import-url-error',{error:e.message||String(e)}); }
    alert('Import URL non riuscito. Prova un URL immagine diretto .jpg/.png/.webp');
  }

  async function loadOnlineReference(force=false){
    const p=currentProduct(); const s=getSettings(); const box=$('v30ReferenceList'), status=$('v30ReferenceStatus'); if(!p||!box) return;
    if(status) status.textContent='cerco…';
    try{
      const ownerToken=getOwnerToken(); const endpoints=[`${apiBase()}/ai/server-brain/reference-render/search?householdId=${encodeURIComponent(s.householdId)}&key=${encodeURIComponent(p.key)}&force=1&ts=${Date.now()}`,`/api/ai/server-brain/reference-render/search?householdId=${encodeURIComponent(s.householdId)}&key=${encodeURIComponent(p.key)}&force=1&ts=${Date.now()}`];
      for(const url of endpoints){ const headers={Authorization:'Bearer '+s.token}; if(ownerToken) headers['X-Owner-Token']=ownerToken; const r=await fetchJson(url,{headers,cache:'no-store'}); if(r.ok&&r.data?.ok){ const refs=arr(r.data.references||r.data.candidates,12); if(status) status.textContent=refs.length?refs.length+' fonti':'non trovate'; box.innerHTML=refs.length?`<div class="v30RefGrid">${refs.slice(0,8).map(ref=>`<div class="v30RefCard"><img src="${esc(ref.displayUrl||ref.imageDataUrl||ref.imageUrl||'')}" alt="reference"><b>${esc(ref.productName||ref.title||'Reference')}</b><small>${esc(ref.brand||'')} ${ref.source?'· '+esc(ref.source):''}</small><small>score ${esc(ref.score||'—')}</small><button class="ghost mini" data-v30-use-ref="${esc(ref.imageUrl||'')}">Usa come render</button></div>`).join('')}</div>`:'<div class="empty">Nessuna reference trovata. Incolla URL immagine da Google/sito.</div>'; v30BindReferenceButtons(); p.fields.objectFolder=p.fields.objectFolder||{}; p.fields.objectFolder.referenceImagesV3000=refs; p.fields.objectFolder.referenceCandidatesV3000=refs; return; } }
    }catch(e){ logErr('v30-reference-search-error',{error:e.message||String(e)}); }
    if(status) status.textContent='errore';
  }



  async function gpuVisionHealth(){
    const s=getSettings(); const notice=$('notice');
    if(notice){notice.className='notice warn';notice.innerHTML='<span>⚡</span><div><b>Controllo GPU Vision…</b><span>Verifico RunPod tramite server Render.</span></div>';}
    try{
      const r=await fetchJson(`/api/gpu-vision/health?householdId=${encodeURIComponent(s.householdId||'')}`,{headers:{Authorization:'Bearer '+s.token},cache:'no-store'});
      const data=r.data||{};
      if(notice){notice.className=data.ok?'notice ok':'notice bad';notice.innerHTML=`<span>⚡</span><div><b>GPU Vision ${data.ok?'online':'non pronta'}</b><span>${esc(JSON.stringify({enabled:data.enabled,version:data.gpuResponse?.version||data.version,cuda:data.gpuResponse?.cuda,gpu:data.gpuResponse?.gpu,config:data.config},null,0))}</span></div>`;}
      alert(JSON.stringify(data,null,2));
    }catch(e){ if(notice){notice.className='notice bad';notice.innerHTML=`<span>⚠️</span><div><b>Errore GPU Vision</b><span>${esc(e.message||String(e))}</span></div>`;} }
  }
  async function gpuVisionAnalyzeSelected(mode='analyze', force=false){
    const p=currentProduct(); const s=getSettings(); if(!p){alert('Seleziona un prodotto');return;}
    state.gpuBusy=state.gpuBusy||{};
    const busyKey=mode+(force?':force':':cache');
    if(state.gpuBusy[busyKey]){ alert('GPU Vision è già in lavorazione, evita doppi click bro 🙂'); return; }
    state.gpuBusy[busyKey]=true;
    const buttons=[...document.querySelectorAll('#btnGpuAnalyzeProduct,#btnGpuRenderProduct,#btnGpuRenderForce,#btnGpu360Refresh')];
    buttons.forEach(b=>{b.disabled=true;b.dataset.oldText=b.textContent;b.textContent='Lavoro…';});
    const notice=$('notice'); if(notice){notice.className='notice warn';notice.innerHTML=`<span>⚡</span><div><b>${force?'Rigenerazione':(mode==='render'?'Render':'Analisi')} GPU in corso…</b><span>${force?'Forzo nuovo render.':'Se esiste già in memoria non lo rifaccio.'}</span></div>`;}
    try{
      const url=mode==='render'?'/api/gpu-vision/render':'/api/gpu-vision/analyze';
      const r=await fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token},body:JSON.stringify({householdId:s.householdId,key:p.key,force:!!force}),cache:'no-store'});
      const data=r.data||{};
      if(r.ok && data.ok){
        p.fields.objectFolder=p.fields.objectFolder||{};
        p.fields.objectFolder.gpuVisionV31=data.savedGpuVision||data.gpuVision||data;
        if(notice){notice.className='notice ok';notice.innerHTML=`<span>⚡</span><div><b>GPU Vision completata.</b><span>${data.cached?'Usato render già in memoria, zero nuovi download.':'Prodotto, etichetta, fonti e 360° aggiornati.'}</span></div>`;}
        await load(); state.selectedKey=p.key; state.tab='render'; applyFilter();
      }else{
        const msg=data.reason||data.error||data.message||data.raw||('HTTP '+r.status);
        if(notice){notice.className='notice bad';notice.innerHTML=`<span>⚠️</span><div><b>GPU Vision non riuscita</b><span>${esc(msg)}</span></div>`;}
        alert(JSON.stringify(data&&Object.keys(data).length?data:{status:r.status,error:msg},null,2));
      }
    }catch(e){ if(notice){notice.className='notice bad';notice.innerHTML=`<span>⚠️</span><div><b>Errore chiamata GPU</b><span>${esc(e.message||String(e))}</span></div>`;} }
    finally{
      state.gpuBusy[busyKey]=false;
      buttons.forEach(b=>{b.disabled=false;if(b.dataset.oldText)b.textContent=b.dataset.oldText;});
    }
  }


  async function gpuVisionProAction(action='render-pro', force=false){
    const p=currentProduct(); const s=getSettings(); if(!p){alert('Seleziona un prodotto');return;}
    state.gpuBusy=state.gpuBusy||{}; const busyKey=action+(force?':force':':cache');
    if(state.gpuBusy[busyKey]){ alert('Sto già lavorando su questa azione GPU 🙂'); return; }
    state.gpuBusy[busyKey]=true;
    const buttons=[...document.querySelectorAll('#btnGpuRenderPro,#btnGpuLabelOnly,#btnGpu3DRender,#btnGpuRenderForce')];
    buttons.forEach(b=>{b.disabled=true;b.dataset.oldText=b.textContent;b.textContent='Lavoro…';});
    const notice=$('notice'); if(notice){notice.className='notice warn';notice.innerHTML=`<span>⚡</span><div><b>${esc(action)} in corso…</b><span>Uso foto articolo e cervello GPU/server.</span></div>`;}
    try{
      const url= action==='label' ? '/api/gpu-vision/label' : action==='render-3d' ? '/api/gpu-vision/render-3d' : '/api/gpu-vision/render-pro';
      const r=await fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token},body:JSON.stringify({householdId:s.householdId,key:p.key,force:!!force}),cache:'no-store'});
      const data=r.data||{};
      if(r.ok && data.ok){ if(notice){notice.className='notice ok';notice.innerHTML=`<span>✅</span><div><b>${esc(data.title||'GPU aggiornata')}</b><span>${esc(data.message||'Memoria render aggiornata.')}</span></div>`;} await load(); state.selectedKey=p.key; state.tab='render'; applyFilter(); }
      else { const msg=data.message||data.reason||data.error||data.raw||('HTTP '+r.status); if(notice){notice.className='notice bad';notice.innerHTML=`<span>⚠️</span><div><b>Azione GPU non riuscita</b><span>${esc(msg)}</span></div>`;} alert(JSON.stringify(data&&Object.keys(data).length?data:{status:r.status,error:msg},null,2)); }
    }catch(e){ if(notice){notice.className='notice bad';notice.innerHTML=`<span>⚠️</span><div><b>Errore GPU</b><span>${esc(e.message||String(e))}</span></div>`;} }
    finally{ state.gpuBusy[busyKey]=false; buttons.forEach(b=>{b.disabled=false;if(b.dataset.oldText)b.textContent=b.dataset.oldText;}); }
  }
  async function saveGpuRenderToGallery(){
    const p=currentProduct(); const s=getSettings(); if(!p){alert('Seleziona un prodotto');return;}
    const notice=$('notice');
    try{
      const r=await fetchJson('/api/gpu-vision/save-gallery',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token},body:JSON.stringify({householdId:s.householdId,key:p.key,imageKey:'renderPro2D'}),cache:'no-store'});
      const data=r.data||{};
      if(r.ok&&data.ok){ if(notice){notice.className='notice ok';notice.innerHTML='<span>✅</span><div><b>Foto salvata in galleria.</b><span>Non è stata impostata come profilo.</span></div>'; } await load(); state.selectedKey=p.key; state.tab='photos'; applyFilter(); }
      else alert(JSON.stringify(data,null,2));
    }catch(e){ alert('Salvataggio galleria non riuscito: '+(e.message||String(e))); }
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
    d.querySelector('#btnV30SearchRender')?.addEventListener('click',()=>loadV30ReferenceRender(true));
    d.querySelector('#btnV30ImportUrl')?.addEventListener('click',()=>importV30ReferenceUrl());
    d.querySelector('#btnV30OpenOfficial')?.addEventListener('click',()=>{const src=(d.querySelector('#v30OfficialRenderImg')?.src)||(currentProduct()?.fields?.objectFolder?.officialRenderV3000?.officialDataUrl)||(currentProduct()?.fields?.objectFolder?.officialRenderV3000?.studioDataUrl)||'';const w=window.open('about:blank','_blank');if(w){w.document.write('<title>Render ufficiale V30</title><body style="margin:0;background:#f4f8ff;display:grid;place-items:center;min-height:100vh"><img style="max-width:96vw;max-height:96vh;object-fit:contain;border-radius:22px" src="'+String(src).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></body>');}});
    d.querySelector('#btnV30CopySources')?.addEventListener('click',()=>copyText(JSON.stringify(currentProduct()?.fields?.objectFolder?.referenceImagesV3000||currentProduct()?.fields?.objectFolder?.referenceCandidatesV3000||[],null,2),'Fonti render copiate ✅'));
    d.querySelector('#btnV30TestGoogle')?.addEventListener('click',v30TestGoogleApi);
    d.querySelector('#btnV302ForceMarker')?.addEventListener('click',()=>alert('V31.10 attiva ✅ V33.2 quality + label-only + real GLB'));
    d.querySelector('#btnGpuRenderPro')?.addEventListener('click',()=>gpuVisionProAction('render-pro',false));
    d.querySelector('#btnGpuLabelOnly')?.addEventListener('click',()=>gpuVisionProAction('label',false));
    d.querySelector('#btnGpu3DRender')?.addEventListener('click',()=>gpuVisionProAction('render-3d',false));
    d.querySelector('#btnGpuRenderForce')?.addEventListener('click',()=>gpuVisionProAction('render-pro',true));
    d.querySelectorAll('[data-rot-src]').forEach(btn=>btn.addEventListener('click',()=>{ const main=d.querySelector('#gpu360Main'); const label=d.querySelector('#gpu360Label'); if(main){ main.src=btn.dataset.rotSrc||main.src; } if(label){ label.textContent='Vista attuale: '+(btn.dataset.rotLabel||'Vista'); }}));
    d.querySelectorAll('[data-save-gpu-src]').forEach(btn=>btn.addEventListener('click',()=>{ const src=btn.getAttribute('data-save-gpu-src')||''; if(!src){alert('Immagine GPU non disponibile');return;} saveOwnerUpdate(/^https?:\/\//i.test(src)?{profilePhotoUrl:src}:{profilePhotoDataUrl:src},'Foto profilo prodotto aggiornata dal render GPU ✅'); }));
    d.querySelector('#btnSaveGpuProfileMain')?.addEventListener('click',()=>{ const src=d.querySelector('#gpuRenderMain')?.src||''; if(!src){alert('Render GPU non disponibile');return;} saveOwnerUpdate(/^https?:\/\//i.test(src)?{profilePhotoUrl:src}:{profilePhotoDataUrl:src},'Render GPU impostato come foto profilo ✅'); });
    d.querySelector('#btnSaveGpuGallery')?.addEventListener('click',saveGpuRenderToGallery);
    const get3dFrames=()=>{try{return JSON.parse(d.querySelector('#gpu3dFramesJson')?.textContent||'[]')||[]}catch{return []}};
    const set3d=(deg)=>{ const frames=get3dFrames(); const frame=d.querySelector('#gpu3dFrame'); const model=d.querySelector('#gpu3dModel'); const label=d.querySelector('#gpu3dLabel'); const range=d.querySelector('#gpu3dRange'); if(frames.length&&frame){ const idx=Math.max(0,Math.min(frames.length-1,Math.round(deg))); frame.src=frames[idx]; if(range) range.value=idx; if(label) label.textContent='Frame GPU V32: '+(idx+1)+'/'+frames.length; return; } if(model){ model.style.setProperty('--rot',deg+'deg'); } if(range) range.value=deg; if(label){ label.textContent='Ruota 3D: '+deg+'°'; } };
    d.querySelector('#gpu3dRange')?.addEventListener('input',ev=>set3d(Number(ev.target.value||0)));
    d.querySelectorAll('[data-3d-deg]').forEach(btn=>btn.addEventListener('click',()=>set3d(Number(btn.getAttribute('data-3d-deg')||0))));
    d.querySelector('#gpu360Range')?.addEventListener('input',ev=>{ const deg=Number(ev.target.value||0); const main=d.querySelector('#gpu360Main'); const label=d.querySelector('#gpu360Label'); const sx=Math.max(.42,Math.abs(Math.cos(deg*Math.PI/180))).toFixed(2); if(main){ main.style.setProperty('--ry',deg+'deg'); main.style.setProperty('--sx',sx); } if(label){ label.textContent='Ruota virtuale: '+deg+'°'; } });
    if(state.tab==='render'){ v30BindReferenceButtons(); }
    d.querySelector('#btnRenderTransparent')?.addEventListener('click',()=>{const src=(currentProduct()?.fields?.objectFolder?.gpuVisionV31?.images?.productTransparent)||(currentProduct()?.fields?.gpuVisionV31?.images?.productTransparent)||''; if(src){const w=window.open('about:blank','_blank'); if(w){w.document.write('<title>PNG pulito</title><body style="margin:0;background:#f4f8ff;display:grid;place-items:center;min-height:100vh"><img style="max-width:96vw;max-height:96vh;object-fit:contain;border-radius:22px" src="'+String(src).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></body>');}} else {refreshVirtualRender('transparent');}});
    d.querySelector('#btnRenderWhite')?.addEventListener('click',()=>{const src=(currentProduct()?.fields?.objectFolder?.gpuVisionV31?.images?.productWhite)||(currentProduct()?.fields?.gpuVisionV31?.images?.productWhite)||''; if(src){const w=window.open('about:blank','_blank'); if(w){w.document.write('<title>Sfondo bianco</title><body style="margin:0;background:#f4f8ff;display:grid;place-items:center;min-height:100vh"><img style="max-width:96vw;max-height:96vh;object-fit:contain;border-radius:22px" src="'+String(src).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></body>');}} else {refreshVirtualRender('white');}});
    d.querySelector('#btnOpenRenderImage')?.addEventListener('click',()=>{const src=(d.querySelector('#gpu360Main')?.src)||(currentProduct()?.fields?.objectFolder?.gpuVisionV31?.images?.renderPro)||(currentProduct()?.fields?.objectFolder?.gpuVisionV31?.images?.productTransparent)||(currentProduct()?.fields?.objectFolder?.gpuVisionV31?.images?.productWhite)||''; const w=window.open('about:blank','_blank'); if(w&&src){w.document.write('<title>Render AI</title><body style="margin:0;background:#f4f8ff;display:grid;place-items:center;min-height:100vh"><img style="max-width:96vw;max-height:96vh;object-fit:contain;border-radius:22px" src="'+String(src).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></body>');} });
    d.querySelector('#btnCopyRenderSvg')?.addEventListener('click',()=>copyText(JSON.stringify((currentProduct()?.fields?.objectFolder?.gpuVisionV31)||(currentProduct()?.fields?.gpuVisionV31)||{},null,2),'JSON GPU copiato ✅'));
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
  let searchTimer=null;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(applyFilter,80);});$('search').addEventListener('keydown',e=>{if(e.key==='Enter')applyFilter();});$('deepSearch').addEventListener('change',e=>{state.includeDeep=!!e.target.checked;applyFilter();});$('ownerToken').value=getOwnerToken();$('ownerToken').addEventListener('input',e=>setOwnerToken(e.target.value));$('btnRefresh').onclick=load;$('btnClearSearch').onclick=()=>{$('search').value='';$('deepSearch').checked=false;state.includeDeep=false;applyFilter();};$('btnCopy').onclick=()=>copyText(JSON.stringify(state.brain||{},null,2),'Report cervello copiato ✅');$('btnCopyErrors').onclick=()=>copyText(JSON.stringify({realServerErrors:state.brain?.errors||[],learningCorrections:state.brain?.corrections||[],guardEvents:state.brain?.guardEvents||[],clientErrors:state.clientErrors,diagnosticCounts:state.brain?.diagnosticCountsV2869||null},null,2),'Console diagnostica copiata ✅');$('btnScrollSelected').onclick=()=>document.getElementById('detail')?.scrollIntoView({behavior:'smooth',block:'start'}); if($('btnGpuHealth')) $('btnGpuHealth').onclick=gpuVisionHealth;
  renderClientErrors();load();
})();
