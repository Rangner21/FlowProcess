const canvas = document.getElementById('canvas');
const lanesEl = document.getElementById('lanes');
const connectorLayer = document.getElementById('connectorLayer');
const statusText = document.getElementById('statusText');
const toast = document.getElementById('toast');
const processTitle = document.getElementById('processTitle');

const STORAGE_KEY = 'flowprocess_studio_project_v2';

let state = {
  lanes: [],
  nodes: [],
  connectors: []
};

let selected = null; // {type:'node'|'connector', id}
let connectMode = false;
let connectSource = null;
let dragging = null;
let idCounter = Date.now();

function uid(prefix) { return `${prefix}_${++idCounter}`; }

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}
function setStatus(message) { statusText.textContent = message; }

function init() {
  setupSvgDefs();
  bindEvents();
  loadDefault();
  render();
}

function setupSvgDefs() {
  connectorLayer.innerHTML = `
    <defs>
      <marker id="arrowHead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L10,4 L0,8 Z" fill="#334155"></path>
      </marker>
    </defs>`;
}

function bindEvents() {
  document.getElementById('btnAddLane').addEventListener('click', () => addLane());
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addNode(btn.dataset.add));
  });
  document.getElementById('btnConnectMode').addEventListener('click', toggleConnectMode);
  document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);
  document.getElementById('btnSave').addEventListener('click', saveProject);
  document.getElementById('btnLoad').addEventListener('click', loadProject);
  document.getElementById('btnExportPng').addEventListener('click', exportPNG);
  document.getElementById('btnExportPdf').addEventListener('click', exportPDF);
  document.getElementById('btnClear').addEventListener('click', clearProject);
  document.getElementById('btnAddExample').addEventListener('click', addExample);
  document.getElementById('btnFit').addEventListener('click', () => document.getElementById('canvasScroll').scrollTo({left:0, top:0, behavior:'smooth'}));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = document.activeElement?.tagName?.toLowerCase();
      if (active !== 'input' && active !== 'textarea') deleteSelected();
    }
    if (e.key === 'Escape') {
      selected = null; connectSource = null; connectMode = false; updateConnectButton(); render();
    }
  });

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('click', (e) => {
    if (e.target === canvas || e.target === lanesEl) {
      selected = null; connectSource = null; render();
    }
  });
}

function loadDefault() {
  state.lanes = [
    { id: uid('lane'), title: 'Solicitante' },
    { id: uid('lane'), title: 'Área' },
    { id: uid('lane'), title: 'Executor' }
  ];
  state.nodes = [
    { id: uid('node'), type: 'start', text: 'Início', x: 205, y: 55 },
    { id: uid('node'), type: 'task', text: 'Solicita demanda', x: 355, y: 62 },
    { id: uid('node'), type: 'decision', text: 'Aprovado?', x: 565, y: 225 },
    { id: uid('node'), type: 'task', text: 'Executa atividade', x: 760, y: 432 },
    { id: uid('node'), type: 'end', text: 'Fim', x: 990, y: 455 }
  ];
  state.connectors = [
    { id: uid('conn'), from: state.nodes[0].id, to: state.nodes[1].id },
    { id: uid('conn'), from: state.nodes[1].id, to: state.nodes[2].id },
    { id: uid('conn'), from: state.nodes[2].id, to: state.nodes[3].id },
    { id: uid('conn'), from: state.nodes[3].id, to: state.nodes[4].id }
  ];
}

function addExample() {
  if (!confirm('Adicionar exemplo vai substituir o processo atual. Continuar?')) return;
  processTitle.value = 'Processo de Requisição de Compra';
  state.lanes = [
    { id: uid('lane'), title: 'Solicitante' },
    { id: uid('lane'), title: 'Gestor' },
    { id: uid('lane'), title: 'Compras' },
    { id: uid('lane'), title: 'Financeiro' }
  ];
  state.nodes = [];
  const n1 = createNode('start', 'Início', 210, 55);
  const n2 = createNode('task', 'Abre requisição', 355, 62);
  const n3 = createNode('decision', 'Gestor aprova?', 555, 220);
  const n4 = createNode('task', 'Cotação com fornecedor', 740, 410);
  const n5 = createNode('task', 'Valida orçamento', 955, 600);
  const n6 = createNode('end', 'Fim', 1160, 615);
  state.nodes.push(n1,n2,n3,n4,n5,n6);
  state.connectors = [
    { id: uid('conn'), from: n1.id, to: n2.id },
    { id: uid('conn'), from: n2.id, to: n3.id },
    { id: uid('conn'), from: n3.id, to: n4.id },
    { id: uid('conn'), from: n4.id, to: n5.id },
    { id: uid('conn'), from: n5.id, to: n6.id }
  ];
  render();
  showToast('Exemplo criado');
}

