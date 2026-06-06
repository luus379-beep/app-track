const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const UTMIFY_TOKEN = "lD6r1vykqX1xZND6mzx0n0TAmV1ghFEwZv7Z";
const UTMIFY_URL = "https://club.segredosdoads.com.br/utmify.ashx";

// Armazenamento em memória (simples, sem banco de dados)
// Chave: telefone (somente dígitos), Valor: dados do lead
const leads = {};

// ─────────────────────────────────────────
// POST /webhook/lead
// Recebe lead da plataforma (Kiwify, Hotmart, etc.)
// ─────────────────────────────────────────
app.post("/webhook/lead", (req, res) => {
  const body = req.body;

  // Pega o telefone e limpa para somente dígitos
  const telefone = (body.phone || body.telefone || body.payer_phone || "")
    .toString()
    .replace(/\D/g, "");

  const clica_id    = body.clica_id    || body.clickid   || null;
  const utm_source   = body.utm_source   || null;
  const utm_campaign = body.utm_campaign || null;
  const utm_medium   = body.utm_medium   || null;
  const utm_content  = body.utm_content  || null;
  const utm_term     = body.utm_term     || null;

  if (!telefone) {
    console.log("[LEAD] Recebido sem telefone — ignorado", body);
    return res.status(400).json({ ok: false, erro: "telefone obrigatório" });
  }

  leads[telefone] = {
    telefone,
    clica_id,
    utm_source,
    utm_campaign,
    utm_medium,
    utm_content,
    utm_term,
    recebido_em: new Date().toISOString(),
  };

  console.log(`[LEAD] Salvo: ${telefone}`, leads[telefone]);
  return res.json({ ok: true, mensagem: "Lead salvo com sucesso", telefone });
});

// ─────────────────────────────────────────
// POST /webhook/pix
// Recebe confirmação de pagamento da DePix
// ─────────────────────────────────────────
app.post("/webhook/pix", async (req, res) => {
  const body = req.body;

  const status = body.status || "";
  const telefone = (body.payer_phone || "").toString().replace(/\D/g, "");
  // Valor em centavos — DePix manda `amount` em centavos
  const valor_centavos = body.amount || 0;

  console.log(`[PIX] Recebido — status: ${status} | telefone: ${telefone} | valor: ${valor_centavos}`);

  // Só processa pagamentos aprovados/pagos
  if (!["approved", "paid", "transaction.approved", "transaction.paid"].includes(status)) {
    console.log(`[PIX] Status '${status}' ignorado`);
    return res.json({ ok: true, mensagem: `Status '${status}' ignorado` });
  }

  if (!telefone) {
    console.log("[PIX] Sem telefone no payload — não é possível localizar o lead");
    return res.status(400).json({ ok: false, erro: "payer_phone ausente no webhook" });
  }

  const lead = leads[telefone];

  if (!lead) {
    console.log(`[PIX] Lead não encontrado para o telefone ${telefone}`);
    return res.status(404).json({ ok: false, erro: "Lead não encontrado para esse telefone" });
  }

  // Monta URL da UTMify
  const params = new URLSearchParams({
    phone:         telefone,
    priceincents:  valor_centavos,
    name:          "Assinatura_Trimestral",
    token:         UTMIFY_TOKEN,
  });

  const url = `${UTMIFY_URL}?${params.toString()}`;

  try {
    const resposta = await axios.get(url);
    console.log(`[UTMify] Disparado com sucesso para ${telefone}`, resposta.data);
    return res.json({ ok: true, mensagem: "Conversão enviada para UTMify", utmify: resposta.data });
  } catch (err) {
    console.error("[UTMify] Erro ao disparar:", err.message);
    return res.status(500).json({ ok: false, erro: "Falha ao enviar para UTMify", detalhe: err.message });
  }
});

// ─────────────────────────────────────────
// GET / — painel simples de status
// ─────────────────────────────────────────
app.get("/", (req, res) => {
  const total = Object.keys(leads).length;
  res.json({
    status: "online",
    leads_armazenados: total,
    endpoints: {
      receber_lead: "POST /webhook/lead",
      receber_pix:  "POST /webhook/pix",
    },
  });
});

// GET /leads — lista todos os leads (útil pra debug)
app.get("/leads", (req, res) => {
  res.json({ total: Object.keys(leads).length, leads });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
