const { parseStringPromise } = require("xml2js");
const { getAccessToken } = require("./melhorenvio-auth");

const ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
};

const ORIGIN_LABEL = `${ORIGIN.city} - ${ORIGIN.state}`;

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

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

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
  const billedWeight = Math.min(MAX_WEIGHT_KG, Math.max(MIN_BILLABLE_WEIGHT_KG, physicalWeight));

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

/**
 * -----------------------------
 * Melhor Envio integração
 * -----------------------------
 */
function resolveApiBase() {
  const explicit = sanitizeString(process.env.MELHOR_ENVIO_API_URL);
  if (explicit) return explicit;
  const env = sanitizeString(process.env.MELHOR_ENVIO_ENV || process.env.MELHOR_ENVIO_MODE).toLowerCase();
  if (env === "production" || env === "prod") {
    return "https://www.melhorenvio.com.br/api/v2";
  }
  return "https://sandbox.melhorenvio.com.br/api/v2";
}

function loadSenderConfig() {
  try {
    const rawJson = sanitizeString(
      process.env.MELHOR_ENVIO_SENDER_JSON ||
        process.env.MELHOR_ENVIO_FROM_JSON ||
        process.env.MELHOR_ENVIO_SENDER ||
        ""
    );
    if (rawJson) return JSON.parse(rawJson);
  } catch {}
  return {
    name: sanitizeString(process.env.MELHOR_ENVIO_FROM_NAME || "Duo Parfum"),
    phone: sanitizeString(process.env.MELHOR_ENVIO_FROM_PHONE),
    email: sanitizeString(process.env.MELHOR_ENVIO_FROM_EMAIL || ""),
    document: sanitizeString(process.env.MELHOR_ENVIO_FROM_DOCUMENT),
    postal_code: sanitizeCep(process.env.MELHOR_ENVIO_FROM_CEP || ORIGIN.cep),
    address: sanitizeString(process.env.MELHOR_ENVIO_FROM_ADDRESS),
    number: sanitizeString(process.env.MELHOR_ENVIO_FROM_NUMBER),
    district: sanitizeString(process.env.MELHOR_ENVIO_FROM_DISTRICT),
    city: sanitizeString(process.env.MELHOR_ENVIO_FROM_CITY || ORIGIN.city),
    state_abbr: sanitizeString(process.env.MELHOR_ENVIO_FROM_STATE || ORIGIN.state),
    country: "BR",
  };
}

function buildMelhorEnvioConfig() {
  return {
    baseUrl: resolveApiBase(),
    userAgent: "SiteDuoParfum/1.0",
    sender: loadSenderConfig(),
  };
}

async function melhorEnvioRequest(config, path, { method = "GET", body } = {}) {
  const token = await getAccessToken();
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
  const response = await fetchFn(url, { method, headers, body });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!response.ok) throw new Error(data?.message || `Erro Melhor Envio ${response.status}`);
  return data;
}

function resolveServiceId(serviceCode) {
  if (serviceCode === "04014")
    return process.env.MELHOR_ENVIO_SERVICE_SEDEX || null;
  if (serviceCode === "04510")
    return process.env.MELHOR_ENVIO_SERVICE_PAC || null;
  return null;
}

