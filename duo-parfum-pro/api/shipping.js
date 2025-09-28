const BASE_COST = 16.9;
const COST_PER_ITEM = 2.4;
const COST_PER_WEIGHT_UNIT = 1.8;
const INSURANCE_RATE = 0.018;
const MIN_COST = 14;

const ORIGIN = {
  city: "Sorriso",
  state: "MT",
  cep: "78890000",
};
const ORIGIN_PREFIX = Number(ORIGIN.cep.replace(/\D/g, "").slice(0, 3)) || 0;

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      return {};
    }
  }
  return body;
}

function sanitizeCep(value = "") {
  return value.toString().replace(/\D/g, "").slice(0, 8);
}

function parseMl(value) {
  if (!value) return 0;
  const match = value.toString().match(/(\d+[\d,.]*)/);
  if (!match) return 0;
  const normalized = match[1].replace(/\./g, "").replace(/,/g, ".");
  const ml = Number(normalized);
  return Number.isFinite(ml) && ml > 0 ? ml : 0;
}

function computeWeightFactor(items = []) {
  return items.reduce((acc, item) => {
    const qty = Math.max(1, Number(item?.qty) || 1);
    const ml = parseMl(item?.ml);
    const baseWeight = ml ? ml / 50 : 1;
    return acc + baseWeight * qty;
  }, 0);
}

function estimateDistanceFactor(cep) {
  if (!cep || cep.length < 3) return 0;
  const prefix = Number(cep.slice(0, 3));
  if (!Number.isFinite(prefix)) return 0;
  const diff = Math.abs(prefix - ORIGIN_PREFIX);
  return Math.max(0, diff / 80);
}

function buildResponse({ cep, items, subtotal }) {
  const itemCount = items.reduce((acc, item) => acc + Math.max(1, Number(item?.qty) || 1), 0);
  const weightFactor = computeWeightFactor(items);
  const distanceFactor = estimateDistanceFactor(cep);
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  const insurance = Math.min(20, safeSubtotal * INSURANCE_RATE);

  const rawCost =
    BASE_COST +
    itemCount * COST_PER_ITEM +
    weightFactor * COST_PER_WEIGHT_UNIT +
    distanceFactor * 4.2 +
    insurance;

  const cost = Math.max(MIN_COST, Math.round(rawCost * 100) / 100);
  const minDays = Math.max(3, Math.round(3 + distanceFactor));
  const maxDays = minDays + 2;
  const deliveryEstimate = `${minDays} a ${maxDays} dias úteis`;

  return {
    method: "correios",
    service: "PAC",
    cost,
    currency: "BRL",
    deliveryEstimate,
    deliveryDays: { min: minDays, max: maxDays },
    calculatedAt: new Date().toISOString(),
    origin: { ...ORIGIN },
    originLabel: `${ORIGIN.city} - ${ORIGIN.state}`,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }

  const payload = parseBody(req.body);
  const cep = sanitizeCep(payload?.cep || payload?.zip || "");
  if (!cep || cep.length !== 8) {
    return res.status(400).json({ error: "CEP inválido para cálculo de frete" });
  }

  const items = Array.isArray(payload?.items) ? payload.items.filter(Boolean) : [];
  if (!items.length) {
    return res.status(400).json({ error: "Nenhum item informado para cálculo de frete" });
  }

  const subtotalValue = Number(payload?.subtotal);
  const subtotal = Number.isFinite(subtotalValue)
    ? subtotalValue
    : items.reduce((sum, item) => {
        const price = Number(item?.price) || 0;
        const qty = Math.max(1, Number(item?.qty) || 1);
        return sum + price * qty;
      }, 0);

  try {
    const result = buildResponse({ cep, items, subtotal });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Erro ao calcular frete:", err);
    return res.status(500).json({ error: "Não foi possível calcular o frete" });
  }
};
