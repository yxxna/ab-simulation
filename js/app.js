/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
const ST = {
  img:  { A: false, B: false },
  sel:  { A: null, B: null },   // {x,y,w,h} 0~1 fraction
  ctr:  { A: 0, B: 0 },         // 이미지 분석 기반 예측 CTR
  drag: { on: false, side: null, sx: 0, sy: 0 },
  sim: {
    n:0, running:false, timer:null,
    aImp:0, aClicks:0, aD:[0,0,0],
    bImp:0, bClicks:0, bD:[0,0,0],
  }
};

/* ═══════════════════════════════════════
   UPLOAD
═══════════════════════════════════════ */
function triggerFile(s) { $('file'+s).click(); }

function onDragOver(e, s) {
  e.preventDefault();
  $('zone'+s).classList.add('drag-over');
}
function onDragLeave(e, s) { $('zone'+s).classList.remove('drag-over'); }
function onDrop(e, s) {
  e.preventDefault();
  $('zone'+s).classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImage(file, s);
}
function onFileChange(e, s) {
  if (e.target.files[0]) loadImage(e.target.files[0], s);
}

// Clipboard paste (auto-assign to next empty slot)
document.addEventListener('paste', e => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      const target = !ST.img.A ? 'A' : !ST.img.B ? 'B' : 'A';
      loadImage(file, target);
      break;
    }
  }
});

function loadImage(file, s) {
  const reader = new FileReader();
  reader.onload = ev => {
    $('img'+s).src = ev.target.result;
    $('zone'+s).style.display = 'none';
    $('wrap'+s).classList.add('show');
    $('actions'+s).classList.add('show');
    ST.img[s] = true;
    initDragSelect(s);
    checkReady();
  };
  reader.readAsDataURL(file);
}

function clearVariant(s) {
  $('img'+s).src = '';
  $('zone'+s).style.display = '';
  $('wrap'+s).classList.remove('show');
  $('actions'+s).classList.remove('show');
  $('selRect'+s).classList.remove('show');
  $('hint'+s).classList.remove('hidden');
  $('selStatus'+s).textContent = '영역 미선택';
  $('selStatus'+s).classList.remove('done');
  ST.img[s] = false;
  ST.sel[s] = null;
  ST.ctr[s] = 0;
  $('ctrLbl'+s).textContent = '—';
  checkReady();
}

/* ═══════════════════════════════════════
   DRAG-TO-SELECT
═══════════════════════════════════════ */
function initDragSelect(s) {
  const overlay = $('overlay'+s);
  // Remove old listeners by cloning
  const fresh = overlay.cloneNode(true);
  overlay.parentNode.replaceChild(fresh, overlay);

  fresh.addEventListener('pointerdown', e => {
    e.preventDefault();
    fresh.setPointerCapture(e.pointerId);
    const r = fresh.getBoundingClientRect();
    ST.drag = {
      on: true, side: s,
      sx: clamp((e.clientX - r.left) / r.width),
      sy: clamp((e.clientY - r.top)  / r.height),
    };
  });

  fresh.addEventListener('pointermove', e => {
    if (!ST.drag.on || ST.drag.side !== s) return;
    const r = fresh.getBoundingClientRect();
    const cx = clamp((e.clientX - r.left) / r.width);
    const cy = clamp((e.clientY - r.top)  / r.height);
    const x = Math.min(ST.drag.sx, cx);
    const y = Math.min(ST.drag.sy, cy);
    const w = Math.abs(cx - ST.drag.sx);
    const h = Math.abs(cy - ST.drag.sy);
    drawSelRect(s, x, y, w, h);
  });

  fresh.addEventListener('pointerup', e => {
    if (!ST.drag.on || ST.drag.side !== s) return;
    ST.drag.on = false;
    const sel = ST.sel[s];
    if (sel && sel.w > 0.04 && sel.h > 0.03) {
      $('selStatus'+s).textContent = '✓ 영역 선택 완료';
      $('selStatus'+s).classList.add('done');
      $('hint'+s).classList.add('hidden');
      tryPredictCtr(s);   // ← 영역 선택 완료 시 즉시 CTR 예측
    } else {
      ST.sel[s] = null;
      $('selRect'+s).classList.remove('show');
    }
    checkReady();
  });
}

function drawSelRect(s, x, y, w, h) {
  const rect = $('selRect'+s);
  rect.style.left   = (x*100)+'%';
  rect.style.top    = (y*100)+'%';
  rect.style.width  = (w*100)+'%';
  rect.style.height = (h*100)+'%';
  rect.classList.add('show');
  ST.sel[s] = { x, y, w, h };
}

function checkReady() {
  const ready = ST.img.A && ST.img.B && ST.sel.A && ST.sel.B;
  $('btnRun').disabled  = !ready || ST.sim.running;
  $('btnReset').disabled = ST.sim.n === 0 && !ST.sim.running;
}

/* ── CTR 예측 (픽셀 분석 기반) ── */
function predictCTR(imgEl, sel, baseCTR) {
  let m;
  try { m = analyzeRegion(imgEl, sel); } catch(e) { return baseCTR; }

  // 6개 요인 → CTR 영향력 가중 합산
  const contrast  = Math.min(1, m.contrastRange / 0.5);                          // 명도 대비
  const satPoint  = Math.min(1, m.maxSat / 0.85);                                // 포인트 컬러 채도
  const position  = Math.max(0, 1 - sel.y * 1.3);                                // 화면 내 수직 위치
  const size      = Math.min(1, (sel.w * sel.h) / 0.15);                         // UI 면적
  const density   = Math.max(0, 1 - Math.abs(m.edgeDensity - 0.17) / 0.27);     // 콘텐츠 밀도 최적도
  const focus     = Math.min(1, Math.max(0, (m.maxSat - m.avgSat) / 0.35));     // 시각적 초점 집중도

  const composite =
    contrast  * 0.25 +
    satPoint  * 0.20 +
    position  * 0.22 +
    size      * 0.15 +
    density   * 0.10 +
    focus     * 0.08;

  // composite 0~1 → CTR 배율 0.45 ~ 1.55 (±55%)
  const multiplier = 0.45 + composite * 1.1;
  return Math.max(0.001, baseCTR * multiplier);
}

function tryPredictCtr(s) {
  const sel = ST.sel[s];
  const img = $('img'+s);
  if (!sel || !img || !img.src || img.src === window.location.href) {
    $('ctrLbl'+s).textContent = '—';
    ST.ctr[s] = 0;
    return;
  }
  const base = Math.max(0.01, parseFloat($('baseCtr').value) || 1.5) / 100;
  const ctr = predictCTR(img, sel, base);
  ST.ctr[s] = ctr;
  $('ctrLbl'+s).textContent = (ctr * 100).toFixed(2) + '%';
}

function updatePredictedCtrs() {
  ['A','B'].forEach(s => tryPredictCtr(s));
}

/* ═══════════════════════════════════════
   SIMULATION
═══════════════════════════════════════ */
const SCROLL_REACH = 0.72;

