(() => {
  'use strict';
  const P = window.SoccerProject;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'soccersketch.web.drill.v1';
  const COLORS = ['#000000', '#ff8500', '#55ac24', '#002dcc', '#ffed00', '#ff0000'];
  const COLOR_NAMES = ['Black', 'Orange', 'Green', 'Blue', 'Yellow', 'Red'];
  let project = P.create(), selectedId = null, tool = 'select', activeAsset = null, teamColor = 0;
  let drag = null, zoom = 1, grid = false, toastTimer, saveTimer, storageFailed = false;
  let history = [], historyIndex = -1;
  let palettePage = 0, drawingPalette = false, hasDraft = false;
  const multiSelected = new Set();
  let copiedObjects = [];
  const canvas = $('pitch-canvas');

  function svg(tag, attrs = {}, content) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (content !== undefined) node.textContent = content;
    return node;
  }
  const clone = object => JSON.parse(JSON.stringify(object));
  const selected = () => project.objects.find(o => o.id === selectedId);
  const selectedObjects = () => project.objects.filter(o => o.id === selectedId || multiSelected.has(o.id));
  const selectOnly = id => { selectedId = id; multiSelected.clear(); };
  const round = n => Math.round(n * 100) / 100;
  const pitchIndex = () => project.pitch === 5 ? (project.printFriendly ? 9 : 8) : project.pitch - 1 + (project.printFriendly ? 4 : 0);
  const pitchData = () => window.SOCCER_ASSETS.pitches[pitchIndex()];
  const rad = n => n * Math.PI / 180;
  const rotate = (point, angle) => ({x: point.x * Math.cos(rad(angle)) - point.y * Math.sin(rad(angle)), y: point.x * Math.sin(rad(angle)) + point.y * Math.cos(rad(angle))});
  function localPoint(object, point) {
    const p = rotate({x: point.x - object.x, y: point.y - object.y}, -object.rotation);
    return {x: p.x / object.scaleX, y: p.y / object.scaleY};
  }
  function pointerPoint(event) {
    const matrix = canvas.getScreenCTM();
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  function bounds(object) {
    if (object.kind === 'asset') return P.assetMap.get(object.assetId).variants[object.frame].bounds;
    if (object.kind === 'text') {
      const lines = object.text.split('\n');
      const ctx = bounds.context || (bounds.context = document.createElement('canvas').getContext('2d'));
      ctx.font = `600 ${object.fontSize}px Arial`;
      return [0, -object.fontSize, Math.max(10, ...lines.map(line => ctx.measureText(line).width)), object.fontSize * 1.25 * lines.length];
    }
    const xs = object.points.map(p => p.x), ys = object.points.map(p => p.y);
    return [Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) - Math.min(...xs) + 12, Math.max(...ys) - Math.min(...ys) + 12];
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        storageFailed = false;
        $('save-status').textContent = 'Saved on this device';
      } catch {
        if (!storageFailed) toast('Automatic saving is unavailable. Use Save drill to download your work.');
        storageFailed = true;
        $('save-status').textContent = 'Download to save your work';
      }
    }, 250);
  }
  function commit() {
    const snapshot = JSON.stringify(project);
    if (history[historyIndex] !== snapshot) {
      history.splice(historyIndex + 1);
      history.push(snapshot);
      if (history.length > 80) history.shift();
      historyIndex = history.length - 1;
    }
    $('undo').disabled = historyIndex <= 0;
    $('redo').disabled = historyIndex >= history.length - 1;
    persist();
  }
  function restoreHistory(direction) {
    const index = historyIndex + direction;
    if (index < 0 || index >= history.length) return;
    cancelDrag();
    historyIndex = index;
    project = JSON.parse(history[index]);
    multiSelected.clear();
    if (!selected()) selectedId = null;
    render();
    $('undo').disabled = historyIndex <= 0;
    $('redo').disabled = historyIndex >= history.length - 1;
    persist();
  }
  function setTool(value) {
    cancelDrag();
    tool = value;
    if (value === 'draw') {
      drawingPalette = true;
      renderLibrary();
    }
    if (value === 'text' && $('options-dialog').open) $('options-dialog').close();
    if (value !== 'place') activeAsset = null;
    document.querySelectorAll('[data-tool]').forEach(button => {
      if (button.tagName === 'BUTTON') {
        button.classList.toggle('active', button.dataset.tool === value);
        button.setAttribute('aria-pressed', button.dataset.tool === value ? 'true' : 'false');
      }
    });
    canvas.dataset.tool = value;
    const hints = {select: 'Ziehen: verschieben · Ecken: Größe · oberer Griff: drehen', place: 'Zum Platzieren aufs Spielfeld klicken · Esc: auswählen', text: 'Für einen Text aufs Spielfeld klicken', draw: 'Zum Zeichnen ziehen · V: Linie bearbeiten'};
    $('tool-hint').textContent = hints[value];
    document.querySelectorAll('.asset-card').forEach(button => button.classList.toggle('active', button.dataset.assetId === activeAsset));
  }
  function assetVariant(asset, frame = teamColor) {
    return asset.variants[Math.min(frame, asset.variants.length - 1)];
  }
  function symbolPreview(item, padding = 3) {
    const [x, y, width, height] = item.bounds;
    const preview = svg('svg', {viewBox: `${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}`, 'aria-hidden': true});
    preview.innerHTML = item.svg;
    return preview;
  }
  function showPitchChooser() {
    cancelDrag();
    document.querySelectorAll('[data-pitch]').forEach(button => button.classList.toggle('active', Number(button.dataset.pitch) === project.pitch));
    $('start-dialog').showModal();
  }
  function initializeClassicUI() {
    const categories = [['Standing', 'btn1', 'Stehen'], ['Dribbling', 'btn35', 'Dribbling'], ['Passing', 'btn45', 'Passen'], ['Shooting', 'btn69', 'Schuss'], ['Tackling', 'btn71', 'Tackling'], ['Heading', 'btn83', 'Kopfball'], ['Back view', 'btn97', 'Rücken'], ['Goals', 'btn114', 'Tore'], ['Equipment', 'btn120', 'Materialien']];
    for (const [category, assetId, label] of categories) {
      const button = document.createElement('button');
      button.className = 'category-button';
      button.dataset.category = category;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.append(symbolPreview(assetVariant(P.assetMap.get(assetId), 0)));
      button.addEventListener('click', () => {
        $('category').value = category;
        $('asset-search').value = '';
        drawingPalette = false;
        palettePage = 0;
        setTool('select');
        renderLibrary();
      });
      $('category-buttons').append(button);
    }
    const bulb = document.createElement('img');
    bulb.src = 'assets/light_bulb.png';
    bulb.alt = '';
    $('help-icon').append(bulb);
    for (let pitch = 1; pitch <= 4; pitch++) {
      const button = document.createElement('button');
      button.dataset.pitch = pitch;
      button.setAttribute('aria-label', ['Trainingsfläche', 'Halbes Spielfeld', 'Strafraum', 'Ganzes Spielfeld'][pitch - 1]);
      button.append(symbolPreview(window.SOCCER_ASSETS.pitches[pitch - 1], 0));
      button.addEventListener('click', () => {
        project.pitch = pitch;
        renderPitch();
        document.querySelectorAll('[data-pitch]').forEach(b => b.classList.toggle('active', b === button));
      });
      $('pitch-choices').append(button);
    }
    $('begin-sketch').addEventListener('click', () => { $('start-dialog').close(); renderPitch(); commit(); });
    $('change-pitch').addEventListener('click', showPitchChooser);
    $('options-button').addEventListener('click', () => { renderInspector(); $('options-dialog').showModal(); });
    const help = svg('svg', {viewBox: '0 0 1280 752', preserveAspectRatio: 'xMinYMin meet'});
    const player = svg('g', {transform: 'translate(290 282) scale(3.1)'});
    player.innerHTML = assetVariant(P.assetMap.get('btn1'), 0).svg;
    help.append(player, svg('rect', {x: 208, y: 147, width: 156, height: 264, fill: 'none', stroke: 'black', 'stroke-width': 1}));
    for (const point of [[208,147], [364,147], [364,411], [208,411]]) help.append(svg('circle', {cx: point[0], cy: point[1], r: 6, fill: 'white', stroke: 'black', 'stroke-width': 2}));
    for (const [name, x, y, size] of [['CustomRotationControl', 291, 122, 23], ['CustomDeleteControl', 174, 435, 27], ['CustomResetControl', 391, 437, 32]]) {
      const item = window.SOCCER_ASSETS.ui[name], [ix, iy, iw, ih] = item.bounds;
      const group = svg('g', {transform: `translate(${x} ${y}) scale(${size / Math.max(iw, ih)}) translate(${-ix - iw / 2} ${-iy - ih / 2})`});
      group.innerHTML = item.svg;
      help.append(group);
    }
    const blue = '#00aeef';
    for (const d of ['M409 90Q355 79 307 111M307 111l1-22M307 111l20 4', 'M462 243Q420 222 391 158M391 158l-5 22M391 158l20 5', 'M93 488Q142 478 160 449M160 449l-15 7M160 449l-4 18', 'M514 504Q445 484 411 461M411 461l13 17M411 461l22 2']) help.append(svg('path', {d, fill: 'none', stroke: blue, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
    function words(text, x, y, size, color, anchor = 'start') { help.append(svg('text', {x, y, fill: color, 'font-family': '"Comic Sans MS",cursive', 'font-size': size, 'text-anchor': anchor}, text)); }
    words('drehen', 421, 97, 36, blue);
    words('dreh den ausgewählten Spieler', 390, 124, 17, 'white');
    words('nach links oder rechts', 418, 148, 17, 'white');
    words('verkleinern', 472, 252, 36, blue);
    words('vergrößere oder verkleinere', 477, 279, 18, 'white');
    words('den Spieler nach Belieben', 485, 303, 18, 'white');
    words('löschen', 29, 533, 36, blue);
    words('lösche den ausgewählten', 15, 558, 18, 'white');
    words('Spieler', 86, 581, 18, 'white');
    words('zurücksetzen', 514, 514, 38, blue);
    words('setze den Spieler auf die ursprüngliche', 515, 546, 17, 'white');
    words('Größe und Rotation zurück', 565, 570, 17, 'white');
    $('help-diagram').append(help);
    P.STYLES.forEach(style => {
      const button = document.createElement('button');
      button.dataset.pathStyle = style;
      button.title = [...$('line-style').options].find(o => o.value === style).text;
      button.setAttribute('aria-label', button.title);
      const preview = svg('svg', {viewBox: '0 0 90 44', 'aria-hidden': true});
      const sample = newPath({x: 0, y: 0}, {x: 66, y: 0}, style);
      if (style === 'rectangle') sample.points = [{x:0,y:-12},{x:66,y:-12},{x:66,y:12},{x:0,y:12}];
      if (style === 'triangle') sample.points = [{x:0,y:12},{x:66,y:12},{x:33,y:-12}];
      if (['curve','dashed-curve'].includes(style)) sample.points[1].y = -25;
      sample.color = '#000000';
      const group = svg('g', {transform: 'translate(12 24)', 'pointer-events': 'none'});
      pathMarkup(sample, group);
      preview.append(group);
      button.append(preview);
      button.addEventListener('click', () => {
        $('line-style').value = style;
        setTool('draw');
        document.querySelectorAll('[data-path-style]').forEach(b => b.classList.toggle('active', b === button));
      });
      $('path-buttons').append(button);
    });
    ['#000000', '#2222cc', '#00c8aa', '#13cc13', '#ff0000', '#ff9900', '#ffff00'].forEach(color => {
      const button = document.createElement('button');
      button.style.backgroundColor = color;
      button.setAttribute('aria-label', `Linienfarbe ${color}`);
      button.addEventListener('click', () => { $('drawing-color').value = color; [...$('path-colors').children].forEach(b => b.classList.toggle('active', b === button)); });
      $('path-colors').append(button);
    });
    $('delete-last-line').addEventListener('click', () => {
      const last = [...project.objects].reverse().find(o => o.kind === 'path');
      if (last) { selectedId = last.id; deleteSelection(); }
    });
    const resize = () => { document.documentElement.style.setProperty('--scale', window.innerWidth / 1280); applyZoom(); };
    window.addEventListener('resize', resize);
    resize();
  }
  function renderLibrary() {
    const category = $('category').value, query = $('asset-search').value.trim().toLowerCase();
    $('asset-grid').hidden = drawingPalette;
    $('path-palette').hidden = !drawingPalette;
    document.querySelectorAll('.category-button').forEach(button => button.classList.toggle('active', !drawingPalette && button.dataset.category === category));
    if (drawingPalette) {
      renderPages(1);
      return;
    }
    let assets = window.SOCCER_ASSETS.assets.filter(a => (category === 'Goals' ? a.category === 'Equipment' && a.name.includes('_tor') : category === 'Equipment' ? a.category === category && !a.name.includes('_tor') : a.category === category) && (!query || `${a.label} ${a.name}`.toLowerCase().includes(query)))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, {numeric: true}));
    const equipmentOrder = ['btn117', 'btn118', 'btn119', 'btn120', 'btn121', 'btn122', 'btn123', 'btn124', 'btn125', 'btn126', 'btn127', 'btn128', 'btn129', 'btn130', 'btn131', 'btn135', 'btn132', 'btn133', 'btn134', 'btn136', 'btn137'];
    if (category === 'Equipment') assets.sort((a, b) => equipmentOrder.indexOf(a.id) - equipmentOrder.indexOf(b.id));
    if (['Standing', 'Dribbling', 'Shooting', 'Tackling', 'Heading', 'Back view'].includes(category) && !query) {
      const arranged = [];
      for (let i = 0; i < assets.length; i += 8) {
        const page = assets.slice(i, i + 8);
        arranged.push(...page.filter((_, index) => index % 2 === 0), ...page.filter((_, index) => index % 2 === 1));
      }
      assets = arranged;
    }
    const pageSize = category === 'Equipment' && !query ? 17 : 8;
    const pages = Math.max(1, Math.ceil(assets.length / pageSize));
    palettePage = Math.min(palettePage, pages - 1);
    $('asset-count').textContent = `${assets.length} symbols`;
    renderPages(pages);
    $('asset-grid').classList.toggle('equipment-grid', category === 'Equipment' && !query && palettePage === 0);
    const fragment = document.createDocumentFragment();
    for (const asset of assets.slice(palettePage * pageSize, (palettePage + 1) * pageSize)) {
      const variant = assetVariant(asset);
      const [x, y, width, height] = variant.bounds;
      const button = document.createElement('button');
      button.className = 'asset-card' + (activeAsset === asset.id ? ' active' : '');
      button.dataset.assetId = asset.id;
      button.draggable = true;
      button.title = asset.label;
      button.setAttribute('aria-label', `Place ${asset.label}`);
      const preview = svg('svg', {viewBox: `${x - 3} ${y - 3} ${width + 6} ${height + 6}`, 'aria-hidden': true});
      preview.innerHTML = variant.svg;
      const label = document.createElement('span');
      label.textContent = asset.label;
      button.append(preview, label);
      button.addEventListener('dragstart', event => {
        event.dataTransfer.setData('application/x-soccersketch-asset', JSON.stringify({assetId: asset.id, frame: Math.min(teamColor, asset.variants.length - 1)}));
        event.dataTransfer.effectAllowed = 'copy';
      });
      button.addEventListener('click', () => {
        setTool('place');
        activeAsset = asset.id;
        selectOnly(null);
        renderSelection();
        renderInspector();
        document.querySelectorAll('.asset-card').forEach(b => b.classList.toggle('active', b === button));
        $('tool-hint').textContent = `${asset.label} · zum Platzieren klicken · Esc: auswählen`;
      });
      fragment.append(button);
    }
    if (!assets.length) {
      const message = document.createElement('p');
      message.className = 'no-results';
      message.textContent = 'No matching symbols in this collection.';
      fragment.append(message);
    }
    $('asset-grid').replaceChildren(fragment);
  }
  function renderPages(pages) {
    $('palette-pages').replaceChildren();
    for (let page = 0; page < pages; page++) {
      const button = document.createElement('button');
      button.className = page === palettePage ? 'active' : '';
      button.title = `Seite ${page + 1}`;
      button.setAttribute('aria-label', `Seite ${page + 1}`);
      button.setAttribute('aria-pressed', page === palettePage ? 'true' : 'false');
      button.addEventListener('click', () => { palettePage = page; activeAsset = null; renderLibrary(); });
      $('palette-pages').append(button);
    }
  }

  function pathMarkup(object, group) {
    const p = object.points, first = p[0], last = p[p.length - 1];
    const style = object.style, color = object.color, width = object.strokeWidth;
    const point = p => `${p.x},${p.y}`;
    let d;
    if (['curve', 'dashed-curve'].includes(style)) d = `M${point(first)}Q${point(p[1])} ${point(last)}`;
    else if (['rectangle', 'triangle'].includes(style)) d = `M${p.map(point).join('L')}Z`;
    else if (style.startsWith('wavy')) {
      const dx = last.x - first.x, dy = last.y - first.y, length = Math.hypot(dx, dy) || 1;
      const samples = Math.max(2, Math.ceil(length / 5));
      const points = Array.from({length: samples + 1}, (_, i) => {
        const t = i / samples, wave = Math.sin(t * length / 4) * 3;
        return {x: first.x + dx * t - dy / length * wave, y: first.y + dy * t + dx / length * wave};
      });
      points[points.length - 1] = last;
      d = `M${points.map(point).join('L')}`;
    } else d = `M${point(first)}L${point(last)}`;
    const isClosed = ['rectangle', 'triangle'].includes(style);
    const isDouble = ['double', 'double-line-arrow', 'double-line-double-arrow'].includes(style);
    const attrs = {d, fill: isClosed ? color : 'none', 'fill-opacity': isClosed ? .07 : 1, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'};
    if (style.startsWith('dashed')) attrs['stroke-dasharray'] = '9 7';
    if (isDouble) {
      const length = Math.hypot(last.x - first.x, last.y - first.y) || 1;
      const dx = -(last.y - first.y) / length * 3, dy = (last.x - first.x) / length * 3;
      group.append(svg('path', {...attrs, transform: `translate(${dx},${dy})`}), svg('path', {...attrs, transform: `translate(${-dx},${-dy})`}));
    } else group.append(svg('path', attrs));
    // A wide transparent hit area makes thin lines usable with mouse and touch.
    group.append(svg('path', {d, fill: isClosed ? 'transparent' : 'none', stroke: 'transparent', 'stroke-width': 16, 'vector-effect': 'non-scaling-stroke'}));
    function arrow(tip, reference) {
      const angle = Math.atan2(tip.y - reference.y, tip.x - reference.x), length = 11 + width, halfWidth = 4 + width;
      const bx = tip.x - Math.cos(angle) * length, by = tip.y - Math.sin(angle) * length;
      group.append(svg('polygon', {points: `${point(tip)} ${bx - Math.sin(angle) * halfWidth},${by + Math.cos(angle) * halfWidth} ${bx + Math.sin(angle) * halfWidth},${by - Math.cos(angle) * halfWidth}`, fill: color}));
    }
    const hasArrow = style.includes('arrow') || ['curve', 'dashed-curve'].includes(style);
    if (hasArrow) arrow(last, ['curve', 'dashed-curve'].includes(style) ? p[1] : first);
    if (style.includes('double-arrow')) arrow(first, last);
  }

  function renderObjects() {
    const objects = document.createDocumentFragment(), paths = document.createDocumentFragment();
    for (const object of project.objects) {
      const group = svg('g', {'data-object-id': object.id, transform: `translate(${object.x} ${object.y}) rotate(${object.rotation}) scale(${object.scaleX} ${object.scaleY})`});
      if (object.kind === 'asset') {
        const asset = P.assetMap.get(object.assetId), variant = asset.variants[object.frame];
        group.append(svg('title', {}, asset.label));
        const [x, y, width, height] = variant.bounds;
        group.append(svg('rect', {x, y, width, height, fill: 'transparent'}));
        const artwork = svg('g', {'pointer-events': 'none'});
        artwork.innerHTML = variant.svg;
        group.append(artwork);
      } else if (object.kind === 'text') {
        const text = svg('text', {fill: object.color, 'font-size': object.fontSize, 'font-family': 'Arial,sans-serif', 'font-weight': 600, 'xml:space': 'preserve'});
        object.text.split('\n').forEach((line, index) => text.append(svg('tspan', {x: 0, y: index * object.fontSize * 1.25}, line || '\u00a0')));
        const [x, y, width, height] = bounds(object);
        group.append(svg('rect', {x, y, width, height, fill: 'transparent'}), text);
      } else pathMarkup(object, group);
      (object.kind === 'path' ? paths : objects).append(group);
    }
    $('line-layer').replaceChildren(paths);
    $('object-layer').replaceChildren(objects);
    $('object-count').textContent = `${project.objects.length} ${project.objects.length === 1 ? 'object' : 'objects'}`;
    renderSelection();
  }

  function renderSelection() {
    $('selection-layer').replaceChildren();
    const object = selected();
    if (!object) return;
    const groupObjects = selectedObjects();
    if (groupObjects.length > 1) {
      const points = [];
      for (const item of groupObjects) {
        const [x, y, w, h] = bounds(item);
        const corners = [{x,y}, {x:x+w,y}, {x:x+w,y:y+h}, {x,y:y+h}].map(p => P.worldPoint(item, p));
        points.push(...corners);
        $('selection-layer').append(svg('polygon', {points: corners.map(p => `${p.x},${p.y}`).join(' '), class: 'selection-outline', 'stroke-dasharray': '4 3'}));
      }
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const x = Math.min(...xs) - 5, y = Math.min(...ys) - 5;
      $('selection-layer').append(svg('rect', {x, y, width: Math.max(...xs) - x + 5, height: Math.max(...ys) - y + 5, class: 'selection-outline'}), svg('text', {x, y: y - 6, class: 'selection-group-label'}, `${groupObjects.length} Symbole`));
      return;
    }
    const [x, y, width, height] = bounds(object), pad = 4;
    const corners = [{x: x - pad, y: y - pad}, {x: x + width + pad, y: y - pad}, {x: x + width + pad, y: y + height + pad}, {x: x - pad, y: y + height + pad}];
    const world = corners.map(p => P.worldPoint(object, p));
    const layer = $('selection-layer');
    layer.append(svg('polygon', {points: world.map(p => `${p.x},${p.y}`).join(' '), class: 'selection-outline'}));
    const unit = pitchData().bounds[2] / Math.max(1, canvas.getBoundingClientRect().width), radius = 5 * unit;
    world.forEach((p, index) => layer.append(svg('circle', {cx: p.x, cy: p.y, r: radius, class: 'selection-handle', 'data-handle': 'resize', 'data-corner': index})));
    const top = {x: (world[0].x + world[1].x) / 2, y: (world[0].y + world[1].y) / 2};
    const rotationOffset = rotate({x: 0, y: -26 * unit * Math.sign(object.scaleY)}, object.rotation);
    const rotationPoint = {x: top.x + rotationOffset.x, y: top.y + rotationOffset.y};
    layer.append(svg('line', {x1: top.x, y1: top.y, x2: rotationPoint.x, y2: rotationPoint.y, class: 'selection-outline'}));
    function control(name, point, action, size = 20) {
      const item = window.SOCCER_ASSETS.ui[name], [ix, iy, iw, ih] = item.bounds;
      const wrapper = svg('g', {transform: `translate(${point.x},${point.y})`, 'data-handle': action, class: action === 'rotate' ? 'rotation-handle' : 'selection-action'});
      wrapper.append(svg('rect', {x: -size * unit / 2, y: -size * unit / 2, width: size * unit, height: size * unit, fill: 'transparent'}));
      const artwork = svg('g', {transform: `scale(${size * unit / Math.max(iw, ih)}) translate(${-ix - iw / 2},${-iy - ih / 2})`, 'pointer-events': 'none'});
      artwork.innerHTML = item.svg;
      wrapper.append(artwork);
      layer.append(wrapper);
      return wrapper;
    }
    const rotationControl = control('CustomRotationControl', rotationPoint, 'rotate', 20);
    rotationControl.setAttribute('data-cx', rotationPoint.x);
    rotationControl.setAttribute('data-cy', rotationPoint.y);
    control('CustomDeleteControl', {x: world[3].x - 15 * unit, y: world[3].y + 15 * unit}, 'delete', 22);
    control('CustomResetControl', {x: world[2].x + 15 * unit, y: world[2].y + 15 * unit}, 'reset', 25);
    if (object.kind === 'path') {
      object.points.forEach((point, index) => {
        const p = P.worldPoint(object, point);
        layer.append(svg('circle', {cx: p.x, cy: p.y, r: radius, class: 'selection-handle point-handle', 'data-handle': 'point', 'data-point': index}));
      });
    }
  }

  function renderInspector() {
    const object = selected();
    $('selection-empty').hidden = Boolean(object);
    $('selection-properties').hidden = !object;
    if (!object) return;
    const groupCount = selectedObjects().length;
    $('selection-properties').classList.toggle('selection-properties-multi', groupCount > 1);
    $('selection-name').textContent = groupCount > 1 ? `${groupCount} Symbole ausgewählt` : object.kind === 'asset' ? P.assetMap.get(object.assetId).label : object.kind === 'text' ? 'Text' : 'Linie';
    for (const [key, field] of Object.entries({x: 'prop-x', y: 'prop-y', scaleX: 'prop-scale-x', scaleY: 'prop-scale-y', rotation: 'prop-rotation'})) $(field).value = round(object[key]);
    $('asset-color-control').hidden = object.kind !== 'asset' || P.assetMap.get(object.assetId).variants.length < 2;
    $('text-controls').hidden = object.kind !== 'text';
    $('object-color-control').hidden = object.kind === 'asset';
    if (object.kind === 'asset') $('prop-team-color').value = object.frame;
    else $('prop-color').value = object.color;
    if (object.kind === 'text') {
      $('prop-text').value = object.text;
      $('prop-font-size').value = object.fontSize;
    }
  }
  function renderPitch() {
    const pitch = pitchData();
    const [x, y, width, height] = pitch.bounds;
    canvas.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    canvas.setAttribute('width', width);
    canvas.setAttribute('height', height);
    $('pitch-background').innerHTML = pitch.svg;
    $('grid-overlay').setAttribute('x', x);
    $('grid-overlay').setAttribute('y', y);
    $('grid-overlay').setAttribute('width', width);
    $('grid-overlay').setAttribute('height', height);
    $('grid-overlay').toggleAttribute('hidden', !grid);
    $('pitch-select').value = project.pitch;
    $('print-friendly').checked = project.printFriendly;
    applyZoom();
  }
  function render() {
    $('project-title').value = project.title;
    $('drill-notes').value = project.description;
    renderPitch();
    renderObjects();
    renderInspector();
  }
  function applyZoom() {
    const viewport = $('canvas-viewport'), pitch = pitchData();
    const style = getComputedStyle(viewport);
    const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const fit = Math.max(100, availableWidth);
    $('canvas-wrap').style.width = `${Math.round(fit * zoom)}px`;
    $('canvas-wrap').style.maxWidth = 'none';
    $('zoom-level').textContent = zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`;
    renderSelection();
  }

  function addObject(object) {
    if (project.objects.length >= 3000) {
      toast('This drill has reached the limit of 3,000 symbols.');
      return false;
    }
    project.objects.push(object);
    selectOnly(object.id);
    renderObjects();
    renderInspector();
    commit();
    return true;
  }
  function defaultObject(kind, point) {
    return {id: P.id(), kind, x: point.x, y: point.y, scaleX: 1, scaleY: 1, rotation: 0, color: $('drawing-color').value};
  }
  function placeAsset(assetId, point, frame = teamColor) {
    const asset = P.assetMap.get(assetId);
    if (!asset) return;
    frame = Math.max(0, Math.min(asset.variants.length - 1, Math.round(Number(frame) || 0)));
    const variant = asset.variants[frame], [x, y, width, height] = variant.bounds;
    const object = {...defaultObject('asset', point), assetId: asset.id, frame};
    object.scaleX = object.scaleY = ['Equipment', 'Indoor'].includes(asset.category) ? .7 : .75;
    object.x -= (x + width / 2) * object.scaleX;
    object.y -= (y + height / 2) * object.scaleY;
    if (grid) { object.x = Math.round(object.x / 25) * 25; object.y = Math.round(object.y / 25) * 25; }
    addObject(object);
  }
  function newPath(start, end, style) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const points = [{x: 0, y: 0}, {x: dx, y: dy}];
    if (style === 'rectangle') points.splice(1, 1, {x: dx, y: 0}, {x: dx, y: dy}, {x: 0, y: dy});
    if (style === 'triangle') points.splice(1, 1, {x: dx, y: dy}, {x: -dx, y: dy});
    if (['curve', 'dashed-curve'].includes(style)) points.splice(1, 0, {x: dx / 2 - dy * .25, y: dy / 2 + dx * .25});
    return {...defaultObject('path', start), style, points, strokeWidth: 2.5};
  }
  function cancelDrag() {
    if (!drag) return;
    if (drag.type === 'draw') project.objects = project.objects.filter(o => o.id !== drag.objectId);
    else if (drag.original) {
      for (const original of drag.originals || [drag.original]) {
        const object = project.objects.find(o => o.id === original.id);
        if (object) Object.assign(object, original);
      }
    }
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    drag = null;
    if (!selected()) selectedId = null;
    renderObjects();
    renderInspector();
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    canvas.focus({preventScroll: true});
    const point = pointerPoint(event);
    const base = {pointerId: event.pointerId, start: {x: point.x, y: point.y}};
    if (tool === 'place' && activeAsset) {
      placeAsset(activeAsset, point);
      return;
    }
    if (tool === 'text') {
      const object = {...defaultObject('text', point), text: 'Text', fontSize: 26};
      if (addObject(object)) {
        setTool('select');
        $('options-dialog').showModal();
        $('prop-text').focus();
        $('prop-text').select();
      }
      return;
    }
    if (tool === 'draw') {
      if (project.objects.length >= 3000) { toast('This drill has reached the symbol limit.'); return; }
      if (grid) { point.x = Math.round(point.x / 25) * 25; point.y = Math.round(point.y / 25) * 25; base.start = {x:point.x,y:point.y}; }
      const object = newPath(point, point, $('line-style').value);
      project.objects.push(object);
      selectOnly(object.id);
      drag = {...base, type: 'draw', objectId: object.id};
      canvas.setPointerCapture(event.pointerId);
      renderObjects();
      renderInspector();
      return;
    }
    const handle = event.target.closest('[data-handle]');
    if (handle && selected()) {
      const object = selected();
      if (handle.dataset.handle === 'delete') { deleteSelection(); return; }
      if (handle.dataset.handle === 'reset') { resetSelection(); return; }
      drag = {...base, type: handle.dataset.handle, objectId: object.id, original: clone(object)};
      if (drag.type === 'point') drag.pointIndex = Number(handle.dataset.point);
      if (drag.type === 'resize') {
        const [x, y, width, height] = bounds(object), pad = 4;
        const corners = [{x: x - pad, y: y - pad}, {x: x + width + pad, y: y - pad}, {x: x + width + pad, y: y + height + pad}, {x: x - pad, y: y + height + pad}];
        const index = Number(handle.dataset.corner);
        drag.corner = corners[index];
        drag.opposite = corners[(index + 2) % 4];
        drag.anchor = P.worldPoint(object, drag.opposite);
      }
      if (drag.type === 'rotate') drag.angle = Math.atan2(point.y - object.y, point.x - object.x) * 180 / Math.PI;
    } else {
      const node = event.target.closest('[data-object-id]');
      const id = node?.dataset.objectId || null;
      if (id && event.shiftKey) {
        if (selectedId) multiSelected.add(selectedId);
        if (multiSelected.has(id)) multiSelected.delete(id); else multiSelected.add(id);
        selectedId = multiSelected.has(id) ? id : [...multiSelected][0] || null;
      } else if (!id || !selectedObjects().some(o => o.id === id)) selectOnly(id);
      else selectedId = id;
      if (selected()) drag = {...base, type: 'move', objectId: selectedId, original: clone(selected()), originals: selectedObjects().map(clone)};
      renderSelection();
      renderInspector();
    }
    if (drag) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointerPoint(event), object = project.objects.find(o => o.id === drag.objectId);
    if (!object) return;
    const original = drag.original;
    if (drag.type === 'draw') {
      let end = point;
      if (grid) end = {x: Math.round(point.x / 25) * 25, y: Math.round(point.y / 25) * 25};
      if (event.shiftKey && !['triangle', 'rectangle'].includes(object.style)) {
        const dx = point.x - drag.start.x, dy = point.y - drag.start.y, length = Math.hypot(dx, dy);
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
        end = {x: drag.start.x + Math.cos(angle) * length, y: drag.start.y + Math.sin(angle) * length};
      }
      object.points = newPath(drag.start, end, object.style).points;
    } else if (drag.type === 'move') {
      let dx = point.x - drag.start.x, dy = point.y - drag.start.y;
      if (grid) { dx = Math.round((original.x + dx) / 25) * 25 - original.x; dy = Math.round((original.y + dy) / 25) * 25 - original.y; }
      for (const initial of drag.originals || [original]) {
        const item = project.objects.find(o => o.id === initial.id);
        item.x = initial.x + dx;
        item.y = initial.y + dy;
      }
    } else if (drag.type === 'point') object.points[drag.pointIndex] = localPoint(object, point);
    else if (drag.type === 'rotate') {
      const angle = Math.atan2(point.y - object.y, point.x - object.x) * 180 / Math.PI;
      object.rotation = original.rotation + angle - drag.angle;
      if (event.shiftKey) object.rotation = Math.round(object.rotation / 15) * 15;
    } else if (drag.type === 'resize') {
      const delta = rotate({x: point.x - drag.anchor.x, y: point.y - drag.anchor.y}, -original.rotation);
      const vx = drag.corner.x - drag.opposite.x, vy = drag.corner.y - drag.opposite.y;
      if (event.shiftKey) {
        const clampScale = (n, initial) => Math.sign(initial) * Math.max(.05, Math.min(8, n * Math.sign(initial)));
        object.scaleX = clampScale(delta.x / vx, original.scaleX);
        object.scaleY = clampScale(delta.y / vy, original.scaleY);
      } else {
        const originalDelta = {x: vx * original.scaleX, y: vy * original.scaleY};
        const ratio = Math.max(.05, (delta.x * originalDelta.x + delta.y * originalDelta.y) / (originalDelta.x ** 2 + originalDelta.y ** 2));
        const maxRatio = Math.min(8 / Math.abs(original.scaleX), 8 / Math.abs(original.scaleY));
        object.scaleX = original.scaleX * Math.min(maxRatio, ratio);
        object.scaleY = original.scaleY * Math.min(maxRatio, ratio);
      }
      const offset = rotate({x: drag.opposite.x * object.scaleX, y: drag.opposite.y * object.scaleY}, original.rotation);
      object.x = drag.anchor.x - offset.x;
      object.y = drag.anchor.y - offset.y;
    }
    renderObjects();
    renderInspector();
  });
  canvas.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const action = drag;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (action.type === 'draw') {
      const object = selected(), end = pointerPoint(event);
      if (Math.hypot(end.x - action.start.x, end.y - action.start.y) < 6) {
        project.objects = project.objects.filter(o => o.id !== action.objectId);
        selectedId = null;
      } else if (object) $('tool-hint').textContent = 'Path added · keep drawing, or press V to adjust its points';
    }
    renderObjects();
    renderInspector();
    commit();
  });
  canvas.addEventListener('pointercancel', cancelDrag);
  canvas.addEventListener('dblclick', event => {
    const node = event.target.closest('[data-object-id]');
    const object = project.objects.find(o => o.id === node?.dataset.objectId);
    if (object?.kind !== 'text') return;
    setTool('select'); selectOnly(object.id); renderSelection(); renderInspector();
    $('options-dialog').showModal(); $('prop-text').focus(); $('prop-text').select();
  });
  canvas.addEventListener('dragover', event => {
    if (![...event.dataTransfer.types].some(t => t === 'application/x-soccersketch-asset' || t === 'Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    $('canvas-viewport').classList.add('drop-active');
  });
  canvas.addEventListener('dragleave', () => $('canvas-viewport').classList.remove('drop-active'));
  canvas.addEventListener('drop', event => {
    event.preventDefault();
    $('canvas-viewport').classList.remove('drop-active');
    if (event.dataTransfer.files.length) {
      $('file-input').files = event.dataTransfer.files;
      $('file-input').dispatchEvent(new Event('change', {bubbles: true}));
      return;
    }
    try {
      const data = JSON.parse(event.dataTransfer.getData('application/x-soccersketch-asset'));
      setTool('select'); placeAsset(data.assetId, pointerPoint(event), data.frame); canvas.focus();
    } catch { /* Ignore unrelated text dropped into the editor. */ }
  });
  canvas.addEventListener('contextmenu', event => {
    const node = event.target.closest('[data-object-id]');
    if (!node) { $('context-menu').hidden = true; return; }
    event.preventDefault();
    setTool('select');
    if (!selectedObjects().some(o => o.id === node.dataset.objectId)) selectOnly(node.dataset.objectId);
    else selectedId = node.dataset.objectId;
    renderSelection(); renderInspector();
    const menu = $('context-menu');
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 5))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 5))}px`;
    menu.querySelector('button').focus();
  });
  document.querySelectorAll('[data-context-action]').forEach(button => button.addEventListener('click', () => {
    const actions = {duplicate: duplicateSelection, delete: deleteSelection, reset: resetSelection, front: () => moveStack(1), back: () => moveStack(-1), properties: () => $('options-button').click()};
    actions[button.dataset.contextAction]();
    $('context-menu').hidden = true;
    if (!$('options-dialog').open) canvas.focus();
  }));

  function mutateSelection(update) {
    const object = selected();
    if (!object) return;
    selectedObjects().forEach(update);
    renderObjects();
    renderInspector();
    commit();
  }
  function duplicateSelection() {
    pasteObjects(selectedObjects());
  }
  function pasteObjects(objects) {
    if (!objects.length) return;
    if (project.objects.length + objects.length > 3000) { toast('Die Auswahl überschreitet die Grenze von 3.000 Symbolen.'); return; }
    setTool('select');
    const copies = objects.map(object => ({...clone(object), id: P.id(), x: object.x + 20, y: object.y + 20}));
    project.objects.push(...copies);
    selectOnly(copies[0].id);
    if (copies.length > 1) copies.forEach(o => multiSelected.add(o.id));
    renderObjects(); renderInspector(); commit();
  }
  function resetSelection() {
    mutateSelection(object => { object.scaleX = object.scaleY = object.kind === 'asset' ? (['Equipment', 'Indoor'].includes(P.assetMap.get(object.assetId).category) ? .7 : .75) : 1; object.rotation = 0; });
  }
  function deleteSelection() {
    if (!selected()) return;
    const ids = new Set(selectedObjects().map(o => o.id));
    project.objects = project.objects.filter(o => !ids.has(o.id));
    selectOnly(null);
    renderObjects();
    renderInspector();
    commit();
  }
  function moveStack(direction) {
    const ids = new Set(selectedObjects().map(o => o.id));
    const objects = selectedObjects();
    if (direction > 0) objects.reverse();
    for (const object of objects) {
      const index = project.objects.indexOf(object), kind = object.kind === 'path' ? 'path' : 'object';
      let other = index + direction;
      while (other >= 0 && other < project.objects.length) {
        if ((project.objects[other].kind === 'path' ? 'path' : 'object') === kind) {
          if (!ids.has(project.objects[other].id)) [project.objects[index], project.objects[other]] = [project.objects[other], project.objects[index]];
          break;
        }
        other += direction;
      }
    }
    renderObjects(); commit();
  }
  function download(content, filename, type) {
    const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], {type}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function filename() { return (project.title || 'drill').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').trim().slice(0, 100) || 'drill'; }
  function saveProject() {
    cancelDrag();
    download(JSON.stringify(project, null, 2), `${filename()}.json`, 'application/json');
    toast('Editable drill downloaded.');
  }
  function exportSVG() {
    const copy = canvas.cloneNode(true);
    copy.querySelector('#selection-layer').remove();
    copy.querySelector('#grid-overlay').remove();
    copy.querySelector('defs').remove();
    copy.querySelectorAll('[data-object-id]').forEach(node => node.removeAttribute('data-object-id'));
    copy.removeAttribute('id');
    copy.removeAttribute('tabindex');
    copy.removeAttribute('data-tool');
    copy.removeAttribute('role');
    copy.setAttribute('aria-label', project.title);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
  }
  async function exportProject(format) {
    cancelDrag();
    document.querySelector('.export-menu').open = false;
    try {
      if (format === 'ssdf') {
        download(P.exportSSDF(project), `${filename()}.ssdf`, 'application/xml');
        toast('Desktop drill downloaded. JSON preserves all web editing properties.');
        return;
      }
      const source = exportSVG();
      if (format === 'svg') {
        download(source, `${filename()}.svg`, 'image/svg+xml');
        toast('Vector image downloaded.');
        return;
      }
      const url = URL.createObjectURL(new Blob([source], {type: 'image/svg+xml'}));
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const output = document.createElement('canvas'), pitch = pitchData();
        output.width = Math.round(pitch.bounds[2] * 2);
        output.height = Math.round(pitch.bounds[3] * 2);
        const context = output.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, output.width, output.height);
        context.drawImage(image, 0, 0, output.width, output.height);
        const blob = await new Promise(resolve => output.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', .95));
        if (!blob) throw new Error('The browser could not create the image. Try SVG export.');
        download(blob, `${filename()}.${format === 'jpeg' ? 'jpg' : 'png'}`);
        toast('Image downloaded at twice the pitch resolution.');
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { toast(error.message); }
  }

  document.querySelectorAll('button[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  COLORS.forEach((color, index) => {
    const button = document.createElement('button');
    button.className = 'swatch' + (index === 0 ? ' active' : '');
    button.style.backgroundColor = color;
    button.title = COLOR_NAMES[index];
    button.setAttribute('aria-label', `${COLOR_NAMES[index]} team`);
    button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
    button.addEventListener('click', () => {
      teamColor = index;
      $('drawing-color').value = color;
      [...$('team-colors').children].forEach((b, i) => {
        b.classList.toggle('active', i === index);
        b.setAttribute('aria-pressed', i === index ? 'true' : 'false');
      });
      renderLibrary();
    });
    $('team-colors').append(button);
  });
  $('category').addEventListener('change', () => { drawingPalette = false; palettePage = 0; setTool('select'); renderLibrary(); });
  $('asset-search').addEventListener('input', () => { palettePage = 0; renderLibrary(); });
  $('line-style').addEventListener('change', () => setTool('draw'));
  $('pitch-select').addEventListener('change', () => {
    cancelDrag();
    project.pitch = Number($('pitch-select').value);
    renderPitch();
    commit();
  });
  $('print-friendly').addEventListener('change', () => { project.printFriendly = $('print-friendly').checked; renderPitch(); commit(); });
  $('show-grid').addEventListener('change', () => { grid = $('show-grid').checked; $('grid-overlay').toggleAttribute('hidden', !grid); });
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(3, round(zoom + .25)); applyZoom(); });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(.5, round(zoom - .25)); applyZoom(); });
  $('zoom-fit').addEventListener('click', () => { zoom = 1; applyZoom(); });
  new ResizeObserver(applyZoom).observe($('canvas-viewport'));
  $('undo').addEventListener('click', () => restoreHistory(-1));
  $('redo').addEventListener('click', () => restoreHistory(1));
  $('deselect').addEventListener('click', () => { selectOnly(null); renderSelection(); renderInspector(); });
  $('duplicate-object').addEventListener('click', duplicateSelection);
  $('delete-object').addEventListener('click', deleteSelection);
  $('flip-object').addEventListener('click', () => mutateSelection(o => { o.scaleX *= -1; }));
  $('reset-object').addEventListener('click', resetSelection);
  $('bring-forward').addEventListener('click', () => moveStack(1));
  $('send-backward').addEventListener('click', () => moveStack(-1));
  for (const [field, key] of Object.entries({'prop-x': 'x', 'prop-y': 'y', 'prop-scale-x': 'scaleX', 'prop-scale-y': 'scaleY', 'prop-rotation': 'rotation', 'prop-font-size': 'fontSize'})) {
    $(field).addEventListener('change', () => mutateSelection(object => {
      let value = Number($(field).value);
      if (!Number.isFinite(value)) return;
      if (key.startsWith('scale')) value = Math.sign(value || 1) * Math.max(.02, Math.min(8, Math.abs(value)));
      if (key === 'fontSize') value = Math.max(8, Math.min(160, value));
      object[key] = Math.max(-100000, Math.min(100000, value));
    }));
  }
  $('prop-team-color').addEventListener('change', () => mutateSelection(o => { o.frame = Number($('prop-team-color').value); }));
  $('prop-color').addEventListener('change', () => mutateSelection(o => { o.color = $('prop-color').value; }));
  $('prop-text').addEventListener('input', () => {
    const object = selected();
    if (object?.kind !== 'text') return;
    object.text = $('prop-text').value.slice(0, 10000);
    renderObjects();
    persist();
  });
  $('prop-text').addEventListener('change', commit);
  $('project-title').addEventListener('input', () => { project.title = $('project-title').value; persist(); });
  $('project-title').addEventListener('change', commit);
  $('drill-notes').addEventListener('input', () => { project.description = $('drill-notes').value.slice(0, 100000); persist(); });
  $('drill-notes').addEventListener('change', commit);
  $('save-project').addEventListener('click', saveProject);
  document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportProject(button.dataset.export)));
  $('print-project').addEventListener('click', () => { document.querySelector('.export-menu').open = false; window.print(); });
  $('open-project').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async () => {
    const file = $('file-input').files[0];
    if (!file) return;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Please choose a drill smaller than 15 MB.');
      const imported = P.parse(await file.text());
      if (file.name.toLowerCase().endsWith('.ssdf')) imported.title = file.name.replace(/\.ssdf$/i, '');
      cancelDrag();
      commit();
      project = imported;
      selectOnly(null);
      setTool('select');
      zoom = 1;
      render();
      commit();
      toast(`Opened ${file.name}`);
    } catch (error) { toast(`Could not open drill: ${error.message}`); }
    $('file-input').value = '';
  });
  $('new-project').addEventListener('click', () => {
    if (project.objects.length || project.description || project.title !== 'Untitled drill') $('confirm-dialog').showModal();
    else startNew();
  });
  function startNew() {
    cancelDrag();
    commit();
    project = P.create();
    selectOnly(null);
    setTool('select');
    zoom = 1;
    render();
    commit();
    showPitchChooser();
  }
  $('cancel-new').addEventListener('click', () => $('confirm-dialog').close());
  $('confirm-new').addEventListener('click', () => { $('confirm-dialog').close(); startNew(); });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.addEventListener('pointerdown', event => {
    const menu = document.querySelector('.export-menu');
    if (!menu.contains(event.target)) menu.open = false;
    if (!$('context-menu').contains(event.target)) $('context-menu').hidden = true;
  });
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    const isInput = event.target instanceof Element && event.target.matches('input,textarea,select,[contenteditable]');
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
    if (isInput) return;
    const key = event.key.toLowerCase();
    if (modifier && key === 'z') { event.preventDefault(); restoreHistory(event.shiftKey ? 1 : -1); }
    else if (modifier && key === 'y') { event.preventDefault(); restoreHistory(1); }
    else if (modifier && key === 'd') { event.preventDefault(); duplicateSelection(); }
    else if (modifier && key === 'a') { event.preventDefault(); setTool('select'); if (project.objects.length) { selectedId = project.objects[0].id; project.objects.forEach(o => multiSelected.add(o.id)); renderSelection(); renderInspector(); } }
    else if (modifier && key === 'c') { event.preventDefault(); copiedObjects = selectedObjects().map(clone); if (copiedObjects.length) toast(`${copiedObjects.length} Symbol(e) kopiert`); }
    else if (modifier && key === 'v') { event.preventDefault(); pasteObjects(copiedObjects); }
    else if (!modifier && key === 'v') setTool('select');
    else if (!modifier && key === 't') setTool('text');
    else if (!modifier && key === 'l') setTool('draw');
    else if (key === 'escape') { setTool('select'); selectOnly(null); $('context-menu').hidden = true; renderSelection(); renderInspector(); }
    else if (['delete', 'backspace'].includes(key)) { event.preventDefault(); deleteSelection(); }
    else if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && selected()) {
      event.preventDefault();
      const amount = event.shiftKey ? 10 : 1;
      mutateSelection(o => { if (key === 'arrowleft') o.x -= amount; if (key === 'arrowright') o.x += amount; if (key === 'arrowup') o.y -= amount; if (key === 'arrowdown') o.y += amount; });
    }
  });
  window.addEventListener('beforeunload', event => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); }
    catch { if (project.objects.length || project.description) { event.preventDefault(); event.returnValue = ''; } }
  });
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) { project = P.validate(JSON.parse(saved)); hasDraft = true; $('save-status').textContent = 'Auf diesem Gerät wiederhergestellt'; }
  } catch { toast('The saved browser draft could not be restored. You can open a downloaded drill.'); }
  initializeClassicUI();
  renderLibrary();
  render();
  setTool('select');
  commit();
  if (!hasDraft && !new URLSearchParams(location.search).has('editor')) showPitchChooser();
})();
