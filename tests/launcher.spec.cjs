// Exercises the launcher in Chromium with controlled provider and Tizen responses.
const { test, expect } = require('@playwright/test');
const streamForgeUrl = 'https://streamforge.example.invalid';

// Replace provider calls so tests do not depend on live prices, weather, or listings.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(url => { window.FrameLauncherConfig = { streamForgeUrl: url }; }, streamForgeUrl);
  await page.route('https://www.tradingview-widget.com/**', route => route.abort());
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { temperature_2m: 73, weather_code: 2, time: Math.floor(Date.now() / 1000) }, daily: { temperature_2m_max: [78], temperature_2m_min: [62] } } }));
  await page.route('https://i.mjh.nz/SamsungTVPlus/us.xml', route => route.fulfill({ contentType: 'application/xml', body: '<tv/>' }));
});

// Install a Tizen fixture and record native calls for assertions.
async function tv(page, options = {}) {
  await page.addInitScript((options) => {
    window.calls = [];
    window.appScans = 0;
    const apps = options.apps || [
      { id: 'R3K5Frame1.Launcher', name: 'Frame' },
      { id: 'tv.youtube', name: 'YouTube', show: true },
      { id: 'tv.plex', name: 'Plex', show: true },
      { id: 'tv.hidden', name: 'Background service', show: false }
    ];
    const application = {
      getCurrentApplication() { return { appInfo: { id: 'R3K5Frame1.Launcher' }, hide() { calls.push(['hide']); }, exit() { calls.push(['exit']); } }; },
      getAppsInfo(success, failure) {
        const first = ++window.appScans === 1;
        if (options.error || (first && options.failFirstAppScan)) failure({ message: 'Permission denied' });
        else if (first && options.holdFirstAppScan) window.finishFirstAppScan = () => success(apps);
        else success(apps);
      },
      launchAppControl(control, id, success, failure) { calls.push(control.uri ? ['appControl', id, control.operation, control.uri] : ['appControl', id, control.operation]); if (options.launchError) failure({ message: 'Unavailable' }); else success(); }
    };
    if (!options.controlOnly) application.launch = (id, success, failure) => {
      calls.push(['launch', id]); if (options.launchError) failure({ message: 'Unavailable' }); else success();
    };
    window.tizen = {
      application,
      ApplicationControl: function (operation, uri) { this.operation = operation; this.uri = uri; },
      systeminfo: { getPropertyValue(property, success, failure) {
        calls.push(['property', property]);
        if (options.inputError) failure({ message: 'Not supported' });
        else success({ connected: [{ type: 'HDMI', number: 3, sourceId: 'actual-source' }] });
      } },
      tvwindow: { setSource(source, success) { calls.push(['source', source]); success(); } }
    };
  }, options);
}

test('home renders offline assets, scales, and launches only on selection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Markets', exact: true })).toBeVisible();
  expect(await page.locator('.section-heading h2').innerText()).toBe('Your Apps');
  expect(await page.locator('.home-market-controls button').first().innerText()).toBe('Edit Watchlist');
  expect(await page.locator('.brand').evaluate(node => node.tabIndex)).toBe(-1);
  await expect(page.locator('.app-row').getByRole('button', { name: 'Open StreamForge', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Open Netflix' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Netflix' }).click();
  await expect(page.getByRole('status')).toContainText('Browser preview');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => page.locator('#stage').evaluate(node => Math.round(node.getBoundingClientRect().width))).toBe(1280);
  expect(errors).toEqual([]);
});

test('favorites persist, enforce capacity, and retain selection order', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit apps', exact: true }).click();
  await page.getByRole('button', { name: 'Add Apple TV favorite' }).click();
  await expect(page.getByRole('status')).toContainText('8 favorites');
  await page.getByRole('button', { name: 'Remove Netflix favorite' }).click();
  await page.getByRole('button', { name: 'Add Apple TV favorite' }).click();
  await page.reload();
  const labels = await page.locator('.app-row .app-label').allTextContents();
  expect(labels).toEqual(['StreamForge', 'LiveNOW from FOX', 'Hulu', 'Peacock', 'Prime Video', 'Samsung TV Plus', 'YouTube', 'Apple TV', 'All apps']);
});

test('settings ignore old artwork choices, restore focus, and persist the clock', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('r3k5.frame.preferences.v1.preview')) {
      localStorage.setItem('r3k5.frame.preferences.v1.preview', JSON.stringify({ artwork: 'dunes', themeMode: 'night' }));
    }
  });
  await page.goto('/');
  await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland\.svg#night-backdrop/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Nighttime Background', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '12-hour clock' }).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
  expect(await page.locator('#modal').evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland\.svg#night-backdrop/);
  expect(await page.locator('#clock small').count()).toBe(0);
});

test('full-screen Woodland follows the display theme and restores focus on Back', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 4, 12, 0, 0) });
  await page.goto('/');
  await page.getByRole('button', { name: 'View Woodland' }).click();
  await expect(page.locator('#stage')).toHaveClass('woodland-view');
  await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland\.svg#day/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'View Woodland' })).toBeFocused();
  await expect(page.locator('#stage')).not.toHaveClass('woodland-view');
});

test('Woodland scene review advances and Back restores the chosen theme', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 4, 12, 0, 0) });
  await page.goto('/');
  const stage = page.locator('#stage');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  await page.getByRole('button', { name: 'Daytime', exact: true }).click();
  await page.getByRole('button', { name: 'Review Woodland scenes', exact: true }).click();
  await expect(stage).toHaveAttribute('data-scene-review', '');
  await expect(stage).toHaveAttribute('data-theme', 'day');
  await page.clock.fastForward(15001);
  await expect(stage).toHaveAttribute('data-theme', 'night');
  await page.keyboard.press('Escape');
  await expect(stage).not.toHaveAttribute('data-scene-review', '');
  await expect(stage).toHaveAttribute('data-theme', 'day');
  await expect(settings).toBeFocused();
});

