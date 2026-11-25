// ============================================================
// TAXINEXO — CARROSSEL DE BANNERS (imagem + link configurável)
// Mesmo comportamento da ZKNbet: autoplay, arraste e clique no banner.
// ============================================================
(function () {
  const API = 'https://taxinexo-webhook.gabrielrobin63.workers.dev/api';

  function linkSeguro(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/[^\/]/.test(s)) return s;
    return '';
  }

  async function iniciar() {
    const box = document.getElementById('taxCarousel');
    if (!box) return;
    let banners = [];
    try {
      const r = await fetch(API + '/marketing/banners');
      const j = await r.json();
      banners = (j.banners || []).filter(b => b.type === 'carousel' && b.image_url);
    } catch (_) { return; }
    if (!banners.length) {
      // Sem banners: o banner padrão ocupa a largura toda
      box.closest('.hero-com-carrossel')?.classList.remove('tem-carrossel');
      return;
    }
    box.closest('.hero-com-carrossel')?.classList.add('tem-carrossel');

    box.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'tax-carousel-track';
    box.appendChild(track);
    box.classList.remove('hidden');

    let moved = false;
    banners.forEach(b => {
      const slide = document.createElement('div');
      slide.className = 'tax-carousel-slide';
      const href = linkSeguro(b.link);
      if (href) {
        slide.setAttribute('role', 'link');
        slide.setAttribute('tabindex', '0');
        slide.title = 'Clique para abrir';
      }
      slide.onclick = () => { if (!moved && href) location.href = href; };
      slide.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && href) { e.preventDefault(); location.href = href; } };
      const img = document.createElement('img');
      img.src = b.image_url;
      img.alt = 'Destaque Taxinexo';
      img.draggable = false;
      slide.appendChild(img);
      track.appendChild(slide);
    });

    if (banners.length < 2) return;
    let idx = 0, timer = null, startX = 0, dx = 0, dragging = false;

    function ir(i) {
      idx = (i + banners.length) % banners.length;
      track.style.transition = 'transform .5s ease';
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      pontos();
    }
    function parar() { if (timer) { clearInterval(timer); timer = null; } }
    function iniciarAuto() { parar(); timer = setInterval(() => ir(idx + 1), 8000); }

    const dots = document.createElement('div');
    dots.className = 'tax-carousel-dots';
    box.appendChild(dots);
    banners.forEach((_, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.setAttribute('aria-label', 'Ir para banner ' + (i + 1));
      d.onclick = () => { parar(); ir(i); iniciarAuto(); };
      dots.appendChild(d);
    });
    function pontos() {
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    }

    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true; moved = false; startX = e.clientX; dx = 0;
      parar(); track.style.transition = 'none';
      try { track.setPointerCapture(e.pointerId); } catch (_) {}
    });
    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 5) moved = true;
      track.style.transform = 'translateX(calc(-' + (idx * 100) + '% + ' + dx + 'px))';
    });
    function soltar() {
      if (!dragging) return;
      dragging = false;
      const limite = Math.min(60, track.offsetWidth * 0.15);
      if (dx <= -limite) ir(idx + 1);
      else if (dx >= limite) ir(idx - 1);
      else ir(idx);
      setTimeout(() => { moved = false; }, 0);
      iniciarAuto();
    }
    track.addEventListener('pointerup', soltar);
    track.addEventListener('pointercancel', soltar);
    pontos();
    iniciarAuto();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
  window.taxRecarregarCarrossel = iniciar;
})();
