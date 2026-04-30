/* ════════════════════════════════════════
   AB Lens — Landing Page Script
   js/landing.js
════════════════════════════════════════ */

/* ── 요금제 월/연 토글 ── */
let isAnnual = false;

function toggleBilling() {
  isAnnual = !isAnnual;
  document.getElementById('billingToggle').classList.toggle('on', isAnnual);
  document.getElementById('lblMonthly').classList.toggle('active', !isAnnual);
  document.getElementById('lblAnnual').classList.toggle('active',  isAnnual);
  document.getElementById('saveBadge').style.opacity = isAnnual ? '1' : '.35';

  if (isAnnual) {
    document.getElementById('proPrice').textContent   = '₩79,000';
    document.getElementById('proPeriod').textContent  = '/년';
    document.getElementById('proDesc').textContent    = '월 ₩6,583 — 월간 대비 33% 절약';
    document.getElementById('teamPrice').textContent  = '₩239,000';
    document.getElementById('teamPeriod').textContent = '/년';
    document.getElementById('teamDesc').textContent   = '최대 5인 팀 · 월 ₩19,917';
  } else {
    document.getElementById('proPrice').textContent   = '₩9,900';
    document.getElementById('proPeriod').textContent  = '/월';
    document.getElementById('proDesc').textContent    = '연간 결제 시 ₩79,000 (2개월 무료)';
    document.getElementById('teamPrice').textContent  = '₩29,000';
    document.getElementById('teamPeriod').textContent = '/월';
    document.getElementById('teamDesc').textContent   = '최대 5인 팀 · 연간 결제 시 ₩239,000';
  }
}

/* ── FAQ 아코디언 ── */
function toggleFaq(el) {
  el.parentElement.classList.toggle('open');
}
