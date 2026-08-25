import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

// docs/media/ is this repo's build output for demo assets (see CLAUDE.md) —
// this script writes the finished GIF straight there, plus a scratch/ copy
// for a quick local preview without touching the tracked file.
const URL = process.argv[2] ?? "http://localhost:5174/";
const OUT_DIR = "scratch/follow_frames";
const MEDIA_DIR = "docs/media";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

await mkdir(OUT_DIR, { recursive: true });
await mkdir(MEDIA_DIR, { recursive: true });

console.log("Launching browser for train follow capture...");
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--window-size=1280,800", "--no-first-run"],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

console.log(`Navigating to ${URL}...`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

console.log("Waiting for map and simulation tick...");
await new Promise((r) => setTimeout(r, 8000));

// Select a train and engage follow mode
const selected = await page.evaluate(() => {
  const store = window.__store?.getState();
  const layer = window.__map?.getLayer("network-3d")?.implementation;
  
  if (store && layer && layer.lastVehicles && layer.lastCount > 0) {
    const runIdx = layer.lastVehicles[1]; // LANE_RUN_IDX is index 1
    store.selectRun(runIdx);
    store.setFollowing(true);
    return { runIdx, count: layer.lastCount };
  }
  if (store) {
    store.selectRun(7);
    store.setFollowing(true);
    return { runIdx: 7, count: 0 };
  }
  return null;
});

console.log("Engaged train follow mode:", selected);

let frameIdx = 0;
async function captureFrame() {
  const num = String(frameIdx++).padStart(4, "0");
  await page.screenshot({ path: `${OUT_DIR}/frame_${num}.png` });
}

console.log("Capturing train follow motion and orbit sequence...");
const totalFrames = 50;

for (let i = 0; i < totalFrames; i++) {
  // Rotate/orbit camera around the moving train in the middle of the sequence
  if (i > 15 && i < 40) {
    await page.evaluate(() => {
      const layer = window.__map?.getLayer("network-3d")?.implementation;
      if (layer && layer.follow) {
        layer.follow.addYawOffset(3.5); // smooth 3.5 deg yaw orbit per frame
      }
    });
  }

  await new Promise((r) => setTimeout(r, 120)); // ~8 FPS capture rate
  await captureFrame();
}

console.log(`Captured ${frameIdx} frames.`);
await browser.close();

// Compile frames into GIF using ffmpeg
console.log("Generating follow-train GIF animation...");
const gifOutPath = path.join(MEDIA_DIR, "follow_train_demo.gif");
const localGifPath = "scratch/follow_train_demo.gif";
const palettePath = `${OUT_DIR}/palette.png`;

execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -vf "fps=10,scale=800:-1:flags=lanczos,palettegen" "${palettePath}"`);
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" "${gifOutPath}"`);
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" "${localGifPath}"`);

console.log(`Follow-train GIF created successfully at:\n - ${gifOutPath}\n - ${localGifPath}`);
