// ============================================================
// TAXINEXO — NexasPay via Worker próprio (relay compartilhado com a ZKNbet,
// mas nenhum arquivo da ZKNbet é alterado — é só o mesmo proxy de IP fixo).
// ============================================================

const SIGILOPAY_CONFIG = {
  baseURL: 'https://taxinexo-webhook.gabrielrobin63.workers.dev'
};

// Webhook Nexas — o Worker confirma o status na API antes de creditar.
const WEBHOOK_URL = 'https://taxinexo-webhook.gabrielrobin63.workers.dev/webhook/nexaspay';

function gerarIdentifier() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function criarCobrancaPIX(valor, descricao, emailPagador, idUsuario) {
  try {
    const identifier = gerarIdentifier();
    const response = await fetch(SIGILOPAY_CONFIG.baseURL + '/pix/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseFloat(parseFloat(valor).toFixed(2)),
        identifier,
        callbackUrl: WEBHOOK_URL,
        idUsuario: idUsuario || '',
        nome: (() => { try { return JSON.parse(localStorage.getItem('usuario_taxinexo') || '{}').nome || ''; } catch (_) { return ''; } })(),
        cpf: (() => { try { return JSON.parse(localStorage.getItem('usuario_taxinexo') || '{}').cpf || ''; } catch (_) { return ''; } })()
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('[SigiloPay] erro cobranca:', data);
      return { sucesso: false, mensagem: data.message || data.erro || 'Erro ao gerar cobrança' };
    }
    return {
      sucesso: true,
      transaction_id: data.transactionId,
      identifier,
      status: data.status,
      order_id: data.order && data.order.id,
      qr_code_copia_cola: data.pix && data.pix.code,
      // A API as vezes devolve base64 vazio; geramos a imagem via QR server
      qr_code_image: (data.pix && data.pix.image) ||
        (data.pix && data.pix.code
          ? 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=' + encodeURIComponent(data.pix.code)
          : null),
      qr_code_base64: data.pix && data.pix.base64,
      expires_at: data.pix && data.pix.expiresAt,
      valor
    };
  } catch (erro) {
    console.error('[SigiloPay] erro de rede:', erro);
    return { sucesso: false, mensagem: 'Erro de conexão com o servidor' };
  }
}

async function consultarPagamento(identifier) {
  try {
    const response = await fetch(SIGILOPAY_CONFIG.baseURL + '/pix/status/' + encodeURIComponent(identifier));
    if (!response.ok) return { sucesso: false, pago: false };
    const data = await response.json();
    const pago = ['COMPLETED', 'PAID', 'APPROVED', 'OK'].includes(String(data.transactionStatus || '').toUpperCase()) ||
      ['PAID', 'APPROVED', 'OK'].includes(String(data.status || '').toUpperCase()) || data.paid === true;
    return { sucesso: true, status: data.status, transaction_status: data.transactionStatus, pago };
  } catch (erro) {
    return { sucesso: false, pago: false };
  }
}

async function criarTransferencia(valor, chavePix, dadosProprietario, idUsuario) {
  try {
    const identifier = 'SAQUE_' + gerarIdentifier();
    const response = await fetch(SIGILOPAY_CONFIG.baseURL + '/pix/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier,
        amount: parseFloat(parseFloat(valor).toFixed(2)),
        discountFeeOfReceiver: true,
        pix: { key: chavePix, type: detectarTipoPix(chavePix) },
        owner: {
          name: dadosProprietario.nome,
          document: String(dadosProprietario.cpf || '').replace(/\D/g, '')
        },
        callbackUrl: WEBHOOK_URL
      })
    });
    const data = await response.json();
    if (!response.ok) {
      return { sucesso: false, mensagem: data.message || data.erro || 'Erro ao criar transferência' };
    }
    return {
      sucesso: true,
      withdraw_id: data.withdraw && data.withdraw.id,
      status: data.withdraw && data.withdraw.status,
      valor: data.withdraw && data.withdraw.amount,
      taxa: data.withdraw && data.withdraw.feeAmount,
      receipt_url: data.receiptUrl
    };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro de conexão com o servidor' };
  }
}

async function consultarSaldo() {
  try {
    const response = await fetch(SIGILOPAY_CONFIG.baseURL + '/saldo');
    if (!response.ok) return { sucesso: false, available: 0 };
    const data = await response.json();
    return {
      sucesso: true,
      available: parseFloat(data.available || 0),
      pending: parseFloat(data.pending || 0),
      fundLock: parseFloat(data.fundLock || 0)
    };
  } catch (erro) {
    return { sucesso: false, available: 0 };
  }
}

// Valida dígitos verificadores para distinguir CPF/CNPJ de telefone
function cpfValido(valor) {
  const c = String(valor).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d = (s * 10) % 11; if (d === 10) d = 0;
  if (d !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  d = (s * 10) % 11; if (d === 10) d = 0;
  return d === Number(c[10]);
}

function cnpjValido(valor) {
  const c = String(valor).replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (pesos) => {
    let s = 0;
    for (let i = 0; i < pesos.length; i++) s += Number(c[i]) * pesos[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc([5,4,3,2,9,8,7,6,5,4,3,2]) === Number(c[12]) &&
         calc([6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(c[13]);
}

// Chaves Pix aceitas: CPF, CNPJ, e-mail, telefone e chave aleatória (EVP).
// Retorna o tipo no formato esperado pelo Worker/Nexas.
function validarChavePix(chave) {
  const raw = String(chave || '').trim();
  const limpa = raw.replace(/\D/g, '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { valida: true, tipo: 'email', descricao: 'E-mail' };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return { valida: true, tipo: 'random', descricao: 'Chave aleatória' };
  }
  if (/^\d+$/.test(limpa)) {
    if (limpa.length === 11 && cpfValido(limpa)) return { valida: true, tipo: 'CPF', descricao: 'CPF' };
    if (limpa.length === 14 && cnpjValido(limpa)) return { valida: true, tipo: 'CNPJ', descricao: 'CNPJ' };
    if (limpa.length >= 10 && limpa.length <= 13) return { valida: true, tipo: 'phone', descricao: 'Celular/telefone' };
  }
  return { valida: false, tipo: '', descricao: '' };
}

function detectarTipoPix(chave) {
  return validarChavePix(chave).tipo || 'email';
}

window.SigiloPay = {
  criarCobrancaPIX,
  consultarPagamento,
  criarTransferencia,
  consultarSaldo,
  gerarIdentifier,
  detectarTipoPix,
  validarChavePix,
  cpfValido,
  cnpjValido,
  CONFIG: SIGILOPAY_CONFIG
};
