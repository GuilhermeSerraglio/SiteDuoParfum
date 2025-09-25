# Duo Parfum PRO (MVP brand-alinhado)

- Visual refinado com paleta blush/marrom baseada na sua logo.
- Logo aplicada em favicon, topo e hero.
- Catálogo + carrinho + checkout WhatsApp + Admin (Firestore).
- Pronto para Vercel.

## Passos
1. Firebase Web App → defina as chaves públicas nas variáveis da Vercel `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_AUTH_DOMAIN`, `FIREBASE_WEB_PROJECT_ID`, `FIREBASE_WEB_STORAGE_BUCKET`, `FIREBASE_WEB_MESSAGING_SENDER_ID`, `FIREBASE_WEB_APP_ID` (e opcionalmente `FIREBASE_WEB_MEASUREMENT_ID`). Essas variáveis abastecem automaticamente o `/admin` e mantêm o mesmo projeto do backend. Sem elas, o painel exibirá um alerta de "Configuração do Firebase não encontrada" e não conseguirá autenticar.

2. Ajuste `ADMIN_EMAILS` conforme os administradores da loja (para este deploy inclua `guilhermeserraglio03@gmail.com` e mantenha `guilhermeserraglio@gmail.com` como acesso auxiliar, se desejar).
=======
 c
2. Ajuste `ADMIN_EMAILS` conforme os administradores da loja (para este deploy inclua `guilhermeserraglio03@gmail.com` e mantenha `guilhermeserraglio@gmail.com` como acesso auxiliar, se desejar).


2. Ajuste `ADMIN_EMAILS` conforme os administradores da loja (para este deploy inclua `guilhermeserraglio03@gmail.com`).
=======
 
2. Ajuste `ADMIN_EMAILS` conforme os administradores da loja (para este deploy inclua `guilhermeserraglio03@gmail.com`).
======= Ajuste `ADMIN_EMAILS` conforme os administradores da loja.



3. Firestore: coleção `products`. Regras iniciais iguais ao pacote anterior.
4. Configure as credenciais do Firebase Admin na Vercel (mesmo projeto utilizado no passo 1) para que o painel consiga salvar/editar produtos. Você pode usar **uma** das opções abaixo:
   - `FIREBASE_SERVICE_ACCOUNT`: JSON completo do serviço (cole o conteúdo do arquivo gerado pelo Firebase).
   - `FIREBASE_SERVICE_ACCOUNT_BASE64`: mesmo JSON acima, porém convertido para Base64.
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` separados (no caso da chave privada, substitua as quebras de linha por `\n`).
5. Configure as variáveis `MP_ACCESS_TOKEN`, `MP_PAYER_EMAIL` (opcional) e `MP_NOTIFICATION_URL` (opcional) na Vercel para gerar pagamentos.
6. Deploy na Vercel (arraste esta pasta).

Gerado em 2025-08-10
