const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const UTMIFY_TOKEN = "lD6r1vykqX1xZND6mzx0n0TAmV1ghFEwZv7Z";
const UTMIFY_URL = "https://club.segredosdoads.com.br/utmify.ashx";

const leads = {};
const logs = [];

function addLog(tipo, msg, detalhe) {
  logs.unshift({ tipo, msg, detalhe: detalhe || null, hora: new Date().toISOString() });
  if (logs.length > 100) logs.pop();
}

app.post("/webhook/lead", (req, res) => {
  const body = req.body;
  const telefone = (body.phone || body.telefone || body.payer_phone || "").toString().replace(/\D/g, "");
  const clica_id     = body.clica_id    || body.clickid   || null;
  const utm_source   = body.utm_source   || null;
  const utm_campaign = body.utm_campaign || null;
  const utm_medium   = body.utm_medium   || null;
  const nome         = body.name || body.nome || null;

  if (!telefone) {
    addLog("erro", "Lead recebido sem telefone", JSON.stringify(body));
    return res.status(400).json({ ok: false, erro: "telefone obrigatório" });
  }

  leads[telefone] = { telefone, nome, clica_id, utm_source, utm_campaign, utm_medium, status: "aguardando_pix", valor: 0, recebido_em: new Date().toISOString() };
  addLog("lead", `Lead salvo: ${telefone}`, `clica_id: ${clica_id}`);
  return res.json({ ok: true, mensagem: "Lead salvo", telefone });
});

app.post("/webhook/pix", async (req, res) => {
  const body = req.body;
  const status = body.status || "";
  const telefone = (body.payer_phone || "").toString().replace(/\D/g, "");
  const valor_centavos = body.amount || 0;

  if (!["approved", "paid", "transaction.approved", "transaction.paid"].includes(status)) {
    addLog("info", `Pix ignorado — status: ${status}`, null);
    return res.json({ ok: true, mensagem: `Status ignorado` });
  }
  if (!telefone) {
    addLog("erro", "Pix sem telefone", JSON.stringify(body));
    return res.status(400).json({ ok: false, erro: "payer_phone ausente" });
  }

  const lead = leads[telefone];
  if (!lead) {
    addLog("erro", `Lead não encontrado: ${telefone}`, null);
    return res.status(404).json({ ok: false, erro: "Lead não encontrado" });
  }

  const params = new URLSearchParams({ phone: telefone, priceincents: valor_centavos, name: "Assinatura_Trimestral", token: UTMIFY_TOKEN });
  try {
    const resposta = await axios.get(`${UTMIFY_URL}?${params.toString()}`);
    leads[telefone].status = "convertido";
    leads[telefone].valor = valor_centavos;
    leads[telefone].convertido_em = new Date().toISOString();
    addLog("sucesso", `Conversão enviada: ${telefone}`, `R$ ${(valor_centavos/100).toFixed(2)}`);
    return res.json({ ok: true, utmify: resposta.data });
  } catch (err) {
    addLog("erro", `Falha UTMify: ${telefone}`, err.message);
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get("/api/data", (req, res) => {
  const lista = Object.values(leads);
  const convertidos = lista.filter(l => l.status === "convertido").length;
  const aguardando  = lista.filter(l => l.status === "aguardando_pix").length;
  const receita     = lista.reduce((s, l) => s + (l.valor || 0), 0);
  res.json({ total: lista.length, convertidos, aguardando, receita, leads: lista.slice().reverse(), logs });
});

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Track</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f1117;--sidebar:#161b27;--surface:#1a2035;--surface2:#1f2740;
  --border:#2a3450;--text:#e8eaf0;--muted:#7b8db0;--accent:#4f7fff;
  --green:#22c97a;--amber:#f59e0b;--red:#ef4444;--purple:#a78bfa;
}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);display:flex;min-height:100vh;font-size:14px}

/* SIDEBAR */
aside{width:220px;background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:0;flex-shrink:0;position:fixed;top:0;left:0;height:100vh}
.brand{padding:1.5rem 1.25rem 1rem;border-bottom:1px solid var(--border)}
.brand-icon{width:36px;height:36px;border-radius:10px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:8px}
.brand-name{font-size:15px;font-weight:600;color:var(--text)}
.brand-sub{font-size:11px;color:var(--muted);margin-top:2px}
nav{padding:1rem 0.75rem;flex:1}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;color:var(--muted);font-size:13px;font-weight:500;transition:all 0.15s;margin-bottom:2px;text-decoration:none}
.nav-item:hover{background:var(--surface);color:var(--text)}
.nav-item.active{background:rgba(79,127,255,0.15);color:var(--accent)}
.nav-icon{font-size:16px;width:20px;text-align:center}
.sidebar-footer{padding:1rem 1.25rem;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}
.status-txt{font-size:11px;color:var(--muted)}

