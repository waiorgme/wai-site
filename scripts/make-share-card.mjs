// Generates the 1200x630 social share cards (EN + AR) from an HTML template
// using the site's own tokens, real logo asset, and self-hosted fonts.
// Rerun after brand changes:  node scripts/make-share-card.mjs
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

// Inline the REAL logo asset (brand lock) as a data URI so the headless
// screenshot never races or blocks the file:// load.
const logoData = `data:image/png;base64,${readFileSync(
  join(repo, "public/assets/wai-me-logo-on-dark.png"),
).toString("base64")}`;

// Traceable copy only (vault: 01 Branding + approved site copy).
const CARDS = [
  // Copy = the approved hero/meta lines from the built pages (verbatim);
  // the logo wordmark already carries the organisation name.
  {
    out: "public/assets/share-card.png",
    dir: "ltr",
    font: "'Bricolage Grotesque Variable', sans-serif",
    fontCss: "node_modules/@fontsource-variable/bricolage-grotesque/index.css",
    title: "Women in aviation,<br>across the region.",
    sub: "We open doors to training, mentors, scholarships, and each other.",
    stats: "1,300+ members · 40+ countries",
  },
  {
    out: "public/assets/share-card-ar.png",
    dir: "rtl",
    font: "'IBM Plex Sans Arabic', sans-serif",
    fontCss: "node_modules/@fontsource/ibm-plex-sans-arabic/600.css",
    title: "المرأة في الطيران،<br>في أنحاء المنطقة.",
    sub: "نفتح الأبواب إلى التدريب والإرشاد والمنح الدراسية.",
    stats: "أكثر من 1,300 عضوة · أكثر من 40 دولة",
  },
];

const html = (c) => `<!doctype html><html dir="${c.dir}"><head><meta charset="utf-8">
<style>
@import url("file://${join(repo, c.fontCss)}");
@import url("file://${join(repo, "node_modules/@fontsource/jetbrains-mono/500.css")}");
* { margin: 0; box-sizing: border-box; }
body {
  width: 1200px; height: 630px; overflow: hidden; position: relative;
  background:
    radial-gradient(900px 500px at 85% -10%, #0f233f 0%, transparent 60%),
    radial-gradient(700px 420px at -10% 110%, #0b1a31 0%, transparent 55%),
    #060d1c;
  font-family: ${c.font};
  color: #fff; padding: 72px 84px;
  display: flex; flex-direction: column; justify-content: space-between;
}
svg.flight { position: absolute; inset: 0; width: 100%; height: 100%; }
img.logo { height: 78px; width: auto; position: relative; }
h1 { font-size: ${c.dir === "rtl" ? "80px" : "92px"}; line-height: ${c.dir === "rtl" ? "1.35" : "1.02"}; font-weight: 700; letter-spacing: ${c.dir === "rtl" ? "0" : "-0.02em"}; position: relative; }
.sub { font-size: 34px; color: #b9c7dd; margin-top: 22px; position: relative; }
.stats { font-family: 'JetBrains Mono', monospace; font-size: 26px; color: #6cc8ff; letter-spacing: .06em; position: relative; }
</style></head><body>
<svg class="flight" viewBox="0 0 1200 630" aria-hidden="true">
  <path d="M-40 620 C 340 600, 640 500, 880 350 S 1160 120, 1260 40"
        fill="none" stroke="#6cc8ff" stroke-width="3" stroke-opacity="0.4" stroke-dasharray="2 10" stroke-linecap="round"/>
  <circle cx="1050" cy="200" r="5" fill="#6cc8ff" fill-opacity="0.9"/>
</svg>
<img class="logo" src="${logoData}" alt="">
<div>
  <h1>${c.title}</h1>
  <p class="sub">${c.sub}</p>
</div>
<p class="stats">${c.stats}</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const card of CARDS) {
  await page.setContent(html(card), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(repo, card.out) });
  console.log("wrote", card.out);
}
await browser.close();
