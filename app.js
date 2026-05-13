/**
 * FlowProcess Studio — app.js
 * Editor visual de processos corporativos
 * Puro HTML/CSS/JS — sem frameworks ou bundlers
 */

// ============================================================
//  STATE
// ============================================================
const state = {
  lanes: [],        // [{ id, name }]
  blocks: [],       // [{ id, type, laneId, x, y, text }]
  connectors: [],   // [{ id, fromId, toId }]

  selectedBlockId:    null,
  selectedConnectorId: null,

  connectMode:   false,
  connectSource: null,  // blockId waiting for target

  dragging:      null,  // { blockId, offsetX, offsetY, laneId }
};

let idCounter = Date.now();
const uid = () => 'id_' + (idCounter++);

// ============================================================
//  DOM REFS
// ============================================================
const lanesContainer = document.getElementById('lanesContainer');
const svgLayer       = document.getElementById('connectorsLayer');
const inlineEdit     = document.getElementById('inlineEdit');
const toast          = document.getElementById('toast');
const processTitle   = document.getElementById('processTitle');
const btnConnect     = document.getElementById('btnConnect');
const btnAddLane     = document.getElementById('btnAddLane');
const btnDelete      = document.getElementById('btnDelete');
const btnSave        = document.getElementById('btnSave');
const btnLoad        = document.getElementById('btnLoad');
const btnExportPNG   = document.getElementById('btnExportPNG');
const btnExportPDF   = document.getElementById('btnExportPDF');
const btnClear       = document.getElementById('btnClear');
const mobileMenuBtn  = document.getElementById('mobileMenuBtn');
const sidebar        = document.getElementById('sidebar');
const canvasWrapper  = document.getElementById('canvasWrapper');

// ============================================================
//  TOAST NOTIFICATION
// ============================================================
let toastTimer = null;
function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className   = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// ============================================================
//  INITIALIZATION
// ============================================================
function init() {
  setupSVGDefs();
  setupEventListeners();
  // Default lanes
  addLane('Solicitante');
  addLane('Área');
  addLane('Executor');
  render();
}