/* MAIN */
main{margin-left:220px;flex:1;padding:2rem;overflow-y:auto;min-height:100vh}
.page{display:none}.page.active{display:block}
.page-title{font-size:22px;font-weight:600;margin-bottom:4px}
.page-sub{font-size:13px;color:var(--muted);margin-bottom:1.75rem}

/* CARDS */
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.75rem}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem;display:flex;align-items:center;justify-content:space-between}
.card-info{}
.card-label{font-size:12px;color:var(--muted);margin-bottom:6px}
.card-value{font-size:24px;font-weight:600}
.card-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}
.ci-blue{background:rgba(79,127,255,0.12);color:var(--accent)}
.ci-green{background:rgba(34,201,122,0.12);color:var(--green)}
.ci-amber{background:rgba(245,158,11,0.12);color:var(--amber)}
.ci-purple{background:rgba(167,139,250,0.12);color:var(--purple)}

/* GRID */
.grid2{display:grid;grid-template-columns:1fr 1.6fr;gap:1.25rem;margin-bottom:1.25rem}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.panel-head{padding:1rem 1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.panel-head h3{font-size:14px;font-weight:600}
.panel-head span{font-size:12px;color:var(--muted)}
.panel-body{padding:1.25rem}
.chart-wrap{position:relative;height:200px}

/* TABLE */
.table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse}
thead th{padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);text-align:left;border-bottom:1px solid var(--border);background:var(--surface2)}
tbody tr{border-bottom:1px solid var(--border);transition:background .1s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:var(--surface2)}
td{padding:11px 14px;font-size:13px;vertical-align:middle}
.avatar{width:30px;height:30px;border-radius:8px;background:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#fff;margin-right:8px;flex-shrink:0}
.td-name{display:flex;align-items:center}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;padding:3px 9px;border-radius:20px}
.b-conv{background:rgba(34,201,122,0.12);color:var(--green)}
.b-wait{background:rgba(245,158,11,0.12);color:var(--amber)}
.b-err{background:rgba(239,68,68,0.12);color:var(--red)}
.mono{font-family:monospace;font-size:12px}

/* LOGS PAGE */
.log-list{display:flex;flex-direction:column;gap:0}
.log-row{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border)}
.log-row:last-child{border-bottom:none}
.log-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px}
.ld-sucesso{background:var(--green)}
.ld-lead{background:var(--accent)}
.ld-erro{background:var(--red)}
.ld-info{background:var(--muted)}
.log-msg{font-size:13px;color:var(--text)}
.log-det{font-size:12px;color:var(--muted);margin-top:2px}

/* INTEGRAÇÕES */
.int-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1rem}
.int-title{font-size:14px;font-weight:600;margin-bottom:.4rem}
.int-sub{font-size:12px;color:var(--muted);margin-bottom:.9rem}
.url-row{display:flex;align-items:center;gap:8px}
.url-box{font-family:monospace;font-size:12px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 12px;flex:1;color:var(--text);word-break:break-all}
.copy-btn{background:none;border:1px solid var(--border);border-radius:7px;padding:7px 12px;color:var(--muted);font-size:12px;cursor:pointer;white-space:nowrap;transition:all .15s}
.copy-btn:hover{border-color:var(--accent);color:var(--accent)}
.method{font-size:10px;font-weight:600;padding:3px 7px;border-radius:5px;background:rgba(79,127,255,0.15);color:var(--accent);flex-shrink:0}

/* EMPTY */
.empty{padding:2.5rem;text-align:center;color:var(--muted);font-size:13px}

@media(max-width:900px){
  .cards{grid-template-columns:1fr 1fr}
  .grid2{grid-template-columns:1fr}
  aside{width:200px}
  main{margin-left:200px}
}
</style>
</head>
<body>

