const camposEnv = [
  'SEND_PROVIDER',
  'NUMERO_BOT',
  'BLUE_STAR_GROUP_ID',
  'BLUE_STAR_GROUP_INVITE_LINK',
  'WA_CLOUD_API_VERSION',
  'WA_CLOUD_PHONE_NUMBER_ID',
  'WA_CLOUD_ACCESS_TOKEN',
  'SEND_MIN_INTERVAL_SECONDS',
  'SEND_MAX_PER_HOUR',
  'SEND_ALLOWED_START_HOUR',
  'SEND_ALLOWED_END_HOUR',
  'CONFIG_PORT'
]

const statusEl = document.getElementById('status')
const eventLogEl = document.getElementById('eventLog')
const clearLogBtn = document.getElementById('clearLogBtn')
const sideMenuItems = Array.from(document.querySelectorAll('.menu-item'))
const menuSections = Array.from(document.querySelectorAll('.menu-section'))
const saveBtn = document.getElementById('saveBtn')
const reloadBtn = document.getElementById('reloadBtn')
const cycleEditorContainer = document.getElementById('cycleEditorContainer')
const cycleSettingsSummary = document.getElementById('cycleSettingsSummary')
const cycleSelect = document.getElementById('cycleSelect')
const addCycleBtn = document.getElementById('addCycleBtn')
const deleteCycleBtn = document.getElementById('deleteCycleBtn')
const addCycleDayBtn = document.getElementById('addCycleDayBtn')
const saveCycleBtn = document.getElementById('saveCycleBtn')
const editCycleSettingsBtn = document.getElementById('editCycleSettingsBtn')
const recipientsList = document.getElementById('recipientsList')
const dispatchesList = document.getElementById('dispatchesList')
const dispatchRecipient = document.getElementById('dispatchRecipient')
const dispatchSourceType = document.getElementById('dispatchSourceType')
const dispatchCycleDay = document.getElementById('dispatchCycleDay')
const cycleDayWrap = document.getElementById('cycleDayWrap')
const dispatchMode = document.getElementById('dispatchMode')
const sendAtWrap = document.getElementById('sendAtWrap')
const botStatusEl = document.getElementById('botStatus')
const qrStatusEl = document.getElementById('qrStatus')
const qrWrapEl = document.getElementById('qrWrap')
const qrImageEl = document.getElementById('qrImage')
const startBotBtn = document.getElementById('startBotBtn')
const disconnectQrBtn = document.getElementById('disconnectQrBtn')
const providerSelect = document.getElementById('SEND_PROVIDER')
const recipientModal = document.getElementById('recipientModal')
const editRecipientName = document.getElementById('editRecipientName')
const editRecipientType = document.getElementById('editRecipientType')
const editRecipientDestination = document.getElementById('editRecipientDestination')
const saveEditRecipientBtn = document.getElementById('saveEditRecipientBtn')
const cancelEditRecipientBtn = document.getElementById('cancelEditRecipientBtn')
const cycleDayModal = document.getElementById('cycleDayModal')
const editCycleMessage = document.getElementById('editCycleMessage')
const editCycleTime = document.getElementById('editCycleTime')
const editCycleDayIsActive = document.getElementById('editCycleDayIsActive')
const saveEditCycleDayBtn = document.getElementById('saveEditCycleDayBtn')
const cancelEditCycleDayBtn = document.getElementById('cancelEditCycleDayBtn')
const cycleSettingsModal = document.getElementById('cycleSettingsModal')
const cycleStartDateInput = document.getElementById('cycleStartDate')
const cycleIsActiveInput = document.getElementById('cycleIsActive')
const saveCycleSettingsBtn = document.getElementById('saveCycleSettingsBtn')
const cancelCycleSettingsBtn = document.getElementById('cancelCycleSettingsBtn')

let recipientsCache = []
let cycleCache = []
let cycleSettingsCache = { startDate: '', isActive: true }
let cyclesMetaCache = []
let currentCycleId = ''
let currentCycleName = ''
let editingRecipientId = ''
let editingCycleIndex = -1

const configuredApiBaseUrl = ((window.APP_API_BASE_URL || '').toString().trim()).replace(/\/$/, '')
const nativeFetch = window.fetch.bind(window)

