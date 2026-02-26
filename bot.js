import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import QRCode from 'qrcode'
import cron from 'node-cron'
import P from 'pino'
import 'dotenv/config'
import axios from 'axios'
import { format, startOfDay, differenceInCalendarDays, parseISO } from "date-fns"
import { toZonedTime } from "date-fns-tz"
import fs from 'fs'
import { dispatchesDb, recipientsDb, initDatabase, normalizeRecipientJid, loadCycleConfig, loadCycleSettings } from './database.js'

const BLUE_STAR_TIMEZONE = 'America/Sao_Paulo'
const BOT_STATUS_ARQUIVO = './data/bot-status.json'
const BOT_COMMAND_ARQUIVO = './data/bot-command.json'
const BAILEYS_AUTH_DIR = './baileys-auth'
const MAX_STATUS_EVENTS = 200
let reconnectScheduled = false
let reconnectTentativas = 0
let authResetadoNoCiclo = false
let startingBaileys = false
let activeSock = null
let cronJobsIniciados = false
let processandoFila = false
let ultimoComandoProcessadoEm = ''
let lastConnectionOpenedAtMs = 0
let rapidDisconnects = 0

const SEND_PROVIDER = (process.env.SEND_PROVIDER || 'baileys').trim().toLowerCase()
const WA_CLOUD_API_VERSION = (process.env.WA_CLOUD_API_VERSION || 'v21.0').trim()
const WA_CLOUD_PHONE_NUMBER_ID = (process.env.WA_CLOUD_PHONE_NUMBER_ID || '').trim()
const WA_CLOUD_ACCESS_TOKEN = (process.env.WA_CLOUD_ACCESS_TOKEN || '').trim()

function isMetaCloudMode() {
  return SEND_PROVIDER === 'meta-cloud'
}

function isMetaCloudConfigured() {
  return Boolean(WA_CLOUD_PHONE_NUMBER_ID && WA_CLOUD_ACCESS_TOKEN)
}

function obterDiaDoCicloAtual(dataRef = new Date()) {
  const cycle = loadCycleConfig()
  if (!cycle.length) {
    return null
  }

  const hoje = startOfDay(toZonedTime(dataRef, BLUE_STAR_TIMEZONE))
  const cycleSettings = loadCycleSettings()
  const cycleStartStr = cycleSettings.startDate
  const inicio = startOfDay(toZonedTime(parseISO(cycleStartStr), BLUE_STAR_TIMEZONE))

  const diasPassados = Math.max(0, differenceInCalendarDays(hoje, inicio))
  const diaDoCiclo = (diasPassados % cycle.length)

  return diaDoCiclo
}

function obterMensagemDiaCiclo(diaDoCiclo) {
  const cycle = loadCycleConfig()
  if (!cycle.length || diaDoCiclo < 0 || diaDoCiclo >= cycle.length) {
    return null
  }
  
  return cycle[diaDoCiclo]
}


function extrairCodigoConvite(link) {
  if (!link) return null
  const match = link.trim().match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i)
  return match ? match[1] : null
}

async function resolverGrupoBlueStar(sock) {
  const destinatarioCiclo = await recipientsDb.findOne({ isCycleTarget: true })
  if (destinatarioCiclo?.type === 'group') {
    const jidDestino = await resolverJidDestinatario(sock, destinatarioCiclo)
    if (jidDestino) {
      return jidDestino
    }
  }

  const grupoIdConfigurado = (process.env.BLUE_STAR_GROUP_ID || '').trim()
  if (grupoIdConfigurado) {
    return grupoIdConfigurado
  }

  const linkConvite = (process.env.BLUE_STAR_GROUP_INVITE_LINK || '').trim()
  const codigo = extrairCodigoConvite(linkConvite)
  if (!codigo) {
    return null
  }

  try {
    if (typeof sock.groupAcceptInvite === 'function') {
      const jid = await sock.groupAcceptInvite(codigo)
      if (jid) {
        return jid
      }
    }
  } catch (err) {
    console.log('Não foi possível entrar pelo link de convite:', err.message)
  }

  try {
    if (typeof sock.groupGetInviteInfo === 'function') {
      const info = await sock.groupGetInviteInfo(codigo)
      if (info?.id) {
        return info.id
      }
    }
  } catch (err) {
    console.log('Não foi possível resolver o grupo pelo link:', err.message)
  }

  return null
}

