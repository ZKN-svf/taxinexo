/* ============================================================
   TAXINEXO — SCRIPT PRINCIPAL
   Firebase Realtime DB (/taxinexo) + SigiloPay + Admin + Dashboard
   Funcionamento portado do InvestMax, mantendo o visual Taxinexo.
   ============================================================ */

// ------------------------------------------------------------
// FIREBASE (mesmo projeto do InvestMax; namespace isolado /taxinexo)
// ------------------------------------------------------------
const firebaseConfig = {
  apiKey: 'AIzaSyCPvJgu35opSVzsqF5PHsgDoNOurNtHOY4',
  authDomain: 'zkn-ss.firebaseapp.com',
  databaseURL: 'https://zkn-ss-default-rtdb.firebaseio.com',
  projectId: 'zkn-ss',
  storageBucket: 'zkn-ss.appspot.com',
  messagingSenderId: '100000000000',
  appId: '1:100000000000:web:abcdef123456'
};

let db = null; // raiz /taxinexo
if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database().ref('taxinexo');
    console.log('[Taxinexo] Firebase conectado:', firebaseConfig.databaseURL, '/taxinexo');
  } catch (e) {
    console.error('[Taxinexo] Erro Firebase:', e);
  }
}

// ------------------------------------------------------------
// CONFIGURAÇÕES
// ------------------------------------------------------------
const ADMIN_SENHA = '235689b';
const CONFIG = {
  depositoMinimo: 20,
  depositoMaximo: 500,
  saqueMinimo: 20,
  saquesPorDia: 2,
  taxaSaquePorcento: 10,
  horarioSaqueInicio: 11,
  horarioSaqueFim: 18,
  bonusIndicacao: 2.00,
  codigo_roleta: 'ROLETA',
  codigo_bonus: 'TAXINEXO',
  valor_bonus: 5.00
};

// Planos do Taxinexo (diária × ciclo = retorno)
const planos = [
  { id: 0, nome: 'Taxinexo Gratuito', entrada: 0, diaria: 2, ciclo: 5, retorno: 10 },
  { id: 1, nome: 'Plano 15', entrada: 15, diaria: 3, ciclo: 10, retorno: 30 },
  { id: 2, nome: 'Plano 25', entrada: 25, diaria: 5, ciclo: 10, retorno: 50 },
  { id: 3, nome: 'Plano 50', entrada: 50, diaria: 10, ciclo: 10, retorno: 100 },
  { id: 4, nome: 'Plano 100', entrada: 100, diaria: 20, ciclo: 10, retorno: 200 },
  { id: 5, nome: 'Plano 500', entrada: 500, diaria: 100, ciclo: 10, retorno: 1000 },
  { id: 6, nome: 'Plano 700', entrada: 700, diaria: 140, ciclo: 10, retorno: 1400 },
  { id: 7, nome: 'Plano 1.000', entrada: 1000, diaria: 200, ciclo: 10, retorno: 2000 }
];

// ------------------------------------------------------------
// UTILITÁRIOS
// ------------------------------------------------------------
const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
const hoje = () => new Date().toISOString().split('T')[0];
const el = (id) => document.getElementById(id);

// Índices manuais: evitam orderByChild (que exige .indexOn nas regras do Firebase).
const emailKey = (email) => btoa(String(email).toLowerCase()).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
async function buscarUsuarioPorEmail(email) {
  const idx = await db.child('email_index/' + emailKey(email)).once('value');
  const uid = idx.val();
  if (!uid) return null;
  const s = await db.child('usuarios/' + uid).once('value');
  return s.exists() ? s.val() : null;
}
async function chavesDaLista(caminho) {
  const s = await db.child(caminho).once('value');
  return s.exists() ? Object.keys(s.val()) : [];
}
async function lerCada(caminho, keys) {
  const out = [];
  for (const k of keys) {
    const s = await db.child(caminho + '/' + k).once('value');
    if (s.exists()) out.push({ key: k, valor: s.val() });
  }
  return out;
}

function gerarId() { return 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10); }
function gerarCodigoIndicacao() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function hashSenha(senha) {
  let hash = 0;
  for (let i = 0; i < senha.length; i++) {
    const ch = senha.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36) + '_' + btoa(senha).slice(0, 8);
}
function validarCPF(cpf) {
  cpf = String(cpf).replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i);
  let d = (s * 10) % 11; if (d === 10) d = 0;
  if (d !== parseInt(cpf[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i);
  d = (s * 10) % 11; if (d === 10) d = 0;
  return d === parseInt(cpf[10]);
}
function validarEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)); }

