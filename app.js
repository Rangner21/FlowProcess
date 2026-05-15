const canvas = document.getElementById('canvas');
const lanesEl = document.getElementById('lanes');
const svg = document.getElementById('lines');

const LANE_H = 190;
let lanes = ['Solicitante', 'Área de Compras', 'Financeiro', 'Fornecedor'];
let nodes = [];
let conns = [];
let selected = null;
let selectedType = null;
let selectedLane = null;
let mode = 'select';
let connectFrom = null;
let zoom = 1;
let id = 1;
let history = [];
let historyIndex = -1;
let isRestoring = false;

const defaults = {
  start: ['Início', 90, 50],
  task: ['Nova tarefa', 170, 36],
  decision: ['Aprovado?', 350, 34],
  end: ['Fim', 1180, 55],
  note: ['Anotação', 250, 36]
};

function toast(t) {
  const e = document.getElementById('toast');
  e.textContent = t;
  e.classList.add('show');
  setTimeout(() => e.classList.remove('show'), 1800);
}

function snapshot() {
  return JSON.stringify({
    title: processTitle.value,
    lanes: structuredClone(lanes),
    nodes: structuredClone(nodes),
    conns: structuredClone(conns),
    id
  });
}

function restore(s) {
  const d = JSON.parse(s);
  processTitle.value = d.title || '';
  lanes = d.lanes || [];
  nodes = d.nodes || [];
  conns = d.conns || [];
  id = d.id || 1;
  selected = null;
  selectedType = null;
  selectedLane = null;
  connectFrom = null;
  render();
}

function pushHistory() {
  if (isRestoring) return;
  const s = snapshot();
  if (history[historyIndex] === s) return;
  history = history.slice(0, historyIndex + 1);
  history.push(s);
  if (history.length > 80) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  isRestoring = true;
  historyIndex--;
  restore(history[historyIndex]);
  isRestoring = false;
  updateHistoryButtons();
  toast('Alteração desfeita');
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  isRestoring = true;
  historyIndex++;
  restore(history[historyIndex]);
  isRestoring = false;
  updateHistoryButtons();
  toast('Alteração refeita');
}

function updateHistoryButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

function render() {
  lanesEl.innerHTML = '';
  lanes.forEach((name, i) => {
    const l = document.createElement('div');
    l.className = 'lane';
    l.style.height = LANE_H + 'px';

    const title = document.createElement('div');
    title.className = 'lane-title' + (selectedType === 'lane' && selectedLane === i ? ' selected' : '');
    title.textContent = name;
    title.onclick = (e) => {
      e.stopPropagation();
      selectedType = 'lane';
      selectedLane = i;
      selected = null;
      updateSelectionClasses();
    };
    title.ondblclick = (e) => {
      e.stopPropagation();
      const n = prompt('Nome da raia:', name);
      if (n && n.trim()) {
        lanes[i] = n.trim();
        render();
        pushHistory();
      }
    };

    const delLane = document.createElement('button');
    delLane.className = 'lane-del';
    delLane.title = 'Apagar esta raia';
    delLane.textContent = '🗑';
    delLane.onclick = (e) => {
      e.stopPropagation();
      deleteLane(i);
    };

    title.appendChild(delLane);
    l.appendChild(title);
    lanesEl.appendChild(l);
  });

  nodes.forEach(drawNode);
  drawLines();
  updateCount();
  updateHistoryButtons();
}


function updateSelectionClasses() {
  document.querySelectorAll('.node').forEach(el => {
    el.classList.toggle('selected', selectedType === 'node' && el.dataset.id === selected);
  });
  document.querySelectorAll('.lane-title').forEach((el, idx) => {
    el.classList.toggle('selected', selectedType === 'lane' && selectedLane === idx);
  });
  // Conectores precisam ser redesenhados para mostrar seleção visual da linha.
  drawLines();
  updateHistoryButtons();
}