function tick() {
  if (Math.random() >= SCROLL_REACH) { ST.sim.n++; return; }
  ST.sim.aImp++; ST.sim.bImp++;

  // 이미지 분석 기반 예측 CTR + 자연 노이즈
  const aBase = ST.ctr.A || 0.01;
  const bBase = ST.ctr.B || 0.01;
  const noise = Math.max(aBase, bBase) * 0.12; // ±12% 수준 자연 변동
  const aCtr = Math.max(0, aBase + (Math.random()-.5)*noise*2);
  const bCtr = Math.max(0, bBase + (Math.random()-.5)*noise*2);

  if (Math.random() < aCtr) {
    ST.sim.aClicks++;
    const r = Math.random();
    if (r < .44) ST.sim.aD[0]++;
    else if (r < .76) ST.sim.aD[1]++;
    else ST.sim.aD[2]++;
  }

  if (Math.random() < bCtr) {
    ST.sim.bClicks++;
    const r = Math.random();
    if (r < .44) ST.sim.bD[0]++;
    else if (r < .76) ST.sim.bD[1]++;
    else ST.sim.bD[2]++;
  }

  ST.sim.n++;
}

function render() {
  const total = parseInt($('nSel').value);
  $('pFill').style.width = (ST.sim.n/total*100)+'%';
  $('pLbl').textContent  = `${ST.sim.n.toLocaleString()} / ${total.toLocaleString()}명 완료`;

  const aCtrStr = ST.sim.aImp > 0 ? (ST.sim.aClicks/ST.sim.aImp*100).toFixed(1)+'%' : '—';
  const bCtrStr = ST.sim.bImp > 0 ? (ST.sim.bClicks/ST.sim.bImp*100).toFixed(1)+'%' : '—';

  $('hdrCtrA').textContent = aCtrStr;
  $('hdrCtrB').textContent = bCtrStr;
  $('sImpA').textContent   = ST.sim.aImp;    $('sImpB').textContent   = ST.sim.bImp;
  $('sClickA').textContent = ST.sim.aClicks; $('sClickB').textContent = ST.sim.bClicks;

  $('mActr').textContent   = aCtrStr;       $('mBctr').textContent   = bCtrStr;
  $('mAclick').textContent = ST.sim.aClicks; $('mBclick').textContent = ST.sim.bClicks;
  $('mAimp').textContent   = ST.sim.aImp;   $('mBimp').textContent   = ST.sim.bImp;

  const aT = Math.max(1, ST.sim.aD.reduce((a,b)=>a+b,0));
  const bT = Math.max(1, ST.sim.bD.reduce((a,b)=>a+b,0));
  [0,1,2].forEach(i => {
    $(`dA${i+1}`).textContent = ST.sim.aD[i];
    $(`dA${i+1}b`).style.width = (ST.sim.aD[i]/aT*100)+'%';
    $(`dB${i+1}`).textContent = ST.sim.bD[i];
    $(`dB${i+1}b`).style.width = (ST.sim.bD[i]/bT*100)+'%';
  });

  // Pulse dots in selected area
  if (ST.sim.n % 4 === 0 && ST.sim.n > 3) {
    spawnPulse('A'); spawnPulse('B');
  }
}

function spawnPulse(s) {
  const sel = ST.sel[s];
  if (!sel) return;
  const wrap = $('wrap'+s);
  const dot  = document.createElement('div');
  dot.className = 'pulse';
  dot.style.left = ((sel.x + Math.random()*sel.w)*100) + '%';
  dot.style.top  = ((sel.y + Math.random()*sel.h)*100) + '%';
  wrap.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
}

