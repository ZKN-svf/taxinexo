/* ============================================================
   TAXINEXO — TEMA, MARCA E PALETA
   - Alterna claro/escuro (style-laranja.css ligado/desligado)
   - Aplica nome da plataforma em TODAS as referências textuais
   - Aplica a cor principal escolhida no admin
   Configuração pública: /taxinexo/config/marca no Firebase
   ============================================================ */
(function () {
  'use strict';

  var CHAVE_TEMA = 'taxinexo_tema';
  var CHAVE_MARCA = 'taxinexo_marca';
  var NOME_PADRAO = 'Veloster Capital';
  var COR_PADRAO = '#d97706';
  var CONFIG_URL = 'https://zkn-ss-default-rtdb.firebaseio.com/taxinexo/config/marca.json';

  var marcaAtual = { nome: NOME_PADRAO, cor: COR_PADRAO };

  function lerTema() {
    try { return localStorage.getItem(CHAVE_TEMA) === 'escuro' ? 'escuro' : 'claro'; }
    catch (_) { return 'claro'; }
  }
  function lerMarcaCache() {
    try {
      var m = JSON.parse(localStorage.getItem(CHAVE_MARCA) || 'null');
      if (m && typeof m === 'object') {
        return {
          nome: String(m.nome || NOME_PADRAO).trim() || NOME_PADRAO,
          cor: normalizarHex(m.cor) || COR_PADRAO
        };
      }
    } catch (_) {}
    return null;
  }

  /* ---------- cores ---------- */
  function normalizarHex(hex) {
    var s = String(hex || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return '';
  }
  function hexRgb(hex) {
    var h = normalizarHex(hex) || COR_PADRAO;
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function rgbHex(r, g, b) {
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); };
    return '#' + f(r) + f(g) + f(b);
  }
  function misturar(hex, alvo, peso) {
    var a = hexRgb(hex), b = hexRgb(alvo);
    return rgbHex(
      a[0] + (b[0] - a[0]) * peso,
      a[1] + (b[1] - a[1]) * peso,
      a[2] + (b[2] - a[2]) * peso
    );
  }
  function rgbHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }
  function hslHex(h, s, l) {
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue(p, q, h + 1 / 3);
      g = hue(p, q, h);
      b = hue(p, q, h - 1 / 3);
    }
    return rgbHex(r * 255, g * 255, b * 255);
  }

  function aplicarCor(cor, tema) {
    var c = normalizarHex(cor) || COR_PADRAO;
    var rgb = hexRgb(c);
    var c2 = misturar(c, '#ffffff', 0.16);
    var c3 = misturar(c, '#ffffff', 0.38);
    var escuro = misturar(c, '#000000', 0.14);
    var maisEscuro = misturar(c, '#000000', 0.28);
    var hsl = rgbHsl(rgb[0], rgb[1], rgb[2]);
    var root = document.documentElement;

    function set(nome, valor) { root.style.setProperty(nome, valor); }
    var r = rgb[0], g = rgb[1], b = rgb[2];

    set('--accent', c);
    set('--accent-rgb', r + ',' + g + ',' + b);
    set('--accent-2', c2);
    set('--accent-2-rgb', hexRgb(c2).join(','));
    set('--accent-3', c3);
    set('--accent-3-rgb', hexRgb(c3).join(','));
    set('--accent-dark', escuro);
    set('--accent-dark-rgb', hexRgb(escuro).join(','));
    set('--accent-darker', maisEscuro);
    set('--accent-darker-rgb', hexRgb(maisEscuro).join(','));
    set('--cyan', c);
    set('--blue', c2);
    set('--violet', escuro);
    set('--grad', 'linear-gradient(135deg,' + c + ' 0%,' + c2 + ' 55%,' + c3 + ' 100%)');
    set('--grad-soft', 'linear-gradient(135deg,rgba(' + r + ',' + g + ',' + b + ',.14),rgba(' +
      hexRgb(c2).join(',') + ',.08) 55%,rgba(' + hexRgb(c3).join(',') + ',.14))');
    set('--line', 'rgba(' + r + ',' + g + ',' + b + ',.16)');
    set('--shadow-glow', '0 20px 50px -26px rgba(' + r + ',' + g + ',' + b + ',.38)');

    if (tema === 'claro') {
      // Texto em azul-marinho (combina com a marca Veloster) e fundos quentes.
      set('--text', '#0b1b33');
      set('--muted', '#5f6f86');
      set('--ink-soft', '#203a5c');
      set('--bg', misturar(c, '#ffffff', 0.965));
      set('--soft-1', misturar(c, '#ffffff', 0.94));
      set('--soft-2', misturar(c, '#ffffff', 0.90));
      set('--soft-3', misturar(c, '#ffffff', 0.86));
      set('--soft-4', misturar(c, '#ffffff', 0.78));
      set('--surface-2', misturar(c, '#ffffff', 0.90));
      set('--neutral-soft', hslHex(hsl.h, Math.min(hsl.s, 0.22), 0.92));
    } else {
      // No escuro, deixa os textos/superfícies do style-premium.
      ['--text', '--muted', '--ink-soft', '--bg', '--soft-1', '--soft-2',
       '--soft-3', '--soft-4', '--surface-2', '--neutral-soft'].forEach(function (n) {
        root.style.removeProperty(n);
      });
    }
  }

  /* ---------- tema ---------- */
  function atualizarBotoesTema() {
    var escuro = document.documentElement.dataset.tema === 'escuro';
    document.querySelectorAll('.theme-toggle').forEach(function (b) {
      b.setAttribute('aria-label', escuro ? 'Ativar tema claro' : 'Ativar tema escuro');
      b.setAttribute('aria-pressed', escuro ? 'true' : 'false');
      b.title = escuro ? 'Tema claro' : 'Tema escuro';
      var i = b.querySelector('.ico');
      if (i) i.className = 'ico ' + (escuro ? 'ico-sun' : 'ico-moon');
    });
  }
  function aplicarTema(tema, salvar) {
    var t = tema === 'escuro' ? 'escuro' : 'claro';
    document.documentElement.dataset.tema = t;
    var link = document.getElementById('themeCss');
    if (link) link.disabled = (t === 'escuro');
    if (salvar !== false) {
      try { localStorage.setItem(CHAVE_TEMA, t); } catch (_) {}
    }
    aplicarCor(marcaAtual.cor, t);
    atualizarBotoesTema();
  }
  function alternarTema() {
    aplicarTema(lerTema() === 'claro' ? 'escuro' : 'claro', true);
  }

  /* ---------- nome da marca ---------- */
  var textOrig = new WeakMap();
  var textNodes = [];
  var attrOrig = new WeakMap();
  var nomeAplicado = NOME_PADRAO;

  function casoDoNome(match, nome) {
    if (match === match.toUpperCase()) return nome.toUpperCase();
    if (match === match.toLowerCase()) return nome.toLowerCase();
    return nome;
  }
  function trocarMarca(texto, nome) {
    // Troca as marcas antigas/nova pelo nome configurado, sem tocar em e-mails.
    return String(texto == null ? '' : texto).replace(/(taxinexo|veloster\s+capital)(?![\w.+-]*@)/gi, function (m) {
      return casoDoNome(m, nome);
    });
  }

  function capturarTextos(raiz, nome) {
    if (!raiz) return;
    if (raiz.nodeType === 3) {
      var pai = raiz.parentElement;
      if (!pai || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(pai.tagName)) return;
      if (pai.closest('[data-no-brand]')) return;
      if (!textOrig.has(raiz)) { textOrig.set(raiz, raiz.nodeValue); textNodes.push(raiz); }
      raiz.nodeValue = trocarMarca(textOrig.get(raiz), nome);
      return;
    }
    if (raiz.nodeType !== 1) return;
    var walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-no-brand]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (!textOrig.has(n)) { textOrig.set(n, n.nodeValue); textNodes.push(n); }
      n.nodeValue = trocarMarca(textOrig.get(n), nome);
    }

    raiz.querySelectorAll('[placeholder],[title],[aria-label],[alt],[content]').forEach(function (el) {
      ['placeholder', 'title', 'aria-label', 'alt', 'content'].forEach(function (attr) {
        if (!el.hasAttribute(attr)) return;
        var mapa = attrOrig.get(el);
        if (!mapa) { mapa = {}; attrOrig.set(el, mapa); }
        if (!(attr in mapa)) mapa[attr] = el.getAttribute(attr);
        el.setAttribute(attr, trocarMarca(mapa[attr], nome));
      });
    });
  }

  function reaplicarTextos(nome) {
    for (var i = textNodes.length - 1; i >= 0; i--) {
      var n = textNodes[i];
      if (!n.isConnected) { textNodes.splice(i, 1); continue; }
      n.nodeValue = trocarMarca(textOrig.get(n), nome);
    }
    document.querySelectorAll('[placeholder],[title],[aria-label],[alt],[content]').forEach(function (el) {
      var mapa = attrOrig.get(el);
      if (!mapa) return;
      Object.keys(mapa).forEach(function (attr) {
        el.setAttribute(attr, trocarMarca(mapa[attr], nome));
      });
    });
  }

  function garantirMarcaNoLayout(nome) {
    document.querySelectorAll('.topbar>a').forEach(function (a) {
      var span = a.querySelector('.brand-name');
      if (!span) {
        span = document.createElement('span');
        span.className = 'brand-name';
        a.appendChild(span);
      }
      span.textContent = nome;
    });
    document.querySelectorAll('.auth-brand').forEach(function (h) {
      var nomeEl = h.querySelector('.auth-brand-name');
      if (!nomeEl) {
        nomeEl = document.createElement('span');
        nomeEl.className = 'auth-brand-name';
        h.appendChild(nomeEl);
        var sub = document.createElement('span');
        sub.className = 'auth-brand-sub';
        sub.textContent = 'INVESTIMENTO';
        h.appendChild(sub);
      }
      nomeEl.textContent = nome;
    });
  }

  function aplicarNome(nome) {
    var novo = String(nome || '').trim() || NOME_PADRAO;
    nomeAplicado = novo;
    var custom = novo.toLowerCase() !== NOME_PADRAO.toLowerCase();
    document.documentElement.dataset.marca = custom ? 'custom' : '';
    garantirMarcaNoLayout(novo);
    capturarTextos(document.body, novo);
    reaplicarTextos(novo);

    var original = document.documentElement.dataset.tituloOriginal || document.title;
    document.documentElement.dataset.tituloOriginal = original;
    document.title = trocarMarca(original, novo);
  }

  /* ---------- observa conteúdo gerado depois ---------- */
  function observar() {
    if (!('MutationObserver' in window)) return;
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var adds = muts[i].addedNodes;
        for (var j = 0; j < adds.length; j++) capturarTextos(adds[j], nomeAplicado);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- config remota ---------- */
  function aplicarMarca(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    marcaAtual = {
      nome: String(cfg.nome || NOME_PADRAO).trim() || NOME_PADRAO,
      cor: normalizarHex(cfg.cor) || COR_PADRAO
    };
    try { localStorage.setItem(CHAVE_MARCA, JSON.stringify(marcaAtual)); } catch (_) {}
    aplicarNome(marcaAtual.nome);
    aplicarCor(marcaAtual.cor, document.documentElement.dataset.tema || lerTema());
  }

  function carregarMarca() {
    var cache = lerMarcaCache();
    if (cache) aplicarMarca(cache);
    fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (m) {
        if (m && typeof m === 'object') aplicarMarca(m);
      })
      .catch(function () {});
  }

  function criarBotao() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-toggle';
    b.innerHTML = '<span class="ico ico-moon" aria-hidden="true"></span>';
    return b;
  }
  function montarBotoes() {
    var conta = document.querySelector('.topbar .account');
    if (conta && !conta.querySelector('.theme-toggle')) {
      conta.insertBefore(criarBotao(), conta.firstChild);
    } else if (!conta && !document.querySelector('.theme-toggle-float')) {
      var b = criarBotao();
      b.classList.add('theme-toggle-float');
      document.body.appendChild(b);
    }
    // Liga qualquer botão de tema presente no HTML ou criado agora,
    // sem duplicar o evento em cliques repetidos.
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      if (btn.dataset.temaLigado === '1') return;
      btn.dataset.temaLigado = '1';
      btn.addEventListener('click', alternarTema);
    });
    atualizarBotoesTema();
  }

  /* ---------- inicialização ---------- */
  // O <head> já definiu data-tema e desativou o CSS claro quando necessário.
  document.documentElement.dataset.tema = lerTema();
  var cacheInicial = lerMarcaCache();
  if (cacheInicial) {
    marcaAtual = cacheInicial;
    aplicarCor(marcaAtual.cor, document.documentElement.dataset.tema);
  }

  function iniciar() {
    var link = document.getElementById('themeCss');
    if (link) link.disabled = (document.documentElement.dataset.tema === 'escuro');
    montarBotoes();
    aplicarNome(marcaAtual.nome);
    aplicarCor(marcaAtual.cor, document.documentElement.dataset.tema);
    observar();
    carregarMarca();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  window.TaxinexoUI = {
    aplicarMarca: aplicarMarca,
    aplicarTema: aplicarTema,
    alternarTema: alternarTema,
    aplicarCor: function (cor) { aplicarCor(cor, document.documentElement.dataset.tema || lerTema()); },
    temaAtual: function () { return document.documentElement.dataset.tema || lerTema(); },
    marcaAtual: function () { return marcaAtual; }
  };
})();