// ============================================================
//  SVG DEFS (arrowhead marker)
// ============================================================
function setupSVGDefs() {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrowhead" markerWidth="10" markerHeight="7"
      refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#1e40af" />
    </marker>
    <marker id="arrowhead-selected" markerWidth="10" markerHeight="7"
      refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#dc2626" />
    </marker>
  `;
  svgLayer.appendChild(defs);
}

// ============================================================
//  EVENT LISTENERS
// ============================================================
function setupEventListeners() {
  // Toolbar buttons
  btnAddLane.addEventListener('click', () => { addLane(); render(); });
  btnDelete.addEventListener('click', deleteSelected);
  btnSave.addEventListener('click', saveToStorage);
  btnLoad.addEventListener('click', loadFromStorage);
  btnExportPNG.addEventListener('click', exportPNG);
  btnExportPDF.addEventListener('click', exportPDF);
  btnClear.addEventListener('click', clearAll);
  btnConnect.addEventListener('click', toggleConnectMode);
  mobileMenuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

  // Tool buttons — add block
  document.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      addBlockToFirstLane(type);
    });
  });

  // Canvas background click → deselect
  lanesContainer.addEventListener('mousedown', (e) => {
    if (e.target === lanesContainer || e.target.classList.contains('lane-body')) {
      deselectAll();
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === inlineEdit) return;
    if (document.activeElement === processTitle) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement.tagName === 'INPUT') return;
      deleteSelected();
    }
    if (e.key === 'Escape') {
      if (state.connectMode) toggleConnectMode();
      deselectAll();
      if (inlineEdit.style.display !== 'none') cancelInlineEdit();
    }
  });

  // Mouse move & up for dragging
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Touch events for mobile drag
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
}

// ============================================================
//  LANES
// ============================================================
function addLane(name) {
  const id = uid();
  const laneName = name || 'Nova Raia';
  state.lanes.push({ id, name: laneName });
  return id;
}

function deleteLane(laneId) {
  // remove blocks in lane
  const blockIds = state.blocks.filter(b => b.laneId === laneId).map(b => b.id);
  blockIds.forEach(bid => {
    state.connectors = state.connectors.filter(c => c.fromId !== bid && c.toId !== bid);
    state.blocks = state.blocks.filter(b => b.id !== bid);
  });
  state.lanes = state.lanes.filter(l => l.id !== laneId);
  render();
}

function startLaneRename(laneId) {
  const lane = state.lanes.find(l => l.id === laneId);
  if (!lane) return;
  const laneEl = document.querySelector(`[data-lane-id="${laneId}"]`);
  const titleEl = laneEl.querySelector('.lane-title');
  const rect = titleEl.getBoundingClientRect();

  inlineEdit.value = lane.name;
  inlineEdit.style.display = 'block';
  // Position near title
  inlineEdit.style.left   = (rect.left + rect.width + 10) + 'px';
  inlineEdit.style.top    = (rect.top + rect.height / 2 - 16) + 'px';
  inlineEdit.style.width  = '160px';
  inlineEdit.dataset.editType = 'lane';
  inlineEdit.dataset.editId   = laneId;
  inlineEdit.focus();
  inlineEdit.select();
}

// ============================================================
//  BLOCKS
// ============================================================
function addBlockToFirstLane(type) {
  if (state.lanes.length === 0) {
    addLane('Raia 1');
  }
  const laneId = state.lanes[0].id;
  const defaults = {
    start:      { text: 'Início',     w: 70,  h: 70 },
    task:       { text: 'Nova tarefa',w: 140, h: 70 },
    decision:   { text: 'Aprovado?',  w: 90,  h: 90 },
    end:        { text: 'Fim',        w: 70,  h: 70 },
    annotation: { text: 'Observação', w: 140, h: 60 },
  };
  const d = defaults[type] || defaults.task;
  // Place block scattered to avoid overlap
  const existingInLane = state.blocks.filter(b => b.laneId === laneId).length;
  const x = 20 + (existingInLane % 5) * 170;
  const y = 30 + Math.floor(existingInLane / 5) * 100;

  const block = {
    id: uid(), type, laneId,
    x, y,
    text: d.text,
    w: d.w, h: d.h,
  };
  state.blocks.push(block);
  render();
  selectBlock(block.id);
}

function deleteSelected() {
  if (state.selectedBlockId) {
    const bid = state.selectedBlockId;
    state.connectors = state.connectors.filter(c => c.fromId !== bid && c.toId !== bid);
    state.blocks = state.blocks.filter(b => b.id !== bid);
    state.selectedBlockId = null;
    render();
  } else if (state.selectedConnectorId) {
    state.connectors = state.connectors.filter(c => c.id !== state.selectedConnectorId);
    state.selectedConnectorId = null;
    render();
  }
}

function selectBlock(id) {
  state.selectedBlockId    = id;
  state.selectedConnectorId = null;
  updateSelectionVisuals();
}

function selectConnector(id) {
  state.selectedConnectorId = id;
  state.selectedBlockId    = null;
  updateSelectionVisuals();
}

function deselectAll() {
  state.selectedBlockId    = null;
  state.selectedConnectorId = null;
  state.connectSource      = null;
  updateSelectionVisuals();
}

function updateSelectionVisuals() {
  document.querySelectorAll('.block').forEach(el => {
    el.classList.toggle('selected', el.dataset.blockId === state.selectedBlockId);
    el.classList.toggle('connect-source', el.dataset.blockId === state.connectSource);
  });
  document.querySelectorAll('.connector-line').forEach(el => {
    el.classList.toggle('selected', el.dataset.connId === state.selectedConnectorId);
  });
}

// ============================================================
//  CONNECT MODE
// ============================================================
function toggleConnectMode() {
  state.connectMode  = !state.connectMode;
  state.connectSource = null;
  btnConnect.classList.toggle('active', state.connectMode);
  document.body.classList.toggle('connect-mode', state.connectMode);
  if (!state.connectMode) deselectAll();
}

function handleBlockClickInConnectMode(blockId) {
  if (!state.connectSource) {
    state.connectSource = blockId;
    updateSelectionVisuals();
    showToast('Clique no bloco de destino', 'info');
  } else {
    if (state.connectSource === blockId) {
      state.connectSource = null;
      updateSelectionVisuals();
      return;
    }
    // Avoid duplicate connectors
    const exists = state.connectors.find(
      c => c.fromId === state.connectSource && c.toId === blockId
    );
    if (!exists) {
      state.connectors.push({ id: uid(), fromId: state.connectSource, toId: blockId });
      showToast('Conexão criada!', 'success');
    } else {
      showToast('Conexão já existe', 'info');
    }
    state.connectSource = null;
    render();
  }
}

// ============================================================
//  DRAGGING
// ============================================================
function onBlockMouseDown(e, blockId) {
  if (state.connectMode) return;
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  selectBlock(blockId);

  const block  = state.blocks.find(b => b.id === blockId);
  const laneEl = document.querySelector(`[data-lane-id="${block.laneId}"]`);
  const laneBody = laneEl.querySelector('.lane-body');
  const laneRect = laneBody.getBoundingClientRect();
  const blockEl  = document.querySelector(`[data-block-id="${blockId}"]`);
  const blockRect = blockEl.getBoundingClientRect();

  state.dragging = {
    blockId,
    offsetX: e.clientX - blockRect.left,
    offsetY: e.clientY - blockRect.top,
    originLaneId: block.laneId,
  };
}

function onMouseMove(e) {
  if (!state.dragging) return;

  const { blockId, offsetX, offsetY } = state.dragging;
  const block = state.blocks.find(b => b.id === blockId);
  if (!block) return;

  // Determine which lane the cursor is over
  const targetLane = getLaneAtPoint(e.clientX, e.clientY);

  if (targetLane) {
    const laneBody = document.querySelector(`[data-lane-id="${targetLane.id}"]`).querySelector('.lane-body');
    const laneRect = laneBody.getBoundingClientRect();
    let nx = e.clientX - laneRect.left - offsetX;
    let ny = e.clientY - laneRect.top  - offsetY;
    // Clamp to lane boundaries
    nx = Math.max(0, Math.min(nx, laneRect.width  - block.w));
    ny = Math.max(0, Math.min(ny, laneRect.height - block.h));
    block.x = nx;
    block.y = ny;
    block.laneId = targetLane.id;
  }

  // Re-render connectors only for performance; redraw full on mouseup
  renderConnectors();
  // Update block position directly for smoothness
  const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
  if (blockEl) {
    blockEl.style.left = block.x + 'px';
    blockEl.style.top  = block.y + 'px';
    if (block.laneId !== state.dragging.originLaneId) {
      // Move to new lane body
      const newLaneBody = document.querySelector(`[data-lane-id="${block.laneId}"]`)?.querySelector('.lane-body');
      if (newLaneBody && blockEl.parentNode !== newLaneBody) {
        newLaneBody.appendChild(blockEl);
        state.dragging.originLaneId = block.laneId;
      }
    }
  }
}

function onMouseUp() {
  if (!state.dragging) return;
  state.dragging = null;
  render();
}

// Touch support
function onTouchMove(e) {
  if (!state.dragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onTouchEnd() {
  onMouseUp();
}

function getLaneAtPoint(cx, cy) {
  for (const lane of state.lanes) {
    const laneEl = document.querySelector(`[data-lane-id="${lane.id}"]`);
    if (!laneEl) continue;
    const laneBody = laneEl.querySelector('.lane-body');
    const rect = laneBody.getBoundingClientRect();
    if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
      return lane;
    }
  }
  return null;
}

// ============================================================
//  INLINE TEXT EDIT
// ============================================================
function startBlockEdit(blockId) {
  const block  = state.blocks.find(b => b.id === blockId);
  if (!block) return;
  const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
  const rect    = blockEl.getBoundingClientRect();

  inlineEdit.value = block.text;
  inlineEdit.style.display = 'block';
  inlineEdit.style.left    = rect.left + 'px';
  inlineEdit.style.top     = rect.top  + 'px';
  inlineEdit.style.width   = Math.max(block.w, 120) + 'px';
  inlineEdit.dataset.editType = 'block';
  inlineEdit.dataset.editId   = blockId;
  inlineEdit.focus();
  inlineEdit.select();
}

function commitInlineEdit() {
  const type = inlineEdit.dataset.editType;
  const id   = inlineEdit.dataset.editId;
  const val  = inlineEdit.value.trim();

  if (type === 'block') {
    const block = state.blocks.find(b => b.id === id);
    if (block && val) block.text = val;
  } else if (type === 'lane') {
    const lane = state.lanes.find(l => l.id === id);
    if (lane && val) lane.name = val;
  }
  cancelInlineEdit();
  render();
}

function cancelInlineEdit() {
  inlineEdit.style.display    = 'none';
  inlineEdit.dataset.editType = '';
  inlineEdit.dataset.editId   = '';
}

inlineEdit.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  commitInlineEdit();
  if (e.key === 'Escape') cancelInlineEdit();
});
inlineEdit.addEventListener('blur', commitInlineEdit);

// ============================================================
//  RENDER
// ============================================================
function render() {
  renderLanes();
  renderConnectors();
  updateSelectionVisuals();
  syncSVGSize();
}

function renderLanes() {
  lanesContainer.innerHTML = '';

  if (state.lanes.length === 0) {
    lanesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗂️</div>
        <div>Adicione raias e elementos pelo menu lateral</div>
      </div>`;
    return;
  }

  state.lanes.forEach((lane, idx) => {
    const laneEl = document.createElement('div');
    laneEl.className = 'lane';
    laneEl.dataset.laneId = lane.id;

    // Lane header
    laneEl.innerHTML = `
      <div class="lane-header">
        <div class="lane-title-wrap">
          <span class="lane-title" title="Duplo clique para renomear">${escHtml(lane.name)}</span>
          <button class="lane-edit-btn" title="Renomear raia">✏️</button>
          <button class="lane-delete-btn" title="Excluir raia">✕</button>
        </div>
      </div>
      <div class="lane-body"></div>
    `;

    // Lane rename — double click title
    const titleEl = laneEl.querySelector('.lane-title');
    titleEl.addEventListener('dblclick', () => startLaneRename(lane.id));

    // Lane rename button
    laneEl.querySelector('.lane-edit-btn').addEventListener('click', () => startLaneRename(lane.id));

    // Lane delete button
    laneEl.querySelector('.lane-delete-btn').addEventListener('click', () => {
      if (confirm(`Excluir a raia "${lane.name}" e todos os blocos dentro dela?`)) {
        deleteLane(lane.id);
      }
    });

    // Render blocks into this lane's body
    const laneBody = laneEl.querySelector('.lane-body');
    const blocksInLane = state.blocks.filter(b => b.laneId === lane.id);
    blocksInLane.forEach(block => {
      laneBody.appendChild(createBlockElement(block));
    });

    lanesContainer.appendChild(laneEl);
  });
}

