// ─── Two-Panel Chart Engine ───────────────────────────────────────────────────

function chartSMA(closes, period) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const s = closes.slice(i - period + 1, i + 1);
    return s.reduce((a, b) => a + b, 0) / period;
  });
}

function chartBollinger(closes, period=20, mult=2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const s = closes.slice(i - period + 1, i + 1);
    const sma = s.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(s.reduce((a, b) => a + (b-sma)**2, 0) / period);
    return { mid: sma, upper: sma + mult*std, lower: sma - mult*std };
  });
}

function chartRSI(closes, period=14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period+1) return out;
  let ag=0, al=0;
  for (let i=1; i<=period; i++) { const d=closes[i]-closes[i-1]; if(d>=0) ag+=d; else al-=d; }
  ag/=period; al/=period;
  out[period] = al===0 ? 100 : 100 - 100/(1+ag/al);
  for (let i=period+1; i<closes.length; i++) {
    const d=closes[i]-closes[i-1];
    ag=(ag*(period-1)+Math.max(d,0))/period;
    al=(al*(period-1)+Math.max(-d,0))/period;
    out[i] = al===0 ? 100 : 100 - 100/(1+ag/al);
  }
  return out;
}

function chartMACD(closes) {
  const k12=2/13, k26=2/27, k9=2/10;
  let e12=closes[0], e26=closes[0], eSig=null;
  const macdLine=[], signalLine=[], histogram=[];
  closes.forEach((c,i) => {
    e12 = i===0 ? c : c*k12 + e12*(1-k12);
    e26 = i===0 ? c : c*k26 + e26*(1-k26);
    const m = e12-e26; macdLine.push(m);
    if (i<25) { signalLine.push(null); histogram.push(null); return; }
    eSig = eSig===null ? m : m*k9 + eSig*(1-k9);
    signalLine.push(eSig); histogram.push(m-eSig);
  });
  return { macdLine, signalLine, histogram };
}

function toSvgY(v, minV, maxV, top, bottom) {
  if (maxV===minV) return (top+bottom)/2;
  return bottom - ((v-minV)/(maxV-minV))*(bottom-top);
}

function svgPolyline(pairs, xFn, yFn) {
  return pairs.filter(([,v])=>v!==null&&!isNaN(v))
    .map(([i,v])=>`${xFn(i).toFixed(2)},${yFn(v).toFixed(2)}`).join(' ');
}

