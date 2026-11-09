// Mobile layout behaviour: Raser Material You Header, Tab Bar, Floating Mini Player, Animated Covers & Gestures.

(function initMobileDetection() {
  function checkMobile() {
    const isMobile = window.innerWidth <= 840 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    document.documentElement.classList.toggle('is-mobile', isMobile);
    if (!isMobile) {
      document.body.classList.remove('np-open');
    }
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);
  window.addEventListener('orientationchange', checkMobile);
})();

(function initMobileDefaults() {
  const isMobile = window.innerWidth <= 840 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (isMobile) {
    document.documentElement.style.setProperty('--font-scale', '1.0');
    document.body.style.zoom = '1';
    document.body.classList.remove('mini');
    document.body.classList.add('perf');
    try { localStorage.setItem('riff_perf_mode', '1'); } catch (_) {}
    if (typeof window.applyPerfMode === 'function') window.applyPerfMode(true);

    // Enable Raser's signature morphing Material 3 squircle covers by default
    if (localStorage.getItem('riff_m3_cover') !== '0') {
      document.body.classList.add('m3-cover-on');
    }
    if (localStorage.getItem('riff_m3_hero_covers') !== '0') {
      document.body.classList.add('m3-hero-covers-on');
    }

    const startAnims = () => {
      if (typeof window.applyM3Cover === 'function') window.applyM3Cover();
      if (typeof window.m3cStart === 'function') window.m3cStart();
    };
    if (document.readyState === 'complete') {
      startAnims();
    } else {
      window.addEventListener('load', startAnims);
    }
  }
})();

(function initMobileTabs() {
  function setupTabs() {
    const isMobile = window.innerWidth <= 840 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (!isMobile) return;

    // Ensure Home has correct title
    const disc = document.getElementById('nav-discover');
    if (disc) disc.setAttribute('title', 'Home');

    // Ensure Raser SVG app icon is visible on the Home tab
    const raserIcon = document.getElementById('nav-home-app-icon');
    if (raserIcon) {
      raserIcon.style.display = 'block';
      raserIcon.style.visibility = 'visible';
    }

    // Add real nav-label spans to all sidebar items for clean Material 3 tab bar
    const navItems = document.querySelectorAll('.sidebar .nav-item');
    navItems.forEach(item => {
      let label = item.querySelector('.nav-label');
      if (!label) {
        label = document.createElement('span');
        label.className = 'nav-label';
        item.appendChild(label);
      }
      label.textContent = item.getAttribute('title') || '';

      item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        if (navigator.vibrate) navigator.vibrate(6);
      });
    });

    // Keep bottom tab active states strictly in sync with the active view
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      const syncActiveTab = () => {
        const activeView = mainContent.querySelector('.content-view.active');
        if (!activeView) return;
        const viewId = activeView.id.replace(/^view-/, '');
        navItems.forEach(item => {
          const itemKey = item.getAttribute('data-view') || (item.id === 'nav-discover' ? 'discover' : item.id.replace(/^nav-/, ''));
          item.classList.toggle('active', itemKey === viewId);
        });
      };
      new MutationObserver(syncActiveTab).observe(mainContent, { attributes: true, subtree: true, attributeFilter: ['class'] });
      syncActiveTab();
    }

    // Avoid duplicate "Home" title right under mobile header
    const spQuickTitle = document.querySelector('#sp-quick-sec h2 span');
    if (spQuickTitle && spQuickTitle.textContent.trim() === 'Home') {
      spQuickTitle.textContent = 'Quick play';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTabs);
  } else {
    setupTabs();
  }
})();

