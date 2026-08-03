// On-map train tooltip check: selecting a train (without engaging follow)
// shows a live label tracking its screen position, panning/zooming while
// selected keeps it in sync, and deselecting hides it again.
//
// Usage: npm run verify:train-tooltip   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/";
const EDGE =
  process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    ...(process.env.EXTRA_CHROME_ARGS?.split(" ").filter(Boolean) ?? []),
  ],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};
const finish = async (fatal) => {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (fatal || failed.length) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("PASS");
};

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_500));

const tooltipRect = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="train-tooltip"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === "none") return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: el.textContent };
  });

const projectedPoint = (runIdx) =>
  page.evaluate((runIdx) => {
    const c = window.__sim.current;
    const { vehicles, count } = c.getInterpolated(performance.now());
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      if (vehicles[o + 5] === runIdx) {
        return window.__map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1]));
      }
    }
    return null;
  }, runIdx);

// --- find a live train, select it (no follow) -------------------------------

const live = await page.evaluate(() => {
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  if (!count) return null;
  return { runIdx: vehicles[5] };
});
if (!live) {
  check("tooltip appears when a train is selected", false, "no live vehicles to select");
  await finish(true);
}

await page.evaluate(() => window.__store.getState().selectRun(null));
await new Promise((r) => setTimeout(r, 200));
const beforeSelect = await tooltipRect();
check("tooltip is hidden before any selection", beforeSelect === null, `${JSON.stringify(beforeSelect)}`);

await page.evaluate((runIdx) => window.__store.getState().selectRun(runIdx), live.runIdx);
await new Promise((r) => setTimeout(r, 1_500));

const afterSelect = await tooltipRect();
check(
  "tooltip appears with non-empty text when a train is selected (not following)",
  !!afterSelect && !!afterSelect.text && afterSelect.text.trim().length > 0,
  afterSelect ? `"${afterSelect.text}"` : "null",
);

const following = await page.evaluate(() => window.__store.getState().following);
check("selecting a train does not itself engage follow", following === false, `following=${following}`);

// --- position tracks the projected screen point -----------------------------

const checkTracksProjection = async (label) => {
  const rect = await tooltipRect();
  const p = await projectedPoint(live.runIdx);
  if (!rect || !p) {
    check(label, false, `rect=${JSON.stringify(rect)}, projected=${JSON.stringify(p)}`);
    return;
  }
  // Tooltip is anchored bottom-center ~10px above the point, so compare its
  // horizontal center and its bottom edge (minus the ~10px offset) against
  // the projected point, with a generous pixel tolerance for the 1s+ of
  // engine motion between the projection read and the DOM read.
  const centerX = rect.x + rect.width / 2;
  const bottomY = rect.y + rect.height;
  const dx = Math.abs(centerX - p.x);
  const dy = Math.abs(bottomY + 10 - p.y);
  check(label, dx < 40 && dy < 40, `offset (${dx.toFixed(1)}, ${dy.toFixed(1)}) px`);
};
await checkTracksProjection("tooltip tracks the train's projected screen position");

// --- panning/zooming while selected keeps it in sync -------------------------

await page.evaluate(() => window.__map.jumpTo({ zoom: window.__map.getZoom() + 1, bearing: 30 }));
await new Promise((r) => setTimeout(r, 800));
await checkTracksProjection("tooltip re-tracks after the camera moves (pan/zoom while selected)");

// --- deselecting hides it -----------------------------------------------------

await page.evaluate(() => window.__store.getState().selectRun(null));
await new Promise((r) => setTimeout(r, 300));
const afterDeselect = await tooltipRect();
check("deselecting the train hides the tooltip", afterDeselect === null, `${JSON.stringify(afterDeselect)}`);

await finish(false);
