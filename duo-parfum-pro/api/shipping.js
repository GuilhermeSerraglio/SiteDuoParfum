/**
 * Endpoint de cálculo de frete.
 *
 * Pré-requisitos de ambiente (Vercel):
 * - MELHOR_ENVIO_ENV ("sandbox" ou "production")
 * - MELHOR_ENVIO_CLIENT_ID / MELHOR_ENVIO_CLIENT_SECRET
 * - MELHOR_ENVIO_SERVICE_PAC / MELHOR_ENVIO_SERVICE_SEDEX
 * - MELHOR_ENVIO_USER_AGENT (ex.: "SiteDuoParfum/1.0")
 * - Dados do remetente (MELHOR_ENVIO_FROM_* ou MELHOR_ENVIO_SENDER_JSON)
 * - Credenciais do Firebase Admin (FIREBASE_SERVICE_ACCOUNT ou equivalentes)
 * - Opcional: MELHOR_ENVIO_API_URL para forçar base URL
 */
const { parseStringPromise } = require("xml2js");
const { getAccessToken } = require("./melhorenvio-auth");

// Configuração de origem
const ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
};
const ORIGIN_LABEL = `${ORIGIN.city} - ${ORIGIN.state}`;

// Serviços Correios
const CORREIOS_SERVICES = [
  { key: "pac", code: "04510", name: "PAC" },
  { key: "sedex", code: "04014", name: "SEDEX" },
];

const DEFAULT_SERVICE_KEY = "pac";
const MAX_DECLARED_VALUE = 10000;
const MAX_WEIGHT_KG = 30;
const MIN_PHYSICAL_WEIGHT_KG = 0.1;
const MIN_BILLABLE_WEIGHT_KG = 0.3;
const PACKAGE_BUFFER_WEIGHT_KG = 0.05;
const ITEM_WEIGHT_KG = 0.045;

const PACKAGE_DIMENSIONS = {
  formato: "1",
  comprimento: 16,
  altura: 2,
  largura: 11,
  diametro: 0,
};

function getFetch() {
  if (typeof fetch === "function") return fetch.bind(globalThis);
  const fetchModule = require("node-fetch");
  return (fetchModule && fetchModule.default) || fetchModule;
}
const fetchFn = getFetch();

// ---------------- Utils ----------------
function sanitizeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}
function sanitizeCep(value = "") {
  return value.toString().replace(/\D/g, "").slice(0, 8);
}
function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function roundKg(value) {
  return Math.round(value * 1000) / 1000;
}
function computeCartMetrics(items = [], explicitSubtotal) {
  let quantity = 0;
  let subtotal = 0;

  items.forEach((rawItem) => {
    const qty = Math.max(1, toNumber(rawItem?.qty, 1));
    quantity += qty;
    const price = Math.max(0, toNumber(rawItem?.price, 0));
    subtotal += price * qty;
  });

  if (Number.isFinite(explicitSubtotal)) {
    subtotal = Math.max(subtotal, explicitSubtotal);
  }

  const physicalWeight = Math.min(
    MAX_WEIGHT_KG,
    Math.max(MIN_PHYSICAL_WEIGHT_KG, quantity * ITEM_WEIGHT_KG + PACKAGE_BUFFER_WEIGHT_KG)
  );
  const billedWeight = Math.min(
    MAX_WEIGHT_KG,
    Math.max(MIN_BILLABLE_WEIGHT_KG, physicalWeight)
  );

  return {
    quantity,
    subtotal: Math.round(subtotal * 100) / 100,
    physicalWeightKg: roundKg(physicalWeight),
    billedWeightKg: roundKg(billedWeight),
  };
}
function formatDeclaredValueBR(value) {
  const safe = Math.min(MAX_DECLARED_VALUE, Math.max(0, Math.round(value * 100) / 100));
  return safe.toFixed(2).replace(".", ",");
}

