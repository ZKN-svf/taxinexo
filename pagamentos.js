// ============================================================
// TAXINEXO — SigiloPay via Cloudflare Worker (contrato igual ao InvestMax)
// ============================================================

const SIGILOPAY_CONFIG = {
  baseURL: 'https://investmax-proxy.gabrielrobin63.workers.dev/api'
};

// Webhook exclusivo do Taxinexo — credita o saldo no Firebase.
// O proxy do InvestMax apenas loga o webhook (não credita) e bloqueia polling (429).
const WEBHOOK_URL = 'https://taxinexo-webhook.gabrielrobin63.workers.dev/';

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
        callbackUrl: WEBHOOK_URL
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

function detectarTipoPix(chave) {
  const limpa = String(chave).replace(/\D/g, '');
  if (limpa.length === 11 && /^\d+$/.test(limpa)) return 'CPF';
  if (limpa.length === 14 && /^\d+$/.test(limpa)) return 'CNPJ';
  if (chave.includes('@')) return 'email';
  if (limpa.length === 11 || limpa.length === 13) return 'phone';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) return 'random';
  return 'email';
}

window.SigiloPay = {
  criarCobrancaPIX,
  consultarPagamento,
  criarTransferencia,
  consultarSaldo,
  gerarIdentifier,
  detectarTipoPix,
  CONFIG: SIGILOPAY_CONFIG
};