function withApiBase(input) {
  if (!configuredApiBaseUrl) {
    return input
  }

  if (typeof input === 'string' && input.startsWith('/api/')) {
    return `${configuredApiBaseUrl}${input}`
  }

  if (input instanceof Request) {
    const currentUrl = input.url || ''
    if (currentUrl.startsWith('/api/')) {
      return new Request(`${configuredApiBaseUrl}${currentUrl}`, input)
    }

    try {
      const parsed = new URL(currentUrl)
      if (parsed.pathname.startsWith('/api/')) {
        return new Request(`${configuredApiBaseUrl}${parsed.pathname}${parsed.search}`, input)
      }
    } catch {
    }
  }

  return input
}

window.fetch = (input, init) => nativeFetch(withApiBase(input), init)

function addLogEntry(message, tipo = 'success') {
  if (!eventLogEl) return

  const row = document.createElement('div')
  row.className = 'event-log-item'
  const time = new Date().toLocaleTimeString('pt-BR')
  row.innerHTML = `
    <div class="event-log-time">${time}</div>
    <div>${tipo === 'error' ? '❌' : '✅'} ${message}</div>
  `

  eventLogEl.prepend(row)
  while (eventLogEl.children.length > 80) {
    eventLogEl.removeChild(eventLogEl.lastChild)
  }
}

function setStatus(message, tipo = 'success') {
  statusEl.textContent = message
  statusEl.className = `status ${tipo}`
  addLogEntry(message, tipo)
}

function setActiveSection(sectionId) {
  menuSections.forEach((section) => {
    section.classList.toggle('is-active', section.id === sectionId)
  })

  sideMenuItems.forEach((item) => {
    item.classList.toggle('is-active', item.getAttribute('data-target') === sectionId)
  })
}

function initSideMenu() {
  if (!sideMenuItems.length) return

  sideMenuItems.forEach((item) => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-target')
      if (!target) return
      setActiveSection(target)
    })
  })

  clearLogBtn?.addEventListener('click', () => {
    eventLogEl.innerHTML = ''
    addLogEntry('Log limpo pelo usuário.', 'success')
  })

  const initial = sideMenuItems[0]?.getAttribute('data-target')
  if (initial) {
    setActiveSection(initial)
  }
}

function setCardCollapsed(card, collapsed) {
  card.classList.toggle('is-collapsed', collapsed)

  const toggleBtn = card.querySelector('.section-toggle-btn')
  if (toggleBtn) {
    toggleBtn.textContent = collapsed ? 'Expandir' : 'Recolher'
    toggleBtn.setAttribute('aria-expanded', String(!collapsed))
  }
}

function initExpandableSections() {
  const cards = Array.from(document.querySelectorAll('main.container > section.card'))

  cards.forEach((card, index) => {
    const heading = card.querySelector('h2')
    if (!heading) return

    if (heading.querySelector('.section-toggle-btn')) return

    const titleText = (heading.textContent || '').trim()
    heading.classList.add('section-title')
    heading.textContent = ''

    const titleLabel = document.createElement('span')
    titleLabel.className = 'section-title-text'
    titleLabel.textContent = titleText

    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.className = 'secondary section-toggle-btn'

    heading.appendChild(titleLabel)
    heading.appendChild(toggleBtn)

    const initialCollapsed = index !== 0
    setCardCollapsed(card, initialCollapsed)

    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      const collapsed = card.classList.contains('is-collapsed')
      setCardCollapsed(card, !collapsed)
    })

    titleLabel.addEventListener('click', () => {
      const collapsed = card.classList.contains('is-collapsed')
      setCardCollapsed(card, !collapsed)
    })
  })
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function renderCycleSettingsSummary() {
  const cycleLabel = currentCycleName || 'Ciclo'
  cycleSettingsSummary.textContent = `${cycleLabel} | Início: ${cycleSettingsCache.startDate || '-'} | Status: ${cycleSettingsCache.isActive ? 'Ativo' : 'Inativo'}`
}

function renderCyclesSelector(cycles, selectedId) {
  cyclesMetaCache = cycles || []
  cycleSelect.innerHTML = ''

  cyclesMetaCache.forEach((item) => {
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = `${item.name} (${item.daysCount || 0} dia(s))`
    cycleSelect.appendChild(option)
  })

  if (selectedId) {
    cycleSelect.value = selectedId
  }

  if (!cycleSelect.value && cyclesMetaCache.length) {
    cycleSelect.value = cyclesMetaCache[0].id
  }

  const selected = cyclesMetaCache.find((item) => item.id === cycleSelect.value)
  currentCycleId = selected?.id || ''
  currentCycleName = selected?.name || ''
}

