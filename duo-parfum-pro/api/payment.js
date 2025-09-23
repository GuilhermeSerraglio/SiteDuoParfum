const https = require("https");
const { URL } = require("url");

const MP_API_BASE = "https://api.mercadopago.com";

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      console.error("Falha ao interpretar corpo da requisição:", err);
      return {};
    }
  }
  return body;
}

function buildItems(items = []) {
  return items
    .filter(Boolean)
    .map((raw) => {
      const qtyValue = Number(raw?.qty ?? 1);
      const priceValue = Number(raw?.price ?? 0);
      const qty = Number.isFinite(qtyValue) && qtyValue > 0 ? Math.floor(qtyValue) || 1 : 1;
      const price = Number.isFinite(priceValue) && priceValue > 0 ? priceValue : 0;
      const title = [raw?.name, raw?.ml].filter(Boolean).join(" ").trim() || "Produto Duo Parfum";
      return {
        title,
        quantity: qty,
        currency_id: "BRL",
        unit_price: Math.round(price * 100) / 100
      };
    })
    .filter((item) => item.unit_price > 0 && item.quantity > 0);
}

async function postToMercadoPago(path, token, payload) {
  const url = `${MP_API_BASE}${path}`;
  const body = JSON.stringify(payload);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  if (typeof fetch === "function") {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body
    });

    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }

    if (!response.ok) {
      const message =
        (data && (data.message || data.error)) || `Mercado Pago HTTP ${response.status}`;
      const error = new Error(message);
      error.details = data;
      error.status = response.status;
      throw error;
    }

    return data;
  }

  const { hostname, pathname, search } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: `${pathname}${search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data = null;
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch (err) {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                return reject(new Error("Resposta inválida do Mercado Pago"));
              }
            }
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message =
              (data && (data.message || data.error)) ||
              `Mercado Pago HTTP ${res.statusCode}`;
            const error = new Error(message);
            error.details = data;
            error.status = res.statusCode;
            return reject(error);
          }

          resolve(data);
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const payload = parseBody(req.body);
    const { orderId, order } = payload;

    if (!orderId || !order) {
      return res.status(400).json({ error: "Pedido inválido" });
    }

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      console.error("MP_ACCESS_TOKEN não configurado no ambiente");
      return res.status(500).json({ error: "Configuração de pagamento ausente" });
    }

    const items = buildItems(order.items);
    if (!items.length) {
      return res.status(400).json({ error: "Pedido sem itens" });
    }

    const total = Number(order.total ?? 0);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "Total inválido" });
    }

    const paymentType = order.customer?.payment || "pix";
    const customerName = order.customer?.name?.trim() || "Cliente Duo Parfum";
    const notificationUrl = process.env.MP_NOTIFICATION_URL;
    const origin =
      req.headers?.origin || process.env.SITE_URL || "https://site-duo-parfum.vercel.app";

    if (paymentType === "pix") {
      const pixPayload = {
        transaction_amount: Math.round(total * 100) / 100,
        description: `Pedido ${orderId}`,
        payment_method_id: "pix",
        payer: {
          email: process.env.MP_PAYER_EMAIL || "pagador@duoparfum.com",
          first_name: customerName
        },
        external_reference: orderId
      };

      if (notificationUrl) {
        pixPayload.notification_url = notificationUrl;
      }

      const pix = await postToMercadoPago("/v1/payments", token, pixPayload);
      const tx = pix?.point_of_interaction?.transaction_data;

      if (!tx?.qr_code || !tx?.qr_code_base64) {
        throw new Error("Resposta PIX inválida do Mercado Pago");
      }

      return res.status(200).json({ qr: tx.qr_code_base64, code: tx.qr_code });
    }

    const preferencePayload = {
      items,
      external_reference: orderId,
      auto_return: "approved",
      payment_methods: {
        excluded_payment_types: [
          { id: "ticket" },
          { id: "atm" }
        ]
      },
      back_urls: {
        success: `${origin}/sucesso`,
        failure: `${origin}/erro`
      }
    };

    if (notificationUrl) {
      preferencePayload.notification_url = notificationUrl;
    }

    const preference = await postToMercadoPago("/checkout/preferences", token, preferencePayload);
    const link = preference.init_point || preference.sandbox_init_point;

    if (!link) {
      throw new Error("Link de pagamento não retornado pelo Mercado Pago");
    }

    return res.status(200).json({ link });
  } catch (err) {
    console.error("Erro Mercado Pago:", err);
    return res.status(500).json({ error: "Falha ao criar pagamento" });
  }
}
