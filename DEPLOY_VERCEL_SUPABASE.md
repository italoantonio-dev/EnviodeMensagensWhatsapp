# Deploy: Vercel + Supabase (Arquitetura recomendada)

## Resumo da arquitetura

Este projeto usa:
- conexão WhatsApp (Baileys) em tempo real,
- cron e fila contínua,
- escrita local de sessão.

Por isso, **o bot não deve rodar no Vercel** (serverless).

Arquitetura recomendada:
- **Vercel:** frontend/painel (`public/`)
- **Supabase:** banco PostgreSQL
- **Railway/Render/Fly:** processo contínuo do backend/bot (`bot.js` + `config-server.js`)

---

## 1) Subir schema no Supabase

1. Crie um projeto Supabase.
2. Abra o SQL Editor.
3. Execute o arquivo [supabase/schema.sql](supabase/schema.sql).

---

## 2) Preparar backend (Railway/Render/Fly)

Use este backend para expor `/api/*` e processar bot/fila continuamente.

Variáveis mínimas sugeridas:

- `SEND_PROVIDER`
- `NUMERO_BOT`
- `BLUE_STAR_GROUP_ID`
- `BLUE_STAR_GROUP_INVITE_LINK`
- `WA_CLOUD_API_VERSION`
- `WA_CLOUD_PHONE_NUMBER_ID`
- `WA_CLOUD_ACCESS_TOKEN`
- `SEND_MIN_INTERVAL_SECONDS`
- `SEND_MAX_PER_HOUR`
- `SEND_ALLOWED_START_HOUR`
- `SEND_ALLOWED_END_HOUR`
- `CONFIG_PORT`
- `APP_WEB_ORIGIN` (ex.: `https://SEU-PROJETO.vercel.app`)

No deploy, o servidor também aceita `PORT` automático do provedor.

Para migração de banco (quando implementar adapter Supabase):
- `DATA_PROVIDER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

> Observação: hoje o projeto ainda usa NeDB como provider ativo. O schema Supabase já está pronto para migração.

### Start command recomendado (backend)

- `node config-server.js`

Esse processo expõe `/api/*` e permite iniciar o bot pelo endpoint `/api/bot-start`.

---

## 3) Subir frontend no Vercel

1. Conecte o repositório no Vercel.
2. O arquivo [vercel.json](vercel.json) já está preparado para servir `public/index.html`.
3. Após deploy, configure `public/runtime-config.js` para apontar ao backend público:

```js
window.APP_API_BASE_URL = 'https://SEU-BACKEND-PUBLICO'
```

Exemplo:

```js
window.APP_API_BASE_URL = 'https://chatbot-api.seudominio.com'
```

---

## 4) Checklist de produção

- Backend online e respondendo `/api/health`
- Bot iniciado e QR disponível em `/api/bot-qr`
- Frontend Vercel carregando e consumindo API remota
- Sessão Baileys com volume persistente no host do bot
- Secrets definidos no provedor do backend

---

## 5) Limitação importante

- **Vercel não é ambiente para manter Baileys/socket + cron sempre ativos**.
- Use Vercel apenas para interface web.