function createNode(type, text, x, y) { return { id: uid('node'), type, text, x, y }; }

function addLane() {
  state.lanes.push({ id: uid('lane'), title: `Nova raia ${state.lanes.length + 1}` });
  render(); showToast('Raia adicionada');
}

function addNode(type) {
  const defaults = {
    start: 'Início', task: 'Nova tarefa', decision: 'Aprovado?', end: 'Fim', note: 'Observação'
  };
  const baseY = Math.max(45, (state.lanes.length ? 50 : 30));
  const node = createNode(type, defaults[type], 210 + (state.nodes.length % 4) * 185, baseY + (Math.floor(state.nodes.length / 4) % Math.max(1,state.lanes.length)) * 185);
  state.nodes.push(node);
  selected = {type:'node', id: node.id};
  render(); showToast('Bloco adicionado');
}

function render() {
  renderLanes();
  renderNodes();
  renderConnectors();
  updateCanvasSize();
  updateConnectButton();
}

function renderLanes() {
  lanesEl.innerHTML = '';
  state.lanes.forEach((lane) => {
    const laneEl = document.createElement('div');
    laneEl.className = 'lane';
    laneEl.dataset.id = lane.id;
    const label = document.createElement('div');
    label.className = 'lane-label';
    label.title = 'Duplo clique para editar o nome da raia';
    label.innerHTML = `<span>${escapeHtml(lane.title)}</span>`;
    label.addEventListener('dblclick', () => editLaneTitle(lane.id));
    laneEl.appendChild(label);
    lanesEl.appendChild(laneEl);
  });
}

function renderNodes() {
  document.querySelectorAll('.node').forEach(el => el.remove());
  state.nodes.forEach(node => {
    const el = document.createElement('div');
    el.className = `node ${node.type}`;
    if (selected?.type === 'node' && selected.id === node.id) el.classList.add('selected');
    if (connectSource === node.id) el.classList.add('connect-source');
    el.dataset.id = node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.innerHTML = `<span class="node-text">${escapeHtml(node.text)}</span>`;
    el.addEventListener('pointerdown', (e) => onNodePointerDown(e, node.id));
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); editNodeText(node.id); });
    el.addEventListener('click', (e) => onNodeClick(e, node.id));
    canvas.appendChild(el);
  });
}

function renderConnectors() {
  setupSvgDefs();
  state.connectors.forEach(conn => {
    const from = state.nodes.find(n => n.id === conn.from);
    const to = state.nodes.find(n => n.id === conn.to);
    if (!from || !to) return;
    const p1 = centerOf(from);
    const p2 = centerOf(to);
    const pathData = makePath(p1, p2);

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', pathData);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '18');
    hit.setAttribute('fill', 'none');
    hit.classList.add('connector-hit');
    hit.style.pointerEvents = 'stroke';
    hit.addEventListener('click', (e) => {
      e.stopPropagation(); selected = {type:'connector', id: conn.id}; render();
    });

    const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    visible.setAttribute('d', pathData);
    visible.classList.add('connector-visible');
    if (selected?.type === 'connector' && selected.id === conn.id) visible.classList.add('selected');
    visible.style.pointerEvents = 'none';

    connectorLayer.appendChild(hit);
    connectorLayer.appendChild(visible);
  });
}

function updateCanvasSize() {
  const laneHeight = state.lanes.length * 185;
  const maxX = Math.max(1180, ...state.nodes.map(n => n.x + nodeSize(n).w + 120));
  const maxY = Math.max(760, laneHeight, ...state.nodes.map(n => n.y + nodeSize(n).h + 80));
  canvas.style.width = maxX + 'px';
  canvas.style.height = maxY + 'px';
  connectorLayer.setAttribute('width', maxX);
  connectorLayer.setAttribute('height', maxY);
  lanesEl.style.minHeight = maxY + 'px';
}