test('remote arrows reach favorites and Back returns to home', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Netflix' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Open Hulu' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Browser preview');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true })));
  await expect(page.getByRole('heading', { name: 'Markets', exact: true })).toBeVisible();
});

test('TV uses discovered app IDs, excludes services and itself, and exits explicitly', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Open Netflix' })).toHaveCount(0);
  await page.getByRole('button', { name: 'All apps', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Frame', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Background service' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Plex' }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['launch', 'tv.plex']]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit launcher' }).click();
  expect(await page.evaluate(() => window.calls)).toContainEqual(['exit']);
});

test('TV launch fallback and failed launches are reported', async ({ page }) => {
  await tv(page, { controlOnly: true, launchError: true });
  await page.goto('/');
  await page.locator('.app-row').getByRole('button', { name: 'Open YouTube' }).click();
  expect(await page.evaluate(() => window.calls)).toContainEqual(['appControl', 'tv.youtube', 'http://tizen.org/appcontrol/operation/default']);
  await expect(page.getByRole('status')).toContainText('Unavailable');
});

test('input switches use actual source object and hide after success', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Inputs', exact: true }).click();
  await page.getByRole('button', { name: /HDMI 3/ }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([
    ['property', 'VIDEOSOURCE'], ['source', { type: 'HDMI', number: 3, sourceId: 'actual-source' }], ['hide']
  ]);
});

test('native errors never replace real apps with preview data', async ({ page }) => {
  await tv(page, { error: true, inputError: true });
  await page.goto('/');
  await expect(page.locator('.empty')).toContainText('Permission denied');
  await expect(page.getByRole('button', { name: 'Open Netflix' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inputs', exact: true }).click();
  await expect(page.locator('.empty')).toContainText('Not supported');
});

test('a successful native app scan after resume clears the previous error', async ({ page }) => {
  await tv(page, { failFirstAppScan: true });
  await page.goto('/');
  await expect(page.locator('.empty')).toContainText('Permission denied');
  await expect(page.locator('#startup-splash')).toBeHidden();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Open YouTube', exact: true })).toBeVisible();
  await expect(page.locator('.empty')).toHaveCount(0);
});

test('corrupt preferences and denied storage do not prevent startup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('r3k5.frame.preferences.v1.preview', '{broken');
    Storage.prototype.setItem = () => { throw new Error('Storage denied'); };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Netflix' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Daytime', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be saved');
});

test('reset is reversible until confirmed', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 4, 21, 0, 0) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Daytime', exact: true }).click();
  await page.getByRole('button', { name: 'Reset preferences' }).click();
  await page.getByRole('button', { name: 'Keep preferences' }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'day');
  await page.getByRole('button', { name: 'Reset preferences' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'night');
});

test('StreamForge button opens the production site from preview', async ({ page }) => {
  await page.addInitScript(() => { window.opened = []; window.open = (...args) => { window.opened.push(args); }; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open StreamForge', exact: true }).click();
  expect(await page.evaluate(() => window.opened)).toEqual([[streamForgeUrl, '_blank', 'noopener,noreferrer']]);
  expect(await page.locator('.app-row .app-label').first().textContent()).toBe('StreamForge');
});

test('StreamForge TV shortcut sends the site URL to the system browser', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open StreamForge', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['appControl', null, 'http://tizen.org/appcontrol/operation/view', streamForgeUrl]]);
});

test('an installed StreamForge app replaces the web shortcut and uses its real ID', async ({ page }) => {
  await tv(page, { apps: [{ id: 'actual.streamforge.tv', name: 'StreamForge', show: true }] });
  await page.addInitScript(() => {
    localStorage.setItem('r3k5.frame.preferences.v1.tv', JSON.stringify({ favorites: ['shortcut.streamforge'], streamforgeAdded: true }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open StreamForge', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['launch', 'actual.streamforge.tv']]);
  await page.getByRole('button', { name: 'All apps', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open StreamForge', exact: true })).toHaveCount(1);
});

test('existing favorites get StreamForge once and a later removal stays removed', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('r3k5.frame.preferences.v1.preview')) {
      localStorage.setItem('r3k5.frame.preferences.v1.preview', JSON.stringify({ favorites: ['preview.netflix', 'preview.youtube', 'preview.prime', 'preview.disney', 'preview.plex', 'preview.spotify'] }));
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open StreamForge', exact: true })).toBeVisible();
  expect(await page.locator('.app-row [data-app]').count()).toBe(8);
  await page.getByRole('button', { name: 'Edit apps', exact: true }).click();
  await page.getByRole('button', { name: 'Remove StreamForge favorite' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open StreamForge', exact: true })).toHaveCount(0);
});

test('office favorites match the requested streaming and live TV services', async ({ page }) => {
  await page.goto('/');
  expect(await page.locator('.app-row .app-label').allTextContents()).toEqual(['StreamForge', 'LiveNOW from FOX', 'Netflix', 'Hulu', 'Peacock', 'Prime Video', 'Samsung TV Plus', 'YouTube', 'All apps']);
  await expect(page.getByText('A place for your stories.', { exact: false })).toHaveCount(0);
});

test('YouTube is appended to a saved dock once and opens the discovered app', async ({ page }) => {
  await tv(page, { apps: [{ id: 'tv.live', name: 'Samsung TV Plus' }, { id: 'tv.youtube', name: 'YouTube' }, { id: 'tv.youtube.tv', name: 'YouTube TV' }] });
  await page.addInitScript(() => {
    const key = 'r3k5.frame.preferences.v1.tv';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ favorites: ['tv.live', 'shortcut.streamforge'], officeAppsApplied: true, streamforgeAdded: true, liveNowAdded: true }));
  });
  await page.goto('/');
  expect(await page.locator('.app-row .app-label').allTextContents()).toEqual(['Samsung TV Plus', 'StreamForge', 'YouTube', 'All apps']);
  await page.getByRole('button', { name: 'Open YouTube', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['launch', 'tv.youtube']]);
  await page.getByRole('button', { name: 'Edit apps', exact: true }).click();
  await page.getByRole('button', { name: 'Remove YouTube favorite', exact: true }).click();
  await page.reload();
  await expect(page.locator('.app-row').getByRole('button', { name: 'Open YouTube', exact: true })).toHaveCount(0);
});

test('automatic theme changes at 7am and 7pm using the local clock', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 4, 6, 59, 55) });
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'night');
  await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland\.svg/);
  await expect(page.locator('.woodland-fox')).toBeHidden();
  expect(await page.locator('.landscape').boundingBox()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  await page.clock.fastForward(15000);
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'day');
  await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland\.svg#day/);
  await expect(page.locator('.woodland-fox')).toBeVisible();
  await expect(page.locator('.woodland-owl')).toBeHidden();
  await page.clock.fastForward(12 * 60 * 60 * 1000);
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'night');
});