function createBlockElement(block) {
  const el = document.createElement('div');
  el.className = `block block-${block.type}`;
  el.dataset.blockId = block.id;
  el.style.left = block.x + 'px';
  el.style.top  = block.y + 'px';
  if (block.w) el.style.width  = block.w + 'px';
  if (block.h) el.style.height = block.h + 'px';

  // Decision uses inner wrapper to counter-rotate text
  if (block.type === 'decision') {
    el.innerHTML = `<div class="block-inner">${escHtml(block.text)}</div>`;
  } else {
    el.textContent = block.text;
  }

  // Mouse events
  el.addEventListener('mousedown', (e) => {
    if (state.connectMode) return;
    onBlockMouseDown(e, block.id);
  });

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.connectMode) {
      handleBlockClickInConnectMode(block.id);
      return;
    }
    selectBlock(block.id);
  });

  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (!state.connectMode) startBlockEdit(block.id);
  });

  // Touch start for drag
  el.addEventListener('touchstart', (e) => {
    if (state.connectMode) return;
    e.stopPropagation();
    const touch = e.touches[0];
    selectBlock(block.id);
    const rect = el.getBoundingClientRect();
    state.dragging = {
      blockId: block.id,
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top,
      originLaneId: block.laneId,
    };
  }, { passive: true });

  // Connect-mode hover
  el.addEventListener('mouseenter', () => {
    if (state.connectMode && state.connectSource && state.connectSource !== block.id) {
      el.classList.add('connect-hover');
    }
  });
  el.addEventListener('mouseleave', () => el.classList.remove('connect-hover'));

  return el;
}