function formatarCPF(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  input.value = v;
}
function formatarCelular(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  input.value = v;
}
function alternarSenha(botao, id) {
  const campo = el(id); if (!campo) return;
  const visivel = campo.type === 'password';
  campo.type = visivel ? 'text' : 'password';
  botao.setAttribute('aria-pressed', String(visivel));
  botao.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
}
function abrirDialogo(id, campo) {
  const d = el(id); if (!d) return;
  d.querySelector('form').reset();
  d.querySelectorAll('.reward-result').forEach(x => { x.textContent = ''; delete x.dataset.state; });
  if (id === 'saqueDialog') atualizarTaxa();
  d.showModal();
  if (campo && el(campo)) el(campo).focus();
}
function mostrarDeposito() { abrirDialogo('depositoDialog', 'depositoValor'); }
function mostrarSaque() { abrirDialogo('saqueDialog', 'saquePix'); }
function lerValor(texto) {
  const limpo = String(texto).trim().replace(/\s|R\$/g, '');
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function calcularSaque(bruto) {
  const taxa = Math.round(bruto * (CONFIG.taxaSaquePorcento / 100) * 100) / 100;
  return { bruto, taxa, liquido: Math.round((bruto - taxa) * 100) / 100 };
}
function atualizarTaxa() {
  const campo = el('saqueValor'); if (!campo) return;
  const bruto = lerValor(campo.value) || 0;
  const c = calcularSaque(bruto);
  if (el('saqueTaxa')) el('saqueTaxa').textContent = '- ' + fmtBRL(c.taxa);
  if (el('saqueLiquido')) el('saqueLiquido').textContent = fmtBRL(c.liquido);
}
function horarioSaquePermitido() {
  const h = new Date().getHours();
  return h >= CONFIG.horarioSaqueInicio && h < CONFIG.horarioSaqueFim;
}
function proximoHorarioSaque() {
  const h = new Date().getHours();
  return h < CONFIG.horarioSaqueInicio
    ? `Hoje às ${CONFIG.horarioSaqueInicio}:00`
    : `Amanhã às ${CONFIG.horarioSaqueInicio}:00`;
}
function setMensagem(id, texto, estado) {
  const e = el(id); if (!e) return;
  e.textContent = texto;
  if (estado) e.dataset.state = estado; else delete e.dataset.state;
}
function toast(msg) { alert(msg); }

// ------------------------------------------------------------
// AUTENTICAÇÃO
// ------------------------------------------------------------
function usuarioLocal() {
  try { return JSON.parse(localStorage.getItem('usuario_taxinexo') || 'null'); }
  catch (_) { return null; }
}
function salvarUsuarioLocal(u) { localStorage.setItem('usuario_taxinexo', JSON.stringify(u)); }
function sair() {
  localStorage.removeItem('usuario_taxinexo');
  localStorage.removeItem('token_taxinexo');
  sessionStorage.removeItem('admin_taxinexo');
  location.href = 'index.html';
}
function exigirLogin() {
  const u = usuarioLocal();
  if (!u || !localStorage.getItem('token_taxinexo')) {
    location.href = 'index.html';
    return null;
  }
  return u;
}

async function fazerCadastro() {
  const btn = document.querySelector('#cadastroForm button[type="submit"]');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Criando conta...'; }
  try {
    const nome = el('nome').value.trim();
    const cpf = el('cpf').value.trim();
    const celular = el('celular').value.trim();
    const email = el('email').value.trim().toLowerCase();
    const pix = el('pix').value.trim();
    const senha = el('senha').value;
    const senha2 = el('confirmarSenha').value;
    const indicacao = (el('indicacao') && el('indicacao').value.trim().toUpperCase()) || '';
    const termos = el('termos');

    if (nome.split(' ').length < 2) return toast('Digite seu nome completo.');
    if (!validarCPF(cpf)) return toast('CPF inválido!');
    if (celular.replace(/\D/g, '').length < 10) return toast('Celular inválido!');
    if (!validarEmail(email)) return toast('E-mail inválido!');
    if (pix.length < 3) return toast('Chave Pix inválida!');
    if (senha.length < 8) return toast('Senha mínimo 8 caracteres.');
    if (!/[A-Z]/.test(senha)) return toast('A senha precisa ter MAIÚSCULA.');
    if (!/[a-z]/.test(senha)) return toast('A senha precisa ter minúscula.');
    if (!/\d/.test(senha)) return toast('A senha precisa ter número.');
    if (senha !== senha2) return toast('As senhas não coincidem!');
    if (termos && !termos.checked) return toast('Aceite os termos.');
    if (!db) return toast('Firebase não conectado.');

    if (await buscarUsuarioPorEmail(email)) return toast('E-mail já cadastrado.');

    let indicadoPor = null;
    if (indicacao) {
      const s = await db.child('codigo_index/' + indicacao).once('value');
      const uidInd = s.val();
      if (uidInd) {
        const ui = await db.child('usuarios/' + uidInd).once('value');
        if (ui.exists()) indicadoPor = ui.val();
      }
    }

    const id = gerarId();
    const usuario = {
      id, nome,
      cpf: cpf.replace(/\D/g, ''),
      celular: celular.replace(/\D/g, ''),
      email, pix,
      senha_hash: hashSenha(senha),
      saldo: 0, saldo_indicacao: 0, investido: 0, rendimentos: 0, bonus: 0,
      total_depositado: 0,
      codigo_indicacao: gerarCodigoIndicacao(),
      indicado_por: indicadoPor ? indicadoPor.id : null,
      indicado_por_email: indicadoPor ? indicadoPor.email : null,
      bonus_recebido: false,
      criado_em: new Date().toISOString(),
      role: 'user'
    };
    await db.child('usuarios/' + id).set(usuario);
    await db.child('email_index/' + emailKey(email)).set(id);
    await db.child('codigo_index/' + usuario.codigo_indicacao).set(id);
    salvarUsuarioLocal(usuario);
    localStorage.setItem('token_taxinexo', 'token_' + Date.now());
    toast(`Conta criada, ${nome.split(' ')[0]}!\n\nSeu código de indicação: ${usuario.codigo_indicacao}\nGanhe ${fmtBRL(CONFIG.bonusIndicacao)} por amigo que investir!`);
    location.href = 'cliente.html';
  } catch (e) {
    console.error(e);
    toast('Erro ao criar conta: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

async function fazerLogin() {
  const btn = document.querySelector('#loginForm button[type="submit"]');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Entrando...'; }
  try {
    const email = el('email').value.trim().toLowerCase();
    const senha = el('senha').value;
    if (!db) return toast('Firebase não conectado.');
    const usuario = await buscarUsuarioPorEmail(email);
    if (!usuario) return toast('E-mail não encontrado.');
    if (usuario.senha_hash !== hashSenha(senha)) return toast('Senha incorreta.');
    salvarUsuarioLocal(usuario);
    localStorage.setItem('token_taxinexo', 'token_' + Date.now());
    location.href = 'cliente.html';
  } catch (e) {
    console.error(e);
    toast('Erro ao fazer login.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
async function iniciarDashboard() {
  const u = exigirLogin(); if (!u) return;
  try {
    const snap = await db.child('usuarios/' + u.id).once('value');
    if (snap.exists()) salvarUsuarioLocal(snap.val());
  } catch (e) { console.warn('[Dashboard] sync:', e); }

  const atual = usuarioLocal();
  const primeiro = atual.nome.split(' ')[0];
  if (el('nomeUsuario')) el('nomeUsuario').textContent = primeiro;
  if (el('userEmail')) el('userEmail').textContent = atual.email;
  if (el('saldo')) el('saldo').textContent = Number(atual.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (el('totalInvestido')) el('totalInvestido').textContent = fmtBRL(atual.investido);
  if (el('totalRendimentos')) el('totalRendimentos').textContent = fmtBRL(atual.rendimentos);
  if (el('totalGeral')) el('totalGeral').textContent = fmtBRL((atual.investido || 0) * 3.2);
  if (el('saldoIndicacao')) el('saldoIndicacao').textContent = fmtBRL(atual.saldo_indicacao);
  if (el('codigoIndicacao')) el('codigoIndicacao').textContent = atual.codigo_indicacao || '----';
  const linkInput = el('linkIndicacao');
  if (linkInput && atual.codigo_indicacao) {
    linkInput.value = location.origin + location.pathname + '?ref=' + encodeURIComponent(atual.codigo_indicacao);
  }
  if (el('saquePix')) el('saquePix').value = atual.pix || '';

  carregarPlanos();
  await carregarInvestimentos();
  atualizarTimers();
  await carregarExtrato();
}

function iconePlano(tipo) {
  const desenhos = {
    entrada: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6"/>',
    diaria: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h2m6 0h2m-10 3h2m6 0h2"/>',
    ciclo: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-6v6h6m-5 8a8 8 0 0 0 14 3l3-3m0 6v-6h-6"/>',
    retorno: '<path d="m8 3 2 4h4l2-4-4 1-4-1Zm2 4C6 10 3 14 4 18c1 5 15 5 16 0 1-4-2-8-6-11M12 11v9m3-7c-5-3-8 2-3 3s2 5-3 2"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${desenhos[tipo] || ''}</svg>`;
}

// Limites: plano grátis só 1 vez; planos pagos até 2 vezes por usuário.
function limiteDoPlano(p) { return p.id === 0 ? 1 : 2; }
async function contarInvestimentosDoPlano(uid, planoId) {
  if (!db) return 0;
  const keys = await chavesDaLista('investimentos_usuario/' + uid);
  const itens = await lerCada('investimentos', keys);
  return itens.filter(x => Number(x.valor.plano_id) === Number(planoId)).length;
}

async function carregarPlanos() {
  const container = el('listaPlanos'); if (!container) return;
  const u = usuarioLocal();
  const contagens = {};
  if (u && db) {
    for (const p of planos) contagens[p.id] = await contarInvestimentosDoPlano(u.id, p.id);
  }
  const html = await Promise.all(planos.map(async (p) => {
    const usados = contagens[p.id] || 0;
    const limite = limiteDoPlano(p);
    const esgotado = usados >= limite;
    const selo = p.id === 0 ? 'limitado a 1x' : 'até 2x por conta';
    return `
    <article class="plano-card" aria-label="${p.nome}">
      <h4>${p.nome.toUpperCase()}</h4>
      <span class="plano-selo">${selo}</span>
      <img class="plan-car" src="plan-car.webp" alt="Carro Taxinexo" width="1000" height="534" loading="lazy">
      <dl class="plan-facts">
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('entrada')}</span><dt>Entrada</dt><dd>${fmtBRL(p.entrada)}</dd></div>
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('diaria')}</span><dt>Diária</dt><dd>${fmtBRL(p.diaria)}</dd></div>
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('ciclo')}</span><dt>Ciclo</dt><dd>${p.ciclo} Dias</dd></div>
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('retorno')}</span><dt>Total recebido</dt><dd>${fmtBRL(p.retorno)}</dd></div>
      </dl>
      <button ${esgotado ? 'disabled class="plano-esgotado"' : `onclick="escolherPlano(${p.id})"`} aria-label="Escolher ${p.nome}">
        ${esgotado ? 'Limite atingido' : 'Investir neste plano'} <span aria-hidden="true">→</span>
      </button>
    </article>`;
  }));
  container.innerHTML = html.join('');
}

async function escolherPlano(id) {
  const u = usuarioLocal();
  if (!u) return toast('Faça login para investir.');
  const p = planos.find(x => x.id === Number(id)); if (!p) return;
  const usados = await contarInvestimentosDoPlano(u.id, p.id);
  if (usados >= limiteDoPlano(p)) {
    return toast(p.id === 0 ? 'O plano grátis só pode ser usado 1 vez.' : 'Este plano já foi contratado 2 vezes.');
  }
  const sel = el('investirPlano'); if (sel) sel.value = String(id);
  const info = el('investirInfo');
  if (info) info.textContent = `${p.nome} • Entrada ${fmtBRL(p.entrada)} • Diária ${fmtBRL(p.diaria)} por ${p.ciclo} dias • Total ${fmtBRL(p.retorno)}`;
  const dlg = el('investirDialog'); if (dlg) dlg.showModal();
}

// Timer: próximo rendimento no horário exato da compra (24h)
function proxPagamentoCliente(inv) {
  let t = Date.parse(inv.proximo_pagamento || '');
  if (!isFinite(t)) {
    t = Date.parse(inv.data_inicio || '');
    if (!isFinite(t)) t = Date.now();
    t += 24 * 60 * 60 * 1000;
  }
  return new Date(t).toISOString();
}
function atualizarTimers() {
  document.querySelectorAll('[data-proximo]').forEach(el => {
    const alvo = Date.parse(el.dataset.proximo || '');
    if (!isFinite(alvo)) { el.querySelector('strong').textContent = ' breve'; return; }
    let diff = alvo - Date.now();
    if (diff <= 0) { el.querySelector('strong').textContent = ' processando...'; return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.querySelector('strong').textContent =
      String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  });
}
setInterval(atualizarTimers, 1000);

async function carregarInvestimentos() {
  const tbody = el('investimentosBody'); if (!tbody || !db) return;
  const u = usuarioLocal();
  try {
    const keys = await chavesDaLista('investimentos_usuario/' + u.id);
    const itens = await lerCada('investimentos', keys);
    const lista = itens.map(x => x.valor).sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''));
    if (!lista.length) {
      tbody.innerHTML = '<p class="empty-state">Você ainda não tem investimentos. Escolha um plano abaixo para começar.</p>';
      return;
    }
    tbody.innerHTML = lista.map(inv => {
      const dias = Number(inv.dias_pagos || 0);
      const total = Number(inv.duracao_dias || 0) || 1;
      const pct = Math.min(100, Math.round((dias / total) * 100));
      const ativo = inv.status === 'ativo';
      return `<article class="invest-card">
        <div class="invest-head">
          <div class="invest-plan"><span class="invest-dot"></span><strong>${inv.plano_nome || 'Investimento'}</strong></div>
          <span class="invest-status ${ativo ? 'on' : ''}">${ativo ? 'Ativo' : 'Concluído'}</span>
        </div>
        <div class="invest-values">
          <div><span>Aplicado</span><strong>${fmtBRL(inv.valor_aplicado)}</strong></div>
          <div><span>Diária</span><strong class="up">+ ${fmtBRL(inv.rendimento_diario)}</strong></div>
          <div><span>Recebido</span><strong>${fmtBRL(inv.rendimento_pago)}</strong></div>
        </div>
        <div class="invest-progress">
          <div class="invest-progress-top"><span>Progresso</span><span>${dias} de ${total} dias</span></div>
          <div class="invest-bar"><i style="width:${pct}%"></i></div>
        </div>
        ${ativo ? `<div class="invest-timer" data-proximo="${proxPagamentoCliente(inv)}">
          <span class="invest-timer-ico" aria-hidden="true">⏱</span>
          <span class="invest-timer-txt">Próximo rendimento em <strong>--:--:--</strong></span>
        </div>` : ''}
      </article>`;
    }).join('');
  } catch (e) { console.error('[Investimentos]', e); }
}

async function carregarExtrato() {
  const box = el('extratoLista'); if (!box || !db) return;
  const u = usuarioLocal();
  try {
    const keys = await chavesDaLista('transacoes_usuario/' + u.id);
    const itens = await lerCada('transacoes', keys);
    const lista = itens.map(x => x.valor).sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || '')).slice(0, 30);
    if (!lista.length) { box.innerHTML = '<p class="empty-state">Nenhuma movimentação ainda.</p>'; return; }
    box.innerHTML = lista.map(t => `
      <div class="movimento">
        <div><strong>${t.tipo || 'Transação'}</strong><small>${fmtData(t.criado_em)}</small></div>
        <span class="${['rendimento', 'bonus', 'indicacao', 'retorno', 'deposito'].includes(t.tipo) ? 'positivo' : 'negativo'}">${['saque', 'investimento'].includes(t.tipo) ? '-' : '+'} ${fmtBRL(t.valor)}</span>
      </div>`).join('');
  } catch (e) { console.error('[Extrato]', e); }
}
function mostrarExtrato() {
  const d = el('extratoDialog'); if (d) d.showModal();
}
function copiarLinkIndicacao() {
  const input = el('linkIndicacao'); if (!input) return;
  input.select(); input.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); } catch (e) { if (navigator.clipboard) navigator.clipboard.writeText(input.value); }
  toast('Link de indicação copiado!');
}

// ------------------------------------------------------------
// DEPÓSITO PIX
// ------------------------------------------------------------
let pixInterval = null;
let pixAtual = null;
let pixCancelado = false;

function setDepositoValor(v) { const c = el('depositoValor'); if (c) c.value = v; }
function configurarCarteira() {
  const f = el('depositoForm'); if (!f) return;
  const campo = el('depositoValor');
  const opcoes = f.querySelectorAll('[data-valor]');
  opcoes.forEach(b => {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      campo.value = Number(b.dataset.valor).toFixed(2).replace('.', ',');
      opcoes.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      setMensagem('depositoMsg', '');
    });
  });
  campo.addEventListener('input', () => {
    const v = lerValor(campo.value);
    opcoes.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.valor) === v)));
  });
  f.addEventListener('submit', (e) => { e.preventDefault(); gerarPix(); });
  const sf = el('saqueForm');
  if (sf) {
    el('saqueValor').addEventListener('input', atualizarTaxa);
    sf.addEventListener('submit', (e) => { e.preventDefault(); confirmarSaque(e); });
  }
  document.querySelectorAll('.money-dialog').forEach(d => {
    const close = d.querySelector('[data-close]');
    if (close) close.addEventListener('click', () => { pixCancelado = true; d.close(); });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  });
}