test('the TV backdrop loads while the main launcher script is still pending', async ({ page }) => {
  await tv(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.setFixedTime(new Date(2026, 10, 15, 13));
  let allowLauncher;
  const launcher = new Promise(resolve => { allowLauncher = resolve; });
  await page.route('**/js/app.js', async route => {
    await launcher;
    return route.continue();
  });
  const backdrops = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/assets\/woodland(?:-day-tv|-tv)?\.(?:png|svg)$/.test(path)) backdrops.push(path);
  });

  try {
    const [image] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/assets/woodland-day-tv.png'), { timeout: 5000 }),
      page.goto('/', { waitUntil: 'commit' })
    ]);
    expect(await image.finished()).toBeNull();
    await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'day');
    await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland-day-tv\.png/);
    expect(await page.locator('.landscape').boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(backdrops).toEqual(['/assets/woodland-day-tv.png']);
  } finally {
    allowLauncher();
  }
  await expect(page.locator('#version-history')).toContainText('Created by Mike Davis');
});

test('the startup splash covers Home until the first weather and scene are ready', async ({ page }) => {
  await tv(page, { holdFirstAppScan: true });
  let allowWeather;
  const weather = new Promise(resolve => { allowWeather = resolve; });
  await page.route('https://api.open-meteo.com/**', async route => {
    await weather;
    return route.fulfill({ json: { current: { temperature_2m: 68, weather_code: 3, time: Math.floor(Date.now() / 1000) } } });
  });
  await page.goto('/');
  const splash = page.locator('#startup-splash');
  try {
    await expect(splash).toBeVisible();
    await expect(page.locator('#stage')).toHaveAttribute('aria-hidden', 'true');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(await page.evaluate(() => window.appScans)).toBe(1);
    await page.evaluate(() => window.finishFirstAppScan());
    await expect(page.locator('.app-row .streamforge-card')).toHaveCount(1);
    await expect.poll(() => page.locator('#startup-progress').evaluate(progress => progress.value)).toBeGreaterThan(0);
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await splash.evaluate(node => {
      node.addEventListener('transitionstart', event => {
        if (event.target === node && event.propertyName === 'opacity') {
          const style = getComputedStyle(node);
          node.dataset.fadeObserved = `${style.visibility}/${style.pointerEvents}/${document.activeElement.classList.contains('streamforge-card')}`;
        }
      });
    });
  } finally {
    allowWeather();
  }
  await expect(splash).toBeHidden();
  await expect(splash).toHaveAttribute('data-fade-observed', 'visible/none/true');
  await expect(page.locator('#weather-value')).toHaveText('68°F · Overcast');
  await expect(page.locator('#stage')).toHaveAttribute('data-sky', 'overcast');
  await expect(page.locator('.app-row .streamforge-card')).toBeFocused();
});

test('a stalled live guide cannot keep the startup splash on screen', async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let allowGuide;
  const guide = new Promise(resolve => { allowGuide = resolve; });
  await page.route('https://i.mjh.nz/SamsungTVPlus/us.xml', async route => {
    await guide;
    return route.fulfill({ contentType: 'application/xml', body: '<tv/>' });
  });
  try {
    await Promise.all([page.waitForRequest('https://i.mjh.nz/SamsungTVPlus/us.xml'), page.goto('/')]);
    await expect(page.locator('#startup-splash')).toBeVisible();
    await page.clock.fastForward(4600);
    await expect(page.locator('#startup-splash')).toBeHidden();
    await expect(page.locator('#startup-splash')).toHaveCSS('transition-duration', '0s');
    await expect(page.locator('.app-row .streamforge-card')).toBeFocused();
  } finally {
    allowGuide();
  }
});

