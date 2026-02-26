# ChatBot Grupo 🤖

WhatsApp bot focused on daily Blue Star messages using a 15-day cycle.

Creator: **Italo Antonio Costa Felisbino**

## What it does

- Sends one automatic message per day to the configured recipient.
- Uses different text per day (15 editable messages in the panel).
- Supports execution marking with `!feito [indicador]`.
- Supports audit/status with `!statusbluestar`.
- Supports private recipient (user) and group registration.
- Supports manual send (now) or scheduled dispatch.

## Installation

1. Install dependencies:

```bash
npm run setup
```

2. Create `.env` from the example:

```bash
cp env-example .env
```

## Run

1. Start the config panel:

```bash
npm run config
```

2. Open `http://localhost:3001` in your browser.
3. Fill settings and save.
4. Start the bot:

```bash
npm start
```

## Main environment variables

- `SEND_PROVIDER`: `baileys` (QR) or `meta-cloud`.
- `NUMERO_BOT`
- `BLUE_STAR_GROUP_ID`
- `BLUE_STAR_GROUP_INVITE_LINK`
- `WA_CLOUD_API_VERSION`
- `WA_CLOUD_PHONE_NUMBER_ID`
- `WA_CLOUD_ACCESS_TOKEN`
- `CONFIG_PORT`
- `DATA_PROVIDER`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## WhatsApp commands

- `!bluestar`
- `!feito [indicador]`
- `!statusbluestar`
- `!comandos`

## Deploy

- Technical guide: [DEPLOY_VERCEL_SUPABASE.md](DEPLOY_VERCEL_SUPABASE.md)

## Security

- Do not publish `.env`.
- Do not expose Supabase keys in the frontend.
- Do not commit `baileys-auth/`.
- Do not commit tokens (`WA_CLOUD_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`).