function buildPricePanel(raw, sma50All, sma200All, bollingerAll, sliceStart, W, H, PAD, id, purchaseDate) {
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const data=raw.slice(sliceStart), sma50=sma50All.slice(sliceStart);
  const sma200=sma200All.slice(sliceStart), bollinger=bollingerAll.slice(sliceStart);
  const closes=data.map(d=>d.c), n=closes.length;
  if (n<2) return '<div style="color:var(--text3);font-size:12px;padding:20px;text-align:center">Not enough data</div>';
  const allVals=[...closes,...bollinger.filter(Boolean).flatMap(b=>[b.upper,b.lower]),...sma50.filter(Boolean),...sma200.filter(Boolean)];
  const minY=Math.min(...allVals)*0.998, maxY=Math.max(...allVals)*1.002;
  const xFn=i=>PAD.l+(i/(n-1))*cW, yFn=v=>toSvgY(v,minY,maxY,PAD.t,PAD.t+cH);
  const isUp=closes[n-1]>=closes[0], priceC=isUp?'#00c97a':'#ff4d4d';
  const pricePts=closes.map((c,i)=>`${xFn(i).toFixed(2)},${yFn(c).toFixed(2)}`).join(' ');
  const fillPts=`${xFn(0).toFixed(2)},${(PAD.t+cH).toFixed(2)} ${pricePts} ${xFn(n-1).toFixed(2)},${(PAD.t+cH).toFixed(2)}`;
  const bbUpPts=svgPolyline(bollinger.map((b,i)=>[i,b?.upper]),xFn,yFn);
  const bbLoPts=svgPolyline(bollinger.map((b,i)=>[i,b?.lower]),xFn,yFn);
  const bbMidPts=svgPolyline(bollinger.map((b,i)=>[i,b?.mid]),xFn,yFn);
  const bbFillPts=[...bollinger.map((b,i)=>b?`${xFn(i).toFixed(2)},${yFn(b.upper).toFixed(2)}`:null).filter(Boolean),...bollinger.map((b,i)=>b?`${xFn(i).toFixed(2)},${yFn(b.lower).toFixed(2)}`:null).filter(Boolean).reverse()].join(' ');
  const yTicks=[0,0.25,0.5,0.75,1].map(p=>minY+p*(maxY-minY));
  const xLabels=data.reduce((acc,d,i)=>{const dt=new Date(d.t);if(i===0||dt.getDate()===1)acc.push({i,label:dt.toLocaleDateString('en-US',{month:'short'})});return acc;},[]).slice(0,5);
  const legend=[{c:priceC,l:'Price',dash:false},{c:'#4a9eff',l:'SMA 50',dash:false},{c:'#f5a623',l:'SMA 200',dash:false},{c:'#7c6fcd',l:'BB',dash:true}];

  // ── Purchase date marker ──
  let purchaseMarkerSVG = '';
  if (purchaseDate) {
    const purchaseTs = new Date(purchaseDate + 'T00:00:00').getTime();
    // Find the data index closest to the purchase date within the sliced window
    let markerIdx = -1;
    let minDiff = Infinity;
    data.forEach((d, i) => {
      const diff = Math.abs(d.t - purchaseTs);
      if (diff < minDiff) { minDiff = diff; markerIdx = i; }
    });
    // Only draw if the purchase date falls within the visible window
    // (allow up to 3 days outside the start to catch weekends/holidays)
    const windowStart = data[0]?.t - 3 * 86400000;
    const windowEnd   = data[data.length - 1]?.t;
    if (markerIdx >= 0 && purchaseTs >= windowStart && purchaseTs <= windowEnd) {
      const mx = xFn(markerIdx).toFixed(2);
      const labelY = (PAD.t + 14).toFixed(2);
      const lineTop = PAD.t.toFixed(2);
      const lineBot = (PAD.t + cH).toFixed(2);
      purchaseMarkerSVG = [
        // Dashed vertical line
        `<line x1="${mx}" y1="${lineTop}" x2="${mx}" y2="${lineBot}"`,
        ` stroke="#f5a623" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.9"/>`,
        // Diamond marker on the price line
        `<polygon points="${mx},${(yFn(closes[markerIdx])-7).toFixed(2)} ${(parseFloat(mx)+5).toFixed(2)},${yFn(closes[markerIdx]).toFixed(2)} ${mx},${(yFn(closes[markerIdx])+7).toFixed(2)} ${(parseFloat(mx)-5).toFixed(2)},${yFn(closes[markerIdx]).toFixed(2)}"`,
        ` fill="#f5a623" stroke="#0a0a0a" stroke-width="1"/>`,
        // "Bought" label pill
        `<rect x="${(parseFloat(mx) - 18).toFixed(2)}" y="${(PAD.t + 3).toFixed(2)}" width="36" height="13" rx="3" fill="rgba(245,166,35,0.18)" stroke="rgba(245,166,35,0.5)" stroke-width="0.5"/>`,
        `<text x="${mx}" y="${labelY}" text-anchor="middle" font-size="8" font-weight="600" fill="#f5a623">Bought</text>`,
      ].join('');
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible"> <defs> <linearGradient id="pGrad${id}" x1="0" y1="0" x2="0" y2="1"> <stop offset="0%" stop-color="${priceC}" stop-opacity="0.2"/><stop offset="100%" stop-color="${priceC}" stop-opacity="0"/> </linearGradient> <clipPath id="pClip${id}"><rect x="${PAD.l}" y="${PAD.t}" width="${cW}" height="${cH}"/></clipPath> </defs> ${yTicks.map(v=>`<line x1="${PAD.l}" y1="${yFn(v).toFixed(2)}" x2="${PAD.l+cW}" y2="${yFn(v).toFixed(2)}" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>`).join('')} ${yTicks.map(v=>`<text x="${PAD.l-4}" y="${(yFn(v)+3.5).toFixed(2)}" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.35)">$${v.toFixed(0)}</text>`).join('')} ${xLabels.map(({i,label})=>`<text x="${xFn(i).toFixed(2)}" y="${H-5}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.35)">${label}</text>`).join('')} <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/> <line x1="${PAD.l}" y1="${PAD.t+cH}" x2="${PAD.l+cW}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/> <g clip-path="url(#pClip${id})"> ${bbFillPts?`<polygon points="${bbFillPts}" fill="rgba(124,111,205,0.07)"/>`:''} <polyline points="${bbUpPts}"  fill="none" stroke="#7c6fcd" stroke-width="0.75" stroke-dasharray="3,2"/> <polyline points="${bbLoPts}"  fill="none" stroke="#7c6fcd" stroke-width="0.75" stroke-dasharray="3,2"/> <polyline points="${bbMidPts}" fill="none" stroke="#7c6fcd" stroke-width="0.5" stroke-opacity="0.5"/> <polyline points="${svgPolyline(sma200.map((v,i)=>[i,v]),xFn,yFn)}" fill="none" stroke="#f5a623" stroke-width="1.2" stroke-opacity="0.85"/> <polyline points="${svgPolyline(sma50.map((v,i)=>[i,v]),xFn,yFn)}"  fill="none" stroke="#4a9eff" stroke-width="1.2"/> <polygon points="${fillPts}" fill="url(#pGrad${id})"/> <polyline points="${pricePts}" fill="none" stroke="${priceC}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/> </g> ${legend.map(({c,l,dash},i)=>`<g transform="translate(${PAD.l+i*76},${PAD.t-3})"><line x1="0" y1="0" x2="13" y2="0" stroke="${c}" stroke-width="${dash?1:1.5}" stroke-dasharray="${dash?'3,2':'none'}"/><text x="17" y="3.5" font-size="8.5" fill="rgba(255,255,255,0.4)">${l}</text></g>`).join('')} <g clip-path="url(#pClip${id})">${purchaseMarkerSVG}</g> </svg>`;
}

function buildMomentumPanel(raw, rsiAll, macdAll, sliceStart, mode, W, H, PAD, id) {
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const n=raw.length-sliceStart;
  if (n<2) return '';
  const xFn=i=>PAD.l+(i/(n-1))*cW;
  if (mode==='rsi') {
    const rsi=rsiAll.slice(sliceStart);
    const yFn=v=>toSvgY(v,0,100,PAD.t,PAD.t+cH);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"> <clipPath id="rClip${id}"><rect x="${PAD.l}" y="${PAD.t}" width="${cW}" height="${cH}"/></clipPath> <rect x="${PAD.l}" y="${PAD.t}" width="${cW}" height="${(yFn(70)-PAD.t).toFixed(2)}" fill="rgba(255,77,77,0.07)" clip-path="url(#rClip${id})"/> <rect x="${PAD.l}" y="${yFn(30).toFixed(2)}" width="${cW}" height="${(PAD.t+cH-yFn(30)).toFixed(2)}" fill="rgba(0,201,122,0.07)" clip-path="url(#rClip${id})"/> ${[{v:70,c:'rgba(255,77,77,0.4)'},{v:50,c:'rgba(255,255,255,0.06)'},{v:30,c:'rgba(0,201,122,0.4)'}].map(({v,c})=>`<line x1="${PAD.l}" y1="${yFn(v).toFixed(2)}" x2="${PAD.l+cW}" y2="${yFn(v).toFixed(2)}" stroke="${c}" stroke-width="0.5" stroke-dasharray="${v===50?'none':'3,2'}"/><text x="${PAD.l-4}" y="${(yFn(v)+3.5).toFixed(2)}" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.35)">${v}</text>`).join('')} <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/> <line x1="${PAD.l}" y1="${PAD.t+cH}" x2="${PAD.l+cW}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/> <g clip-path="url(#rClip${id})"> <polyline points="${svgPolyline(rsi.map((v,i)=>[i,v]),xFn,yFn)}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/> </g> <text x="${PAD.l+4}" y="${PAD.t+10}" font-size="9" fill="#a78bfa" font-weight="600">RSI (14)</text> </svg>`;
  }
  const ml=macdAll.macdLine.slice(sliceStart), sl=macdAll.signalLine.slice(sliceStart), hl=macdAll.histogram.slice(sliceStart);
  const allM=[...ml,...sl.filter(Boolean),...hl.filter(Boolean)];
  const minM=Math.min(...allM)*1.15, maxM=Math.max(...allM)*1.15;
  const yFn=v=>toSvgY(v,minM,maxM,PAD.t,PAD.t+cH), zeroY=yFn(0);
  const barW=Math.max(1,cW/n-0.5);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"> <clipPath id="mClip${id}"><rect x="${PAD.l}" y="${PAD.t}" width="${cW}" height="${cH}"/></clipPath> <line x1="${PAD.l}" y1="${zeroY.toFixed(2)}" x2="${PAD.l+cW}" y2="${zeroY.toFixed(2)}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5"/> <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/> <line x1="${PAD.l}" y1="${PAD.t+cH}" x2="${PAD.l+cW}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/> <g clip-path="url(#mClip${id})"> ${hl.map((h,i)=>{if(h===null)return '';const bx=(xFn(i)-barW/2).toFixed(2),bh=Math.abs(yFn(h)-zeroY).toFixed(2),by=(h>=0?zeroY-parseFloat(bh):zeroY).toFixed(2);return `<rect x="${bx}" y="${by}" width="${barW.toFixed(2)}" height="${bh}" fill="${h>=0?'#00c97a':'#ff4d4d'}" opacity="0.7"/>`;}).join('')} <polyline points="${svgPolyline(ml.map((v,i)=>[i,v]),xFn,yFn)}" fill="none" stroke="#4a9eff" stroke-width="1.2"/> <polyline points="${svgPolyline(sl.map((v,i)=>[i,v]),xFn,yFn)}" fill="none" stroke="#f5a623" stroke-width="1.2"/> </g> ${[{c:'#4a9eff',l:'MACD'},{c:'#f5a623',l:'Signal'},{c:'#00c97a',l:'Histogram'}].map(({c,l},i)=>`<g transform="translate(${PAD.l+i*76},${PAD.t-3})"><line x1="0" y1="0" x2="13" y2="0" stroke="${c}" stroke-width="1.5"/><text x="17" y="3.5" font-size="8.5" fill="rgba(255,255,255,0.4)">${l}</text></g>`).join('')} </svg>`;
}

function getSliceStart(raw, months) {
  const cutoff=Date.now()-months*30*24*60*60*1000;
  const idx=raw.findIndex(d=>d.t>=cutoff);
  return idx>=0 ? idx : Math.max(0,raw.length-months*22);
}

function renderTwoPanel(ticker, months, momentumMode, prefix) {
  const cached=indicatorCache[ticker?.toUpperCase()];
  const priceEl=$(`${prefix}PriceChart`), momEl=$(`${prefix}MomChart`);
  if (!priceEl||!momEl) return;
  if (!cached||!cached.raw||cached.raw.length<20) {
    const msg='<div style="color:var(--text3);font-size:12px;padding:20px;text-align:center">Chart data loading…</div>';
    priceEl.innerHTML=msg; momEl.innerHTML=''; return;
  }
  const raw=cached.raw, closes=raw.map(d=>d.c);
  const sma50All=chartSMA(closes,50), sma200All=chartSMA(closes,200);
  const bollingerAll=chartBollinger(closes), rsiAll=chartRSI(closes), macdAll=chartMACD(closes);
  const sliceStart=getSliceStart(raw,months);
  const W=340, PAD={t:20,r:8,b:24,l:44}, id=prefix+months;
  // Resolve purchaseDate for 'pos' prefix from the currently open position
  const _purchaseDate = (prefix === 'pos' && posChartTicker)
    ? (positions.find(p => p.ticker.toUpperCase() === posChartTicker.toUpperCase())?.purchaseDate || null)
    : null;
  priceEl.innerHTML=buildPricePanel(raw,sma50All,sma200All,bollingerAll,sliceStart,W,185,PAD,id,_purchaseDate);
  momEl.innerHTML=buildMomentumPanel(raw,rsiAll,macdAll,sliceStart,momentumMode,W,100,PAD,id+momentumMode);
  ['1','3','6'].forEach(m=>{
    const btn=$(`${prefix}RangeBtn${m}`); if(!btn) return;
    const active=parseInt(m)===months;
    btn.style.background=active?'rgba(74,158,255,0.2)':'transparent';
    btn.style.color=active?'#4a9eff':'#555';
    btn.style.borderColor=active?'#4a9eff':'rgba(255,255,255,0.12)';
  });
  ['rsi','macd'].forEach(m=>{
    const btn=$(`${prefix}MomBtn${m}`); if(!btn) return;
    const active=m===momentumMode;
    btn.style.background=active?'rgba(167,139,250,0.15)':'transparent';
    btn.style.color=active?'#a78bfa':'#555';
    btn.style.borderColor=active?'#a78bfa':'rgba(255,255,255,0.1)';
  });
}

function chartControlsHTML(prefix) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"> <div style="display:flex;gap:5px"> ${['1','3','6'].map(m=>`<button id="${prefix}RangeBtn${m}" onclick="on${prefix}Range(${m})" style="padding:4px 12px;border-radius:8px;border:0.5px solid;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s">${m}M</button>`).join('')} </div> <div style="display:flex;gap:5px"> ${['rsi','macd'].map(m=>`<button id="${prefix}MomBtn${m}" onclick="on${prefix}Mom('${m}')" style="padding:4px 11px;border-radius:8px;border:0.5px solid;font-size:11px;font-weight:600;cursor:pointer;text-transform:uppercase;transition:all 0.15s">${m}</button>`).join('')} </div> </div> <div id="${prefix}PriceChart"></div> <div id="${prefix}MomChart" style="margin-top:6px"></div>`;
}

// Per-modal chart state
let posChartRange = 1, posChartMom = 'rsi', posChartTicker = null;
let buyChartRange = 1, buyChartMom = 'rsi', buyChartTicker = null;

function onposRange(m) { posChartRange = m; renderTwoPanel(posChartTicker, posChartRange, posChartMom, 'pos'); }
function onposMom(m)   { posChartMom   = m; renderTwoPanel(posChartTicker, posChartRange, posChartMom, 'pos'); }
function onbuyRange(m) { buyChartRange = m; renderTwoPanel(buyChartTicker, buyChartRange, buyChartMom, 'buy'); }
function onbuyMom(m)   { buyChartMom   = m; renderTwoPanel(buyChartTicker, buyChartRange, buyChartMom, 'buy'); }