test('Woodland completes the dawn and dusk fades at 7 on the TV clock', async ({ page }) => {
  const dawn = new Date(2026, 10, 4, 7).getTime();
  const dusk = new Date(2026, 10, 4, 19).getTime();
  const minute = 60000;
  await page.route('https://api.open-meteo.com/**', route => route.abort());
  const setTime = async time => {
    await page.clock.setFixedTime(new Date(time));
    await page.goto('/');
  };
  const position = selector => page.locator(selector).evaluate(node => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return [Math.round(matrix.e), Math.round(matrix.f)];
  });
  const stage = page.locator('#stage');
  await setTime(dawn - 10.5 * minute);
  await expect(stage).not.toHaveAttribute('data-transition', /.+/);
  await setTime(dawn - 7.5 * minute);
  await expect(stage).toHaveAttribute('data-transition', 'dawn');
  await expect(stage).toHaveAttribute('data-theme', 'night');
  expect(await position('.woodland-sun')).toEqual([755, 344]);
  expect((await position('.woodland-moon'))[1]).toBeGreaterThan(200);
  await setTime(dawn - 5 * minute);
  expect(await position('.woodland-moon')).toEqual([755, 344]);
  expect(await position('.woodland-sun')).toEqual([755, 344]);
  await setTime(dawn);
  await expect(stage).toHaveAttribute('data-theme', 'day');
  await expect(stage).not.toHaveAttribute('data-transition', /.+/);
  expect(await position('.woodland-sun')).toEqual([694, 81]);
  await setTime(dusk - 10.5 * minute);
  await expect(stage).not.toHaveAttribute('data-transition', /.+/);
  await setTime(dusk - 7.5 * minute);
  await expect(stage).toHaveAttribute('data-transition', 'dusk');
  expect(await position('.woodland-moon')).toEqual([755, 344]);
  expect((await position('.woodland-sun'))[1]).toBeGreaterThan(200);
  await setTime(dusk - 5 * minute);
  expect(await position('.woodland-sun')).toEqual([755, 344]);
  expect(await position('.woodland-moon')).toEqual([755, 344]);
  await setTime(dusk);
  await expect(stage).toHaveAttribute('data-theme', 'night');
  await expect(stage).not.toHaveAttribute('data-transition', /.+/);
  expect(await position('.woodland-moon')).toEqual([780, 80]);
});

test('home shows current movies and TV episodes with a guide handoff', async ({ page }) => {
  await tv(page, { apps: [{ id: 'com.samsung.tv.tvPlusDeeplinker', name: 'Samsung TV Plus', show: false }] });
  await page.clock.install({ time: new Date('2026-11-14T03:00:00Z') });
  await page.route('https://i.mjh.nz/SamsungTVPlus/us.xml', route => route.fulfill({ contentType: 'application/xml', body: `
    <tv><channel id="m"><display-name>Movie Hub</display-name></channel><channel id="t"><display-name>TV Land Sitcoms</display-name></channel>
    <programme channel="m" start="20261113200000 -0600" stop="20261113220000 -0600"><title>Tonight’s feature</title><desc>Movie description.</desc></programme>
    <programme channel="m" start="20261114010000 +0000" stop="20261114030000 +0000"><title>Earlier feature</title></programme>
    <programme channel="t" start="20261114023000 +0000" stop="20261114033000 +0000"><title>Tonight’s sitcom</title><sub-title>Episode one</sub-title></programme></tv>` }));
  await page.goto('/');
  const films = page.getByRole('region', { name: 'Live movies' });
  await expect(films.getByRole('button', { name: /Tonight’s feature/ })).toBeVisible();
  await expect(films.getByText('Earlier feature')).toHaveCount(0);
  await page.getByRole('region', { name: 'Live TV shows' }).getByRole('button', { name: /Tonight’s sitcom/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Episode one');
  await page.getByRole('dialog').getByRole('button', { name: 'Open Samsung TV Plus', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['launch', 'com.samsung.tv.tvPlusDeeplinker']]);
});

test('D-pad crosses the dock, reaches staggered controls, and glides between targets', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.app-row');
  await row.getByRole('button', { name: 'Open YouTube' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(row.getByRole('button', { name: 'All apps' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Edit apps', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row.getByRole('button', { name: 'All apps' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Rearrange', exact: true })).toBeFocused();
  await expect(page.locator('#focus-ring')).toBeVisible();
  await expect(page.locator('#focus-ring')).toHaveCSS('transition-property', /transform/);
  await page.keyboard.press('ArrowDown');
  await expect(row.getByRole('button', { name: 'All apps' })).toBeFocused();
});

test('D-pad crosses directly from the watchlist to the selected app and back', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  const preview = page.locator('#app-preview').getByRole('button', { name: 'Open selected app' });
  await expect(preview).toHaveText('Open StreamForge');
  await page.getByRole('button', { name: 'Open QQQ chart' }).focus();
  await page.keyboard.press('ArrowRight');
  const iwm = page.getByRole('button', { name: 'Open IWM chart' });
  await expect(iwm).toBeFocused();
  await page.getByRole('button', { name: 'Edit watchlist', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.home-market-panel button:focus')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Edit watchlist', exact: true })).not.toBeFocused();
  const portfolioSwitch = page.getByRole('button', { name: 'Robinhood', exact: true });
  await page.getByRole('button', { name: 'Edit watchlist', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(portfolioSwitch).toBeFocused();
  for (const from of [iwm, portfolioSwitch, page.getByRole('button', { name: 'View Woodland', exact: true })]) {
    await from.focus();
    await page.keyboard.press('ArrowRight');
    await expect(preview).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(from).toBeFocused();
  }
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});

test('manual theme persists and can return to automatic', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 4, 21, 0, 0) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Daytime', exact: true }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'day');
  await page.reload();
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'day');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-theme', 'night');
});

test('Live TV launches the discovered Samsung TV Plus app without guessing an ID', async ({ page }) => {
  await tv(page, { apps: [{ id: 'discovered.tvplus.app', name: 'Samsung TV Plus', show: true }] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['launch', 'discovered.tvplus.app']]);
});