function parseIntEnv(name, defaultValue, min, max) {
  const raw = (process.env[name] || '').trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return defaultValue
  if (parsed < min || parsed > max) return defaultValue
  return Math.floor(parsed)
}

function obterConfiguracoesLimiteEnvio() {
  return {
    intervaloSegundos: parseIntEnv('SEND_MIN_INTERVAL_SECONDS', 20, 0, 3600),
    maxPorHora: parseIntEnv('SEND_MAX_PER_HOUR', 40, 1, 500),
    horaInicio: parseIntEnv('SEND_ALLOWED_START_HOUR', 8, 0, 23),
    horaFim: parseIntEnv('SEND_ALLOWED_END_HOUR', 20, 0, 23)
  }
}

function podeEnviarAgora(config) {
  const agora = toZonedTime(new Date(), BLUE_STAR_TIMEZONE)
  const horaAtual = agora.getHours()

  if (config.horaInicio === config.horaFim) return true

  if (config.horaInicio < config.horaFim) {
    return horaAtual >= config.horaInicio && horaAtual < config.horaFim
  }

  return horaAtual >= config.horaInicio || horaAtual < config.horaFim
}

function salvarStatusBot(status) {
  const atual = lerStatusBot()
  const eventosAtuais = Array.isArray(atual.events) ? atual.events : []
  const logMessage = (status.logMessage || '').toString().trim()
  const logLevel = (status.logLevel || 'info').toString().trim().toLowerCase() || 'info'
  const logSource = (status.logSource || 'bot').toString().trim().toLowerCase() || 'bot'

  const eventos = logMessage
    ? [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        level: logLevel,
        source: logSource,
        message: logMessage
      },
      ...eventosAtuais
    ].slice(0, MAX_STATUS_EVENTS)
    : eventosAtuais

  const statusSemLogs = { ...status }
  delete statusSemLogs.logMessage
  delete statusSemLogs.logLevel
  delete statusSemLogs.logSource

  const merged = {
    ...atual,
    ...statusSemLogs,
    events: eventos,
    updatedAt: new Date().toISOString()
  }
  fs.writeFileSync(BOT_STATUS_ARQUIVO, JSON.stringify(merged, null, 2), 'utf-8')
}

function lerStatusBot() {
  if (!fs.existsSync(BOT_STATUS_ARQUIVO)) {
    return {
      connected: false,
      updatedAt: '',
      connectionOpenedAt: '',
      lastError: '',
      lastQueueRunAt: '',
      lastSentAt: '',
      qrDataUrl: '',
      events: []
    }
  }

  try {
    return JSON.parse(fs.readFileSync(BOT_STATUS_ARQUIVO, 'utf-8'))
  } catch {
    return {
      connected: false,
      updatedAt: '',
      connectionOpenedAt: '',
      lastError: '',
      lastQueueRunAt: '',
      lastSentAt: '',
      qrDataUrl: '',
      events: []
    }
  }
}

function lerComandoBot() {
  if (!fs.existsSync(BOT_COMMAND_ARQUIVO)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(BOT_COMMAND_ARQUIVO, 'utf-8'))
  } catch {
    return null
  }
}

function salvarComandoBot(payload) {
  fs.writeFileSync(BOT_COMMAND_ARQUIVO, JSON.stringify(payload, null, 2), 'utf-8')
}

