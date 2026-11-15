// Renders SVG scene variants into the PNGs used by the TV.
const path = require('node:path');
const { chromium } = require('playwright');

// Each SVG fragment corresponds to a different installed TV backdrop.
const variants = [
  ['#night-backdrop', 'woodland-tv.png'],
  ['#day', 'woodland-day-tv.png'],
  ['#overcast-day', 'woodland-overcast-day-tv.png'],
  ['#overcast-night', 'woodland-overcast-night-tv.png'],
];
const cloudVariants = [
  ['woodland-clouds', 'light', 'woodland-clouds-day.png'],
  ['woodland-clouds', 'dark', 'woodland-clouds-night.png'],
  ['woodland-overcast-clouds', 'light', 'woodland-overcast-clouds.png'],
];

async function capture() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: 'reduce',
    });
    const origin = process.env.FRAME_PREVIEW_URL || 'http://127.0.0.1:4173';
    for (const [fragment, file] of variants) {
      await page.goto(new URL('/assets/woodland.svg' + fragment, origin).href);
      await page.locator(fragment === '#night-backdrop' ? '.night-sky' : fragment).waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(__dirname, '..', 'assets', file) });
    }
    await page.setViewportSize({ width: 2280, height: 280 });
    for (const [source, colorScheme, file] of cloudVariants) {
      await page.emulateMedia({ colorScheme });
      await page.goto(new URL('/assets/' + source + '.svg', origin).href);
      await page.locator('svg').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(__dirname, '..', 'assets', file), omitBackground: true });
    }
  } finally {
    await browser.close();
  }
}

capture().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