test('Live TV reports a missing app instead of launching an unrelated app', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not reported');
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});

test('Robinhood uses its own browser handoff', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Robinhood portfolio ↗', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['appControl', null, 'http://tizen.org/appcontrol/operation/view', 'https://robinhood.com/login/']]);
});

test('market board keeps the provider on a separate origin and remote controls remain usable', async ({ page }) => {
  await page.route('https://www.tradingview-widget.com/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Markets', exact: true }).click();
  await expect(page.locator('.market-chart')).toHaveCount(3);
  expect(new URL(await page.locator('.market-chart').first().getAttribute('src')).origin).toBe('https://www.tradingview-widget.com');
  await expect(page.locator('.section-note')).toContainText('If charts stay blank');
  await page.getByRole('button', { name: 'Expand display', exact: true }).click();
  await expect(page.locator('#stage')).toHaveClass('market-fullscreen');
  await page.keyboard.press('Escape');
  await expect(page.locator('#stage')).not.toHaveClass('market-fullscreen');
  await expect(page.getByRole('heading', { name: 'Market board.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Markets', exact: true })).toBeVisible();
});

test('watchlist validates symbols and persists edits without trapping text keys', async ({ page }) => {
  await page.route('https://www.tradingview-widget.com/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Markets', exact: true }).click();
  await page.getByRole('button', { name: 'Edit watchlist', exact: true }).click();
  await page.getByLabel('Chart 1').fill('javascript:bad<script>');
  await page.getByRole('button', { name: 'Save watchlist' }).click();
  await expect(page.locator('.form-error')).toContainText('valid exchange:ticker');
  await page.getByLabel('Chart 1').fill('nasdaq:nvda');
  await page.getByLabel('Chart 2').fill('');
  await page.getByLabel('Chart 3').fill('');
  await page.getByLabel('Chart 1').press('End');
  await page.getByLabel('Chart 1').press('Backspace');
  await expect(page.getByLabel('Chart 1')).toHaveValue('nasdaq:nvd');
  await page.getByLabel('Chart 1').fill('nasdaq:nvda');
  await page.getByRole('button', { name: 'Save watchlist' }).click();
  await expect(page.locator('.market-chart')).toHaveCount(1);
  await expect(page.locator('.market-chart')).toHaveAttribute('src', /NASDAQ%3ANVDA/);
  await page.reload();
  await page.getByRole('button', { name: 'Markets', exact: true }).click();
  await expect(page.locator('.market-chart')).toHaveCount(1);
  await expect(page.locator('.market-chart')).toHaveAttribute('src', /NASDAQ%3ANVDA/);
});

test('default weather renders provider fields and source information', async ({ page }) => {
  await page.addInitScript(() => {
    window.locationRequests = 0;
    navigator.geolocation.getCurrentPosition = () => { window.locationRequests++; };
  });
  await page.goto('/');
  await expect(page.locator('#weather-place')).toHaveText('Boulder, CO');
  expect(await page.evaluate(() => window.locationRequests)).toBe(0);
  await expect(page.locator('#weather-value')).toContainText('73°F');
  await expect(page.locator('#weather-icon')).toHaveAttribute('data-condition', 'partly');
  await page.getByRole('button', { name: 'Local weather', exact: true }).click();
  await expect(page.locator('#modal')).toContainText('80302');
  await expect(page.locator('#weather-details')).toContainText('High 78° · Low 62°');
  await expect(page.locator('#modal')).toContainText('Open-Meteo');
});

test('weather failure shows unavailable instead of a made-up temperature', async ({ page }) => {
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.locator('#weather-value')).toHaveText('Weather unavailable');
});

test('TV Home discards old weather readings and starts effects only from a current response', async ({ page }) => {
  const afternoon = new Date(2026, 10, 15, 13);
  await tv(page);
  await page.clock.install({ time: afternoon });
  await page.addInitScript(time => {
    if (window.top !== window) return;
    const hour = 3600000;
    localStorage.setItem('r3k5.frame.weather.v1.tv', JSON.stringify({
      location: { label: 'Seattle, WA', zip: '98101', latitude: 47.61, longitude: -122.33 },
      data: { temperature: 38, code: 95, windGust: 35, time: time - hour, fetchedAt: time - hour }
    }));
  }, afternoon.getTime());
  let allowFirstResponse;
  const firstResponse = new Promise(resolve => { allowFirstResponse = resolve; });
  let requests = 0;
  await page.route('https://api.open-meteo.com/**', async route => {
    expect(new URL(route.request().url()).searchParams.get('longitude')).toBe('-122.33');
    if (++requests === 1) {
      await firstResponse;
      const oldTime = afternoon.getTime() / 1000 - 4 * 3600;
      return route.fulfill({ json: { current: { temperature_2m: 38, weather_code: 95, time: oldTime } } });
    }
    if (requests === 3) return route.fulfill({ status: 503 });
    return route.fulfill({ json: { current: { temperature_2m: 32, weather_code: 73, time: afternoon.getTime() / 1000 } } });
  });

  await page.goto('/');
  const stage = page.locator('#stage');
  const weatherValue = page.locator('#weather-value');
  await expect(weatherValue).toHaveText('Loading weather…');
  await expect(page.locator('#weather-place')).toHaveText('Seattle, WA');
  await expect(stage).toHaveAttribute('data-theme', 'day');
  await expect(stage).toHaveAttribute('data-weather', 'clear');
  await expect(stage).not.toHaveAttribute('data-windy', '');
  await expect(page.locator('.landscape')).toHaveCSS('background-image', /woodland-day-tv\.png/);
  await expect(page.locator('#weather-icon')).toHaveAttribute('data-light', 'day');
  await expect(page.locator('#weather-icon')).toBeHidden();
  allowFirstResponse();
  await expect(weatherValue).toHaveText('Weather unavailable');
  await expect(stage).toHaveAttribute('data-weather', 'clear');
  await page.clock.fastForward(61000);
  await expect(weatherValue).toHaveText('32°F · Snow');
  await expect(stage).toHaveAttribute('data-weather', 'snow');
  await expect(stage).toHaveAttribute('data-theme', 'day');
  await expect(page.locator('.woodland-snow-cover')).toBeVisible();
  expect(requests).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('r3k5.frame.weather.v1.tv')))).toEqual({
    location: { label: 'Seattle, WA', zip: '98101', latitude: 47.61, longitude: -122.33 }
  });
  await page.evaluate(() => FrameWeather.refresh());
  await expect(weatherValue).toHaveText('Weather unavailable');
  await expect(stage).toHaveAttribute('data-weather', 'clear');
});

