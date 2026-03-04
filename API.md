# API Documentation — Bot Panel

> Documentação completa da API REST do painel de controle do bot WhatsApp.

## Base URL

```
http://localhost:{CONFIG_PORT}
```

A porta é configurável via variável de ambiente `CONFIG_PORT` (padrão: `3001`).

---

## Autenticação

Atualmente a API utiliza CORS para restringir origens permitidas (`APP_WEB_ORIGIN`).  
Rate limiting está ativo em todos os endpoints (`/api/*`).

---

## Health Check & Monitoramento

### `GET /api/health`

Retorna status de saúde da aplicação com métricas de uptime, memória e conectividade.

**Response `200`**
```json
{
  "ok": true,
  "version": "1.0.0",
  "uptime": 3600,
  "uptimeHuman": "1h 0m 0s",
  "startedAt": "2026-03-04T12:00:00.000Z",
  "database": "connected",
  "bot": "connected",
  "memory": {
    "rss": "85MB",
    "heapUsed": "42MB",
    "heapTotal": "65MB"
  },
  "nodeVersion": "v20.20.0",
  "platform": "win32"
}
```

---

## Configurações

### `GET /api/config`

Retorna as variáveis de ambiente atuais e totais de ciclo.

**Response `200`**
```json
{
  "env": {
    "SEND_PROVIDER": "baileys",
    "NUMERO_BOT": "5534999998888",
    "SEND_MIN_INTERVAL_SECONDS": "20",
    "SEND_MAX_PER_HOUR": "40",
    "SEND_ALLOWED_START_HOUR": "8",
    "SEND_ALLOWED_END_HOUR": "20",
    "CONFIG_PORT": "3001"
  },
  "messages": [],
  "totalDias": 5
}
```

### `POST /api/config`

Salva as configurações do ambiente.

**Body**
```json
{
  "env": {
    "SEND_PROVIDER": "baileys",
    "NUMERO_BOT": "5534999998888",
    "SEND_MIN_INTERVAL_SECONDS": "20",
    "SEND_MAX_PER_HOUR": "40",
    "SEND_ALLOWED_START_HOUR": "8",
    "SEND_ALLOWED_END_HOUR": "20"
  }
}
```

**Response `200`**
```json
{ "ok": true, "message": "Configurações salvas com sucesso." }
```

**Response `400`**
```json
{ "ok": false, "message": "Descrição do erro de validação." }
```

---

## Destinatários

### `GET /api/recipients`

Lista todos os destinatários cadastrados.

**Response `200`** — Array de objetos:
```json
[
  {
    "_id": "abc123",
    "name": "João Coordenador",
    "type": "private",
    "destination": "+55 (34) 99999-8888",
    "jid": "5534999998888@s.whatsapp.net",
    "isDefault": true,
    "isCycleTarget": false
  }
]
```

### `POST /api/recipients`

Adiciona um novo destinatário.

