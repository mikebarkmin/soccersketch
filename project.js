/* Project data and the original desktop XML format. No runtime dependencies. */
(() => {
  'use strict';
  const STYLES = ['line', 'arrow', 'double-arrow', 'dashed', 'dashed-arrow', 'dashed-double-arrow',
    'double', 'double-line-arrow', 'double-line-double-arrow', 'wavy', 'wavy-arrow',
    'wavy-double-arrow', 'curve', 'dashed-curve', 'rectangle', 'triangle'];
  const LEGACY_STYLES = {
    Lines: 'line', LinesArrow: 'arrow', LinesDoubleArrow: 'double-arrow', DashedLines: 'dashed',
    DashedlinesArrow: 'dashed-arrow', DashedLinesArrow: 'dashed-arrow', DashedLinesDoubleArrow: 'dashed-double-arrow',
    DoubleLines: 'double', DoubleLinesArrow: 'double-line-arrow', DoubleLinesDoubleArrow: 'double-line-double-arrow',
    SquigglyLine: 'wavy', SquigglyLineArrow: 'wavy-arrow', SquigglyLineDoubleArrow: 'wavy-double-arrow',
    CurvedLines: 'curve', DashedCurvedLines: 'dashed-curve', RectangleDraw: 'rectangle', TriangleDraw: 'triangle',
  };
  const OFFSET = {x: 59.75, y: 95.4};
  const assetMap = new Map(window.SOCCER_ASSETS.assets.map(a => [a.id, a]));
  const id = () => globalThis.crypto?.randomUUID?.() || `obj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const finite = (n, fallback = 0, limit = 100000) => Number.isFinite(Number(n)) ? Math.max(-limit, Math.min(limit, Number(n))) : fallback;
  const scale = value => {
    const n = finite(value, 1, 8);
    return Math.abs(n) < .02 ? (n < 0 ? -.02 : .02) : n;
  };
  const paint = value => /^#[\da-f]{6}$/i.test(value) ? value : '#202a27';
  const escapeXML = value => String(value).replace(/[<>&"']/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[c]));
  const create = () => ({format: 'soccersketch-web', version: 1, title: 'Untitled drill', description: '', pitch: 1, printFriendly: false, objects: []});

  function validate(data) {
    if (!data || data.format !== 'soccersketch-web' || data.version !== 1 || !Array.isArray(data.objects)) {
      throw new Error('This is not a supported SoccerSketch web drill.');
    }
    if (data.objects.length > 3000) throw new Error('This drill exceeds the limit of 3,000 symbols.');
    const result = create();
    result.title = String(data.title || 'Untitled drill').slice(0, 160);
    result.description = String(data.description || '').slice(0, 100000);
    result.pitch = Math.max(1, Math.min(5, Math.round(finite(data.pitch, 2, 5))));
    result.printFriendly = Boolean(data.printFriendly);
    const ids = new Set();
    result.objects = data.objects.map(raw => {
      if (!raw || !['asset', 'text', 'path'].includes(raw.kind)) throw new Error('The drill contains an unsupported symbol.');
      let objectId = typeof raw.id === 'string' && raw.id.length < 100 ? raw.id : id();
      if (ids.has(objectId)) objectId = id();
      ids.add(objectId);
      const object = {id: objectId, kind: raw.kind, x: finite(raw.x), y: finite(raw.y),
        scaleX: scale(raw.scaleX ?? 1), scaleY: scale(raw.scaleY ?? 1), rotation: finite(raw.rotation, 0, 36000), color: paint(raw.color)};
      if (raw.kind === 'asset') {
        const asset = assetMap.get(raw.assetId);
        if (!asset) throw new Error(`Unknown library symbol: ${String(raw.assetId).slice(0, 80)}`);
        object.assetId = asset.id;
        object.frame = Math.max(0, Math.min(asset.variants.length - 1, Math.round(finite(raw.frame))));
      } else if (raw.kind === 'text') {
        object.text = String(raw.text ?? 'Text').slice(0, 10000);
        object.fontSize = Math.max(8, Math.min(160, finite(raw.fontSize, 26, 160)));
      } else {
        if (!STYLES.includes(raw.style)) throw new Error('The drill contains an unknown path style.');
        const count = ['curve', 'dashed-curve', 'triangle'].includes(raw.style) ? 3 : raw.style === 'rectangle' ? 4 : 2;
        if (!Array.isArray(raw.points) || raw.points.length !== count || raw.points.some(p => !p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y)))) {
          throw new Error('The drill contains invalid path points.');
        }
        object.style = raw.style;
        object.points = raw.points.map(p => ({x: finite(p.x), y: finite(p.y)}));
        object.strokeWidth = Math.max(.5, Math.min(20, finite(raw.strokeWidth, 2.5, 20)));
      }
      return object;
    });
    return result;
  }

  function worldPoint(object, point) {
    const rad = object.rotation * Math.PI / 180;
    const x = point.x * object.scaleX, y = point.y * object.scaleY;
    return {x: object.x + x * Math.cos(rad) - y * Math.sin(rad), y: object.y + x * Math.sin(rad) + y * Math.cos(rad)};
  }

  function importSSDF(source) {
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'drill') throw new Error('The desktop drill is not valid SSDF XML.');
    const result = create();
    const get = (node, tag, fallback = '') => node.querySelector(tag)?.textContent ?? fallback;
    const getNum = (node, tag, fallback = 0) => finite(get(node, tag, fallback), fallback);
    const className = node => get(node, 'classname').replace(/^\[class\s+/, '').replace(/\]$/, '').trim();
    const frame = getNum(xml, 'playground currentframe', 1);
    result.pitch = ({1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 5})[frame] || 1;
    result.printFriendly = [5, 6, 7, 8, 10].includes(frame);
    result.description = get(xml.documentElement, 'description');
    // Flash prepends each object when saving: reverse to restore its stacking order.
    for (const node of [...xml.querySelectorAll('objects')].reverse()) {
      const name = className(node);
      const object = {id: id(), x: getNum(node, 'positionx') + OFFSET.x, y: getNum(node, 'positiony') + OFFSET.y,
        scaleX: getNum(node, 'scalex', 1), scaleY: getNum(node, 'scaley', 1), rotation: getNum(node, 'rotationnumber'), color: '#000000'};
      if (['mc_text', 'mc_text_204', 'mc_text_205', 'btn155'].includes(name)) {
        Object.assign(object, {kind: 'text', text: get(node, 'text'), fontSize: 12});
      } else {
        if (!assetMap.has(name)) throw new Error(`Desktop symbol “${name.slice(0, 80)}” is not in this project's library.`);
        Object.assign(object, {kind: 'asset', assetId: name, frame: getNum(node, 'currentframe', 1) - 1});
      }
      result.objects.push(object);
    }
    const lines = [];
    for (const node of [...xml.querySelectorAll('lines')].reverse()) {
      const name = className(node), style = LEGACY_STYLES[name];
      if (!style) throw new Error(`Unknown desktop path class: ${name.slice(0, 80)}`);
      const count = style === 'rectangle' ? 4 : ['triangle', 'curve', 'dashed-curve'].includes(style) ? 3 : 2;
      const points = Array.from({length: count}, (_, i) => ({x: getNum(node, `button${i + 1}x`), y: getNum(node, `button${i + 1}y`)}));
      if (['curve', 'dashed-curve'].includes(style)) [points[1], points[2]] = [points[2], points[1]];
      const colorNumber = Number(get(node, 'linecolor', 0));
      const color = /^#[\da-f]{6}$/i.test(get(node, 'linecolor')) ? get(node, 'linecolor') : '#' + ((colorNumber >>> 0) & 0xffffff).toString(16).padStart(6, '0');
      lines.push({id: id(), kind: 'path', x: OFFSET.x + getNum(node, 'dragboxx'), y: OFFSET.y + getNum(node, 'dragboxy'),
        scaleX: 1, scaleY: 1, rotation: 0, color, style, points, strokeWidth: 2.5});
    }
    result.objects.unshift(...lines);
    return validate(result);
  }

  function exportSSDF(document) {
    const tag = (key, value) => `<${key}>${escapeXML(value)}</${key}>`;
    const frame = document.pitch === 5 ? (document.printFriendly ? 10 : 9) : document.pitch + (document.printFriendly ? 4 : 0);
    const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<drill>', '<playground>' + tag('currentframe', frame) + '</playground>', tag('description', document.description)];
    for (const object of [...document.objects].reverse()) {
      if (object.kind === 'path') {
        const className = Object.keys(LEGACY_STYLES).find(k => LEGACY_STYLES[k] === object.style);
        let points = object.points.map(p => worldPoint(object, p));
        if (['curve', 'dashed-curve'].includes(object.style)) [points[1], points[2]] = [points[2], points[1]];
        parts.push('<lines>', tag('classname', `[class ${className}]`));
        points.forEach((p, i) => parts.push(tag(`button${i + 1}x`, p.x - OFFSET.x), tag(`button${i + 1}y`, p.y - OFFSET.y)));
        parts.push(tag('dragboxx', 0), tag('dragboxy', 0), tag('linecolor', parseInt(object.color.slice(1), 16)), '</lines>');
      } else {
        if (object.kind === 'asset' && !/^btn\d+$/.test(object.assetId)) throw new Error('Indoor symbols have no desktop class in the supplied project. Save this drill as JSON to preserve them.');
        const textScale = object.kind === 'text' ? object.fontSize / 12 : 1;
        parts.push('<objects>', tag('classname', `[class ${object.kind === 'text' ? 'mc_text_205' : object.assetId}]`),
          tag('positionx', object.x - OFFSET.x), tag('positiony', object.y - OFFSET.y),
          tag('scalex', object.scaleX * textScale), tag('scaley', object.scaleY * textScale),
          tag('currentframe', object.kind === 'asset' ? object.frame + 1 : 1), tag('rotationnumber', object.rotation));
        if (object.kind === 'text') parts.push(tag('text', object.text));
        parts.push('</objects>');
      }
    }
    parts.push('</drill>');
    return parts.join('\n');
  }

  function parse(source) {
    return source.trim().startsWith('<') ? importSSDF(source) : validate(JSON.parse(source));
  }
  window.SoccerProject = {create, validate, parse, importSSDF, exportSSDF, worldPoint, id, STYLES, assetMap};
})();