test('Home uses local conditions for both woodland skies and snowfall', async ({ page }) => {
  const noon = new Date(2026, 10, 4, 12, 0, 0);
  await page.clock.install({ time: noon });
  let code = 0;
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    json: { current: { weather_code: code, temperature_2m: 34, is_day: 1, time: noon.getTime() / 1000 } }
  }));
  await page.goto('/');
  const stage = page.locator('#stage');
  const landscape = page.locator('.landscape');
  const clouds = page.locator('.woodland-clouds');
  const precipitation = page.locator('.woodland-precipitation');
  const firelight = page.locator('.camp-light:visible');
  await expect(stage).toHaveAttribute('data-weather', 'clear');
  await expect(landscape).toHaveCSS('background-image', /woodland\.svg#day/);
  await expect(clouds).toBeHidden();
  await expect(firelight).toHaveCount(0);
  for (const [weatherCode, weather, animation] of [
    [2, 'partly', 'none'],
    [3, 'cloud', 'none'],
    [63, 'rain', 'woodland-rain'],
    [95, 'storm', 'woodland-rain'],
    [73, 'snow', 'woodland-snow'],
  ]) {
    code = weatherCode;
    await page.evaluate(() => FrameWeather.refresh());
    await expect(stage).toHaveAttribute('data-weather', weather);
    await expect(clouds).toBeVisible();
    if (animation === 'none') await expect(precipitation).toBeHidden();
    else await expect(precipitation).toHaveCSS('animation-name', animation);
  }
  await expect(landscape).toHaveCSS('background-image', /woodland\.svg#overcast-day/);
  await expect(page.locator('.woodland-snow-cover')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Nighttime', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(landscape).toHaveCSS('background-image', /woodland\.svg#overcast-night/);
  for (const [weatherCode, weather, lights] of [[63, 'rain', 0], [95, 'storm', 0], [0, 'clear', 2]]) {
    code = weatherCode;
    await page.evaluate(() => FrameWeather.refresh());
    await expect(stage).toHaveAttribute('data-weather', weather);
    await expect(page.locator('.woodland-camp')).toBeVisible();
    await expect(firelight).toHaveCount(lights);
  }
  code = 73;
  await page.evaluate(() => FrameWeather.refresh());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(precipitation).toHaveCSS('animation-name', 'none');
});

test('TV without a location provider keeps ZIP weather and disables detection', async ({ page }) => {
  await tv(page);
  await page.addInitScript(() => { window.tizen.systeminfo.getCapability = () => false; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Local weather', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Detect location', exact: true })).toBeDisabled();
  await expect(page.locator('#modal')).toContainText('Wi-Fi positioning');
});

test('changing ZIP resolves and saves the new location', async ({ page }) => {
  await page.route('https://api.zippopotam.us/us/10001', route => route.fulfill({ json: { places: [{ 'place name': 'New York', 'state abbreviation': 'NY', latitude: '40.75', longitude: '-73.99' }] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Local weather', exact: true }).click();
  const edit = page.getByRole('button', { name: /Edit ZIP code/ });
  await page.keyboard.press('ArrowDown');
  await expect(edit).toBeFocused();
  await expect(page.getByLabel('US ZIP code')).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Save weather location' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Detect location' })).toBeFocused();
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('US ZIP code')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await expect(page.getByLabel('US ZIP code')).toBeHidden();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByLabel('US ZIP code').fill('10001');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save weather location' })).toBeFocused();
  await page.getByRole('button', { name: 'Save weather location' }).click();
  await expect(page.locator('#weather-place')).toHaveText('New York, NY');
  await page.reload();
  await expect(page.locator('#weather-place')).toHaveText('New York, NY');
});

test('switching ZIP cancels a forecast still in progress for the old location', async ({ page }) => {
  await page.route('https://api.zippopotam.us/us/10001', route => route.fulfill({ json: {
    places: [{ 'place name': 'New York', 'state abbreviation': 'NY', latitude: '40.75', longitude: '-73.99' }]
  } }));
  await page.goto('/');
  await expect(page.locator('#startup-splash')).toBeHidden();
  await page.evaluate(async () => {
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (!url.startsWith('https://api.open-meteo.com/') || !url.includes('longitude=-105.29')) return originalFetch(url, options);
      window.oldForecastSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    };
    const oldForecast = FrameWeather.refresh();
    await FrameWeather.setZip('10001');
    await oldForecast;
  });
  expect(await page.evaluate(() => window.oldForecastSignal.aborted)).toBe(true);
  await expect(page.locator('#weather-place')).toHaveText('New York, NY');
  await expect(page.locator('#weather-value')).toHaveText('73°F · Partly cloudy');
});

