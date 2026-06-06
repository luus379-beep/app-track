const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const UTMIFY_TOKEN = "lD6r1vykqX1xZND6mzx0n0TAmV1ghFEwZv7Z";
const UTMIFY_URL = "https://club.segredosdoads.com.br/utmify.ashx";

// { telefone -> { nome, telefone, clica_id, utm_*, pagamentos: [{valor, data}], recebido_em } }
const leads = {};
const logs = [];

function addLog(tipo, msg, detalhe) {
  logs.unshift({ tipo, msg, detalhe: detalhe || null, hora: new Date().toISOString() });
  if (logs.length > 200) logs.pop();
}

function fmtPhone(raw) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8)}`;
  return `+${d}`;
}

// ── POST /webhook/lead ──────────────────────────────────────
app.post("/webhook/lead", (req, res) => {
  const b = req.body;
  const tel = (b.phone || b.telefone || b.payer_phone || "").toString().replace(/\D/g, "");
  if (!tel) {
    addLog("erro", "Lead sem telefone", JSON.stringify(b).slice(0,120));
    return res.status(400).json({ ok: false, erro: "telefone obrigatório" });
  }

  const nome = (b.name || b.nome || "").toString().trim().split(" ")[0] || null;

  if (!leads[tel]) {
    leads[tel] = {
      telefone: tel,
      nome,
      clica_id:     b.clica_id    || b.clickid   || null,
      utm_source:   b.utm_source   || null,
      utm_campaign: b.utm_campaign || null,
      utm_medium:   b.utm_medium   || null,
      pagamentos:   [],
      recebido_em:  new Date().toISOString(),
    };
    addLog("lead", `Lead salvo: ${fmtPhone(tel)}`, `clica_id: ${leads[tel].clica_id}`);
  } else {
    if (nome && !leads[tel].nome) leads[tel].nome = nome;
    addLog("info", `Lead já existente: ${fmtPhone(tel)}`, "dados mantidos");
  }

  return res.json({ ok: true, mensagem: "Lead salvo", telefone: tel });
});

// ── POST /webhook/pix ───────────────────────────────────────
app.post("/webhook/pix", async (req, res) => {
  const b = req.body;
  const status = (b.status || "").toLowerCase();
  const tel = (b.payer_phone || "").toString().replace(/\D/g, "");
  const valor = b.amount || 0;

  const aprovado = ["approved","paid","transaction.approved","transaction.paid"].includes(status);
  if (!aprovado) {
    addLog("info", `Pix ignorado — status: ${status}`, null);
    return res.json({ ok: true, mensagem: `Status '${status}' ignorado` });
  }

  if (!tel) {
    addLog("erro", "Pix sem payer_phone", JSON.stringify(b).slice(0,120));
    return res.status(400).json({ ok: false, erro: "payer_phone ausente" });
  }

  const lead = leads[tel];
  if (!lead) {
    addLog("erro", `Lead não encontrado: ${fmtPhone(tel)}`, null);
    return res.status(404).json({ ok: false, erro: "Lead não encontrado para esse telefone" });
  }

  lead.pagamentos.push({ valor, data: new Date().toISOString() });

  const params = new URLSearchParams({
    phone: tel,
    priceincents: valor,
    name: "Assinatura_Trimestral",
    token: UTMIFY_TOKEN,
  });

  try {
    const resp = await axios.get(`${UTMIFY_URL}?${params.toString()}`);
    const nPag = lead.pagamentos.length;
    addLog("sucesso",
      `Conversão enviada: ${fmtPhone(tel)}`,
      `R$ ${(valor/100).toFixed(2)} (${nPag}º pagamento)`
    );
    return res.json({ ok: true, pagamentos: nPag, utmify: resp.data });
  } catch (err) {
    addLog("erro", `Falha UTMify: ${fmtPhone(tel)}`, err.message);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── GET /api/data ────────────────────────────────────────────
app.get("/api/data", (req, res) => {
  const { de, ate } = req.query;
  const from = de  ? new Date(de  + "T00:00:00") : null;
  const to   = ate ? new Date(ate + "T23:59:59") : null;

  const lista = Object.values(leads).filter(l => {
    if (!from) return true;
    const d = new Date(l.recebido_em);
    return d >= from && (!to || d <= to);
  });

  const naoPagos   = lista.filter(l => l.pagamentos.length === 0);
  const pagos      = lista.filter(l => l.pagamentos.length === 1);
  const recorrentes = lista.filter(l => l.pagamentos.length > 1);

  const totalReceita = lista.reduce((s, l) => s + l.pagamentos.reduce((a, p) => a + p.valor, 0), 0);

  const logsFiltered = from
    ? logs.filter(l => { const d = new Date(l.hora); return d >= from && (!to || d <= to); })
    : logs;

  res.json({
    total: lista.length,
    naoPagos: naoPagos.length,
    pagos: pagos.length,
    recorrentes: recorrentes.length,
    totalReceita,
    listas: { naoPagos, pagos, recorrentes },
    logs: logsFiltered.slice(0, 100),
  });
});

// ── GET / — Dashboard ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Track</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f1117;--sb:#161b27;--sf:#1a2035;--sf2:#1f2740;--bd:#2a3450;--tx:#e8eaf0;--mu:#7b8db0;--ac:#4f7fff;--gr:#22c97a;--am:#f59e0b;--re:#ef4444;--pu:#a78bfa}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--tx);display:flex;min-height:100vh;font-size:14px}
aside{width:220px;background:var(--sb);border-right:1px solid var(--bd);display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh}
.brand{padding:1.5rem 1.25rem 1rem;border-bottom:1px solid var(--bd)}
.bi{width:36px;height:36px;border-radius:10px;background:var(--ac);display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:8px}
.bn{font-size:15px;font-weight:600}.bs{font-size:11px;color:var(--mu);margin-top:2px}
nav{padding:1rem .75rem;flex:1}
.ni{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--mu);font-size:13px;font-weight:500;transition:all .15s;margin-bottom:2px}
.ni:hover{background:var(--sf);color:var(--tx)}
.ni.on{background:rgba(79,127,255,.15);color:var(--ac)}
.nicon{font-size:16px;width:20px;text-align:center}
.sbf{padding:1rem 1.25rem;border-top:1px solid var(--bd);display:flex;align-items:center;gap:8px}
.sdot{width:8px;height:8px;border-radius:50%;background:var(--gr);box-shadow:0 0 6px var(--gr)}
.stx{font-size:11px;color:var(--mu)}
main{margin-left:220px;flex:1;padding:2rem;overflow-y:auto;min-height:100vh}
.page{display:none}.page.on{display:block}
.prow{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.5rem}
.ptitle{font-size:22px;font-weight:600}
.psub{font-size:13px;color:var(--mu);margin-top:3px}

/* CAL */
.calw{position:relative}
.calb{display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--bd);border-radius:8px;background:var(--sf);cursor:pointer;font-size:12px;color:var(--mu);transition:all .15s;white-space:nowrap}
.calb:hover{border-color:var(--ac);color:var(--ac)}
.calb svg{width:14px;height:14px;flex-shrink:0}
.caldd{display:none;position:absolute;right:0;top:calc(100% + 6px);background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:6px;min-width:200px;z-index:99}
.caldd.open{display:block}
.calopt{padding:7px 12px;font-size:12px;color:var(--mu);border-radius:6px;cursor:pointer;transition:background .1s}
.calopt:hover{background:var(--sf2);color:var(--tx)}
.calopt.on{background:rgba(79,127,255,.15);color:var(--ac)}
.caldiv{height:1px;background:var(--bd);margin:5px 0}
.calcustom{padding:6px 12px;display:flex;flex-direction:column;gap:5px}
.calcustom label{font-size:11px;color:var(--mu)}
.calcustom input{font-size:12px;padding:5px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--sf2);color:var(--tx);width:100%}
.calapply{font-size:11px;padding:5px 10px;border:1px solid var(--ac);border-radius:6px;background:rgba(79,127,255,.15);color:var(--ac);cursor:pointer;text-align:center;margin-top:2px}
.calapply:hover{background:rgba(79,127,255,.25)}

/* CARDS */
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:1.25rem;display:flex;align-items:center;justify-content:space-between}
.clbl{font-size:12px;color:var(--mu);margin-bottom:5px}
.cval{font-size:24px;font-weight:600}
.cicon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}
.ci-b{background:rgba(79,127,255,.12);color:var(--ac)}
.ci-g{background:rgba(34,201,122,.12);color:var(--gr)}
.ci-a{background:rgba(245,158,11,.12);color:var(--am)}
.ci-p{background:rgba(167,139,250,.12);color:var(--pu)}

/* RECEITA */
.rec-panel{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;display:flex;align-items:baseline;gap:10px}
.rec-val{font-size:36px;font-weight:600;color:var(--pu)}
.rec-lbl{font-size:13px;color:var(--mu)}

/* COLS */
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
.col{background:var(--sf);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
.colh{padding:.75rem 1rem;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between}
.colt{font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}
.colc{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px}
.cc-gr{background:rgba(34,201,122,.15);color:var(--gr)}
.cc-am{background:rgba(245,158,11,.15);color:var(--am)}
.cc-pu{background:rgba(167,139,250,.15);color:var(--pu)}
.colb{padding:8px;display:flex;flex-direction:column;gap:6px;min-height:60px}
.lrow{background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between}
.lname{font-size:13px;font-weight:500;color:var(--tx)}
.lphone{font-family:monospace;font-size:11px;color:var(--mu);margin-top:2px}
.lval{font-size:13px;font-weight:600;white-space:nowrap}
.lval.mu{color:var(--mu);font-weight:400}
.lval.pu{color:var(--pu)}
.colf{padding:7px 1rem;border-top:1px solid var(--bd);display:flex;justify-content:space-between;font-size:11px;color:var(--mu)}
.colf strong{color:var(--tx);font-weight:600}
.empty{font-size:12px;color:var(--mu);text-align:center;padding:20px 0}

/* LOGS */
.lpanel{background:var(--sf);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
.lbody{padding:1rem}
.logrow{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--bd)}
.logrow:last-child{border-bottom:none}
.ldot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px}
.ld-s{background:var(--gr)}.ld-l{background:var(--ac)}.ld-e{background:var(--re)}.ld-i{background:var(--mu)}
.lmsg{font-size:13px;color:var(--tx)}
.ldet{font-size:11px;color:var(--mu);margin-top:2px}

/* INT */
.icard{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:1.25rem;margin-bottom:1rem}
.ititle{font-size:14px;font-weight:600;margin-bottom:3px}
.isub{font-size:12px;color:var(--mu);margin-bottom:.75rem}
.urow{display:flex;align-items:center;gap:8px}
.meth{font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;background:rgba(79,127,255,.15);color:var(--ac);flex-shrink:0}
.ubox{font-family:monospace;font-size:12px;background:var(--sf2);border:1px solid var(--bd);border-radius:7px;padding:8px 12px;flex:1;color:var(--mu);word-break:break-all}
.cbtn{background:none;border:1px solid var(--bd);border-radius:7px;padding:6px 12px;color:var(--mu);font-size:12px;cursor:pointer;white-space:nowrap;transition:all .15s}
.cbtn:hover{border-color:var(--ac);color:var(--ac)}
</style>
</head>
<body>
<aside>
  <div class="brand">
    <div class="bi">📡</div>
    <div class="bn">App Track</div>
    <div class="bs">Rastreamento de leads</div>
  </div>
  <nav>
    <div class="ni on" onclick="show('dash',this)"><span class="nicon">🏠</span> Dashboard</div>
    <div class="ni" onclick="show('leads',this)"><span class="nicon">👥</span> Leads</div>
    <div class="ni" onclick="show('logs',this)"><span class="nicon">📋</span> Eventos</div>
    <div class="ni" onclick="show('int',this)"><span class="nicon">🔗</span> Integrações</div>
  </nav>
  <div class="sbf"><div class="sdot"></div><span class="stx">online</span></div>
</aside>

<main>

  <!-- DASHBOARD -->
  <div class="page on" id="p-dash">
    <div class="prow">
      <div><div class="ptitle">Dashboard</div><div class="psub">Visão geral do rastreamento</div></div>
      <div class="calw" id="cw-dash"><button class="calb" onclick="toggleCal('cw-dash')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span id="lbl-dash">Todos</span></button><div class="caldd" id="dd-dash"></div></div>
    </div>
    <div class="cards">
      <div class="card"><div><div class="clbl">Total de leads</div><div class="cval" id="d-tot" style="color:var(--ac)">0</div></div><div class="cicon ci-b">👥</div></div>
      <div class="card"><div><div class="clbl">Não pagos</div><div class="cval" id="d-np" style="color:var(--am)">0</div></div><div class="cicon ci-a">⏳</div></div>
      <div class="card"><div><div class="clbl">Pagos</div><div class="cval" id="d-pg" style="color:var(--gr)">0</div></div><div class="cicon ci-g">✅</div></div>
      <div class="card"><div><div class="clbl">Recorrentes</div><div class="cval" id="d-rc" style="color:var(--pu)">0</div></div><div class="cicon ci-p">🔁</div></div>
    </div>
    <div class="rec-panel"><div class="rec-val" id="d-receita">R$ 0,00</div><div class="rec-lbl">receita total no período</div></div>
  </div>

  <!-- LEADS -->
  <div class="page" id="p-leads">
    <div class="prow">
      <div><div class="ptitle">Leads</div><div class="psub">Por status de pagamento</div></div>
      <div class="calw" id="cw-leads"><button class="calb" onclick="toggleCal('cw-leads')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span id="lbl-leads">Todos</span></button><div class="caldd" id="dd-leads"></div></div>
    </div>
    <div class="cols">
      <div class="col">
        <div class="colh"><div class="colt" style="color:var(--am)">⏳ Não pagos</div><span class="colc cc-am" id="cnt-np">0</span></div>
        <div class="colb" id="col-np"><div class="empty">Nenhum lead</div></div>
        <div class="colf"><span id="ft-np">0 leads</span><strong>R$ 0,00</strong></div>
      </div>
      <div class="col">
        <div class="colh"><div class="colt" style="color:var(--gr)">✅ Pagos</div><span class="colc cc-gr" id="cnt-pg">0</span></div>
        <div class="colb" id="col-pg"><div class="empty">Nenhum lead</div></div>
        <div class="colf"><span id="ft-pg">0 leads</span><strong id="tot-pg">R$ 0,00</strong></div>
      </div>
      <div class="col">
        <div class="colh"><div class="colt" style="color:var(--pu)">🔁 Recorrentes</div><span class="colc cc-pu" id="cnt-rc">0</span></div>
        <div class="colb" id="col-rc"><div class="empty">Nenhum lead</div></div>
        <div class="colf"><span id="ft-rc">0 leads</span><strong id="tot-rc" style="color:var(--pu)">R$ 0,00</strong></div>
      </div>
    </div>
  </div>

  <!-- LOGS -->
  <div class="page" id="p-logs">
    <div class="prow">
      <div><div class="ptitle">Eventos</div><div class="psub">Histórico de ações</div></div>
      <div class="calw" id="cw-logs"><button class="calb" onclick="toggleCal('cw-logs')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span id="lbl-logs">Todos</span></button><div class="caldd" id="dd-logs"></div></div>
    </div>
    <div class="lpanel"><div class="lbody" id="logs-body"><div class="empty">Nenhum evento ainda</div></div></div>
  </div>

  <!-- INTEGRAÇÕES -->
  <div class="page" id="p-int">
    <div class="prow"><div><div class="ptitle">Integrações</div><div class="psub">URLs dos webhooks</div></div></div>
    <div class="icard">
      <div class="ititle">📥 Webhook de lead</div>
      <div class="isub">Cole na plataforma que gera o lead. Campos: phone, name, clica_id, utm_source, utm_campaign, utm_medium</div>
      <div class="urow"><span class="meth">POST</span><span class="ubox" id="url-lead"></span><button class="cbtn" onclick="cp(this,document.getElementById('url-lead').textContent)">Copiar</button></div>
    </div>
    <div class="icard">
      <div class="ititle">💸 Webhook de Pix (DePix)</div>
      <div class="isub">Cole dentro da DePix. O sistema busca o lead pelo payer_phone e dispara para UTMify automaticamente ao receber status approved/paid.</div>
      <div class="urow"><span class="meth">POST</span><span class="ubox" id="url-pix"></span><button class="cbtn" onclick="cp(this,document.getElementById('url-pix').textContent)">Copiar</button></div>
    </div>
    <div class="icard">
      <div class="ititle">🎯 UTMify — disparo automático</div>
      <div class="isub">Disparado automaticamente ao confirmar Pix. Token configurado no servidor.</div>
      <div class="urow"><span class="meth">GET</span><span class="ubox">https://club.segredosdoads.com.br/utmify.ashx?phone={tel}&priceincents={val}&name=Assinatura_Trimestral&token=••••••</span></div>
    </div>
  </div>

</main>

<script>
const PERIODS = [
  {id:'all',  label:'Todos'},
  {id:'hoje', label:'Hoje'},
  {id:'ontem',label:'Ontem'},
  {id:'h_o',  label:'Hoje e ontem'},
  {id:'7d',   label:'Últimos 7 dias'},
  {id:'30d',  label:'Últimos 30 dias'},
  {id:'mes',  label:'Este mês'},
];
const calState = {dash:{id:'all'},leads:{id:'all'},logs:{id:'all'}};

function getDates(state) {
  const now = new Date();
  const ymd = d => d.toISOString().slice(0,10);
  const today = ymd(now);
  const yest  = ymd(new Date(now - 86400000));
  if (state.id === 'all')   return {};
  if (state.id === 'hoje')  return {de:today, ate:today};
  if (state.id === 'ontem') return {de:yest,  ate:yest};
  if (state.id === 'h_o')   return {de:yest,  ate:today};
  if (state.id === '7d') {
    const d = new Date(now - 6*86400000);
    return {de:ymd(d), ate:today};
  }
  if (state.id === '30d') {
    const d = new Date(now - 29*86400000);
    return {de:ymd(d), ate:today};
  }
  if (state.id === 'mes') {
    return {de: today.slice(0,7)+'-01', ate:today};
  }
  if (state.id === 'custom') return {de:state.d1||'', ate:state.d2||state.d1||''};
  return {};
}

function buildDD(page) {
  const dd = document.getElementById('dd-'+page);
  const st = calState[page];
  let h = '';
  PERIODS.forEach(p => {
    h += \`<div class="calopt\${st.id===p.id?' on':''}" onclick="selPeriod('\${page}','\${p.id}','\${p.label}')">\${p.label}</div>\`;
  });
  h += \`<div class="caldiv"></div>
  <div class="calcustom">
    <label>Período personalizado</label>
    <input type="date" id="d1-\${page}">
    <input type="date" id="d2-\${page}" style="margin-top:4px">
    <div class="calapply" onclick="applyCustom('\${page}')">Aplicar</div>
  </div>\`;
  dd.innerHTML = h;
}

function toggleCal(id) {
  const page = id.replace('cw-','');
  const dd = document.getElementById('dd-'+page);
  const open = dd.classList.contains('open');
  document.querySelectorAll('.caldd').forEach(d => d.classList.remove('open'));
  if (!open) { buildDD(page); dd.classList.add('open'); }
}

function selPeriod(page, id, label) {
  calState[page] = {id};
  document.getElementById('lbl-'+page).textContent = label;
  document.getElementById('dd-'+page).classList.remove('open');
  load(page);
}

function applyCustom(page) {
  const d1 = document.getElementById('d1-'+page).value;
  const d2 = document.getElementById('d2-'+page).value;
  if (!d1) return;
  const fmt = s => { const [y,m,d] = s.split('-'); return d+'/'+m; };
  const label = d2 && d2 !== d1 ? fmt(d1)+' – '+fmt(d2) : fmt(d1);
  calState[page] = {id:'custom', d1, d2: d2||d1};
  document.getElementById('lbl-'+page).textContent = label;
  document.getElementById('dd-'+page).classList.remove('open');
  load(page);
}

document.addEventListener('click', e => {
  if (!e.target.closest('.calw')) document.querySelectorAll('.caldd').forEach(d=>d.classList.remove('open'));
});

function fmtMoney(cents) {
  return 'R$ ' + (cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2});
}

function fmtHora(iso) {
  return new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function leadRow(l, tipo) {
  const nome = l.nome || '—';
  const tel = l.telefone;
  const ftel = tel.length>=13
    ? \`+\${tel.slice(0,2)} \${tel.slice(2,4)} \${tel.slice(4,9)}-\${tel.slice(9)}\`
    : \`+\${tel}\`;
  const total = l.pagamentos.reduce((s,p)=>s+p.valor,0);
  const valHtml = tipo==='np'
    ? \`<span class="lval mu">—</span>\`
    : tipo==='rc'
      ? \`<div style="text-align:right"><div class="lval pu">\${fmtMoney(total)}</div><div style="font-size:10px;color:var(--mu);\${l.pagamentos.length} pag.</div></div>\`
      : \`<span class="lval">\${fmtMoney(total)}</span>\`;
  return \`<div class="lrow"><div><div class="lname">\${nome}</div><div class="lphone">\${ftel}</div></div>\${valHtml}</div>\`;
}

async function load(page) {
  const dates = getDates(calState[page] || {id:'all'});
  const qs = new URLSearchParams(dates).toString();
  const r = await fetch('/api/data' + (qs?'?'+qs:''));
  const d = await r.json();

  if (page === 'dash') {
    document.getElementById('d-tot').textContent = d.total;
    document.getElementById('d-np').textContent  = d.naoPagos;
    document.getElementById('d-pg').textContent  = d.pagos;
    document.getElementById('d-rc').textContent  = d.recorrentes;
    document.getElementById('d-receita').textContent = fmtMoney(d.totalReceita);
  }

  if (page === 'leads') {
    const np = d.listas.naoPagos, pg = d.listas.pagos, rc = d.listas.recorrentes;
    document.getElementById('cnt-np').textContent = np.length;
    document.getElementById('cnt-pg').textContent = pg.length;
    document.getElementById('cnt-rc').textContent = rc.length;
    document.getElementById('ft-np').textContent  = np.length + ' lead' + (np.length!==1?'s':'');
    document.getElementById('ft-pg').textContent  = pg.length + ' lead' + (pg.length!==1?'s':'');
    document.getElementById('ft-rc').textContent  = rc.length + ' lead' + (rc.length!==1?'s':'');
    const totPg = pg.reduce((s,l)=>s+l.pagamentos.reduce((a,p)=>a+p.valor,0),0);
    const totRc = rc.reduce((s,l)=>s+l.pagamentos.reduce((a,p)=>a+p.valor,0),0);
    document.getElementById('tot-pg').textContent = fmtMoney(totPg);
    document.getElementById('tot-rc').textContent = fmtMoney(totRc);
    document.getElementById('col-np').innerHTML = np.length ? np.map(l=>leadRow(l,'np')).join('') : '<div class="empty">Nenhum lead</div>';
    document.getElementById('col-pg').innerHTML = pg.length ? pg.map(l=>leadRow(l,'pg')).join('') : '<div class="empty">Nenhum lead</div>';
    document.getElementById('col-rc').innerHTML = rc.length ? rc.map(l=>leadRow(l,'rc')).join('') : '<div class="empty">Nenhum lead</div>';
  }

  if (page === 'logs') {
    const lb = document.getElementById('logs-body');
    if (!d.logs.length) { lb.innerHTML = '<div class="empty">Nenhum evento ainda</div>'; return; }
    lb.innerHTML = d.logs.map(l => \`<div class="logrow">
      <div class="ldot ld-\${l.tipo}"></div>
      <div><div class="lmsg">\${l.msg}</div>
      \${l.detalhe?'<div class="ldet">'+l.detalhe+'</div>':''}
      <div class="ldet">\${fmtHora(l.hora)}</div></div>
    </div>\`).join('');
  }
}

function show(id, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  document.getElementById('p-'+id).classList.add('on');
  el.classList.add('on');
  if (id !== 'int') load(id);
}

function cp(btn, txt) {
  navigator.clipboard.writeText(txt);
  btn.textContent = 'Copiado!';
  setTimeout(()=>btn.textContent='Copiar',1500);
}

// URLs
const base = window.location.origin;
document.getElementById('url-lead').textContent = base + '/webhook/lead';
document.getElementById('url-pix').textContent  = base + '/webhook/pix';

load('dash');
setInterval(()=>{ const on = document.querySelector('.page.on'); if(on) load(on.id.replace('p-','')); }, 15000);
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log("✅ App Track rodando na porta " + PORT));