// ---------------- Melhor Envio ----------------
function resolveApiBase() {
  const explicit = sanitizeString(process.env.MELHOR_ENVIO_API_URL);
  if (explicit) return explicit;

  const env = sanitizeString(process.env.MELHOR_ENVIO_ENV || "sandbox").toLowerCase();
  return env === "production"
    ? "https://www.melhorenvio.com.br/api/v2"
    : "https://sandbox.melhorenvio.com.br/api/v2";
}
function buildMelhorEnvioConfig() {
  return {
    baseUrl: resolveApiBase(),
    userAgent: sanitizeString(process.env.MELHOR_ENVIO_USER_AGENT || "SiteDuoParfum/1.0"),
  };
}
async function melhorEnvioRequest(config, path, { method = "GET", body } = {}) {
  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    throw new Error("Falha ao autenticar no Melhor Envio: " + err.message);
  }
  const url = `${config.baseUrl}${path}`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": config.userAgent,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetchFn(url, { method, headers, body });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Melhor Envio HTTP ${res.status}`);
  }
  return data;
}
async function calculateMelhorEnvioShipping({ destinationCep, items, metrics }) {
  const config = buildMelhorEnvioConfig();
  const shipments = CORREIOS_SERVICES.map((service) => ({
    service: process.env[`MELHOR_ENVIO_SERVICE_${service.code}`],
    from: { postal_code: ORIGIN.cep, country: "BR" },
    to: { postal_code: destinationCep, country: "BR" },
    products: items.map((i, idx) => ({
      name: sanitizeString(i?.name || `Produto ${idx + 1}`),
      quantity: Math.max(1, toNumber(i?.qty, 1)),
      unitary_value: toNumber(i?.price, 0),
    })),
    volumes: [{
      height: PACKAGE_DIMENSIONS.altura,
      width: PACKAGE_DIMENSIONS.largura,
      length: PACKAGE_DIMENSIONS.comprimento,
      weight: metrics.billedWeightKg,
    }],
    options: {
      receipt: false,
      own_hand: false,
      reverse: false,
      collect: false,
      non_commercial: true,
      insurance_value: metrics.subtotal,
    }
  }));
  return await melhorEnvioRequest(config, "/me/shipment/calculate", {
    method: "POST", body: shipments
  });
}

// ---------------- Correios ----------------
function buildCorreiosUrl({ serviceCode, destinationCep, weightKg, declaredValue }) {
  const params = new URLSearchParams({
    nCdEmpresa: "",
    sDsSenha: "",
    nCdServico: serviceCode,
    sCepOrigem: ORIGIN.cep,
    sCepDestino: destinationCep,
    nVlPeso: weightKg.toFixed(2),
    nCdFormato: PACKAGE_DIMENSIONS.formato,
    nVlComprimento: PACKAGE_DIMENSIONS.comprimento.toFixed(1),
    nVlAltura: PACKAGE_DIMENSIONS.altura.toFixed(1),
    nVlLargura: PACKAGE_DIMENSIONS.largura.toFixed(1),
    nVlDiametro: PACKAGE_DIMENSIONS.diametro.toFixed(1),
    sCdMaoPropria: "N",
    nVlValorDeclarado: formatDeclaredValueBR(declaredValue),
    sCdAvisoRecebimento: "N",
    StrRetorno: "json",
  });
  return `https://ws.correios.com.br/calculador/CalcPrecoPrazo.asmx/CalcPrecoPrazo?${params}`;
}
async function requestCorreiosQuote(service, destinationCep, billedWeightKg, declaredValue) {
  const url = buildCorreiosUrl({ serviceCode: service.code, destinationCep, weightKg: billedWeightKg, declaredValue });
  const res = await fetchFn(url);
  const text = await res.text();
  const xml = await parseStringPromise(text, { explicitArray: false, ignoreAttrs: true });
  const servico = xml?.Servicos?.cServico;
  return {
    method: "correios",
    provider: "correios",
    name: service.name,
    serviceCode: service.code,
    cost: Number(servico?.Valor?.replace(",", ".")) || null,
    currency: "BRL",
    deliveryEstimate: `${servico?.PrazoEntrega || ""} dias úteis`,
    deliveryDays: { min: Number(servico?.PrazoEntrega), max: Number(servico?.PrazoEntrega) },
    calculatedAt: new Date().toISOString(),
    error: null,
  };
}

// ---------------- Handler ----------------
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const cep = sanitizeCep(req.body?.cep);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const subtotal = Number(req.body?.subtotal) || 0;

    if (!cep || !items.length) {
      return res.status(400).json({ error: "CEP ou itens inválidos" });
    }

    const metrics = computeCartMetrics(items, subtotal);

    // Tenta Melhor Envio primeiro
    try {
      const quotes = await calculateMelhorEnvioShipping({ destinationCep: cep, items, metrics });
      return res.status(200).json({ provider: "melhorenvio", quotes });
    } catch (err) {
      console.error("Erro Melhor Envio:", err.message);
    }

    // Fallback Correios
    const results = [];
    for (const service of CORREIOS_SERVICES) {
      try {
        const q = await requestCorreiosQuote(service, cep, metrics.billedWeightKg, metrics.subtotal);
        results.push(q);
      } catch (err) {
        results.push({ service: service.name, error: err.message });
      }
    }

    return res.status(200).json({
      provider: "correios",
      origin: ORIGIN,
      originLabel: ORIGIN_LABEL,
      destinationCep: cep,
      services: results,
      calculatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Erro interno em /api/shipping:", err);
    return res.status(500).json({ error: "Falha interna ao calcular frete" });
  }
};
