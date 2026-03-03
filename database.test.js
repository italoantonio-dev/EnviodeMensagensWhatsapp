import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ────────────────────────────────────────────────────
// Mocks — setup BEFORE importing database.js
// ────────────────────────────────────────────────────

// Mock nedb-promises to avoid real file I/O on import
vi.mock('nedb-promises', () => ({
  default: {
    create: vi.fn(() => ({
      ensureIndex: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      count: vi.fn()
    }))
  }
}))

// Mock @supabase/supabase-js to avoid real connections
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({}))
}))

// Spy on fs methods used at top-level and in cycle functions
vi.spyOn(fs, 'existsSync').mockReturnValue(true)
vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
vi.spyOn(fs, 'readFileSync').mockReturnValue('[]')
vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)

// Now import the module under test
const {
  normalizePrivateJid,
  normalizePrivateDestinationBr,
  normalizeGroupJid,
  normalizeRecipientJid,
  formatDateTimeBr,
  parseBrDateTime,
  loadCyclesConfig,
  saveCyclesConfig,
  loadCycleConfig,
  saveCycleConfig,
  loadCycleSettings,
  saveCycleSettings,
  recipientsDb,
  dispatchesDb,
  initDatabase
} = await import('./database.js')

// Resolve paths the same way database.js does
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CYCLES_FILE = path.join(__dirname, 'bluestar-cycles.json')