function datetimeLocalToBr(value) {
  const input = (value || '').trim()
  if (!input) return ''

  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) {
    return input
  }

  const [, year, month, day, hour, minute] = match
  return `${day}/${month}/${year} ${hour}:${minute}`
}

function renderCycleEditor(cycle) {
  cycleCache = cycle || []
  cycleEditorContainer.innerHTML = ''
  dispatchCycleDay.innerHTML = ''

  cycleCache.forEach((item, index) => {
    const wrapper = document.createElement('div')
    wrapper.className = 'cycle-day-item'
    wrapper.dataset.index = String(index)

    const ativoDia = item.isActive !== false
    const resumo = (item.message || '').trim()
    const resumoCorto = resumo.length > 120 ? `${resumo.slice(0, 120)}...` : resumo

    const removeBtn = document.createElement('button')
    removeBtn.type = 'button'
    removeBtn.className = 'remove cycle-remove-btn'
    removeBtn.textContent = 'Remover dia'
    removeBtn.dataset.index = String(index)

    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'secondary'
    editBtn.textContent = 'Editar'
    editBtn.dataset.index = String(index)
    editBtn.dataset.action = 'edit-cycle-day'

    wrapper.innerHTML = `
      <div>
        <strong>Dia ${index + 1}</strong>
        <div class="meta">Horário: ${item.timeHHmm || '18:30'}</div>
        <div class="meta">Status: ${ativoDia ? 'Ativo' : 'Inativo'}</div>
        <div class="meta">${resumoCorto || 'Sem mensagem.'}</div>
      </div>
    `

    const actions = document.createElement('div')
    actions.className = 'actions inline-actions'
    actions.appendChild(editBtn)
    actions.appendChild(removeBtn)

    wrapper.appendChild(actions)
    cycleEditorContainer.appendChild(wrapper)

    const option = document.createElement('option')
    option.value = String(index + 1)
    option.textContent = `Dia ${index + 1}`
    dispatchCycleDay.appendChild(option)
  })

  if (cycleCache.length === 0) {
    const emptyMsg = document.createElement('div')
    emptyMsg.className = 'meta'
    emptyMsg.textContent = 'Nenhum dia configurado. Clique em "+ Adicionar dia" para começar.'
    cycleEditorContainer.appendChild(emptyMsg)
  }
}

async function carregarConfiguracoes() {
  setStatus('Carregando configurações...', 'success')

  try {
    const response = await fetch('/api/config')
    if (!response.ok) {
      throw new Error('Falha ao carregar configurações.')
    }

    const data = await response.json()

    camposEnv.forEach((campo) => {
      const el = document.getElementById(campo)
      if (el) {
        el.value = data.env?.[campo] || ''
      }
    })

    await carregarListaCiclos()
    setStatus('Configurações carregadas com sucesso.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao carregar configurações.', 'error')
  }
}

async function carregarListaCiclos(preferredId = '') {
  const response = await fetch('/api/cycles')
  if (!response.ok) {
    throw new Error('Falha ao carregar lista de ciclos.')
  }

  const data = await response.json()
  const cycles = Array.isArray(data.cycles) ? data.cycles : []
  const active = cycles.find((item) => item.isSelected)
  const selectedId = preferredId || active?.id || cycles[0]?.id || ''

  renderCyclesSelector(cycles, selectedId)

  if (!currentCycleId) {
    cycleSettingsCache = { startDate: getTodayIsoDate(), isActive: true }
    renderCycleSettingsSummary()
    renderCycleEditor([])
    return
  }

  await carregarCiclo(currentCycleId)
}

async function carregarCiclo(cycleId = currentCycleId) {
  try {
    const query = cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : ''
    const response = await fetch(`/api/cycle${query}`)
    if (!response.ok) {
      throw new Error('Falha ao carregar ciclo.')
    }
    const data = await response.json()
    currentCycleId = data.cycleId || cycleId || ''
    currentCycleName = data.cycleName || currentCycleName || 'Ciclo'
    cycleSettingsCache = {
      startDate: data.settings?.startDate || getTodayIsoDate(),
      isActive: data.settings?.isActive !== false
    }
    renderCycleSettingsSummary()
    renderCycleEditor(data.cycle || [])
  } catch (error) {
    console.error('Erro ao carregar ciclo:', error)
    cycleSettingsCache = { startDate: getTodayIsoDate(), isActive: true }
    renderCycleSettingsSummary()
    renderCycleEditor([])
  }
}

