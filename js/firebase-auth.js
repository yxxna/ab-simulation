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

// 어드민 이메일 — 이 계정은 항상 무제한
const ADMIN_EMAIL = 'yxxna.design@gmail.com';

// 현재 로그인 유저 (전역)
window.currentUser = null;

/* ── Google 로그인 (redirect 방식 — GitHub Pages 호환) ── */
function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithRedirect(provider);
}

// 리디렉션 후 결과 처리
auth.getRedirectResult().then(result => {
  if (result.user) {
    console.log('Google 로그인 성공:', result.user.email);
  }
}).catch(err => {
  console.error('로그인 실패:', err.code, err.message);
});

/* ── 로그아웃 ── */
function signOut() {
  auth.signOut();
}

/* ── 인증 상태 변화 감지 ── */
auth.onAuthStateChanged(user => {
  window.currentUser = user;

  const btnLogin  = document.getElementById('btnLogin');
  const userInfo  = document.getElementById('userInfo');
  const userAvatar = document.getElementById('userAvatar');
  const userName  = document.getElementById('userName');

  if (user) {
    // 로그인 상태
    btnLogin.style.display  = 'none';
    userInfo.style.display  = 'flex';
    userAvatar.src          = user.photoURL || '';
    userName.textContent    = user.displayName || user.email;

    // 어드민이면 PRO 자동 활성화
    if (user.email === ADMIN_EMAIL) {
      localStorage.setItem('recto_pro', '1');
    }
  } else {
    // 로그아웃 상태
    btnLogin.style.display  = 'flex';
    userInfo.style.display  = 'none';
  }

  // 트라이얼 UI 갱신 (app.js의 함수)
  if (typeof updateTrialUI === 'function') updateTrialUI();
});
