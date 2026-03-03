import express from 'express'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import fileUpload from 'express-fileupload'
import XLSX from 'xlsx'
import xml2js from 'xml2js'
import {
  recipientsDb,
  dispatchesDb,
  initDatabase,
  normalizeRecipientJid,
  parseBrDateTime,
  formatDateTimeBr,
  loadCycleConfig,
  saveCycleConfig,
  loadCycleSettings,
  saveCycleSettings,
  loadCyclesConfig,
  saveCyclesConfig
} from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || process.env.CONFIG_PORT || 3001)
const APP_WEB_ORIGIN = (process.env.APP_WEB_ORIGIN || '*').trim() || '*'

const ENV_PATH = path.join(__dirname, '.env')
const ENV_EXAMPLE_PATH = path.join(__dirname, 'env-example')
const BOT_STATUS_PATH = path.join(__dirname, 'data', 'bot-status.json')
const BOT_COMMAND_PATH = path.join(__dirname, 'data', 'bot-command.json')
const BOT_PROCESS_PATH = path.join(__dirname, 'data', 'bot-process.json')
const BAILEYS_AUTH_DIR = path.join(__dirname, 'baileys-auth')
let botStartInProgress = false

const CAMPOS_ENV = [
  'SEND_PROVIDER',
  'NUMERO_BOT',
  'BLUE_STAR_GROUP_ID',
  'BLUE_STAR_GROUP_INVITE_LINK',
  'BLUE_STAR_CICLO_INICIO',
  'BLUE_STAR_HORARIO_BR',
  'WA_CLOUD_API_VERSION',
  'WA_CLOUD_PHONE_NUMBER_ID',
  'WA_CLOUD_ACCESS_TOKEN',
  'SEND_MIN_INTERVAL_SECONDS',
  'SEND_MAX_PER_HOUR',
  'SEND_ALLOWED_START_HOUR',
  'SEND_ALLOWED_END_HOUR',
  'CONFIG_PORT',
  'APP_WEB_ORIGIN'
]

function parseEnvFile() {
  const fonte = fs.existsSync(ENV_PATH) ? ENV_PATH : ENV_EXAMPLE_PATH
  if (!fs.existsSync(fonte)) {
    return {}
  }

  const raw = fs.readFileSync(fonte, 'utf-8')
  return dotenv.parse(raw)
}

function salvarEnv(envData) {
  const linhas = CAMPOS_ENV.map((chave) => `${chave}=${(envData[chave] || '').toString().trim()}`)
  fs.writeFileSync(ENV_PATH, `${linhas.join('\n')}\n`, 'utf-8')
}

function validarPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Payload inválido.'
  }

  if (!payload.env || typeof payload.env !== 'object') {
    return 'Dados de ambiente inválidos.'
  }

  const dataInicio = (payload.env.BLUE_STAR_CICLO_INICIO || '').trim()
  if (dataInicio && !/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
    return 'A data do início do ciclo deve estar no formato YYYY-MM-DD.'
  }

  const horario = (payload.env.BLUE_STAR_HORARIO_BR || '').trim()
  if (horario && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(horario)) {
    return 'O horário deve estar no formato brasileiro HH:mm (ex.: 09:30).'
  }

  const groupId = (payload.env.BLUE_STAR_GROUP_ID || '').trim()
  const inviteLink = (payload.env.BLUE_STAR_GROUP_INVITE_LINK || '').trim()
  const provider = (payload.env.SEND_PROVIDER || 'baileys').trim().toLowerCase()

  if (!['baileys', 'meta-cloud'].includes(provider)) {
    return 'SEND_PROVIDER inválido. Use baileys ou meta-cloud.'
  }

  if (provider === 'baileys') {
    if (inviteLink && !/chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(inviteLink)) {
      return 'O link de convite precisa estar no formato https://chat.whatsapp.com/...'
    }
  }

  if (provider === 'meta-cloud') {
    const phoneId = (payload.env.WA_CLOUD_PHONE_NUMBER_ID || '').trim()
    const token = (payload.env.WA_CLOUD_ACCESS_TOKEN || '').trim()
    if (!phoneId || !token) {
      return 'No modo meta-cloud, preencha WA_CLOUD_PHONE_NUMBER_ID e WA_CLOUD_ACCESS_TOKEN.'
    }
  }

  const fields = [
    ['SEND_MIN_INTERVAL_SECONDS', 0, 3600],
    ['SEND_MAX_PER_HOUR', 1, 500],
    ['SEND_ALLOWED_START_HOUR', 0, 23],
    ['SEND_ALLOWED_END_HOUR', 0, 23]
  ]

  for (const [key, min, max] of fields) {
    const raw = sanitizeText(payload.env[key])
    if (!raw) continue
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      return `${key} inválido.`
    }
  }

  return null
}