function showWinner() {
  const aCtr = ST.sim.aImp > 0 ? ST.sim.aClicks/ST.sim.aImp : 0;
  const bCtr = ST.sim.bImp > 0 ? ST.sim.bClicks/ST.sim.bImp : 0;
  const nameA = $('nameA').value || 'A안';
  const nameB = $('nameB').value || 'B안';

  // 실제 z-test
  const {z, pVal, lo, hi} = zTest(aCtr, ST.sim.aImp, bCtr, ST.sim.bImp);
  const sig  = pVal < 0.05;
  const isB  = bCtr >= aCtr;
  const uplift = aCtr > 0 ? ((bCtr-aCtr)/aCtr*100).toFixed(1) : '0';
  const conf = Math.min(99, (1 - pVal) * 100);

  $('winName').textContent = (isB ? nameB : nameA) + (sig ? ' 승리 🎉' : ' 우세');
  $('winName').style.color = isB ? '#5aabff' : '#ff9500';
  $('winUplift').innerHTML =
    `CTR ${nameA} <span>${(aCtr*100).toFixed(3)}%</span> → ${nameB} <span>${(bCtr*100).toFixed(3)}%</span>` +
    ` &nbsp;·&nbsp; <span>${isB?'+':''}${uplift}%</span>` +
    ` &nbsp;·&nbsp; p=${pVal<0.0001?'<0.0001':pVal.toFixed(4)}`;

  if (!sig) {
    $('winInsight').innerHTML =
      `⚠️ <strong>통계적으로 유의하지 않습니다</strong> (p=${pVal.toFixed(4)} ≥ 0.05)<br>
      95% CI: [${(lo*100).toFixed(3)}, ${(hi*100).toFixed(3)}]%p<br>
      샘플 크기(${ST.sim.aImp.toLocaleString()}명)에서는 두 안의 차이가 우연일 가능성을 배제할 수 없습니다.<br>
      슬라이더로 <strong>예상 CTR 차이를 더 크게 설정</strong>하거나, 인원수를 늘려 재시뮬레이션하세요.`;
  } else {
    $('winInsight').innerHTML =
      `✅ <strong>통계적으로 유의한 결과</strong> (p=${pVal<0.0001?'<0.0001':pVal.toFixed(4)})<br>
      95% CI: [${(lo*100).toFixed(3)}, ${(hi*100).toFixed(3)}]%p<br>
      ${isB?nameB:nameA}가 <strong>${Math.abs(uplift)}%</strong> 높은 CTR을 기록했습니다.<br>
      이미지 분석 기반 예측 CTR: ${(aCtr*100).toFixed(2)}% vs ${(bCtr*100).toFixed(2)}%<br>
      실제 검증은 상단 <strong>실측 데이터 분석</strong>을 활용하세요.`;
  }

  $('confPct').textContent = conf.toFixed(1)+'%';
  setTimeout(() => { $('confFill').style.width = Math.min(conf,99)+'%'; }, 100);

  $('results').classList.add('show');
  generateUIAnalysis();
  setTimeout(() => $('results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
}

function startSim() {
  if (ST.sim.running) return;

  // ── 무료 체험 카운터 확인 ──
  if (!isPro()) {
    const used = getUsedCount();
    if (used >= FREE_LIMIT) {
      showPaywall();
      return;
    }
    incrementUsed();
    updateTrialUI();
  }

  ST.sim.running = true;
  $('btnRun').disabled = true;
  $('results').classList.remove('show');
  $('progressWrap').classList.add('show');

  // Reset counters
  Object.assign(ST.sim, {
    n:0, aImp:0, aClicks:0, aTimeSum:0, aD:[0,0,0],
    bImp:0, bClicks:0, bTimeSum:0, bD:[0,0,0],
  });

  const total = parseInt($('nSel').value);
  const batch = total <= 100   ? 1
              : total <= 1000  ? 5
              : total <= 10000 ? 50
              : total <= 100000 ? 500
              : 5000;
  const delay = total <= 1000 ? 40 : 20;

  ST.sim.timer = setInterval(() => {
    for (let i=0; i<batch; i++) tick();
    render();
    if (ST.sim.n >= total) {
      clearInterval(ST.sim.timer);
      ST.sim.running = false;
      $('pLbl').textContent = `${total.toLocaleString()}명 시뮬레이션 완료!`;
      showWinner();
      checkReady();
    }
  }, delay);
}

function resetAll() {
  if (ST.sim.timer) clearInterval(ST.sim.timer);
  ST.sim.running = false;
  $('progressWrap').classList.remove('show');
  $('results').classList.remove('show');
  $('uiAnalysis').classList.remove('show');
  $('pFill').style.width = '0%';
  ['A','B'].forEach(s => {
    $('hdrCtr'+s).textContent = '—';
    $('sImp'+s).textContent = '0';
    $('sClick'+s).textContent = '0';
    $('ctrLbl'+s).textContent = '—';   // 예측 CTR 라벨 초기화
    ST.ctr[s] = 0;                      // 예측 CTR 상태 초기화
  });
  Object.assign(ST.sim, {
    n:0, aImp:0, aClicks:0, aD:[0,0,0],
    bImp:0, bClicks:0, bD:[0,0,0],
  });
  checkReady();
}

/* ═══════════════════════════════════════
   통계 함수 (실제 공식)
═══════════════════════════════════════ */
function erf(x) {
  const s = x >= 0 ? 1 : -1; x = Math.abs(x);
  const t = 1/(1+0.3275911*x);
  const y = 1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);
  return s*y;
}
function normCdf(x) { return 0.5*(1+erf(x/Math.sqrt(2))); }

function zTest(p1,n1,p2,n2) {
  const pp = (p1*n1+p2*n2)/(n1+n2);
  const se = Math.sqrt(pp*(1-pp)*(1/n1+1/n2));
  if (!se) return {z:0, pVal:1, lo:0, hi:0};
  const z  = (p2-p1)/se;
  const pv = 2*(1-normCdf(Math.abs(z)));
  const se2 = Math.sqrt(p1*(1-p1)/n1+p2*(1-p2)/n2);
  return {z, pVal:pv, lo:(p2-p1)-1.96*se2, hi:(p2-p1)+1.96*se2};
}

// 필요 샘플 수 (Evan Miller 공식, 80% power, α=0.05)
function requiredN(p1,p2) {
  if (Math.abs(p2-p1)<1e-10) return Infinity;
  const p=(p1+p2)/2, zα=1.96, zβ=0.842;
  const n=Math.pow(zα*Math.sqrt(2*p*(1-p))+zβ*Math.sqrt(p1*(1-p1)+p2*(1-p2)),2)/Math.pow(p2-p1,2);
  return Math.ceil(n);
}

/* ═══════════════════════════════════════
   실측 데이터 분석
═══════════════════════════════════════ */
function toggleRealPanel() {
  $('realPanel').classList.toggle('open');
}

function updateRdCtr(s) {
  const imp = parseFloat($('rd'+s+'imp').value)||0;
  const clk = parseFloat($('rd'+s+'clk').value)||0;
  const ctr = imp>0 ? (clk/imp*100).toFixed(3)+'%' : '—';
  $('rd'+s+'Ctr').textContent = ctr;
  // 두 안 모두 노출수가 있을 때만 분석 버튼 활성화
  const aOk = parseFloat($('rdAimp').value) > 0;
  const bOk = parseFloat($('rdBimp').value) > 0;
  $('btnAnalyze').disabled = !(aOk && bOk);
}

function analyzeReal() {
  const aI=parseFloat($('rdAimp').value), aC=parseFloat($('rdAclk').value);
  const bI=parseFloat($('rdBimp').value), bC=parseFloat($('rdBclk').value);
  if (!aI||!bI) return;
  const p1=aC/aI, p2=bC/bI;
  const {z,pVal,lo,hi} = zTest(p1,aI,p2,bI);
  const uplift = (p2-p1)/p1*100;
  const reqN = requiredN(p1,p2);

  $('rdZ').textContent     = z.toFixed(3);
  $('rdPval').textContent  = pVal < 0.0001 ? '<0.0001' : pVal.toFixed(4);
  $('rdUplift').textContent = (p2-p1>=0?'+':'')+((p2-p1)*100).toFixed(3)+'%p';
  $('rdUplift').style.color = p2>p1?'#30d158':'#ff6b6b';
  $('rdCI').textContent    = `[${(lo*100).toFixed(3)}, ${(hi*100).toFixed(3)}]%p`;
  $('rdZ').style.color     = Math.abs(z)>1.96 ? '#fff' : '#888';

  const nameA = ($('rdAname').value||$('nameA').value||'A안').trim();
  const nameB = ($('rdBname').value||$('nameB').value||'B안').trim();
  const sig = pVal < 0.05;

  let cls, msg;
  if (!sig) {
    cls = 'insig';
    msg = `⚠️ <strong>통계적으로 유의하지 않습니다</strong> (p=${pVal.toFixed(4)} ≥ 0.05)<br>
    현재 데이터로는 두 안의 CTR 차이가 우연인지 실제 효과인지 구분할 수 없습니다. 더 많은 데이터가 필요합니다.`;
  } else if (p2 > p1) {
    cls = 'sig-pos';
    msg = `✅ <strong>${nameB} CTR이 통계적으로 유의하게 높습니다</strong> (p=${pVal < 0.0001 ? '<0.0001' : pVal.toFixed(4)})<br>
    CTR: ${nameA} ${(p1*100).toFixed(3)}% → ${nameB} ${(p2*100).toFixed(3)}% <strong>(${uplift>=0?'+':''}${uplift.toFixed(1)}%)</strong><br>
    단, 동일 기간 비교가 아닌 경우 계절성·외부 변수의 영향을 배제할 수 없습니다.`;
  } else {
    cls = 'sig-neg';
    msg = `⚠️ <strong>${nameA} CTR이 통계적으로 유의하게 높습니다</strong> (p=${pVal < 0.0001 ? '<0.0001' : pVal.toFixed(4)})<br>
    CTR: ${nameA} ${(p1*100).toFixed(3)}% → ${nameB} ${(p2*100).toFixed(3)}% <strong>(${uplift.toFixed(1)}%)</strong><br>
    동일 기간 비교가 아닌 경우 계절성 등 교란 변수가 결과에 영향을 줬을 수 있습니다.<br>
    정확한 비교를 위해 <strong>동시 무작위 A/B 테스트</strong>가 권장됩니다.`;
  }

  const el = $('rdVerdict');
  el.className = 'stat-verdict ' + cls;
  el.innerHTML = msg;

  // 필요 샘플 수
  const tgt = p1 * 1.05; // 5% 상승 목표
  const reqN5 = requiredN(p1, tgt);
  $('rdReqN').innerHTML = reqN5 < 1e8
    ? `현재 CTR 기준 <strong>5% 개선</strong> 효과를 95% 신뢰도로 검증하려면 각 안에 <span>${reqN5.toLocaleString()}</span>명 필요`
    : `현재 CTR 수준에서 5% 개선 감지를 위해선 수천만 명 규모의 샘플이 필요합니다 — MDE 재검토를 권장합니다`;

  $('rdResult').classList.add('show');

  // 슬라이더 자동 반영
  // 실측 CTR을 기준으로 예측 CTR 재보정
  ST.ctr.A = p1;
  ST.ctr.B = p2;
  $('ctrLblA').textContent = (p1*100).toFixed(2)+'%';
  $('ctrLblB').textContent = (p2*100).toFixed(2)+'%';
}

/* util */
function clamp(v) { return Math.max(0, Math.min(1, v)); }
function $(id) { return document.getElementById(id); }

/* ═══════════════════════════════════════
   UI 디자인 분석 — 픽셀 기반 30가지 요인
═══════════════════════════════════════ */

/* ── 1. 이미지 선택 영역 픽셀 분석 ── */
function analyzeRegion(imgEl, sel) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const iw = imgEl.naturalWidth  || imgEl.offsetWidth  || 300;
  const ih = imgEl.naturalHeight || imgEl.offsetHeight || 600;
  const rw = Math.max(1, Math.round(sel.w * iw));
  const rh = Math.max(1, Math.round(sel.h * ih));
  const sc = Math.min(1, 150 / Math.max(rw, rh));
  canvas.width  = Math.max(1, Math.round(rw * sc));
  canvas.height = Math.max(1, Math.round(rh * sc));
  ctx.drawImage(imgEl, sel.x*iw, sel.y*ih, rw, rh, 0, 0, canvas.width, canvas.height);
  const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height, N = W * H;

  let sumL=0, sumR=0, sumG=0, sumB=0, sumSat=0, maxSat=0;
  let minL=1, maxL=0, edgeCnt=0, edgeTot=0;
  let tL=0,bL=0,lL=0,rL=0, tN=0,bN=0,lN=0,rN=0;
  const colorBkt = new Map();

  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      const i=(y*W+x)*4;
      const r=data[i]/255, g=data[i+1]/255, b=data[i+2]/255;
      const L=0.2126*r+0.7152*g+0.0722*b;
      sumL+=L; sumR+=r; sumG+=g; sumB+=b;
      if(L<minL)minL=L; if(L>maxL)maxL=L;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
      const sat=mx>0?(mx-mn)/mx:0;
      sumSat+=sat; if(sat>maxSat)maxSat=sat;
      const bk=((r*7|0)<<6)|((g*7|0)<<3)|(b*7|0);
      colorBkt.set(bk,(colorBkt.get(bk)||0)+1);
      if(x<W-1){const j=i+4;const Lr=0.2126*data[j]/255+0.7152*data[j+1]/255+0.0722*data[j+2]/255;edgeTot++;if(Math.abs(L-Lr)>.07)edgeCnt++;}
      if(y<H-1){const j=i+W*4;const Lb=0.2126*data[j]/255+0.7152*data[j+1]/255+0.0722*data[j+2]/255;edgeTot++;if(Math.abs(L-Lb)>.07)edgeCnt++;}
      if(y<H/2){tL+=L;tN++;}else{bL+=L;bN++;}
      if(x<W/2){lL+=L;lN++;}else{rL+=L;rN++;}
    }
  }
  const avgL=sumL/N;
  let ssq=0;
  for(let i=0;i<data.length;i+=4){const L=0.2126*data[i]/255+0.7152*data[i+1]/255+0.0722*data[i+2]/255;ssq+=(L-avgL)**2;}
  return {
    avgL, contrastRange:maxL-minL, lumStdDev:Math.sqrt(ssq/N),
    colorTemp:(sumR-sumB)/N, colorCount:[...colorBkt.values()].filter(v=>v>N*.003).length,
    avgSat:sumSat/N, maxSat, edgeDensity:edgeTot?edgeCnt/edgeTot:0,
    topAvgL:tN?tL/tN:.5, botAvgL:bN?bL/bN:.5,
    leftAvgL:lN?lL/lN:.5, rightAvgL:rN?rL/rN:.5,
  };
}

