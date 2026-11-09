// Mobile layout behaviour: mini player <-> now-playing sheet, swipe gestures, and responsive adaptation.

(function initMobileDetection() {
  function checkMobile() {
    const isMobile = window.innerWidth <= 840 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    document.documentElement.classList.toggle('is-mobile', isMobile);
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);
  window.addEventListener('orientationchange', checkMobile);
})();

(function initMobileDefaults() {
  const isMobile = window.innerWidth <= 840 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobile && !localStorage.getItem('riff_font_scale')) {
    localStorage.setItem('riff_font_scale', '80');
    document.documentElement.style.setProperty('--font-scale', '0.8');
  }
})();

(function initMobilePlayerUI() {
  function setup() {
    const panel = document.getElementById('right-panel');
    const playbar = document.getElementById('playbar');
    const lyricsBtn = document.getElementById('btn-toggle-lyrics-panel');
    const audio = document.querySelector('audio');
    if (!panel || !playbar) return;

    // Mirror drawer state onto <body> so CSS can switch styles
    const sync = () => document.body.classList.toggle('np-open', !panel.classList.contains('hidden'));
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    sync();

    const openSheet = () => {
      if (panel.classList.contains('hidden')) {
        if (lyricsBtn) lyricsBtn.click();
        else panel.classList.remove('hidden');
      }
    };
    const closeSheet = () => {
      if (!panel.classList.contains('hidden')) {
        const closeBtn = document.getElementById('btn-close-right-panel');
        if (closeBtn) closeBtn.click();
        else panel.classList.add('hidden');
      }
    };

    // Tapping mini player (but not buttons or slider) opens the now-playing sheet
    playbar.addEventListener('click', (e) => {
      if (document.body.classList.contains('np-open')) return;
      if (e.target.closest('button, input, .scrubber-track-container, .scrubber-bar-wrapper')) return;
      openSheet();
    });

    // Swipe down on now-playing sheet to close
    let startY = null;
    panel.addEventListener('touchstart', (e) => {
      if (!document.documentElement.classList.contains('is-mobile')) return;
      const t = e.touches[0];
      const lyrics = document.getElementById('lyrics-container');
      if (e.target.closest('input[type="range"], .scrubber-track-container, [role="slider"]')) {
        startY = null;
        return;
      }
      startY = (lyrics && lyrics.contains(e.target) && lyrics.scrollTop > 0) ? null : t.clientY;
    }, { passive: true });

    let dragY = 0, dragRaf = 0;
    panel.addEventListener('touchmove', (e) => {
      if (startY === null || !document.documentElement.classList.contains('is-mobile')) return;
      dragY = Math.max(0, e.touches[0].clientY - startY);
      if (dragY > 0 && !panel.classList.contains('is-dragging')) panel.classList.add('is-dragging');
      if (!dragRaf) {
        dragRaf = requestAnimationFrame(() => {
          dragRaf = 0;
          if (startY !== null) panel.style.transform = dragY > 0 ? `translateY(${dragY}px)` : '';
        });
      }
    }, { passive: true });

    panel.addEventListener('touchend', (e) => {
      if (startY === null || !document.documentElement.classList.contains('is-mobile')) return;
      const dy = e.changedTouches[0].clientY - startY;
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      panel.classList.remove('is-dragging');
      panel.style.transform = '';
      startY = null;
      if (dy > 110) closeSheet();
    });

    // Like button next to title in Now Playing
    const realFav = document.getElementById('btn-toggle-fav');
    const favIcon = document.getElementById('fav-icon');
    const titleRow = panel.querySelector('.right-panel-title-row');
    if (realFav && favIcon && titleRow && !document.getElementById('np-like')) {
      const like = document.createElement('button');
      like.id = 'np-like';
      like.type = 'button';
      like.setAttribute('aria-label', 'Like');
      like.innerHTML = favIcon.outerHTML.replace('id="fav-icon"', '');
      const mirror = () => {
        const on = favIcon.getAttribute('fill') === 'currentColor';
        like.classList.toggle('on', on);
        const svg = like.querySelector('svg');
        if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
      };
      like.addEventListener('click', () => {
        realFav.click();
        like.classList.remove('pop');
        void like.offsetWidth;
        like.classList.add('pop');
        if (navigator.vibrate) navigator.vibrate(12);
      });
      new MutationObserver(mirror).observe(favIcon, { attributes: true, attributeFilter: ['fill'] });
      titleRow.appendChild(like);
      mirror();
    }

    // Swipe cover left/right to skip track
    const cover = document.getElementById('cover-container');
    if (cover) {
      let x0 = null, y0 = null, dx = 0, horizontal = null;
      cover.addEventListener('touchstart', (e) => {
        if (!document.documentElement.classList.contains('is-mobile')) return;
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        dx = 0;
        horizontal = null;
        cover.style.transition = 'none';
      }, { passive: true });

      cover.addEventListener('touchmove', (e) => {
        if (x0 === null || !document.documentElement.classList.contains('is-mobile')) return;
        dx = e.touches[0].clientX - x0;
        const dy = e.touches[0].clientY - y0;
        if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          horizontal = Math.abs(dx) > Math.abs(dy);
        }
        if (horizontal) {
          cover.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
        }
      }, { passive: true });

      cover.addEventListener('touchend', () => {
        if (x0 === null || !document.documentElement.classList.contains('is-mobile')) return;
        x0 = null;
        cover.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1), opacity .32s';
        if (horizontal && Math.abs(dx) > 70) {
          const dir = dx < 0 ? -1 : 1;
          cover.style.transform = `translateX(${dir * window.innerWidth}px) rotate(${dir * 12}deg)`;
          cover.style.opacity = '0';
          if (navigator.vibrate) navigator.vibrate(10);
          setTimeout(() => {
            const nextBtn = document.getElementById('btn-next');
            const prevBtn = document.getElementById('btn-prev');
            if (dir < 0 && nextBtn) nextBtn.click();
            else if (prevBtn) prevBtn.click();
            cover.style.transition = 'none';
            cover.style.transform = `translateX(${-dir * 60}px)`;
            requestAnimationFrame(() => {
              cover.style.transition = 'transform .38s cubic-bezier(.2,.8,.2,1), opacity .38s';
              cover.style.transform = '';
              cover.style.opacity = '';
            });
          }, 220);
        } else {
          cover.style.transform = '';
        }
      });
    }

    // Mini player thin bottom progress line
    if (audio) {
      const tick = () => {
        if (document.hidden) return;
        const p = audio.duration ? audio.currentTime / audio.duration : 0;
        playbar.style.setProperty('--mini-progress', String(Math.max(0, Math.min(1, p))));
      };
      audio.addEventListener('timeupdate', tick);
      audio.addEventListener('emptied', tick);
      document.addEventListener('visibilitychange', tick);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