function sanitizeText(value) {
  return (value || '').toString().trim()
}

function normalizePrivateDestinationBr(input) {
  const value = (input || '').toString().trim()
  if (!value) return ''

  let digits = value.replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('00')) {
    digits = digits.slice(2)
  }

  if (digits.startsWith('55')) {
    if (digits.length === 14 && digits[2] === '0') {
      digits = `55${digits.slice(3)}`
    }
  } else if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`
  } else {
    return ''
  }

  if (digits.length !== 12 && digits.length !== 13) {
    return ''
  }

  const ddd = digits.slice(2, 4)
  const local = digits.slice(4)

  if (local.length === 8) {
    return `+55 (${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`
  }

  return `+55 (${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`
}

async function migrarDestinatariosPrivadosPadraoBr() {
  try {
    const recipients = await recipientsDb.find({ type: 'private' })
    const list = Array.isArray(recipients) ? recipients : []

    let updated = 0
    let skippedInvalid = 0
    let skippedDuplicate = 0

    for (const recipient of list) {
      const currentDestination = sanitizeText(recipient?.destination)
      const baseValue = currentDestination || sanitizeText(recipient?.jid).replace('@s.whatsapp.net', '')

      const normalizedDestination = normalizePrivateDestinationBr(baseValue)
      const normalizedJid = normalizeRecipientJid('private', baseValue)

      if (!normalizedDestination || !normalizedJid) {
        skippedInvalid += 1
        continue
      }

      const hasChanged = normalizedDestination !== currentDestination || normalizedJid !== recipient?.jid
      if (!hasChanged) {
        continue
      }

      const existing = await recipientsDb.findOne({ jid: normalizedJid })
      if (existing && existing._id !== recipient._id) {
        skippedDuplicate += 1
        continue
      }

      await recipientsDb.update(
        { _id: recipient._id },
        {
          $set: {
            destination: normalizedDestination,
            jid: normalizedJid
          }
        }
      )

      updated += 1
    }

    if (updated > 0 || skippedInvalid > 0 || skippedDuplicate > 0) {
      console.log(`[MIGRACAO] Destinatarios privados BR -> atualizados: ${updated}, ignorados invalidos: ${skippedInvalid}, ignorados duplicados: ${skippedDuplicate}`)
    }
  } catch (error) {
    console.log('[MIGRACAO] Falha ao migrar destinatarios privados para padrao BR:', error.message)
  }
}

function normalizeCycleName(value, fallback = 'Novo ciclo') {
  const cleaned = sanitizeText(value)
  return cleaned || fallback
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readBotProcessMeta() {
  if (!fs.existsSync(BOT_PROCESS_PATH)) {
    return { pid: 0, startedAt: '' }
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(BOT_PROCESS_PATH, 'utf-8'))
    return {
      pid: Number(parsed?.pid || 0),
      startedAt: sanitizeText(parsed?.startedAt)
    }
  } catch {
    return { pid: 0, startedAt: '' }
  }
}

function writeBotProcessMeta(meta) {
  fs.writeFileSync(BOT_PROCESS_PATH, JSON.stringify(meta, null, 2), 'utf-8')
}

function startBotProcess() {
  const child = spawn(process.execPath, ['bot.js'], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })

  child.unref()

  writeBotProcessMeta({
    pid: child.pid,
    startedAt: new Date().toISOString()
  })

  return child.pid
}

function stopBotProcess(pid) {
  if (!processIsRunning(pid)) {
    return false
  }

  try {
    process.kill(pid)
    return true
  } catch {
    return false
  }
}

function ensureBotStartedOnBoot() {
  try {
    const current = readBotProcessMeta()
    if (processIsRunning(current.pid)) {
      return
    }

    const pid = startBotProcess()
    console.log(`Bot iniciado automaticamente na subida do backend (PID: ${pid}).`)
  } catch (error) {
    console.log(`Falha ao iniciar bot automaticamente: ${error.message}`)
  }
}

function parseDispatchPayload(body) {
  const recipientIdsInput = Array.isArray(body.recipientIds)
    ? body.recipientIds.map((id) => sanitizeText(id)).filter(Boolean)
    : []
  const recipientIdFallback = sanitizeText(body.recipientId)
  const recipientIds = recipientIdsInput.length
    ? Array.from(new Set(recipientIdsInput))
    : (recipientIdFallback ? [recipientIdFallback] : [])
  const sourceType = sanitizeText(body.sourceType) || 'manual'
  const cycleDay = Number(sanitizeText(body.cycleDay) || '0')
  const messageText = sanitizeText(body.messageText)
  const mode = sanitizeText(body.mode) || 'manual-now'
  const sendAtBr = sanitizeText(body.sendAtBr)

  if (!recipientIds.length) {
    return { error: 'Selecione pelo menos um destinatário.' }
  }

  if (!['manual', 'cycle'].includes(sourceType)) {
    return { error: 'Tipo de mensagem inválido.' }
  }

  const cicloConfigurado = loadCycleConfig()
  const totalDiasCiclo = cicloConfigurado.length

  if (sourceType === 'cycle' && totalDiasCiclo <= 0) {
    return { error: 'Nenhum dia configurado no ciclo de mensagens.' }
  }

  if (sourceType === 'cycle' && (cycleDay < 1 || cycleDay > totalDiasCiclo)) {
    return { error: 'Selecione um dia válido da central de mensagens.' }
  }

  if (sourceType === 'manual' && !messageText) {
    return { error: 'Informe uma mensagem manual para envio.' }
  }

  let sendAtDate = new Date()
  if (mode === 'scheduled') {
    sendAtDate = parseBrDateTime(sendAtBr)
    if (!sendAtDate) {
      return { error: 'Data/hora inválida. Use DD/MM/AAAA HH:mm.' }
    }

    if (sendAtDate.getTime() <= Date.now()) {
      return { error: 'A data/hora agendada precisa ser no futuro.' }
    }
  }

  let finalMessage = messageText
  if (sourceType === 'cycle') {
    const diaConfigurado = cicloConfigurado[cycleDay - 1]
    if (diaConfigurado?.isActive === false) {
      return { error: 'O dia selecionado está inativo no ciclo.' }
    }

    finalMessage = sanitizeText(diaConfigurado?.message)
    if (!finalMessage) {
      return { error: 'A mensagem do dia selecionado está vazia.' }
    }
  }

  return {
    recipientIds,
    sourceType,
    cycleDay,
    messageText: finalMessage,
    mode,
    sendAt: sendAtDate.toISOString()
  }
}

async function sincronizarBancos() {
  if (typeof recipientsDb.loadDatabase === 'function') {
    await recipientsDb.loadDatabase()
  }

  if (typeof dispatchesDb.loadDatabase === 'function') {
    await dispatchesDb.loadDatabase()
  }
}

app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', APP_WEB_ORIGIN)
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }

  next()
})
app.use(express.static(path.join(__dirname, 'public')))
app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }))
app.use('/api', (req, _res, next) => {
  _res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  _res.setHeader('Pragma', 'no-cache')
  _res.setHeader('Expires', '0')
  sincronizarBancos()
    .then(() => next())
    .catch((err) => {
      console.log('Falha ao sincronizar banco em memória:', err.message)
      next()
    })
})

app.get('/api/recipients', async (_req, res) => {
  try {
    const items = await recipientsDb.find({}).sort({ createdAt: -1 })
    const mapped = (Array.isArray(items) ? items : []).map((item) => ({
      ...item,
      isDefault: Boolean(item.isDefault),
      isCycleTarget: Boolean(item.isCycleTarget)
    }))
    res.json(mapped)
  } catch (error) {
    res.status(500).json({ ok: false, message: `Falha ao carregar destinatários: ${error.message}` })
  }
})

app.post('/api/recipients', async (req, res) => {
  try {
    const name = sanitizeText(req.body?.name)
    const type = sanitizeText(req.body?.type) || 'private'
    const destinationRaw = sanitizeText(req.body?.destination)
    const destination = type === 'private'
      ? normalizePrivateDestinationBr(destinationRaw)
      : destinationRaw

    if (!name) {
      res.status(400).json({ ok: false, message: 'Informe o nome do destinatário.' })
      return
    }

    if (!['private', 'group'].includes(type)) {
      res.status(400).json({ ok: false, message: 'Tipo inválido.' })
      return
    }

    if (!destinationRaw) {
      res.status(400).json({ ok: false, message: 'Informe o número ou ID/link do grupo.' })
      return
    }

    const jid = normalizeRecipientJid(type, destination)
    if (!jid) {
      if (type === 'group') {
        res.status(400).json({ ok: false, message: 'Para grupo, informe um ID terminado com @g.us ou um link de convite do WhatsApp.' })
        return
      }

      res.status(400).json({ ok: false, message: 'Número inválido. Use padrão brasileiro com DDD (ex.: 34999998888 ou +55 (34) 99999-8888).' })
      return
    }

    const existingCount = await recipientsDb.count({})
    const item = await recipientsDb.insert({
      name,
      type,
      destination,
      jid,
      isDefault: existingCount === 0,
      isCycleTarget: false
    })

    res.json({ ok: true, item })
  } catch (error) {
    const code = String(error?.code || '')
    if (code === '23505') {
      res.status(409).json({ ok: false, message: 'Este destinatário já está cadastrado.' })
      return
    }

    res.status(500).json({ ok: false, message: `Falha ao adicionar destinatário: ${error.message}` })
  }
})

app.post('/api/import-recipients', async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      res.status(400).json({ ok: false, message: 'Nenhum arquivo foi enviado.' })
      return
    }

    const file = req.files.file
    const filename = file.name.toLowerCase()
    let recipients = []

    if (filename.endsWith('.json')) {
      const jsonData = JSON.parse(file.data.toString('utf-8'))
      recipients = Array.isArray(jsonData) ? jsonData : (jsonData.recipients || [])
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const workbook = XLSX.read(file.data, { type: 'buffer' })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) {
        res.status(400).json({ ok: false, message: 'Arquivo Excel vazio ou sem abas.' })
        return
      }
      const worksheet = workbook.Sheets[sheetName]
      recipients = XLSX.utils.sheet_to_json(worksheet)
    } else if (filename.endsWith('.xml')) {
      const xmlParser = new xml2js.Parser({ explicitArray: false })
      const xmlData = await xmlParser.parseStringPromise(file.data.toString('utf-8'))
      recipients = xmlData.recipients?.recipient || []
      if (!Array.isArray(recipients)) {
        recipients = [recipients]
      }
    } else {
      res.status(400).json({ ok: false, message: 'Formato não suportado. Use JSON, XLSX ou XML.' })
      return
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ ok: false, message: 'Nenhum destinatário encontrado no arquivo.' })
      return
    }

    const results = {
      imported: [],
      errors: [],
      duplicates: []
    }

    for (let i = 0; i < recipients.length; i++) {
      const item = recipients[i]
      const name = sanitizeText(item.name || item.nome || '')
      const type = sanitizeText(item.type || item.tipo || 'private')
      const destinationRaw = sanitizeText(item.destination || item.destino || item.numero || item.number || '')
      const destination = type === 'private'
        ? normalizePrivateDestinationBr(destinationRaw)
        : destinationRaw

      if (!name) {
        results.errors.push({
          row: i + 2,
          reason: 'Nome não informado'
        })
        continue
      }

      if (!['private', 'group'].includes(type)) {
        results.errors.push({
          row: i + 2,
          reason: `Tipo inválido: ${type}. Use 'private' ou 'group'`
        })
        continue
      }

      if (!destinationRaw) {
        results.errors.push({
          row: i + 2,
          reason: 'Destino não informado'
        })
        continue
      }

      const jid = normalizeRecipientJid(type, destination)
      if (!jid) {
        results.errors.push({
          row: i + 2,
          reason: type === 'group' 
            ? 'Grupo inválido. Use ID com @g.us ou link de convite'
            : 'Número inválido. Use padrão BR com DDD (ex.: 34999998888)'
        })
        continue
      }

      try {
        const existing = await recipientsDb.findOne({ jid })
        if (existing) {
          results.duplicates.push({
            name,
            jid,
            message: 'Já existe destinatário com este JID'
          })
          continue
        }

        const insertedItem = await recipientsDb.insert({
          name,
          type,
          destination,
          jid,
          isDefault: false,
          isCycleTarget: false
        })

        results.imported.push({
          name,
          type,
          jid
        })
      } catch (error) {
        results.errors.push({
          row: i + 2,
          reason: `Erro ao importar: ${error.message}`
        })
      }
    }

    res.json({
      ok: true,
      message: `Importação concluída: ${results.imported.length} importado(s), ${results.duplicates.length} duplicado(s), ${results.errors.length} erro(s)`,
      results
    })
  } catch (error) {
    console.error('Erro ao importar destinatários:', error)
    res.status(500).json({ ok: false, message: `Falha na importação: ${error.message}` })
  }
})

app.post('/api/recipients/:id/cycle-target', async (req, res) => {
  const id = sanitizeText(req.params.id)
  if (!id) {
    res.status(400).json({ ok: false, message: 'ID do destinatário inválido.' })
    return
  }

  const exists = await recipientsDb.findOne({ _id: id })
  if (!exists) {
    res.status(404).json({ ok: false, message: 'Destinatário não encontrado.' })
    return
  }

  if (exists.type !== 'group') {
    res.status(400).json({ ok: false, message: 'O destino diário (1 a 15) deve ser um destinatário de grupo.' })
    return
  }

  await recipientsDb.update({}, { $set: { isCycleTarget: false } }, { multi: true })
  await recipientsDb.update({ _id: id }, { $set: { isCycleTarget: true } })
  res.json({ ok: true })
})

app.post('/api/recipients/:id/default', async (req, res) => {
  const id = sanitizeText(req.params.id)
  if (!id) {
    res.status(400).json({ ok: false, message: 'ID do destinatário inválido.' })
    return
  }

  const exists = await recipientsDb.findOne({ _id: id })
  if (!exists) {
    res.status(404).json({ ok: false, message: 'Destinatário não encontrado.' })
    return
  }

  await recipientsDb.update({}, { $set: { isDefault: false } }, { multi: true })
  await recipientsDb.update({ _id: id }, { $set: { isDefault: true } })
  res.json({ ok: true })
})

app.delete('/api/recipients/:id', async (req, res) => {
  const id = sanitizeText(req.params.id)
  await recipientsDb.remove({ _id: id }, {})
  res.json({ ok: true })
})

app.put('/api/recipients/:id', async (req, res) => {
  const id = sanitizeText(req.params.id)
  const name = sanitizeText(req.body?.name)
  const type = sanitizeText(req.body?.type) || 'private'
  const destinationRaw = sanitizeText(req.body?.destination)
  const destination = type === 'private'
    ? normalizePrivateDestinationBr(destinationRaw)
    : destinationRaw

  if (!id) {
    res.status(400).json({ ok: false, message: 'ID do destinatário inválido.' })
    return
  }

  if (!name) {
    res.status(400).json({ ok: false, message: 'Informe o nome do destinatário.' })
    return
  }

  if (!['private', 'group'].includes(type)) {
    res.status(400).json({ ok: false, message: 'Tipo inválido.' })
    return
  }

  if (!destinationRaw) {
    res.status(400).json({ ok: false, message: 'Informe o destino do destinatário.' })
    return
  }

  const current = await recipientsDb.findOne({ _id: id })
  if (!current) {
    res.status(404).json({ ok: false, message: 'Destinatário não encontrado.' })
    return
  }

  const jid = normalizeRecipientJid(type, destination)
  if (!jid) {
    if (type === 'group') {
      res.status(400).json({ ok: false, message: 'Para grupo, informe um ID terminado com @g.us ou um link de convite do WhatsApp.' })
      return
    }

    res.status(400).json({ ok: false, message: 'Número inválido. Use padrão brasileiro com DDD (ex.: 34999998888 ou +55 (34) 99999-8888).' })
    return
  }

  const isCycleTarget = current.isCycleTarget && type === 'group'

  await recipientsDb.update(
    { _id: id },
    {
      $set: {
        name,
        type,
        destination,
        jid,
        isCycleTarget
      }
    }
  )

  const item = await recipientsDb.findOne({ _id: id })
  res.json({ ok: true, item })
})

app.get('/api/dispatches', async (_req, res) => {
  try {
    const items = await dispatchesDb.find({}).sort({ createdAt: -1 }).limit(100)

    const mapped = []
    for (const item of (Array.isArray(items) ? items : [])) {
      const recipient = await recipientsDb.findOne({ _id: item.recipientId })

      mapped.push({
        ...item,
        sendAtBr: formatDateTimeBr(item.sendAt),
        sentAtBr: item.sentAt ? formatDateTimeBr(item.sentAt) : '',
        recipientName: recipient?.name || 'Removido',
        recipientJid: recipient?.jid || ''
      })
    }

    res.json(mapped)
  } catch (error) {
    res.status(500).json({ ok: false, message: `Falha ao carregar disparos: ${error.message}` })
  }
})

app.post('/api/dispatches', async (req, res) => {
  const parsed = parseDispatchPayload(req.body || {})
  if (parsed.error) {
    res.status(400).json({ ok: false, message: parsed.error })
    return
  }

  const recipients = await recipientsDb.find({ _id: { $in: parsed.recipientIds } })
  const recipientIdsFound = new Set(recipients.map((recipient) => recipient._id))
  const missingRecipient = parsed.recipientIds.find((id) => !recipientIdsFound.has(id))
  if (missingRecipient) {
    res.status(400).json({ ok: false, message: 'Um ou mais destinatários não foram encontrados.' })
    return
  }

  const items = []
  for (const recipientId of parsed.recipientIds) {
    const item = await dispatchesDb.insert({
      recipientId,
      sourceType: parsed.sourceType,
      cycleDay: parsed.cycleDay,
      messageText: parsed.messageText,
      mode: parsed.mode,
      sendAt: parsed.sendAt,
      status: 'pending',
      sentAt: '',
      errorMessage: ''
    })
    items.push(item)
  }

  res.json({ ok: true, items, createdCount: items.length })
})

app.get('/api/bot-status', (_req, res) => {
  if (!fs.existsSync(BOT_STATUS_PATH)) {
    res.json({
      connected: false,
      updatedAt: '',
      connectionOpenedAt: '',
      lastError: 'Bot ainda não iniciou.',
      lastQueueRunAt: '',
      lastSentAt: '',
      events: []
    })
    return
  }

  try {
    const status = JSON.parse(fs.readFileSync(BOT_STATUS_PATH, 'utf-8'))
    res.json(status)
  } catch {
    res.status(500).json({
      connected: false,
      lastError: 'Falha ao ler status do bot.'
    })
  }
})

app.get('/api/bot-qr', (_req, res) => {
  if (!fs.existsSync(BOT_STATUS_PATH)) {
    res.json({ connected: false, qrDataUrl: '' })
    return
  }

  try {
    const status = JSON.parse(fs.readFileSync(BOT_STATUS_PATH, 'utf-8'))
    res.json({
      connected: Boolean(status.connected),
      qrDataUrl: status.qrDataUrl || '',
      updatedAt: status.updatedAt || ''
    })
  } catch {
    res.status(500).json({ connected: false, qrDataUrl: '' })
  }
})

app.post('/api/bot-disconnect', (_req, res) => {
  try {
    if (fs.existsSync(BAILEYS_AUTH_DIR)) {
      fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true })
    }

    let currentStatus = {
      connected: false,
      connectionOpenedAt: '',
      lastQueueRunAt: '',
      lastSentAt: '',
      qrDataUrl: ''
    }

    if (fs.existsSync(BOT_STATUS_PATH)) {
      try {
        currentStatus = {
          ...currentStatus,
          ...JSON.parse(fs.readFileSync(BOT_STATUS_PATH, 'utf-8'))
        }
      } catch {
      }
    }

    const updatedStatus = {
      ...currentStatus,
      connected: false,
      qrDataUrl: '',
      lastError: 'Sessão desconectada manualmente. Aguarde alguns segundos para gerar novo QR.',
      events: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          level: 'warn',
          source: 'panel',
          message: 'Sessão desconectada manualmente no painel.'
        },
        ...(Array.isArray(currentStatus.events) ? currentStatus.events : [])
      ].slice(0, 200),
      updatedAt: new Date().toISOString()
    }

    fs.writeFileSync(BOT_STATUS_PATH, JSON.stringify(updatedStatus, null, 2), 'utf-8')
    fs.writeFileSync(
      BOT_COMMAND_PATH,
      JSON.stringify({ action: 'disconnect', requestedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    )
    res.json({ ok: true, message: 'Sessão do QR desconectada com sucesso.' })
  } catch (error) {
    res.status(500).json({ ok: false, message: `Falha ao desconectar sessão: ${error.message}` })
  }
})

app.post('/api/bot-start', (_req, res) => {
  try {
    if (botStartInProgress) {
      res.status(409).json({ ok: false, message: 'Inicialização do bot já está em andamento. Aguarde alguns segundos.' })
      return
    }

    botStartInProgress = true

    const current = readBotProcessMeta()
    if (processIsRunning(current.pid)) {
      botStartInProgress = false
      res.json({ ok: true, message: 'Bot já está em execução.', pid: current.pid })
      return
    }

    const pid = startBotProcess()
    setTimeout(() => {
      botStartInProgress = false
    }, 8000)

    res.json({ ok: true, message: 'Bot iniciado em segundo plano.', pid })
  } catch (error) {
    botStartInProgress = false
    res.status(500).json({ ok: false, message: `Falha ao iniciar bot: ${error.message}` })
  }
})

app.post('/api/bot-restart-safe', (_req, res) => {
  try {
    if (botStartInProgress) {
      res.status(409).json({ ok: false, message: 'Inicialização/reinício do bot já está em andamento. Aguarde alguns segundos.' })
      return
    }

    botStartInProgress = true

    const current = readBotProcessMeta()
    if (processIsRunning(current.pid)) {
      stopBotProcess(current.pid)
    }

    const pid = startBotProcess()
    setTimeout(() => {
      botStartInProgress = false
    }, 8000)

    res.json({ ok: true, message: 'Bot reiniciado com sessão preservada.', pid })
  } catch (error) {
    botStartInProgress = false
    res.status(500).json({ ok: false, message: `Falha ao reiniciar bot com segurança: ${error.message}` })
  }
})

app.post('/api/test-dispatch', async (req, res) => {
  const recipientId = sanitizeText(req.body?.recipientId)
  if (!recipientId) {
    res.status(400).json({ ok: false, message: 'Selecione um destinatário para o teste.' })
    return
  }

  const recipient = await recipientsDb.findOne({ _id: recipientId })
  if (!recipient) {
    res.status(400).json({ ok: false, message: 'Destinatário não encontrado.' })
    return
  }

  const item = await dispatchesDb.insert({
    recipientId,
    sourceType: 'manual',
    cycleDay: 0,
    messageText: `Teste de conexão do bot ✅\nData/hora: ${new Date().toLocaleString('pt-BR')}`,
    mode: 'manual-now',
    sendAt: new Date().toISOString(),
    status: 'pending',
    sentAt: '',
    errorMessage: ''
  })

  res.json({ ok: true, item })
})

app.get('/api/config', (_req, res) => {
  const envLido = parseEnvFile()
  const env = {}

  for (const campo of CAMPOS_ENV) {
    env[campo] = envLido[campo] || ''
  }

  if (!env.CONFIG_PORT) {
    env.CONFIG_PORT = String(PORT)
  }

  if (!env.SEND_PROVIDER) {
    env.SEND_PROVIDER = 'baileys'
  }

  if (!env.WA_CLOUD_API_VERSION) {
    env.WA_CLOUD_API_VERSION = 'v21.0'
  }

  if (!env.SEND_MIN_INTERVAL_SECONDS) {
    env.SEND_MIN_INTERVAL_SECONDS = '20'
  }

  if (!env.SEND_MAX_PER_HOUR) {
    env.SEND_MAX_PER_HOUR = '40'
  }

  if (!env.SEND_ALLOWED_START_HOUR) {
    env.SEND_ALLOWED_START_HOUR = '8'
  }

  if (!env.SEND_ALLOWED_END_HOUR) {
    env.SEND_ALLOWED_END_HOUR = '20'
  }

  res.json({
    env,
    messages: [],
    totalDias: loadCycleConfig().length
  })
})

app.post('/api/config', (req, res) => {
  const erro = validarPayload(req.body)
  if (erro) {
    res.status(400).json({ ok: false, message: erro })
    return
  }

  const envAtual = parseEnvFile()
  const envFinal = { ...envAtual, ...req.body.env }

  salvarEnv(envFinal)

  res.json({ ok: true, message: 'Configurações salvas com sucesso.' })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/cycle', (_req, res) => {
  const cycleId = sanitizeText(_req.query?.cycleId)
  const cycles = loadCyclesConfig()
  const selected = cycleId
    ? cycles.find((item) => item.id === cycleId)
    : (cycles.find((item) => item.isSelected) || cycles[0])

  if (!selected) {
    res.status(404).json({ ok: false, message: 'Nenhum ciclo encontrado.' })
    return
  }

  const cycle = loadCycleConfig(selected.id)
  const settings = loadCycleSettings(selected.id)
  res.json({
    ok: true,
    cycleId: selected.id,
    cycleName: selected.name,
    cycle,
    settings
  })
})

app.post('/api/cycle', (req, res) => {
  try {
    const cycleId = sanitizeText(req.body?.cycleId)
    const cycle = req.body.cycle || []
    const settingsInput = req.body.settings || null
    
    // Validação básica
    if (!Array.isArray(cycle)) {
      return res.status(400).json({ ok: false, message: 'Ciclo deve ser um array.' })
    }

    for (let i = 0; i < cycle.length; i++) {
      const item = cycle[i]
      if (!item.message || typeof item.message !== 'string') {
        return res.status(400).json({ ok: false, message: `Dia ${i + 1}: mensagem obrigatória.` })
      }
      if (!item.timeHHmm || !/^\d{2}:\d{2}$/.test(item.timeHHmm)) {
        return res.status(400).json({ ok: false, message: `Dia ${i + 1}: horário inválido (use HH:mm).` })
      }
      if (typeof item.isActive !== 'undefined' && typeof item.isActive !== 'boolean') {
        return res.status(400).json({ ok: false, message: `Dia ${i + 1}: status ativo/inativo inválido.` })
      }
    }

    if (settingsInput) {
      const startDate = sanitizeText(settingsInput.startDate)
      if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return res.status(400).json({ ok: false, message: 'Data de início inválida. Use YYYY-MM-DD.' })
      }

      if (typeof settingsInput.isActive !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Campo de status ativo/inativo inválido.' })
      }

      const rawInterval = Number(settingsInput.repeatIntervalDays)
      if (settingsInput.repeatIntervalDays !== undefined && (!Number.isFinite(rawInterval) || rawInterval < 1)) {
        return res.status(400).json({ ok: false, message: 'Intervalo de repetição deve ser um número >= 1.' })
      }
    }

    const cycleNormalized = cycle.map((item) => ({
      message: sanitizeText(item.message),
      timeHHmm: sanitizeText(item.timeHHmm),
      isActive: item.isActive !== false
    }))

    saveCycleConfig(cycleNormalized, cycleId)
    if (settingsInput) {
      const repeatInterval = Math.max(1, Math.floor(Number(settingsInput.repeatIntervalDays) || 1))
      const recipientsNorm = Array.isArray(settingsInput.recipients)
        ? settingsInput.recipients.map((id) => sanitizeText(id)).filter(Boolean)
        : []

      saveCycleSettings({
        startDate: sanitizeText(settingsInput.startDate),
        isActive: Boolean(settingsInput.isActive),
        repeatIntervalDays: repeatInterval,
        recipients: recipientsNorm
      }, cycleId)
    }

    res.json({ ok: true, message: 'Ciclo atualizado com sucesso.' })
  } catch (error) {
    console.error('Erro ao atualizar ciclo:', error)
    res.status(500).json({ ok: false, message: 'Erro ao atualizar ciclo.' })
  }
})

app.get('/api/cycles', (_req, res) => {
  const cycles = loadCyclesConfig().map((cycle) => ({
    id: cycle.id,
    name: cycle.name,
    isSelected: Boolean(cycle.isSelected),
    daysCount: Array.isArray(cycle.days) ? cycle.days.length : 0,
    settings: {
      startDate: cycle.settings?.startDate || '',
      isActive: cycle.settings?.isActive !== false,
      repeatIntervalDays: cycle.settings?.repeatIntervalDays || 1
    }
  }))

  res.json({ ok: true, cycles })
})

app.post('/api/cycles', (req, res) => {
  const cycles = loadCyclesConfig()
  const name = normalizeCycleName(req.body?.name, `Ciclo ${cycles.length + 1}`)
  const now = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  const id = `cycle-${now}-${random}`

  const newCycle = {
    id,
    name,
    isSelected: false,
    settings: {
      startDate: new Date().toISOString().slice(0, 10),
      isActive: true,
      repeatIntervalDays: 1
    },
    days: []
  }

  saveCyclesConfig([...cycles, newCycle])
  res.status(201).json({ ok: true, cycle: newCycle })
})

app.post('/api/cycles/:cycleId/activate', (req, res) => {
  const cycleId = sanitizeText(req.params.cycleId)
  const cycles = loadCyclesConfig()
  const exists = cycles.some((item) => item.id === cycleId)

  if (!exists) {
    res.status(404).json({ ok: false, message: 'Ciclo não encontrado.' })
    return
  }

  const updated = cycles.map((item) => ({
    ...item,
    isSelected: item.id === cycleId
  }))

  saveCyclesConfig(updated)
  res.json({ ok: true, message: 'Ciclo ativo atualizado.' })
})

app.delete('/api/cycles/:cycleId', (req, res) => {
  const cycleId = sanitizeText(req.params.cycleId)
  const cycles = loadCyclesConfig()

  if (cycles.length <= 1) {
    res.status(400).json({ ok: false, message: 'É necessário manter ao menos um ciclo.' })
    return
  }

  const exists = cycles.some((item) => item.id === cycleId)
  if (!exists) {
    res.status(404).json({ ok: false, message: 'Ciclo não encontrado.' })
    return
  }

  const filtered = cycles.filter((item) => item.id !== cycleId)
  saveCyclesConfig(filtered)
  res.json({ ok: true, message: 'Ciclo removido com sucesso.' })
})

initDatabase().then(async () => {
  await migrarDestinatariosPrivadosPadraoBr()
  ensureBotStartedOnBoot()
  app.listen(PORT, () => {
    console.log(`Painel de configuração disponível em http://localhost:${PORT}`)
  })
})