<aside>
  <div class="brand">
    <div class="brand-icon">📡</div>
    <div class="brand-name">App Track</div>
    <div class="brand-sub">Rastreamento de leads</div>
  </div>
  <nav>
    <a class="nav-item active" onclick="showPage('dashboard',this)">
      <span class="nav-icon">🏠</span> Dashboard
    </a>
    <a class="nav-item" onclick="showPage('leads',this)">
      <span class="nav-icon">👥</span> Leads
    </a>
    <a class="nav-item" onclick="showPage('logs',this)">
      <span class="nav-icon">📋</span> Eventos
    </a>
    <a class="nav-item" onclick="showPage('integracoes',this)">
      <span class="nav-icon">🔗</span> Integrações
    </a>
  </nav>
  <div class="sidebar-footer">
    <div class="status-dot"></div>
    <span class="status-txt">Servidor online</span>
  </div>
</aside>

<main>

  <!-- DASHBOARD -->
  <div class="page active" id="page-dashboard">
    <div class="page-title">Dashboard</div>
    <div class="page-sub">Visão geral do rastreamento</div>

    <div class="cards">
      <div class="card">
        <div class="card-info">
          <div class="card-label">Total de Leads</div>
          <div class="card-value" id="d-total">0</div>
        </div>
        <div class="card-icon ci-blue">👥</div>
      </div>
      <div class="card">
        <div class="card-info">
          <div class="card-label">Convertidos</div>
          <div class="card-value" id="d-conv" style="color:var(--green)">0</div>
        </div>
        <div class="card-icon ci-green">✅</div>
      </div>
      <div class="card">
        <div class="card-info">
          <div class="card-label">Aguardando Pix</div>
          <div class="card-value" id="d-wait" style="color:var(--amber)">0</div>
        </div>
        <div class="card-icon ci-amber">⏳</div>
      </div>
      <div class="card">
        <div class="card-info">
          <div class="card-label">Receita Total</div>
          <div class="card-value" id="d-receita" style="color:var(--purple)">R$ 0</div>
        </div>
        <div class="card-icon ci-purple">💰</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <div class="panel-head"><h3>Funil por status</h3><span id="chart-sub">Distribuição</span></div>
        <div class="panel-body"><div class="chart-wrap"><canvas id="chart"></canvas></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Últimos contatos</h3><span id="recentes-count">—</span></div>
        <div class="panel-body" style="padding:0">
          <table>
            <thead><tr><th>Contato</th><th>Telefone</th><th>Status</th><th>UTM</th></tr></thead>
            <tbody id="recentes-tbody"><tr><td colspan="4" class="empty">Nenhum lead ainda</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- LEADS -->
  <div class="page" id="page-leads">
    <div class="page-title">Leads</div>
    <div class="page-sub">Todos os contatos recebidos</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Contato</th><th>Telefone</th><th>Clica ID</th><th>Campanha</th><th>UTM Source</th><th>Status</th><th>Recebido em</th></tr></thead>
        <tbody id="leads-tbody"><tr><td colspan="7" class="empty">Nenhum lead ainda</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- LOGS -->
  <div class="page" id="page-logs">
    <div class="page-title">Log de Eventos</div>
    <div class="page-sub">Histórico de todas as ações</div>
    <div class="panel">
      <div class="panel-body">
        <div class="log-list" id="logs-list"><div class="empty">Nenhum evento ainda</div></div>
      </div>
    </div>
  </div>

  <!-- INTEGRAÇÕES -->
  <div class="page" id="page-integracoes">
    <div class="page-title">Integrações</div>
    <div class="page-sub">URLs dos webhooks para colar nas plataformas</div>

    <div class="int-card">
      <div class="int-title">📥 Webhook de Lead</div>
      <div class="int-sub">Cole essa URL na plataforma que gera o lead (Kiwify, Hotmart, etc.)</div>
      <div class="url-row">
        <span class="method">POST</span>
        <span class="url-box" id="url-lead">—</span>
        <button class="copy-btn" onclick="copyUrl('url-lead',this)">Copiar</button>
      </div>
    </div>

    <div class="int-card">
      <div class="int-title">💸 Webhook de Pix</div>
      <div class="int-sub">Cole essa URL dentro da DePix como webhook de notificação de pagamento</div>
      <div class="url-row">
        <span class="method">POST</span>
        <span class="url-box" id="url-pix">—</span>
        <button class="copy-btn" onclick="copyUrl('url-pix',this)">Copiar</button>
      </div>
    </div>

    <div class="int-card">
      <div class="int-title">🎯 UTMify</div>
      <div class="int-sub">Disparado automaticamente ao confirmar o Pix</div>
      <div class="url-row">
        <span class="method">GET</span>
        <span class="url-box">https://club.segredosdoads.com.br/utmify.ashx?phone={telefone}&priceincents={valor}&name=Assinatura_Trimestral&token=••••••</span>
      </div>
    </div>
  </div>