/* ── 2. 30가지 요인 스코어링 ── */
function scoreAllFactors(mA, mB, sA, sB, aCtr, bCtr, nameA, nameB) {
  const winB = bCtr >= aCtr;
  const clamp100 = v => Math.max(0, Math.min(100, Math.round(v)));
  const H = (vA,vB,lo,hi) => ({sA:clamp100((vA-lo)/(hi-lo)*100), sB:clamp100((vB-lo)/(hi-lo)*100)});
  const L = (vA,vB,lo,hi) => ({sA:clamp100((hi-vA)/(hi-lo)*100), sB:clamp100((hi-vB)/(hi-lo)*100)});

  const CAT = [
    // ── 컬러·대비 (6)
    { cat:'컬러 · 대비', icon:'🔆', name:'명도 대비 (가독성)',
      ...H(mA.contrastRange,mB.contrastRange,.1,.8),
      vA:`범위 ${(mA.contrastRange*100).toFixed(0)}%`, vB:`범위 ${(mB.contrastRange*100).toFixed(0)}%`,
      ins:(s,w)=>s>60?`${w}의 텍스트·배경 명도 차이가 충분해 가독성이 높습니다.`:s>35?`명도 대비가 보통입니다. 주요 텍스트의 대비를 높이면 가독성이 개선됩니다.`:`명도 대비가 낮습니다. 가독성 저하로 이탈률이 높아질 수 있습니다.`},
    { cat:'컬러 · 대비', icon:'🌡️', name:'감성 컬러 온도',
      sA:clamp100(50+mA.colorTemp*250), sB:clamp100(50+mB.colorTemp*250),
      vA:mA.colorTemp>.06?'따뜻한 톤 🟠':mA.colorTemp<-.06?'차가운 톤 🔵':'중립 톤 ⚪',
      vB:mB.colorTemp>.06?'따뜻한 톤 🟠':mB.colorTemp<-.06?'차가운 톤 🔵':'중립 톤 ⚪',
      ins:(s,w)=>Math.abs(mA.colorTemp-mB.colorTemp)<.04?'두 안의 컬러 온도가 유사합니다.':mB.colorTemp>mA.colorTemp?`B안이 더 따뜻한 톤으로 액션 유발에 유리합니다.`:`A안이 더 따뜻한 톤으로 액션 유발에 유리합니다.`},
    { cat:'컬러 · 대비', icon:'🎨', name:'컬러 수 절제',
      ...L(mA.colorCount,mB.colorCount,3,20),
      vA:`약 ${mA.colorCount}가지`, vB:`약 ${mB.colorCount}가지`,
      ins:(s,w)=>s>65?`${w}의 컬러가 절제되어 시선이 핵심 요소에 집중됩니다.`:s>35?`컬러 수가 다소 많습니다. 2~3가지 주요 컬러로 집중하면 효과적입니다.`:`컬러가 과도합니다. 시선 분산으로 클릭 집중도가 낮아집니다.`},
    { cat:'컬러 · 대비', icon:'💎', name:'포인트 컬러 채도',
      ...H(mA.maxSat,mB.maxSat,.2,.95),
      vA:`최대 채도 ${(mA.maxSat*100).toFixed(0)}%`, vB:`최대 채도 ${(mB.maxSat*100).toFixed(0)}%`,
      ins:(s,w)=>s>65?`${w}에 고채도 포인트 컬러가 CTA·버튼 주목도를 높입니다.`:s>35?`채도가 보통입니다. 핵심 CTA에 더 선명한 컬러를 적용해보세요.`:`채도가 낮아 CTA가 눈에 잘 띄지 않습니다.`},
    { cat:'컬러 · 대비', icon:'◼', name:'전경·배경 시각 분리',
      ...H(mA.lumStdDev,mB.lumStdDev,.04,.24),
      vA:`밝기 분산 ${(mA.lumStdDev*100).toFixed(1)}`, vB:`밝기 분산 ${(mB.lumStdDev*100).toFixed(1)}`,
      ins:(s,w)=>s>65?`${w}의 밝기 분포가 다양해 콘텐츠와 배경이 명확히 구분됩니다.`:s>35?`전경/배경 분리가 보통입니다. 카드 배경이나 구분선을 활용해보세요.`:`밝기가 균일해 콘텐츠 구분이 어렵습니다.`},
    { cat:'컬러 · 대비', icon:'⚡', name:'액션 유발 컬러 (따뜻한 계열)',
      sA:clamp100(50+(mA.colorTemp+mA.maxSat*.3)*200), sB:clamp100(50+(mB.colorTemp+mB.maxSat*.3)*200),
      vA:mA.colorTemp>.05?'빨강·주황 계열':'파랑·중립 계열', vB:mB.colorTemp>.05?'빨강·주황 계열':'파랑·중립 계열',
      ins:(s,w)=>s>60?`${w}의 따뜻한 컬러가 긴박감과 클릭 충동을 자극합니다.`:`차가운/중립 계열로 신뢰감은 있으나 즉각적 액션 유발력은 낮을 수 있습니다.`},

    // ── 레이아웃·구조 (6)
    { cat:'레이아웃 · 구조', icon:'📍', name:'화면 내 수직 배치',
      sA:clamp100((1-sA.y)*100), sB:clamp100((1-sB.y)*100),
      vA:sA.y<.3?'상단 (Fold 내)':sA.y<.6?'중단':'하단 (스크롤 필요)',
      vB:sB.y<.3?'상단 (Fold 내)':sB.y<.6?'중단':'하단 (스크롤 필요)',
      ins:(s,w)=>s>65?`${w}이 Fold 내 상단에 위치해 스크롤 없이 즉시 노출됩니다.`:s>35?`중단 배치로 약간의 스크롤이 필요합니다.`:`하단 배치로 초기 노출이 어렵습니다. 핵심 요소를 상단으로 올려보세요.`},
    { cat:'레이아웃 · 구조', icon:'📐', name:'UI 요소 시각적 크기',
      ...H(sA.w*sA.h,sB.w*sB.h,.02,.35),
      vA:`화면의 ${(sA.w*sA.h*100).toFixed(0)}%`, vB:`화면의 ${(sB.w*sB.h*100).toFixed(0)}%`,
      ins:(s,w)=>s>65?`${w}의 충분한 면적이 시선을 먼저 획득하고 터치 정확도를 높입니다.`:s>35?`보통 크기입니다. 핵심 터치 요소의 크기가 44pt 이상인지 확인하세요.`:`UI가 작습니다. 클릭 요소의 터치 타겟을 늘려보세요.`},
    { cat:'레이아웃 · 구조', icon:'↔', name:'레이아웃 방향성',
      sA:clamp100(Math.min(100,sA.w/sA.h>1?55+(sA.w/sA.h-1)*18:40)),
      sB:clamp100(Math.min(100,sB.w/sB.h>1?55+(sB.w/sB.h-1)*18:40)),
      vA:sA.w/sA.h>2?'가로형 배너':sA.w/sA.h>1.2?'가로형 카드':sA.w/sA.h>.7?'정방형':'세로형 카드',
      vB:sB.w/sB.h>2?'가로형 배너':sB.w/sB.h>1.2?'가로형 카드':sB.w/sB.h>.7?'정방형':'세로형 카드',
      ins:(s,w)=>Math.abs(sA.w/sA.h-sB.w/sB.h)<.4?'두 안의 레이아웃 방향이 유사합니다.':(sB.w/sB.h>sA.w/sA.h?'B안이 더 가로형으로 한 눈에 정보 파악이 쉽습니다.':'A안이 더 가로형으로 한 눈에 정보 파악이 쉽습니다.')},
    { cat:'레이아웃 · 구조', icon:'⊙', name:'수평 중심 정렬',
      sA:clamp100((1-Math.abs(.5-(sA.x+sA.w/2))*2.2)*100),
      sB:clamp100((1-Math.abs(.5-(sB.x+sB.w/2))*2.2)*100),
      vA:Math.abs(.5-(sA.x+sA.w/2))<.1?'중앙 정렬':sA.x+sA.w/2<.4?'좌측 배치':'우측 배치',
      vB:Math.abs(.5-(sB.x+sB.w/2))<.1?'중앙 정렬':sB.x+sB.w/2<.4?'좌측 배치':'우측 배치',
      ins:(s,w)=>s>70?`${w}이 중앙에 배치되어 좌우 균형 있는 시선 집중이 이루어집니다.`:`좌측 배치는 F패턴 스캔 흐름과 자연스럽게 맞습니다.`},
    { cat:'레이아웃 · 구조', icon:'🗂', name:'콘텐츠 밀도',
      sA:clamp100((1-Math.abs(mA.edgeDensity-.18)/.28)*100),
      sB:clamp100((1-Math.abs(mB.edgeDensity-.18)/.28)*100),
      vA:mA.edgeDensity>.3?'고밀도 (복잡)':mA.edgeDensity>.1?'적정 밀도':'저밀도 (여유)',
      vB:mB.edgeDensity>.3?'고밀도 (복잡)':mB.edgeDensity>.1?'적정 밀도':'저밀도 (여유)',
      ins:(s,w)=>s>65?`${w}의 정보 밀도가 적절합니다. 여유와 집중의 균형이 잘 잡혀 있습니다.`:mA.edgeDensity>.3&&mB.edgeDensity>.3?'두 안 모두 콘텐츠가 빽빽합니다. 여백을 늘려 인지 부담을 줄여보세요.':`콘텐츠가 다소 성기게 배치되어 있습니다.`},
    { cat:'레이아웃 · 구조', icon:'🌫', name:'여백 (화이트스페이스)',
      ...L(mA.edgeDensity,mB.edgeDensity,.05,.38),
      vA:mA.edgeDensity<.1?'여유 있음':mA.edgeDensity<.22?'보통':'빽빽함',
      vB:mB.edgeDensity<.1?'여유 있음':mB.edgeDensity<.22?'보통':'빽빽함',
      ins:(s,w)=>s>65?`${w}의 충분한 여백이 핵심 요소를 돋보이게 하고 인지 부담을 낮춥니다.`:s>35?`여백이 보통입니다. CTA 주변 여백을 늘리면 클릭률이 개선될 수 있습니다.`:`여백이 부족합니다. 항목 수를 줄이거나 간격을 넓혀보세요.`},

    // ── 시각 위계 (6)
    { cat:'시각 위계', icon:'👁', name:'F패턴 시선 시작점',
      sA:clamp100(((1-(sA.x+sA.w/2))*.5+(1-sA.y-sA.h/2)*.5)*100),
      sB:clamp100(((1-(sB.x+sB.w/2))*.5+(1-sB.y-sB.h/2)*.5)*100),
      vA:sA.x<.3&&sA.y<.5?'좌상단 (최적)':sA.x<.5?'좌측':'우측·하단',
      vB:sB.x<.3&&sB.y<.5?'좌상단 (최적)':sB.x<.5?'좌측':'우측·하단',
      ins:(s,w)=>s>65?`${w}이 F패턴 스캔의 자연스러운 시작점(좌상단)에 위치합니다.`:`핵심 정보는 좌측 상단에 배치하면 처음 눈에 더 잘 띕니다.`},
    { cat:'시각 위계', icon:'🤙', name:'모바일 엄지 도달 영역',
      sA:clamp100(Math.max(0,100-Math.abs(sA.y+sA.h/2-.575)/.22*100)),
      sB:clamp100(Math.max(0,100-Math.abs(sB.y+sB.h/2-.575)/.22*100)),
      vA:(sA.y+sA.h/2)>.35&&(sA.y+sA.h/2)<.8?'✓ 엄지 최적 구역':'엄지 닿기 어려움',
      vB:(sB.y+sB.h/2)>.35&&(sB.y+sB.h/2)<.8?'✓ 엄지 최적 구역':'엄지 닿기 어려움',
      ins:(s,w)=>s>65?`${w}이 한 손 조작이 자연스러운 엄지 구역에 위치합니다.`:`엄지 닿기 어려운 영역입니다. 터치 불편함이 클릭 전환을 저해할 수 있습니다.`},
    { cat:'시각 위계', icon:'🎯', name:'시각적 초점 집중도',
      sA:clamp100((mA.maxSat-mA.avgSat)/.4*100),
      sB:clamp100((mB.maxSat-mB.avgSat)/.4*100),
      vA:(mA.maxSat-mA.avgSat)>.3?'명확한 초점':(mA.maxSat-mA.avgSat)>.15?'보통':'분산형',
      vB:(mB.maxSat-mB.avgSat)>.3?'명확한 초점':(mB.maxSat-mB.avgSat)>.15?'보통':'분산형',
      ins:(s,w)=>s>65?`${w}에 고채도 포인트가 배경에서 명확히 부각되어 시선이 집중됩니다.`:s>35?`시각적 초점이 있으나 더 강조하면 클릭 유도력이 높아집니다.`:`시선이 분산됩니다. 하나의 강조 요소에 집중하세요.`},
    { cat:'시각 위계', icon:'🏗', name:'정보 위계 명확성',
      ...H(mA.lumStdDev,mB.lumStdDev,.04,.24),
      vA:mA.lumStdDev>.14?'위계 명확':mA.lumStdDev>.07?'보통':'위계 불분명',
      vB:mB.lumStdDev>.14?'위계 명확':mB.lumStdDev>.07?'보통':'위계 불분명',
      ins:(s,w)=>s>65?`${w}의 밝기 차이가 정보 중요도를 단계적으로 표현합니다.`:s>35?`정보 위계가 보통입니다. 크기·굵기·컬러로 위계를 강화해보세요.`:`밝기가 균일해 정보 위계가 불분명합니다.`},
    { cat:'시각 위계', icon:'🖼', name:'이미지·그래픽 비중',
      ...H(mA.avgSat*Math.min(mA.colorCount,15),mB.avgSat*Math.min(mB.colorCount,15),.3,3.5),
      vA:mA.avgSat>.28?'그래픽 풍부':mA.avgSat>.14?'보통':'텍스트 중심',
      vB:mB.avgSat>.28?'그래픽 풍부':mB.avgSat>.14?'보통':'텍스트 중심',
      ins:(s,w)=>s>65?`${w}에 색감 있는 그래픽이 감성적 반응을 유도하고 체류 시간을 높입니다.`:s>35?`그래픽 요소가 보통입니다. 아이콘·이미지 추가가 전환율을 높일 수 있습니다.`:`텍스트 중심입니다. 시각 요소를 보완해보세요.`},
    { cat:'시각 위계', icon:'✨', name:'시각적 노이즈 수준',
      ...L(mA.colorCount*mA.edgeDensity,mB.colorCount*mB.edgeDensity,.5,8),
      vA:mA.colorCount*mA.edgeDensity>4?'노이즈 높음':mA.colorCount*mA.edgeDensity>1.5?'보통':'깔끔함',
      vB:mB.colorCount*mB.edgeDensity>4?'노이즈 높음':mB.colorCount*mB.edgeDensity>1.5?'보통':'깔끔함',
      ins:(s,w)=>s>65?`${w}이 시각적으로 깔끔해 핵심 메시지에 집중할 수 있습니다.`:s>35?`시각적 노이즈가 보통입니다.`:`복잡도가 높습니다. 불필요한 요소를 줄여 핵심에 집중시키세요.`},

    // ── CTA·전환 (6)
    { cat:'CTA · 전환', icon:'🔥', name:'CTA 컬러 강도',
      ...H(mA.maxSat,mB.maxSat,.25,.95),
      vA:`최고 채도 ${(mA.maxSat*100).toFixed(0)}%`, vB:`최고 채도 ${(mB.maxSat*100).toFixed(0)}%`,
      ins:(s,w)=>s>65?`${w}의 강렬한 포인트 컬러가 CTA에 즉각적인 주목을 이끕니다.`:s>35?`CTA 컬러 강도가 보통입니다. 더 선명한 컬러를 적용해보세요.`:`CTA 컬러 강도가 약합니다. 강조 컬러가 필요합니다.`},
    { cat:'CTA · 전환', icon:'👆', name:'터치 타겟 크기',
      ...H(sA.h,sB.h,.05,.38),
      vA:sA.h>.15?'터치 충분':sA.h>.07?'보통':'작은 터치 영역',
      vB:sB.h>.15?'터치 충분':sB.h>.07?'보통':'작은 터치 영역',
      ins:(s,w)=>s>65?`${w}의 세로 크기가 충분해 정확한 터치가 쉽습니다.`:s>35?`터치 영역이 보통입니다. 핵심 버튼이 44pt 이상인지 확인하세요.`:`터치 영역이 작습니다. 탭 타겟 크기를 키우세요.`},
    { cat:'CTA · 전환', icon:'🏷', name:'강조 요소 명확성',
      sA:clamp100((mA.maxSat*.6+mA.lumStdDev*.4)/.5*100),
      sB:clamp100((mB.maxSat*.6+mB.lumStdDev*.4)/.5*100),
      vA:mA.maxSat>.6?'강조 뚜렷':mA.maxSat>.35?'보통':'강조 약함',
      vB:mB.maxSat>.6?'강조 뚜렷':mB.maxSat>.35?'보통':'강조 약함',
      ins:(s,w)=>s>65?`${w}에 뱃지·칩·버튼 등 강조 요소가 시각적으로 잘 부각됩니다.`:`강조 요소가 더 돋보여야 합니다. 색상·크기·그림자로 부각시켜보세요.`},
    { cat:'CTA · 전환', icon:'📊', name:'A vs B 전환 구조 차이',
      sA:winB?38:78, sB:winB?78:38,
      vA:`CTR ${(aCtr*100).toFixed(2)}%`, vB:`CTR ${(bCtr*100).toFixed(2)}%`,
      ins:(s,w)=>{const up=Math.abs((bCtr-aCtr)/Math.max(aCtr,.0001)*100);return`${w}이 CTR ${up.toFixed(1)}% 높아 전환 구조가 우수합니다.`}},
    { cat:'CTA · 전환', icon:'⏰', name:'긴급성 컬러 신호',
      sA:clamp100((mA.colorTemp>.05?60:30)+(mA.maxSat>.6?30:10)),
      sB:clamp100((mB.colorTemp>.05?60:30)+(mB.maxSat>.6?30:10)),
      vA:mA.colorTemp>.08&&mA.maxSat>.55?'강한 긴급성 신호':mA.colorTemp>.03?'약한 긴급성':'중립',
      vB:mB.colorTemp>.08&&mB.maxSat>.55?'강한 긴급성 신호':mB.colorTemp>.03?'약한 긴급성':'중립',
      ins:(s,w)=>s>60?`${w}의 따뜻하고 채도 높은 컬러가 마감·혜택 강조에 효과적입니다.`:`긴급성이나 혜택을 강조할 때 빨강·주황 계열의 포인트 컬러가 유효합니다.`},
    { cat:'CTA · 전환', icon:'🔲', name:'클릭 유도 영역 대비',
      sA:clamp100(mA.contrastRange*mA.maxSat/.3*100),
      sB:clamp100(mB.contrastRange*mB.maxSat/.3*100),
      vA:mA.contrastRange*mA.maxSat>.15?'대비 강함':mA.contrastRange*mA.maxSat>.07?'보통':'대비 약함',
      vB:mB.contrastRange*mB.maxSat>.15?'대비 강함':mB.contrastRange*mB.maxSat>.07?'보통':'대비 약함',
      ins:(s,w)=>s>65?`${w}의 클릭 유도 요소가 배경에서 충분히 구분됩니다.`:`클릭 요소의 대비를 높이면 전환율 개선에 직접 기여합니다.`},

    // ── 디자인 완성도 (6)
    { cat:'디자인 완성도', icon:'⚖', name:'좌우 시각 균형',
      ...L(Math.abs(mA.leftAvgL-mA.rightAvgL),Math.abs(mB.leftAvgL-mB.rightAvgL),0,.22),
      vA:Math.abs(mA.leftAvgL-mA.rightAvgL)<.05?'균형':'비대칭',
      vB:Math.abs(mB.leftAvgL-mB.rightAvgL)<.05?'균형':'비대칭',
      ins:(s,w)=>s>65?`${w}의 좌우 밝기 분포가 균형 잡혀 시각적 안정감이 높습니다.`:`좌우 비대칭이 있습니다. 의도된 비대칭이 아니라면 균형을 맞춰보세요.`},
    { cat:'디자인 완성도', icon:'🌅', name:'상하 시각 흐름',
      sA:clamp100(Math.abs(mA.topAvgL-mA.botAvgL)/.18*100),
      sB:clamp100(Math.abs(mB.topAvgL-mB.botAvgL)/.18*100),
      vA:Math.abs(mA.topAvgL-mA.botAvgL)>.08?'명확한 흐름':'균일',
      vB:Math.abs(mB.topAvgL-mB.botAvgL)>.08?'명확한 흐름':'균일',
      ins:()=>'상단→하단으로 자연스러운 밝기 변화가 있으면 시선 흐름이 유도됩니다.'},
    { cat:'디자인 완성도', icon:'🔆', name:'전체 밝기 적정성',
      sA:clamp100(Math.max(0,100-Math.abs(mA.avgL-.55)/.32*100)),
      sB:clamp100(Math.max(0,100-Math.abs(mB.avgL-.55)/.32*100)),
      vA:mA.avgL>.68?'라이트 모드':mA.avgL>.38?'적정 밝기':'다크 모드',
      vB:mB.avgL>.68?'라이트 모드':mB.avgL>.38?'적정 밝기':'다크 모드',
      ins:(s,w)=>s>65?`${w}의 전체 밝기가 적정해 눈에 부담이 적고 콘텐츠 집중이 용이합니다.`:`밝기가 극단적입니다. 텍스트 대비를 충분히 확보하는 것이 중요합니다.`},
    { cat:'디자인 완성도', icon:'🎵', name:'색상 조화도',
      sA:clamp100((1-Math.min(1,mA.colorCount/18))*.7*100+mA.avgSat*.3*100),
      sB:clamp100((1-Math.min(1,mB.colorCount/18))*.7*100+mB.avgSat*.3*100),
      vA:mA.colorCount<7?'조화로움':mA.colorCount<13?'보통':'복잡',
      vB:mB.colorCount<7?'조화로움':mB.colorCount<13?'보통':'복잡',
      ins:(s,w)=>s>65?`${w}의 컬러 조합이 조화롭습니다. 일관된 팔레트가 완성도를 높입니다.`:`컬러 조합이 다소 복잡합니다. 팔레트를 정리해 통일감을 높여보세요.`},
    { cat:'디자인 완성도', icon:'📱', name:'모바일 스크롤 최적화',
      sA:clamp100((sA.y<.5?.7:.4)*100+(sA.h>.1?.3:.15)*100),
      sB:clamp100((sB.y<.5?.7:.4)*100+(sB.h>.1?.3:.15)*100),
      vA:sA.y<.35?'스크롤 전 노출':sA.y<.6?'초기 스크롤 내':'심층 스크롤 필요',
      vB:sB.y<.35?'스크롤 전 노출':sB.y<.6?'초기 스크롤 내':'심층 스크롤 필요',
      ins:(s,w)=>s>65?`${w}의 핵심 요소가 최소 스크롤로 도달 가능해 이탈률을 낮춥니다.`:`핵심 전환 요소가 스크롤 깊숙이 위치합니다. 상단 배치를 고려해보세요.`},
    { cat:'디자인 완성도', icon:'🏆', name:'종합 전환 잠재력',
      sA:clamp100((1-sA.y)*.2*100+Math.min(sA.w*sA.h/.15,1)*.15*100+Math.min(mA.contrastRange/.4,1)*.2*100+(1-Math.min(mA.colorCount/20,1))*.15*100+mA.maxSat*.15*100+(1-mA.edgeDensity)*.15*100),
      sB:clamp100((1-sB.y)*.2*100+Math.min(sB.w*sB.h/.15,1)*.15*100+Math.min(mB.contrastRange/.4,1)*.2*100+(1-Math.min(mB.colorCount/20,1))*.15*100+mB.maxSat*.15*100+(1-mB.edgeDensity)*.15*100),
      vA:'', vB:'',
      ins:(s,w)=>winB?`B안이 배치·대비·컬러 복합 지표에서 전반적으로 높은 전환 잠재력을 보입니다.`:`A안이 배치·대비·컬러 복합 지표에서 전반적으로 높은 전환 잠재력을 보입니다.`},
  ];

  // insight 텍스트 확정
  CAT.forEach(f => {
    const ws = winB ? f.sB : f.sA;
    f.insightText = typeof f.ins === 'function' ? f.ins(ws, winB ? nameB : nameA) : f.ins;
    f.sA = Math.max(0, Math.min(100, Math.round(f.sA)));
    f.sB = Math.max(0, Math.min(100, Math.round(f.sB)));
  });
  return CAT;
}

