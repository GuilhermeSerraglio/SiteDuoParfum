# Duo Parfum PRO (MVP brand-alinhado)

- Visual refinado com paleta blush/marrom baseada na sua logo.
- Logo aplicada em favicon, topo e hero.
- Catálogo + carrinho + checkout WhatsApp + Admin (Firestore).
- Pronto para Vercel.

## Passos
1. Firebase Web App → copie o config para `firebase-init.js` (ou ajuste `window.firebaseConfig`).
2. Ajuste `ADMIN_EMAILS` conforme os administradores da loja.
3. Firestore: coleção `products`. Regras iniciais iguais ao pacote anterior.
4. Configure as variáveis `MP_ACCESS_TOKEN`, `MP_PAYER_EMAIL` (opcional) e `MP_NOTIFICATION_URL` (opcional) na Vercel para gerar pagamentos.
5. Deploy na Vercel (arraste esta pasta).

Gerado em 2025-08-10
