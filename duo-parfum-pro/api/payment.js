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
      const qty =
        Number.isFinite(qtyValue) && qtyValue > 0
          ? Math.floor(qtyValue) || 1
          : 1;
      const price =
        Number.isFinite(priceValue) && priceValue > 0 ? priceValue : 0;
      const title =
        [raw?.name, raw?.ml].filter(Boolean).join(" ").trim() ||
        "Produto Duo Parfum";
      return {
        title,
        quantity: qty,
        currency_id: "BRL",
        unit_price: Math.round(price * 100) / 100,
      };
    })
    .filter((item) => item.unit_price > 0 && item.quantity > 0);
}

// ----------------- Funções auxiliares de cliente -----------------

function sanitizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildFallbackEmail(orderId) {
  const base = String(orderId || Date.now())
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const slug = base ? base.slice(0, 16) : String(Date.now());
  return `pagador+${slug}@duoparfum.com`;
}

function splitName(name) {
  const parts =
    typeof name === "string"
      ? name.trim().split(/\s+/).filter(Boolean)
      : [];
  if (!parts.length) {
    return { firstName: "Cliente", lastName: "Duo Parfum" };
  }
  const firstName = parts.shift();
  const lastName = parts.join(" ") || "Duo Parfum";
  return { firstName, lastName };
}

// ----------------- Função para enviar ao Mercado Pago -----------------

async function postToMercadoPago(path, token, payload, extraHeaders = {}) {
  const url = `${MP_API_BASE}${path}`;
  const body = JSON.stringify(payload);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (typeof fetch === "function") {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }

    if (!response.ok) {
      const message =
        (data && (data.message || data.error)) ||
        `Mercado Pago HTTP ${response.status}`;
      const error = new Error(message);
      error.details = data;
      error.status = response.status;
      throw error;
    }

    return data;
  }

  // fallback usando https.request caso fetch não esteja disponível
  const { hostname, pathname, search } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: `${pathname}${search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
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
                return reject(
                  new Error("Resposta inválida do Mercado Pago")
                );
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

// ----------------- Handler principal -----------------

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

    const paymentType = String(order.customer?.payment || "pix").toLowerCase();
    const rawName =
      typeof order.customer?.name === "string" ? order.customer.name : "";
    const customerName = rawName.trim() || "Cliente Duo Parfum";
    const { firstName, lastName } = splitName(customerName);
    const requestedEmail = sanitizeEmail(order.customer?.email);
    const configuredEmail = sanitizeEmail(process.env.MP_PAYER_EMAIL);
    const fallbackEmail = isValidEmail(configuredEmail)
      ? configuredEmail
      : buildFallbackEmail(orderId);
    const customerEmail = isValidEmail(requestedEmail)
      ? requestedEmail
      : fallbackEmail;
    const notificationUrl = process.env.MP_NOTIFICATION_URL;
    const origin =
      req.headers?.origin ||
      process.env.SITE_URL ||
      "https://site-duo-parfum.vercel.app";

    // -------- PIX --------
    if (paymentType === "pix") {
      const pixPayload = {
        transaction_amount: Math.round(total * 100) / 100,
        description: `Pedido ${orderId}`,
        payment_method_id: "pix",
        payer: {
          email: customerEmail,
          first_name: firstName,
          last_name: lastName,
        },
        external_reference: orderId,
        binary_mode: true,
        metadata: { orderId },
      };

      if (items.length) {
        pixPayload.additional_info = {
          items: items.map((item) => ({
            title: item.title,
            quantity: item.quantity,
            unit_price: item.unit_price,
          })),
        };
      }

      if (notificationUrl) {
        pixPayload.notification_url = notificationUrl;
      }

      const pix = await postToMercadoPago("/v1/payments", token, pixPayload, {
        "X-Idempotency-Key": orderId,
      });
      const tx = pix?.point_of_interaction?.transaction_data;

      if (!tx?.qr_code || !tx?.qr_code_base64) {
        throw new Error("Resposta PIX inválida do Mercado Pago");
      }

      return res
        .status(200)
        .json({ qr: tx.qr_code_base64, code: tx.qr_code });
    }

    // -------- Checkout padrão --------
    const preferencePayload = {
      items,
      external_reference: orderId,
      auto_return: "approved",
      binary_mode: true,
      metadata: { orderId },
      payer: {
        name: customerName,
        email: customerEmail,
      },
      payment_methods: {
        excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
      },
      back_urls: {
        success: `${origin}/sucesso`,
        failure: `${origin}/erro`,
      },
    };

    if (notificationUrl) {
      preferencePayload.notification_url = notificationUrl;
    }

    const preference = await postToMercadoPago(
      "/checkout/preferences",
      token,
      preferencePayload
    );
    const link = preference.init_point || preference.sandbox_init_point;

    if (!link) {
      throw new Error("Link de pagamento não retornado pelo Mercado Pago");
    }

    return res.status(200).json({ link });
  } catch (err) {
    console.error("Erro Mercado Pago:", err);
    return res.status(500).json({ error: "Falha ao criar pagamento" });
  }
};