</main>

<script>
let chartInst = null;

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  el.classList.add('active');
}

function copyUrl(id, btn) {
  navigator.clipboard.writeText(document.getElementById(id).textContent);
  btn.textContent = 'Copiado!';
  setTimeout(() => btn.textContent = 'Copiar', 1500);
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function initials(nome, tel) {
  if (nome) return nome.trim().split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  return tel ? tel.slice(-2) : '??';
}

function badgeHtml(status) {
  if (status === 'convertido') return '<span class="badge b-conv">✓ Convertido</span>';
  return '<span class="badge b-wait">⏳ Aguardando Pix</span>';
}

async function load() {
  try {
    const r = await fetch('/api/data');
    const d = await r.json();

    // stats
    document.getElementById('d-total').textContent   = d.total;
    document.getElementById('d-conv').textContent    = d.convertidos;
    document.getElementById('d-wait').textContent    = d.aguardando;
    document.getElementById('d-receita').textContent = 'R$ ' + (d.receita/100).toLocaleString('pt-BR',{minimumFractionDigits:2});
    document.getElementById('recentes-count').textContent = d.leads.length + ' registros';

    // chart
    const ctx = document.getElementById('chart').getContext('2d');
    const vals = [d.aguardando, d.convertidos];
    if (chartInst) { chartInst.data.datasets[0].data = vals; chartInst.update(); }
    else {
      chartInst = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Aguardando Pix', 'Convertidos'],
          datasets: [{ data: vals, backgroundColor: ['rgba(245,158,11,0.7)','rgba(34,201,122,0.7)'], borderRadius: 8, borderSkipped: false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7b8db0' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7b8db0', stepSize: 1 } }
          }
        }
      });
    }

    // recentes (últimos 5)
    const rt = document.getElementById('recentes-tbody');
    if (!d.leads.length) { rt.innerHTML = '<tr><td colspan="4" class="empty">Nenhum lead ainda</td></tr>'; }
    else {
      rt.innerHTML = d.leads.slice(0,5).map(l => \`<tr>
        <td class="td-name"><div class="avatar">\${initials(l.nome, l.telefone)}</div>\${l.nome || '—'}</td>
        <td class="mono">+\${l.telefone}</td>
        <td>\${badgeHtml(l.status)}</td>
        <td style="color:var(--muted);font-size:12px">\${l.utm_source || '—'}</td>
      </tr>\`).join('');
    }

    // leads full table
    const lt = document.getElementById('leads-tbody');
    if (!d.leads.length) { lt.innerHTML = '<tr><td colspan="7" class="empty">Nenhum lead ainda</td></tr>'; }
    else {
      lt.innerHTML = d.leads.map(l => \`<tr>
        <td class="td-name"><div class="avatar">\${initials(l.nome, l.telefone)}</div>\${l.nome || '—'}</td>
        <td class="mono">+\${l.telefone}</td>
        <td class="mono">\${l.clica_id || '—'}</td>
        <td style="font-size:12px">\${l.utm_campaign || '—'}</td>
        <td style="font-size:12px">\${l.utm_source || '—'}</td>
        <td>\${badgeHtml(l.status)}</td>
        <td style="color:var(--muted);font-size:12px">\${fmt(l.recebido_em)}</td>
      </tr>\`).join('');
    }

    // logs
    const ll = document.getElementById('logs-list');
    if (!d.logs.length) { ll.innerHTML = '<div class="empty">Nenhum evento ainda</div>'; }
    else {
      ll.innerHTML = d.logs.map(l => \`<div class="log-row">
        <div class="log-dot ld-\${l.tipo}"></div>
        <div>
          <div class="log-msg">\${l.msg}</div>
          \${l.detalhe ? \`<div class="log-det">\${l.detalhe}</div>\` : ''}
          <div class="log-det">\${fmt(l.hora)}</div>
        </div>
      </div>\`).join('');
    }

  } catch(e) { console.error(e); }
}

// URLs
const base = window.location.origin;
document.getElementById('url-lead').textContent = base + '/webhook/lead';
document.getElementById('url-pix').textContent  = base + '/webhook/pix';

load();
setInterval(load, 15000);
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log("✅ Rodando na porta " + PORT));