(function initMobileHeader() {
  function setupHeader() {
    const mobileHeader = document.getElementById('mobile-header');
    const pageTitle = document.getElementById('mobile-page-title');
    const brandLogo = document.querySelector('.mobile-brand-logo');
    const mobileSearchInput = document.getElementById('mobile-search-input');
    const mobileSearchClear = document.getElementById('mobile-search-clear');
    const mobileAccountBtn = document.getElementById('mobile-btn-account');
    const realSearchInput = document.getElementById('search-input');
    const realAccountBtn = document.getElementById('btn-account-pill');
    const avatarCircle = document.getElementById('mobile-avatar-circle');
    const realAvatarImg = document.getElementById('account-avatar-img');
    const mobileSyncDot = document.getElementById('mobile-sync-dot');
    const realSyncDot = document.getElementById('cloud-sync-dot');

    if (!mobileHeader) return;

    // View title map (Raser Material You typography)
    const titleMap = {
      'discover': 'Home',
      'favorites': 'Favorites',
      'albums': 'Albums',
      'queue': 'Queue',
      'settings': 'Settings',
      'history': 'History',
      'album': 'Album',
      'artist': 'Artist',
      'playlist-detail': 'Playlist'
    };

    function updateTitle(viewId) {
      if (!pageTitle) return;
      const cleanId = (viewId || '').replace(/^view-/, '');
      const t = titleMap[cleanId] || (cleanId ? cleanId.charAt(0).toUpperCase() + cleanId.slice(1) : 'Home');
      pageTitle.textContent = t;
      if (brandLogo) {
        brandLogo.style.display = (cleanId === 'discover' || cleanId === 'home' || !cleanId) ? 'block' : 'none';
      }
      const searchRow = mobileHeader.querySelector('.mobile-search-row');
      if (searchRow) {
        searchRow.style.display = (cleanId === 'discover' || cleanId === 'home' || !cleanId) ? 'block' : 'none';
      }
    }

    // Observe active view changes
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      const viewObserver = new MutationObserver(() => {
        const activeView = mainContent.querySelector('.content-view.active');
        if (activeView) updateTitle(activeView.id);
      });
      viewObserver.observe(mainContent, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    // Sync sidebar click to update title immediately
    const navItems = document.querySelectorAll('.sidebar .nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view) updateTitle(view);
      });
    });

    // Account avatar and sync status sync
    if (mobileAccountBtn && realAccountBtn) {
      mobileAccountBtn.addEventListener('click', (e) => {
        e.preventDefault();
        realAccountBtn.click();
      });

      if (realAvatarImg && avatarCircle) {
        const syncAvatar = () => {
          if (!realAvatarImg.classList.contains('hidden') && realAvatarImg.src) {
            let img = avatarCircle.querySelector('img');
            if (!img) {
              img = document.createElement('img');
              img.className = 'mobile-avatar-img';
              img.alt = '';
              avatarCircle.innerHTML = '';
              avatarCircle.appendChild(img);
            }
            img.src = realAvatarImg.src;
          }
        };
        new MutationObserver(syncAvatar).observe(realAvatarImg, { attributes: true, attributeFilter: ['src', 'class'] });
        syncAvatar();
      }

      if (realSyncDot && mobileSyncDot) {
        const syncDot = () => {
          mobileSyncDot.className = 'mobile-sync-dot ' + realSyncDot.className.replace('cloud-sync-dot', '').trim();
        };
        new MutationObserver(syncDot).observe(realSyncDot, { attributes: true, attributeFilter: ['class'] });
        syncDot();
      }
    }

    // Search input sync
    if (mobileSearchInput && realSearchInput) {
      mobileSearchInput.addEventListener('input', () => {
        const val = mobileSearchInput.value;
        if (mobileSearchClear) mobileSearchClear.classList.toggle('hidden', !val);
        realSearchInput.value = val;
        realSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      mobileSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          realSearchInput.value = mobileSearchInput.value;
          realSearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
      });

      if (mobileSearchClear) {
        mobileSearchClear.addEventListener('click', () => {
          mobileSearchInput.value = '';
          mobileSearchClear.classList.add('hidden');
          realSearchInput.value = '';
          realSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
          mobileSearchInput.focus();
        });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupHeader);
  } else {
    setupHeader();
  }
})();

