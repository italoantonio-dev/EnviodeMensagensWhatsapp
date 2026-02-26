import fs from 'fs'
import path from 'path'
import Datastore from 'nedb-promises'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.join(__dirname, 'data')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export const recipientsDb = Datastore.create({
  filename: path.join(DATA_DIR, 'recipients.db'),
  autoload: true,
  timestampData: true
})

export const dispatchesDb = Datastore.create({
  filename: path.join(DATA_DIR, 'dispatches.db'),
  autoload: true,
  timestampData: true
})

export async function initDatabase() {
  await recipientsDb.ensureIndex({ fieldName: 'jid' })
  await dispatchesDb.ensureIndex({ fieldName: 'status' })
  await dispatchesDb.ensureIndex({ fieldName: 'sendAt' })
}

export function normalizePrivateJid(input) {
  const value = (input || '').trim()
  if (!value) return ''

  if (value.includes('@')) {
    return value
  }

  const onlyDigits = value.replace(/\D/g, '')
  if (!onlyDigits) return ''

  return `${onlyDigits}@s.whatsapp.net`
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
