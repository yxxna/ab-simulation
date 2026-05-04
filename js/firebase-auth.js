/* ════════════════════════════════════════
   Recto — Firebase Auth (Google 로그인)
   js/firebase-auth.js
════════════════════════════════════════ */

const firebaseConfig = {
  apiKey:            "AIzaSyDlnXmiPYjLgsIq7gxnk9Z0GdaKPVJuiEc",
  authDomain:        "recto-ui-a1a01.firebaseapp.com",
  projectId:         "recto-ui-a1a01",
  storageBucket:     "recto-ui-a1a01.firebasestorage.app",
  messagingSenderId: "528339271292",
  appId:             "1:528339271292:web:95c8554f5192264d8693f9",
  measurementId:     "G-LM9Z63TBGQ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

const ADMIN_EMAIL = 'yxxna.design@gmail.com';
window.currentUser = null;

/* ── nav UI 업데이트 ── */
function updateNavAuth(user) {
  const btnLogin   = document.getElementById('btnLogin');
  const userInfo   = document.getElementById('userInfo');
  const userAvatar = document.getElementById('userAvatar');
  const userName   = document.getElementById('userName');
  if (!btnLogin) return;

  if (user) {
    btnLogin.style.display = 'none';
    userInfo.style.display = 'flex';
    userAvatar.src         = user.photoURL || '';
    userName.textContent   = user.displayName || user.email;

    if (user.email === ADMIN_EMAIL) {
      localStorage.setItem('recto_pro', '1');
    } else {
      // 어드민 아닌 계정 로그인 시 PRO 강제 해제
      localStorage.removeItem('recto_pro');
    }
  } else {
    btnLogin.style.display = 'flex';
    userInfo.style.display = 'none';
  }

  if (typeof updateTrialUI === 'function') updateTrialUI();
}

/* ── Google 로그인 (popup 방식) ── */
function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(result => {
      window.currentUser = result.user;
      updateNavAuth(result.user);
    })
    .catch(err => console.error('로그인 실패:', err.code, err.message));
}

/* ── 로그아웃 ── */
function signOut() {
  auth.signOut().then(() => {
    window.currentUser = null;
    updateNavAuth(null);
  });
}

/* ── 인증 상태 상시 감지 (새로고침·재방문 때도 유지) ── */
auth.onAuthStateChanged(user => {
  window.currentUser = user;
  updateNavAuth(user);
});
