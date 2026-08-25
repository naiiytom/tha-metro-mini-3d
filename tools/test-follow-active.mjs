import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

// docs/media/ is this repo's build output for demo assets (see CLAUDE.md) —
// this script writes the finished GIF straight there, plus a scratch/ copy
// for a quick local preview without touching the tracked file.
const URL = process.argv[2] ?? "http://localhost:5174/";
const OUT_DIR = "scratch/follow_frames_v2";
const MEDIA_DIR = "docs/media";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

await mkdir(OUT_DIR, { recursive: true });
await mkdir(MEDIA_DIR, { recursive: true });

console.log("Launching browser for follow capture...");
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--window-size=1280,800", "--no-first-run"],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
page.on("console", (msg) => console.log(`[browser.${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

console.log(`Navigating to ${URL}...`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

console.log("Waiting for map and simulation tick...");
await new Promise((r) => setTimeout(r, 10000));

// Select a real active moving train
const selectedInfo = await page.evaluate(() => {
  const client = window.__sim?.current;
  const store = window.__store?.getState();

  if (client && store) {
    const now = client.getSimNow();
    const res = client.getInterpolated(now);
    const vehicles = res.vehicles;
    const count = res.count;
    console.log(`Sim active vehicles count: ${count}`);

    if (count > 0) {
      const LANE_RUN_IDX = 5;
      const LANE_X = 0;
      const LANE_Y = 1;
      const VEHICLE_STRIDE = 8;

      const runIdx = vehicles[LANE_RUN_IDX]; // Pick the first active train runIdx
      const startX = vehicles[LANE_X];
      const startY = vehicles[LANE_Y];

      store.selectRun(runIdx);
      store.setFollowing(true);

      return { runIdx, count, startX, startY };
    }
  }
  return null;
});

console.log("Active train selection result:", selectedInfo);

let frameIdx = 0;
async function captureFrame() {
  const num = String(frameIdx++).padStart(4, "0");
  await page.screenshot({ path: `${OUT_DIR}/frame_${num}.png` });
}

console.log("Capturing train follow movement and yaw orbit...");
const totalFrames = 60;

for (let i = 0; i < totalFrames; i++) {
  // Rotate/orbit camera around the moving train midway
  if (i >= 20 && i <= 45) {
    await page.evaluate(() => {
      const layer = window.__map?.getLayer("network-3d")?.implementation;
      if (layer && layer.follow) {
        layer.follow.addYawOffset(3.0); // smooth 3.0 deg orbit per frame
      }
    });
  }

  await new Promise((r) => setTimeout(r, 100)); // 10 FPS
  await captureFrame();
}

console.log(`Captured ${frameIdx} frames.`);
await browser.close();

// Compile frames into GIF using ffmpeg
console.log("Compiling follow_train_demo.gif with ffmpeg...");
const gifOutPath = path.join(MEDIA_DIR, "follow_train_demo.gif");
const localGifPath = "scratch/follow_train_demo.gif";
const palettePath = `${OUT_DIR}/palette.png`;

execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -vf "fps=10,scale=800:-1:flags=lanczos,palettegen" "${palettePath}"`);
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" "${gifOutPath}"`);
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" "${localGifPath}"`);

console.log(`Follow-train GIF created successfully at:\n - ${gifOutPath}\n - ${localGifPath}`);