/* ── 3. 렌더링 ── */
function renderFactorAnalysis(factors, winB, nameA, nameB, aCtr, bCtr) {
  // 요약 바
  const avgA = Math.round(factors.reduce((s,f)=>s+f.sA,0)/factors.length);
  const avgB = Math.round(factors.reduce((s,f)=>s+f.sB,0)/factors.length);
  const winsA = factors.filter(f=>f.sA>f.sB+7).length;
  const winsB = factors.filter(f=>f.sB>f.sA+7).length;
  const sb = $('factorSummaryBar');
  sb.innerHTML = `
    <div class="summary-bar">
      <div>
        <div class="summary-winner-tag" style="color:${winB?'#5aabff':'#ff9500'}">${winB?nameB:nameA} 디자인 우위</div>
        <div style="font-size:11px;color:#444;margin-top:2px;">30가지 요인 픽셀 분석 완료 · 항목 우세 A ${winsA} vs B ${winsB}</div>
      </div>
      <div class="summary-scores">
        <div class="summary-score-item">
          <div class="summary-score-num" style="color:#ff9500">${avgA}</div>
          <div class="summary-score-lbl">${nameA} 평균</div>
        </div>
        <div style="font-size:18px;color:#333;align-self:center">vs</div>
        <div class="summary-score-item">
          <div class="summary-score-num" style="color:#5aabff">${avgB}</div>
          <div class="summary-score-lbl">${nameB} 평균</div>
        </div>
      </div>
    </div>`;

  // 카테고리별 그루핑
  const groups = {};
  factors.forEach(f => {
    if (!groups[f.cat]) groups[f.cat] = [];
    groups[f.cat].push(f);
  });

  const wrap = $('factorGroupsWrap');
  wrap.innerHTML = '';

  Object.entries(groups).forEach(([cat, items]) => {
    const block = document.createElement('div');
    block.className = 'factor-cat-block';
    block.innerHTML = `<div class="factor-cat-title">${cat}</div>`;
    items.forEach(f => {
      const diff = f.sB - f.sA;
      const verdictCls = Math.abs(diff)<7 ? 'tie' : diff>0 ? 'win-b' : 'win-a';
      const verdictTxt = Math.abs(diff)<7 ? '비슷' : diff>0 ? `${nameB} +${Math.abs(diff)}` : `${nameA} +${Math.abs(diff)}`;
      const wA = f.sA > f.sB+7;
      const wB = f.sB > f.sA+7;
      const row = document.createElement('div');
      row.className = 'factor-row';
      row.innerHTML = `
        <div class="factor-row-top">
          <span class="factor-row-icon">${f.icon}</span>
          <span class="factor-row-name">${f.name}</span>
          <span class="factor-verdict ${verdictCls}">${verdictTxt}</span>
        </div>
        <div class="factor-bars">
          <div class="factor-bar-side">
            <div class="factor-bar-label">${nameA}</div>
            <div class="factor-bar-track"><div class="factor-bar-fill fill-a${wA?' winner':''}" style="width:0%" data-w="${f.sA}"></div></div>
            <div class="factor-bar-val${wA?' winner':''}">
              ${f.vA||''}${f.vA&&f.sA?' · ':''}${f.sA}점
            </div>
          </div>
          <div class="factor-bar-side">
            <div class="factor-bar-label">${nameB}</div>
            <div class="factor-bar-track"><div class="factor-bar-fill fill-b${wB?' winner':''}" style="width:0%" data-w="${f.sB}"></div></div>
            <div class="factor-bar-val${wB?' winner':''}">
              ${f.vB||''}${f.vB&&f.sB?' · ':''}${f.sB}점
            </div>
          </div>
        </div>
        <div class="factor-insight">${f.insightText}</div>`;
      block.appendChild(row);
    });
    wrap.appendChild(block);
  });

  // 바 애니메이션
  setTimeout(() => {
    wrap.querySelectorAll('.factor-bar-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  }, 80);
}

/* ── 4. 메인 진입점 ── */
function generateUIAnalysis() {
  const selA = ST.sel.A, selB = ST.sel.B;
  if (!selA || !selB) return;
  if (!ST.sim.aImp || !ST.sim.bImp) return;

  const imgA = $('imgA'), imgB = $('imgB');
  const aCtr = ST.sim.aClicks / ST.sim.aImp;
  const bCtr = ST.sim.bClicks / ST.sim.bImp;
  const nameA = $('nameA').value.trim() || 'A안';
  const nameB = $('nameB').value.trim() || 'B안';

  let mA, mB;
  try { mA = analyzeRegion(imgA, selA); } catch(e) { return; }
  try { mB = analyzeRegion(imgB, selB); } catch(e) { return; }

  const factors = scoreAllFactors(mA, mB, selA, selB, aCtr, bCtr, nameA, nameB);
  renderFactorAnalysis(factors, bCtr >= aCtr, nameA, nameB, aCtr, bCtr);
  $('uiAnalysis').classList.add('show');
}

// ── 구버전 함수 stub (호환성 유지) ──
function buildAutoFactors() {}
function renderAutoFactors() {}
function CHECKLIST_unused() {}
function renderChecklist() {}
function updateClProgress() {}

/* ═══════════════════════════════════════
   무료 체험 카운터 & 결제 게이트
═══════════════════════════════════════ */
const FREE_LIMIT  = 3;
const STORAGE_KEY = 'ablens_used';
const PRO_KEY     = 'ablens_pro';

function getUsedCount() {
  return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
}
function incrementUsed() {
  localStorage.setItem(STORAGE_KEY, getUsedCount() + 1);
}
function isPro() {
  return localStorage.getItem(PRO_KEY) === '1';
}

// ── 트라이얼 UI 업데이트 ──
function updateTrialUI() {
  if (isPro()) {
    // 프로 상태: 배지 변경, 업그레이드 버튼 숨김
    $('trialBadge').innerHTML = '<span class="pro-badge-nav">PRO ✦ 무제한</span>';
    $('btnUpgradeNav').style.display = 'none';
    return;
  }
  const used = getUsedCount();
  const left = Math.max(0, FREE_LIMIT - used);
  $('trialLeft').textContent = left;

  // pip 업데이트
  const pips = $('trialPips');
  pips.innerHTML = '';
  for (let i = 0; i < FREE_LIMIT; i++) {
    const pip = document.createElement('div');
    pip.className = 'trial-pip' + (i < used ? ' used' : '');
    pips.appendChild(pip);
  }

  // 0회 남으면 업그레이드 버튼 강조
  const btn = $('btnUpgradeNav');
  if (left === 0) {
    btn.textContent = '🔒 업그레이드';
    btn.style.background = 'linear-gradient(135deg,#ff6b35,#ff9500)';
  }
}

// ── 결제 모달 ──
let selectedPlan = 'annual';

function showPaywall() {
  $('paywallOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closePaywall() {
  $('paywallOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

function selectPlan(plan) {
  selectedPlan = plan;
  $('planMonthly').classList.toggle('selected', plan === 'monthly');
  $('planAnnual').classList.toggle('selected',  plan === 'annual');
  $('btnPaywallCta').textContent =
    plan === 'annual'
      ? '연간 플랜 시작하기 (₩79,000) →'
      : '월간 플랜 시작하기 (₩9,900) →';
}

function handlePayment() {
  // ── 토스페이먼츠 결제 연동 포인트 ──
  // 실제 연동 시 아래 주석을 해제하고 clientKey를 입력하세요.
  //
  // const clientKey = 'test_ck_...';  // 토스페이먼츠 클라이언트 키
  // const tossPayments = TossPayments(clientKey);
  // tossPayments.requestBillingAuth('카드', {
  //   customerKey: 'user_' + Date.now(),
  //   successUrl: window.location.origin + '/ab-simulation/app.html?payment=success',
  //   failUrl:    window.location.origin + '/ab-simulation/app.html?payment=fail',
  // });
  //
  // ── 현재: 데모 모드 (결제 없이 PRO 활성화) ──
  alert('🎉 결제 연동 준비 중입니다!\n\n지금은 데모로 PRO 기능을 체험해보세요.');
  activatePro();
}

function activatePro() {
  localStorage.setItem(PRO_KEY, '1');
  closePaywall();
  updateTrialUI();
}

// ── URL 파라미터로 결제 성공 처리 ──
function checkPaymentResult() {
  const params = new URLSearchParams(location.search);
  if (params.get('payment') === 'success') {
    activatePro();
    history.replaceState({}, '', location.pathname);
  }
}

// ── 초기화 ──
checkPaymentResult();
updateTrialUI();

// Esc로 모달 닫기
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePaywall();
});

/* ═══════════════════════════════════════
   어드민 숨김 트리거
   업그레이드 버튼 5번 클릭 → 무제한 활성화
   TODO: 나중에 Firebase Auth로 교체할 것
═══════════════════════════════════════ */
let _adminTapCount = 0;
let _adminTapTimer = null;

function handleAdminTap() {
  if (isPro()) return;

  _adminTapCount++;
  clearTimeout(_adminTapTimer);
  _adminTapTimer = setTimeout(() => { _adminTapCount = 0; }, 3000); // 3초 내에 5번

  if (_adminTapCount >= 5) {
    _adminTapCount = 0;
    localStorage.setItem(PRO_KEY, '1');
    updateTrialUI();
    alert('✦ 무제한 모드 활성화!');
  }
}

