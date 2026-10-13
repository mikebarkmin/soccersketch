/* Run with Chromium --headless --allow-file-access-from-files --dump-dom.
   Checks the real app's DOM, input handlers, persistence, import, and exports.
   Pointer capture is stubbed because synthetic pointers have no native lifetime. */
(async () => {
  const frame = document.getElementById('app');
  if (!frame.contentWindow?.SoccerProject) await new Promise(resolve => frame.addEventListener('load', resolve, {once: true}));
  const win = frame.contentWindow, doc = win.document, P = win.SoccerProject;
  const $ = id => doc.getElementById(id);
  const canvas = $('pitch-canvas'), errors = [], downloads = [];
  win.addEventListener('error', event => errors.push(event.message));
  win.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  let passed = 0, failed = 0;
  async function check(name, test) {
    const li = document.createElement('li');
    try { await test(); li.textContent = `PASS: ${name}`; li.className = 'pass'; passed++; }
    catch (error) { li.textContent = `FAIL: ${name} — ${error.message}`; li.className = 'fail'; failed++; }
    document.getElementById('checks').append(li);
  }
  const click = selector => doc.querySelector(selector).click();
  const input = (id, value, type = 'change') => { $(id).value = value; $(id).dispatchEvent(new win.Event(type, {bubbles: true})); };
  const count = () => doc.querySelectorAll('[data-object-id]').length;
  const current = async () => { await wait(350); return JSON.parse(win.localStorage.getItem('soccersketch.web.drill.v1')); };
  const key = (key, opts = {}) => canvas.dispatchEvent(new win.KeyboardEvent('keydown', {key, bubbles: true, ...opts}));
  function pointer(type, x, y, target = canvas, opts = {}) {
    const p = new win.DOMPoint(x, y).matrixTransform(canvas.getScreenCTM());
    target.dispatchEvent(new win.PointerEvent(type, {clientX: p.x, clientY: p.y, pointerId: 1, button: 0, bubbles: true, ...opts}));
  }
  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  canvas.releasePointerCapture = () => {};
  win.HTMLAnchorElement.prototype.click = function () {
    downloads.push({name: this.download, blob: win.fetch(this.href).then(r => r.blob())});
  };
  const openFile = async (content, name) => {
    const transfer = new win.DataTransfer();
    transfer.items.add(new win.File([content], name, {type: name.endsWith('.json') ? 'application/json' : 'application/xml'}));
    $('file-input').files = transfer.files;
    $('file-input').dispatchEvent(new win.Event('change', {bubbles: true}));
    await wait(350);
  };
  const newDrill = () => { if ($('start-dialog').open) $('begin-sketch').click(); $('new-project').click(); if ($('confirm-dialog').open) $('confirm-new').click(); if ($('start-dialog').open) $('begin-sketch').click(); };
  newDrill();

  await check('Recovered original library and ten pitches', () => {
    assert(win.SOCCER_ASSETS.assets.length === 205, 'Incorrect library size');
    assert(win.SOCCER_ASSETS.pitches.length === 10, 'Missing pitch backgrounds');
    assert(doc.querySelectorAll('.asset-card').length === 8, 'Standing collection missing');
    assert(doc.querySelectorAll('#palette-pages button').length === 2, 'Standing pagination missing');
    for (const asset of win.SOCCER_ASSETS.assets) for (const variant of asset.variants) assert(variant.svg && variant.bounds.every(Number.isFinite), `Invalid artwork: ${asset.id}`);
  });
  await check('Player placement and repeated placement', async () => {
    click('.asset-card'); pointer('pointerdown', 250, 330); pointer('pointerdown', 500, 330);
    assert(count() === 2, 'Players not placed');
    const data = await current(); assert(data.objects[0].assetId === 'btn1', 'Wrong player');
  });
  await check('Team palette uses the original color frames', async () => {
    click('#team-colors button:nth-child(4)'); pointer('pointerdown', 620, 420);
    assert((await current()).objects.at(-1).frame === 3, 'Blue team frame not used');
  });
  await check('Select, move, resize, and rotate through pointer controls', async () => {
    key('v');
    const object = doc.querySelector('[data-object-id]');
    pointer('pointerdown', 250, 330, object); pointer('pointermove', 300, 380); pointer('pointerup', 300, 380);
    assert(Math.abs(Number($('prop-x').value) - 299.87) < 1, 'Drag did not move player');
    const scale = Number($('prop-scale-x').value);
    let handle = doc.querySelector('[data-handle="resize"][data-corner="2"]');
    const center = new win.DOMPoint(Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy')));
    pointer('pointerdown', center.x, center.y, handle); pointer('pointermove', center.x + 20, center.y + 30); pointer('pointerup', center.x + 20, center.y + 30);
    assert(Number($('prop-scale-x').value) > scale, 'Resize did not grow player');
    handle = doc.querySelector('[data-handle="rotate"]');
    const hx = Number(handle.getAttribute('data-cx')), hy = Number(handle.getAttribute('data-cy'));
    pointer('pointerdown', hx, hy, handle); pointer('pointermove', hx + 70, hy + 35); pointer('pointerup', hx + 70, hy + 35);
    assert(Math.abs(Number($('prop-rotation').value)) > 10, 'Rotation did not change');
    assert((await current()).objects.every(o => Number.isFinite(o.rotation)), 'Invalid transform saved');
  });
  await check('Duplicate, flip, delete, undo, and redo', () => {
    $('duplicate-object').click(); assert(count() === 4, 'Duplicate failed');
    $('flip-object').click(); assert(Number($('prop-scale-x').value) < 0, 'Flip failed');
    $('delete-object').click(); assert(count() === 3, 'Delete failed');
    $('undo').click(); assert(count() === 4, 'Undo failed');
    $('redo').click(); assert(count() === 3, 'Redo failed');
  });
  await check('Shift selection, moving a formation, group duplication, and copy/paste', async () => {
    key('v');
    const nodes = doc.querySelectorAll('#object-layer > g');
    pointer('pointerdown', 300, 380, nodes[0]); pointer('pointerup', 300, 380);
    pointer('pointerdown', 500, 330, doc.querySelectorAll('#object-layer > g')[1], {shiftKey: true}); pointer('pointerup', 500, 330);
    assert($('selection-name').textContent.includes('2 Symbole'), 'Shift selection failed');
    const before = await current();
    key('ArrowRight', {shiftKey: true});
    const after = await current();
    assert(Math.abs(after.objects[0].x - before.objects[0].x - 10) < .001 && Math.abs(after.objects[1].x - before.objects[1].x - 10) < .001, 'Formation movement failed');
    assert(after.objects[2].x === before.objects[2].x, 'Unselected player moved');
    key('d', {ctrlKey: true}); assert(count() === 5, 'Group duplication failed');
    key('c', {ctrlKey: true}); key('v', {ctrlKey: true}); assert(count() === 7, 'Group copy/paste failed');
    key('Delete'); assert(count() === 5, 'Group delete failed');
    key('z', {ctrlKey: true}); assert(count() === 7, 'Group undo failed');
    key('z', {ctrlKey: true, shiftKey: true}); assert(count() === 5, 'Group redo failed');
    key('Escape');
  });
  await check('Drag-and-drop symbols and the right-click menu', () => {
    const transfer = new win.DataTransfer();
    transfer.setData('application/x-soccersketch-asset', JSON.stringify({assetId: 'btn120', frame: 0}));
    const point = new win.DOMPoint(450, 430).matrixTransform(canvas.getScreenCTM());
    canvas.dispatchEvent(new win.DragEvent('dragover', {dataTransfer: transfer, bubbles: true, cancelable: true, clientX: point.x, clientY: point.y}));
    assert($('canvas-viewport').classList.contains('drop-active'), 'Drop target not highlighted');
    const before = count();
    canvas.dispatchEvent(new win.DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true, clientX: point.x, clientY: point.y}));
    assert(count() === before + 1, 'Dropped symbol not placed');
    assert(!$('canvas-viewport').classList.contains('drop-active'), 'Drop highlight not removed');
    doc.querySelector('#object-layer > g').dispatchEvent(new win.MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: point.x, clientY: point.y}));
    assert(!$('context-menu').hidden, 'Context menu not opened');
    click('[data-context-action="duplicate"]');
    assert(count() === before + 2, 'Context duplicate failed');
    assert($('context-menu').hidden, 'Context menu not closed');
    key('Escape');
  });
  await check('All sixteen path styles and editable curve control points', () => {
    for (const style of P.STYLES) {
      input('line-style', style);
      pointer('pointerdown', 200, 500); pointer('pointermove', 400, 580); pointer('pointerup', 400, 580);
    }
    assert(doc.querySelectorAll('#line-layer > g').length === 16, 'Some drawing styles failed');
    key('v');
    const paths = doc.querySelectorAll('#line-layer > g');
    pointer('pointerdown', 300, 540, paths[12]); pointer('pointerup', 300, 540);
    const handle = doc.querySelector('[data-point="1"]');
    assert(handle, 'Curve control handle missing');
    const x = Number(handle.getAttribute('cx')), y = Number(handle.getAttribute('cy'));
    pointer('pointerdown', x, y, handle); pointer('pointermove', x, y - 60); pointer('pointerup', x, y - 60);
    assert(Number(doc.querySelector('[data-point="1"]').getAttribute('cy')) < y - 59, 'Control point did not move');
  });
  await check('Text labels preserve special characters without injecting HTML', async () => {
    key('t'); pointer('pointerdown', 350, 250);
    input('prop-text', 'A & B <script>\nNext line', 'input'); input('prop-text', 'A & B <script>\nNext line');
    input('prop-font-size', 32);
    assert(doc.querySelectorAll('#object-layer text tspan').length === 2, 'Multiline text failed');
    assert(doc.querySelector('#object-layer text').textContent.includes('<script>'), 'Special characters lost');
    assert((await current()).objects.at(-1).fontSize === 32, 'Font size not saved');
    $('options-dialog').close();
  });
  await check('Pitch selection, white backgrounds, grid, and zoom', () => {
    for (let value = 1; value <= 5; value++) {
      input('pitch-select', value);
      $('print-friendly').checked = true; $('print-friendly').dispatchEvent(new win.Event('change'));
      assert($('pitch-background').innerHTML.length > 100, 'Pitch did not render');
    }
    assert(canvas.getAttribute('viewBox').includes('1262'), 'Portrait pitch not selected');
    $('show-grid').checked = true; $('show-grid').dispatchEvent(new win.Event('change'));
    assert(!$('grid-overlay').hasAttribute('hidden'), 'Grid hidden');
    $('zoom-in').click(); assert($('zoom-level').textContent === '125%', 'Zoom failed');
    $('zoom-fit').click(); assert($('zoom-level').textContent === 'Fit', 'Fit failed');
  });
  await check('Drawing snaps to the grid', async () => {
    input('line-style', 'arrow');
    pointer('pointerdown', 142, 489); pointer('pointermove', 316, 571); pointer('pointerup', 316, 571);
    const path = (await current()).objects.at(-1);
    assert(path.x === 150 && path.y === 500 && path.points[1].x === 175 && path.points[1].y === 75, 'Path endpoints did not snap');
    $('delete-last-line').click();
  });
  await check('Openpatch banners rotate locally through all four projects', () => {
    const names = new Set();
    for (let i = 0; i < 4; i++) {
      names.add($('openpatch-ad').dataset.project);
      const link = doc.querySelector('.promo-link');
      assert(link.href.startsWith('https://') && link.target === '_blank' && link.rel.includes('noopener'), 'Banner link invalid');
      click('.promo-controls button:last-child');
    }
    assert(['Hyperbook', 'Scratch for Java', 'Learningmap', 'StruktoLab'].every(name => names.has(name)), 'Banner projects missing');
    click('.promo-controls button:nth-child(2)');
    assert(doc.querySelector('.promo-controls button:nth-child(2)').getAttribute('aria-pressed') === 'true', 'Pause button failed');
    assert(doc.querySelectorAll('#openpatch-ad img,#openpatch-ad iframe').length === 0, 'Banners require remote resources');
  });
  await check('Drill title, notes, and editable JSON download', async () => {
    input('project-title', 'Passing & movement', 'input'); input('drill-notes', 'Coach: <stay wide> & scan.', 'input');
    $('save-project').click();
    const download = downloads.at(-1); assert(download.name === 'Passing & movement.json', 'Wrong filename');
    const data = P.parse(await (await download.blob).text());
    assert(data.description === 'Coach: <stay wide> & scan.', 'Notes lost');
    assert(data.objects.length === count(), 'JSON omitted symbols');
  });
  await check('Real SVG, PNG, and JPEG exports', async () => {
    for (const format of ['svg', 'png', 'jpeg']) {
      const before = downloads.length;
      click(`[data-export="${format}"]`);
      for (let i = 0; i < 30 && downloads.length === before; i++) await wait(100);
      assert(downloads.length > before, `${format} download failed: ${$('toast').textContent}`);
      const blob = await downloads.at(-1).blob;
      assert(blob.size > 1000, `${format} image is empty`);
      if (format === 'svg') {
        const source = await blob.text();
        assert(!source.includes('selection-layer') && !source.includes('grid-overlay'), 'Editor handles leaked into export');
        assert(!new win.DOMParser().parseFromString(source, 'image/svg+xml').querySelector('parsererror'), 'Exported SVG is invalid');
      } else {
        const image = await win.createImageBitmap(blob);
        assert(image.width > 1800 && image.height > 2500, `${format} resolution too small`);
      }
    }
  });
  await check('Desktop SSDF import and round trip: colors, positions, text, and all path styles', async () => {
    const data = await current();
    // SSDF has no font-size or text-color fields; choose desktop defaults for this fixture.
    data.objects.filter(o => o.kind === 'text').forEach(o => { o.fontSize = 12; o.color = '#000000'; });
    const source = P.exportSSDF(data), parsed = P.importSSDF(source);
    assert(parsed.objects.length === data.objects.length, 'SSDF symbols lost');
    assert(parsed.description === data.description, 'XML special characters lost');
    for (const o of parsed.objects.filter(o => o.kind === 'asset')) assert(data.objects.some(original => original.assetId === o.assetId && original.frame === o.frame && Math.abs(original.x - o.x) < .001 && Math.abs(original.y - o.y) < .001), 'SSDF transform or color lost');
    assert(parsed.objects.filter(o => o.kind === 'path').length === 16, 'SSDF styles lost');
    await openFile(source, 'Desktop drill.ssdf');
    assert(count() === data.objects.length, 'File input did not import SSDF');
    assert($('project-title').value === 'Desktop drill', 'Desktop filename not used');
  });
  await check('Invalid imports leave the current drill intact', async () => {
    const before = count();
    await openFile('{"format":"unrelated","objects":[]}', 'invalid.json');
    assert(count() === before, 'Invalid JSON replaced drill');
    await openFile('<drill><broken></drill>', 'broken.ssdf');
    assert(count() === before, 'Malformed XML replaced drill');
    assert($('toast').textContent.includes('Could not open drill'), 'Import error not shown');
  });
  await check('Search, indoor equipment, and safe SSDF limitation', async () => {
    input('category', 'Indoor'); input('asset-search', 'Bench', 'input');
    assert(doc.querySelectorAll('.asset-card').length === 3, 'Indoor search failed');
    click('.asset-card'); pointer('pointerdown', 500, 700);
    const data = await current();
    assert(data.objects.at(-1).assetId.startsWith('Halle/'), 'Indoor symbol missing');
    let rejected = false; try { P.exportSSDF(data); } catch { rejected = true; }
    assert(rejected, 'Unrepresentable indoor object silently omitted from SSDF');
    assert(P.parse(JSON.stringify(data)).objects.length === data.objects.length, 'Indoor asset not preserved in JSON');
  });
  await check('All collections and colors render without missing assets', () => {
    input('asset-search', '', 'input');
    for (const option of $('category').options) {
      input('category', option.value);
      assert(doc.querySelectorAll('.asset-card').length > 0, `Empty collection: ${option.value}`);
      for (let i = 1; i <= 6; i++) click(`#team-colors button:nth-child(${i})`);
    }
  });
  await check('Browser autosave restores the drill after reload', async () => {
    const data = await current();
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, {once: true}));
    frame.contentWindow.location.reload(); await loaded;
    assert(frame.contentDocument.querySelectorAll('[data-object-id]').length === data.objects.length, 'Reload lost symbols');
    assert(frame.contentDocument.getElementById('drill-notes').value === data.description, 'Reload lost notes');
  });
  await check('Responsive mobile layout has no page overflow', async () => {
    frame.style.width = '390px'; frame.style.height = '844px'; await wait(150);
    const mobile = frame.contentDocument;
    assert(mobile.documentElement.scrollWidth <= 392, `Mobile page overflows: ${mobile.documentElement.scrollWidth}px`);
    assert(mobile.getElementById('pitch-canvas').getBoundingClientRect().width > 100, 'Mobile pitch is unusable');
  });
  await check('No JavaScript runtime errors', () => assert(errors.length === 0, errors.join('; ')));
  const result = document.getElementById('result');
  result.textContent = `${passed} passed, ${failed} failed`;
  result.className = failed ? 'fail' : 'pass';
  document.body.dataset.testResult = failed ? 'failed' : 'passed';
  document.title = JSON.stringify({passed, failed, checks: [...document.querySelectorAll('#checks li')].map(li => li.textContent)});
})();