function drawNode(n) {
  const el = document.createElement('div');
  el.className = 'node ' + n.type + (selected === n.id && selectedType === 'node' ? ' selected' : '');
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.dataset.id = n.id;
  el.title = 'Duplo clique para editar o texto';
  el.innerHTML = '<span class="text">' + escapeHtml(n.text).replace(/\n/g, '<br>') + '</span>';
  el.onmousedown = startDrag;
  el.onclick = (e) => {
    e.stopPropagation();
    if (mode === 'connect') connect(n.id);
    else {
      selectedType = 'node';
      selected = n.id;
      selectedLane = null;
      updateSelectionClasses();
    }
  };
  el.ondblclick = (e) => {
    e.stopPropagation();
    const txt = prompt('Editar texto:', n.text);
    if (txt !== null) {
      n.text = txt;
      render();
      pushHistory();
    }
  };
  lanesEl.appendChild(el);
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

function nodeSize(type) {
  if (type === 'task') return { w: 110, h: 70 };
  if (type === 'decision') return { w: 76, h: 76 };
  if (type === 'note') return { w: 150, h: 95 };
  return { w: 54, h: 54 };
}

function box(n) {
  const s = nodeSize(n.type);
  return { x: n.x, y: n.y, w: s.w, h: s.h, cx: n.x + s.w / 2, cy: n.y + s.h / 2, type: n.type };
}

function edgePoint(fromNode, toNode) {
  const a = box(fromNode);
  const b = box(toNode);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (dx === 0 && dy === 0) return { x: a.cx, y: a.cy };

  if (fromNode.type === 'start' || fromNode.type === 'end') {
    const r = a.w / 2;
    const len = Math.hypot(dx, dy) || 1;
    return { x: a.cx + (dx / len) * r, y: a.cy + (dy / len) * r };
  }

  if (fromNode.type === 'decision') {
    // Interseção aproximada com o losango: |x|/(w/2)+|y|/(h/2)=1
    const denom = Math.abs(dx) / (a.w / 2) + Math.abs(dy) / (a.h / 2) || 1;
    return { x: a.cx + dx / denom, y: a.cy + dy / denom };
  }

  // Retângulos/tarefas/anotações: seleciona a borda mais próxima na direção do destino.
  const scaleX = Math.abs(dx) / (a.w / 2);
  const scaleY = Math.abs(dy) / (a.h / 2);
  if (scaleX >= scaleY) {
    const x = a.cx + Math.sign(dx || 1) * a.w / 2;
    const y = a.cy + dy / (Math.abs(dx) || 1) * (a.w / 2);
    return { x, y: clamp(y, a.y + 4, a.y + a.h - 4) };
  } else {
    const y = a.cy + Math.sign(dy || 1) * a.h / 2;
    const x = a.cx + dx / (Math.abs(dy) || 1) * (a.h / 2);
    return { x: clamp(x, a.x + 4, a.x + a.w - 4), y };
  }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function drawLines() {
  svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#111827"/></marker></defs>';
  conns.forEach(c => {
    const a = nodes.find(n => n.id === c.from);
    const b = nodes.find(n => n.id === c.to);
    if (!a || !b) return;

    const p = edgePoint(a, b);
    const q = edgePoint(b, a);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', `M ${p.x} ${p.y} L ${q.x} ${q.y}`);
    line.setAttribute('stroke', c.id === selected && selectedType === 'conn' ? '#1e74d6' : '#111827');
    line.setAttribute('stroke-width', c.id === selected && selectedType === 'conn' ? 4 : 2);
    line.setAttribute('fill', 'none');
    line.setAttribute('marker-end', 'url(#arrow)');
    line.classList.add('connector');
    line.style.pointerEvents = 'stroke';
    line.onclick = e => { e.stopPropagation(); select('conn', c.id); };
    svg.appendChild(line);
  });
}

function addNode(type) {
  const d = defaults[type];
  const laneTop = Math.min((lanes.length - 1) * LANE_H, 20 + (nodes.length % Math.max(1, lanes.length)) * LANE_H);
  nodes.push({ id: 'n' + id++, type, text: d[0], x: d[1] + nodes.length * 22, y: laneTop + d[2] });
  render();
  pushHistory();
  toast('Elemento adicionado');
}

function addLane() {
  lanes.push('Nova Raia');
  canvas.style.minHeight = Math.max(760, lanes.length * LANE_H) + 'px';
  render();
  pushHistory();
  toast('Raia adicionada');
}

function deleteLane(index = selectedLane) {
  if (index === null || index === undefined || index < 0) return toast('Selecione uma raia primeiro');
  if (lanes.length <= 1) return toast('Não é possível apagar a única raia');

  const laneName = lanes[index];
  const top = index * LANE_H;
  const bottom = top + LANE_H;
  const inside = nodes.filter(n => {
    const b = box(n);
    return b.cy >= top && b.cy < bottom;
  });

  const msg = inside.length
    ? `Apagar a raia "${laneName}" e ${inside.length} elemento(s) dentro dela?`
    : `Apagar a raia "${laneName}"?`;
  if (!confirm(msg)) return;

  const removedIds = new Set(inside.map(n => n.id));
  lanes.splice(index, 1);
  nodes = nodes
    .filter(n => !removedIds.has(n.id))
    .map(n => n.y >= bottom ? { ...n, y: n.y - LANE_H } : n);
  conns = conns.filter(c => !removedIds.has(c.from) && !removedIds.has(c.to));
  selected = null;
  selectedType = null;
  selectedLane = null;
  canvas.style.minHeight = Math.max(760, lanes.length * LANE_H) + 'px';
  render();
  pushHistory();
  toast('Raia apagada');
}

function select(t, i) {
  selectedType = t;
  selected = i;
  selectedLane = null;
  updateSelectionClasses();
}

function connect(nid) {
  if (!connectFrom) {
    connectFrom = nid;
    select('node', nid);
    toast('Escolha o destino da seta');
  } else if (connectFrom !== nid) {
    conns.push({ id: 'c' + id++, from: connectFrom, to: nid });
    connectFrom = null;
    render();
    pushHistory();
    toast('Conexão criada');
  }
}

function startDrag(e) {
  if (mode === 'connect') return;
  e.preventDefault();
  const nid = this.dataset.id;
  const n = nodes.find(x => x.id === nid);
  select('node', nid);
  let sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
  let moved = false;

  function move(ev) {
    n.x = ox + (ev.clientX - sx) / zoom;
    n.y = oy + (ev.clientY - sy) / zoom;
    n.x = Math.max(62, n.x);
    n.y = Math.max(8, n.y);
    moved = true;
    render();
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    if (moved) pushHistory();
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function del() {
  if (selectedType === 'lane') return deleteLane(selectedLane);
  if (selectedType === 'node') {
    nodes = nodes.filter(n => n.id !== selected);
    conns = conns.filter(c => c.from !== selected && c.to !== selected);
  }
  if (selectedType === 'conn') conns = conns.filter(c => c.id !== selected);
  selected = null;
  selectedType = null;
  render();
  pushHistory();
}

function updateCount() {
  document.getElementById('countEls').textContent = 'Elementos: ' + nodes.length;
  document.getElementById('countConns').textContent = 'Conexões: ' + conns.length;
  document.getElementById('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  document.getElementById('statusZoom').textContent = Math.round(zoom * 100) + '%';
}

function save() {
  localStorage.setItem('flowprocess-pro', snapshot());
  toast('Salvo no navegador');
}

function load() {
  const s = localStorage.getItem('flowprocess-pro');
  if (!s) return toast('Nada salvo');
  restore(s);
  pushHistory();
  toast('Carregado');
}

async function exportPNG() {
  selected = null;
  selectedType = null;
  selectedLane = null;
  render();
  const c = await html2canvas(canvas, { backgroundColor: '#fff', scale: 2 });
  const a = document.createElement('a');
  a.href = c.toDataURL();
  a.download = 'processo.png';
  a.click();
}

async function exportPDF() {
  selected = null;
  selectedType = null;
  selectedLane = null;
  render();
  const c = await html2canvas(canvas, { backgroundColor: '#fff', scale: 2 });
  const img = c.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('l', 'mm', 'a4');
  const w = 297;
  const h = c.height * 297 / c.width;
  pdf.addImage(img, 'PNG', 0, 0, w, Math.min(210, h));
  pdf.save('processo.pdf');
}

function seed() {
  nodes = [
    { id: 'n1', type: 'start', text: 'Início', x: 92, y: 50 },
    { id: 'n2', type: 'task', text: 'Solicitar\ncompra', x: 170, y: 40 },
    { id: 'n3', type: 'task', text: 'Enviar\nsolicitação', x: 350, y: 40 },
    { id: 'n4', type: 'task', text: 'Analisar\nsolicitação', x: 330, y: 235 },
    { id: 'n5', type: 'decision', text: 'Aprovado?', x: 520, y: 230 },
    { id: 'n6', type: 'task', text: 'Enviar para\naprovação', x: 660, y: 235 },
    { id: 'n7', type: 'task', text: 'Aprovar\norçamento', x: 690, y: 425 },
    { id: 'n8', type: 'decision', text: 'Aprovado?', x: 850, y: 420 },
    { id: 'n9', type: 'task', text: 'Emitir ordem\nde compra', x: 1040, y: 435 },
    { id: 'n10', type: 'task', text: 'Receber ordem\nde compra', x: 820, y: 625 },
    { id: 'n11', type: 'task', text: 'Confirmar\nrecebimento', x: 1040, y: 625 },
    { id: 'n12', type: 'end', text: 'Fim', x: 1250, y: 640 },
    { id: 'n13', type: 'note', text: 'Anotação\n\nProcesso padrão para solicitação de compras.', x: 250, y: 610 }
  ];
  conns = [
    { id: 'c1', from: 'n1', to: 'n2' },
    { id: 'c2', from: 'n2', to: 'n3' },
    { id: 'c3', from: 'n3', to: 'n4' },
    { id: 'c4', from: 'n4', to: 'n5' },
    { id: 'c5', from: 'n5', to: 'n6' },
    { id: 'c6', from: 'n6', to: 'n7' },
    { id: 'c7', from: 'n7', to: 'n8' },
    { id: 'c8', from: 'n8', to: 'n9' },
    { id: 'c9', from: 'n9', to: 'n10' },
    { id: 'c10', from: 'n10', to: 'n11' },
    { id: 'c11', from: 'n11', to: 'n12' }
  ];
  id = 30;
  canvas.style.minHeight = Math.max(760, lanes.length * LANE_H) + 'px';
  render();
  pushHistory();
}

document.querySelectorAll('.add').forEach(b => b.onclick = () => addNode(b.dataset.type));
addLaneBtn.onclick = addLane;
deleteLaneBtn.onclick = () => deleteLane(selectedLane);
deleteBtn.onclick = del;
saveBtn.onclick = save;
loadBtn.onclick = load;
pngBtn.onclick = exportPNG;
pdfBtn.onclick = exportPDF;
undoBtn.onclick = undo;
redoBtn.onclick = redo;
clearBtn.onclick = () => {
  if (confirm('Limpar tudo?')) {
    nodes = [];
    conns = [];
    selected = null;
    selectedType = null;
    selectedLane = null;
    render();
    pushHistory();
  }
};
connectBtn.onclick = () => {
  mode = mode === 'connect' ? 'select' : 'connect';
  connectBtn.classList.toggle('on', mode === 'connect');
  connectFrom = null;
};
selectBtn.onclick = () => {
  mode = 'select';
  connectBtn.classList.remove('on');
};
canvas.onclick = () => {
  selected = null;
  selectedType = null;
  selectedLane = null;
  render();
};
document.onkeydown = e => {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Delete') del();
};
zoomIn.onclick = () => {
  zoom = Math.min(1.6, zoom + .1);
  canvas.style.transform = `scale(${zoom})`;
  updateCount();
};
zoomOut.onclick = () => {
  zoom = Math.max(.5, zoom - .1);
  canvas.style.transform = `scale(${zoom})`;
  updateCount();
};
processTitle.onchange = pushHistory;

seed();
