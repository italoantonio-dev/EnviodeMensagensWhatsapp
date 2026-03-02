import fs from 'fs'
import path from 'path'
import Datastore from 'nedb-promises'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.join(__dirname, 'data')
const DATA_PROVIDER = (process.env.DATA_PROVIDER || 'nedb').toString().trim().toLowerCase()
const USE_SUPABASE = DATA_PROVIDER === 'supabase'
const SUPABASE_URL = (process.env.SUPABASE_URL || '').toString().trim()
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').toString().trim()
const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)

const TABLE_MAP = {
  recipients: {
    tableName: 'recipients',
    toDb: {
      _id: 'id',
      name: 'name',
      type: 'type',
      destination: 'destination',
      jid: 'jid',
      isDefault: 'is_default',
      isCycleTarget: 'is_cycle_target',
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  },
  dispatches: {
    tableName: 'dispatches',
    toDb: {
      _id: 'id',
      recipientId: 'recipient_id',
      sourceType: 'source_type',
      cycleDay: 'cycle_day',
      messageText: 'message_text',
      mode: 'mode',
      sendAt: 'send_at',
      status: 'status',
      sentAt: 'sent_at',
      errorMessage: 'error_message',
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
}

function getTableMeta(entity) {
  const meta = TABLE_MAP[entity]
  if (!meta) {
    throw new Error(`Tabela não mapeada para entidade: ${entity}`)
  }
  return meta
}

function toAppDoc(entity, dbDoc) {
  if (!dbDoc || typeof dbDoc !== 'object') {
    return null
  }

  const { toDb } = getTableMeta(entity)
  const toApp = Object.entries(toDb).reduce((acc, [appKey, dbKey]) => {
    acc[dbKey] = appKey
    return acc
  }, {})

  const result = {}
  Object.entries(dbDoc).forEach(([dbKey, value]) => {
    const appKey = toApp[dbKey] || dbKey
    result[appKey] = value
  })

  return result
}

function toDbDoc(entity, appDoc) {
  const { toDb } = getTableMeta(entity)
  const result = {}

  Object.entries(appDoc || {}).forEach(([key, value]) => {
    const dbKey = toDb[key] || key
    if (typeof value === 'undefined') {
      return
    }

    let finalValue = value

    if (entity === 'dispatches' && dbKey === 'sent_at' && (finalValue === '' || finalValue === null)) {
      finalValue = null
    }

    if ((dbKey === 'created_at' || dbKey === 'updated_at' || dbKey === 'send_at') && finalValue === '') {
      finalValue = null
    }

    result[dbKey] = finalValue
  })

  return result
}

function mapQueryToDb(entity, query = {}) {
  const { toDb } = getTableMeta(entity)
  const mapped = {}
  Object.entries(query || {}).forEach(([key, value]) => {
    const dbKey = toDb[key] || key
    mapped[dbKey] = value
  })
  return mapped
}

function applySupabaseFilters(builder, mappedQuery) {
  let current = builder
  Object.entries(mappedQuery || {}).forEach(([column, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(value.$in)) {
        current = current.in(column, value.$in)
      }
      if (typeof value.$gte !== 'undefined') {
        current = current.gte(column, value.$gte)
      }
      if (typeof value.$lte !== 'undefined') {
        current = current.lte(column, value.$lte)
      }
      return
    }

    current = current.eq(column, value)
  })

  return current
}

class SupabaseQuery {
  constructor(adapter, entity, query) {
    this.adapter = adapter
    this.entity = entity
    this.query = query || {}
    this.sortConfig = null
    this.limitValue = null
  }

  sort(config) {
    this.sortConfig = config || null
    return this
  }

  limit(limitValue) {
    this.limitValue = Number(limitValue)
    return this
  }

  async exec() {
    return this.adapter.findMany(this.query, {
      sort: this.sortConfig,
      limit: this.limitValue
    })
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject)
  }

  catch(reject) {
    return this.exec().catch(reject)
  }

  finally(callback) {
    return this.exec().finally(callback)
  }
}

class SupabaseCollection {
  constructor(client, entity) {
    this.client = client
    this.entity = entity
    this.tableName = getTableMeta(entity).tableName
  }

  async loadDatabase() {
    return
  }

  async ensureIndex() {
    return
  }

  find(query = {}) {
    return new SupabaseQuery(this, this.entity, query)
  }

  async findMany(query = {}, options = {}) {
    const mappedQuery = mapQueryToDb(this.entity, query)
    let request = this.client.from(this.tableName).select('*')
    request = applySupabaseFilters(request, mappedQuery)

    const sort = options.sort || null
    if (sort && typeof sort === 'object') {
      const [[field, dir]] = Object.entries(sort)
      if (field) {
        const mappedField = mapQueryToDb(this.entity, { [field]: true })
        const dbField = Object.keys(mappedField)[0] || field
        request = request.order(dbField, { ascending: Number(dir) >= 0 })
      }
    }

    if (Number.isFinite(options.limit) && options.limit > 0) {
      request = request.limit(options.limit)
    }

    const { data, error } = await request
    if (error) throw error
    return (data || []).map((item) => toAppDoc(this.entity, item))
  }

  async findOne(query = {}) {
    const results = await this.findMany(query, { limit: 1 })
    return results[0] || null
  }

  async insert(doc = {}) {
    const payload = toDbDoc(this.entity, doc)
    const { data, error } = await this.client.from(this.tableName).insert(payload).select('*').single()
    if (error) throw error
    return toAppDoc(this.entity, data)
  }

  async update(query = {}, updatePayload = {}, options = {}) {
    const mappedQuery = mapQueryToDb(this.entity, query)
    const payload = toDbDoc(this.entity, updatePayload?.$set || updatePayload || {})
    let request = this.client.from(this.tableName).update(payload)
    request = applySupabaseFilters(request, mappedQuery)

    const { error } = await request
    if (error) throw error
    return 1
  }

  async remove(query = {}) {
    const mappedQuery = mapQueryToDb(this.entity, query)
    let request = this.client.from(this.tableName).delete()
    request = applySupabaseFilters(request, mappedQuery)
    const { error } = await request
    if (error) throw error
    return 1
  }

  async count(query = {}) {
    const mappedQuery = mapQueryToDb(this.entity, query)
    let request = this.client.from(this.tableName).select('id', { head: true, count: 'exact' })
    request = applySupabaseFilters(request, mappedQuery)
    const { count, error } = await request
    if (error) throw error
    return Number(count || 0)
  }
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

let recipientsDb
let dispatchesDb

if (USE_SUPABASE && HAS_SUPABASE_CONFIG) {

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  recipientsDb = new SupabaseCollection(supabase, 'recipients')
  dispatchesDb = new SupabaseCollection(supabase, 'dispatches')
} else {
  if (USE_SUPABASE && !HAS_SUPABASE_CONFIG) {
    console.log('DATA_PROVIDER=supabase definido sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. Usando fallback NeDB para manter a aplicação online.')
  }

  recipientsDb = Datastore.create({
    filename: path.join(DATA_DIR, 'recipients.db'),
    autoload: true,
    timestampData: true
  })

  dispatchesDb = Datastore.create({
    filename: path.join(DATA_DIR, 'dispatches.db'),
    autoload: true,
    timestampData: true
  })
}

export { recipientsDb, dispatchesDb }

export async function initDatabase() {
  if (!USE_SUPABASE) {
    await recipientsDb.ensureIndex({ fieldName: 'jid' })
    await dispatchesDb.ensureIndex({ fieldName: 'status' })
    await dispatchesDb.ensureIndex({ fieldName: 'sendAt' })
  }
}

export function normalizePrivateJid(input) {
  const value = (input || '').trim()
  if (!value) return ''

  if (value.includes('@')) {
    return value
  }

  const onlyDigits = normalizeBrazilianPhoneDigits(value)
  if (!onlyDigits) return ''

  return `${onlyDigits}@s.whatsapp.net`
}

function normalizeBrazilianPhoneDigits(input) {
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

  return digits
}

export function normalizePrivateDestinationBr(input) {
  const digits = normalizeBrazilianPhoneDigits(input)
  if (!digits) return ''

  const ddd = digits.slice(2, 4)
  const local = digits.slice(4)

  if (local.length === 8) {
    return `+55 (${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`
  }

  return `+55 (${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`
}

export function normalizeGroupJid(input) {
  const value = (input || '').trim()
  if (!value) return ''

  if (value.includes('@g.us')) {
    return value
  }

  if (/chat\.whatsapp\.com\//i.test(value)) {
    return value
  }

  return ''
}

export function normalizeRecipientJid(type, destination) {
  if (type === 'private') {
    return normalizePrivateJid(destination)
  }

  return normalizeGroupJid(destination)
}

export function formatDateTimeBr(isoDateTime) {
  const date = new Date(isoDateTime)
  if (Number.isNaN(date.getTime())) return ''

  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')

  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
}

export function parseBrDateTime(input) {
  const value = (input || '').trim()
  if (!value) return null

  const brMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/)
  if (brMatch) {
    const [, d, m, y, h, mi] = brMatch
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi), 0, 0)
    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }

  const isoLike = new Date(value)
  if (!Number.isNaN(isoLike.getTime())) {
    return isoLike
  }

  return null
}

