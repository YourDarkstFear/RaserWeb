const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
  });
  const page = await context.newPage();

  page.on('console', msg => console.log(`[CONSOLE]:`, msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]:', err));

  page.on('response', res => {
    if (res.url().includes('audio') || res.url().includes('stream') || res.status() >= 400) {
      console.log('[RESP]:', res.status(), res.url().slice(0, 100));
    }
  });

  await page.goto('https://app.raserapp.online/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Close modal if present
  try {
    await page.click('#btn-close-account-modal', { timeout: 1000 });
  } catch (_) {}

  // Fill mobile search
  console.log('Searching via #mobile-search-input...');
  await page.fill('#mobile-search-input', 'queen bohemian');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  // Click first track item in search results
  const trackFound = await page.evaluate(() => {
    const item = document.querySelector('.search-result-item, .track-item, .item, [data-track-id]');
    if (item) {
      item.click();
      return item.textContent.slice(0, 50);
    }
    return null;
  });
  console.log('Track clicked:', trackFound);

  // Monitor audio element for 15 seconds
  for (let sec = 0; sec < 15; sec++) {
    await page.waitForTimeout(1000);
    const audioState = await page.evaluate((s) => {
      const audio = document.querySelector('audio');
      return {
        s,
        src: audio?.src?.slice(0, 80),
        paused: audio?.paused,
        currentTime: audio?.currentTime,
        duration: audio?.duration,
        readyState: audio?.readyState,
        buffered: audio?.buffered?.length ? audio.buffered.end(0) : 0,
        networkState: audio?.networkState
      };
    }, sec);
    console.log(`[STATUS t=${sec+1}]`, audioState);
  }

  await browser.close();
})();
