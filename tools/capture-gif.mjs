import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";

// docs/media/ is this repo's build output for demo assets (see CLAUDE.md) —
// this script writes the finished GIF straight there, plus a scratch/ copy
// for a quick local preview without touching the tracked file.
const URL = process.argv[2] ?? "http://localhost:5174/";
const OUT_DIR = "scratch/frames";
const MEDIA_DIR = "docs/media";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

await mkdir(OUT_DIR, { recursive: true });
await mkdir(MEDIA_DIR, { recursive: true });

console.log("Launching browser...");
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

// Wait for map tiles and 3D layer to load
console.log("Waiting for map and 3D scene to load...");
await new Promise((r) => setTimeout(r, 8000));

let frameIdx = 0;
async function captureFrame() {
  const num = String(frameIdx++).padStart(4, "0");
  await page.screenshot({ path: `${OUT_DIR}/frame_${num}.png` });
}

console.log("Capturing overview and train movement sequence...");
// Pose 1: Orbit around Siam Station while trains move
const startCenter = [100.5332, 13.7456];
const totalFrames = 40;

for (let i = 0; i < totalFrames; i++) {
  const t = i / totalFrames;
  const bearing = 30 + t * 120; // orbit from 30deg to 150deg
  const pitch = 55 + Math.sin(t * Math.PI) * 15; // pitch smooth arc
  const zoom = 15.5 - Math.sin(t * Math.PI) * 0.5;

  await page.evaluate(
    ([c, z, p, b]) => {
      const map = window.__map;
      if (map) map.jumpTo({ center: c, zoom: z, pitch: p, bearing: b });
    },
    [startCenter, zoom, pitch, bearing],
  );

  await new Promise((r) => setTimeout(r, 120));
  await captureFrame();
}

console.log("Capturing route planner interaction...");
// Open route search panel via UI click or DOM query
await page.evaluate(() => {
  // Click on route planner or line selector toggle if present
  const routeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Route") || b.getAttribute("aria-label")?.includes("Route")
  );
  if (routeBtn) routeBtn.click();
});

await new Promise((r) => setTimeout(r, 500));

// Capture frames showing the UI and interaction
for (let i = 0; i < 15; i++) {
  const t = i / 15;
  const bearing = 150 + t * 30;
  await page.evaluate(
    ([c, z, p, b]) => {
      const map = window.__map;
      if (map) map.jumpTo({ center: c, zoom: z, pitch: p, bearing: b });
    },
    [startCenter, 15.0, 60, bearing],
  );

  await new Promise((r) => setTimeout(r, 150));
  await captureFrame();
}

console.log(`Total captured frames: ${frameIdx}`);
await browser.close();

// Compile frames into GIF using ffmpeg with high-quality palette
console.log("Generating high-quality GIF with ffmpeg...");
const gifOutPath = path.join(MEDIA_DIR, "metro_3d_demo.gif");
const localGifPath = "scratch/metro_3d_demo.gif";

const palettePath = `${OUT_DIR}/palette.png`;

// Generate palette
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -vf "fps=10,scale=800:-1:flags=lanczos,palettegen" "${palettePath}"`);

// Generate GIF using palette
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" "${gifOutPath}"`);
execSync(`"${FFMPEG}" -y -i "${OUT_DIR}/frame_%04d.png" -i "${palettePath}" -lavfi "fps=10,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" "${localGifPath}"`);

console.log(`GIF animation created successfully at:\n - ${gifOutPath}\n - ${localGifPath}`);