test('preview follows app focus without launching applications and cleans up video', async ({ page }) => {
  await tv(page, { apps: [{ id: 'tv.netflix', name: 'Netflix', show: true }, { id: 'tv.hulu', name: 'Hulu', show: true }] });
  await page.route('https://www.youtube.com/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Netflix', exact: true }).focus();
  await expect(page.locator('#app-preview')).toHaveAttribute('data-app', 'tv.netflix');
  await expect(page.locator('#app-preview .preview-details p')).toHaveText('Open Netflix to browse and play.');
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await page.getByRole('button', { name: 'Open LiveNOW from FOX', exact: true }).focus();
  await expect(page.locator('#app-preview')).toContainText('Live Channel');
  await expect(page.locator('.preview-video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await expect(page.locator('.preview-video')).toHaveCount(1);
  await expect(page.locator('.preview-video')).toHaveAttribute('src', /mute=1/);
  await page.getByRole('button', { name: 'Open Hulu', exact: true }).focus();
  await expect(page.locator('.preview-video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open selected app', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['launch', 'tv.hulu']]);
});

test('LiveNOW tile opens its official watch page', async ({ page }) => {
  await tv(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open LiveNOW from FOX', exact: true }).click();
  expect(await page.evaluate(() => window.calls)).toEqual([['appControl', null, 'http://tizen.org/appcontrol/operation/view', 'https://www.livenowfox.com/live']]);
});

test('preview source accepts a specific YouTube video and rejects unrelated websites', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'LiveNOW preview source', exact: true }).click();
  await page.getByLabel('YouTube live-video URL').fill('https://example.com/abcd1234567');
  await page.getByRole('button', { name: 'Save preview source' }).click();
  await expect(page.locator('.form-error')).toContainText('YouTube');
  await page.getByLabel('YouTube live-video URL').fill('https://www.youtube.com/watch?v=abcdefghijk');
  await page.getByRole('button', { name: 'Save preview source' }).click();
  await page.reload();
  expect(await page.evaluate(() => FramePreview.getSource())).toBe('https://www.youtube.com/watch?v=abcdefghijk');
});

test('remote rearranging persists the new order without launching an app', async ({ page }) => {
  await tv(page, { apps: [{ id: 'tv.netflix', name: 'Netflix', show: true }, { id: 'tv.hulu', name: 'Hulu', show: true }] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rearrange', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move StreamForge', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  expect(await page.locator('.app-row .app-label').allTextContents()).toEqual(['LiveNOW from FOX', 'Netflix', 'StreamForge', 'Hulu', 'All apps']);
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  await page.reload();
  expect(await page.locator('.app-row .app-label').allTextContents()).toEqual(['LiveNOW from FOX', 'Netflix', 'StreamForge', 'Hulu', 'All apps']);
});

test('dragging a tile to another position saves the order', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rearrange', exact: true }).click();
  await page.getByRole('button', { name: 'Move StreamForge', exact: true }).dragTo(page.getByRole('button', { name: 'Move Hulu', exact: true }));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await page.locator('.app-row .app-label').allTextContents())[3]).toBe('StreamForge');
  await page.reload();
  expect((await page.locator('.app-row .app-label').allTextContents())[3]).toBe('StreamForge');
});

test('home loads a single quote ticker and opens full charts on demand', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('.home-ticker')).toHaveAttribute('src', /ticker-tape.*AMEX%3ASPY/);
  await page.getByRole('button', { name: 'Open QQQ chart', exact: true }).click();
  await expect(page.locator('.market-chart')).toHaveCount(1);
  await expect(page.locator('.market-chart')).toHaveAttribute('src', /NASDAQ%3AQQQ/);
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('.market-chart')).toHaveCount(0);
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.getByText('BROWSER PREVIEW', { exact: false })).toHaveCount(0);
  await expect(page.getByText('At a glance.', { exact: true })).toHaveCount(0);
  await expect(page.locator('#theme-status')).toHaveCount(0);
});