// ============================================================
//  CONNECTORS
// ============================================================
function renderConnectors() {
  // Remove existing lines (keep defs)
  svgLayer.querySelectorAll('.connector-line, .connector-label').forEach(el => el.remove());

  state.connectors.forEach(conn => {
    const fromBlock = state.blocks.find(b => b.id === conn.fromId);
    const toBlock   = state.blocks.find(b => b.id === conn.toId);
    if (!fromBlock || !toBlock) return;

    const from = getBlockCenter(fromBlock);
    const to   = getBlockCenter(toBlock);
    if (!from || !to) return;

    // Compute edge connection points
    const { src, dst } = getEdgePoints(fromBlock, toBlock, from, to);

    // Curved path
    const dx = dst.x - src.x;
    const dy = dst.y - src.y;
    const cx1 = src.x + dx * 0.5;
    const cy1 = src.y;
    const cx2 = src.x + dx * 0.5;
    const cy2 = dst.y;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${src.x},${src.y} C${cx1},${cy1} ${cx2},${cy2} ${dst.x},${dst.y}`);
    path.classList.add('connector-line');
    path.dataset.connId = conn.id;

    const isSelected = conn.id === state.selectedConnectorId;
    path.setAttribute('marker-end', isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)');
    path.setAttribute('stroke', isSelected ? '#dc2626' : '#1e40af');

    // Click on connector to select/delete
    path.addEventListener('click', (e) => {
      e.stopPropagation();
      selectConnector(conn.id);
    });

    svgLayer.appendChild(path);
  });
}

function getBlockCenter(block) {
  const laneEl = document.querySelector(`[data-lane-id="${block.laneId}"]`);
  if (!laneEl) return null;
  const laneBody = laneEl.querySelector('.lane-body');
  const laneRect  = laneBody.getBoundingClientRect();
  const wrapRect  = canvasWrapper.getBoundingClientRect();

  const cx = (laneRect.left - wrapRect.left) + block.x + (block.w || 70) / 2;
  const cy = (laneRect.top  - wrapRect.top)  + block.y + (block.h || 70) / 2;
  return { x: cx, y: cy };
}

function getEdgePoints(fromBlock, toBlock, from, to) {
  const fw = fromBlock.w || 70, fh = fromBlock.h || 70;
  const tw = toBlock.w  || 70, th = toBlock.h  || 70;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Determine exit/entry sides
  let src, dst;

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal dominant
    src = dx > 0
      ? { x: from.x + fw / 2, y: from.y }
      : { x: from.x - fw / 2, y: from.y };
    dst = dx > 0
      ? { x: to.x - tw / 2, y: to.y }
      : { x: to.x + tw / 2, y: to.y };
  } else {
    // Vertical dominant
    src = dy > 0
      ? { x: from.x, y: from.y + fh / 2 }
      : { x: from.x, y: from.y - fh / 2 };
    dst = dy > 0
      ? { x: to.x, y: to.y - th / 2 }
      : { x: to.x, y: to.y + th / 2 };
  }

  return { src, dst };
}

function syncSVGSize() {
  const rect = lanesContainer.getBoundingClientRect();
  svgLayer.setAttribute('width',  lanesContainer.scrollWidth);
  svgLayer.setAttribute('height', lanesContainer.scrollHeight);
  svgLayer.style.width  = lanesContainer.scrollWidth  + 'px';
  svgLayer.style.height = lanesContainer.scrollHeight + 'px';
}

// ============================================================
//  SAVE / LOAD
// ============================================================
function saveToStorage() {
  const data = {
    title:      processTitle.value,
    lanes:      state.lanes,
    blocks:     state.blocks,
    connectors: state.connectors,
    version:    2,
  };
  try {
    localStorage.setItem('flowprocess_save', JSON.stringify(data));
    showToast('Processo salvo com sucesso!', 'success');
  } catch(e) {
    showToast('Erro ao salvar: ' + e.message, 'error');
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('flowprocess_save');
    if (!raw) { showToast('Nenhum processo salvo encontrado.', 'info'); return; }
    const data = JSON.parse(raw);
    if (!data.lanes || !data.blocks) throw new Error('Formato inválido');

    processTitle.value  = data.title    || 'Processo sem título';
    state.lanes         = data.lanes    || [];
    state.blocks        = data.blocks   || [];
    state.connectors    = data.connectors || [];
    state.selectedBlockId    = null;
    state.selectedConnectorId = null;
    state.connectMode   = false;
    state.connectSource = null;
    state.dragging      = null;
    btnConnect.classList.remove('active');
    document.body.classList.remove('connect-mode');

    render();
    showToast('Processo carregado!', 'success');
  } catch(e) {
    showToast('Erro ao carregar: ' + e.message, 'error');
  }
}

// ============================================================
//  CLEAR
// ============================================================
function clearAll() {
  if (!confirm('Limpar todo o processo? Esta ação não pode ser desfeita.')) return;
  state.lanes      = [];
  state.blocks     = [];
  state.connectors = [];
  state.selectedBlockId    = null;
  state.selectedConnectorId = null;
  state.connectMode   = false;
  state.connectSource = null;
  state.dragging      = null;
  btnConnect.classList.remove('active');
  document.body.classList.remove('connect-mode');

  // Restore default lanes
  addLane('Solicitante');
  addLane('Área');
  addLane('Executor');
  processTitle.value = 'Processo sem título';
  render();
  showToast('Editor limpo.', 'info');
}

// ============================================================
//  EXPORT PNG
// ============================================================
function exportPNG() {
  showToast('Gerando PNG...', 'info');

  // Temporarily hide selection & inline edit
  deselectAll();
  cancelInlineEdit();

  const target = canvasWrapper;

  setTimeout(() => {
    html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f1f5f9',
      logging: false,
    }).then(canvas => {
      const link = document.createElement('a');
      link.download = (processTitle.value || 'processo') + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('PNG exportado!', 'success');
    }).catch(err => {
      showToast('Erro ao exportar PNG', 'error');
      console.error(err);
    });
  }, 100);
}

// ============================================================
//  EXPORT PDF
// ============================================================
function exportPDF() {
  showToast('Gerando PDF...', 'info');
  deselectAll();
  cancelInlineEdit();

  const target = canvasWrapper;

  setTimeout(() => {
    html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f1f5f9',
      logging: false,
    }).then(canvas => {
      const { jsPDF } = window.jspdf;
      const imgData = canvas.toDataURL('image/png');
      const imgW = canvas.width;
      const imgH = canvas.height;

      // Landscape A4 in mm: 297 x 210
      const pageW = 297;
      const pageH = 210;
      const ratio = Math.min(pageW / (imgW / 2), pageH / (imgH / 2)); // /2 because scale=2

      const drawW = (imgW / 2) * ratio;
      const drawH = (imgH / 2) * ratio;
      const offsetX = (pageW - drawW) / 2;
      const offsetY = (pageH - drawH) / 2;

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Header
      pdf.setFontSize(10);
      pdf.setTextColor(100);
      pdf.text('FlowProcess Studio', 10, 8);
      pdf.setFontSize(13);
      pdf.setTextColor(15, 23, 42);
      pdf.text(processTitle.value || 'Processo', pageW / 2, 8, { align: 'center' });
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text(new Date().toLocaleDateString('pt-BR'), pageW - 10, 8, { align: 'right' });

      // Diagram
      pdf.addImage(imgData, 'PNG', offsetX, offsetY + 5, drawW, drawH - 5);

      pdf.save((processTitle.value || 'processo') + '.pdf');
      showToast('PDF exportado!', 'success');
    }).catch(err => {
      showToast('Erro ao exportar PDF', 'error');
      console.error(err);
    });
  }, 100);
}

// ============================================================
//  UTILITY
// ============================================================
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  RESIZE OBSERVER — keep SVG layer synced
// ============================================================
const resizeObserver = new ResizeObserver(() => {
  syncSVGSize();
  renderConnectors();
});
resizeObserver.observe(lanesContainer);
window.addEventListener('resize', () => {
  syncSVGSize();
  renderConnectors();
});

// ============================================================
//  START
// ============================================================
init();
