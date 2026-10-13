// Entry point: loads the data, then keeps the map and the cards in step with
// one small piece of state (the day shown, the selected chokepoint, playing).

import { loadData, statusOf } from './data.js';
import { fmtCount } from './format.js';
import { MapScene } from './scene.js';
import { Dashboard } from './ui.js';

const PLAY_DAYS_PER_SECOND = 45;   // the whole record plays in about a minute
const WIDE = window.matchMedia('(min-width: 900px)');

async function start() {
  const model = await loadData();
  const state = { day: model.latest, selected: 'hormuz', playing: false };

  const dashboard = new Dashboard({
    model,
    on: {
      select,
      day: (day) => { stop(); setDay(day); },
      play: () => (state.playing ? stop() : play()),
      home: () => scene.flyTo(scene.homeView()),
      zoom: (factor) => scene.zoom(factor),
      focus: () => scene.flyTo(scene.closeUpView(state.selected)),
    },
  });
  const scene = new MapScene({
    canvas: document.getElementById('map'),
    labels: document.getElementById('pin-labels'),
    model,
    onSelect: select,
  });

  function pinStates(day) {
    return model.chokepoints.map((c) => {
      const status = statusOf(c.ratio(day));
      return { key: c.key, tone: status.tone, value: fmtCount(c.avg7[day]), tag: status.label };
    });
  }

  function render() {
    dashboard.update(state);
    scene.setDay(state.day, pinStates(state.day));
  }

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

  /** Tell the map how much of the window the cards cover, so it centres in the rest. */
  function fitMap() {
    if (!WIDE.matches) { scene.setInsets({ top: 0, right: 0, bottom: 0, left: 0 }); return; }
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    scene.setInsets({
      top: box('topbar').bottom,
      right: window.innerWidth - box('detail').left,
      bottom: window.innerHeight - box('timeline').top,
      left: 0,
    });
  }

  // Links can open on a given day and chokepoint: ?date=2021-03-25&focus=suez
  const params = new URLSearchParams(location.search);
  if (params.has('date')) state.day = model.clampIndex(model.indexOf(params.get('date')) || 0);
  const focus = model.byKey[params.get('focus')] ? params.get('focus') : null;
  if (focus) state.selected = focus;

  scene.select(state.selected, { fly: false });
  render();
  fitMap();
  scene.placeCamera(focus ? scene.closeUpView(focus) : scene.homeView());
  window.addEventListener('resize', fitMap);
  new ResizeObserver(fitMap).observe(document.getElementById('timeline'));

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