(function initMobilePlayerUI() {
  function setup() {
    const panel = document.getElementById('right-panel');
    const playbar = document.getElementById('playbar');
    const audio = document.querySelector('audio');
    if (!panel || !playbar) return;

    // Right-panel starts closed (hidden) on mobile
    if (window.innerWidth <= 840 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
      panel.classList.add('hidden');
      document.body.classList.remove('np-open');
      document.body.classList.add('perf');
      localStorage.setItem('riff_perf_mode', '1');
      if (typeof window.applyPerfMode === 'function') window.applyPerfMode(true);
      const btnPerf = document.getElementById('btn-perf-mode');
      if (btnPerf) btnPerf.classList.add('active');
    }

    const openSheet = () => {
      panel.classList.remove('hidden');
      document.body.classList.add('np-open');
      if (window.state) window.state.isRightPanelOpen = true;
      if (typeof window.applyM3Cover === 'function') window.applyM3Cover();
      if (typeof window.m3cStart === 'function') window.m3cStart();
      if (typeof window.resizeCanvases === 'function') window.resizeCanvases();
      if (typeof window.updateLyricsPadding === 'function') window.updateLyricsPadding();
      if (typeof window.updateSyncedLyricsHighlight === 'function' && audio) {
        window.updateSyncedLyricsHighlight(audio.currentTime || 0);
      }
      window.dispatchEvent(new Event('resize'));
      const pbArt = document.getElementById('playbar-artwork');
      const thumb = (window.state && window.state.currentTrack && window.state.currentTrack.thumbnail) || (pbArt && pbArt.src);
      if (thumb && typeof window.updateRightPanelBanner === 'function') {
        window.updateRightPanelBanner(thumb);
      }
      if (navigator.vibrate) navigator.vibrate(8);
    };

    const closeSheet = () => {
      panel.classList.add('hidden');
      document.body.classList.remove('np-open');
    };

    // Tapping mini player (outside play/next buttons) opens the Now Playing sheet
    playbar.addEventListener('click', (e) => {
      const isMob = window.innerWidth <= 840 || document.documentElement.classList.contains('is-mobile');
      if (!isMob) return;
      if (document.body.classList.contains('np-open')) return;
      if (e.target.closest('#btn-play-pause, #btn-next, input[type="range"], .scrubber-bar-wrapper')) return;
      openSheet();
    });

    // Close button inside sheet
    const closeBtn = document.getElementById('btn-close-right-panel');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSheet();
      });
    }

    // Top drag handle click closes sheet
    panel.addEventListener('click', (e) => {
      if (!document.body.classList.contains('np-open')) return;
      const rect = panel.getBoundingClientRect();
      if (e.clientY - rect.top < 44 && !e.target.closest('button, a, input')) {
        closeSheet();
      }
    });

    // Swipe down on Now Playing sheet to close
    let startY = null;
    panel.addEventListener('touchstart', (e) => {
      if (!document.body.classList.contains('np-open')) return;
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
      if (startY === null || !document.body.classList.contains('np-open')) return;
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
      if (startY === null || !document.body.classList.contains('np-open')) return;
      const dy = e.changedTouches[0].clientY - startY;
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      panel.classList.remove('is-dragging');
      panel.style.transform = '';
      startY = null;
      if (dy > 90) closeSheet();
    });

    // Action buttons inside Now Playing sheet (Vinyl record mode toggle + Favorite like)
    const realFav = document.getElementById('btn-toggle-fav');
    const favIcon = document.getElementById('fav-icon');
    const titleRow = panel.querySelector('.right-panel-title-row');

    if (titleRow) {
      let actionsWrap = titleRow.querySelector('.np-title-actions');
      if (!actionsWrap) {
        actionsWrap = document.createElement('div');
        actionsWrap.className = 'np-title-actions';
        titleRow.appendChild(actionsWrap);
      }

      // Vinyl Record Mode Toggle Button
      if (!actionsWrap.querySelector('#np-vinyl-btn')) {
        const vinylBtn = document.createElement('button');
        vinylBtn.id = 'np-vinyl-btn';
        vinylBtn.type = 'button';
        vinylBtn.title = 'Vinyl Record Mode';
        vinylBtn.setAttribute('aria-label', 'Vinyl Record Mode');
        vinylBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 0 0-4 18.5"/></svg>`;

        const coverBox = document.getElementById('cover-container');
        const vinylOverlay = document.getElementById('vinyl-overlay');

        const updateVinylUI = () => {
          const isVinyl = !!(window.state && window.state.vfx && window.state.vfx.vinylSpin) || (coverBox && coverBox.classList.contains('vinyl-mode'));
          vinylBtn.classList.toggle('active', isVinyl);
          if (vinylOverlay) vinylOverlay.classList.toggle('hidden', !isVinyl);
          if (coverBox) {
            coverBox.classList.toggle('vinyl-mode', isVinyl);
            if (window.state && window.state.isPlaying) coverBox.classList.toggle('spinning', isVinyl);
          }
          document.body.classList.toggle('m3-hero-covers-on', !isVinyl);
        };

        vinylBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.state && window.state.vfx) {
            window.state.vfx.vinylSpin = !window.state.vfx.vinylSpin;
            if (typeof window.updateVisualEffects === 'function') window.updateVisualEffects();
          } else if (coverBox) {
            coverBox.classList.toggle('vinyl-mode');
          }
          updateVinylUI();
          if (typeof window.m3cStart === 'function') window.m3cStart();
          if (navigator.vibrate) navigator.vibrate(12);
        });

        actionsWrap.appendChild(vinylBtn);
        updateVinylUI();
      }

      // Like button next to title in Now Playing
      if (realFav && favIcon && !actionsWrap.querySelector('#np-like')) {
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
        actionsWrap.appendChild(like);
        mirror();
      }
    }

    // Swipe cover left/right to skip track
    const cover = document.getElementById('cover-container');
    if (cover) {
      let x0 = null, y0 = null, dx = 0, horizontal = null;
      cover.addEventListener('touchstart', (e) => {
        if (!document.body.classList.contains('np-open')) return;
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        dx = 0;
        horizontal = null;
        cover.style.transition = 'none';
      }, { passive: true });

      cover.addEventListener('touchmove', (e) => {
        if (x0 === null || !document.body.classList.contains('np-open')) return;
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
        if (x0 === null || !document.body.classList.contains('np-open')) return;
        x0 = null;
        cover.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1), opacity .32s';
        if (horizontal && Math.abs(dx) > 60) {
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

    // Touch scrubbing on Raser wavy progress bar in Now Playing sheet
    const scrubberTrack = document.getElementById('scrubber-track');
    if (scrubberTrack && audio) {
      const seekFromTouch = (touch) => {
        const rect = scrubberTrack.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        if (isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = pos * audio.duration;
          const curr = document.getElementById('time-current');
          if (curr) {
            const m = Math.floor(audio.currentTime / 60);
            const s = Math.floor(audio.currentTime % 60);
            curr.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
          }
          if (typeof window.resizeCanvases === 'function') window.resizeCanvases();
        }
      };

      scrubberTrack.addEventListener('touchstart', (e) => {
        if (!document.body.classList.contains('np-open')) return;
        e.stopPropagation();
        seekFromTouch(e.touches[0]);
      }, { passive: false });

      scrubberTrack.addEventListener('touchmove', (e) => {
        if (!document.body.classList.contains('np-open')) return;
        e.stopPropagation();
        e.preventDefault();
        seekFromTouch(e.touches[0]);
      }, { passive: false });

      scrubberTrack.addEventListener('touchend', (e) => {
        if (!document.body.classList.contains('np-open')) return;
        e.stopPropagation();
        if (e.changedTouches && e.changedTouches[0]) seekFromTouch(e.changedTouches[0]);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