test('the Home credit opens version history and restores focus on Back', async ({ page }) => {
  await page.goto('/');
  const credit = page.getByRole('button', { name: 'Version history', exact: true });
  await expect(credit).toContainText('Created by Mike Davis');
  await page.locator('.app-row button').first().focus();
  const initial = await credit.boundingBox();
  await page.keyboard.press('ArrowDown');
  await expect(credit).toBeFocused();
  expect(await credit.boundingBox()).toEqual(initial);
  await expect(page.locator('#focus-ring')).toBeVisible();
  await expect.poll(async () => Math.round((await page.locator('#focus-ring').boundingBox()).y)).toBe(Math.round(initial.y - 5));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await expect(dialog.getByRole('heading', { name: 'v0.1.12', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'v0.1.4', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(credit).toBeFocused();
});

test('TV Home streams FOX and focused live tiles directly with one player', async ({ page }) => {
  await tv(page);
  await page.clock.install({ time: new Date('2026-11-14T03:00:00Z') });
  await page.route('https://i.mjh.nz/SamsungTVPlus/us.xml', route => route.fulfill({ contentType: 'application/xml', body: `
    <tv><channel id="US1600002OK"><display-name>Lifetime Movies Love &amp; Drama</display-name></channel><channel id="USBC24000134A"><display-name>Midsomer Murders</display-name></channel>
    <channel id="m"><display-name>Movie Hub</display-name></channel><channel id="t"><display-name>ION</display-name></channel>
    <channel id="US18000163F"><display-name>Miramax Movie Channel</display-name></channel><channel id="USBD700011RE"><display-name>Gravitas Movies</display-name></channel>
    <channel id="US3700005GP"><display-name>BBC Drama Classics</display-name></channel><channel id="USBA2000001BR"><display-name>Baywatch</display-name></channel>
    <programme channel="m" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Artwork movie</title></programme>
    <programme channel="t" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Artwork show</title></programme>
    <programme channel="US1600002OK" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Movie feature</title></programme>
    <programme channel="US18000163F" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Miramax feature</title></programme>
    <programme channel="USBD700011RE" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Gravitas feature</title></programme>
    <programme channel="USBC24000134A" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Midsomer Murders</title></programme>
    <programme channel="US3700005GP" start="20261114020000 +0000" stop="20261114040000 +0000"><title>The Paradise</title></programme>
    <programme channel="USBA2000001BR" start="20261114020000 +0000" stop="20261114040000 +0000"><title>Baywatch</title></programme></tv>` }));
  await page.route('**/js/hls.light.min.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.Hls = class {
      static isSupported() { return true; }
      static Events = { MANIFEST_PARSED: 'ready', ERROR: 'error' };
      on() {}
      destroy() {}
      attachMedia(video) { this.video = video; }
      loadSource(url) { window.calls.push(['stream', url]); this.video.dispatchEvent(new Event('playing')); }
    };` }));
  await page.goto('/');
  const fox = page.getByRole('button', { name: 'Open LiveNOW from FOX', exact: true });
  await expect(fox.locator('.app-art video')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Live movies' }).locator('.live-card')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Live TV shows' }).locator('.live-card')).toHaveCount(3);
  await expect(page.getByText(/Artwork (movie|show)/)).toHaveCount(0);
  await expect(page.locator('.app-row').getByRole('button', { name: 'Open StreamForge', exact: true })).toBeFocused();
  await expect(page.locator('.is-playing video')).toHaveCount(1);
  const movie = page.getByRole('button', { name: /Movie feature/ });
  const show = page.getByRole('button', { name: /The Paradise/ });
  await movie.focus();
  await expect(movie.locator('video')).toBeVisible();
  await expect(fox.locator('video')).toHaveCount(0);
  await show.focus();
  await expect(show.locator('video')).toBeVisible();
  await expect(movie.locator('video')).toHaveCount(0);
  expect(await show.locator('video').evaluate(video => video.muted && video.autoplay)).toBe(true);
  const streams = await page.evaluate(() => window.calls.filter(call => call[0] === 'stream').map(call => {
    const url = new URL(call[1]);
    return [url.origin, url.searchParams.get('ads.service_id')];
  }));
  expect(streams.map(stream => stream[1])).toEqual(['USBA300024TN', 'US1600002OK', 'US3700005GP']);
  expect(streams.every(stream => /^https:\/\/[^/]+\.akamaized\.net$/.test(stream[0]))).toBe(true);
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.is-playing video')).toHaveCount(1);
});

test('Home opens the paired Robinhood portfolio with a chart and switches to the watchlist', async ({ page }) => {
  await page.addInitScript(() => {
    window.FramePortfolioConfig = { url: '/fixture-portfolio', token: 'display-test' };
  });
  await page.route('**/fixture-portfolio**', route => {
    expect(route.request().headers().authorization).toBe('Bearer display-test');
    if (new URL(route.request().url()).pathname.endsWith('/history')) {
      return route.fulfill({
        json: { status: 'connected', points: [[1792108800000, 80], [1794441600000, 100], [1794528000000, 120]] },
      });
    }
    return route.fulfill({
      json: { status: 'connected', currency: 'USD', total: 123.45, asOf: 1794528000000, checkedAt: 1794622979000, freshness: 'realtime' },
    });
  });
  await page.goto('/');
  await expect(page.locator('#portfolio-status')).toHaveText('$123.45');
  await expect(page.locator('#portfolio-detail')).toContainText('Checked');
  await expect(page.locator('#portfolio-change')).toHaveText('+50%');
  await expect(page.locator('#portfolio-chart polyline')).toBeVisible();
  await expect(page.locator('#portfolio-chart .portfolio-chart-grid')).toHaveAttribute('d', /^M\d+ \d+H\d+/);
  await expect(page.locator('#portfolio-chart text').filter({ hasText: /^\$/ })).toHaveCount(3);
  await expect(page.locator('#portfolio-chart text').filter({ hasText: /^[A-Z][a-z]{2} \d+$/ })).toHaveCount(3);
  await page.getByRole('button', { name: '1W', exact: true }).click();
  await expect(page.locator('#portfolio-change')).toHaveText('+20%');
  await page.getByRole('button', { name: 'Watchlist', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Home watchlist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Robinhood', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#portfolio-chart polyline')).toBeVisible();
  await page.getByRole('button', { name: 'Hide portfolio', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Show portfolio', exact: true })).toBeFocused();
  await expect(page.locator('.home-ticker')).toBeVisible();
  await expect(page.locator('#portfolio-status, #portfolio-chart')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.app-row').getByRole('button', { name: 'Open StreamForge', exact: true })).toBeFocused();
  await expect(page.locator('#portfolio-status, #portfolio-chart')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Markets', exact: true }).click();
  await expect(page.getByRole('button', { name: /Robinhood/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.app-row').getByRole('button', { name: 'Open StreamForge', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Show portfolio', exact: true }).click();
  await expect(page.locator('#portfolio-status')).toHaveText('$123.45');
});

test('Art navigation offers Woodland and Samsung Art options', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Art', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Woodland', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Samsung Art options', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('SmartThings or USB');
  await expect(page.getByRole('dialog')).toContainText('full selection requires Art Store membership');
});