async function ativarCicloSelecionado(cycleId) {
  const response = await fetch(`/api/cycles/${encodeURIComponent(cycleId)}/activate`, {
    method: 'POST'
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao ativar ciclo.')
  }

  await carregarListaCiclos(cycleId)
}

async function criarNovoCiclo() {
  const nome = window.prompt('Nome do novo ciclo:', `Ciclo ${cyclesMetaCache.length + 1}`)
  if (nome === null) {
    return
  }

  const response = await fetch('/api/cycles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: (nome || '').trim() })
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao criar novo ciclo.')
  }

  const newId = data.cycle?.id || ''
  if (newId) {
    await ativarCicloSelecionado(newId)
  } else {
    await carregarListaCiclos()
  }
}

async function removerCicloAtual() {
  if (!currentCycleId) {
    throw new Error('Selecione um ciclo para remover.')
  }

  const confirmar = window.confirm(`Deseja remover o ciclo "${currentCycleName || currentCycleId}"?`)
  if (!confirmar) {
    return
  }

  const response = await fetch(`/api/cycles/${encodeURIComponent(currentCycleId)}`, {
    method: 'DELETE'
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao remover ciclo.')
  }

  await carregarListaCiclos()
}

function renderRecipients(items) {
  recipientsCache = items || []
  recipientsList.innerHTML = ''

  dispatchRecipient.innerHTML = ''
  const defaultRecipient = recipientsCache.find((item) => item.isDefault)
  const defaultRecipientId = defaultRecipient?._id || ''

  recipientsCache.forEach((item) => {
    const option = document.createElement('option')
    option.value = item._id
    option.textContent = `${item.name} (${item.type === 'private' ? 'Privado' : 'Grupo'})`
    dispatchRecipient.appendChild(option)

    const div = document.createElement('div')
    div.className = 'list-item'
    const isDefault = item._id === defaultRecipientId
    const isCycleTarget = Boolean(item.isCycleTarget)
    div.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <div class="meta">${item.jid}</div>
        <div class="meta">Padrão no disparo: ${isDefault ? 'Sim' : 'Não'}</div>
        <div class="meta">Destino diário (1 a 15): ${isCycleTarget ? 'Sim' : 'Não'}</div>
      </div>
      <div class="actions">
        <button class="secondary" data-id="${item._id}" data-action="edit-recipient">Editar</button>
        <button class="secondary" data-id="${item._id}" data-action="set-default-recipient">${isDefault ? 'Padrão ✅' : 'Tornar padrão'}</button>
        <button class="secondary" data-id="${item._id}" data-action="set-cycle-target">${isCycleTarget ? 'Diário ✅' : 'Tornar diário 1-15'}</button>
        <button class="remove" data-id="${item._id}" data-action="delete-recipient">Remover</button>
      </div>
    `
    recipientsList.appendChild(div)
  })

  if (recipientsCache.length) {
    if (defaultRecipientId) {
      const defaultOption = Array.from(dispatchRecipient.options).find((option) => option.value === defaultRecipientId)
      if (defaultOption) {
        defaultOption.selected = true
      }
    }
  }

  if (!recipientsCache.length) {
    recipientsList.innerHTML = '<div class="meta">Nenhum destinatário cadastrado.</div>'
  }
}

function abrirModalEdicaoDestinatario(item) {
  editingRecipientId = item?._id || ''
  if (!editingRecipientId) {
    return
  }

  editRecipientName.value = item.name || ''
  editRecipientType.value = item.type || 'private'
  editRecipientDestination.value = item.destination || ''
  recipientModal.style.display = 'flex'
}

function fecharModalEdicaoDestinatario() {
  editingRecipientId = ''
  recipientModal.style.display = 'none'
}

async function salvarEdicaoDestinatario() {
  if (!editingRecipientId) {
    throw new Error('Nenhum destinatário selecionado para edição.')
  }

  const body = {
    name: (editRecipientName.value || '').trim(),
    type: editRecipientType.value,
    destination: (editRecipientDestination.value || '').trim()
  }

  const response = await fetch(`/api/recipients/${editingRecipientId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao editar destinatário.')
  }

  await carregarDadosBanco()
  fecharModalEdicaoDestinatario()
}

function renderDispatches(items) {
  dispatchesList.innerHTML = ''

  ;(items || []).forEach((item) => {
    const div = document.createElement('div')
    div.className = 'list-item'
    const origem = item.sourceType === 'cycle' ? `Central • Dia ${item.cycleDay}` : 'Manual'
    div.innerHTML = `
      <div>
        <strong>${item.recipientName} • ${item.status.toUpperCase()}</strong>
        <div class="meta">Envio: ${item.sendAtBr || '-'} | Enviado: ${item.sentAtBr || '-'}</div>
        <div class="meta">Origem: ${origem}</div>
        <div class="meta">Erro: ${item.errorMessage || '---'}</div>
      </div>
    `
    dispatchesList.appendChild(div)
  })

  if (!(items || []).length) {
    dispatchesList.innerHTML = '<div class="meta">Nenhum disparo registrado.</div>'
  }
}

function renderBotStatus(status) {
  if (!status) {
    botStatusEl.textContent = 'Status do bot indisponível.'
    return
  }

  const conexao = status.connected ? '🟢 Conectado' : '🔴 Desconectado'
  const ultimaFila = status.lastQueueRunAt ? new Date(status.lastQueueRunAt).toLocaleString('pt-BR') : '-'
  const ultimoEnvio = status.lastSentAt ? new Date(status.lastSentAt).toLocaleString('pt-BR') : '-'
  const erro = status.lastError || '---'

  botStatusEl.textContent = `Status: ${conexao} | Última fila: ${ultimaFila} | Último envio: ${ultimoEnvio} | Erro: ${erro}`
}

function modoApiSelecionado() {
  return (providerSelect?.value || 'baileys') === 'meta-cloud'
}

function atualizarVisibilidadeModo() {
  if (modoApiSelecionado()) {
    qrStatusEl.textContent = 'Modo API ativo. QR não é necessário.'
    qrWrapEl.style.display = 'none'
  }
}

async function carregarQrBot() {
  if (modoApiSelecionado()) {
    qrStatusEl.textContent = 'Modo API ativo. QR não é necessário.'
    qrWrapEl.style.display = 'none'
    return
  }

  try {
    const response = await fetch('/api/bot-qr')
    const data = await response.json()

    if (data.connected) {
      qrStatusEl.textContent = 'Bot conectado. QR não é necessário agora.'
      qrWrapEl.style.display = 'none'
      return
    }

    if (data.qrDataUrl) {
      qrStatusEl.textContent = 'Escaneie este QR com o WhatsApp para conectar o bot.'
      qrImageEl.src = data.qrDataUrl
      qrWrapEl.style.display = 'flex'
      return
    }

    qrStatusEl.textContent = 'QR ainda não gerado. Inicie o bot e clique em atualizar.'
    qrWrapEl.style.display = 'none'
  } catch {
    qrStatusEl.textContent = 'Falha ao carregar QR do bot.'
    qrWrapEl.style.display = 'none'
  }
}

async function desconectarQrSessao() {
  const response = await fetch('/api/bot-disconnect', {
    method: 'POST'
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao desconectar sessão do QR.')
  }

  await carregarQrBot()
  setStatus(data.message || 'Sessão desconectada.', 'success')
}

async function iniciarBotPainel() {
  const response = await fetch('/api/bot-start', {
    method: 'POST'
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao iniciar bot pelo painel.')
  }

  await carregarQrBot()
  const botStatusResponse = await fetch('/api/bot-status')
  const botStatus = await botStatusResponse.json()
  renderBotStatus(botStatus)
  setStatus(data.message || 'Bot iniciado com sucesso.', 'success')
}

async function carregarDadosBanco() {
  const [recipientsRes, dispatchesRes, botStatusRes] = await Promise.all([
    fetch('/api/recipients'),
    fetch('/api/dispatches'),
    fetch('/api/bot-status')
  ])

  const recipients = await recipientsRes.json()
  const dispatches = await dispatchesRes.json()
  const botStatus = await botStatusRes.json()

  renderRecipients(recipients)
  renderDispatches(dispatches)
  renderBotStatus(botStatus)
}

async function addRecipient() {
  const name = (document.getElementById('recipientName').value || '').trim()
  const type = document.getElementById('recipientType').value
  const destination = (document.getElementById('recipientDestination').value || '').trim()

  const response = await fetch('/api/recipients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, destination })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao adicionar destinatário.')
  }

  document.getElementById('recipientName').value = ''
  document.getElementById('recipientDestination').value = ''
  await carregarDadosBanco()
  setStatus('Destinatário adicionado com sucesso.', 'success')
}

async function createDispatch() {
  const recipientIds = Array.from(dispatchRecipient.selectedOptions).map((option) => option.value).filter(Boolean)
  const sourceType = dispatchSourceType.value
  const cycleDay = dispatchCycleDay.value
  const mode = dispatchMode.value
  const sendAtRaw = (document.getElementById('dispatchSendAt').value || '').trim()
  const sendAtBr = datetimeLocalToBr(sendAtRaw)
  const messageText = (document.getElementById('dispatchMessageText').value || '').trim()

  if (!recipientIds.length) {
    throw new Error('Selecione pelo menos um destinatário para criar o disparo.')
  }

  const response = await fetch('/api/dispatches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipientIds, sourceType, cycleDay, mode, sendAtBr, messageText })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao criar disparo.')
  }

  document.getElementById('dispatchSendAt').value = ''
  document.getElementById('dispatchMessageText').value = ''
  await carregarDadosBanco()
  const totalCriado = Number(data.createdCount || (Array.isArray(data.items) ? data.items.length : 0) || 1)
  setStatus(`${totalCriado} disparo(s) criado(s) com sucesso.`, 'success')
}

async function testarBot() {
  const recipientId = dispatchRecipient.value
  const response = await fetch('/api/test-dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipientId })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.message || 'Falha ao criar disparo de teste.')
  }

  await carregarDadosBanco()
  setStatus('Disparo de teste criado. Aguarde até 1 minuto para processamento.', 'success')
}

async function handleDelete(action, id) {
  if (action === 'edit-recipient') {
    const item = recipientsCache.find((recipient) => recipient._id === id)
    if (!item) {
      throw new Error('Destinatário não encontrado.')
    }

    abrirModalEdicaoDestinatario(item)
    return
  }

  if (action === 'delete-recipient') {
    await fetch(`/api/recipients/${id}`, { method: 'DELETE' })
    await carregarDadosBanco()
    return
  }

  if (action === 'set-default-recipient') {
    const response = await fetch(`/api/recipients/${id}/default`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.message || 'Não foi possível definir o destinatário padrão.')
    }

    await carregarDadosBanco()
    return
  }

  if (action === 'set-cycle-target') {
    const response = await fetch(`/api/recipients/${id}/cycle-target`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.message || 'Não foi possível definir o destinatário diário.')
    }

    await carregarDadosBanco()
    return
  }
}

async function salvarConfiguracoes() {
  saveBtn.disabled = true
  setStatus('Salvando configurações...', 'success')

  try {
    const env = {}
    camposEnv.forEach((campo) => {
      const el = document.getElementById(campo)
      env[campo] = (el?.value || '').trim()
    })

    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env, messages: [] })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Não foi possível salvar.')
    }

    setStatus(data.message || 'Configurações salvas com sucesso.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao salvar configurações.', 'error')
  } finally {
    saveBtn.disabled = false
  }
}