async function calculateMelhorEnvioShipping({ destinationCep, items, metrics }) {
  const config = buildMelhorEnvioConfig();
  const sender = config.sender;
  const servicesToRequest = CORREIOS_SERVICES.map((s) => ({
    ...s,
    melhorEnvioId: resolveServiceId(s.code),
  })).filter((s) => s.melhorEnvioId);

  if (!servicesToRequest.length) throw new Error("Serviços não configurados no Melhor Envio");

  const shipments = servicesToRequest.map((s) => ({
    service: s.melhorEnvioId,
    from: { postal_code: sender.postal_code },
    to: { postal_code: destinationCep },
    volumes: [
      {
        height: PACKAGE_DIMENSIONS.altura,
        width: PACKAGE_DIMENSIONS.largura,
        length: PACKAGE_DIMENSIONS.comprimento,
        weight: metrics.billedWeightKg,
      },
    ],
    products: items.map((i) => ({
      name: i.name || "Produto",
      quantity: i.qty || 1,
      unitary_value: i.price || 0,
    })),
    options: { insurance_value: metrics.subtotal, receipt: false, own_hand: false },
  }));

  const response = await melhorEnvioRequest(config, "/me/shipment/calculate", {
    method: "POST",
    body: shipments,
  });

  return {
    provider: "melhorenvio",
    services: response.map((r) => ({
      method: "melhorenvio",
      name: r.name,
      serviceCode: r.service_id,
      cost: parseFloat(r.price),
      deliveryEstimate: r.delivery_range?.text || "",
      deliveryDays: r.delivery_range || null,
      error: r.error || null,
    })),
  };
}

/**
 * -----------------------------
 * Correios fallback
 * -----------------------------
 */
function parseCorreiosPrice(value) {
  if (typeof value !== "string") return NaN;
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function parseCorreiosPrazo(value) {
  const prazo = parseInt(value, 10);
  return Number.isFinite(prazo) ? prazo : null;
}

function formatDeliveryEstimate(prazo) {
  return prazo ? `${prazo} dias úteis` : "Prazo informado no ato da postagem";
}

async function requestCorreiosQuoteForService({ service, destinationCep, billedWeightKg, declaredValue }) {
  const params = new URLSearchParams({
    nCdServico: service.code,
    sCepOrigem: ORIGIN.cep,
    sCepDestino: destinationCep,
    nVlPeso: billedWeightKg.toFixed(2),
    nCdFormato: PACKAGE_DIMENSIONS.formato,
    nVlComprimento: PACKAGE_DIMENSIONS.comprimento,
    nVlAltura: PACKAGE_DIMENSIONS.altura,
    nVlLargura: PACKAGE_DIMENSIONS.largura,
    nVlDiametro: PACKAGE_DIMENSIONS.diametro,
    nVlValorDeclarado: formatDeclaredValueBR(declaredValue),
    StrRetorno: "json",
  });
  const url = `https://ws.correios.com.br/calculador/CalcPrecoPrazo.asmx/CalcPrecoPrazo?${params}`;
  const res = await fetchFn(url);
  const data = await res.json();
  const servico = data.Servicos.cServico[0];
  if (servico.Erro && servico.Erro !== "0") throw new Error(servico.MsgErro);
  return {
    method: "correios",
    name: service.name,
    serviceCode: service.code,
    cost: parseCorreiosPrice(servico.Valor),
    currency: "BRL",
    deliveryEstimate: formatDeliveryEstimate(parseCorreiosPrazo(servico.PrazoEntrega)),
    deliveryDays: { min: parseInt(servico.PrazoEntrega, 10), max: parseInt(servico.PrazoEntrega, 10) },
    error: null,
  };
}

async function calculateCorreiosShipping({ cep, items, subtotal, metrics }) {
  const services = [];
  for (const service of CORREIOS_SERVICES) {
    try {
      const quote = await requestCorreiosQuoteForService({
        service,
        destinationCep: cep,
        billedWeightKg: metrics.billedWeightKg,
        declaredValue: subtotal,
      });
      services.push(quote);
    } catch (err) {
      services.push({ ...service, error: err.message });
    }
  }
  return { provider: "correios", services };
}

/**
 * -----------------------------
 * Handler principal
 * -----------------------------
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const payload = parseBody(req.body);
  const cep = sanitizeCep(payload?.cep || "");
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const subtotal = Number(payload?.subtotal);
  const metrics = computeCartMetrics(items, subtotal);

  try {
    let result;
    try {
      result = await calculateMelhorEnvioShipping({ destinationCep: cep, items, metrics });
    } catch (err) {
      console.error("Erro Melhor Envio:", err.message);
      result = await calculateCorreiosShipping({ cep, items, subtotal, metrics });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