function centerOf(node) {
  const size = nodeSize(node);
  return { x: node.x + size.w / 2, y: node.y + size.h / 2 };
}
function nodeSize(node) {
  if (node.type === 'start' || node.type === 'end') return {w:74, h:74};
  if (node.type === 'decision') return {w:105, h:105};
  if (node.type === 'note') return {w:160, h:70};
  return {w:150, h:60};
}
function makePath(a, b) {
  const dx = Math.max(80, Math.abs(b.x - a.x) * .45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function onNodePointerDown(e, id) {
  if (connectMode) return;
  e.preventDefault(); e.stopPropagation();
  selected = {type:'node', id};
  const node = state.nodes.find(n => n.id === id);
  dragging = { id, startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y };
  e.currentTarget.setPointerCapture?.(e.pointerId);
  render();
}
function onPointerMove(e) {
  if (!dragging) return;
  const node = state.nodes.find(n => n.id === dragging.id);
  if (!node) return;
  node.x = Math.max(150, dragging.nodeX + e.clientX - dragging.startX);
  node.y = Math.max(12, dragging.nodeY + e.clientY - dragging.startY);
  updateCanvasSize();
  renderConnectors();
}
function onPointerUp() { dragging = null; }

function onNodeClick(e, id) {
  e.stopPropagation();
  if (!connectMode) { selected = {type:'node', id}; render(); return; }
  if (!connectSource) {
    connectSource = id; selected = {type:'node', id}; setStatus('Agora clique no bloco de destino'); render(); return;
  }
  if (connectSource === id) { showToast('Escolha outro bloco'); return; }
  const exists = state.connectors.some(c => c.from === connectSource && c.to === id);
  if (!exists) state.connectors.push({ id: uid('conn'), from: connectSource, to: id });
  connectSource = null;
  setStatus('Conexão criada. Escolha outra origem ou desative o modo conectar.');
  render();
}

function toggleConnectMode() {
  connectMode = !connectMode;
  connectSource = null;
  setStatus(connectMode ? 'Modo conectar ativo: clique na origem e depois no destino' : 'Pronto para editar');
  updateConnectButton(); render();
}
function updateConnectButton() {
  const btn = document.getElementById('btnConnectMode');
  btn.classList.toggle('active', connectMode);
}

function editNodeText(id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;
  const newText = prompt('Digite o texto do bloco:', node.text);
  if (newText !== null) { node.text = newText.trim() || node.text; render(); }
}
function editLaneTitle(id) {
  const lane = state.lanes.find(l => l.id === id);
  if (!lane) return;
  const newTitle = prompt('Digite o nome da raia:', lane.title);
  if (newTitle !== null) { lane.title = newTitle.trim() || lane.title; render(); showToast('Raia renomeada'); }
}
function deleteSelected() {
  if (!selected) { showToast('Nada selecionado'); return; }
  if (selected.type === 'node') {
    state.nodes = state.nodes.filter(n => n.id !== selected.id);
    state.connectors = state.connectors.filter(c => c.from !== selected.id && c.to !== selected.id);
  }
  if (selected.type === 'connector') state.connectors = state.connectors.filter(c => c.id !== selected.id);
  selected = null; render(); showToast('Excluído');
}

function saveProject() {
  const payload = { title: processTitle.value, state, savedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  showToast('Projeto salvo no navegador');
}
function loadProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { showToast('Nenhum projeto salvo'); return; }
  try {
    const payload = JSON.parse(raw);
    state = payload.state;
    processTitle.value = payload.title || 'Processo sem título';
    selected = null; connectSource = null; render(); showToast('Projeto carregado');
  } catch (err) { showToast('Erro ao carregar'); }
}
function clearProject() {
  if (!confirm('Limpar todo o processo atual?')) return;
  processTitle.value = 'Novo Processo';
  state = { lanes: [], nodes: [], connectors: [] };
  state.lanes = [ {id:uid('lane'), title:'Solicitante'}, {id:uid('lane'), title:'Área'}, {id:uid('lane'), title:'Executor'} ];
  selected = null; connectSource = null; render(); showToast('Processo limpo');
}

async function exportPNG() {
  selected = null; connectSource = null; render();
  await wait(120);
  const canvasImg = await html2canvas(canvas, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
  const link = document.createElement('a');
  link.download = sanitizeFileName(processTitle.value || 'processo') + '.png';
  link.href = canvasImg.toDataURL('image/png');
  link.click();
  showToast('PNG exportado');
}
async function exportPDF() {
  selected = null; connectSource = null; render();
  await wait(120);
  const canvasImg = await html2canvas(canvas, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
  const imgData = canvasImg.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW - 14;
  const imgH = canvasImg.height * imgW / canvasImg.width;
  let y = 7;
  if (imgH <= pageH - 14) {
    pdf.addImage(imgData, 'PNG', 7, y, imgW, imgH);
  } else {
    const fitH = pageH - 14;
    const fitW = canvasImg.width * fitH / canvasImg.height;
    pdf.addImage(imgData, 'PNG', 7, y, Math.min(pageW - 14, fitW), fitH);
  }
  pdf.save(sanitizeFileName(processTitle.value || 'processo') + '.pdf');
  showToast('PDF exportado');
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function sanitizeFileName(name) { return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'processo'; }
function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }

init();
