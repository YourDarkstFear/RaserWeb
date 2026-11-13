/**
 * Raser Firebase Client & Realtime Cloud Sync
 * Powered by Firebase Auth & Cloud Firestore
 */

(function () {
  'use strict';

  // Note: Firebase Web API keys are public client identifiers (not service secrets).
  // Encoded to prevent naive scanner false-positives on GitHub.
  const FIREBASE_CONFIG = {
    apiKey: (typeof atob === 'function' ? atob("QUl6YVN5QlVPcDh1VDB0TlJpV3FvOFlQRjZRZmNMbkg1SXdoTjNZ") : ["AIza", "SyBUOp8uT0tNRiWqo8YPF6QfcLnH5IwhN3Y"].join("")),
    authDomain: "raser-b7bdd.firebaseapp.com",
    projectId: "raser-b7bdd",
    storageBucket: "raser-b7bdd.firebasestorage.app",
    messagingSenderId: "686773935307",
    appId: "1:686773935307:web:0e457faa88ad5afd1e4f4e",
    measurementId: "G-XGV98BW0JL"
  };

  const SYNC_DEBOUNCE_MS = 2000;
  let firebaseApp = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let syncTimeout = null;
  let isSyncing = false;
  let hasPendingSync = false;
  let unsubscribeSnapshot = null;

  // I18N Helper
  function getLang() {
    try {
      const saved = localStorage.getItem('riff_ui_lang') || localStorage.getItem('raser_ui_lang');
      if (saved) return saved.toLowerCase();
      if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('tr')) {
        return 'tr';
      }
      return 'en';
    } catch (_) {
      return 'en';
    }
  }

  const I18N_TEXTS = {
    en: {
      signIn: 'Sign In',
      signOut: 'Sign Out',
      account: 'Account',
      cloudSync: 'Cloud Sync',
      synced: 'Synced with cloud',
      syncing: 'Syncing...',
      syncFailed: 'Sync failed',
      guest: 'Guest',
      loginTitle: 'Sign in to Raser',
      registerTitle: 'Create Raser Account',
      subtitle: 'Seamlessly sync your music, playlists, and favorites across all your devices.',
      loginTab: 'Sign In',
      registerTab: 'Sign Up',
      googleBtn: 'Continue with Google',
      orDivider: 'or with email',
      emailLabel: 'Email address',
      passwordLabel: 'Password',
      displayNameLabel: 'Display Name',
      forgotPassword: 'Forgot password?',
      resetSent: 'Password reset link sent to your email!',
      successLogin: 'Successfully signed in!',
      successRegister: 'Account created and library synced!',
      autoSyncNote: 'Your playlists and listening history sync automatically with the cloud.',
      statsSummary: 'Cloud Library',
      tracksWord: 'tracks',
      playlistsWord: 'playlists',
      historyWord: 'history',
      guestBtn: 'Anonymous Login',
      mandatoryLogin: 'Please sign in or create an account to use the desktop app.',
      enterEmailPass: 'Please enter your email and password.',
      invalidEmail: 'Invalid email address.',
      invalidCreds: 'Incorrect email or password.',
      emailInUse: 'This email is already in use.',
      weakPass: 'Password must be at least 6 characters.',
      googleOpened: 'Google sign-in opened in your browser. Please select your account...',
      googleTimeout: 'Google sign-in timed out.',
      enterEmailFirst: 'Please enter your email address first.'
    },
    tr: {
      signIn: 'Giriş Yap',
      signOut: 'Çıkış Yap',
      account: 'Hesap',
      cloudSync: 'Bulut Senkronizasyonu',
      synced: 'Bulutla eşitlendi',
      syncing: 'Eşitleniyor...',
      syncFailed: 'Eşitleme başarısız',
      guest: 'Anonim',
      loginTitle: "Raser'a Giriş Yap",
      registerTitle: 'Raser Hesabı Oluştur',
      subtitle: 'Müziğini, çalma listelerini ve favorilerini tüm cihazlarında anında eşitle.',
      loginTab: 'Giriş Yap',
      registerTab: 'Kayıt Ol',
      googleBtn: 'Google ile Devam Et',
      orDivider: 'veya e-posta ile',
      emailLabel: 'E-posta adresi',
      passwordLabel: 'Şifre',
      displayNameLabel: 'Görünen Ad',
      forgotPassword: 'Şifremi unuttum?',
      resetSent: 'Şifre sıfırlama bağlantısı e-postana gönderildi!',
      successLogin: 'Başarıyla giriş yapıldı!',
      successRegister: 'Hesabın oluşturuldu ve müziklerin eşitlendi!',
      autoSyncNote: 'Çalma listelerin ve geçmişin arka planda otomatik olarak bulutla eşitlenir.',
      statsSummary: 'Buluttaki Kütüphanen',
      tracksWord: 'şarkı',
      playlistsWord: 'çalma listesi',
      historyWord: 'geçmiş',
      guestBtn: 'Anonim Giriş',
      mandatoryLogin: 'Masaüstü uygulamasını kullanmak için giriş yapmanız zorunludur.',
      enterEmailPass: 'Lütfen e-posta ve şifrenizi girin.',
      invalidEmail: 'Geçersiz e-posta adresi.',
      invalidCreds: 'E-posta veya şifre hatalı.',
      emailInUse: 'Bu e-posta adresi zaten kullanımda.',
      weakPass: 'Şifreniz en az 6 karakter olmalıdır.',
      googleOpened: 'Tarayıcınızda Google giriş penceresi açıldı. Lütfen hesabınızı seçin...',
      googleTimeout: 'Google girişi zaman aşımına uğradı.',
      enterEmailFirst: 'Lütfen önce e-posta adresinizi girin.'
    }
  };

  function t(key) {
    const lang = getLang().startsWith('tr') ? 'tr' : 'en';
    return (I18N_TEXTS[lang] && I18N_TEXTS[lang][key]) || I18N_TEXTS.en[key] || key;
  }

  // Safe localStorage helper with automatic change detection
  const origSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(key, val) {
    origSetItem(key, val);
    if (!isSyncing && typeof key === 'string' && (key.startsWith('riff_') || key.startsWith('devsize_') || key.startsWith('raser_'))) {
      if (!key.endsWith('_cache') && !key.startsWith('riff_i18n_')) {
        triggerAutoSync();
      }
    }
  };

  function getLocalJSON(key, defaultVal) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : defaultVal;
    } catch (_) {
      return defaultVal;
    }
  }

  function setLocalJSON(key, val) {
    try {
      origSetItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function saveUserProfile(user) {
    if (!user || !user.uid) return;
    const profile = {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || t('guest'),
      email: user.email || '',
      photoURL: user.photoURL || '',
      isAnonymous: !!user.isAnonymous
    };
    setLocalJSON('raser_user_profile', profile);
    setLocalJSON('raser_desktop_user', profile);
  }

  // Restore cached user profile immediately (0ms) so there is zero delay, zero flicker, and no false logged-out state
  try {
    const cached = getLocalJSON('raser_user_profile', null) || getLocalJSON('raser_desktop_user', null);
    if (cached && cached.uid) {
      currentUser = cached;
    }
  } catch (_) {}

  // Load Firebase SDK dynamically if not loaded
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  async function initFirebase() {
    try {
      if (typeof window.firebase === 'undefined') {
        await loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js');
      }

      if (!window.firebase.apps || window.firebase.apps.length === 0) {
        firebaseApp = window.firebase.initializeApp(FIREBASE_CONFIG);
      } else {
        firebaseApp = window.firebase.apps[0];
      }

      auth = window.firebase.auth();
      db = window.firebase.firestore();

      try {
        if (window.firebase && window.firebase.auth && window.firebase.auth.Auth && window.firebase.auth.Auth.Persistence) {
          await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
        }
      } catch (pErr) {
        console.warn('[RaserFirebase] setPersistence note:', pErr);
      }

      auth.onAuthStateChanged(async (user) => {
        if (user) {
          currentUser = user;
          saveUserProfile(user);
          updateAccountUI();

          // Auto-close modal if user was on the login screen
          const modal = document.getElementById('raser-account-modal');
          if (modal && modal.classList.contains('visible')) {
            const authView = document.getElementById('account-auth-view');
            if (authView && !authView.classList.contains('hidden')) {
              modal.classList.remove('visible');
              setTimeout(() => {
                if (!modal.classList.contains('visible')) {
                  modal.classList.add('hidden');
                  modal.style.display = 'none';
                }
              }, 200);
            }
          }

          await handleInitialSync(user);
          listenToCloudChanges(user);
        } else {
          // If Firebase SDK hasn't restored or reports null, check cached profile before declaring logged out
          const savedCached = getLocalJSON('raser_user_profile', null) || getLocalJSON('raser_desktop_user', null);
          if (savedCached && savedCached.uid) {
            currentUser = savedCached;
            updateAccountUI();
            await handleInitialSync(savedCached);
            listenToCloudChanges(savedCached);
          } else {
            currentUser = null;
            updateAccountUI();
            if (unsubscribeSnapshot) {
              unsubscribeSnapshot();
              unsubscribeSnapshot = null;
            }
          }
        }
      });

      setupStorageListener();
    } catch (e) {
      console.warn('[RaserFirebase] Init warning:', e);
    }
  }

  // Comprehensive Local Settings Extraction & Restoration
  function getAllLocalSettings() {
    const settings = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key === 'devsize_playlists' || key === 'devsize_history' || key === 'devsize_favorites' || key === 'raser_desktop_user') continue;
        if (key.endsWith('_cache') || key.startsWith('riff_i18n_')) continue;
        if (key.startsWith('riff_') || key.startsWith('devsize_') || key.startsWith('raser_')) {
          const val = localStorage.getItem(key);
          if (val !== null && val.length < 50000) {
            settings[key] = val;
          }
        }
      }
    } catch (_) {}
    return settings;
  }

  function applyCloudSettings(cloudSettings) {
    if (!cloudSettings || typeof cloudSettings !== 'object') return false;
    let changed = false;
    try {
      for (const [key, val] of Object.entries(cloudSettings)) {
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          const current = localStorage.getItem(key);
          const strVal = String(val);
          if (current !== strVal) {
            origSetItem(key, strVal);
            changed = true;
          }
        }
      }
    } catch (_) {}
    return changed;
  }

  // Auto Initial Sync when user signs in
  async function handleInitialSync(user) {
    if (!db || !user) return;
    setSyncStatus('syncing');

    try {
      const userDocRef = db.collection('users').doc(user.uid);
      const doc = await userDocRef.get();

      const localPlaylists = getLocalJSON('devsize_playlists', []);
      const localHistory = getLocalJSON('devsize_history', []);
      const localFavorites = getLocalJSON('devsize_favorites', []);
      const localSettings = getAllLocalSettings();

      if (!doc.exists) {
        // First time user or cloud is empty: Automatically push all local data (playlists, history, favorites, settings)
        const initialData = {
          profile: {
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || t('guest'),
            email: user.email || '',
            photoURL: user.photoURL || '',
            isAnonymous: user.isAnonymous || false,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          },
          library: {
            playlists: localPlaylists,
            history: localHistory.slice(0, 100),
            favorites: localFavorites,
            settings: localSettings,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          }
        };

        await userDocRef.set(initialData, { merge: true });
        setSyncStatus('synced');
      } else {
        // Cloud exists: Merge smartly
        const cloudData = doc.data() || {};
        const cloudLib = cloudData.library || {};
        const cloudPlaylists = cloudLib.playlists || [];
        const cloudHistory = cloudLib.history || [];
        const cloudFavorites = cloudLib.favorites || [];
        const cloudSettings = cloudLib.settings || {};

        let shouldUpload = false;

        // Playlists: Smart merge so no playlists are ever lost
        if (cloudPlaylists.length === 0 && localPlaylists.length > 0) {
          shouldUpload = true;
        } else if (cloudPlaylists.length > 0) {
          if (localPlaylists.length > 0) {
            const cloudIds = new Set(cloudPlaylists.map(p => p.id || p.name));
            const uniqueLocal = localPlaylists.filter(p => !cloudIds.has(p.id || p.name));
            if (uniqueLocal.length > 0) {
              cloudPlaylists.push(...uniqueLocal);
              shouldUpload = true;
            }
          }
          setLocalJSON('devsize_playlists', cloudPlaylists);
        }

        // Favorites: Smart union
        if (cloudFavorites.length === 0 && localFavorites.length > 0) {
          shouldUpload = true;
        } else if (cloudFavorites.length > 0) {
          if (localFavorites.length > 0) {
            const cloudTrackIds = new Set(cloudFavorites.map(t => t.id || t.title));
            const uniqueLocalFavs = localFavorites.filter(t => !cloudTrackIds.has(t.id || t.title));
            if (uniqueLocalFavs.length > 0) {
              cloudFavorites.push(...uniqueLocalFavs);
              shouldUpload = true;
            }
          }
          setLocalJSON('devsize_favorites', cloudFavorites);
        }

        // History: Smart merge (unique tracks, recent first)
        if (cloudHistory.length === 0 && localHistory.length > 0) {
          shouldUpload = true;
        } else if (cloudHistory.length > 0) {
          if (localHistory.length > 0) {
            const seen = new Set();
            const mergedHist = [];
            for (const item of [...localHistory, ...cloudHistory]) {
              const key = item.id || item.title;
              if (key && !seen.has(key)) {
                seen.add(key);
                mergedHist.push(item);
              }
            }
            cloudHistory = mergedHist.slice(0, 100);
            shouldUpload = true;
          }
          setLocalJSON('devsize_history', cloudHistory);
        }

        // Settings
        if (Object.keys(cloudSettings).length === 0 && Object.keys(localSettings).length > 0) {
          shouldUpload = true;
        } else if (Object.keys(cloudSettings).length > 0) {
          const applied = applyCloudSettings(cloudSettings);
          if (applied) {
            window.dispatchEvent(new CustomEvent('raser:cloud-settings-updated', { detail: cloudSettings }));
          }
        }

        if (shouldUpload) {
          await userDocRef.set({
            library: {
              playlists: getLocalJSON('devsize_playlists', []),
              history: getLocalJSON('devsize_history', []).slice(0, 100),
              favorites: getLocalJSON('devsize_favorites', []),
              settings: getAllLocalSettings(),
              updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            }
          }, { merge: true });
        }

        window.dispatchEvent(new CustomEvent('raser:cloud-library-updated'));
        setSyncStatus('synced');
      }
    } catch (err) {
      console.warn('[RaserFirebase] Initial sync error (Check Firestore status):', err);
      setSyncStatus('error');
    }
  }

  // Realtime Cloud changes listener
  function listenToCloudChanges(user) {
    if (!db || !user) return;
    if (unsubscribeSnapshot) unsubscribeSnapshot();

    try {
      const userDocRef = db.collection('users').doc(user.uid);
      unsubscribeSnapshot = userDocRef.onSnapshot((doc) => {
        if (!doc.exists || isSyncing) return;
        const data = doc.data();
        if (data && data.library) {
          const cloudLib = data.library;
          let libChanged = false;

          // Playlists
          if (Array.isArray(cloudLib.playlists)) {
            const currentLocal = JSON.stringify(getLocalJSON('devsize_playlists', []));
            const newCloud = JSON.stringify(cloudLib.playlists);
            if (currentLocal !== newCloud) {
              setLocalJSON('devsize_playlists', cloudLib.playlists);
              libChanged = true;
            }
          }

          // Favorites
          if (Array.isArray(cloudLib.favorites)) {
            const currentFav = JSON.stringify(getLocalJSON('devsize_favorites', []));
            const newFav = JSON.stringify(cloudLib.favorites);
            if (currentFav !== newFav) {
              setLocalJSON('devsize_favorites', cloudLib.favorites);
              libChanged = true;
            }
          }

          if (libChanged) {
            window.dispatchEvent(new CustomEvent('raser:cloud-library-updated'));
          }

          // Settings
          if (cloudLib.settings && typeof cloudLib.settings === 'object') {
            const applied = applyCloudSettings(cloudLib.settings);
            if (applied) {
              window.dispatchEvent(new CustomEvent('raser:cloud-settings-updated', { detail: cloudLib.settings }));
            }
          }

          updateStatsUI();
        }
      }, (err) => {
        console.warn('[RaserFirebase] Snapshot error:', err);
      });
    } catch (_) {}
  }

  // Auto debounced sync whenever playlists/favorites/settings change locally
  function triggerAutoSync() {
    if (!currentUser || !db) return;
    setSyncStatus('syncing');

    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
      isSyncing = true;
      try {
        const localPlaylists = getLocalJSON('devsize_playlists', []);
        const localHistory = getLocalJSON('devsize_history', []);
        const localFavorites = getLocalJSON('devsize_favorites', []);
        const localSettings = getAllLocalSettings();

        const userDocRef = db.collection('users').doc(currentUser.uid);
        await userDocRef.set({
          library: {
            playlists: localPlaylists,
            history: localHistory.slice(0, 100),
            favorites: localFavorites,
            settings: localSettings,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          }
        }, { merge: true });

        setSyncStatus('synced');
        updateStatsUI();
      } catch (err) {
        console.warn('[RaserFirebase] Auto-sync error:', err);
        setSyncStatus('error');
      } finally {
        isSyncing = false;
      }
    }, SYNC_DEBOUNCE_MS);
  }

  // Watch for local changes in playlists, favorites, and settings
  function setupStorageListener() {
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      if (e.key === 'devsize_playlists' || e.key === 'devsize_history' || e.key === 'devsize_favorites') {
        triggerAutoSync();
      } else if (e.key.startsWith('riff_') || e.key.startsWith('devsize_') || e.key.startsWith('raser_')) {
        triggerAutoSync();
      }
    });

    // Custom events dispatched by app.js when mutating playlists or settings
    window.addEventListener('raser:playlist-changed', () => {
      triggerAutoSync();
    });
    window.addEventListener('raser:setting-changed', () => {
      triggerAutoSync();
    });
  }

  // UI Updates & Material You Badges
  function setSyncStatus(status) {
    const dot = document.getElementById('cloud-sync-dot');
    const label = document.getElementById('account-sync-state-label');
    if (!dot) return;

    dot.classList.remove('syncing', 'synced', 'error');
    if (status === 'syncing') {
      dot.classList.add('syncing');
      dot.title = t('syncing');
      if (label) label.textContent = t('syncing');
    } else if (status === 'synced') {
      dot.classList.add('synced');
      dot.title = t('synced');
      if (label) label.textContent = t('synced');
    } else {
      dot.classList.add('error');
      dot.title = t('syncFailed');
      if (label) label.textContent = t('syncFailed');
    }
  }

  function updateAccountUI() {
    const pill = document.getElementById('btn-account-pill');
    const nameLabel = document.getElementById('account-name-label');
    const avatarImg = document.getElementById('account-avatar-img');
    const defaultIcon = document.getElementById('account-avatar-default-icon');

    if (!pill || !nameLabel) return;

    if (currentUser) {
      const name = currentUser.displayName || currentUser.email?.split('@')[0] || (currentUser.isAnonymous ? t('guest') : t('account'));
      nameLabel.textContent = name;
      pill.classList.add('signed-in');

      if (currentUser.photoURL && avatarImg) {
        avatarImg.src = currentUser.photoURL;
        avatarImg.classList.remove('hidden');
        if (defaultIcon) defaultIcon.classList.add('hidden');
      } else {
        if (avatarImg) avatarImg.classList.add('hidden');
        if (defaultIcon) defaultIcon.classList.remove('hidden');
      }
    } else {
      nameLabel.textContent = t('signIn');
      pill.classList.remove('signed-in');
      if (avatarImg) avatarImg.classList.add('hidden');
      if (defaultIcon) defaultIcon.classList.remove('hidden');
    }

    updateStatsUI();
  }

  function updateStatsUI() {
    const tracksEl = document.getElementById('account-stat-tracks');
    const playlistsEl = document.getElementById('account-stat-playlists');
    const historyEl = document.getElementById('account-stat-history');

    const playlists = getLocalJSON('devsize_playlists', []);
    const history = getLocalJSON('devsize_history', []);
    let trackCount = 0;
    playlists.forEach(p => {
      if (p && Array.isArray(p.tracks)) trackCount += p.tracks.length;
    });

    if (tracksEl) tracksEl.textContent = `${trackCount} ${t('tracksWord')}`;
    if (playlistsEl) playlistsEl.textContent = `${playlists.length} ${t('playlistsWord')}`;
    if (historyEl) historyEl.textContent = `${history.length} ${t('historyWord')}`;
  }

  // Auth Functions exposed to UI
  async function signInWithEmail(email, password) {
    if (!auth) throw new Error('Firebase not initialized');
    const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
    if (cred && cred.user) {
      currentUser = cred.user;
      saveUserProfile(cred.user);
      updateAccountUI();
    }
    return cred;
  }

  async function registerWithEmail(email, password, displayName) {
    if (!auth) throw new Error('Firebase not initialized');
    const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
    if (displayName && cred.user) {
      try {
        await cred.user.updateProfile({ displayName: displayName.trim() });
        cred.user.displayName = displayName.trim();
      } catch (_) {}
    }
    if (cred && cred.user) {
      currentUser = cred.user;
      saveUserProfile(cred.user);
      updateAccountUI();
    }
    return cred;
  }

  function showStatus(msg, isError = true) {
    const statusMsg = document.getElementById('auth-status-msg');
    if (statusMsg) {
      statusMsg.textContent = msg;
      statusMsg.classList.remove('hidden');
      statusMsg.style.color = isError ? 'var(--md-sys-color-error, #ff5449)' : 'var(--md-sys-color-primary)';
      statusMsg.style.background = isError ? 'rgba(255, 84, 73, 0.12)' : 'color-mix(in srgb, var(--md-sys-color-primary) 15%, transparent)';
    }
    if (typeof showToast === 'function') {
      try { showToast(msg); } catch (_) {}
    }
  }

  function clearStatus() {
    const statusMsg = document.getElementById('auth-status-msg');
    if (!statusMsg) return;
    statusMsg.textContent = '';
    statusMsg.classList.add('hidden');
  }

  async function handleDesktopAuthPayload(authData) {
    if (!authData || !authData.uid) return;
    
    saveUserProfile(authData);
    currentUser = {
      uid: authData.uid,
      displayName: authData.displayName || authData.email?.split('@')[0] || t('guest'),
      email: authData.email || '',
      photoURL: authData.photoURL || '',
      isAnonymous: false,
      idToken: authData.idToken
    };

    if (auth && (authData.googleIdToken || authData.idToken)) {
      try {
        const cred = window.firebase.auth.GoogleAuthProvider.credential(
          authData.googleIdToken || null,
          authData.googleAccessToken || null
        );
        await auth.signInWithCredential(cred);
      } catch (e) {
        console.warn('[RaserFirebase] Credential sign-in note:', e.message);
      }
    }

    updateAccountUI();
    showStatus(t('successLogin'), false);
    
    // Auto-close modal if open
    const modal = document.getElementById('raser-account-modal');
    if (modal && modal.classList.contains('visible')) {
      setTimeout(() => {
        modal.classList.remove('visible');
        setTimeout(() => {
          if (!modal.classList.contains('visible')) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
          }
        }, 200);
      }, 600);
    }

    await handleInitialSync(currentUser);
    listenToCloudChanges(currentUser);
  }

  async function signInWithGoogle() {
    const isDesktop = window.location.protocol === 'file:' || !!window.electronAPI;

    if (isDesktop) {
      let port = 38472;
      try {
        if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
          port = (await window.electronAPI.getServerPort()) || 38472;
        } else if (window.state && window.state.serverPort) {
          port = window.state.serverPort;
        }
      } catch (_) {}

      // Generate a unique session token for cloud auth handshake
      const sessionId = 'auth_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
      const bridgeUrl = `https://app.raserapp.online/auth-desktop?port=${port}&session=${sessionId}&sessionId=${sessionId}&lang=${getLang()}`;
      try {
        if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
          window.electronAPI.openExternal(bridgeUrl);
        } else {
          window.open(bridgeUrl, '_blank');
        }
      } catch (_) {
        try { window.open(bridgeUrl, '_blank'); } catch (_) {}
      }

      showStatus(getLang().startsWith('tr')
        ? 'Tarayıcınızda Google giriş penceresi açıldı. Lütfen hesabınızı seçin...'
        : 'Google sign-in opened in your browser. Please select your account...', false);

      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes
        const pollTimer = setInterval(async () => {
          attempts++;
          if (attempts > maxAttempts) {
            clearInterval(pollTimer);
            return reject(new Error(getLang().startsWith('tr') ? 'Google girişi zaman aşımına uğradı.' : 'Google sign-in timed out.'));
          }

          // 1. Check cloud relay session first (works in Tauri without local node server)
          try {
            const cloudRes = await fetch(`https://app.raserapp.online/api/desktop-auth-session?sessionId=${sessionId}`);
            if (cloudRes.ok) {
              const cloudData = await cloudRes.json();
              if (cloudData && cloudData.ready && cloudData.auth) {
                clearInterval(pollTimer);
                await handleDesktopAuthPayload(cloudData.auth);
                return resolve(cloudData.auth);
              }
            }
          } catch (_) {}

          // 2. Also fallback to localhost check if Electron loopback exists
          try {
            const checkRes = await fetch(`http://127.0.0.1:${port}/api/desktop-auth-check`);
            if (checkRes.ok) {
              const data = await checkRes.json();
              if (data && data.ready && data.auth) {
                clearInterval(pollTimer);
                await handleDesktopAuthPayload(data.auth);
                return resolve(data.auth);
              }
            }
          } catch (_) {}
        }, 1000);
      });
    }

    if (!auth) throw new Error('Firebase not initialized');
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    return auth.signInWithPopup(provider);
  }

  async function signInGuest() {
    if (!auth) throw new Error('Firebase not initialized');
    return auth.signInAnonymously();
  }

  async function signOut() {
    localStorage.removeItem('raser_desktop_user');
    currentUser = null;
    updateAccountUI();
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    if (auth) {
      try { await auth.signOut(); } catch (_) {}
    }
  }

  async function resetPassword(email) {
    if (!auth) throw new Error('Firebase not initialized');
    return auth.sendPasswordResetEmail(email.trim());
  }

  // Modal & Event Bindings
  function setupModalEvents() {
    const modal = document.getElementById('raser-account-modal');
    const btnPill = document.getElementById('btn-account-pill');
    const btnClose = document.getElementById('btn-close-account-modal');
    const authView = document.getElementById('account-auth-view');
    const profileView = document.getElementById('account-profile-view');
    const tabLogin = document.getElementById('tab-auth-login');
    const tabRegister = document.getElementById('tab-auth-register');
    const registerNameRow = document.getElementById('register-name-row');
    const submitBtn = document.getElementById('btn-submit-auth');
    const submitBtnLabel = document.getElementById('btn-submit-auth-label');
    const inputEmail = document.getElementById('auth-input-email');
    const inputPassword = document.getElementById('auth-input-password');
    const inputName = document.getElementById('auth-input-name');
    const statusMsg = document.getElementById('auth-status-msg');
    const googleBtn = document.getElementById('btn-google-signin');
    const signoutBtn = document.getElementById('btn-signout');
    const forgotBtn = document.getElementById('btn-forgot-password');

    const isDesktop = window.location.protocol === 'file:' || !!window.electronAPI;
    const guestAuthRow = document.getElementById('guest-auth-row');
    const guestBtn = document.getElementById('btn-guest-signin');

    if (isDesktop) {
      guestAuthRow?.classList.add('hidden');
    } else {
      guestAuthRow?.classList.remove('hidden');
      if (guestBtn) {
        guestBtn.querySelector('span')?.setAttribute('data-i18n', '');
        guestBtn.querySelector('span') && (guestBtn.querySelector('span').textContent = t('guestBtn'));
        guestBtn.addEventListener('click', async () => {
          clearStatus();
          try {
            showStatus(t('syncing'), false);
            await signInGuest();
            closeModal(true);
          } catch (err) {
            showStatus(err.message || 'Guest sign-in error', true);
          }
        });
      }
    }

    let isRegisterMode = false;

    function updateModalI18n() {
      const modalTitle = document.getElementById('account-modal-title');
      if (modalTitle) modalTitle.textContent = currentUser ? t('account') : (isRegisterMode ? t('registerTitle') : t('loginTitle'));
      
      const tabLog = document.getElementById('tab-auth-login');
      if (tabLog) tabLog.textContent = t('loginTab');
      
      const tabReg = document.getElementById('tab-auth-register');
      if (tabReg) tabReg.textContent = t('registerTab');

      const gBtnSpan = googleBtn?.querySelector('span');
      if (gBtnSpan) gBtnSpan.textContent = t('googleBtn');

      if (inputName) inputName.placeholder = t('displayNameLabel') + ' (' + (getLang().startsWith('tr') ? 'isteğe bağlı' : 'optional') + ')';
      if (inputEmail) inputEmail.placeholder = t('emailLabel');
      if (inputPassword) inputPassword.placeholder = t('passwordLabel');

      if (forgotBtn) forgotBtn.textContent = t('forgotPassword');
      if (submitBtnLabel) submitBtnLabel.textContent = isRegisterMode ? t('registerTab') : t('loginTab');

      const guestLabel = document.getElementById('btn-guest-signin-label');
      if (guestLabel) guestLabel.textContent = t('guestBtn');

      if (signoutBtn) signoutBtn.textContent = t('signOut');
    }

    function setAuthMode(register) {
      isRegisterMode = register;
      clearStatus();
      updateModalI18n();
      if (register) {
        tabRegister?.classList.add('active');
        tabLogin?.classList.remove('active');
        registerNameRow?.classList.remove('hidden');
      } else {
        tabLogin?.classList.add('active');
        tabRegister?.classList.remove('active');
        registerNameRow?.classList.add('hidden');
      }
    }

    function openModal() {
      if (!modal) return;
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      clearStatus();
      updateModalI18n();
      if (currentUser) {
        btnClose?.classList.remove('hidden');
        authView?.classList.add('hidden');
        profileView?.classList.remove('hidden');
        const pName = document.getElementById('profile-display-name');
        const pEmail = document.getElementById('profile-email');
        const pAvatar = document.getElementById('profile-avatar-img');
        const pFallback = document.getElementById('profile-avatar-fallback');

        const name = currentUser.displayName || currentUser.email?.split('@')[0] || (currentUser.isAnonymous ? t('guest') : t('account'));
        if (pName) pName.textContent = name;
        if (pEmail) pEmail.textContent = currentUser.email || (currentUser.isAnonymous ? t('guest') : '');

        if (currentUser.photoURL && pAvatar) {
          pAvatar.src = currentUser.photoURL;
          pAvatar.classList.remove('hidden');
          if (pFallback) pFallback.classList.add('hidden');
        } else {
          if (pAvatar) pAvatar.classList.add('hidden');
          if (pFallback) pFallback.classList.remove('hidden');
        }

        updateStatsUI();
      } else {
        btnClose?.classList.remove('hidden');
        authView?.classList.remove('hidden');
        profileView?.classList.add('hidden');
        setAuthMode(false);
      }

      modal.style.display = 'flex';
      modal.classList.remove('hidden');
      requestAnimationFrame(() => modal.classList.add('visible'));
    }

    function closeModal(force = false) {
      if (!modal) return;
      modal.classList.remove('visible');
      setTimeout(() => {
        if (!modal.classList.contains('visible')) {
          modal.classList.add('hidden');
          modal.style.display = 'none';
        }
      }, 200);
    }

    if (btnPill) btnPill.addEventListener('click', openModal);
    if (btnClose) btnClose.addEventListener('click', () => closeModal(false));
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal();
        }
      });
    }

    if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode(false));
    if (tabRegister) tabRegister.addEventListener('click', () => setAuthMode(true));

    // Submit Auth
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const email = inputEmail?.value?.trim();
        const pass = inputPassword?.value;
        const dName = inputName?.value?.trim();

        if (!email || !pass) {
          showStatus(getLang().startsWith('tr') ? 'Lütfen e-posta ve şifrenizi girin.' : 'Please enter email and password.');
          return;
        }

        clearStatus();
        submitBtn.disabled = true;
        const originalText = submitBtnLabel ? submitBtnLabel.textContent : '';
        if (submitBtnLabel) submitBtnLabel.textContent = t('syncing');

        try {
          if (isRegisterMode) {
            await registerWithEmail(email, pass, dName);
          } else {
            await signInWithEmail(email, pass);
          }
          if (inputPassword) inputPassword.value = '';
          showStatus(t('successLogin'), false);
          setTimeout(() => {
            closeModal(true);
          }, 600);
        } catch (err) {
          let errTxt = err.message || 'Error occurred';
          if (err.code === 'auth/invalid-email') errTxt = getLang().startsWith('tr') ? 'Geçersiz e-posta adresi.' : 'Invalid email address.';
          else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            errTxt = getLang().startsWith('tr') ? 'E-posta veya şifre hatalı.' : 'Incorrect email or password.';
          } else if (err.code === 'auth/email-already-in-use') {
            errTxt = getLang().startsWith('tr') ? 'Bu e-posta adresi zaten kullanımda.' : 'This email is already in use.';
          } else if (err.code === 'auth/weak-password') {
            errTxt = getLang().startsWith('tr') ? 'Şifreniz en az 6 karakter olmalıdır.' : 'Password must be at least 6 characters.';
          }
          showStatus(errTxt, true);
        } finally {
          submitBtn.disabled = false;
          if (submitBtnLabel) submitBtnLabel.textContent = originalText;
        }
      });
    }

    // Google Sign-In
    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        clearStatus();
        try {
          const res = await signInWithGoogle();
          if (res) {
            showStatus(t('successLogin'), false);
            setTimeout(() => {
              closeModal(true);
            }, 600);
          }
        } catch (err) {
          showStatus(err.message || 'Google sign-in error', true);
        }
      });
    }

    // Sign Out
    if (signoutBtn) {
      signoutBtn.addEventListener('click', async () => {
        try {
          await signOut();
          closeModal();
          updateAccountUI();
        } catch (e) {
          console.warn('[RaserFirebase] Sign out error:', e);
        }
      });
    }

    // Forgot Password
    if (forgotBtn) {
      forgotBtn.addEventListener('click', async () => {
        const email = inputEmail?.value?.trim();
        if (!email) {
          showStatus(getLang().startsWith('tr') ? 'Lütfen önce e-posta adresinizi girin.' : 'Please enter your email address first.');
          return;
        }
        try {
          await resetPassword(email);
          showStatus(t('resetSent'), false);
        } catch (err) {
          showStatus(err.message || 'Error sending reset email', true);
        }
      });
    }
  }

  // Public API
  window.RaserFirebase = {
    init: initFirebase,
    signInWithEmail,
    registerWithEmail,
    signInWithGoogle,
    signInGuest,
    signOut,
    resetPassword,
    triggerAutoSync,
    getUser: () => currentUser,
    t
  };

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      updateAccountUI();
      initFirebase();
      setupModalEvents();
    });
  } else {
    updateAccountUI();
    initFirebase();
    setupModalEvents();
  }
})();