function adicionarDiaCiclo() {
  cycleCache.push({ message: '', timeHHmm: '18:30', isActive: true })
  renderCycleEditor(cycleCache)
}

function removerDiaCiclo(index) {
  cycleCache.splice(index, 1)
  renderCycleEditor(cycleCache)
}

function abrirModalEdicaoDiaCiclo(index) {
  const item = cycleCache[index]
  if (!item) return

  editingCycleIndex = index
  editCycleMessage.value = item.message || ''
  editCycleTime.value = item.timeHHmm || '18:30'
  editCycleDayIsActive.value = item.isActive === false ? 'false' : 'true'
  cycleDayModal.style.display = 'flex'
}

function fecharModalEdicaoDiaCiclo() {
  editingCycleIndex = -1
  cycleDayModal.style.display = 'none'
}

function salvarEdicaoDiaCiclo() {
  if (editingCycleIndex < 0 || !cycleCache[editingCycleIndex]) {
    throw new Error('Dia do ciclo não encontrado para edição.')
  }

  const message = (editCycleMessage.value || '').trim()
  const timeHHmm = (editCycleTime.value || '').trim()
  const isActive = editCycleDayIsActive.value === 'true'

  if (!message) {
    throw new Error('Mensagem do dia é obrigatória.')
  }

  if (!/^\d{2}:\d{2}$/.test(timeHHmm)) {
    throw new Error('Horário inválido. Use HH:mm.')
  }

  cycleCache[editingCycleIndex] = {
    ...cycleCache[editingCycleIndex],
    message,
    timeHHmm,
    isActive
  }

  renderCycleEditor(cycleCache)
  fecharModalEdicaoDiaCiclo()
}

