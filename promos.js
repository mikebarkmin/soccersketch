/* Local promotional banners: no ad network, tracking, or remote image requests.
   Destinations were checked against https://www.openpatch.org/projects. */
(() => {
  'use strict';
  const promos = [
    {name: 'Hyperbook', url: 'https://hyperbook.openpatch.org/', color: '#e88025', background: '#fff5e8', headline: 'Unterricht.<br>Interaktiv.', copy: 'Aus Markdown werden<br>interaktive Lernmaterialien.', cta: 'Hyperbook entdecken', illustration: '<g transform="translate(150 68) rotate(7 70 75)"><rect x="8" y="13" width="113" height="149" rx="8" fill="#b5652933"/><path d="M0 0h115v149H0z" fill="#ec933b"/><path d="M12 0h103v149H12z" fill="#fff"/><path d="M5 14v122" stroke="#b75d24" stroke-width="3"/><rect x="29" y="24" width="67" height="8" rx="2" fill="#f3bd81"/><path d="M29 47h63M29 57h48" stroke="#ddd" stroke-width="4"/><rect x="29" y="74" width="64" height="48" rx="5" fill="#fff2df"/><path d="m52 85 21 13-21 13z" fill="#e88025"/><path d="M99 0h10v42l-5-5-5 5z" fill="#d85542"/></g>'},
    {name: 'Scratch for Java', url: 'https://scratch4j.openpatch.org/', color: '#4284c8', background: '#edf6ff', headline: 'Von Blöcken<br>zu Java.', copy: 'Sprites, Bewegung, Spiele.<br>Der nächste Programmierschritt.', cta: 'Java ausprobieren', illustration: '<g transform="translate(161 75)"><rect width="117" height="131" rx="7" fill="#264960"/><path d="M0 18h117" stroke="#42677d"/><circle cx="10" cy="9" r="3" fill="#ffb38d"/><circle cx="21" cy="9" r="3" fill="#ffe285"/><circle cx="32" cy="9" r="3" fill="#88cfad"/><g font-family="monospace" font-size="10" fill="#b7dbff"><text x="10" y="41">new Sprite();</text><text x="10" y="61">move(10);</text><text x="10" y="81">turn(15);</text></g><rect x="-15" y="92" width="83" height="29" rx="7" fill="#f8ba41"/><path d="M-5 106h40" stroke="#fff" stroke-width="5"/><circle cx="91" cy="109" r="11" fill="#80c6ef"/><path d="m87 102 9 7-9 7z" fill="white"/></g>'},
    {name: 'Learningmap', url: 'https://learningmap.app/', color: '#46a787', background: '#eefaf5', headline: 'Lernen hat<br>viele Wege.', copy: 'Lernpfade gestalten.<br>Fortschritte sichtbar machen.', cta: 'Lernkarte erstellen', illustration: '<g transform="translate(162 72)"><path d="M14 111 48 67 95 96 107 20M48 67 18 24" fill="none" stroke="#6bb69c" stroke-width="4" stroke-dasharray="6 4"/><g fill="white" stroke="#79baaa" stroke-width="3"><circle cx="14" cy="111" r="17"/><circle cx="48" cy="67" r="21"/><circle cx="95" cy="96" r="17"/><circle cx="107" cy="20" r="17"/><circle cx="18" cy="24" r="17"/></g><circle cx="14" cy="111" r="9" fill="#c5eadc"/><path d="m5 109 6 7 11-14" stroke="#369e76" fill="none" stroke-width="3"/><path d="m40 67 6 7 13-15" stroke="#369e76" fill="none" stroke-width="4"/><g fill="#efb354"><circle cx="18" cy="24" r="6"/><circle cx="107" cy="20" r="6"/></g><path d="M90 95h10m-5-5v10" stroke="#46a787" stroke-width="3"/></g>'},
    {name: 'StruktoLab', url: 'https://struktolab.openpatch.org/', color: '#8566b4', background: '#f5f0ff', headline: 'Klar denken.<br>Code verstehen.', copy: 'Algorithmen zeichnen.<br>Mit Struktogrammen lernen.', cta: 'StruktoLab öffnen', illustration: '<g transform="translate(165 74) rotate(-4 58 60)"><rect width="116" height="133" fill="white" stroke="#b6a3d4" stroke-width="2"/><path d="M0 27h116M0 65h116M0 102h116M58 27v75M0 27l58 38 58-38" stroke="#9d87c0" fill="none" stroke-width="2"/><g font-family="monospace" font-size="10" fill="#6d5295"><text x="22" y="17">start()</text><text x="27" y="47">if (ready)</text><text x="12" y="89">yes</text><text x="77" y="89">no</text><text x="20" y="121">learn();</text></g><rect x="-10" y="112" width="35" height="27" rx="4" fill="#e3c779"/><path d="m2 119 11 7-11 7" stroke="white" fill="none" stroke-width="2"/></g>'},
  ];
  const container = document.getElementById('openpatch-ad');
  let index = 0, paused = false;
  const link = document.createElement('a');
  link.className = 'promo-link';
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  const controls = document.createElement('div');
  controls.className = 'promo-controls';
  const previous = document.createElement('button'), next = document.createElement('button'), pause = document.createElement('button');
  previous.textContent = '‹'; previous.setAttribute('aria-label', 'Vorheriger Openpatch-Tipp');
  next.textContent = '›'; next.setAttribute('aria-label', 'Nächster Openpatch-Tipp');
  pause.textContent = 'Ⅱ'; pause.setAttribute('aria-label', 'Bannerwechsel pausieren');
  controls.append(previous, pause, next); container.append(link, controls);
  function render() {
    const p = promos[index];
    link.href = p.url;
    link.setAttribute('aria-label', `${p.name} bei Openpatch entdecken (neuer Tab)`);
    link.style.setProperty('--promo-color', p.color);
    link.style.setProperty('--promo-background', p.background);
    link.innerHTML = `<svg viewBox="0 0 300 255" aria-hidden="true"><rect width="300" height="255" fill="${p.background}"/><circle cx="278" cy="183" r="77" fill="${p.color}" opacity=".07"/>${p.illustration}</svg><span class="promo-kicker">Anzeige · Openpatch</span><strong class="promo-name">${p.name}</strong><span class="promo-headline">${p.headline}</span><span class="promo-copy">${p.copy}</span><span class="promo-cta">${p.cta} ↗</span>`;
    container.dataset.project = p.name;
  }
  previous.addEventListener('click', () => { index = (index + promos.length - 1) % promos.length; render(); });
  next.addEventListener('click', () => { index = (index + 1) % promos.length; render(); });
  pause.addEventListener('click', () => { paused = !paused; pause.textContent = paused ? '▶' : 'Ⅱ'; pause.setAttribute('aria-label', paused ? 'Bannerwechsel fortsetzen' : 'Bannerwechsel pausieren'); pause.setAttribute('aria-pressed', String(paused)); });
  setInterval(() => {
    if (!paused && !document.hidden && !container.matches(':hover,:focus-within') && !document.querySelector('dialog[open]')) { index = (index + 1) % promos.length; render(); }
  }, 20000);
  render();
})();