function limparAuthBaileys() {
  try {
    if (fs.existsSync(BAILEYS_AUTH_DIR)) {
      fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true })
      console.log('Sessão Baileys resetada (pasta baileys-auth removida).')
    }
  } catch (err) {
    console.log('Falha ao limpar pasta de autenticação Baileys:', err.message)
  }
}

async function processarComandoBotPendente() {
  const comando = lerComandoBot()
  if (!comando || comando.action !== 'disconnect') {
    return
  }

  const requestedAt = (comando.requestedAt || '').toString().trim()
  const processedAt = (comando.processedAt || '').toString().trim()
  if (processedAt) {
    return
  }

  if (!requestedAt || requestedAt === ultimoComandoProcessadoEm) {
    return
  }

  ultimoComandoProcessadoEm = requestedAt
  console.log('Comando recebido: desconectar sessão e regenerar QR.')

  limparAuthBaileys()
  salvarStatusBot({
    connected: false,
    qrDataUrl: '',
    lastError: 'Sessão desconectada manualmente. Gerando novo QR...',
    logMessage: 'Comando de desconexão recebido pelo painel. Reiniciando sessão do WhatsApp.',
    logLevel: 'warn',
    logSource: 'command'
  })

  if (activeSock) {
    try {
      await activeSock.logout()
    } catch {
      try {
        activeSock.ws?.close()
      } catch {
      }
    }

    activeSock = null
  } else {
    start()
  }

  salvarComandoBot({
    ...comando,
    processedAt: new Date().toISOString()
  })
}

function obterCodigoDesconexao(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.data?.statusCode ||
    lastDisconnect?.error?.statusCode ||
    null
  )
}

function obterMensagemDesconexao(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.payload?.message ||
    lastDisconnect?.error?.message ||
    'Motivo não informado'
  )
}

function agendarCronsUmaVez() {
  if (cronJobsIniciados) {
    return
  }

  cronJobsIniciados = true

  cron.schedule('0 * * * *', async () => {
    if (isMetaCloudMode()) {
      return
    }

    if (!activeSock) {
      return
    }
    try {
      await enviarCicloSeNecessario(activeSock)
    } catch (err) {
      console.log('Falha ao enviar ciclo:', err.message)
    }
  }, { timezone: BLUE_STAR_TIMEZONE })

  cron.schedule('*/10 * * * * *', async () => {
    try {
      await processarFilaDisparos(activeSock)
    } catch (err) {
      const contexto = isMetaCloudMode() ? '(API)' : '(Baileys)'
      console.log(`Falha ao processar fila de disparos ${contexto}:`, err.message)
      salvarStatusBot({ lastError: err.message || 'Falha ao processar fila de disparos' })
    }
  }, { timezone: BLUE_STAR_TIMEZONE })
}