function abrirModalConfiguracaoCiclo() {
  cycleStartDateInput.value = cycleSettingsCache.startDate || ''
  cycleIsActiveInput.value = cycleSettingsCache.isActive ? 'true' : 'false'
  cycleSettingsModal.style.display = 'flex'
}

function fecharModalConfiguracaoCiclo() {
  cycleSettingsModal.style.display = 'none'
}

function salvarConfiguracaoCicloLocal() {
  const startDate = (cycleStartDateInput.value || '').trim()
  const isActive = cycleIsActiveInput.value === 'true'

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Data de início inválida. Use YYYY-MM-DD.')
  }

  cycleSettingsCache = { startDate, isActive }
  renderCycleSettingsSummary()
  fecharModalConfiguracaoCiclo()
}

async function salvarCiclo() {
  saveCycleBtn.disabled = true
  setStatus('Salvando ciclo...', 'success')

  try {
    const cycle = cycleCache.map((item) => ({
      message: (item.message || '').trim(),
      timeHHmm: (item.timeHHmm || '18:30').trim(),
      isActive: item.isActive !== false
    }))

    if (cycle.length === 0) {
      throw new Error('Configure pelo menos um dia com mensagem e horário.')
    }

    if (!cycleSettingsCache.startDate) {
      throw new Error('Defina a data de início do ciclo em "Configurar ciclo".')
    }

    const response = await fetch('/api/cycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycleId: currentCycleId, cycle, settings: cycleSettingsCache })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Não foi possível salvar o ciclo.')
    }

    await carregarListaCiclos(currentCycleId)
    setStatus(data.message || 'Ciclo salvo com sucesso.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao salvar ciclo.', 'error')
  } finally {
    saveCycleBtn.disabled = false
  }
}

