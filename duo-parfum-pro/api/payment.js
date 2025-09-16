// api/payment.js
import { MercadoPagoConfig, Preference } from "mercadopago";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { orderId, order } = req.body;

    if (!orderId || !order) {
      return res.status(400).json({ error: "Pedido inválido" });
    }

    // Configura Mercado Pago com Access Token das variáveis de ambiente
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

    const items = order.items.map(i => ({
      title: `${i.name} ${i.ml || ""}`,
      quantity: i.qty,
      currency_id: "BRL",
      unit_price: i.price
    }));

    const preference = new Preference(client);

    const pref = await preference.create({
      body: {
        items,
        external_reference: orderId,
        back_urls: {
          success: "https://SEU-SITE.com/sucesso",
          failure: "https://SEU-SITE.com/erro"
        },
        auto_return: "approved",
        payment_methods: {
          excluded_payment_types: order.customer.payment === "pix"
            ? [{ id: "credit_card" }]
            : [{ id: "ticket" }]
        }
      }
    });

    if (order.customer.payment === "pix") {
      // Para PIX → QRCode + código copia e cola
      return res.status(200).json({
        qr: pref.response.point_of_interaction.transaction_data.qr_code_base64,
        code: pref.response.point_of_interaction.transaction_data.qr_code
      });
    } else {
      // Para Cartão → link de pagamento
      return res.status(200).json({
        link: pref.response.init_point
      });
    }

  } catch (err) {
    console.error("Erro Mercado Pago:", err);
    return res.status(500).json({ error: "Falha ao criar pagamento" });
  }
}