async function enviarCicloSeNecessario(sock) {
  const cycle = loadCycleConfig()
  if (!cycle.length) {
    return
  }

  const cycleSettings = loadCycleSettings()
  if (!cycleSettings.isActive) {
    return
  }

  const diaDoCiclo = obterDiaDoCicloAtual()
  if (diaDoCiclo === null) {
    return
  }

  const itemCiclo = obterMensagemDiaCiclo(diaDoCiclo)
  if (!itemCiclo) {
    return
  }

  if (itemCiclo.isActive === false) {
    return
  }

  const agora = toZonedTime(new Date(), BLUE_STAR_TIMEZONE)
  const horaAtualStr = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`

  // Verifica se a hora atual corresponde à hora configurada para este dia
  if (horaAtualStr !== itemCiclo.timeHHmm) {
    return
  }

  // Verifica se já foi enviado hoje
  const hoje = format(startOfDay(agora), 'yyyy-MM-dd')
  const chaveDiario = `ciclo-${hoje}-${diaDoCiclo}`
  const statusBot = lerStatusBot()
  const ultimoEnvioDiario = statusBot?.lastCycleSent || {}

  if (ultimoEnvioDiario[chaveDiario]) {
    return // Já foi enviado hoje para este dia
  }

  // Resolve o grupo alvo
  let grupoBlueStarProgramado = await resolverGrupoBlueStar(sock)
  if (!grupoBlueStarProgramado) {
    return
  }

  try {
    await sock.sendMessage(grupoBlueStarProgramado, {
      text: itemCiclo.message
    })

    // Marcar como enviado
    ultimoEnvioDiario[chaveDiario] = new Date().toISOString()
    salvarStatusBot({
      lastCycleSent: ultimoEnvioDiario,
      lastSentAt: new Date().toISOString(),
      lastError: ''
    })

    console.log(`Ciclo enviado: Dia ${diaDoCiclo + 1}/${cycle.length}`)
  } catch (err) {
    salvarStatusBot({ lastError: `Falha ao enviar ciclo: ${err.message}` })
    throw err
  }
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timer = null
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

async function resolverJidDestinatario(sock, recipient) {
  if (!sock) return null

  const jidCadastrado = (recipient?.jid || '').trim()
  const jidNormalizado = normalizeRecipientJid(recipient?.type, recipient?.destination)
  const jid = jidCadastrado || jidNormalizado
  if (!jid) return null

  if (jidNormalizado && jidNormalizado !== jidCadastrado && recipient?._id) {
    await recipientsDb.update({ _id: recipient._id }, { $set: { jid: jidNormalizado } })
  }

  if (!/chat\.whatsapp\.com\//i.test(jid)) {
    if (recipient?.type === 'private' && !/@s\.whatsapp\.net$/i.test(jid)) {
      return null
    }

    if (recipient?.type === 'group' && !/@g\.us$/i.test(jid)) {
      return null
    }

    return jid
  }

  const codigo = extrairCodigoConvite(jid)
  if (!codigo) {
    return null
  }

  try {
    if (typeof sock.groupAcceptInvite === 'function') {
      const resolved = await sock.groupAcceptInvite(codigo)
      if (resolved) {
        await recipientsDb.update({ _id: recipient._id }, { $set: { jid: resolved } })
        return resolved
      }
    }
  } catch (err) {
    console.log('Falha ao aceitar convite do destinatário:', err.message)
  }

  try {
    if (typeof sock.groupGetInviteInfo === 'function') {
      const info = await sock.groupGetInviteInfo(codigo)
      const resolved = info?.id || null
      if (resolved) {
        await recipientsDb.update({ _id: recipient._id }, { $set: { jid: resolved } })
      }
      return resolved
    }
  } catch (err) {
    console.log('Falha ao obter info do convite:', err.message)
  }

  return null
}

async function enviarMensagemPorMetaCloud(recipient, mensagem) {
  if (!isMetaCloudConfigured()) {
    throw new Error('Meta Cloud API não configurada. Preencha WA_CLOUD_PHONE_NUMBER_ID e WA_CLOUD_ACCESS_TOKEN.')
  }

  if (recipient.type !== 'private') {
    throw new Error('No modo API, envio para grupo não é suportado. Use destinatário privado.')
  }

  const numero = (recipient.destination || '').replace(/\D/g, '')
  if (!numero) {
    throw new Error('Número privado inválido para envio via API.')
  }

  const url = `https://graph.facebook.com/${WA_CLOUD_API_VERSION}/${WA_CLOUD_PHONE_NUMBER_ID}/messages`
  await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to: numero,
      type: 'text',
      text: { body: mensagem }
    },
    {
      headers: {
        Authorization: `Bearer ${WA_CLOUD_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  )
}

async function enviarMensagemDispatch(sock, recipient, mensagem) {
  if (isMetaCloudMode()) {
    await enviarMensagemPorMetaCloud(recipient, mensagem)
    return
  }

  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('WhatsApp desconectado no momento do envio. Reconecte o bot e tente novamente.')
  }

  const jidDestino = await resolverJidDestinatario(sock, recipient)
  if (!jidDestino) {
    throw new Error('Destino inválido para o tipo de destinatário. Para grupo use ID @g.us ou link de convite; para privado use número válido.')
  }

  await withTimeout(
    sock.sendMessage(jidDestino, { text: mensagem }),
    20000,
    'Timeout ao enviar mensagem no Baileys (20s).'
  )
}

async function processarFilaDisparos(sock) {

  if (processandoFila) {
    return
  }

  processandoFila = true

  try {
  if (typeof dispatchesDb.loadDatabase === 'function') {
    await dispatchesDb.loadDatabase()
  }

  if (typeof recipientsDb.loadDatabase === 'function') {
    await recipientsDb.loadDatabase()
  }

  salvarStatusBot({ lastQueueRunAt: new Date().toISOString() })

  const config = obterConfiguracoesLimiteEnvio()
  if (!podeEnviarAgora(config)) {
    return
  }

  const umaHoraAtrasIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const enviadosUltimaHora = await dispatchesDb.count({
    status: 'sent',
    sentAt: { $gte: umaHoraAtrasIso }
  })

  if (enviadosUltimaHora >= config.maxPorHora) {
    return
  }

  const agoraIso = new Date().toISOString()
  const pendentes = await dispatchesDb.find({
    status: 'pending',
    sendAt: { $lte: agoraIso }
  })

  if (!pendentes.length) {
    return
  }

  for (const item of pendentes) {
    const recipient = await recipientsDb.findOne({ _id: item.recipientId })
    if (!recipient) {
      await dispatchesDb.update(
        { _id: item._id },
        { $set: { status: 'failed', errorMessage: 'Destinatário não encontrado.' } }
      )
      continue
    }

    let mensagem = (item.messageText || '').trim()

    if (!mensagem) {
      await dispatchesDb.update(
        { _id: item._id },
        { $set: { status: 'failed', errorMessage: 'Mensagem vazia para envio.' } }
      )
      continue
    }

    try {
      await enviarMensagemDispatch(sock, recipient, mensagem)
      await dispatchesDb.update(
        { _id: item._id },
        { $set: { status: 'sent', sentAt: new Date().toISOString(), errorMessage: '' } }
      )
      salvarStatusBot({
        lastSentAt: new Date().toISOString(),
        lastError: '',
        logMessage: `Mensagem enviada para ${recipient.name || recipient.destination || recipient._id}.`,
        logLevel: 'info',
        logSource: 'dispatch'
      })

      if (config.intervaloSegundos > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.intervaloSegundos * 1000))
      }
    } catch (err) {
      await dispatchesDb.update(
        { _id: item._id },
        { $set: { status: 'failed', errorMessage: err.message || 'Falha no envio.' } }
      )
      salvarStatusBot({
        lastError: err.message || 'Falha no envio',
        logMessage: `Falha no envio para ${recipient.name || recipient.destination || recipient._id}: ${err.message || 'erro desconhecido'}`,
        logLevel: 'error',
        logSource: 'dispatch'
      })
    }
  }
  } finally {
    processandoFila = false
  }
}

async function start() {
  await initDatabase()
  salvarStatusBot({
    connected: false,
    updatedAt: new Date().toISOString(),
    logMessage: 'Inicializando processo do bot.',
    logLevel: 'info',
    logSource: 'boot'
  })
  agendarCronsUmaVez()

  if (isMetaCloudMode()) {
    if (!isMetaCloudConfigured()) {
      salvarStatusBot({
        connected: false,
        lastError: 'Modo API ativo, mas credenciais da Meta Cloud API não configuradas.',
        logMessage: 'Falha de configuração: credenciais da Meta Cloud API ausentes.',
        logLevel: 'error',
        logSource: 'config'
      })
      console.log('Modo API ativo, mas faltam credenciais WA_CLOUD_PHONE_NUMBER_ID/WA_CLOUD_ACCESS_TOKEN.')
    } else {
      salvarStatusBot({
        connected: true,
        connectionOpenedAt: new Date().toISOString(),
        lastError: '',
        logMessage: 'Bot conectado em modo API (Meta Cloud).',
        logLevel: 'info',
        logSource: 'connection'
      })
      console.log('Bot iniciado em modo API (Meta Cloud), sem necessidade de QR.')
    }

    return
  }

  if (startingBaileys) {
    return
  }

  startingBaileys = true

  try {
    const { state, saveCreds } = await useMultiFileAuthState(BAILEYS_AUTH_DIR)
    let versaoWa = null

    try {
      const versaoInfo = await fetchLatestBaileysVersion()
      versaoWa = versaoInfo?.version || null
      if (Array.isArray(versaoWa)) {
        console.log(`Usando versão WhatsApp Web ${versaoWa.join('.')} (Baileys).`)
      }
    } catch (err) {
      console.log('Não foi possível obter a versão mais recente do WhatsApp Web. Usando padrão da biblioteca.')
    }

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: P({ level: 'silent' }),
      browser: ['BlueStarBot', 'Chrome', '1.0.0'],
      version: versaoWa || undefined,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 10000,
      qrTimeout: 60000
    })

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('QR recebido. Abra o painel e escaneie o código para conectar.')
        qrcode.generate(qr, { small: true })
        QRCode.toDataURL(qr)
          .then((url) => {
            salvarStatusBot({ qrDataUrl: url, lastError: '' })
          })
          .catch((err) => {
            salvarStatusBot({ lastError: `Falha ao gerar QR: ${err.message}` })
            console.log('Falha ao gerar QR em data URL:', err.message)
          })
      }

      if (connection === 'close') {
        const statusCode = obterCodigoDesconexao(lastDisconnect)
        const mensagemErro = obterMensagemDesconexao(lastDisconnect)
        const nowMs = Date.now()
        const openedRecently = lastConnectionOpenedAtMs > 0 && (nowMs - lastConnectionOpenedAtMs) < 15000

        if (openedRecently) {
          rapidDisconnects += 1
        } else {
          rapidDisconnects = 0
        }

        if (activeSock === sock) {
          activeSock = null
        }

        salvarStatusBot({
          connected: false,
          lastError: `Conexão fechada (${statusCode || 'desconhecido'}) - ${mensagemErro}`,
          qrDataUrl: '',
          logMessage: `Conexão WhatsApp fechada (código: ${statusCode || 'desconhecido'}).`,
          logLevel: 'warn',
          logSource: 'connection'
        })

        const isConflict440 = Number(statusCode) === 440
        const precisaResetAuth =
          statusCode === DisconnectReason.loggedOut ||
          statusCode === DisconnectReason.badSession ||
          isConflict440

        if (precisaResetAuth && !authResetadoNoCiclo) {
          authResetadoNoCiclo = true
          limparAuthBaileys()
          salvarStatusBot({
            logMessage: isConflict440
              ? 'Conflito de sessão detectado (440). Resetando autenticação para gerar nova sessão estável.'
              : 'Sessão inválida detectada. Resetando autenticação para reconexão.',
            logLevel: 'warn',
            logSource: 'connection'
          })
        }

        const conflitoPersistente = isConflict440 && rapidDisconnects >= 3
        if (conflitoPersistente) {
          salvarStatusBot({
            lastError: 'Conflito de sessão (440) recorrente. Aguardando nova autenticação via QR.',
            logMessage: 'Conflito 440 recorrente detectado. Reconexão foi desacelerada para evitar loop.',
            logLevel: 'warn',
            logSource: 'connection'
          })
        }

        if (statusCode !== DisconnectReason.loggedOut) {
          if (!reconnectScheduled) {
            reconnectScheduled = true
            reconnectTentativas += 1
            const baseMs = conflitoPersistente ? 15000 : 3000
            const stepMs = conflitoPersistente ? 4000 : 2000
            const maxMs = conflitoPersistente ? 45000 : 20000
            const esperaMs = Math.min(baseMs + (reconnectTentativas - 1) * stepMs, maxMs)
            console.log(`Conexão caiu (código: ${statusCode || 'desconhecido'}). Nova tentativa em ${Math.floor(esperaMs / 1000)}s...`)
            setTimeout(() => {
              reconnectScheduled = false
              start()
            }, esperaMs)
          }
        } else {
          console.log('Sessão expirada. Um novo QR será gerado automaticamente.')
          if (!reconnectScheduled) {
            reconnectScheduled = true
            setTimeout(() => {
              reconnectScheduled = false
              start()
            }, 3000)
          }
        }
      } else if (connection === 'open') {
        reconnectTentativas = 0
        authResetadoNoCiclo = false
        rapidDisconnects = 0
        lastConnectionOpenedAtMs = Date.now()
        activeSock = sock
        console.log('Bot conectado ao WhatsApp com sucesso.')
        salvarStatusBot({
          connected: true,
          connectionOpenedAt: new Date().toISOString(),
          lastError: '',
          qrDataUrl: '',
          logMessage: 'Conexão com WhatsApp estabelecida com sucesso.',
          logLevel: 'info',
          logSource: 'connection'
        })
        try {
          await processarFilaDisparos(sock)
        } catch (err) {
          salvarStatusBot({
            lastError: err.message || 'Falha ao processar fila após reconexão.',
            logMessage: `Erro ao processar fila após reconexão: ${err.message || 'erro desconhecido'}`,
            logLevel: 'error',
            logSource: 'dispatch'
          })
        }
      }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const msg = messages[0]
        if (!msg?.message || msg.key.fromMe) return

        const from = msg.key.remoteJid
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
        const bodyNormalizado = body.trim().toLowerCase()

        if (bodyNormalizado === '!comandos') {
          await sock.sendMessage(from, {
            text: `*Comandos disponíveis:*\n\n!info  mostra informações do ciclo atual\n\n!comandos  envia essa mensagem`
          })
        } else if (bodyNormalizado === '!info') {
          const diaDoCiclo = obterDiaDoCicloAtual()
          const itemCiclo = obterMensagemDiaCiclo(diaDoCiclo)
          const cycle = loadCycleConfig()

          if (!cycle.length) {
            await sock.sendMessage(from, { text: 'Nenhum ciclo configurado. Configure no painel!' })
          } else if (itemCiclo) {
            await sock.sendMessage(from, {
              text: `*Ciclo Blue Star*\n\nDia: ${diaDoCiclo + 1}/${cycle.length}\n\nHorário: ${itemCiclo.timeHHmm}\n\nMensagem:\n${itemCiclo.message}`
            })
          }
        }
      } catch (err) {
        salvarStatusBot({
          lastError: err.message || 'Falha ao processar mensagem recebida.',
          logMessage: `Erro no listener de mensagens: ${err.message || 'erro desconhecido'}`,
          logLevel: 'error',
          logSource: 'listener'
        })
      }
    })
  } finally {
    startingBaileys = false
  }
}

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  salvarStatusBot({
    lastError: `UnhandledRejection: ${message}`,
    logMessage: `UnhandledRejection capturado: ${message}`,
    logLevel: 'error',
    logSource: 'process'
  })
  console.log('UnhandledRejection capturado:', message)
})

process.on('uncaughtException', (error) => {
  const message = error?.message || 'erro desconhecido'
  salvarStatusBot({
    lastError: `UncaughtException: ${message}`,
    logMessage: `UncaughtException capturada: ${message}`,
    logLevel: 'error',
    logSource: 'process'
  })
  console.log('UncaughtException capturada:', message)
})

setInterval(() => {
  processarComandoBotPendente().catch((err) => {
    salvarStatusBot({ lastError: `Falha ao processar comando: ${err.message}` })
  })
}, 2000)

start()