saveBtn.addEventListener('click', salvarConfiguracoes)
reloadBtn.addEventListener('click', carregarConfiguracoes)
addCycleDayBtn.addEventListener('click', adicionarDiaCiclo)
saveCycleBtn.addEventListener('click', salvarCiclo)
editCycleSettingsBtn.addEventListener('click', abrirModalConfiguracaoCiclo)
cycleSelect?.addEventListener('change', async () => {
  try {
    const cycleId = cycleSelect.value
    if (!cycleId) return
    await ativarCicloSelecionado(cycleId)
    setStatus('Ciclo ativo alterado.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao alterar ciclo ativo.', 'error')
  }
})
addCycleBtn?.addEventListener('click', async () => {
  try {
    await criarNovoCiclo()
    setStatus('Novo ciclo criado e ativado.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao criar ciclo.', 'error')
  }
})
deleteCycleBtn?.addEventListener('click', async () => {
  try {
    await removerCicloAtual()
    setStatus('Ciclo removido com sucesso.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao remover ciclo.', 'error')
  }
})

document.getElementById('addRecipientBtn').addEventListener('click', async () => {
  try {
    await addRecipient()
  } catch (error) {
    setStatus(error.message || 'Erro ao adicionar destinatário.', 'error')
  }
})

document.getElementById('sendDispatchBtn').addEventListener('click', async () => {
  try {
    await createDispatch()
  } catch (error) {
    setStatus(error.message || 'Erro ao criar disparo.', 'error')
  }
})

document.getElementById('testBotBtn').addEventListener('click', async () => {
  try {
    await testarBot()
  } catch (error) {
    setStatus(error.message || 'Erro ao testar bot.', 'error')
  }
})

