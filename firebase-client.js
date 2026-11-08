/**
 * Raser Web Player - Firebase Client & Cloud Sync
 */

(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBUOp8uT0tNRiWqo8YPF6QfcLnH5IwhN3Y",
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
  let unsubscribeSnapshot = null;

  function getLang() {
    try {
      return (localStorage.getItem('raser_ui_lang') || navigator.language || 'tr').toLowerCase();
    } catch (_) {
      return 'tr';
    }
  }

  const I18N = {
    en: {
      signIn: 'Sign In',
      signOut: 'Sign Out',
      account: 'Account',
      cloudSync: 'Cloud Sync',
      synced: 'Synced with cloud',
      syncing: 'Syncing...',
      syncFailed: 'Sync failed',
      guest: 'Guest (Web)',
      loginTitle: 'Sign in to Raser',
      registerTitle: 'Create Raser Account',
      subtitle: 'Access your playlists, favorites, and music across all devices.',
      loginTab: 'Sign In',
      registerTab: 'Sign Up',
      googleBtn: 'Continue with Google',
      guestBtn: 'Continue as Guest',
      orDivider: 'or with email',
      emailLabel: 'Email address',
      passwordLabel: 'Password',
      displayNameLabel: 'Display Name',
      forgotPassword: 'Forgot password?',
      resetSent: 'Password reset link sent to your email!',
      successLogin: 'Welcome back!',
      successRegister: 'Account created! Your library is ready.',
      cloudLibrary: 'Cloud Library',
      tracksWord: 'tracks',
      playlistsWord: 'playlists',
      historyWord: 'history',
      autoSyncNote: 'Changes sync automatically in real-time with the cloud.'
    },
    tr: {
      signIn: 'Giriş Yap',
      signOut: 'Çıkış Yap',
      account: 'Hesap',
      cloudSync: 'Bulut Senkronizasyonu',
      synced: 'Bulutla eşitlendi',
      syncing: 'Eşitleniyor...',
      syncFailed: 'Eşitleme başarısız',
      guest: 'Misafir (Web)',
      loginTitle: "Raser'a Giriş Yap",
      registerTitle: 'Raser Hesabı Oluştur',
      subtitle: 'Çalma listelerine ve müziklerine tüm cihazlarından anında ulaş.',
      loginTab: 'Giriş Yap',
      registerTab: 'Kayıt Ol',
      googleBtn: 'Google ile Devam Et',
      guestBtn: 'Misafir Olarak Dinle',
      orDivider: 'veya e-posta ile',
      emailLabel: 'E-posta adresi',
      passwordLabel: 'Şifre',
      displayNameLabel: 'Görünen Ad',
      forgotPassword: 'Şifremi unuttum?',
      resetSent: 'Şifre sıfırlama bağlantısı e-postana gönderildi!',
      successLogin: 'Hoş geldin!',
      successRegister: 'Hesabın oluşturuldu! Kütüphanen hazır.',
      cloudLibrary: 'Buluttaki Kütüphanen',
      tracksWord: 'şarkı',
      playlistsWord: 'çalma listesi',
      historyWord: 'geçmiş',
      autoSyncNote: 'Değişiklikler bulutla otomatik ve anlık olarak eşitlenir.'
    }
  };

  function t(k) {
    const lang = getLang().startsWith('tr') ? 'tr' : 'en';
    return (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  }

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
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

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

      auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        updateAccountUI();
        if (user) {
          await handleInitialSync(user);
          listenToCloudChanges(user);
        } else {
          if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
          }
        }
      });

      setupStorageListener();
    } catch (e) {
      console.warn('[WebFirebase] Init warning:', e);
    }
  }

  async function handleInitialSync(user) {
    if (!db || !user) return;
    setSyncStatus('syncing');

    try {
      const userDocRef = db.collection('users').doc(user.uid);
      const doc = await userDocRef.get();

      const localPlaylists = getLocalJSON('devsize_playlists', []);
      const localHistory = getLocalJSON('devsize_history', []);

      if (!doc.exists) {
        // If user already has local items, save to cloud; otherwise create basic skeleton
        await userDocRef.set({
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
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          }
        }, { merge: true });
        setSyncStatus('synced');
      } else {
        const cloudData = doc.data() || {};
        const cloudLib = cloudData.library || {};
        const cloudPlaylists = cloudLib.playlists || [];
        const cloudHistory = cloudLib.history || [];

        if (cloudPlaylists.length > 0) {
          setLocalJSON('devsize_playlists', cloudPlaylists);
        }
        if (cloudHistory.length > 0) {
          setLocalJSON('devsize_history', cloudHistory);
        }

        window.dispatchEvent(new CustomEvent('raser:cloud-library-updated'));
        setSyncStatus('synced');
      }
    } catch (err) {
      console.warn('[WebFirebase] Initial sync error:', err);
      setSyncStatus('error');
    }
  }

  function listenToCloudChanges(user) {
    if (!db || !user) return;
    if (unsubscribeSnapshot) unsubscribeSnapshot();

    try {
      const userDocRef = db.collection('users').doc(user.uid);
      unsubscribeSnapshot = userDocRef.onSnapshot((doc) => {
        if (!doc.exists || isSyncing) return;
        const data = doc.data();
        if (data && data.library) {
          const cloudPlaylists = data.library.playlists;
          if (Array.isArray(cloudPlaylists)) {
            const cur = JSON.stringify(getLocalJSON('devsize_playlists', []));
            const fresh = JSON.stringify(cloudPlaylists);
            if (cur !== fresh) {
              setLocalJSON('devsize_playlists', cloudPlaylists);
              window.dispatchEvent(new CustomEvent('raser:cloud-library-updated'));
              updateStatsUI();
            }
          }
        }
      }, (err) => {
        console.warn('[WebFirebase] Snapshot error:', err);
      });
    } catch (_) {}
  }

  function triggerAutoSync() {
    if (!currentUser || !db) return;
    setSyncStatus('syncing');

    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
      isSyncing = true;
      try {
        const localPlaylists = getLocalJSON('devsize_playlists', []);
        const localHistory = getLocalJSON('devsize_history', []);

        const userDocRef = db.collection('users').doc(currentUser.uid);
        await userDocRef.set({
          library: {
            playlists: localPlaylists,
            history: localHistory.slice(0, 100),
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          }
        }, { merge: true });

        setSyncStatus('synced');
        updateStatsUI();
      } catch (err) {
        console.warn('[WebFirebase] Auto-sync error:', err);
        setSyncStatus('error');
      } finally {
        isSyncing = false;
      }
    }, SYNC_DEBOUNCE_MS);
  }

  function setupStorageListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'devsize_playlists' || e.key === 'devsize_history') {
        triggerAutoSync();
      }
    });

    window.addEventListener('raser:playlist-changed', () => {
      triggerAutoSync();
    });
  }

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

  async function signInWithEmail(email, password) {
    if (!auth) throw new Error('Firebase not initialized');
    return auth.signInWithEmailAndPassword(email.trim(), password);
  }

  async function registerWithEmail(email, password, displayName) {
    if (!auth) throw new Error('Firebase not initialized');
    const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
    if (displayName && cred.user) {
      await cred.user.updateProfile({ displayName: displayName.trim() });
    }
    return cred;
  }

  async function signInWithGoogle() {
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
    if (!auth) return;
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    await auth.signOut();
  }

  async function resetPassword(email) {
    if (!auth) throw new Error('Firebase not initialized');
    return auth.sendPasswordResetEmail(email.trim());
  }

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
    const guestBtn = document.getElementById('btn-guest-signin');
    const signoutBtn = document.getElementById('btn-signout');
    const forgotBtn = document.getElementById('btn-forgot-password');

    let isRegisterMode = false;

    function showStatus(msg, isError = true) {
      if (!statusMsg) return;
      statusMsg.textContent = msg;
      statusMsg.classList.remove('hidden');
      statusMsg.style.color = isError ? 'var(--md-sys-color-error, #ff5449)' : 'var(--md-sys-color-primary)';
      statusMsg.style.background = isError ? 'rgba(255, 84, 73, 0.12)' : 'color-mix(in srgb, var(--md-sys-color-primary) 15%, transparent)';
    }

    function clearStatus() {
      if (!statusMsg) return;
      statusMsg.textContent = '';
      statusMsg.classList.add('hidden');
    }

    function setAuthMode(register) {
      isRegisterMode = register;
      clearStatus();
      if (register) {
        tabRegister?.classList.add('active');
        tabLogin?.classList.remove('active');
        registerNameRow?.classList.remove('hidden');
        if (submitBtnLabel) submitBtnLabel.textContent = t('registerTab');
      } else {
        tabLogin?.classList.add('active');
        tabRegister?.classList.remove('active');
        registerNameRow?.classList.add('hidden');
        if (submitBtnLabel) submitBtnLabel.textContent = t('loginTab');
      }
    }

    function openModal() {
      if (!modal) return;
      clearStatus();
      if (currentUser) {
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
        authView?.classList.remove('hidden');
        profileView?.classList.add('hidden');
        setAuthMode(false);
      }

      modal.classList.remove('hidden');
      requestAnimationFrame(() => modal.classList.add('visible'));
    }

    function closeModal() {
      if (!modal) return;
      modal.classList.remove('visible');
      setTimeout(() => modal.classList.add('hidden'), 200);
    }

    if (btnPill) btnPill.addEventListener('click', openModal);
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode(false));
    if (tabRegister) tabRegister.addEventListener('click', () => setAuthMode(true));

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
          openModal();
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

    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        clearStatus();
        try {
          await signInWithGoogle();
          openModal();
        } catch (err) {
          showStatus(err.message || 'Google sign-in error', true);
        }
      });
    }

    if (guestBtn) {
      guestBtn.addEventListener('click', async () => {
        clearStatus();
        try {
          await signInGuest();
          openModal();
        } catch (err) {
          showStatus(err.message || 'Guest sign-in error', true);
        }
      });
    }

    if (signoutBtn) {
      signoutBtn.addEventListener('click', async () => {
        try {
          await signOut();
          closeModal();
          updateAccountUI();
        } catch (e) {
          console.warn('[WebFirebase] Sign out error:', e);
        }
      });
    }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initFirebase();
      setupModalEvents();
    });
  } else {
    initFirebase();
    setupModalEvents();
  }
})();
