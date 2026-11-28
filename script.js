/* ============================================================
   VELOSTER CAPITAL — SCRIPT PRINCIPAL
   Cloudflare Worker + D1 + SigiloPay + Admin + Dashboard
   ============================================================ */

// ------------------------------------------------------------
// BACKEND (Cloudflare Worker + D1)
// ------------------------------------------------------------
const WORKER_BASE = 'https://taxinexo-webhook.gabrielrobin63.workers.dev';
const TAX_API = WORKER_BASE + '/api';
const DB_API = WORKER_BASE + '/db';

function adminToken() {
  try { return sessionStorage.getItem('admin_token') || ''; } catch (_) { return ''; }
}
function sessionToken() {
  if (/\/admin(\.html)?\/?$/i.test(location.pathname)) {
    const a = adminToken();
    if (a) return a;
  }
  try { return localStorage.getItem('token_taxinexo') || ''; } catch (_) { return ''; }
}

class StoreSnapshot {
  constructor(valor) { this._valor = valor; }
  val() { return this._valor; }
  exists() { return this._valor !== null && this._valor !== undefined; }
}

class StoreRef {
  constructor(caminho = '') {
    this.path = String(caminho || '').replace(/^\/+|\/+$/g, '');
  }
  child(caminho) {
    const p = String(caminho || '').replace(/^\/+|\/+$/g, '');
    return new StoreRef(this.path ? this.path + '/' + p : p);
  }
  _url() {
    const seguro = this.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return DB_API + (seguro ? '/' + seguro : '');
  }
  async _req(method, body) {
    const headers = {};
    const token = sessionToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(this._url(), {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let j = {};
    try { j = await r.json(); } catch (_) {}
    if (!r.ok || j.ok === false) {
      const erro = new Error(j.message || ('Erro ' + r.status));
      erro.status = r.status;
      throw erro;
    }
    return j;
  }
  async once() { return new StoreSnapshot((await this._req('GET')).data ?? null); }
  async set(valor) { await this._req('PUT', valor); return this; }
  async update(valor) { await this._req('PATCH', valor); return this; }
  async remove() { await this._req('DELETE'); return this; }
  async push(valor) { const j = await this._req('POST', valor); return { key: j.name }; }
  async increment(delta) {
    const r = await fetch(WORKER_BASE + '/api/admin/increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken() },
      body: JSON.stringify({ path: this.path, delta: Number(delta) || 0 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'Erro ao incrementar.');
    return j;
  }
  async transaction(fn) {
    const atual = (await this.once()).val();
    const proximo = fn(atual);
    await this.set(proximo);
    return { committed: true, snapshot: new StoreSnapshot(proximo) };
  }
}

const db = new StoreRef('');
console.log('[Veloster] Banco via Worker:', DB_API);

// ------------------------------------------------------------
// CONFIGURAÇÕES
// ------------------------------------------------------------
const CONFIG = {
  depositoMinimo: 20,
  depositoMaximo: 500,
  saqueMinimo: 6,
  saquesPorDia: 2,
  taxaSaquePorcento: 10,
  horarioSaqueInicio: 0,
  horarioSaqueFim: 24,
  bonusIndicacao: 2.00,
  codigo_roleta: 'ROLETA',
  codigo_bonus: 'TAXINEXO',
  valor_bonus: 5.00
};

// Planos padrão. O admin pode adicionar/editar em Configurações > Planos;
// a versão salva em /config/planos substitui esta lista.
let planos = [
  { id: 0, nome: 'Veloster Capital Gratuito', entrada: 0, diaria: 0.50, ciclo: 20, retorno: 10, imagem: 'plan-car.webp', limite: 1 },
  { id: 1, nome: 'Plano 15', entrada: 15, diaria: 1.28, ciclo: 20, retorno: 25.60, imagem: 'plan-car.webp', limite: 2 },
  { id: 2, nome: 'Plano 25', entrada: 25, diaria: 2.13, ciclo: 20, retorno: 42.60, imagem: 'plan-car.webp', limite: 2 },
  { id: 3, nome: 'Plano 50', entrada: 50, diaria: 4.25, ciclo: 20, retorno: 85, imagem: 'plan-car.webp', limite: 2 },
  { id: 4, nome: 'Plano 100', entrada: 100, diaria: 8.50, ciclo: 20, retorno: 170, imagem: 'plan-car.webp', limite: 2 },
  { id: 5, nome: 'Plano 500', entrada: 500, diaria: 42.50, ciclo: 20, retorno: 850, imagem: 'plan-car.webp', limite: 2 },
  { id: 6, nome: 'Plano 700', entrada: 700, diaria: 59.50, ciclo: 20, retorno: 1190, imagem: 'plan-car.webp', limite: 2 },
  { id: 7, nome: 'Plano 1.000', entrada: 1000, diaria: 85.00, ciclo: 20, retorno: 1700, imagem: 'plan-car.webp', limite: 2 },
  { id: 8, nome: 'Plano 150', entrada: 150, diaria: 12.75, ciclo: 20, retorno: 255, imagem: 'plan-car.webp', limite: 2 },
  { id: 9, nome: 'Plano 200', entrada: 200, diaria: 17.00, ciclo: 20, retorno: 340, imagem: 'plan-car.webp', limite: 2 },
  { id: 10, nome: 'Plano 300', entrada: 300, diaria: 25.50, ciclo: 20, retorno: 510, imagem: 'plan-car.webp', limite: 2 },
  { id: 11, nome: 'Plano 2.000', entrada: 2000, diaria: 170.00, ciclo: 20, retorno: 3400, imagem: 'plan-car.webp', limite: 2 },
  { id: 12, nome: 'Plano 5.000', entrada: 5000, diaria: 425.00, ciclo: 20, retorno: 8500, imagem: 'plan-car.webp', limite: 2 }
];

// ------------------------------------------------------------
// UTILITÁRIOS
// ------------------------------------------------------------
const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const hoje = () => new Date().toISOString().split('T')[0];
const el = (id) => document.getElementById(id);
const valorTempo = (v) => {
  const n = Number(v);
  if (isFinite(n) && n > 0) return n;
  const d = Date.parse(v);
  return isFinite(d) ? d : 0;
};

// Índices manuais para consultas por e-mail/código no D1.
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
  if (id === 'saqueDialog') {
    const u = usuarioLocal() || {};
    if (el('saquePix')) el('saquePix').value = u.pix || '';
    if (el('saqueDocumento')) el('saqueDocumento').value = u.cpf || '';
    if (el('saqueNome')) el('saqueNome').value = u.nome || '';
    atualizarTaxa();
  }
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
function toast(msg) {
  try {
    const texto = String(msg == null ? '' : msg);
    // Se houver um modal aberto, o toast ficaria atrás dele (top layer).
    // Espelha a mensagem dentro do próprio modal, no aviso acima do botão.
    const dialogo = document.querySelector('dialog[open]');
    if (dialogo) {
      const alvo = dialogo.querySelector('.reward-result');
      if (alvo) {
        alvo.textContent = texto;
        const sucesso = /sucesso|enviad|conclu|realizad|criad|atualizad|liberad/i.test(texto);
        alvo.dataset.state = sucesso ? 'success' : 'error';
        try { alvo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
      }
    }

    let box = document.getElementById('toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = texto;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 4600);
  } catch (_) { alert(msg); }
}

// Mensagem de saque exibida dentro do modal, acima do botão Sacar
function avisoSaque(texto, estado = 'error') {
  setMensagem('saqueMsg', texto, estado);
  const alvo = el('saqueMsg');
  if (alvo) {
    try { alvo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  }
}

// Token do Cloudflare Turnstile gerado pelo widget da página
function tokenTurnstile(action) {
  const widget = document.querySelector('.cf-turnstile[data-action="' + action + '"]');
  const campo = widget && widget.querySelector('input[name="cf-turnstile-response"]');
  return campo ? String(campo.value || '') : '';
}

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
  sessionStorage.removeItem('admin_token');
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

// Preserva o código de indicação de QUALQUER página (ex.: alguém abre
// cliente.html?ref=CODIGO e é redirecionado para login/cadastro).
const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
function guardarRefIndicacao(ref) {
  const cod = String(ref || '').trim().toUpperCase();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(cod)) return;
  try { sessionStorage.setItem('taxinexo_ref', cod); } catch (_) {}
  try { localStorage.setItem('taxinexo_ref', JSON.stringify({ cod, em: Date.now() })); } catch (_) {}
}
function refIndicacao() {
  try {
    const daUrl = new URLSearchParams(location.search).get('ref');
    if (daUrl) return String(daUrl).trim().toUpperCase();

    const daSessao = sessionStorage.getItem('taxinexo_ref');
    if (daSessao) return String(daSessao).trim().toUpperCase();

    const bruto = localStorage.getItem('taxinexo_ref');
    if (!bruto) return '';
    let item;
    try { item = JSON.parse(bruto); } catch (_) { item = { cod: bruto, em: Date.now() }; }
    if (item && item.cod && (!item.em || Date.now() - Number(item.em) < REF_TTL_MS)) {
      return String(item.cod).trim().toUpperCase();
    }
    try { localStorage.removeItem('taxinexo_ref'); } catch (_) {}
    return '';
  } catch (_) { return ''; }
}
function limparRefIndicacao() {
  try { sessionStorage.removeItem('taxinexo_ref'); } catch (_) {}
  try { localStorage.removeItem('taxinexo_ref'); } catch (_) {}
}
(function capturarRef() {
  try { guardarRefIndicacao(new URLSearchParams(location.search).get('ref')); } catch (_) {}
})();

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
    const indicacao = (el('indicacao') && el('indicacao').value.trim().toUpperCase()) || refIndicacao();
    const termos = el('termos');

    if (nome.split(' ').length < 2) return toast('Digite seu nome completo.');
    if (cpf && !validarCPF(cpf)) return toast('CPF inválido!');
    if (celular.replace(/\D/g, '').length < 10) return toast('Celular inválido!');
    if (!validarEmail(email)) return toast('E-mail inválido!');
    if (typeof SigiloPay !== 'undefined' && !SigiloPay.validarChavePix(pix).valida) return toast('Chave Pix inválida! Use CPF, CNPJ, e-mail, celular ou chave aleatória.');
    if (senha.length < 8) return toast('Senha mínimo 8 caracteres.');
    if (!/[A-Z]/.test(senha)) return toast('A senha precisa ter MAIÚSCULA.');
    if (!/[a-z]/.test(senha)) return toast('A senha precisa ter minúscula.');
    if (!/\d/.test(senha)) return toast('A senha precisa ter número.');
    if (senha !== senha2) return toast('As senhas não coincidem!');
    if (termos && !termos.checked) return toast('Aceite os termos.');
    if (!db) return toast('Banco não conectado.');

    // O Worker valida e-mail duplicado de forma autoritativa.
    const turnstileToken = tokenTurnstile('register');
    if (!turnstileToken) return toast('Aguarde a verificação de segurança.');

    // Backend cria a conta e resolve o indicador — o frontend não decide o vínculo.
    const resp = await fetch(TAX_API + '/cadastro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome, email, cpf: cpf.replace(/\D/g, ''), celular: celular.replace(/\D/g, ''),
        pix, senha, indicacao, turnstileToken,
      }),
    });
    const cr = await resp.json().catch(() => ({}));
    if (!resp.ok || !cr.ok) return toast(cr.message || 'Erro ao criar conta.');
    const usuario = {
      id: cr.uid, nome, email, cpf: cpf.replace(/\D/g, ''), celular: celular.replace(/\D/g, ''),
      pix, saldo: 0, saldo_indicacao: 0, investido: 0, rendimentos: 0, bonus: 0, total_depositado: 0,
      codigo_indicacao: cr.codigo_indicacao, indicado_por: cr.indicado_por,
      bonus_recebido: false, criado_em: new Date().toISOString(), role: 'user'
    };

    salvarUsuarioLocal(usuario);
    localStorage.setItem('token_taxinexo', cr.session || '');
    limparRefIndicacao();
    toast(`Conta criada, ${nome.split(' ')[0]}!\n\nSeu código de indicação: ${usuario.codigo_indicacao}\nComissões em 5 níveis: 10%, 5%, 3%, 2% e 1% por amigo que ativar um plano pago!`);
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
    const turnstileToken = tokenTurnstile('login');
    if (!turnstileToken) return toast('Aguarde a verificação de segurança.');

    const resp = await fetch(TAX_API + '/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha, turnstileToken, ref: refIndicacao() }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) return toast(r.message || 'Não foi possível entrar.');

    salvarUsuarioLocal(r.user);
    localStorage.setItem('token_taxinexo', r.session || '');
    location.href = 'cliente.html';
  } catch (e) {
    console.error(e);
    toast('Erro ao fazer login: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// Login/cadastro com Google — o backend valida o id_token e cria/vincula a conta
async function entrarComGoogle(response) {
  if (!response || !response.credential) return toast('Falha no Google.');
  toast('Entrando...\nValidando conta Google');
  try {
    const resp = await fetch(TAX_API + '/auth/google', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential, ref: refIndicacao() }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) return toast(r.message || 'Erro no login com Google.');
    salvarUsuarioLocal(r.user);
    localStorage.setItem('token_taxinexo', r.session || '');
    limparRefIndicacao();
    toast('Bem-vindo!');
    setTimeout(() => { location.href = 'cliente.html'; }, 600);
  } catch (e) {
    toast('Erro ao entrar com Google: ' + e.message);
  }
}
window.handleGoogleLogin = (response) => entrarComGoogle(response);
window.handleGoogleRegister = (response) => entrarComGoogle(response);

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
async function iniciarDashboard() {
  const u = exigirLogin(); if (!u) return;
  try {
    const snap = await db.child('usuarios/' + u.id).once('value');
    if (snap.exists()) salvarUsuarioLocal(snap.val());
  } catch (e) {
    if (e.status === 401 || e.status === 403) { sair(); return; }
    console.warn('[Dashboard] sync:', e);
  }

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
    // O link de indicação deve apontar para o CADASTRO, nunca para o painel.
    linkInput.value = location.origin + location.pathname.replace(/[^/]*$/, 'cadastro.html') + '?ref=' + encodeURIComponent(atual.codigo_indicacao);
  }
  if (el('saquePix')) el('saquePix').value = atual.pix || '';
  if (el('saqueDocumento')) el('saqueDocumento').value = atual.cpf || '';
  if (el('saqueNome')) el('saqueNome').value = atual.nome || '';

  const financeiroCarregando = carregarConfigFinanceira();
  const planosCarregando = carregarPlanos();
  atualizarTimers();
  // Carrega a equipe em paralelo para o resumo de indicados aparecer rápido.
  const equipeCarregando = carregarEquipe();
  await Promise.all([carregarInvestimentos(), carregarExtrato(), equipeCarregando, financeiroCarregando, planosCarregando]);
  iniciarAtualizacaoEquipe();
}

// ------------------------------------------------------------
// EQUIPE / INDICADOS / METAS
// ------------------------------------------------------------
function escTexto(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Resumo curto dos indicados dentro do card "Indique e ganhe".
// Mostra TODOS os cadastros (inclusive sem plano pago); o selo PAGO é
// exclusivo de quem já ativou plano pago.
function renderizarResumoIndicados(indicados) {
  const lista = el('inviteTeamList');
  const contador = el('inviteTeamCount');
  if (contador) {
    contador.textContent = indicados.length === 1
      ? '1 cadastrado'
      : indicados.length + ' cadastrados';
  }
  if (!lista) return;
  if (!indicados.length) {
    lista.innerHTML = '<p class="invite-team-empty">Nenhum cadastro ainda. Compartilhe seu link para começar.</p>';
    return;
  }
  const visiveis = indicados.slice(0, 3);
  lista.innerHTML = visiveis.map(ind => {
    const inicial = String(ind.nome || '?').trim()[0]?.toUpperCase() || '?';
    const pago = ind.status === 'convertido' || ind.investiu;
    const email = String(ind.email || '');
    const emailCurto = email.length > 24 ? email.slice(0, 22) + '…' : email;
    return `<div class="invite-mini">
      <div class="invite-mini-avatar">${escTexto(inicial)}</div>
      <div class="invite-mini-info"><strong>${escTexto(ind.nome || 'Indicado')}</strong><small>${escTexto(emailCurto)}</small></div>
      <span class="invite-mini-status ${pago ? 'pago' : 'pendente'}">${pago ? 'PAGO' : 'PENDENTE'}</span>
    </div>`;
  }).join('') + (indicados.length > visiveis.length
    ? `<span class="invite-mini-mais">+${indicados.length - visiveis.length} outro(s) cadastro(s)</span>`
    : '');
}

const METAS_EQUIPE = [
  { qtd: 20, premio: 15 },
  { qtd: 50, premio: 35 },
  { qtd: 100, premio: 50 },
];

function alternarAba(nome) {
  const inicio = el('abaInicio'), equipe = el('abaEquipe');
  if (inicio) inicio.classList.toggle('hidden', nome !== 'inicio');
  if (equipe) equipe.classList.toggle('hidden', nome !== 'equipe');
  document.querySelectorAll('.dash-tab').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.querySelectorAll('.dash-nav .dash-link').forEach(b => b.classList.remove('ativa'));
  if (nome === 'equipe') carregarEquipe();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function carregarEquipe() {
  const u = usuarioLocal();
  if (!u || !db) return;
  const lista = el('listaIndicados');
  try {
    // Backend é a fonte da verdade para status de indicação.
    // no-store evita exibir uma lista antiga em cache depois de um novo cadastro.
    const resposta = await (await fetch(TAX_API + '/indicados?uid=' + encodeURIComponent(u.id), {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + sessionToken() },
    })).json().catch(() => ({}));
    let indicados = resposta.ok && Array.isArray(resposta.indicados) ? resposta.indicados.slice() : [];
    const vistos = new Set(indicados.map(x => x.id));

    // Backend é a única fonte da verdade — sem fallback que duplique indicados.
    // Status "convertido" só é gravado no servidor quando há plano PAGO ativado.
    indicados.sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));

    // Cadastrados = todos os que entraram pelo link.
    // Pagos = apenas os convertidos (plano pago). Só esses contam nas metas.
    const convertidos = indicados.filter(ind => ind.status === 'convertido' || ind.investiu);

    if (el('totalCadastrados')) el('totalCadastrados').textContent = String(indicados.length);
    if (el('totalIndicados')) el('totalIndicados').textContent = String(convertidos.length);
    renderizarResumoIndicados(indicados);

    if (lista) {
      if (!indicados.length) {
        lista.innerHTML = `<div class="team-empty"><span class="team-empty-ico ico-handshake" aria-hidden="true"></span><h3>Sua equipe ainda está começando</h3><p>Compartilhe seu link de indicação e os nomes de quem se cadastrar aparecerão aqui.</p><button class="btn sm" onclick="copiarLinkIndicacao()">Copiar meu link</button></div>`;
      } else {
        lista.innerHTML = indicados.map(ind => {
          const inicial = String(ind.nome || '?').trim()[0]?.toUpperCase() || '?';
          const data = ind.criado_em ? new Date(ind.criado_em).toLocaleDateString('pt-BR') : '';
          const email = String(ind.email || '');
          const emailCurto = email.length > 26 ? email.slice(0, 24) + '…' : email;
          const pago = ind.status === 'convertido' || ind.investiu;
          return `<div class="team-item">
            <div class="team-avatar">${escTexto(inicial)}</div>
            <div class="team-info"><strong>${escTexto(ind.nome || 'Indicado')}</strong><small>${escTexto(emailCurto)}${data ? '<span class="dot" aria-hidden="true"></span>' + data : ''}</small></div>
            <span class="team-status ${pago ? 'investiu' : 'pendente'}">${pago ? 'PAGO' : 'PENDENTE'}</span>
          </div>`;
        }).join('');
      }
    }

    // metas
    const resgatadas = await chavesDaLista('metas_resgatadas/' + u.id);
    for (const meta of METAS_EQUIPE) {
      const barra = el('barra' + meta.qtd), contador = el('contador' + meta.qtd), btn = el('btnMeta' + meta.qtd);
      const pct = Math.min(100, (convertidos.length / meta.qtd) * 100);
      if (barra) barra.style.width = pct + '%';
      if (contador) contador.textContent = `${convertidos.length} de ${meta.qtd} indicados pagos`;
      const concluida = convertidos.length >= meta.qtd;
      const jaResgatou = resgatadas.includes(String(meta.qtd));
      const card = el('meta' + meta.qtd);
      if (card) {
        card.classList.toggle('concluida', concluida && !jaResgatou);
        card.classList.toggle('resgatada', jaResgatou);
      }
      if (btn) {
        btn.disabled = !concluida || jaResgatou;
        btn.textContent = jaResgatou ? 'RESGATADO' : (concluida ? 'RESGATAR' : `FALTAM ${Math.max(0, meta.qtd - convertidos.length)}`);
        btn.onclick = () => resgatarMeta(meta.qtd, meta.premio);
      }
    }
  } catch (e) {
    console.error('[Equipe]', e);
    if (lista) lista.innerHTML = `<p class="empty-state">Não foi possível carregar sua equipe.</p>`;
  }
}

// Atualiza a equipe periodicamente e ao voltar para a aba, para que um
// cadastro novo (inclusive via Google) apareça sem precisar recarregar a página.
let _equipeTimer = null;
function iniciarAtualizacaoEquipe() {
  if (_equipeTimer) return;
  _equipeTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && usuarioLocal() && el('listaIndicados')) {
      carregarEquipe();
    }
  }, 45000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && usuarioLocal() && el('listaIndicados')) {
    carregarEquipe();
  }
});

