// Entry point: loads the data, then keeps the map and the cards in step with
// one small piece of state (the day shown, the selected chokepoint if any, playing).

import { loadData, statusOf } from './data.js';
import { fmtCount } from './format.js';
import { MapScene } from './scene.js';
import { Dashboard } from './ui.js';

const PLAY_DAYS_PER_SECOND = 45;   // the whole record plays in about a minute
const WIDE = window.matchMedia('(min-width: 900px)');

async function start() {
  const model = await loadData();
  const state = { day: model.latest, selected: null, playing: false, ship: null };   // selected: a chokepoint's key, or null for the overview

  const dashboard = new Dashboard({
    model,
    on: {
      select,
      day: (day) => { stop(); setDay(day); },
      play: () => (state.playing ? stop() : play()),
      home: () => scene.goHome(),
      zoom: (factor) => scene.zoom(factor),
      focus: () => { if (state.selected) scene.flyTo(scene.closeUpView(state.selected)); },
      shipClose: () => scene.selectShip(null),
      // Bring the timeline and the list up over the map, or send them back down.
      more: () => window.scrollTo({ top: window.scrollY > 8 ? 0 : document.documentElement.scrollHeight, behavior: 'smooth' }),
    },
  });
  const scene = new MapScene({
    canvas: document.getElementById('map'),
    labels: document.getElementById('pin-labels'),
    overlay: document.getElementById('overlay'),
    model,
    onSelect: select,
    onShip: (ship) => { state.ship = ship; dashboard.showShip(scene.shipCard, ship, state.day); },
  });

  function pinStates(day) {
    return model.chokepoints.map((c) => {
      const status = statusOf(c.ratio(day));
      return { key: c.key, tone: status.tone, value: fmtCount(c.avg7[day]), tag: status.label };
    });
  }

  function render() {
    dashboard.update(state);
    dashboard.showShip(scene.shipCard, state.ship, state.day);
    scene.setDay(state.day, pinStates(state.day));
  }

  /** Pick a chokepoint, or pass null to go back to the overview of all six. */
  function select(key) {
    state.selected = key;
    scene.select(key);
    render();
  }

  function setDay(day) {
    state.day = model.clampIndex(Math.round(day));
    render();
  }

  let cursor = 0, lastTick = 0, frame = 0;
  function play() {
    if (state.day >= model.latest) state.day = 0;   // at the end, start over
    state.playing = true;
    cursor = state.day;
    lastTick = performance.now();
    frame = requestAnimationFrame(tick);
    render();
  }
  function tick(now) {
    cursor += (now - lastTick) / 1000 * PLAY_DAYS_PER_SECOND;
    lastTick = now;
    if (cursor >= model.latest) { cursor = model.latest; state.playing = false; }
    setDay(cursor);
    if (state.playing) frame = requestAnimationFrame(tick);
  }
  function stop() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(frame);
    render();
  }

  /**
   * Tell the map where the cards are, so it centres in the space they leave.
   * Runs as the page scrolls too: the section below the map rises over it, and
   * the pinned cards (styles.css, --below) and the map both make room.
   */
  function fitMap() {
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const root = document.documentElement;
    document.body.classList.toggle('is-scrolled', window.scrollY > 8);
    if (!WIDE.matches) {
      // Stacked layout: the cards sit below the map; only the bar and buttons float over it.
      root.style.setProperty('--below', '0px');
      scene.setLayout({ top: box('topbar').bottom, right: 0, bottom: 0, left: 0 }, [box('topbar'), box('toolbar')]);
      return;
    }
    const below = Math.max(0, Math.round(window.innerHeight - box('below').top));
    root.style.setProperty('--below', `${below}px`);
    scene.setLayout({
      top: box('topbar').bottom,
      right: window.innerWidth - box(state.selected ? 'detail' : 'summary').left,   // whichever of the two is showing
      bottom: below,
      left: 0,
    }, [...document.querySelectorAll('.hud .card, .below .card')].map((card) => card.getBoundingClientRect()).filter((rect) => rect.width));
  }
  let fitQueued = false;
  function queueFit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => { fitQueued = false; fitMap(); });
  }

  // Links can open on a given day and chokepoint: ?date=2021-03-25&focus=suez
  const params = new URLSearchParams(location.search);
  if (params.has('date')) state.day = model.clampIndex(model.indexOf(params.get('date')) || 0);
  const focus = model.byKey[params.get('focus')] ? params.get('focus') : null;
  if (focus) state.selected = focus;

  scene.select(state.selected, { fly: false });
  render();
  fitMap();
  if (focus) scene.placeCamera(scene.closeUpView(focus)); else scene.goHome(false);
  window.addEventListener('resize', fitMap);
  window.addEventListener('scroll', queueFit, { passive: true });
  new ResizeObserver(fitMap).observe(document.getElementById('below'));
  // The two cards that share the right-hand column swap places and change height with their contents.
  const side = new ResizeObserver(queueFit);
  for (const id of ['summary', 'detail']) side.observe(document.getElementById(id));

  // Escape clears whatever is picked, as a click on open water does. (In a dialog it closes the dialog instead.)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (state.ship) scene.selectShip(null);
    if (state.selected) select(null);
  });

  // ?debug exposes the pieces on window for poking at from the browser console.
  if (params.has('debug')) window.app = { model, state, scene, dashboard };

  await scene.ready;
  document.body.classList.add('is-ready');
  setTimeout(() => document.getElementById('loading').remove(), 700);   // after its fade-out
}

start().catch((error) => {
  console.error(error);
  const loading = document.getElementById('loading');
  loading.classList.add('fatal');
  loading.textContent = 'The map could not load. Check your connection and reload the page.';
});
