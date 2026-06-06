# DePix → UTMify

Servidor que recebe leads e pagamentos Pix, e dispara conversões para UTMify.

## Como subir no Railway (5 minutos)

1. Crie uma conta gratuita em https://railway.app
2. Clique em **New Project → Deploy from GitHub**
   - Ou use **New Project → Empty Project → Add Service → GitHub Repo**
3. Faça upload dos arquivos (index.js + package.json) num repositório GitHub
4. Railway detecta o package.json e faz o deploy automaticamente
5. Vá em **Settings → Networking → Generate Domain**
6. Sua URL vai aparecer: ex. `https://depix-utmify-production.up.railway.app`

## Endpoints

### POST /webhook/lead
Cole essa URL na plataforma que gera o lead (Kiwify, Hotmart, etc.)

Payload esperado:
```json
{
  "phone": "5511987654321",
  "clica_id": "clk_abc123",
  "utm_source": "facebook",
  "utm_campaign": "nome_da_campanha",
  "utm_medium": "cpc"
}
```

### POST /webhook/pix
Cole essa URL dentro da DePix como webhook de notificação.

Payload que a DePix envia (automático):
```json
{
  "status": "transaction.paid",
  "amount": 2400,
  "payer_phone": "5511987654321"
}
```

### GET /
Mostra status do servidor e quantidade de leads armazenados.

### GET /leads
Lista todos os leads em memória (útil para debug).

## Fluxo

1. Lead chega → salvo pela chave do telefone
2. Pix confirmado → busca o lead pelo telefone
3. Encontrou → dispara GET para UTMify com telefone + valor + token