async function resgatarMeta(qtd, premio) {
  const u = usuarioLocal();
  if (!u) return;
  if (!confirm(`Resgatar o prêmio de ${fmtBRL(premio)} por ${qtd} indicados?`)) return;
  try {
    const resp = await fetch(TAX_API + '/metas/resgatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionToken() },
      body: JSON.stringify({ qtd }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) return toast(r.message || 'Erro ao resgatar.');
    const local = usuarioLocal();
    local.saldo_indicacao = Number(r.saldo_indicacao) || 0;
    local.bonus = (Number(local.bonus) || 0) + Number(r.premio || premio);
    salvarUsuarioLocal(local);
    toast(`${fmtBRL(r.premio || premio)} creditados no saldo de indicação!`);
    await carregarEquipe();
  } catch (e) {
    toast('Erro ao resgatar: ' + e.message);
  }
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
function limiteDoPlano(p) {
  const n = Number(p && p.limite);
  return n > 0 ? n : (Number(p && p.id) === 0 ? 1 : 2);
}
function normalizarPlano(p, i) {
  const id = Number(p && p.id);
  return {
    id: Number.isFinite(id) ? id : i,
    nome: String((p && p.nome) || 'Plano').slice(0, 60),
    entrada: Math.max(0, Number(p && p.entrada) || 0),
    diaria: Math.max(0, Number(p && p.diaria) || 0),
    ciclo: Math.max(1, Number(p && p.ciclo) || 20),
    retorno: Math.max(0, Number(p && p.retorno) || 0),
    imagem: String((p && p.imagem) || '').trim(),
    limite: Math.max(1, Number(p && p.limite) || (Number(p && p.id) === 0 ? 1 : 2)),
    ativo: !(p && p.ativo === false),
  };
}
function atualizarSelectPlanos() {
  const sel = el('investirPlano');
  if (!sel) return;
  sel.innerHTML = planos.map(p => `<option value="${p.id}">${escTexto(p.nome)} - ${fmtBRL(p.entrada)}</option>`).join('');
}
async function carregarPlanosPublicos() {
  try {
    const r = await fetch(TAX_API + '/planos', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok && Array.isArray(j.planos) && j.planos.length) {
      planos = j.planos.map(normalizarPlano)
        .sort((a, b) => (a.entrada - b.entrada) || (a.id - b.id));
      atualizarSelectPlanos();
    }
  } catch (e) {
    console.warn('[Planos] usando padrão:', e.message);
  }
}
async function carregarConfigFinanceira() {
  try {
    const s = await db.child('config/financeiro').once('value');
    const c = s.val();
    if (c && typeof c === 'object') {
      if (Number(c.depositoMinimo) > 0) CONFIG.depositoMinimo = Number(c.depositoMinimo);
      if (Number(c.depositoMaximo) > 0) CONFIG.depositoMaximo = Number(c.depositoMaximo);
      if (Number(c.saqueMinimo) > 0) CONFIG.saqueMinimo = Number(c.saqueMinimo);
      if (Number(c.taxaSaquePorcento) >= 0) CONFIG.taxaSaquePorcento = Number(c.taxaSaquePorcento);
      if (Number(c.saquesPorDia) >= 0) CONFIG.saquesPorDia = Math.floor(Number(c.saquesPorDia));
    }
  } catch (e) {
    console.warn('[Financeiro] usando padrão:', e.message);
  }
  aplicarConfigFinanceira();
}
function aplicarConfigFinanceira() {
  const min = el('saqueMin');
  if (min) {
    const limite = CONFIG.saquesPorDia > 0
      ? `máx. ${CONFIG.saquesPorDia} saques/dia`
      : 'sem limite de saques/dia';
    min.innerHTML = `Saque mínimo: <strong>${fmtBRL(CONFIG.saqueMinimo)}</strong> · 24 horas por dia · ${limite}`;
  }
  const taxa = document.querySelector('#saqueResumo dt');
  if (taxa) taxa.textContent = `Taxa de saque (${CONFIG.taxaSaquePorcento}%)`;
  const depNotice = el('depositoMin');
  if (depNotice) {
    depNotice.innerHTML = `Depósito mínimo: <strong>${fmtBRL(CONFIG.depositoMinimo)}</strong> · máximo ${fmtBRL(CONFIG.depositoMaximo)}`;
  }
  const depInput = el('depositoValor');
  if (depInput) {
    depInput.min = String(CONFIG.depositoMinimo);
    depInput.max = String(CONFIG.depositoMaximo);
  }
  document.querySelectorAll('.amount-options button[data-valor]').forEach(btn => {
    const valor = Number(btn.dataset.valor) || 0;
    const fora = valor < CONFIG.depositoMinimo || valor > CONFIG.depositoMaximo;
    btn.hidden = fora;
    btn.disabled = fora;
  });
}
async function contarInvestimentosDoPlano(uid, planoId) {
  if (!db) return 0;
  const keys = await chavesDaLista('investimentos_usuario/' + uid);
  const itens = await lerCada('investimentos', keys);
  return itens.filter(x => Number(x.valor.plano_id) === Number(planoId)).length;
}

async function carregarPlanos() {
  const container = el('listaPlanos'); if (!container) return;
  await carregarPlanosPublicos();
  const u = usuarioLocal();
  const contagens = {};
  if (u && db) {
    for (const p of planos) contagens[p.id] = await contarInvestimentosDoPlano(u.id, p.id);
  }
  const html = await Promise.all(planos.map(async (p) => {
    const usados = contagens[p.id] || 0;
    const limite = limiteDoPlano(p);
    const esgotado = usados >= limite;
    const selo = limite === 1 ? 'limitado a 1x' : `até ${limite}x por conta`;
    const img = p.imagem || 'plan-car.webp';
    return `
    <article class="plano-card" aria-label="${escTexto(p.nome)}">
      <h4>${escTexto(p.nome.toUpperCase())}</h4>
      <span class="plano-selo">${selo}</span>
      <img class="plan-car" src="${escTexto(img)}" alt="${escTexto(p.nome)}" width="1408" height="752" loading="lazy" onerror="this.onerror=null;this.src='plan-car.webp'">
      <dl class="plan-facts">
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('entrada')}</span><dt>Entrada</dt><dd>${fmtBRL(p.entrada)}</dd></div>
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('diaria')}</span><dt>Diária</dt><dd>${fmtBRL(p.diaria)}</dd></div>
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('ciclo')}</span><dt>Ciclo</dt><dd>${p.ciclo} Dias</dd></div>
        <div><span class="plan-icon" aria-hidden="true">${iconePlano('retorno')}</span><dt>Total recebido</dt><dd>${fmtBRL(p.retorno)}</dd></div>
      </dl>
      <button ${esgotado ? 'disabled class="plano-esgotado"' : `onclick="escolherPlano(${p.id})"`} aria-label="Escolher ${escTexto(p.nome)}">
        ${esgotado ? 'Limite atingido' : 'Investir neste plano'} <span class="ico ico-arrow" aria-hidden="true"></span>
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
  if (info) info.textContent = `${p.nome} | Entrada ${fmtBRL(p.entrada)} | Diária ${fmtBRL(p.diaria)} por ${p.ciclo} dias | Total ${fmtBRL(p.retorno)}`;
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
          <span class="invest-timer-ico" aria-hidden="true"></span>
          <span class="invest-timer-txt">Próximo rendimento em <strong>--:--:--</strong></span>
        </div>` : ''}
      </article>`;
    }).join('');
  } catch (e) { console.error('[Investimentos]', e); }
}

// Tipos que aparecem no extrato do cliente. Códigos de pagamento/PIX ainda
// pendentes, rendimentos, comissões, estornos e ajustes ficam de fora.
const EXTRATO_TIPOS = {
  deposito: { rotulo: 'Depósito', sinal: 1, exigeAprovado: true },
  saque: { rotulo: 'Saque', sinal: -1 },
  investimento: { rotulo: 'Plano comprado', sinal: -1 },
  bonus: { rotulo: 'Bônus', sinal: 1 },
};
function extratoVisivel(t) {
  const tipo = String((t && t.tipo) || '').toLowerCase();
  const regra = EXTRATO_TIPOS[tipo];
  if (!regra) return false;
  // Depósito só entra depois de aprovado/pago. O PIX pendente continua
  // salvo no D1 para o webhook creditar, mas não aparece como movimentação.
  if (regra.exigeAprovado && statusTipo(t.status) !== 'ok') return false;
  return true;
}
function extratoRotulo(t) {
  const tipo = String((t && t.tipo) || '').toLowerCase();
  const regra = EXTRATO_TIPOS[tipo];
  if (!regra) return 'Transação';
  if (tipo === 'investimento') {
    const obs = String((t && t.observacao) || '');
    const nome = obs.match(/plano\s+(.+)$/i);
    if (nome && nome[1]) return `${regra.rotulo} · ${nome[1].trim()}`;
  }
  return regra.rotulo;
}
async function carregarExtrato() {
  const box = el('extratoLista'); if (!box || !db) return;
  const u = usuarioLocal();
  try {
    const keys = await chavesDaLista('transacoes_usuario/' + u.id);
    const itens = await lerCada('transacoes', keys);
    const lista = itens
      .map(x => x.valor)
      .filter(extratoVisivel)
      .sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''))
      .slice(0, 30);
    if (!lista.length) { box.innerHTML = '<p class="empty-state">Nenhuma movimentação ainda.</p>'; return; }
    box.innerHTML = lista.map(t => {
      const regra = EXTRATO_TIPOS[String(t.tipo || '').toLowerCase()];
      const sinal = regra && regra.sinal < 0 ? '-' : '+';
      const classe = regra && regra.sinal < 0 ? 'negativo' : 'positivo';
      return `
      <div class="movimento">
        <div><strong>${escTexto(extratoRotulo(t))}</strong><small>${fmtData(t.criado_em)}</small></div>
        <span class="${classe}">${sinal} ${fmtBRL(t.valor)}</span>
      </div>`;
    }).join('');
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
    const pixCampo = el('saquePix');
    if (pixCampo) pixCampo.addEventListener('input', () => {
      const hint = el('saquePixTipo');
      if (!hint) return;
      if (!pixCampo.value.trim()) { hint.textContent = ''; hint.className = 'pix-tipo'; return; }
      const r = SigiloPay.validarChavePix(pixCampo.value);
      hint.textContent = r.valida ? 'Tipo detectado: ' + r.descricao : 'Chave inválida';
      hint.className = 'pix-tipo ' + (r.valida ? 'ok' : 'erro');
      if (r.valida && (r.tipo === 'CPF' || r.tipo === 'CNPJ')) {
        const doc = el('saqueDocumento');
        if (doc) doc.value = pixCampo.value.replace(/\D/g, '');
      }
    });
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
    const r = await SigiloPay.criarCobrancaPIX(valor, 'Depósito Veloster Capital', u.email, u.id);
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

    // O Worker registra o depósito e o índice de forma autoritativa.
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
      // O Webhook é a fonte autoritativa e quem credita o saldo.
      // O status é consultado pelo Worker, que valida o dono do depósito.
      const resp = await fetch(TAX_API + '/deposito/status?identifier=' + encodeURIComponent(identifier), {
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + sessionToken() },
      });
      const r = await resp.json().catch(() => ({}));
      if (pixCancelado || !r.ok) return;
      if (r.aprovada) {
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
  const btn = el('btnConfirmarInvestimento') || document.querySelector('#investirDialog button[onclick*="confirmarInvestimento"]');
  const sel = el('investirPlano');
  const planoId = Number(sel && sel.value);
  const p = planos.find(x => x.id === planoId);
  if (!p) return toast('Selecione um plano.');
  const u = usuarioLocal();
  if (!u || !u.id) return toast('Faça login para investir.');

  // Proteção visual complementar (a validação real é o CAS no backend)
  if (btn) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1'; btn.disabled = true;
    btn.dataset.original = btn.innerHTML;
    btn.innerHTML = 'Processando...';
  }
  try {
    // Identificador único desta intenção de compra (idempotªncia)
    const txId = 'C' + Date.now() + '_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14));
    const resp = await fetch(TAX_API + '/comprar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionToken() },
      body: JSON.stringify({ uid: u.id, txId, planoId }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) {
      if (r.duplicada) return toast('Esta compra já foi processada.');
      return toast(r.message || 'Erro ao processar a compra.');
    }
    if (r.duplicada) return toast('Esta compra já foi processada.');

    // Sincroniza saldo com o servidor (fonte da verdade)
    const snap = await db.child('usuarios/' + u.id).once('value');
    if (snap.exists()) salvarUsuarioLocal(snap.val());

    toast(`Investimento confirmado!\n\nPlano: ${p.nome}\nValor: ${fmtBRL(r.valor)}\nDiária: ${fmtBRL(p.diaria)} por ${p.ciclo} dias\nTotal projetado: ${fmtBRL(p.retorno)}${r.comissao_gerada ? '\n\nComissão de indicação liberada: ' + fmtBRL(r.comissao_gerada) : ''}`);
    const d = el('investirDialog'); if (d) d.close();
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    console.error('[Investir]', e);
    toast('Erro ao investir: ' + e.message);
  } finally {
    if (btn) { btn.dataset.busy = '0'; btn.disabled = false; btn.innerHTML = btn.dataset.original || 'Investir'; }
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
  const naoContam = ['falha', 'cancelado', 'recusado', 'rejeitado', 'negado', 'estornado', 'devolvido', 'revertido'];
  return itens.filter(x => {
    const s = x.valor || {};
    if (naoContam.includes(String(s.status || '').toLowerCase())) return false;
    return String(s.criado_em || '').split('T')[0] === hoje();
  }).length;
}
function documentoValidoCliente(v) {
  const doc = String(v || '').replace(/\D/g, '');
  return !!(SigiloPay && (SigiloPay.cpfValido(doc) || SigiloPay.cnpjValido(doc)));
}

async function confirmarSaque(ev) {
  const valor = lerValor(el('saqueValor').value);
  const pix = el('saquePix').value.trim();
  const u = usuarioLocal(); if (!u) return avisoSaque('Faça login primeiro.');

  const controle = await saquesEstaoBloqueados();
  if (controle.bloqueado) return avisoSaque(controle.mensagem);
  if (!horarioSaquePermitido()) return avisoSaque(`Saques permitidos das ${CONFIG.horarioSaqueInicio}h às ${CONFIG.horarioSaqueFim}h. Disponível: ${proximoHorarioSaque()}.`);
  if (!(valor >= CONFIG.saqueMinimo)) return avisoSaque(`Saque mínimo: ${fmtBRL(CONFIG.saqueMinimo)}.`);
  const chavePix = SigiloPay.validarChavePix(pix);
  if (!chavePix.valida) return avisoSaque('Chave Pix inválida! Use CPF, CNPJ, e-mail, celular ou chave aleatória.');
  const documento = String(el('saqueDocumento')?.value || u.cpf || '').trim();
  if (!documentoValidoCliente(documento)) {
    return avisoSaque('Informe o CPF/CNPJ do destinatário para o saque.');
  }
  const nomeDestinatario = String(el('saqueNome')?.value || u.nome || '').trim();
  if (nomeDestinatario.length < 3) return avisoSaque('Informe o nome do destinatário da chave PIX.');
  if (CONFIG.saquesPorDia > 0) {
    const feitos = await contarSaquesHoje(u.id);
    if (feitos >= CONFIG.saquesPorDia) return avisoSaque(`Você já fez ${CONFIG.saquesPorDia} saques hoje.`);
  }
  if ((Number(u.saldo) || 0) < valor) return avisoSaque(`Saldo insuficiente! Você tem ${fmtBRL(u.saldo)}.`);
  // Só permite saque para quem já fez um depósito real.
  if ((Number(u.total_depositado) || 0) <= 0) return avisoSaque('Você precisa fazer um depósito antes de solicitar um saque.');
  if (!db) return avisoSaque('Banco não conectado.');

  const c = calcularSaque(valor);
  if (!confirm(`Confirmar saque?\n\nValor bruto: ${fmtBRL(c.bruto)}\nTaxa (${CONFIG.taxaSaquePorcento}%): ${fmtBRL(c.taxa)}\nVocê recebe: ${fmtBRL(c.liquido)}`)) return;

  const btn = ev && ev.target && ev.target.querySelector ? ev.target.querySelector('button[type="submit"]') : null;
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Processando...'; }
  try {
    const resp = await fetch(TAX_API + '/saque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionToken() },
      body: JSON.stringify({ valor, pix, taxId: documento.replace(/\D/g, ''), nome: nomeDestinatario }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) {
      return setMensagem('saqueMsg', r.message || 'Erro ao solicitar saque.', 'error');
    }
    avisoSaque(`Saque enviado! Você recebe ${fmtBRL(r.valor_liquido)}.`, 'success');
    const d = el('saqueDialog');
    setTimeout(() => { if (d) d.close(); location.reload(); }, 2000);
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
async function entrarAdmin() {
  const senha = String(el('adminSenha')?.value || '');
  if (!senha) return setMensagem('adminMsg', 'Digite a senha.', 'error');
  try {
    const resp = await fetch(TAX_API + '/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: senha }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok || !r.token) return setMensagem('adminMsg', 'Senha incorreta.', 'error');
    sessionStorage.setItem('admin_token', r.token);
    sessionStorage.setItem('admin_taxinexo', 'sim');
    setMensagem('adminMsg', 'Acesso liberado.', 'success');
    carregarAdmin();
    adminCarregarGateway();
    adminCarregarBanners();
    adminCarregarPlanos();
    adminCarregarFinanceiro();
    carregarCodigosRoleta();
    carregarCodigosBonus();
  } catch (e) {
    setMensagem('adminMsg', 'Erro ao entrar: ' + e.message, 'error');
  }
}
async function carregarAdmin() {
  if (!adminToken()) return;
  try {
    const [us, inv, saq, tx, ctrl] = await Promise.all([
      db.child('usuarios').once('value'),
      db.child('investimentos').once('value'),
      db.child('saques').once('value'),
      db.child('transacoes').once('value'),
      db.child('controle/saques_bloqueados').once('value')
    ]);
    const usuarios = Object.values(us.val() || {});
    const investimentos = Object.values(inv.val() || {});
    const saques = Object.values(saq.val() || {});
    const transacoes = Object.values(tx.val() || {});
    ADMIN_CACHE = { usuarios: us.val() || {}, investimentos: inv.val() || {}, saques: saques, transacoes: transacoes, controle: ctrl.val() || {} };
    // Mapa de indicados calculado UMA vez (evita varrer todos os usuários por linha)
    ADMIN_CACHE.indicados = {};
    for (const u of usuarios) {
      if (u && u.indicado_por) ADMIN_CACHE.indicados[u.indicado_por] = (ADMIN_CACHE.indicados[u.indicado_por] || 0) + 1;
    }
    const soma = (arr, campo) => arr.reduce((a, x) => a + (Number(x[campo]) || 0), 0);
    const saquesPagos = saques.filter(s => statusTipo(s.status) === 'ok');
    const saquesPendentes = saques.filter(s => statusTipo(s.status) === 'warn');

    if (el('adminUsuarios')) el('adminUsuarios').textContent = usuarios.length;
    if (el('adminInvestimentos')) el('adminInvestimentos').textContent = investimentos.filter(i => i.status === 'ativo').length;
    if (el('adminTotalInvestido')) el('adminTotalInvestido').textContent = fmtBRL(soma(investimentos, 'valor_aplicado'));
    if (el('adminTotalRendimentos')) el('adminTotalRendimentos').textContent = fmtBRL(soma(usuarios, 'rendimentos'));
    if (el('adminTotalSaques')) el('adminTotalSaques').textContent = fmtBRL(soma(saquesPagos, 'valor_liquido'));
    if (el('adminSaquesPendentes')) el('adminSaquesPendentes').textContent = saquesPendentes.length;
    if (el('adminSaldoContas')) el('adminSaldoContas').textContent = fmtBRL(soma(usuarios, 'saldo'));

    if (el('adminSaldoGateway')) {
      // Saldo calculado das transações já carregadas — sem ida extra ao Worker
      let disp = 0;
      for (const t of transacoes) {
        const v = Number(t.valor || 0);
        const st = String(t.status || '').toLowerCase();
        if (t.tipo === 'deposito' && ['aprovada', 'completed', 'pago'].includes(st)) disp += v;
        if (t.tipo === 'saque' && ['aprovada', 'completed', 'pago', 'processando'].includes(st)) disp -= v;
      }
      el('adminSaldoGateway').textContent = fmtBRL(disp);
    }

    renderSaqueStatus(ADMIN_CACHE.controle);
    renderAdminRendimentos();
    renderAdminSaques();
    renderAdminUsuarios();
    renderAdminInvestimentos();
    renderAdminSelectUsuarios();
    renderAdminGraficos();
    adminCarregarAparencia();

    if (el('adminUltimaAtualizacao')) {
      el('adminUltimaAtualizacao').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (e) {
    console.error('[Admin]', e);
    toast('Erro ao carregar o painel: ' + e.message);
    if (el('adminUltimaAtualizacao')) el('adminUltimaAtualizacao').textContent = 'Falha ao atualizar';
  }
}

// ---------- Status (saques, investimentos) ----------
function statusTipo(status) {
  const s = String(status || '').toLowerCase();
  if (['pago', 'paga', 'aprovada', 'aprovado', 'completed', 'concluido', 'concluído', 'liberado', 'liberada', 'ativo'].includes(s)) return 'ok';
  if (['pendente', 'processando', 'aguardando', 'em processamento', 'pending'].includes(s)) return 'warn';
  if (['recusado', 'recusada', 'cancelado', 'cancelada', 'bloqueado', 'bloqueada', 'falha', 'failed', 'rejected', 'erro', 'error'].includes(s)) return 'erro';
  return 'neutro';
}
function statusPill(status) {
  const s = String(status || '').trim();
  const tipo = statusTipo(s);
  const rotulo = s ? s.charAt(0).toUpperCase() + s.slice(1) : '-';
  return `<span class="status-pill ${tipo}">${escTexto(rotulo)}</span>`;
}

function renderAdminRendimentos() {
  const tbody = el('adminRendimentosBody'); if (!tbody) return;
  const ativos = Object.values(ADMIN_CACHE.investimentos || {}).filter(i => i && i.status === 'ativo');
  if (el('adminRendimentosCount')) el('adminRendimentosCount').textContent = ativos.length;
  tbody.innerHTML = ativos.length ? ativos.map(i => {
    const dias = Number(i.dias_pagos || 0), total = Number(i.duracao_dias || 0);
    const pct = total > 0 ? Math.min(100, Math.round(dias / total * 100)) : 0;
    return `<tr>
      <td><strong>${escTexto(i.usuario_nome || '-')}</strong><small>${escTexto(i.usuario_email || '')}</small></td>
      <td>${escTexto(i.plano_nome || '-')}</td>
      <td>${fmtBRL(i.rendimento_diario)}</td>
      <td><div class="mini-progress"><span style="width:${pct}%"></span></div><small>${dias}/${total} · ${pct}%</small></td>
      <td>${fmtBRL(i.rendimento_pago)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">Nenhum investimento ativo.</td></tr>';
}

function renderAdminSaques() {
  const tbody = el('adminSaquesBody'); if (!tbody) return;
  const filtro = String(el('adminFiltroSaques')?.value || 'todos');
  let lista = (ADMIN_CACHE.saques || []).slice().filter(Boolean);
  lista.sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  if (filtro !== 'todos') {
    const alvo = { pagos: 'ok', pendentes: 'warn', recusados: 'erro' }[filtro] || 'neutro';
    lista = lista.filter(s => statusTipo(s.status) === alvo);
  }
  if (el('adminSaquesCount')) el('adminSaquesCount').textContent = lista.length;
  tbody.innerHTML = lista.length ? lista.slice(0, 100).map(s => {
    const bruto = Number(s.valor_bruto) || 0;
    const liq = Number(s.valor_liquido) || 0;
    const taxa = Math.max(0, Math.round((bruto - liq) * 100) / 100);
    return `<tr>
      <td><strong>${escTexto(s.usuario_nome || '-')}</strong><small>${escTexto(s.usuario_email || '')}</small></td>
      <td>${fmtBRL(bruto)}</td>
      <td class="td-muted">${fmtBRL(taxa)}</td>
      <td><strong class="td-money">${fmtBRL(liq)}</strong></td>
      <td class="td-muted">${fmtData(s.criado_em)}</td>
      <td>${statusPill(s.status)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">Nenhum saque encontrado.</td></tr>';
}

// ---------- Controle global de saques ----------
function renderSaqueStatus(estado) {
  const bloqueado = !!(estado && estado.bloqueado);
  const motivo = String((estado && estado.mensagem) || '').trim();
  const data = estado && estado.atualizado_em ? fmtData(estado.atualizado_em) : '';
  const rotulo = bloqueado ? 'Saques bloqueados' : 'Saques liberados';

  const card = el('saqueStatusCard');
  if (card) card.dataset.estado = bloqueado ? 'bloqueado' : 'liberado';
  const acao = el('adminAcaoSaques');
  if (acao) acao.dataset.estado = bloqueado ? 'bloqueado' : 'liberado';

  if (el('saqueStatusTitulo')) el('saqueStatusTitulo').textContent = rotulo;
  if (el('saqueStatusDesc')) {
    el('saqueStatusDesc').textContent = bloqueado
      ? (motivo || 'Os clientes não podem solicitar saques neste momento.')
      : 'Os clientes podem solicitar saques normalmente.';
  }
  if (el('saqueStatusData')) el('saqueStatusData').textContent = data ? 'Atualizado em ' + data : 'Nenhuma alteração registrada.';
  if (el('adminAcaoSaquesDesc')) el('adminAcaoSaquesDesc').textContent = bloqueado ? 'Saques bloqueados para todos os clientes.' : 'Saques liberados para todos os clientes.';

  const chip = el('adminTopSaqueChip');
  if (chip) {
    chip.dataset.estado = bloqueado ? 'bloqueado' : 'liberado';
    const span = chip.querySelector('span');
    if (span) span.textContent = rotulo;
  }

  const side = el('adminSideSaqueStatus');
  if (side) {
    side.dataset.estado = bloqueado ? 'bloqueado' : 'liberado';
    side.innerHTML = '<i aria-hidden="true"></i> ' + (bloqueado ? 'Bloqueados' : 'Liberados');
  }
  if (el('adminSideSaqueDesc')) {
    el('adminSideSaqueDesc').textContent = bloqueado
      ? (motivo || 'Clientes não podem sacar agora.')
      : 'Clientes podem solicitar normalmente.';
  }

  const btnLiberar = el('btnLiberarSaques');
  const btnBloquear = el('btnBloquearSaques');
  if (btnLiberar) btnLiberar.disabled = !bloqueado;
  if (btnBloquear) btnBloquear.disabled = bloqueado;

  const campo = el('adminMotivoBloqueio');
  if (campo && document.activeElement !== campo) campo.value = bloqueado ? motivo : '';
}

async function definirBloqueioSaques(bloquear) {
  if (!db) return toast('Banco não conectado.');
  const motivo = String(el('adminMotivoBloqueio')?.value || '').trim();
  const mensagem = bloquear ? (motivo || 'Saques temporariamente bloqueados.') : '';
  if (bloquear && !confirm('Bloquear os saques de todos os clientes agora?')) return;

  const btn = bloquear ? el('btnBloquearSaques') : el('btnLiberarSaques');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Salvando...'; }
  try {
    const estado = { bloqueado: !!bloquear, mensagem, atualizado_em: new Date().toISOString() };
    await db.child('controle/saques_bloqueados').set(estado);
    ADMIN_CACHE.controle = estado;
    renderSaqueStatus(estado);
    toast(bloquear ? 'Saques bloqueados para todos os clientes.' : 'Saques liberados para todos os clientes.');
    carregarAdmin();
  } catch (e) {
    toast('Erro ao atualizar o controle de saques: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

let ADMIN_CACHE = { usuarios: {}, investimentos: {}, saques: [], transacoes: [], controle: {} };

async function adminAtualizarSaldoGateway() {
  const elSaldo = el('adminSaldoGateway');
  if (!elSaldo) return;
  elSaldo.textContent = '...';
  try {
    const s = await SigiloPay.consultarSaldo();
    elSaldo.textContent = s.sucesso ? fmtBRL(s.available) : '—';
    toast(s.sucesso ? `Saldo atualizado: ${fmtBRL(s.available)}` : 'Não foi possível consultar o saldo.');
  } catch (e) { elSaldo.textContent = '—'; toast('Erro: ' + e.message); }
}

function renderAdminUsuarios() {
  const tbody = el('adminUsuariosBody'); if (!tbody) return;
  const busca = String(el('adminBuscaUsuario')?.value || '').trim().toLowerCase();
  let lista = Object.entries(ADMIN_CACHE.usuarios || {}).map(([id, u]) => ({ id, ...u }));
  if (busca) lista = lista.filter(u => [u.nome, u.email, u.cpf, u.id].some(v => String(v || '').toLowerCase().includes(busca)));
  lista.sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  if (el('adminUsuariosCount')) el('adminUsuariosCount').textContent = lista.length;
  tbody.innerHTML = lista.length ? lista.slice(0, 300).map(u => {
    const indicados = ADMIN_CACHE.indicados?.[u.id] || 0;
    const google = !!u.google || String(u.senha_hash || '') === 'GOOGLE_ONLY_NO_PASSWORD';
    const contato = u.celular || '';
    return `<tr>
      <td><strong>${escTexto(u.nome || '-')}</strong><small>${google ? '<span class="badge-google">Google</span>' : ''}${escTexto(contato)}</small></td>
      <td>${escTexto(u.email || '-')}<small>CPF ${escTexto(u.cpf || '-')}</small></td>
      <td><strong class="td-money">${fmtBRL(u.saldo)}</strong></td>
      <td>${fmtBRL(u.total_depositado)}</td>
      <td><span class="mini-pill">${indicados}</span>${indicados > 0 ? ` <button class="mini-btn" type="button" onclick="adminAbrirConvidados('${escTexto(u.id)}', false)">Ver</button>` : ''}</td>
      <td class="td-muted">${u.criado_em ? fmtData(u.criado_em) : '-'}</td>
      <td class="td-acoes"><button class="mini-btn danger" type="button" onclick="adminExcluirUsuario('${escTexto(u.id)}')">Excluir</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">Nenhum usuário encontrado.</td></tr>';
}

// ------------------------------------------------------------
// ADMIN — GRÁFICOS DA VISÃO GERAL
// ------------------------------------------------------------
function renderAdminGraficos() {
  const bars = el('adminBarsFinanceiro');
  const spark = el('adminSparkCadastros');
  if (!bars || !spark) return;
  const txs = ADMIN_CACHE.transacoes || [];
  const aprovada = (t) => statusTipo(t && t.status) === 'ok';
  const somaTipo = (tipo) => txs
    .filter(t => t && t.tipo === tipo && aprovada(t))
    .reduce((s, t) => s + (Number(t.valor) || 0), 0);

  const depositos = somaTipo('deposito');
  const saquesPagos = (ADMIN_CACHE.saques || [])
    .filter(s => s && statusTipo(s.status) === 'ok')
    .reduce((s, x) => s + (Number(x.valor_liquido ?? x.valor_bruto) || 0), 0);
  const investimentos = Object.values(ADMIN_CACHE.investimentos || {})
    .reduce((s, i) => s + (Number(i && i.valor_aplicado) || 0), 0);
  const rendimentos = Object.values(ADMIN_CACHE.usuarios || {})
    .reduce((s, u) => s + (Number(u && u.rendimentos) || 0), 0);
  const comissoes = somaTipo('indicacao');
  const bonus = somaTipo('bonus');
  const pendDep = txs.filter(t => t && t.tipo === 'deposito' && statusTipo(t.status) === 'warn').length;
  const pendSaq = (ADMIN_CACHE.saques || []).filter(s => s && statusTipo(s.status) === 'warn').length;

  const categorias = [
    { label: 'Depósitos', valor: depositos, cor: '#16a34a' },
    { label: 'Saques pagos', valor: saquesPagos, cor: '#dc2626' },
    { label: 'Investimentos', valor: investimentos, cor: '#f97316' },
    { label: 'Rendimentos', valor: rendimentos, cor: '#eab308' },
    { label: 'Comissões', valor: comissoes, cor: '#7c3aed' },
    { label: 'Bônus', valor: bonus, cor: '#db2777' },
  ];
  const maior = Math.max(1, ...categorias.map(c => Number(c.valor) || 0));
  bars.innerHTML = categorias.map(c => {
    const valor = Number(c.valor) || 0;
    const pct = valor > 0 ? Math.max(2, Math.round((valor / maior) * 100)) : 0;
    return `<div class="admin-bar-row">
      <span class="admin-bar-label" title="${escTexto(c.label)}">${escTexto(c.label)}</span>
      <span class="admin-bar-track"><span class="admin-bar-fill" style="width:${pct}%;background:${c.cor}"></span></span>
      <strong class="admin-bar-value">${fmtBRL(valor)}</strong>
    </div>`;
  }).join('');

  const notes = el('adminChartNotes');
  if (notes) {
    notes.innerHTML = `<span>Depósitos pendentes <b>${pendDep}</b></span><span>Saques pendentes <b>${pendSaq}</b></span>`;
  }

  // Cadastros dos últimos 7 dias
  const usuarios = Object.values(ADMIN_CACHE.usuarios || {});
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const chave = d.toISOString().slice(0, 10);
    dias.push({
      chave,
      label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      total: usuarios.filter(u => String((u && u.criado_em) || '').slice(0, 10) === chave).length,
    });
  }
  const maiorDia = Math.max(1, ...dias.map(d => d.total));
  const totalCad = dias.reduce((s, d) => s + d.total, 0);
  const totalEl = el('adminChartCadastrosTotal');
  if (totalEl) totalEl.textContent = totalCad + ' em 7 dias';
  spark.innerHTML = dias.map(d => `
    <div class="admin-spark-col" title="${escTexto(d.label)}: ${d.total} cadastro(s)">
      <span class="admin-spark-value">${d.total}</span>
      <span class="admin-spark-bar" style="height:${d.total > 0 ? Math.max(5, Math.round((d.total / maiorDia) * 82)) : 3}px"></span>
      <span class="admin-spark-label">${escTexto(d.label)}</span>
    </div>
  `).join('');
}

// ------------------------------------------------------------
// ADMIN — REDE DE INDICAÇÕES DO USUÁRIO
// ------------------------------------------------------------
let adminConvidadosAtual = null;
let adminConvidadosPilha = [];

function adminFilhosDe(uid) {
  return Object.entries(ADMIN_CACHE.usuarios || {})
    .map(([id, u]) => ({ id, ...(u || {}) }))
    .filter(u => String(u.indicado_por || '') === String(uid))
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
}

function adminUsuarioPlanoPago(u) {
  if (!u || typeof u !== 'object') return false;
  if (Number(u.investido) > 0) return true;
  const planos = u.planos_comprados || {};
  for (const [id, qtd] of Object.entries(planos)) {
    if (Number(id) > 0 && Number(qtd) > 0) return true;
  }
  const compras = u.compras || {};
  for (const c of Object.values(compras)) {
    if (c && Number(c.planoId) > 0) return true;
  }
  return false;
}

function adminContarRede(uid, vistos = new Set()) {
  if (vistos.has(String(uid))) return 0;
  vistos.add(String(uid));
  let total = 0;
  for (const filho of adminFilhosDe(uid)) {
    total += 1 + adminContarRede(filho.id, vistos);
  }
  return total;
}

function adminRenderConvidados(uid) {
  const user = ADMIN_CACHE.usuarios?.[uid];
  const lista = el('adminConvidadosLista');
  const resumo = el('adminConvidadosResumo');
  const titulo = el('adminConvidadosTitulo');
  const voltar = el('adminConvidadosVoltar');
  if (!lista || !resumo || !titulo) return;
  if (!user) {
    titulo.textContent = 'Usuário não encontrado';
    resumo.innerHTML = '';
    lista.innerHTML = '<p class="admin-rede-empty">Recarregue o painel e tente novamente.</p>';
    return;
  }
  const filhos = adminFilhosDe(uid);
  const pagos = filhos.filter(adminUsuarioPlanoPago).length;
  const pendentes = filhos.length - pagos;
  const rede = adminContarRede(uid);
  titulo.textContent = 'Convidados de ' + (user.nome || 'usuário');
  const plural = (n, um, muitos) => Number(n) === 1 ? um : muitos;
  resumo.innerHTML = `
    <span><b>${filhos.length}</b> ${plural(filhos.length, 'direto', 'diretos')}</span>
    <span><b>${pagos}</b> ${plural(pagos, 'pago', 'pagos')}</span>
    <span><b>${pendentes}</b> ${plural(pendentes, 'pendente', 'pendentes')}</span>
    <span><b>${rede}</b> na rede</span>
  `;
  if (voltar) voltar.style.display = adminConvidadosPilha.length ? 'inline-flex' : 'none';
  if (!filhos.length) {
    lista.innerHTML = '<p class="admin-rede-empty">Este usuário ainda não convidou ninguém.</p>';
    return;
  }
  lista.innerHTML = filhos.map(f => {
    const inicial = String(f.nome || '?').trim()[0]?.toUpperCase() || '?';
    const pago = adminUsuarioPlanoPago(f);
    const netos = adminFilhosDe(f.id).length;
    return `<div class="admin-rede-item">
      <div class="admin-rede-avatar">${escTexto(inicial)}</div>
      <div class="admin-rede-info">
        <strong>${escTexto(f.nome || 'Usuário')}</strong>
        <small>${escTexto(f.email || '-')}${f.criado_em ? ' · ' + fmtData(f.criado_em) : ''}</small>
      </div>
      <span class="admin-rede-status ${pago ? 'pago' : 'pendente'}">${pago ? 'PAGO' : 'PENDENTE'}</span>
      ${netos > 0 ? `<button class="mini-btn" type="button" onclick="adminAbrirConvidados('${escTexto(f.id)}', true)">Ver ${netos}</button>` : ''}
    </div>`;
  }).join('');
}

function adminAbrirConvidados(uid, fromChild) {
  if (!fromChild) adminConvidadosPilha = [];
  else if (adminConvidadosAtual && adminConvidadosAtual !== uid) adminConvidadosPilha.push(adminConvidadosAtual);
  adminConvidadosAtual = uid;
  adminRenderConvidados(uid);
  const dlg = el('adminConvidadosDialog');
  if (dlg && !dlg.open) dlg.showModal();
}

function fecharConvidadosAdmin() {
  const dlg = el('adminConvidadosDialog');
  if (dlg && dlg.open) dlg.close();
  adminConvidadosAtual = null;
  adminConvidadosPilha = [];
}

function voltarConvidadosAdmin() {
  const anterior = adminConvidadosPilha.pop();
  if (!anterior) return;
  adminConvidadosAtual = anterior;
  adminRenderConvidados(anterior);
}

function renderAdminInvestimentos() {
  const tbody = el('adminInvestBody'); if (!tbody) return;
  const busca = String(el('adminBuscaInvest')?.value || '').trim().toLowerCase();
  let lista = Object.entries(ADMIN_CACHE.investimentos || {}).map(([key, i]) => ({ ...(i || {}), __key: key }));
  if (busca) lista = lista.filter(i => [i.usuario_nome, i.plano_nome, i.usuario_email].some(v => String(v || '').toLowerCase().includes(busca)));
  lista.sort((a, b) => valorTempo(b.criado_em) - valorTempo(a.criado_em));
  if (el('adminInvestCount')) el('adminInvestCount').textContent = lista.length;
  tbody.innerHTML = lista.length ? lista.slice(0, 300).map(i => {
    const dias = Number(i.dias_pagos || 0), total = Number(i.duracao_dias) || Number(i.duracao) || 0;
    const pct = total > 0 ? Math.min(100, Math.round(dias / total * 100)) : 0;
    return `<tr>
      <td><strong>${escTexto(i.usuario_nome || '-')}</strong><small>${escTexto(i.usuario_email || '')}</small></td>
      <td>${escTexto(i.plano_nome || '-')}</td>
      <td>${fmtBRL(i.valor_aplicado)}</td>
      <td>${fmtBRL(i.rendimento_diario)}</td>
      <td><div class="mini-progress"><span style="width:${pct}%"></span></div><small>${dias}/${total} · ${pct}%</small></td>
      <td>${fmtBRL(i.rendimento_pago)}</td>
      <td>${statusPill(i.status)}</td>
      <td class="td-acoes">
        <button class="mini-btn" type="button" onclick="adminZerarProgressoInvestimento('${escTexto(i.__key)}')" title="Zerar dias e rendimento pagos">Zerar</button>
        <button class="mini-btn danger" type="button" onclick="adminRemoverInvestimento('${escTexto(i.__key)}')" title="Remover este plano do cliente">Remover</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">Nenhum investimento encontrado.</td></tr>';
}

async function adminZerarProgressoInvestimento(key) {
  const inv = ADMIN_CACHE.investimentos && ADMIN_CACHE.investimentos[key];
  if (!inv) return toast('Investimento não encontrado. Recarregue o painel.');
  if (!confirm(`Zerar o progresso de "${inv.plano_nome || 'plano'}" de ${inv.usuario_nome || 'cliente'}?\n\nDias pagos e rendimento pago serão zerados e o ciclo reinicia. Valores já creditados no saldo não serão estornados.`)) return;
  try {
    const agora = new Date();
    const ciclo = Math.max(1, Number(inv.duracao_dias) || Number(inv.duracao) || 20);
    const fim = new Date(agora.getTime() + ciclo * 86400000);
    await db.child('investimentos/' + key).update({
      dias_pagos: 0,
      rendimento_pago: 0,
      status: 'ativo',
      data_inicio: agora.toISOString(),
      data_fim: fim.toISOString(),
      proximo_pagamento: new Date(agora.getTime() + 86400000).toISOString(),
      concluido_em: null,
    });
    toast('Progresso zerado. O ciclo do plano foi reiniciado.');
    carregarAdmin();
  } catch (e) {
    toast('Erro ao zerar progresso: ' + e.message);
  }
}

async function adminRemoverInvestimento(key) {
  const inv = ADMIN_CACHE.investimentos && ADMIN_CACHE.investimentos[key];
  if (!inv) return toast('Investimento não encontrado. Recarregue o painel.');
  if (!confirm(`Remover o plano "${inv.plano_nome || 'plano'}" de ${inv.usuario_nome || 'cliente'}?\n\nO investimento será apagado, o progresso zerado e o limite do plano liberado. Saldo, rendimentos já pagos e histórico de transações não serão alterados.`)) return;
  try {
    const uid = String(inv.usuario_id || '');
    if (!uid) return toast('Investimento sem usuário vinculado.');
    await db.child('investimentos_removidos').push({
      ...inv,
      removido_em: new Date().toISOString(),
      removido_por: 'admin',
    });
    await db.child('investimentos/' + key).remove();
    await db.child('investimentos_usuario/' + uid + '/' + key).remove();
    const snap = await db.child('usuarios/' + uid).once('value');
    if (snap.exists()) {
      const u = snap.val();
      const valor = Number(inv.valor_aplicado) || 0;
      const planosComprados = {};
      if (Array.isArray(u.planos_comprados)) {
        for (const id of u.planos_comprados) {
          const k = String(id);
          planosComprados[k] = (Number(planosComprados[k]) || 0) + 1;
        }
      } else {
        Object.assign(planosComprados, u.planos_comprados || {});
      }
      const pid = String(inv.plano_id ?? inv.planoId ?? '');
      if (pid) {
        const qtd = Math.max(0, Number(planosComprados[pid] || 0) - 1);
        if (qtd <= 0) delete planosComprados[pid];
        else planosComprados[pid] = qtd;
      }
      await db.child('usuarios/' + uid).update({
        investido: Math.max(0, Math.round(((Number(u.investido) || 0) - valor) * 100) / 100),
        planos_comprados: planosComprados,
      });
    }
    toast('Plano removido. Limite liberado e progresso zerado.');
    carregarAdmin();
  } catch (e) {
    toast('Erro ao remover plano: ' + e.message);
  }
}

function renderAdminSelectUsuarios() {
  const sel = el('adminSaldoUsuario'); if (!sel) return;
  const atual = sel.value;
  const lista = Object.entries(ADMIN_CACHE.usuarios || {}).map(([id, u]) => ({ id, nome: u.nome || id, email: u.email || '' }));
  lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  sel.innerHTML = '<option value="">Selecione o usuário...</option>' + lista.map(u =>
    `<option value="${u.id}">${escTexto(u.nome)} — ${escTexto(u.email)}</option>`).join('');
  if (atual && lista.some(u => u.id === atual)) sel.value = atual;
}

async function adminCriarUsuario() {
  const nome = String(el('novoUsuarioNome')?.value || '').trim();
  const email = String(el('novoUsuarioEmail')?.value || '').trim().toLowerCase();
  const cpf = String(el('novoUsuarioCpf')?.value || '').replace(/\D/g, '');
  const celular = String(el('novoUsuarioCelular')?.value || '').replace(/\D/g, '');
  const senha = String(el('novoUsuarioSenha')?.value || '');
  if (nome.split(' ').length < 2) return toast('Digite o nome completo.');
  if (!validarEmail(email)) return toast('E-mail inválido.');
  if (cpf && !validarCPF(cpf)) return toast('CPF inválido.');
  if (celular.length < 10) return toast('Celular inválido.');
  if (senha.length < 8) return toast('Senha mínima de 8 caracteres.');
  try {
    const resp = await fetch(TAX_API + '/admin/criar-usuario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken() },
      body: JSON.stringify({ nome, email, cpf, celular, pix: celular, senha }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) return toast(r.message || 'Erro ao criar usuário.');
    ['novoUsuarioNome','novoUsuarioEmail','novoUsuarioCpf','novoUsuarioCelular','novoUsuarioSenha'].forEach(i => { if (el(i)) el(i).value = ''; });
    toast(`Usuário ${nome.split(' ')[0]} criado!`);
    carregarAdmin();
  } catch (e) {
    toast('Erro ao criar usuário: ' + e.message);
  }
}

async function adminAjustarSaldo(sinal) {
  const uidSel = String(el('adminSaldoUsuario')?.value || '');
  const valor = Math.round((Number(el('adminSaldoValor')?.value) || 0) * 100) / 100;
  if (!uidSel) return toast('Selecione um usuário.');
  if (!(valor > 0)) return toast('Digite um valor maior que zero.');
  if (!db) return toast('Banco não conectado.');
  const snap = await db.child('usuarios/' + uidSel).once('value');
  if (!snap.exists()) return toast('Usuário não encontrado.');
  const u = snap.val();
  const atual = Number(u.saldo || 0);
  const novo = Math.round((atual + sinal * valor) * 100) / 100;
  if (novo < 0) return toast('Saldo não pode ficar negativo.');
  await db.child('usuarios/' + uidSel + '/saldo').set(novo);
  const tx = await db.child('transacoes').push({
    usuario_id: uidSel, usuario_email: u.email, usuario_nome: u.nome,
    tipo: sinal > 0 ? 'bonus' : 'ajuste', valor, status: 'aprovada',
    observacao: (sinal > 0 ? 'Crédito manual admin' : 'Débito manual admin'), criado_em: new Date().toISOString()
  });
  await db.child('transacoes_usuario/' + uidSel + '/' + tx.key).set(true);
  toast(`${sinal > 0 ? 'Adicionado' : 'Removido'} ${fmtBRL(valor)}. Saldo: ${fmtBRL(novo)}`);
  if (el('adminSaldoValor')) el('adminSaldoValor').value = '';
  carregarAdmin();
}

async function adminExcluirUsuario(id) {
  if (!db) return toast('Banco não conectado.');
  const cache = (ADMIN_CACHE.usuarios || {})[id] || {};
  const nome = cache.nome || id;
  if (!confirm(`Excluir o usuário "${nome}"? Essa ação não pode ser desfeita.`)) return;
  try {
    const snap = await db.child('usuarios/' + id).once('value');
    const u = snap.val() || cache;
    await db.child('usuarios/' + id).remove();
    if (u.email) await db.child('email_index/' + emailKey(u.email)).remove();
    if (u.codigo_indicacao) await db.child('codigo_index/' + u.codigo_indicacao).remove();
    await db.child('transacoes_usuario/' + id).remove();
    await db.child('saques_usuario/' + id).remove();
    await db.child('investimentos_usuario/' + id).remove();
    await db.child('bonus_resgates/' + id).remove();
    await db.child('indicados_index/' + id).remove();
    if (u.indicado_por) await db.child('indicados_index/' + u.indicado_por + '/' + id).remove();
    toast('Usuário excluído.');
    carregarAdmin();
  } catch (e) {
    toast('Erro ao excluir: ' + e.message);
  }
}

async function adminCarregarBanners() {
  const tbody = el('adminBannersBody'); if (!tbody) return;
  try {
    const r = await fetch(TAX_API + '/admin/marketing/list', { headers: { Authorization: 'Bearer ' + adminToken() } });
    const j = await r.json();
    const lista = j.banners || [];
    if (el('adminBannersCount')) el('adminBannersCount').textContent = lista.length;
    tbody.innerHTML = lista.length ? lista.map(b => `<tr>
      <td><img src="${escTexto(b.image_url)}" alt="Banner" loading="lazy" class="banner-thumb"></td>
      <td><span class="status-pill ${b.type === 'popup' ? 'violet' : 'info'}">${escTexto(b.type === 'popup' ? 'Popup' : 'Carrossel')}</span></td>
      <td class="td-link" title="${escTexto(b.link || '')}">${b.link ? escTexto(b.link) : '—'}</td>
      <td class="td-acoes">
        <button class="mini-btn" type="button" onclick="adminEditarBannerLink('${escTexto(b.id)}')">Editar link</button>
        <button class="mini-btn danger" type="button" onclick="adminExcluirBanner('${escTexto(b.id)}')">Excluir</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">Nenhum banner cadastrado.</td></tr>';
  } catch (e) {
    if (el('adminBannersCount')) el('adminBannersCount').textContent = '0';
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Erro ao carregar banners.</td></tr>';
  }
}
async function adminEnviarBanner() {
  const arquivo = el('bannerArquivo')?.files?.[0];
  if (!arquivo) return setMensagem('adminBannerMsg', 'Selecione uma imagem.', 'error');
  const form = new FormData();
  form.append('image', arquivo);
  form.append('link', el('bannerLink')?.value || '');
  form.append('type', el('bannerTipo')?.value || 'carousel');
  setMensagem('adminBannerMsg', 'Enviando...', 'loading');
  try {
    const r = await fetch(TAX_API + '/admin/marketing/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken() }, body: form });
    const j = await r.json();
    if (!j.ok) return setMensagem('adminBannerMsg', j.message || 'Erro ao enviar.', 'error');
    setMensagem('adminBannerMsg', 'Banner enviado com sucesso!', 'success');
    if (el('bannerArquivo')) el('bannerArquivo').value = '';
    if (el('bannerLink')) el('bannerLink').value = '';
    adminCarregarBanners();
  } catch (e) { setMensagem('adminBannerMsg', 'Erro: ' + e.message, 'error'); }
}
async function adminEditarBannerLink(id) {
  const atual = String(prompt('Novo link (deixe vazio para remover):') ?? '');
  try {
    await fetch(TAX_API + '/admin/marketing/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken() },
      body: JSON.stringify({ link: atual }),
    });
    adminCarregarBanners();
  } catch (e) { toast('Erro: ' + e.message); }
}
async function adminExcluirBanner(id) {
  if (!confirm('Excluir este banner?')) return;
  try {
    await fetch(TAX_API + '/admin/marketing/delete/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + adminToken() } });
    adminCarregarBanners();
  } catch (e) { toast('Erro: ' + e.message); }
}
async function adminCarregarGateway() {
  if (!db) return;
  try {
    const s = await db.child('config/gateway').once('value');
    const g = s.val() || {};
    if (el('adminGatewayUrl')) el('adminGatewayUrl').value = g.relayUrl || '';
    if (el('adminGatewayToken')) el('adminGatewayToken').value = g.relayToken || '';
    if (el('adminGatewayWebhook')) el('adminGatewayWebhook').value = g.webhookToken || '';
    setMensagem('adminGatewayMsg', 'Configuração carregada.', 'success');
  } catch (e) { setMensagem('adminGatewayMsg', 'Erro: ' + e.message, 'error'); }
}
async function adminSalvarGateway() {
  if (!db) return;
  const cfg = {
    relayUrl: String(el('adminGatewayUrl')?.value || '').trim(),
    relayToken: String(el('adminGatewayToken')?.value || '').trim(),
    webhookToken: String(el('adminGatewayWebhook')?.value || '').trim(),
    atualizado_em: new Date().toISOString()
  };
  if (!cfg.relayUrl || !cfg.relayToken) return setMensagem('adminGatewayMsg', 'URL e token do relay são obrigatórios.', 'error');
  await db.child('config/gateway').set(cfg);
  setMensagem('adminGatewayMsg', 'Chaves salvas. O Worker já está usando a nova configuração.', 'success');
}
async function adminTestarGateway() {
  try {
    const r = await SigiloPay.consultarSaldo();
    setMensagem('adminGatewayMsg', r.sucesso ? `Gateway OK — saldo ${fmtBRL(r.available)}` : 'Gateway não respondeu.', r.sucesso ? 'success' : 'error');
  } catch (e) { setMensagem('adminGatewayMsg', 'Erro: ' + e.message, 'error'); }
}

// ------------------------------------------------------------
// ADMIN — APARÊNCIA (nome da plataforma, cor e tema)
// ------------------------------------------------------------
const CORES_PRESET = [
  { nome: 'Laranja', cor: '#f97316' },
  { nome: 'Azul', cor: '#2563eb' },
  { nome: 'Verde', cor: '#16a34a' },
  { nome: 'Roxo', cor: '#7c3aed' },
  { nome: 'Rosa', cor: '#db2777' },
  { nome: 'Vermelho', cor: '#dc2626' },
  { nome: 'Dourado', cor: '#d97706' },
  { nome: 'Ciano', cor: '#0891b2' }
];

function renderCoresPreset() {
  const box = el('adminCoresPreset');
  if (!box) return;
  box.innerHTML = CORES_PRESET.map(c =>
    `<button type="button" class="cor-swatch" style="background:${c.cor};color:${c.cor}" data-cor="${c.cor}" title="${c.nome}" aria-label="${c.nome}" onclick="adminSelecionarCor('${c.cor}')"></button>`
  ).join('');
}

function atualizarPreviewCor(cor) {
  const c = String(cor || '#d97706');
  if (el('adminCorCodigo')) el('adminCorCodigo').textContent = c.toUpperCase();
  const btn = el('adminCorPreviewBtn');
  if (btn) {
    btn.style.background = c;
    btn.style.borderColor = c;
    btn.style.color = '#fff';
  }
  document.querySelectorAll('#adminCoresPreset .cor-swatch').forEach(s => {
    s.classList.toggle('ativa', String(s.dataset.cor || '').toLowerCase() === c.toLowerCase());
  });
}

function adminSelecionarCor(cor) {
  const campo = el('adminCorPrimaria');
  if (campo) campo.value = cor;
  atualizarPreviewCor(cor);
}

// ------------------------------------------------------------
// ADMIN — TABELAS RESPONSIVAS (rótulos no celular)
// ------------------------------------------------------------
function rotularTabelasAdmin() {
  document.querySelectorAll('.admin-table-card table').forEach(table => {
    const cabecalhos = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(tr => {
      [...tr.children].forEach((td, i) => {
        if (!td || td.tagName !== 'TD') return;
        if (td.hasAttribute('colspan') || !cabecalhos[i]) {
          td.removeAttribute('data-label');
          return;
        }
        td.dataset.label = cabecalhos[i];
      });
    });
  });
}
let _obsTabelasAdmin = null;
function observarTabelasAdmin() {
  if (_obsTabelasAdmin) return;
  const alvo = document.querySelector('.admin-content');
  if (!alvo) return;
  rotularTabelasAdmin();
  _obsTabelasAdmin = new MutationObserver(() => rotularTabelasAdmin());
  _obsTabelasAdmin.observe(alvo, { childList: true, subtree: true });
}

// ------------------------------------------------------------
// ADMIN — PLANOS E REGRAS FINANCEIRAS
// ------------------------------------------------------------
let planosAdmin = [];

function adminPlanosBase(lista) {
  const base = Array.isArray(lista) && lista.length ? lista : planos;
  return base.map(normalizarPlano);
}

function adminRenderPlanos() {
  const box = el('adminPlanosLista');
  if (!box) return;
  planosAdmin.sort((a, b) => (Number(a.entrada) - Number(b.entrada)) || (Number(a.id) - Number(b.id)));
  if (!planosAdmin.length) {
    box.innerHTML = '<p class="empty">Nenhum plano. Clique em “Adicionar plano”.</p>';
    return;
  }
  box.innerHTML = planosAdmin.map(p => `
    <details class="admin-plano-card" data-id="${p.id}" ${Number(p.id) === 0 ? 'open' : ''}>
      <summary class="admin-plano-top">
        <strong>#${p.id} · ${escTexto(p.nome)}</strong>
        <span class="admin-plano-status ${p.ativo !== false ? 'on' : 'off'}">${p.ativo !== false ? 'Ativo' : 'Inativo'}</span>
      </summary>
      <div class="admin-plano-body">
        <label class="admin-plano-ativo"><input type="checkbox" ${p.ativo !== false ? 'checked' : ''} onchange="adminAtualizarPlano(${p.id},'ativo',this.checked)"> Ativo no site</label>
        <div class="admin-plano-grid">
          <label class="form-full"><span>Nome</span><input type="text" maxlength="60" value="${escTexto(p.nome)}" oninput="adminAtualizarPlano(${p.id},'nome',this.value)"></label>
          <label><span>Entrada (R$)</span><input type="number" min="0" step="0.01" data-campo="entrada" value="${Number(p.entrada) || 0}" oninput="adminAtualizarPlano(${p.id},'entrada',this.value)"></label>
          <label><span>Diária (R$)</span><input type="number" min="0" step="0.01" data-campo="diaria" value="${Number(p.diaria) || 0}" oninput="adminAtualizarPlano(${p.id},'diaria',this.value)"></label>
          <label><span>Ciclo (dias)</span><input type="number" min="1" step="1" data-campo="ciclo" value="${Number(p.ciclo) || 20}" oninput="adminAtualizarPlano(${p.id},'ciclo',this.value)"></label>
          <label><span>Total recebido (R$)</span><input type="number" min="0" step="0.01" data-campo="retorno" value="${Number(p.retorno) || 0}" oninput="adminAtualizarPlano(${p.id},'retorno',this.value)"></label>
          <label><span>Limite por conta</span><input type="number" min="1" step="1" value="${Number(p.limite) || 2}" oninput="adminAtualizarPlano(${p.id},'limite',this.value)"></label>
          <label class="form-full"><span>Foto do plano (URL)</span><input type="text" value="${escTexto(p.imagem || '')}" placeholder="plan-car.webp ou https://..." oninput="adminAtualizarPlano(${p.id},'imagem',this.value)"></label>
          <label class="form-full admin-plano-upload"><span>Ou enviar uma foto</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="adminUploadImagemPlano(${p.id},this)"></label>
        </div>
        <div class="admin-plano-foot">
          <img src="${escTexto(p.imagem || 'plan-car.webp')}" alt="Prévia do plano ${escTexto(p.nome)}" loading="lazy" onerror="this.onerror=null;this.src='plan-car.webp'">
          <button class="btn small secondary" type="button" onclick="adminRemoverPlano(${p.id})">Remover</button>
        </div>
      </div>
    </details>
  `).join('');
}

async function adminCarregarPlanos() {
  try {
    const s = await db.child('config/planos').once('value');
    planosAdmin = adminPlanosBase(s.val());
  } catch (e) {
    planosAdmin = adminPlanosBase(null);
    console.warn('[Planos admin]', e);
  }
  adminRenderPlanos();
}

function adminNovoPlano() {
  const maior = planosAdmin.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
  const novo = {
    id: maior + 1,
    nome: 'Novo plano',
    entrada: 0,
    diaria: 0,
    ciclo: 20,
    retorno: 0,
    imagem: 'plan-car.webp',
    limite: 2,
    ativo: true,
  };
  planosAdmin.push(novo);
  adminRenderPlanos();
  const card = document.querySelector('.admin-plano-card[data-id="' + novo.id + '"]');
  if (card) {
    card.open = true;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  setMensagem('adminPlanosMsg', 'Plano adicionado. Edite os valores e clique em “Salvar planos”.', 'success');
}

const ADMIN_PLANO_MULTIPLICADOR = 1.7;
function adminCalcularPlano(p, origem) {
  const ciclo = Math.max(1, Number(p.ciclo) || 20);
  const entrada = Math.max(0, Number(p.entrada) || 0);
  const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;
  if (origem === 'entrada' || origem === 'ciclo') {
    // Mesma matemática dos planos atuais: entrada × 1,7 ÷ ciclo.
    // Ex.: 15 × 1,7 ÷ 20 = 1,275 → 1,28; total = 1,28 × 20 = 25,60.
    // Calcula em centavos para evitar erro de ponto flutuante (1.275 → 1.27).
    if (entrada > 0 || Number(p.id) !== 0) {
      const centavosDiaria = Math.round((entrada * 170) / ciclo);
      p.diaria = centavosDiaria / 100;
      p.retorno = (centavosDiaria * ciclo) / 100;
    }
  } else if (origem === 'retorno') {
    p.diaria = Math.round(((Number(p.retorno) || 0) * 100) / ciclo) / 100;
  } else if (origem === 'diaria') {
    p.retorno = Math.round((Number(p.diaria) || 0) * 100 * ciclo) / 100;
  }
}

function adminAplicarValoresPlano(id) {
  const p = planosAdmin.find(x => Number(x.id) === Number(id));
  const card = document.querySelector('.admin-plano-card[data-id="' + Number(id) + '"]');
  if (!p || !card) return;
  ['entrada', 'diaria', 'ciclo', 'retorno'].forEach(campo => {
    const input = card.querySelector('input[data-campo="' + campo + '"]');
    if (input && document.activeElement !== input) input.value = Number(p[campo]) || 0;
  });
}

function adminAtualizarPlano(id, campo, valor) {
  const p = planosAdmin.find(x => Number(x.id) === Number(id));
  if (!p) return;
  if (campo === 'ativo') {
    p.ativo = !!valor;
    const card = document.querySelector('.admin-plano-card[data-id="' + Number(id) + '"]');
    const badge = card && card.querySelector('.admin-plano-status');
    if (badge) {
      badge.textContent = p.ativo ? 'Ativo' : 'Inativo';
      badge.classList.toggle('on', p.ativo);
      badge.classList.toggle('off', !p.ativo);
    }
  }
  else if (['entrada', 'diaria', 'ciclo', 'retorno', 'limite'].includes(campo)) {
    p[campo] = Number(valor) || 0;
    if (['entrada', 'diaria', 'ciclo', 'retorno'].includes(campo)) {
      adminCalcularPlano(p, campo);
      adminAplicarValoresPlano(id);
    }
  }
  else p[campo] = String(valor || '');
  if (campo === 'imagem') {
    const card = document.querySelector('.admin-plano-card[data-id="' + Number(id) + '"]');
    const img = card && card.querySelector('.admin-plano-foot img');
    if (img) img.src = p.imagem || 'plan-car.webp';
  }
}

function adminRemoverPlano(id) {
  if (Number(id) === 0) {
    setMensagem('adminPlanosMsg', 'O plano gratuito (ID 0) não pode ser removido; edite-o ou desative-o.', 'error');
    return;
  }
  if (!confirm('Remover o plano #' + id + '?')) return;
  planosAdmin = planosAdmin.filter(p => Number(p.id) !== Number(id));
  adminRenderPlanos();
}

async function adminUploadImagemPlano(id, input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setMensagem('adminPlanosMsg', 'Selecione uma imagem.', 'error');
    return;
  }
  setMensagem('adminPlanosMsg', 'Enviando foto...', 'loading');
  try {
    const form = new FormData();
    form.append('image', file);
    const resp = await fetch(TAX_API + '/admin/upload-plan-image', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + adminToken() },
      body: form,
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok || !r.image_url) {
      return setMensagem('adminPlanosMsg', r.message || 'Falha ao enviar a foto.', 'error');
    }
    const p = planosAdmin.find(x => Number(x.id) === Number(id));
    if (p) p.imagem = r.image_url;
    adminRenderPlanos();
    setMensagem('adminPlanosMsg', 'Foto enviada. Clique em “Salvar planos” para publicar.', 'success');
  } catch (e) {
    setMensagem('adminPlanosMsg', 'Erro ao enviar a foto: ' + e.message, 'error');
  }
}

async function adminSalvarPlanos() {
  const limpos = planosAdmin.map((p, i) => normalizarPlano({
    ...p,
    id: p.id === '' || p.id == null ? i : Number(p.id),
  }, i)).sort((a, b) => (a.entrada - b.entrada) || (a.id - b.id));
  const ids = new Set();
  for (const p of limpos) {
    if (!p.nome.trim()) return setMensagem('adminPlanosMsg', 'Todo plano precisa de um nome.', 'error');
    if (ids.has(p.id)) return setMensagem('adminPlanosMsg', 'Há IDs de planos duplicados.', 'error');
    if (p.entrada < 0 || p.diaria < 0 || p.retorno < 0) return setMensagem('adminPlanosMsg', 'Valores não podem ser negativos.', 'error');
    if (p.ciclo < 1) return setMensagem('adminPlanosMsg', 'O ciclo deve ter pelo menos 1 dia.', 'error');
    if (p.limite < 1) return setMensagem('adminPlanosMsg', 'O limite deve ser pelo menos 1.', 'error');
    ids.add(p.id);
  }
  if (!limpos.some(p => p.ativo !== false)) return setMensagem('adminPlanosMsg', 'Mantenha pelo menos um plano ativo.', 'error');
  try {
    await db.child('config/planos').set(limpos);
    planosAdmin = limpos;
    planos = limpos.map(normalizarPlano);
    atualizarSelectPlanos();
    setMensagem('adminPlanosMsg', 'Planos salvos e publicados no site.', 'success');
    toast('Planos atualizados.');
  } catch (e) {
    setMensagem('adminPlanosMsg', 'Erro ao salvar planos: ' + e.message, 'error');
  }
}

async function adminCarregarFinanceiro() {
  let cfg = {
    depositoMinimo: CONFIG.depositoMinimo,
    depositoMaximo: CONFIG.depositoMaximo,
    saqueMinimo: CONFIG.saqueMinimo,
    taxaSaquePorcento: CONFIG.taxaSaquePorcento,
    saquesPorDia: CONFIG.saquesPorDia,
  };
  try {
    const s = await db.child('config/financeiro').once('value');
    const v = s.val();
    if (v && typeof v === 'object') {
      if (Number(v.depositoMinimo) > 0) cfg.depositoMinimo = Number(v.depositoMinimo);
      if (Number(v.depositoMaximo) > 0) cfg.depositoMaximo = Number(v.depositoMaximo);
      if (Number(v.saqueMinimo) > 0) cfg.saqueMinimo = Number(v.saqueMinimo);
      if (Number(v.taxaSaquePorcento) >= 0) cfg.taxaSaquePorcento = Number(v.taxaSaquePorcento);
      if (Number(v.saquesPorDia) >= 0) cfg.saquesPorDia = Math.floor(Number(v.saquesPorDia));
    }
  } catch (e) {
    console.warn('[Financeiro admin]', e);
  }
  if (el('adminDepositoMinimo')) el('adminDepositoMinimo').value = cfg.depositoMinimo;
  if (el('adminDepositoMaximo')) el('adminDepositoMaximo').value = cfg.depositoMaximo;
  if (el('adminSaqueMinimo')) el('adminSaqueMinimo').value = cfg.saqueMinimo;
  if (el('adminTaxaSaque')) el('adminTaxaSaque').value = cfg.taxaSaquePorcento;
  if (el('adminSaquesPorDia')) el('adminSaquesPorDia').value = cfg.saquesPorDia;
}

async function adminSalvarFinanceiro() {
  const depositoMinimo = Math.max(1, Number(el('adminDepositoMinimo')?.value) || 0);
  const depositoMaximo = Math.max(1, Number(el('adminDepositoMaximo')?.value) || 0);
  const saqueMinimo = Math.max(1, Number(el('adminSaqueMinimo')?.value) || 0);
  const taxa = Math.min(100, Math.max(0, Number(el('adminTaxaSaque')?.value) || 0));
  const porDia = Math.max(0, Math.floor(Number(el('adminSaquesPorDia')?.value) || 0));
  if (!(depositoMinimo > 0)) return setMensagem('adminFinanceiroMsg', 'Informe um depósito mínimo válido.', 'error');
  if (depositoMaximo < depositoMinimo) return setMensagem('adminFinanceiroMsg', 'O depósito máximo precisa ser maior ou igual ao mínimo.', 'error');
  if (!(saqueMinimo > 0)) return setMensagem('adminFinanceiroMsg', 'Informe um saque mínimo válido.', 'error');
  const cfg = {
    depositoMinimo,
    depositoMaximo,
    saqueMinimo,
    taxaSaquePorcento: taxa,
    saquesPorDia: porDia,
    atualizado_em: new Date().toISOString(),
  };
  try {
    await db.child('config/financeiro').set(cfg);
    CONFIG.depositoMinimo = depositoMinimo;
    CONFIG.depositoMaximo = depositoMaximo;
    CONFIG.saqueMinimo = saqueMinimo;
    CONFIG.taxaSaquePorcento = taxa;
    CONFIG.saquesPorDia = porDia;
    aplicarConfigFinanceira();
    setMensagem('adminFinanceiroMsg', 'Regras financeiras salvas.', 'success');
    toast('Depósito, saque e taxas atualizados.');
  } catch (e) {
    setMensagem('adminFinanceiroMsg', 'Erro ao salvar: ' + e.message, 'error');
  }
}

async function adminCarregarAparencia() {
  renderCoresPreset();
  let cfg = { nome: 'Veloster Capital', cor: '#d97706' };
  try {
    if (db) {
      const s = await db.child('config/marca').once('value');
      const m = s.val();
      if (m && typeof m === 'object') {
        cfg = { nome: String(m.nome || 'Veloster Capital'), cor: String(m.cor || '#d97706') };
      }
    }
  } catch (e) { console.warn('[Aparência]', e); }
  if (el('adminNomePlataforma')) el('adminNomePlataforma').value = cfg.nome;
  if (el('adminCorPrimaria')) el('adminCorPrimaria').value = cfg.cor;
  atualizarPreviewCor(cfg.cor);
  if (window.TaxinexoUI) window.TaxinexoUI.aplicarMarca(cfg);
}

async function adminSalvarAparencia() {
  if (!db) return setMensagem('adminAparenciaMsg', 'Banco não conectado.', 'error');
  const nome = String(el('adminNomePlataforma')?.value || '').trim().slice(0, 24) || 'Veloster Capital';
  const cor = String(el('adminCorPrimaria')?.value || '#d97706').trim();
  if (!/^#[0-9a-f]{6}$/i.test(cor)) return setMensagem('adminAparenciaMsg', 'Cor inválida. Use o seletor de cor.', 'error');
  try {
    await db.child('config/marca').set({ nome, cor, atualizado_em: new Date().toISOString() });
    if (window.TaxinexoUI) window.TaxinexoUI.aplicarMarca({ nome, cor });
    setMensagem('adminAparenciaMsg', 'Aparência salva e aplicada em todo o site.', 'success');
    toast('Aparência atualizada.');
    adminCarregarAparencia();
  } catch (e) {
    setMensagem('adminAparenciaMsg', 'Erro ao salvar: ' + e.message, 'error');
  }
}
async function processarRendimentos(ev) {
  if (!db) return toast('Banco não conectado.');
  if (!confirm('Processar rendimentos de TODOS os clientes agora?')) return;
  const btn = ev && ev.currentTarget ? ev.currentTarget : (ev && ev.target);
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Processando...'; }
  try {
    const snap = await db.child('investimentos').once('value');
    const dados = snap.val() || {};
    const ativos = Object.entries(dados).filter(([k, i]) => i.status === 'ativo');
    if (!ativos.length) return toast('Nenhum investimento ativo.');

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
        // Planos novos já diluem o capital nas diárias; não devolve de novo.
        if (inv.capital_incluido !== true) {
          const aplicado = Number(inv.valor_aplicado) || 0;
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
  if (!db) return toast('Banco não conectado.');
  try {
    const s = await db.child('controle/saques_bloqueados').once('value');
    const atual = s.val() || { bloqueado: false };
    return definirBloqueioSaques(!atual.bloqueado);
  } catch (e) {
    toast('Erro ao ler o controle de saques: ' + e.message);
  }
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
  if (!db) return setMensagem('adminLinkGrupoMsg', 'Banco não conectado.', 'error');
  await db.child('config/link_grupo').set(url);
  aplicarLinkGrupo(url);
  setMensagem('adminLinkGrupoMsg', 'Link do grupo salvo e aplicado em todas as páginas.', 'success');
}

// ------------------------------------------------------------
// ADMIN — CÓDIGOS DA ROLETA
// ------------------------------------------------------------
function codigoPromocionalValido(codigo) {
  return /^[A-Z0-9_-]{3,24}$/.test(String(codigo || '').trim().toUpperCase());
}
function listaCodigosRoleta() {
  const bruto = CONFIG.codigo_roleta || 'ROLETA';
  const arr = Array.isArray(bruto) ? bruto : String(bruto).split(/[\s,;]+/);
  return arr.map(x => String(x).trim().toUpperCase()).filter(c => c && codigoPromocionalValido(c));
}
async function carregarCodigosRoleta() {
  if (!sessionToken()) return;
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
  const brutos = campo.value.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
  const invalidos = brutos.filter(c => !codigoPromocionalValido(c));
  if (invalidos.length) {
    return setMensagem('adminRoletaMsg', 'Código inválido: ' + invalidos.slice(0, 3).join(', ') + '. Use letras, números, _ ou - (3 a 24).', 'error');
  }
  const lista = [...new Set(brutos)];
  if (!lista.length) return setMensagem('adminRoletaMsg', 'Digite pelo menos um código.', 'error');
  await db.child('config/codigo_roleta').set(lista);
  CONFIG.codigo_roleta = lista;
  campo.value = lista.join('\n');
  setMensagem('adminRoletaMsg', lista.length + ' código(s) salvo(s) e ativo(s) agora.', 'success');
}

// Códigos de bônus (1 resgate por código por cliente) — cada um com seu valor
function listaCodigosBonus() {
  const bruto = CONFIG.codigo_bonus || [];
  let arr;
  if (Array.isArray(bruto)) arr = bruto;
  else if (bruto && typeof bruto === 'object') arr = [bruto]; // objeto único (ex.: {codigo, valor})
  else arr = String(bruto).split(/[\s,;]+/);
  return arr.map(x => {
    const valorPadrao = Math.round((Number(CONFIG.valor_bonus) || 5) * 100) / 100;
    if (x && typeof x === 'object') {
      return {
        codigo: String(x.codigo || '').trim().toUpperCase(),
        valor: Math.round((Number(x.valor) || valorPadrao) * 100) / 100,
      };
    }
    return { codigo: String(x).trim().toUpperCase(), valor: valorPadrao };
  }).filter(x => x.codigo && codigoPromocionalValido(x.codigo));
}
function renderBonusLista() {
  const box = el('adminBonusLista'); if (!box) return;
  const itens = listaCodigosBonus();
  box.innerHTML = itens.length ? itens.map((x, i) => `<div class="bonus-item">
    <code>${escTexto(x.codigo)}</code>
    <strong>${fmtBRL(x.valor)}</strong>
    <button class="bonus-del" title="Remover" aria-label="Remover" onclick="removerCodigoBonus(${i})"></button>
  </div>`).join('') : '<p class="empty">Nenhum código cadastrado.</p>';
}
function adicionarCodigoBonus() {
  const c = el('adminNovoCodigo'), v = el('adminNovoValor');
  const codigo = String(c?.value || '').trim().toUpperCase();
  const valor = Math.round((Number(v?.value) || 0) * 100) / 100;
  if (!codigo) return setMensagem('adminBonusMsg', 'Digite o código.', 'error');
  if (!codigoPromocionalValido(codigo)) {
    return setMensagem('adminBonusMsg', 'Código inválido. Use letras, números, _ ou - (3 a 24).', 'error');
  }
  if (!(valor > 0)) return setMensagem('adminBonusMsg', 'Digite um valor maior que zero.', 'error');
  const lista = listaCodigosBonus();
  if (lista.some(x => x.codigo === codigo)) return setMensagem('adminBonusMsg', 'Esse código já existe.', 'error');
  lista.push({ codigo, valor });
  CONFIG.codigo_bonus = lista;
  if (c) c.value = ''; if (v) v.value = '';
  renderBonusLista();
  setMensagem('adminBonusMsg', `${codigo} adicionado (${fmtBRL(valor)}). Clique em "Salvar todos".`, 'success');
}
function removerCodigoBonus(i) {
  const lista = listaCodigosBonus();
  if (i < 0 || i >= lista.length) return;
  const codigo = lista[i].codigo;
  lista.splice(i, 1);
  CONFIG.codigo_bonus = lista;
  renderBonusLista();
  setMensagem('adminBonusMsg', `${codigo} removido da lista. Clique em "Salvar todos".`, 'success');
}
async function carregarCodigosBonus() {
  if (!sessionToken()) return;
  try {
    const s = await db.child('config/codigo_bonus').once('value');
    if (s.exists()) CONFIG.codigo_bonus = s.val();
    renderBonusLista();
  } catch (e) { console.warn('[Bônus]', e); }
}
async function salvarCodigosBonus() {
  if (!db) return;
  const lista = listaCodigosBonus();
  if (!lista.length) return setMensagem('adminBonusMsg', 'Adicione pelo menos um código.', 'error');
  await db.child('config/codigo_bonus').set(lista);
  CONFIG.codigo_bonus = lista;
  setMensagem('adminBonusMsg', lista.length + ' código(s) salvo(s) e ativo(s) agora.', 'success');
}
async function resgatarBonus(codigo, usuario) {
  const cod = String(codigo || '').trim().toUpperCase();
  const item = listaCodigosBonus().find(x => String(x.codigo || '').toUpperCase() === cod);
  if (!item) return setMensagem('bonusResult', 'Código inválido.', 'error');
  try {
    const resp = await fetch(TAX_API + '/bonus/resgatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionToken() },
      body: JSON.stringify({ codigo: cod }),
    });
    const r = await resp.json().catch(() => ({}));
    if (!resp.ok || !r.ok) return setMensagem('bonusResult', r.message || 'Erro ao resgatar.', 'error');
    usuario.saldo = Number(r.saldo) || 0;
    salvarUsuarioLocal(usuario);
    if (el('saldo')) el('saldo').textContent = Number(usuario.saldo).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setMensagem('bonusResult', `Bônus de ${fmtBRL(r.valor || item.valor)} creditado no seu saldo!`, 'success');
  } catch (e) {
    setMensagem('bonusResult', 'Erro ao resgatar: ' + e.message, 'error');
  }
}

// ------------------------------------------------------------
// BÔNUS E RODADA
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  configurarCarteira();
  carregarCodigosRoleta();
  carregarCodigosBonus();
  carregarLinkGrupo();
  if (/\/(admin)(\.html)?\/?$/.test(location.pathname)) {
    observarTabelasAdmin();
    if (adminToken()) {
      adminCarregarGateway();
      adminCarregarBanners();
      adminCarregarPlanos();
      adminCarregarFinanceiro();
    }
  }

  if (/\/(cliente)(\.html)?\/?$/.test(location.pathname)) iniciarDashboard();

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

  if (/\/(admin)(\.html)?\/?$/.test(location.pathname)) {
    if (adminToken()) carregarAdmin();
  }
});

// Compatibilidade com o HTML antigo (chamadas inline)
function mostrarExtratoAntigo() { mostrarExtrato(); }

