const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(__dirname, 'desktop-web', reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found: ' + reqPath);
  }
});

server.listen(4008, async () => {
  console.log('Test server running at http://localhost:4008');
  try {
    const iPhone = devices['iPhone 14 Pro'] || {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    };

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...iPhone });
    const page = await context.newPage();
    await page.goto('http://localhost:4008/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Dismiss account modal if it appears
    try {
      const closeBtn = await page.$('#btn-close-account-modal');
      if (closeBtn && await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    } catch (_) {}

    const dir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 1. Favorites Tab
    await page.click('#nav-favorites');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, 'flow-favorites.png') });
    console.log('Saved flow-favorites.png');

    // 2. Albums Tab
    await page.click('#nav-albums');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, 'flow-albums.png') });
    console.log('Saved flow-albums.png');

    // 3. Settings Tab
    await page.click('#nav-settings');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, 'flow-settings.png') });
    console.log('Saved flow-settings.png');

    // 4. Back to Listen Now
    await page.click('#nav-discover');
    await page.waitForTimeout(400);

    // 5. Test Search
    await page.fill('#mobile-search-input', 'Evergrey');
    await page.press('#mobile-search-input', 'Enter');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, 'flow-search.png') });
    console.log('Saved flow-search.png');

    // Clear search
    await page.click('#mobile-search-clear');
    await page.waitForTimeout(300);

    // 6. Simulate a track playing with metadata, morphing artwork & ambient glow
    await page.evaluate(() => {
      const track = {
        title: 'Escape of the Phoenix',
        artist: 'Evergrey',
        album: 'Escape of the Phoenix (2021)',
        thumbnail: 'assets/icon-512x512.png'
      };
      window.state = window.state || {};
      window.state.isPlaying = true;
      window.state.currentTrack = track;

      const titleEl = document.getElementById('playbar-title');
      const artistEl = document.getElementById('playbar-artist');
      const rpTitle = document.getElementById('right-panel-title');
      const rpArtist = document.getElementById('right-panel-artist');
      const pbArt = document.getElementById('playbar-artwork');
      const pbCover = document.getElementById('playbar-cover');
      const rpCover = document.getElementById('right-panel-cover');
      const rpFallback = document.getElementById('right-panel-fallback');

      if (titleEl) titleEl.textContent = track.title;
      if (artistEl) artistEl.textContent = track.artist;
      if (rpTitle) rpTitle.textContent = track.title;
      if (rpArtist) rpArtist.textContent = track.artist;
      if (pbArt) { pbArt.src = track.thumbnail; pbArt.style.display = 'block'; }
      if (pbCover) { pbCover.src = track.thumbnail; pbCover.classList.remove('hidden'); }
      if (rpCover) { rpCover.src = track.thumbnail; rpCover.style.display = 'block'; rpCover.classList.remove('hidden'); }
      if (rpFallback) { rpFallback.style.display = 'none'; }

      document.body.classList.add('is-playing', 'm3-cover-on', 'm3-hero-covers-on');

      if (typeof window.m3cSetImage === 'function') window.m3cSetImage(track.thumbnail);
      if (typeof window.applyM3Cover === 'function') window.applyM3Cover();
      if (typeof window.m3cStart === 'function') window.m3cStart();
      if (typeof window.setCoverBg === 'function') window.setCoverBg(track.thumbnail);
      if (typeof window.setHomeAmbient === 'function') window.setHomeAmbient(track.thumbnail);

      document.getElementById('playbar').style.setProperty('--mini-progress', '0.35');
    });

    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(dir, 'flow-playing-mini.png') });
    console.log('Saved flow-playing-mini.png');

    // 7. Open Now Playing Sheet with morphing squircle cover
    await page.evaluate(() => {
      document.getElementById('playbar').click();
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(dir, 'flow-playing-sheet.png') });
    console.log('Saved flow-playing-sheet.png');

    // 8. Toggle Vinyl Record Mode inside sheet
    await page.evaluate(() => {
      const vBtn = document.getElementById('np-vinyl-btn');
      if (vBtn) vBtn.click();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, 'flow-playing-vinyl.png') });
    console.log('Saved flow-playing-vinyl.png');

    await browser.close();
  } catch (err) {
    console.error(err);
  } finally {
    server.close();
  }
});