const CYCLE_FILE_LEGACY = path.join(__dirname, 'bluestar-cycle.json')
const CYCLE_SETTINGS_FILE_LEGACY = path.join(__dirname, 'bluestar-cycle-settings.json')
const CYCLES_FILE = path.join(__dirname, 'bluestar-cycles.json')

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function makeCycleId() {
  return `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeCycleDay(item) {
  return {
    message: typeof item?.message === 'string' ? item.message : '',
    timeHHmm: typeof item?.timeHHmm === 'string' && item.timeHHmm.trim() ? item.timeHHmm.trim() : '18:30',
    isActive: item?.isActive !== false
  }
}

function normalizeCycleSettings(settings) {
  const today = getTodayIsoDate()
  return {
    startDate: typeof settings?.startDate === 'string' && settings.startDate.trim() ? settings.startDate.trim() : today,
    isActive: typeof settings?.isActive === 'boolean' ? settings.isActive : true
  }
}

function normalizeCycleItem(cycle, index = 0) {
  return {
    id: typeof cycle?.id === 'string' && cycle.id.trim() ? cycle.id.trim() : makeCycleId(),
    name: typeof cycle?.name === 'string' && cycle.name.trim() ? cycle.name.trim() : `Ciclo ${index + 1}`,
    isSelected: Boolean(cycle?.isSelected),
    settings: normalizeCycleSettings(cycle?.settings),
    days: Array.isArray(cycle?.days) ? cycle.days.map(normalizeCycleDay) : []
  }
}

function normalizeCyclesList(inputCycles) {
  const source = Array.isArray(inputCycles) ? inputCycles : []
  const cycles = source.map((cycle, index) => normalizeCycleItem(cycle, index))

  if (!cycles.length) {
    cycles.push({
      id: 'cycle-default',
      name: 'Ciclo 1',
      isSelected: true,
      settings: normalizeCycleSettings({}),
      days: []
    })
  }

  const selectedIndex = cycles.findIndex((cycle) => cycle.isSelected)
  const selectedToKeep = selectedIndex >= 0 ? selectedIndex : 0

  return cycles.map((cycle, index) => ({
    ...cycle,
    isSelected: index === selectedToKeep
  }))
}

function readLegacyCycle() {
  const cycleDays = (() => {
    if (!fs.existsSync(CYCLE_FILE_LEGACY)) {
      return []
    }

    try {
      const raw = fs.readFileSync(CYCLE_FILE_LEGACY, 'utf-8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(normalizeCycleDay) : []
    } catch {
      return []
    }
  })()

  const settings = (() => {
    if (!fs.existsSync(CYCLE_SETTINGS_FILE_LEGACY)) {
      return normalizeCycleSettings({})
    }

    try {
      const raw = fs.readFileSync(CYCLE_SETTINGS_FILE_LEGACY, 'utf-8')
      const parsed = JSON.parse(raw)
      return normalizeCycleSettings(parsed)
    } catch {
      return normalizeCycleSettings({})
    }
  })()

  return [
    {
      id: 'cycle-default',
      name: 'Ciclo 1',
      isSelected: true,
      settings,
      days: cycleDays
    }
  ]
}

export function loadCyclesConfig() {
  if (fs.existsSync(CYCLES_FILE)) {
    try {
      const content = fs.readFileSync(CYCLES_FILE, 'utf-8')
      return normalizeCyclesList(JSON.parse(content))
    } catch {
      return normalizeCyclesList([])
    }
  }

  const migrated = normalizeCyclesList(readLegacyCycle())
  saveCyclesConfig(migrated)
  return migrated
}

export function saveCyclesConfig(cycles) {
  const normalized = normalizeCyclesList(cycles)
  fs.writeFileSync(CYCLES_FILE, JSON.stringify(normalized, null, 2), 'utf-8')
}

function findCycleByIdOrSelected(cycleId) {
  const cycles = loadCyclesConfig()

  if (cycleId) {
    const found = cycles.find((cycle) => cycle.id === cycleId)
    if (found) {
      return { cycles, cycle: found }
    }
  }

  const selected = cycles.find((cycle) => cycle.isSelected) || cycles[0]
  return { cycles, cycle: selected }
}

export function loadCycleConfig(cycleId = '') {
  const { cycle } = findCycleByIdOrSelected(cycleId)
  return Array.isArray(cycle?.days) ? cycle.days : []
}

export function saveCycleConfig(cycleData, cycleId = '') {
  const { cycles, cycle } = findCycleByIdOrSelected(cycleId)
  const targetId = cycle?.id || cycles[0]?.id
  const next = cycles.map((item) => {
    if (item.id !== targetId) {
      return item
    }

    return {
      ...item,
      days: Array.isArray(cycleData) ? cycleData.map(normalizeCycleDay) : []
    }
  })

  saveCyclesConfig(next)
}

export function loadCycleSettings(cycleId = '') {
  const { cycle } = findCycleByIdOrSelected(cycleId)
  return normalizeCycleSettings(cycle?.settings)
}

export function saveCycleSettings(settings, cycleId = '') {
  const { cycles, cycle } = findCycleByIdOrSelected(cycleId)
  const targetId = cycle?.id || cycles[0]?.id
  const next = cycles.map((item) => {
    if (item.id !== targetId) {
      return item
    }

    return {
      ...item,
      settings: {
        ...normalizeCycleSettings(item.settings),
        ...(settings || {})
      }
    }
  })

  saveCyclesConfig(next)
}