document.getElementById('refreshQrBtn').addEventListener('click', carregarQrBot)
startBotBtn?.addEventListener('click', async () => {
  try {
    await iniciarBotPainel()
  } catch (error) {
    setStatus(error.message || 'Erro ao iniciar bot.', 'error')
  }
})
disconnectQrBtn?.addEventListener('click', async () => {
  try {
    const confirmar = window.confirm('Tem certeza que deseja desconectar a sessão do QR? Será necessário escanear novamente para reconectar.')
    if (!confirmar) {
      setStatus('Desconexão cancelada.', 'success')
      return
    }

    await desconectarQrSessao()
  } catch (error) {
    setStatus(error.message || 'Erro ao desconectar sessão.', 'error')
  }
})
providerSelect.addEventListener('change', atualizarVisibilidadeModo)

dispatchMode.addEventListener('change', () => {
  sendAtWrap.style.display = dispatchMode.value === 'scheduled' ? 'block' : 'none'
})

dispatchSourceType.addEventListener('change', () => {
  const isCycle = dispatchSourceType.value === 'cycle'
  cycleDayWrap.style.display = isCycle ? 'block' : 'none'
})

document.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  if (target.getAttribute('data-action') === 'edit-cycle-day') {
    const index = Number(target.getAttribute('data-index'))
    if (!Number.isNaN(index)) {
      abrirModalEdicaoDiaCiclo(index)
    }
    return
  }

  // Remover dia do ciclo
  if (target.classList.contains('cycle-remove-btn')) {
    const index = Number(target.getAttribute('data-index'))
    if (!Number.isNaN(index)) {
      removerDiaCiclo(index)
    }
    return
  }

  const action = target.getAttribute('data-action')
  const id = target.getAttribute('data-id')
  if (!action || !id) return

  try {
    await handleDelete(action, id)
    if (action === 'edit-recipient') {
      return
    }

    if (action === 'set-default-recipient') {
      setStatus('Destinatário padrão atualizado.', 'success')
    } else if (action === 'set-cycle-target') {
      setStatus('Destinatário diário (1 a 15) atualizado.', 'success')
    } else {
      setStatus('Item removido com sucesso.', 'success')
    }
  } catch (error) {
    setStatus(error.message || 'Erro ao remover item.', 'error')
  }
})

cancelEditRecipientBtn.addEventListener('click', () => {
  fecharModalEdicaoDestinatario()
})

saveEditRecipientBtn.addEventListener('click', async () => {
  try {
    await salvarEdicaoDestinatario()
    setStatus('Destinatário atualizado com sucesso.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao atualizar destinatário.', 'error')
  }
})

recipientModal.addEventListener('click', (event) => {
  if (event.target === recipientModal) {
    fecharModalEdicaoDestinatario()
  }
})

cancelEditCycleDayBtn.addEventListener('click', () => {
  fecharModalEdicaoDiaCiclo()
})

saveEditCycleDayBtn.addEventListener('click', () => {
  try {
    salvarEdicaoDiaCiclo()
    setStatus('Dia do ciclo atualizado.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao editar dia do ciclo.', 'error')
  }
})

cycleDayModal.addEventListener('click', (event) => {
  if (event.target === cycleDayModal) {
    fecharModalEdicaoDiaCiclo()
  }
})

cancelCycleSettingsBtn.addEventListener('click', () => {
  fecharModalConfiguracaoCiclo()
})

saveCycleSettingsBtn.addEventListener('click', () => {
  try {
    salvarConfiguracaoCicloLocal()
    setStatus('Configurações do ciclo atualizadas.', 'success')
  } catch (error) {
    setStatus(error.message || 'Erro ao atualizar configurações do ciclo.', 'error')
  }
})

cycleSettingsModal.addEventListener('click', (event) => {
  if (event.target === cycleSettingsModal) {
    fecharModalConfiguracaoCiclo()
  }
})

async function bootstrap() {
  initSideMenu()
  await carregarConfiguracoes()
  atualizarVisibilidadeModo()
  await carregarDadosBanco()
  await carregarQrBot()
  cycleDayWrap.style.display = dispatchSourceType.value === 'cycle' ? 'block' : 'none'

  setInterval(async () => {
    await carregarQrBot()
    const botStatusResponse = await fetch('/api/bot-status')
    const botStatus = await botStatusResponse.json()
    renderBotStatus(botStatus)
  }, 5000)
}

bootstrap()