**Body**
```json
{
  "name": "Maria",
  "type": "private",
  "destination": "34999998888"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `name` | string | sim | Nome de identificação |
| `type` | string | sim | `"private"` ou `"group"` |
| `destination` | string | sim | Número BR ou ID de grupo (`@g.us`/link) |

**Response `200`**
```json
{ "ok": true, "item": { "_id": "...", "name": "Maria", ... } }
```

### `PUT /api/recipients/:id`

Atualiza um destinatário existente.

**Body** — Mesma estrutura do `POST`.

### `DELETE /api/recipients/:id`

Remove um destinatário.

### `POST /api/recipients/:id/default`

Define o destinatário como padrão para disparos manuais.

### `POST /api/recipients/:id/cycle-target`

Define o destinatário (tipo grupo) como alvo do ciclo diário.

---

## Importação de Destinatários

### `POST /api/import-recipients`

Importa destinatários de arquivo (JSON, XLSX ou XML).

**Content-Type:** `multipart/form-data`  
**Campo:** `file` — Arquivo `.json`, `.xlsx`, `.xls` ou `.xml`

**Response `200`**
```json
{
  "ok": true,
  "message": "Importação concluída: 5 importado(s), 2 duplicado(s), 1 erro(s)",
  "results": {
    "imported": [{ "name": "...", "type": "...", "jid": "..." }],
    "duplicates": [{ "name": "...", "jid": "...", "message": "..." }],
    "errors": [{ "row": 3, "reason": "Número inválido." }]
  }
}
```

---

## Grupos WhatsApp

### `GET /api/whatsapp-groups`

Lista os grupos do WhatsApp conectado (cache local).

### `POST /api/whatsapp-groups/refresh`

Solicita atualização da lista de grupos via bot.

### `POST /api/whatsapp-groups/import`

Importa grupos selecionados como destinatários.

**Body**
```json
{ "groupIds": ["120363041234567890@g.us", "..."] }
```

---

## Ciclos

### `GET /api/cycles`

Lista todos os ciclos (metadados).

**Response `200`**
```json
{
  "ok": true,
  "cycles": [
    {
      "id": "cycle-default",
      "name": "Ciclo 1",
      "isSelected": true,
      "daysCount": 5,
      "settings": {
        "startDate": "2026-01-01",
        "isActive": true,
        "repeatIntervalDays": 1
      }
    }
  ]
}
```

### `POST /api/cycles`

Cria um novo ciclo.

**Body**
```json
{ "name": "Ciclo Especial" }
```

### `POST /api/cycles/:cycleId/activate`

Define o ciclo como ativo.

### `DELETE /api/cycles/:cycleId`

Remove um ciclo (mínimo 1 deve permanecer).

### `GET /api/cycle?cycleId=xxx`

Retorna os dias e configurações de um ciclo específico.

### `POST /api/cycle`

Atualiza dias e configurações de um ciclo.

**Body**
```json
{
  "cycleId": "cycle-default",
  "cycle": [
    { "message": "Bom dia!", "timeHHmm": "09:00", "isActive": true },
    { "message": "Boa tarde!", "timeHHmm": "14:00", "isActive": true }
  ],
  "settings": {
    "startDate": "2026-01-01",
    "isActive": true,
    "repeatIntervalDays": 1,
    "recipients": ["recipientId1", "recipientId2"]
  }
}
```

---

## Disparos

### `GET /api/dispatches`

Lista os últimos 100 disparos (ordenados por data de criação desc).

**Response `200`** — Array:
```json
[
  {
    "_id": "xyz789",
    "recipientId": "abc123",
    "sourceType": "cycle",
    "cycleDay": 1,
    "messageText": "Bom dia!",
    "mode": "manual-now",
    "sendAt": "2026-03-04T12:00:00.000Z",
    "sendAtBr": "04/03/2026 12:00",
    "status": "sent",
    "sentAt": "2026-03-04T12:00:15.000Z",
    "sentAtBr": "04/03/2026 12:00",
    "recipientName": "João Coordenador",
    "recipientJid": "5534999998888@s.whatsapp.net"
  }
]
```

### `POST /api/dispatches`

Cria um ou mais disparos.

**Body**
```json
{
  "recipientIds": ["abc123"],
  "sourceType": "manual",
  "messageText": "Olá, tudo bem?",
  "mode": "manual-now"
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `recipientIds` | string[] | IDs dos destinatários |
| `sourceType` | string | `"manual"` ou `"cycle"` |
| `cycleDay` | number | Dia do ciclo (1-N, obrigatório se `cycle`) |
| `messageText` | string | Mensagem (obrigatória se `manual`) |
| `mode` | string | `"manual-now"` ou `"scheduled"` |
| `sendAtBr` | string | Data agendada `DD/MM/AAAA HH:mm` (se `scheduled`) |

### `POST /api/test-dispatch`

Envia mensagem de teste ao destinatário.

**Body**
```json
{ "recipientId": "abc123" }
```

---

## Bot

### `GET /api/bot-status`

Retorna status completo do bot (conexão, QR, eventos).

### `GET /api/bot-qr`

Retorna apenas o QR code data URL e status de conexão.

### `POST /api/bot-start`

Inicia o processo do bot em segundo plano.

### `POST /api/bot-restart-safe`

Reinicia o bot preservando a sessão.

### `POST /api/bot-disconnect`

Desconecta a sessão do WhatsApp (remove auth, força novo QR).

---

## Rate Limiting

| Escopo | Limite | Janela |
|--------|--------|--------|
| Global (`/api/*`) | 500 req | 15 min |
| Escrita (POST/PUT/DELETE) | 30 req | 1 min |
| Importação de arquivos | 5 req | 1 min |

Ao exceder o limite, a API retorna `429 Too Many Requests`:
```json
{ "ok": false, "message": "Muitas requisições. Tente novamente em alguns minutos." }
```

---

## Códigos de Status

| Código | Significado |
|--------|-------------|
| `200` | Sucesso |
| `201` | Recurso criado |
| `400` | Dados inválidos |
| `404` | Recurso não encontrado |
| `409` | Conflito (duplicata / operação em andamento) |
| `429` | Rate limit excedido |
| `500` | Erro interno do servidor |

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SEND_PROVIDER` | `baileys` | Modo de envio: `baileys` ou `meta-cloud` |
| `NUMERO_BOT` | — | Número de referência do bot |
| `CONFIG_PORT` | `3001` | Porta HTTP do painel |
| `APP_WEB_ORIGIN` | `*` | Origens CORS permitidas (separar por vírgula) |
| `DATA_PROVIDER` | `nedb` | Provedor de dados: `nedb` ou `supabase` |
| `SUPABASE_URL` | — | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key do Supabase |
| `LOG_LEVEL` | `info` | Nível de log: `error`, `warn`, `info`, `debug` |
| `SEND_MIN_INTERVAL_SECONDS` | `20` | Intervalo mínimo entre envios (0-3600) |
| `SEND_MAX_PER_HOUR` | `40` | Máximo de envios por hora (1-500) |
| `SEND_ALLOWED_START_HOUR` | `8` | Hora de início dos disparos automáticos (0-23) |
| `SEND_ALLOWED_END_HOUR` | `20` | Hora de fim dos disparos automáticos (0-23) |
