# ChatBot Grupo 🤖

Bot de WhatsApp focado em envio diário de mensagens Blue Star com ciclo de 15 dias.

Criador: **Italo Antonio Costa Felisbino**

## O que faz

- Envia uma mensagem automática por dia no destinatário configurado.
- Usa texto diferente por dia (15 mensagens editáveis no painel).
- Permite marcação de execução com `!feito [indicador]`.
- Permite auditoria com `!statusbluestar`.
- Permite cadastro de destinatário privado (usuário) e grupo.
- Permite disparo manual (agora) ou agendado.

## Instalação

1. Instale dependências:

```bash
npm run setup
```

2. Crie o `.env` com base no exemplo:

```bash
cp env-example .env
```

## Execução

1. Inicie o painel:

```bash
npm run config
```

2. Abra `http://localhost:3001` no navegador.
3. Preencha os campos e salve.
4. Inicie o bot:

```bash
npm start
```

## Variáveis principais

- `SEND_PROVIDER`: `baileys` (QR) ou `meta-cloud`.
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

## Comandos no WhatsApp

- `!bluestar`
- `!feito [indicador]`
- `!statusbluestar`
- `!comandos`

## Deploy

- Guia técnico: [DEPLOY_VERCEL_SUPABASE.md](DEPLOY_VERCEL_SUPABASE.md)

## Segurança

- Não publique `.env`.
- Não publique chave do Supabase no frontend.
- Não versione `baileys-auth/`.
- Não comite tokens (`WA_CLOUD_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`).
