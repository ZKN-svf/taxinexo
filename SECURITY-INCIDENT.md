# Incidente de segurança — migração para D1 (concluída)

## Estado atual

- Site: **online** em https://velostercapital.pages.dev
- Dados: **Cloudflare D1** (`veloster-db`), acessível apenas pelo Worker.
- Firebase: **removido do código** e os dados antigos de `/taxinexo` foram **apagados** do RTDB.
- Worker: `taxinexo-webhook` com autenticação de sessão e endpoints protegidos.
- Admin: login via Worker (`/api/admin/login`), sessão assinada, sem senha no banco.
- Senhas de usuários: **PBKDF2-SHA256 (100.000 iterações)**; hashes legados são migrados no primeiro login.
- Backup pré-migração: `C:\Users\ZKN\Desktop\taxinexo-backup-incidente-2026-11-27T00-43-48-818Z.json`
- Backup D1 (SQL): `C:\Users\ZKN\Desktop\veloster-d1-backup-2026-11-26T22-56-44.sql`
- Backup do Firebase: o namespace `/taxinexo` foi apagado após a migração; os arquivos acima são a cópia de segurança.

## O que foi corrigido

1. Todo acesso ao banco passa pelo Worker (`/db` e `/api`), com autorização por sessão.
2. Leitura de `usuarios` agora é:
   - própria conta para usuários;
   - completa apenas para admin;
   - `senha_hash` e `google_sub` nunca são devolvidos ao frontend.
3. `/api/comprar`, `/api/saque`, `/api/indicados`, `/api/metas/resgatar`, `/api/bonus/resgatar`,
   `/api/deposito/status` e `/pix/deposit` exigem sessão válida.
4. `/pix/transfer`, `/saldo`, `/logs`, `/status`, `/api/estorno` e `/api/auditoria/duplicadas`
   exigem sessão de admin.
5. Marketing (`upload`, `list`, `delete`, `PATCH`) exige sessão de admin.
6. O token de marketing antigo foi removido; o login admin emite sessão HMAC de 4h.
7. O hash reversível `h_..._base64` foi eliminado do frontend; o Worker usa PBKDF2.
8. O saque passou a ser server-side: valida bloqueio, saldo, limite diário, debita, chama o gateway
   e estorna automaticamente se o gateway falhar.
9. Bônus e metas são creditados no Worker, com claim atômico para evitar resgate duplo.
10. O Firebase RTDB foi esvaziado (`/taxinexo` não existe mais).

## Ação manual recomendada (Firebase)

As regras do RTDB ainda estão abertas, mas o namespace está vazio. Para encerrar de vez:

1. Abra https://console.firebase.google.com/project/zkn-ss/database/zkn-ss-default-rtdb/rules
2. Publique `firebase-rules-emergency.json`:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

Alternativa: exclua a instância do Realtime Database no console.

## Trocar a senha admin

O login usa o secret `ADMIN_PASSWORD_HASH` (PBKDF2). Para trocar:

1. Gere um novo hash PBKDF2-SHA256 com 100.000 iterações.
2. Rode: `npx wrangler secret put ADMIN_PASSWORD_HASH`
3. Cole o hash (`pbkdf2$100000$...`) e faça um novo deploy do Worker.

A senha atual foi definida pelo responsável e não deve ser registrada no repositório. **Recomendação forte:** usar uma senha longa e aleatória, pois a anterior foi exposta e a atual trafegou por terminal/conversa.

## Pendências de segurança

1. **Forçar reset de senha dos usuários existentes.** Os hashes antigos (`h_...`) ficaram expostos
   antes da migração. A migração para PBKDF2 acontece no próximo login, mas quem já copiou os
   hashes pode tentar reverter. O ideal é invalidar as senhas e exigir nova definição.
2. **Rotacionar credenciais do gateway/relay** (Nexas) e quaisquer secrets que tenham sido expostos.
3. **Revisar logs/acessos** do período em que o banco esteve aberto.
4. **Backups com PII**: os arquivos `taxinexo-backup-*.json` no Desktop contêm dados pessoais.
   Guarde em local seguro ou apague após a conferência.
5. **Turnstile** continua no login/cadastro. As ações financeiras agora usam sessão; se quiser,
   adicione Turnstile também em compra/saque como defesa extra.

## Como restaurar a manutenção de emergência

- Site: criar `_worker.js` com resposta 503 e rodar
  `npx wrangler pages deploy . --project-name velostercapital --branch main`.
- Worker: definir `MAINTENANCE = "1"` em `wrangler.toml` e rodar `npx wrangler deploy`.

## Arquitetura

```
Pages (estático)
   │  Authorization: Bearer <sessão>
   ▼
Worker taxinexo-webhook
   ├── /api/*  (login, cadastro, compra, saque, bônus, metas, admin)
   ├── /db/*   (leitura própria/admin; escrita apenas admin)
   └── D1 veloster-db (kv: árvore JSON versionada com CAS)
```