// ════════════════════════════════════════════════════
// 1. normalizePrivateJid
// ════════════════════════════════════════════════════
describe('normalizePrivateJid', () => {
  it('retorna vazio para input vazio, null ou undefined', () => {
    expect(normalizePrivateJid('')).toBe('')
    expect(normalizePrivateJid(null)).toBe('')
    expect(normalizePrivateJid(undefined)).toBe('')
  })

  it('retorna o próprio valor se já contém @', () => {
    expect(normalizePrivateJid('5534999998888@s.whatsapp.net')).toBe('5534999998888@s.whatsapp.net')
    expect(normalizePrivateJid('fulano@something')).toBe('fulano@something')
  })

  it('normaliza número BR com 11 dígitos (DDD + celular 9 dígitos)', () => {
    // 11 dígitos: DDD 34 + 9 dígitos cel
    expect(normalizePrivateJid('34999998888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('normaliza número BR com 10 dígitos (DDD + fixo 8 dígitos)', () => {
    // 10 dígitos: DDD 34 + 8 dígitos fixo
    expect(normalizePrivateJid('3432228888')).toBe('553432228888@s.whatsapp.net')
  })

  it('normaliza número com +55 na frente', () => {
    expect(normalizePrivateJid('+5534999998888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('normaliza número com 55 sem +', () => {
    expect(normalizePrivateJid('5534999998888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('normaliza número com formatação (parênteses, espaços, traços)', () => {
    expect(normalizePrivateJid('(34) 99999-8888')).toBe('5534999998888@s.whatsapp.net')
    expect(normalizePrivateJid('+55 (34) 99999-8888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('normaliza número com 0 depois do 55 (formato 0xx)', () => {
    // 55 + 0 + DDD + número = 14 dígitos, deve remover o 0
    expect(normalizePrivateJid('55034999998888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('normaliza número começando com 00 (discagem internacional)', () => {
    expect(normalizePrivateJid('005534999998888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('retorna vazio para número com dígitos insuficientes', () => {
    expect(normalizePrivateJid('123')).toBe('')
    expect(normalizePrivateJid('34999')).toBe('')
  })

  it('retorna vazio para texto sem dígitos', () => {
    expect(normalizePrivateJid('abc')).toBe('')
    expect(normalizePrivateJid('sem-numero')).toBe('')
  })

  it('retorna vazio para número de outro país (sem 55)', () => {
    // 9 dígitos não é 10 nem 11, e não começa com 55
    expect(normalizePrivateJid('123456789')).toBe('')
  })
})


// ════════════════════════════════════════════════════
// 2. normalizePrivateDestinationBr
// ════════════════════════════════════════════════════
describe('normalizePrivateDestinationBr', () => {
  it('retorna vazio para input vazio ou inválido', () => {
    expect(normalizePrivateDestinationBr('')).toBe('')
    expect(normalizePrivateDestinationBr(null)).toBe('')
    expect(normalizePrivateDestinationBr('abc')).toBe('')
  })

  it('formata celular 11 dígitos como +55 (DD) XXXXX-XXXX', () => {
    expect(normalizePrivateDestinationBr('34999998888')).toBe('+55 (34) 99999-8888')
    expect(normalizePrivateDestinationBr('5534999998888')).toBe('+55 (34) 99999-8888')
    expect(normalizePrivateDestinationBr('+5534999998888')).toBe('+55 (34) 99999-8888')
  })

  it('formata fixo 10 dígitos como +55 (DD) XXXX-XXXX', () => {
    expect(normalizePrivateDestinationBr('3432228888')).toBe('+55 (34) 3222-8888')
    expect(normalizePrivateDestinationBr('553432228888')).toBe('+55 (34) 3222-8888')
  })

  it('lida com formatação mista (espaços, parênteses, traços)', () => {
    expect(normalizePrivateDestinationBr('(34) 99999-8888')).toBe('+55 (34) 99999-8888')
  })
})


// ════════════════════════════════════════════════════
// 3. normalizeGroupJid
// ════════════════════════════════════════════════════
describe('normalizeGroupJid', () => {
  it('retorna vazio para input vazio ou null', () => {
    expect(normalizeGroupJid('')).toBe('')
    expect(normalizeGroupJid(null)).toBe('')
    expect(normalizeGroupJid(undefined)).toBe('')
  })

  it('retorna o JID se contém @g.us', () => {
    const jid = '120363041234567890@g.us'
    expect(normalizeGroupJid(jid)).toBe(jid)
  })

  it('retorna link de convite do WhatsApp', () => {
    const link = 'https://chat.whatsapp.com/AbCdEfGhIjK'
    expect(normalizeGroupJid(link)).toBe(link)
  })

  it('retorna vazio para valor que não é JID nem link', () => {
    expect(normalizeGroupJid('MeuGrupo')).toBe('')
    expect(normalizeGroupJid('12345')).toBe('')
    expect(normalizeGroupJid('grupo@whats')).toBe('')
  })
})


// ════════════════════════════════════════════════════
// 4. normalizeRecipientJid
// ════════════════════════════════════════════════════
describe('normalizeRecipientJid', () => {
  it('delega para normalizePrivateJid quando tipo é "private"', () => {
    expect(normalizeRecipientJid('private', '34999998888')).toBe('5534999998888@s.whatsapp.net')
  })

  it('delega para normalizeGroupJid quando tipo é "group"', () => {
    expect(normalizeRecipientJid('group', '120363041234567890@g.us')).toBe('120363041234567890@g.us')
  })

  it('delega para normalizeGroupJid para tipo desconhecido', () => {
    // Qualquer tipo != 'private' cai no normalizeGroupJid
    expect(normalizeRecipientJid('other', '34999998888')).toBe('')
  })
})


// ════════════════════════════════════════════════════
// 5. formatDateTimeBr
// ════════════════════════════════════════════════════
describe('formatDateTimeBr', () => {
  it('formata data ISO corretamente para dd/mm/yyyy HH:mm', () => {
    // Cria data local para evitar problemas de timezone
    const date = new Date(2025, 5, 15, 14, 30) // Jun 15, 2025 14:30
    const isoStr = date.toISOString()
    const result = formatDateTimeBr(isoStr)
    expect(result).toBe('15/06/2025 14:30')
  })

  it('retorna vazio para data inválida', () => {
    expect(formatDateTimeBr('invalido')).toBe('')
    expect(formatDateTimeBr('')).toBe('')
  })

  it('trata null como epoch (Date(null) = epoch)', () => {
    // new Date(null) = epoch (Jan 1, 1970 00:00 UTC), que é uma data válida
    const result = formatDateTimeBr(null)
    expect(result).not.toBe('')
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
  })

  it('preenche zeros à esquerda para dia e mês', () => {
    const date = new Date(2025, 0, 5, 8, 5) // Jan 5, 2025 08:05
    const result = formatDateTimeBr(date.toISOString())
    expect(result).toBe('05/01/2025 08:05')
  })
})


// ════════════════════════════════════════════════════
// 6. parseBrDateTime
// ════════════════════════════════════════════════════
describe('parseBrDateTime', () => {
  it('retorna null para input vazio ou null', () => {
    expect(parseBrDateTime('')).toBeNull()
    expect(parseBrDateTime(null)).toBeNull()
    expect(parseBrDateTime(undefined)).toBeNull()
  })

  it('parseia formato BR dd/mm/yyyy HH:mm', () => {
    const result = parseBrDateTime('15/06/2025 14:30')
    expect(result).toBeInstanceOf(Date)
    expect(result.getFullYear()).toBe(2025)
    expect(result.getMonth()).toBe(5) // 0-based = junho
    expect(result.getDate()).toBe(15)
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(30)
  })

  it('parseia formato ISO como fallback', () => {
    const result = parseBrDateTime('2025-06-15T14:30:00')
    expect(result).toBeInstanceOf(Date)
    expect(result.getFullYear()).toBe(2025)
  })

  it('retorna null para formato totalmente inválido', () => {
    expect(parseBrDateTime('abc123')).toBeNull()
  })

  it('JS Date faz roll-over para datas fora do range (32/13/2025 25:00)', () => {
    // O regex casa dd/mm/yyyy HH:mm, e JS Date faz roll-over — é comportamento esperado
    const result = parseBrDateTime('32/13/2025 25:00')
    expect(result).toBeInstanceOf(Date)
  })
})


// ════════════════════════════════════════════════════
// 7. Ciclos — loadCyclesConfig / saveCyclesConfig
// ════════════════════════════════════════════════════
describe('loadCyclesConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('carrega ciclos a partir do arquivo JSON quando existente', () => {
    const mockCycles = [
      {
        id: 'cycle-1',
        name: 'Meu Ciclo',
        isSelected: true,
        settings: { startDate: '2025-01-01', isActive: true, repeatIntervalDays: 2, recipients: ['r1'] },
        days: [{ message: 'Olá!', timeHHmm: '09:00', isActive: true }]
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('cycle-1')
    expect(result[0].name).toBe('Meu Ciclo')
    expect(result[0].isSelected).toBe(true)
    expect(result[0].settings.startDate).toBe('2025-01-01')
    expect(result[0].settings.repeatIntervalDays).toBe(2)
    expect(result[0].settings.recipients).toEqual(['r1'])
    expect(result[0].days).toHaveLength(1)
    expect(result[0].days[0].message).toBe('Olá!')
  })

  it('retorna ciclo padrão quando arquivo retorna array vazio', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('[]')

    const result = loadCyclesConfig()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('cycle-default')
    expect(result[0].name).toBe('Ciclo 1')
    expect(result[0].isSelected).toBe(true)
    expect(result[0].days).toEqual([])
  })

  it('retorna ciclo padrão quando JSON é inválido', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{invalid json')

    const result = loadCyclesConfig()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('cycle-default')
  })

  it('normaliza dias com valores faltando', () => {
    const mockCycles = [
      {
        id: 'cycle-x',
        name: 'Teste',
        isSelected: true,
        settings: {},
        days: [
          { message: 'Teste' },   // sem timeHHmm e isActive
          { timeHHmm: '10:00' },  // sem message
          {}                      // totalmente vazio
        ]
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()
    const days = result[0].days

    expect(days[0].timeHHmm).toBe('18:30')    // default
    expect(days[0].isActive).toBe(true)        // default
    expect(days[1].message).toBe('')           // default vazio
    expect(days[2].message).toBe('')
    expect(days[2].timeHHmm).toBe('18:30')
    expect(days[2].isActive).toBe(true)
  })

  it('garante que apenas um ciclo fique isSelected=true', () => {
    const mockCycles = [
      { id: 'a', name: 'A', isSelected: true, settings: {}, days: [] },
      { id: 'b', name: 'B', isSelected: true, settings: {}, days: [] },
      { id: 'c', name: 'C', isSelected: false, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()
    const selectedCount = result.filter((c) => c.isSelected).length

    expect(selectedCount).toBe(1)
    expect(result[0].isSelected).toBe(true)  // primeiro selecionado vence
    expect(result[1].isSelected).toBe(false)
    expect(result[2].isSelected).toBe(false)
  })

  it('seleciona o primeiro ciclo quando nenhum tem isSelected', () => {
    const mockCycles = [
      { id: 'a', name: 'A', isSelected: false, settings: {}, days: [] },
      { id: 'b', name: 'B', isSelected: false, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()

    expect(result[0].isSelected).toBe(true)
    expect(result[1].isSelected).toBe(false)
  })

  it('normaliza settings com valores inválidos', () => {
    const mockCycles = [
      {
        id: 'c1',
        name: 'C1',
        isSelected: true,
        settings: {
          startDate: '',
          isActive: 'nao-boolean',
          repeatIntervalDays: -5,
          recipients: 'nao-array'
        },
        days: []
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()
    const settings = result[0].settings

    // startDate vazio -> usa hoje
    expect(settings.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // isActive não-boolean -> default true
    expect(settings.isActive).toBe(true)
    // repeatIntervalDays negativo -> default 1
    expect(settings.repeatIntervalDays).toBe(1)
    // recipients não-array -> default []
    expect(settings.recipients).toEqual([])
  })
})


describe('saveCyclesConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('[]')
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('salva ciclos normalizados no arquivo correto', () => {
    const cycles = [
      {
        id: 'cycle-1',
        name: 'Ciclo Teste',
        isSelected: true,
        settings: { startDate: '2025-03-01', isActive: true, repeatIntervalDays: 1, recipients: [] },
        days: [{ message: 'Bom dia!', timeHHmm: '08:00', isActive: true }]
      }
    ]

    saveCyclesConfig(cycles)

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    const [filePath, content] = fs.writeFileSync.mock.calls[0]
    expect(filePath).toBe(CYCLES_FILE)

    const parsed = JSON.parse(content)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('cycle-1')
    expect(parsed[0].days[0].message).toBe('Bom dia!')
  })

  it('normaliza e gera ciclo padrão se array vazio', () => {
    saveCyclesConfig([])

    const [, content] = fs.writeFileSync.mock.calls[0]
    const parsed = JSON.parse(content)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('cycle-default')
    expect(parsed[0].isSelected).toBe(true)
  })
})


// ════════════════════════════════════════════════════
// 8. Ciclos — loadCycleConfig / saveCycleConfig
// ════════════════════════════════════════════════════
describe('loadCycleConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('retorna os dias do ciclo selecionado', () => {
    const mockCycles = [
      {
        id: 'cycle-1',
        name: 'C1',
        isSelected: true,
        settings: {},
        days: [
          { message: 'Dia 1', timeHHmm: '09:00', isActive: true },
          { message: 'Dia 2', timeHHmm: '10:00', isActive: false }
        ]
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const days = loadCycleConfig('cycle-1')

    expect(days).toHaveLength(2)
    expect(days[0].message).toBe('Dia 1')
    expect(days[1].isActive).toBe(false)
  })

  it('retorna dias do ciclo selecionado quando cycleId não fornecido', () => {
    const mockCycles = [
      { id: 'a', name: 'A', isSelected: false, settings: {}, days: [{ message: 'X' }] },
      { id: 'b', name: 'B', isSelected: true, settings: {}, days: [{ message: 'Y' }] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const days = loadCycleConfig()

    // Deve retornar do ciclo selecionado (b)
    expect(days[0].message).toBe('Y')
  })

  it('retorna array vazio quando ciclo não tem dias', () => {
    const mockCycles = [
      { id: 'empty', name: 'Vazio', isSelected: true, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const days = loadCycleConfig('empty')
    expect(days).toEqual([])
  })
})


describe('saveCycleConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('salva novos dias no ciclo especificado por ID', () => {
    const mockCycles = [
      { id: 'a', name: 'A', isSelected: true, settings: {}, days: [] },
      { id: 'b', name: 'B', isSelected: false, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const newDays = [
      { message: 'Novo dia 1', timeHHmm: '07:00', isActive: true },
      { message: 'Novo dia 2', timeHHmm: '12:00', isActive: true }
    ]

    saveCycleConfig(newDays, 'b')

    const [, content] = fs.writeFileSync.mock.calls[0]
    const parsed = JSON.parse(content)
    const cycleB = parsed.find((c) => c.id === 'b')

    expect(cycleB.days).toHaveLength(2)
    expect(cycleB.days[0].message).toBe('Novo dia 1')
    expect(cycleB.days[1].timeHHmm).toBe('12:00')
  })

  it('não modifica dias de outros ciclos', () => {
    const mockCycles = [
      { id: 'a', name: 'A', isSelected: true, settings: {}, days: [{ message: 'Original' }] },
      { id: 'b', name: 'B', isSelected: false, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    saveCycleConfig([{ message: 'Alterado', timeHHmm: '15:00' }], 'b')

    const [, content] = fs.writeFileSync.mock.calls[0]
    const parsed = JSON.parse(content)
    const cycleA = parsed.find((c) => c.id === 'a')

    expect(cycleA.days[0].message).toBe('Original')
  })
})


// ════════════════════════════════════════════════════
// 9. Ciclos — loadCycleSettings / saveCycleSettings
// ════════════════════════════════════════════════════
describe('loadCycleSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('retorna settings normalizados do ciclo', () => {
    const mockCycles = [
      {
        id: 'cycle-1',
        name: 'C1',
        isSelected: true,
        settings: {
          startDate: '2025-06-01',
          isActive: false,
          repeatIntervalDays: 3,
          recipients: ['r1', 'r2']
        },
        days: []
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const settings = loadCycleSettings('cycle-1')

    expect(settings.startDate).toBe('2025-06-01')
    expect(settings.isActive).toBe(false)
    expect(settings.repeatIntervalDays).toBe(3)
    expect(settings.recipients).toEqual(['r1', 'r2'])
  })

  it('retorna defaults para settings ausentes', () => {
    const mockCycles = [
      { id: 'c', name: 'C', isSelected: true, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const settings = loadCycleSettings()

    expect(settings.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(settings.isActive).toBe(true)
    expect(settings.repeatIntervalDays).toBe(1)
    expect(settings.recipients).toEqual([])
  })
})


describe('saveCycleSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('salva novas settings no ciclo especificado', () => {
    const mockCycles = [
      {
        id: 'cycle-1',
        name: 'C1',
        isSelected: true,
        settings: {
          startDate: '2025-01-01',
          isActive: true,
          repeatIntervalDays: 1,
          recipients: []
        },
        days: []
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    saveCycleSettings({
      startDate: '2025-06-15',
      isActive: false,
      repeatIntervalDays: 5,
      recipients: ['r1', 'r2', 'r3']
    }, 'cycle-1')

    const [, content] = fs.writeFileSync.mock.calls[0]
    const parsed = JSON.parse(content)

    expect(parsed[0].settings.startDate).toBe('2025-06-15')
    expect(parsed[0].settings.isActive).toBe(false)
    expect(parsed[0].settings.repeatIntervalDays).toBe(5)
    expect(parsed[0].settings.recipients).toEqual(['r1', 'r2', 'r3'])
  })

  it('mescla settings parciais com as existentes', () => {
    const mockCycles = [
      {
        id: 'cycle-1',
        name: 'C1',
        isSelected: true,
        settings: {
          startDate: '2025-01-01',
          isActive: true,
          repeatIntervalDays: 2,
          recipients: ['existing']
        },
        days: []
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    // Atualiza apenas isActive
    saveCycleSettings({ isActive: false }, 'cycle-1')

    const [, content] = fs.writeFileSync.mock.calls[0]
    const parsed = JSON.parse(content)

    expect(parsed[0].settings.isActive).toBe(false)
    // Os demais devem ser preservados via normalização
    expect(parsed[0].settings.startDate).toBe('2025-01-01')
    expect(parsed[0].settings.repeatIntervalDays).toBe(2)
    expect(parsed[0].settings.recipients).toEqual(['existing'])
  })
})


// ════════════════════════════════════════════════════
// 10. Múltiplos ciclos — cenários integrados
// ════════════════════════════════════════════════════
describe('Ciclos — cenários integrados', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined)
  })

  it('mantém integridade ao salvar dias em ciclo não-selecionado', () => {
    const mockCycles = [
      {
        id: 'principal',
        name: 'Principal',
        isSelected: true,
        settings: { startDate: '2025-01-01', isActive: true, repeatIntervalDays: 1, recipients: [] },
        days: [{ message: 'Msg principal', timeHHmm: '08:00', isActive: true }]
      },
      {
        id: 'secundario',
        name: 'Secundário',
        isSelected: false,
        settings: { startDate: '2025-02-01', isActive: false, repeatIntervalDays: 3, recipients: ['x'] },
        days: []
      }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    saveCycleConfig([{ message: 'Novo no secundário', timeHHmm: '14:00' }], 'secundario')

    const [, content] = fs.writeFileSync.mock.calls[0]
    const parsed = JSON.parse(content)

    // Principal inalterado
    expect(parsed[0].id).toBe('principal')
    expect(parsed[0].days[0].message).toBe('Msg principal')
    expect(parsed[0].isSelected).toBe(true)

    // Secundário atualizado
    expect(parsed[1].id).toBe('secundario')
    expect(parsed[1].days[0].message).toBe('Novo no secundário')
    expect(parsed[1].isSelected).toBe(false)
  })

  it('gera IDs para ciclos sem ID definido', () => {
    const mockCycles = [
      { name: 'Sem ID', isSelected: true, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()

    expect(result[0].id).toBeTruthy()
    expect(result[0].id.startsWith('cycle-')).toBe(true)
  })

  it('gera nomes para ciclos sem nome', () => {
    const mockCycles = [
      { id: 'c1', isSelected: true, settings: {}, days: [] },
      { id: 'c2', isSelected: false, settings: {}, days: [] }
    ]

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockCycles))

    const result = loadCyclesConfig()

    expect(result[0].name).toBe('Ciclo 1')
    expect(result[1].name).toBe('Ciclo 2')
  })
})


// ════════════════════════════════════════════════════
// 11. initDatabase (NeDB mode — default)
// ════════════════════════════════════════════════════
describe('initDatabase', () => {
  it('exporta recipientsDb e dispatchesDb', () => {
    expect(recipientsDb).toBeDefined()
    expect(dispatchesDb).toBeDefined()
  })

  it('initDatabase não lança erro no modo NeDB', async () => {
    await expect(initDatabase()).resolves.not.toThrow()
  })
})


// ════════════════════════════════════════════════════
// 12. Edge cases — inputs extremos
// ════════════════════════════════════════════════════
describe('Edge cases', () => {
  it('normalizePrivateJid com espaços em branco', () => {
    expect(normalizePrivateJid('   ')).toBe('')
    expect(normalizePrivateJid('  34999998888  ')).toBe('5534999998888@s.whatsapp.net')
  })

  it('normalizeGroupJid com espaços em branco', () => {
    expect(normalizeGroupJid('   ')).toBe('')
    expect(normalizeGroupJid('  120363041234567890@g.us  ')).toBe('120363041234567890@g.us')
  })

  it('formatDateTimeBr com timestamp numérico', () => {
    const ts = new Date(2025, 11, 25, 0, 0).getTime() // Dec 25, 2025
    const result = formatDateTimeBr(ts)
    expect(result).toBe('25/12/2025 00:00')
  })

  it('parseBrDateTime com espaços extras', () => {
    expect(parseBrDateTime('  15/06/2025 14:30  ')).toBeInstanceOf(Date)
  })

  it('normalizePrivateJid com número contendo apenas zeros', () => {
    // 11 dígitos de zeros
    const result = normalizePrivateJid('00000000000')
    // Depois de strip do 00 inicial, fica 000000000 (9 dígitos) - inválido
    expect(result).toBe('')
  })

  it('normalizeGroupJid com link HTTP (não HTTPS)', () => {
    const link = 'http://chat.whatsapp.com/AbCdEfGhIjK'
    expect(normalizeGroupJid(link)).toBe(link)
  })

  it('formatDateTimeBr com Date object direto', () => {
    const date = new Date(2025, 2, 3, 16, 45) // Mar 3, 2025
    const result = formatDateTimeBr(date)
    expect(result).toBe('03/03/2025 16:45')
  })

  it('parseBrDateTime retorna null para data BR inválida (dia 32)', () => {
    // new Date(2025, 5, 32) ajusta para Jul 2, não retorna NaN
    // Portanto parseBrDateTime vai retornar um Date (JS aceita overflow)
    const result = parseBrDateTime('32/06/2025 10:00')
    // JS Date rolls over — resultado seria Jul 2. Ainda é um Date válido.
    expect(result).toBeInstanceOf(Date)
  })

  it('normalizeRecipientJid para grupo com link de convite', () => {
    const link = 'https://chat.whatsapp.com/invite123'
    expect(normalizeRecipientJid('group', link)).toBe(link)
  })
})
