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

server.listen(3999, async () => {
  console.log('Test server running at http://localhost:3999');
  try {
    const iPhone = devices['iPhone 14 Pro'] || {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    };

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      ...iPhone,
    });
    const page = await context.newPage();
    await page.goto('http://localhost:3999/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Dismiss account modal if it appears
    try {
      const closeBtn = await page.$('#btn-close-account-modal');
      if (closeBtn && await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      } else {
        const guestBtn = await page.$('#btn-guest-login');
        if (guestBtn && await guestBtn.isVisible()) {
          await guestBtn.click();
          await page.waitForTimeout(500);
        }
      }
    } catch (e) {
      console.log('Modal dismiss notice:', e.message);
    }

    const info = await page.evaluate(() => {
      const getBox = sel => {
        const el = document.querySelector(sel);
        if (!el) return sel + ' not found';
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          sel,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          zIndex: style.zIndex,
          position: style.position,
          top: style.top,
          bottom: style.bottom,
          left: style.left,
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          childrenCount: el.children.length,
          innerHTMLPreview: el.innerHTML.slice(0, 100)
        };
      };
      return {
        htmlClasses: document.documentElement.className,
        bodyClasses: document.body.className,
        titlebar: getBox('.titlebar'),
        sidebar: getBox('.sidebar'),
        sidebarNav: getBox('.sidebar-nav'),
        mainContent: getBox('#main-content'),
        appLayout: getBox('.app-layout'),
        playbar: getBox('#playbar'),
        views: Array.from(document.querySelectorAll('.view')).map(v => ({ id: v.id, className: v.className, display: window.getComputedStyle(v).display, h: v.getBoundingClientRect().height }))
      };
    });
    console.log('DOM Info:', JSON.stringify(info, null, 2));

    const dir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Take home screenshot first
    await page.screenshot({ path: path.join(dir, 'test-home.png') });
    console.log('Saved screenshots/test-home.png');

    // Test clicking playbar to open Now Playing sheet
    await page.evaluate(() => {
      const pb = document.getElementById('playbar');
      if (pb) pb.click();
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(dir, 'test-np-sheet.png') });
    console.log('Saved screenshots/test-np-sheet.png');

    await browser.close();
  } catch (err) {
    console.error(err);
  } finally {
    server.close();
  }
});