async function gerarPix() {
  const valor = lerValor(el('depositoValor').value);
  if (!(valor >= CONFIG.depositoMinimo)) return setMensagem('depositoMsg', `Depósito mínimo: ${fmtBRL(CONFIG.depositoMinimo)}.`, 'error');
  if (valor > CONFIG.depositoMaximo) return setMensagem('depositoMsg', `Valor máximo por depósito: ${fmtBRL(CONFIG.depositoMaximo)}.`, 'error');
  const u = usuarioLocal(); if (!u) return toast('Faça login primeiro.');
  if (typeof SigiloPay === 'undefined') return toast('Módulo de pagamento não carregado.');

  pixCancelado = false;
  const btn = el('btnGerarPix') || document.querySelector('#depositoForm button[type="submit"]');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Gerando...'; }
  setMensagem('depositoMsg', 'Gerando seu PIX...', 'loading');

  try {
    const r = await SigiloPay.criarCobrancaPIX(valor, 'Depósito Taxinexo', u.email, u.id);
    if (!r.sucesso) return setMensagem('depositoMsg', 'Erro: ' + r.mensagem, 'error');
    pixAtual = r;

    const etapa1 = el('pixEtapa1'), etapa2 = el('pixEtapa2');
    if (etapa1) etapa1.style.display = 'none';
    if (etapa2) etapa2.style.display = 'block';

    const qr = el('pixQrCode');
    if (qr) {
      qr.innerHTML = '';
      if (r.qr_code_base64) {
        qr.innerHTML = `<img src="data:image/png;base64,${r.qr_code_base64}" alt="QR Code PIX" style="width:220px;height:220px;border-radius:14px;border:6px solid white;">`;
      } else if (r.qr_code_image) {
        // imagem gerada (QR server) — com fallback se falhar
        qr.innerHTML = `<img src="${r.qr_code_image}" alt="QR Code PIX" style="width:220px;height:220px;border-radius:14px;border:6px solid white;background:#fff;" onerror="this.parentElement.innerHTML='<p style=&quot;color:var(--muted)&quot;Código PIX: '+this.alt+'</p>'">`;
      } else if (typeof QRCode !== 'undefined') {
        new QRCode(qr, { text: r.qr_code_copia_cola, width: 220, height: 220, colorDark: '#000', colorLight: '#fff' });
      } else {
        qr.innerHTML = `<p style="color:var(--muted)">Código: ${r.qr_code_copia_cola}</p>`;
      }
    }
    if (el('pixCopiaCola')) el('pixCopiaCola').value = r.qr_code_copia_cola || '';
    if (el('pixValor')) el('pixValor').textContent = fmtBRL(valor);

    if (db) {
      const txDep = await db.child('transacoes').push({
        usuario_id: u.id, usuario_email: u.email, usuario_nome: u.nome,
        tipo: 'deposito', valor, status: 'pendente',
        identifier: r.identifier, criado_em: new Date().toISOString()
      });
      await db.child('transacoes_usuario/' + u.id + '/' + txDep.key).set(true);
      await db.child('identifier_index/' + r.identifier).set(txDep.key);
    }
    setMensagem('depositoMsg', 'PIX gerado! Escaneie ou copie o código.', 'success');
    iniciarVerificacao(r.identifier, valor, u);
  } catch (e) {
    console.error('[PIX]', e);
    setMensagem('depositoMsg', 'Erro ao gerar PIX: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

function iniciarVerificacao(identifier, valor, usuario) {
  if (pixInterval) clearInterval(pixInterval);
  pixCancelado = false;
  let tentativas = 0;
  const max = 600; // 30 min (3s)
  pixInterval = setInterval(async () => {
    if (pixCancelado) { clearInterval(pixInterval); pixInterval = null; return; }
    if (++tentativas > max) {
      clearInterval(pixInterval); pixInterval = null;
      setMensagem('pixStatus', 'Tempo expirado. Gere um novo PIX.', 'error');
      return;
    }
    try {
      if (!db) return;
      // O Webhook é a fonte autoritativa e quem credita o saldo.
      // Aqui apenas acompanhamos o status da transação no Firebase
      // (o polling da SigiloPay é bloqueado com 429 — não usar mais).
      const idx = await db.child('identifier_index/' + identifier).once('value');
      const tk = idx.val();
      if (!tk) return;
      const st = await db.child('transacoes/' + tk + '/status').once('value');
      if (pixCancelado) return;
      if (String(st.val() || '').toLowerCase() === 'aprovada') {
        clearInterval(pixInterval); pixInterval = null;
        const snap = await db.child('usuarios/' + usuario.id).once('value');
        if (snap.exists()) salvarUsuarioLocal(snap.val());
        setMensagem('pixStatus', 'Pagamento confirmado! Saldo atualizado.', 'success');
        setTimeout(() => location.reload(), 2000);
      }
    } catch (e) { /* silencioso: tenta de novo */ }
  }, 3000);
}

function copiarPix() {
  const c = el('pixCopiaCola'); if (!c) return;
  c.select(); c.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); } catch (e) { if (navigator.clipboard) navigator.clipboard.writeText(c.value); }
  toast('Código PIX copiado!');
}

// ------------------------------------------------------------
// INVESTIMENTO
// ------------------------------------------------------------
async function confirmarInvestimento() {
  const sel = el('investirPlano');
  const p = planos.find(x => x.id === Number(sel && sel.value));
  if (!p) return toast('Selecione um plano.');
  const u = usuarioLocal();
  const total = (Number(u.saldo) || 0) + (Number(u.saldo_indicacao) || 0);
  if (total < p.entrada) return toast(`Saldo insuficiente! Você tem ${fmtBRL(total)} e precisa de ${fmtBRL(p.entrada)}.`);
  if (!db) return toast('Firebase não conectado.');
  const usados = await contarInvestimentosDoPlano(u.id, p.id);
  if (usados >= limiteDoPlano(p)) {
    return toast(p.id === 0 ? 'O plano grátis só pode ser usado 1 vez.' : 'Este plano já foi contratado 2 vezes.');
  }

  try {
    const agora = new Date();
    const fim = new Date(agora.getTime() + p.ciclo * 86400000);
    const invRef = await db.child('investimentos').push({
      usuario_id: u.id, usuario_email: u.email, usuario_nome: u.nome,
      plano_id: p.id, plano_nome: p.nome,
      valor_aplicado: p.entrada, rendimento_diario: p.diaria,
      rendimentoDiario: p.diaria, total_projetado: p.retorno,
      duracao_dias: p.ciclo, duracao: p.ciclo,
      dias_pagos: 0, rendimento_pago: 0,
      data_inicio: agora.toISOString(), data_fim: fim.toISOString(),
      proximo_pagamento: new Date(agora.getTime() + 86400000).toISOString(),
      status: 'ativo', criado_em: agora.toISOString()
    });
    await db.child('investimentos_usuario/' + u.id + '/' + invRef.key).set(true);

    const snap = await db.child('usuarios/' + u.id).once('value');
    if (snap.exists()) {
      const key = u.id;
      const atual = snap.val();
      const descontoInd = Math.min(p.entrada, Number(atual.saldo_indicacao) || 0);
      const descontoSaldo = p.entrada - descontoInd;
      await db.child('usuarios/' + key + '/saldo_indicacao').set((Number(atual.saldo_indicacao) || 0) - descontoInd);
      await db.child('usuarios/' + key + '/saldo').set((Number(atual.saldo) || 0) - descontoSaldo);
      await db.child('usuarios/' + key + '/investido').set((Number(atual.investido) || 0) + p.entrada);

      // Bônus de indicação (uma vez)
      if (atual.indicado_por && !atual.bonus_recebido) {
        const ps = await db.child('usuarios/' + atual.indicado_por).once('value');
        if (ps.exists()) {
          const pk = atual.indicado_por;
          const padrinho = ps.val();
          await db.child('usuarios/' + pk + '/saldo_indicacao').set((Number(padrinho.saldo_indicacao) || 0) + CONFIG.bonusIndicacao);
          await db.child('usuarios/' + pk + '/bonus').set((Number(padrinho.bonus) || 0) + CONFIG.bonusIndicacao);
          const txInd = await db.child('transacoes').push({
            usuario_id: padrinho.id, usuario_email: padrinho.email, usuario_nome: padrinho.nome,
            tipo: 'indicacao', valor: CONFIG.bonusIndicacao, status: 'aprovada',
            observacao: `Bônus por indicação — ${atual.nome} investiu`, criado_em: new Date().toISOString()
          });
          await db.child('transacoes_usuario/' + padrinho.id + '/' + txInd.key).set(true);
          await db.child('usuarios/' + key + '/bonus_recebido').set(true);
        }
      }

      u.saldo = (Number(atual.saldo) || 0) - descontoSaldo;
      u.saldo_indicacao = (Number(atual.saldo_indicacao) || 0) - descontoInd;
      u.investido = (Number(atual.investido) || 0) + p.entrada;
      salvarUsuarioLocal(u);

      const txInv = await db.child('transacoes').push({
        usuario_id: u.id, usuario_email: u.email, usuario_nome: u.nome,
        tipo: 'investimento', valor: p.entrada, status: 'aprovada',
        observacao: `Investimento no plano ${p.nome}`, criado_em: new Date().toISOString()
      });
      await db.child('transacoes_usuario/' + u.id + '/' + txInv.key).set(true);
      db.child('plataforma/total_investido').transaction(v => (v || 0) + p.entrada);
    }
    toast(`Investimento confirmado!\n\nPlano: ${p.nome}\nValor: ${fmtBRL(p.entrada)}\nDiária: ${fmtBRL(p.diaria)} por ${p.ciclo} dias\nTotal projetado: ${fmtBRL(p.retorno)}`);
    const d = el('investirDialog'); if (d) d.close();
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    console.error('[Investir]', e);
    toast('Erro ao investir: ' + e.message);
  }
}

// ------------------------------------------------------------
// SAQUE
// ------------------------------------------------------------
async function saquesEstaoBloqueados() {
  if (!db) return { bloqueado: false };
  try {
    const s = await db.child('controle/saques_bloqueados').once('value');
    const v = s.val();
    return { bloqueado: !!(v && v.bloqueado), mensagem: (v && v.mensagem) || 'Saques temporariamente bloqueados.' };
  } catch (e) { return { bloqueado: false }; }
}
async function contarSaquesHoje(uid) {
  if (!db) return 0;
  const keys = await chavesDaLista('saques_usuario/' + uid);
  const itens = await lerCada('saques', keys);
  return itens.filter(x => (x.valor.criado_em || '').split('T')[0] === hoje()).length;
}

async function confirmarSaque(ev) {
  const valor = lerValor(el('saqueValor').value);
  const pix = el('saquePix').value.trim();
  const u = usuarioLocal(); if (!u) return toast('Faça login primeiro.');

  const controle = await saquesEstaoBloqueados();
  if (controle.bloqueado) return toast(controle.mensagem);
  if (!horarioSaquePermitido()) return toast(`Saques permitidos das ${CONFIG.horarioSaqueInicio}h às ${CONFIG.horarioSaqueFim}h. Disponível: ${proximoHorarioSaque()}.`);
  if (!(valor >= CONFIG.saqueMinimo)) return toast(`Saque mínimo: ${fmtBRL(CONFIG.saqueMinimo)}.`);
  if (pix.length < 4) return toast('Digite uma chave Pix válida.');
  const feitos = await contarSaquesHoje(u.id);
  if (feitos >= CONFIG.saquesPorDia) return toast(`Você já fez ${CONFIG.saquesPorDia} saques hoje.`);
  if ((Number(u.saldo) || 0) < valor) return toast(`Saldo insuficiente! Você tem ${fmtBRL(u.saldo)}.`);
  // Só permite saque para quem já fez um depósito real.
  if ((Number(u.total_depositado) || 0) <= 0) return toast('Você precisa fazer um depósito antes de solicitar um saque.');
  if (!db) return toast('Firebase não conectado.');

  const c = calcularSaque(valor);
  if (typeof SigiloPay !== 'undefined' && SigiloPay.consultarSaldo) {
    const s = await SigiloPay.consultarSaldo();
    if (s.sucesso && s.available < c.liquido) return toast('Saque temporariamente indisponível: saldo em processamento.');
  }

  if (!confirm(`Confirmar saque?\n\nValor bruto: ${fmtBRL(c.bruto)}\nTaxa (${CONFIG.taxaSaquePorcento}%): ${fmtBRL(c.taxa)}\nVocê recebe: ${fmtBRL(c.liquido)}`)) return;

  const btn = ev && ev.target && ev.target.querySelector ? ev.target.querySelector('button[type="submit"]') : null;
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Processando...'; }
  try {
    const r = await SigiloPay.criarTransferencia(c.liquido, pix, { nome: u.nome, cpf: u.cpf }, u.id);
    if (!r.sucesso) return setMensagem('saqueMsg', 'Erro no saque: ' + r.mensagem, 'error');

    const snap = await db.child('usuarios/' + u.id).once('value');
    if (snap.exists()) {
      const key = u.id;
      const novoSaldo = (Number(u.saldo) || 0) - valor;
      await db.child('usuarios/' + key + '/saldo').set(novoSaldo);
      const saqueRef = await db.child('saques').push({
        usuario_id: u.id, usuario_nome: u.nome, usuario_email: u.email,
        valor_bruto: c.bruto, taxa: c.taxa, valor_liquido: c.liquido,
        chave_pix: pix, status: 'processando', withdraw_id: r.withdraw_id,
        receipt_url: r.receipt_url, criado_em: new Date().toISOString()
      });
      await db.child('saques_usuario/' + u.id + '/' + saqueRef.key).set(true);
      const txSaq = await db.child('transacoes').push({
        usuario_id: u.id, usuario_email: u.email, usuario_nome: u.nome,
        tipo: 'saque', valor: c.liquido, status: 'aprovada',
        observacao: `Saque de ${fmtBRL(c.bruto)} — taxa ${fmtBRL(c.taxa)}`, criado_em: new Date().toISOString()
      });
      await db.child('transacoes_usuario/' + u.id + '/' + txSaq.key).set(true);
      db.child('plataforma/taxas_recebidas').transaction(v => (v || 0) + c.taxa);
      u.saldo = novoSaldo; salvarUsuarioLocal(u);
    }
    toast(`Saque enviado!\n\nVocê recebe: ${fmtBRL(c.liquido)}`);
    const d = el('saqueDialog'); if (d) d.close();
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    console.error('[Saque]', e);
    setMensagem('saqueMsg', 'Erro ao solicitar saque: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ------------------------------------------------------------
// ADMIN
// ------------------------------------------------------------
function entrarAdmin() {
  if (el('adminSenha').value !== ADMIN_SENHA) return setMensagem('adminMsg', 'Senha incorreta.', 'error');
  sessionStorage.setItem('admin_taxinexo', 'sim');
  carregarAdmin();
}
async function carregarAdmin() {
  if (sessionStorage.getItem('admin_taxinexo') !== 'sim') return;
  if (!db) return;
  try {
    const [us, inv, saq, tx] = await Promise.all([
      db.child('usuarios').once('value'),
      db.child('investimentos').once('value'),
      db.child('saques').once('value'),
      db.child('transacoes').once('value')
    ]);
    const usuarios = Object.values(us.val() || {});
    const investimentos = Object.values(inv.val() || {});
    const saques = Object.values(saq.val() || {});
    const transacoes = Object.values(tx.val() || {});
    const soma = (arr, campo) => arr.reduce((a, x) => a + (Number(x[campo]) || 0), 0);

    if (el('adminUsuarios')) el('adminUsuarios').textContent = usuarios.length;
    if (el('adminInvestimentos')) el('adminInvestimentos').textContent = investimentos.filter(i => i.status === 'ativo').length;
    if (el('adminTotalInvestido')) el('adminTotalInvestido').textContent = fmtBRL(soma(investimentos, 'valor_aplicado'));
    if (el('adminTotalRendimentos')) el('adminTotalRendimentos').textContent = fmtBRL(soma(usuarios, 'rendimentos'));
    if (el('adminTotalSaques')) el('adminTotalSaques').textContent = fmtBRL(soma(saques.filter(s => s.status === 'pago'), 'valor_liquido'));

    if (el('adminSaldoGateway')) {
      try {
        const sg = await SigiloPay.consultarSaldo();
        el('adminSaldoGateway').textContent = sg.sucesso ? fmtBRL(sg.available) : '—';
      } catch (_) { el('adminSaldoGateway').textContent = '—'; }
    }

    const tbody = el('adminRendimentosBody');
    if (tbody) {
      const ativos = investimentos.filter(i => i.status === 'ativo');
      tbody.innerHTML = ativos.length ? ativos.map(i => `<tr>
        <td>${i.usuario_nome || '-'}</td><td>${i.plano_nome || '-'}</td>
        <td>${fmtBRL(i.rendimento_diario)}</td><td>${Number(i.dias_pagos || 0)}/${Number(i.duracao_dias || 0)}</td>
        <td>${fmtBRL(i.rendimento_pago)}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;">Nenhum investimento ativo.</td></tr>';
    }

    const tSaques = el('adminSaquesBody');
    if (tSaques) {
      tSaques.innerHTML = saques.length ? saques.slice().reverse().slice(0, 50).map(s => `<tr>
        <td>${s.usuario_nome || '-'}</td><td>${fmtBRL(s.valor_bruto)}</td>
        <td>${fmtBRL(s.valor_liquido)}</td><td>${fmtData(s.criado_em)}</td><td>${s.status}</td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;">Nenhum saque.</td></tr>';
    }
  } catch (e) { console.error('[Admin]', e); }
}
async function processarRendimentos() {
  if (!db) return toast('Firebase não conectado.');
  if (!confirm('Processar rendimentos de TODOS os clientes agora?')) return;
  const btn = event && event.target;
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Verificando saldo...'; }
  try {
    const saldo = await SigiloPay.consultarSaldo();
    if (!saldo.sucesso) return toast('Não foi possível consultar o saldo da SigiloPay.');
    const snap = await db.child('investimentos').once('value');
    const dados = snap.val() || {};
    const ativos = Object.entries(dados).filter(([k, i]) => i.status === 'ativo');
    const necessario = ativos.reduce((a, [k, i]) => a + (Number(i.rendimento_diario) || 0), 0);
    if (!ativos.length) return toast('Nenhum investimento ativo.');
    if (saldo.available < necessario) return toast(`Saldo insuficiente na SigiloPay. Disponível: ${fmtBRL(saldo.available)}. Necessário: ${fmtBRL(necessario)}.`);

    if (btn) btn.innerHTML = 'Processando...';
    let creditados = 0, total = 0, finalizados = 0;
    for (const [key, inv] of ativos) {
      const dias = (Number(inv.dias_pagos) || 0) + 1;
      const duracao = Number(inv.duracao_dias) || 10;
      const diaria = Number(inv.rendimento_diario) || 0;
      await db.child('investimentos/' + key + '/dias_pagos').set(dias);
      await db.child('investimentos/' + key + '/rendimento_pago').set((Number(inv.rendimento_pago) || 0) + diaria);

      const us = await db.child('usuarios/' + inv.usuario_id).once('value');
      if (us.exists()) {
        const uk = inv.usuario_id;
        const user = us.val();
        await db.child('usuarios/' + uk + '/saldo').set((Number(user.saldo) || 0) + diaria);
        await db.child('usuarios/' + uk + '/rendimentos').set((Number(user.rendimentos) || 0) + diaria);
        const txRen = await db.child('transacoes').push({
          usuario_id: inv.usuario_id, usuario_email: inv.usuario_email, usuario_nome: inv.usuario_nome,
          tipo: 'rendimento', valor: diaria, status: 'aprovada',
          observacao: `Rendimento diário — ${inv.plano_nome}`, criado_em: new Date().toISOString()
        });
        await db.child('transacoes_usuario/' + uk + '/' + txRen.key).set(true);
        creditados++; total += diaria;
      }
      if (dias >= duracao) {
        await db.child('investimentos/' + key + '/status').set('concluido');
        await db.child('investimentos/' + key + '/concluido_em').set(new Date().toISOString());
        const aplicado = Number(inv.valor_aplicado) || 0;
        const saldo2 = await SigiloPay.consultarSaldo();
        if (!saldo2.sucesso || saldo2.available < aplicado) continue;
        const us2 = await db.child('usuarios/' + inv.usuario_id).once('value');
        if (us2.exists()) {
          const uk2 = inv.usuario_id;
          const user2 = us2.val();
          await db.child('usuarios/' + uk2 + '/saldo').set((Number(user2.saldo) || 0) + aplicado);
          const txRet = await db.child('transacoes').push({
            usuario_id: inv.usuario_id, usuario_email: inv.usuario_email, usuario_nome: inv.usuario_nome,
            tipo: 'retorno', valor: aplicado, status: 'aprovada',
            observacao: `Retorno do investimento — ${inv.plano_nome}`, criado_em: new Date().toISOString()
          });
          await db.child('transacoes_usuario/' + uk2 + '/' + txRet.key).set(true);
        }
        finalizados++;
      }
    }
    db.child('plataforma/rendimentos_pagos').transaction(v => (v || 0) + total);
    toast(`Rendimentos processados!\n\nCreditados: ${creditados}\nFinalizados: ${finalizados}\nTotal pago: ${fmtBRL(total)}`);
    carregarAdmin();
  } catch (e) {
    console.error('[Rendimentos]', e);
    toast('Erro ao processar: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}
async function alternarBloqueioSaques() {
  if (!db) return;
  const s = await db.child('controle/saques_bloqueados').once('value');
  const atual = s.val() || { bloqueado: false };
  const bloqueado = !atual.bloqueado;
  const mensagem = bloqueado
    ? (el('adminMotivoBloqueio') && el('adminMotivoBloqueio').value.trim()) || 'Saques temporariamente bloqueados.'
    : '';
  await db.child('controle/saques_bloqueados').set({ bloqueado, mensagem, atualizado_em: new Date().toISOString() });
  toast(bloqueado ? 'Saques bloqueados.' : 'Saques liberados.');
  carregarAdmin();
}

// ------------------------------------------------------------
// ADMIN — LINK DO GRUPO
// ------------------------------------------------------------
const LINK_GRUPO_PADRAO = 'https://chat.whatsapp.com/D1oeBvP9L0a86cf6ZgWXgP?s=cl&p=a&iam=2';
function aplicarLinkGrupo(url) {
  const link = String(url || LINK_GRUPO_PADRAO);
  document.querySelectorAll('#linkGrupo').forEach(a => { a.href = link; });
  localStorage.setItem('taxinexo_link_grupo', link);
}
async function carregarLinkGrupo() {
  let url = LINK_GRUPO_PADRAO;
  try {
    if (db) {
      const s = await db.child('config/link_grupo').once('value');
      if (s.exists() && s.val()) url = s.val();
    }
  } catch (_) {
    url = localStorage.getItem('taxinexo_link_grupo') || LINK_GRUPO_PADRAO;
  }
  aplicarLinkGrupo(url);
  const campo = el('adminLinkGrupo');
  if (campo) campo.value = url;
  return url;
}
async function salvarLinkGrupo() {
  const campo = el('adminLinkGrupo');
  if (!campo) return;
  const url = campo.value.trim();
  if (!/^https?:\/\//i.test(url)) return setMensagem('adminLinkGrupoMsg', 'Informe uma URL válida (começa com https://).', 'error');
  if (!db) return setMensagem('adminLinkGrupoMsg', 'Firebase não conectado.', 'error');
  await db.child('config/link_grupo').set(url);
  aplicarLinkGrupo(url);
  setMensagem('adminLinkGrupoMsg', 'Link do grupo salvo e aplicado em todas as páginas.', 'success');
}

// ------------------------------------------------------------
// ADMIN — CÓDIGOS DA ROLETA
// ------------------------------------------------------------
function listaCodigosRoleta() {
  const bruto = CONFIG.codigo_roleta || 'ROLETA';
  const arr = Array.isArray(bruto) ? bruto : String(bruto).split(/[\n,]+/);
  return arr.map(x => String(x).trim().toUpperCase()).filter(Boolean);
}
async function carregarCodigosRoleta() {
  if (!db) return;
  try {
    const s = await db.child('config/codigo_roleta').once('value');
    if (s.exists()) CONFIG.codigo_roleta = s.val();
    const campo = el('adminCodigosRoleta');
    if (campo) campo.value = listaCodigosRoleta().join('\n');
  } catch (e) { console.warn('[Roleta]', e); }
}
async function salvarCodigosRoleta() {
  const campo = el('adminCodigosRoleta');
  if (!campo || !db) return;
  const lista = campo.value.split(/[\n,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
  if (!lista.length) return setMensagem('adminRoletaMsg', 'Digite pelo menos um código.', 'error');
  await db.child('config/codigo_roleta').set(lista);
  CONFIG.codigo_roleta = lista;
  setMensagem('adminRoletaMsg', lista.length + ' código(s) salvo(s) e ativo(s) agora.', 'success');
}

// Códigos de bônus (1 resgate por código por cliente)
function listaCodigosBonus() {
  const bruto = CONFIG.codigo_bonus || 'TAXINEXO';
  const arr = Array.isArray(bruto) ? bruto : String(bruto).split(/[\n,]+/);
  return arr.map(x => String(x).trim().toUpperCase()).filter(Boolean);
}
async function carregarCodigosBonus() {
  if (!db) return;
  try {
    const s = await db.child('config/codigo_bonus').once('value');
    if (s.exists()) CONFIG.codigo_bonus = s.val();
    const campo = el('adminCodigosBonus');
    if (campo) campo.value = listaCodigosBonus().join('\n');
  } catch (e) { console.warn('[Bônus]', e); }
}
async function salvarCodigosBonus() {
  const campo = el('adminCodigosBonus');
  if (!campo || !db) return;
  const lista = campo.value.split(/[\n,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
  if (!lista.length) return setMensagem('adminBonusMsg', 'Digite pelo menos um código.', 'error');
  await db.child('config/codigo_bonus').set(lista);
  CONFIG.codigo_bonus = lista;
  setMensagem('adminBonusMsg', lista.length + ' código(s) salvo(s) e ativo(s) agora.', 'success');
}
async function resgatarBonus(codigo, usuario) {
  if (!listaCodigosBonus().includes(codigo)) return setMensagem('bonusResult', 'Código inválido.', 'error');
  if (!db) return setMensagem('bonusResult', 'Firebase não conectado.', 'error');
  const jaPegou = await db.child('bonus_resgates/' + usuario.id + '/' + codigo).once('value');
  if (jaPegou.exists()) return setMensagem('bonusResult', 'Você já resgatou este código.', 'error');
  const valor = Math.round((Number(CONFIG.valor_bonus) || 5) * 100) / 100;
  const snap = await db.child('usuarios/' + usuario.id).once('value');
  if (!snap.exists()) return setMensagem('bonusResult', 'Usuário não encontrado.', 'error');
  const atual = snap.val();
  await db.child('usuarios/' + usuario.id + '/saldo').set((Number(atual.saldo) || 0) + valor);
  await db.child('bonus_resgates/' + usuario.id + '/' + codigo).set(new Date().toISOString());
  const tx = await db.child('transacoes').push({
    usuario_id: usuario.id, usuario_email: usuario.email, usuario_nome: usuario.nome,
    tipo: 'bonus', valor, status: 'aprovada',
    observacao: `Bônus resgatado — código ${codigo}`, criado_em: new Date().toISOString()
  });
  await db.child('transacoes_usuario/' + usuario.id + '/' + tx.key).set(true);
  usuario.saldo = (Number(atual.saldo) || 0) + valor;
  salvarUsuarioLocal(usuario);
  if (el('saldo')) el('saldo').textContent = Number(usuario.saldo).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  setMensagem('bonusResult', `Bônus de ${fmtBRL(valor)} creditado no seu saldo!`, 'success');
}

// ------------------------------------------------------------
// BÔNUS E RODADA
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  configurarCarteira();
  carregarCodigosRoleta();
  carregarLinkGrupo();

  if (location.pathname.includes('cliente.html')) iniciarDashboard();

  const bonusForm = el('bonusForm');
  if (bonusForm) {
    bonusForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = el('bonusCode').value.trim().toUpperCase();
      const u = usuarioLocal();
      if (!u) return setMensagem('bonusResult', 'Faça login para resgatar.', 'error');
      setMensagem('bonusResult', 'Resgatando...', 'loading');
      await resgatarBonus(code, u);
    });
  }

  let spinning = false, rotation = 0;
  const wheelForm = el('wheelForm');
  if (wheelForm) {
    wheelForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (spinning) return;
      const digitado = el('wheelCode').value.trim().toUpperCase();
      if (!listaCodigosRoleta().includes(digitado))
        return setMensagem('wheelResult', 'Código inválido.', 'error');
      spinning = true;
      const btn = el('spinButton'), wheel = el('luckWheel');
      btn.disabled = true; el('wheelCode').disabled = true; btn.textContent = 'Girando…';
      setMensagem('wheelResult', 'Aguarde o resultado do giro…', 'loading');
      const seg = Math.floor(Math.random() * 6);
      const alvo = (360 - (seg * 60 + 30)) % 360;
      rotation += 360 * 5 + (alvo - (rotation % 360) + 360) % 360;
      wheel.style.transform = `rotate(${rotation}deg)`;
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3700;
      setTimeout(() => {
        const premios = ['2,00', '5,00', '10,00', '2,00', '5,00', '10,00'];
        setMensagem('wheelResult', `Resultado: R$ ${premios[seg]}!`, 'success');
        spinning = false; btn.disabled = false; el('wheelCode').disabled = false; btn.textContent = 'Girar novamente';
      }, delay);
    });
  }

  if (location.pathname.includes('admin.html')) {
    if (sessionStorage.getItem('admin_taxinexo') === 'sim') carregarAdmin();
  }
});

// Compatibilidade com o HTML antigo (chamadas inline)
function mostrarExtratoAntigo() { mostrarExtrato(); }
