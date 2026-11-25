/**
 * login.js — 로그인·회원가입 페이지 (login.html)
 *   login    - POST /auth/login: ski-auth-api가 Redis에 세션을 저장, 세 API가 함께 읽는 SKISESSID 쿠키를 설정
 *   register - POST /auth/register
 */

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 폼 아래 메시지: 기본은 빨간색, ok = true면 초록색 
function showMsg(el, text, ok = false) {
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

function showForm(which) {
  document.getElementById('login-form').classList.toggle('hidden', which !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', which !== 'register');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Redis에 유효한 세션이 이미 있음 → 로그인 페이지 건너뜀
  try {
    const res = await fetch('/auth/check');
    const me = await res.json();
    if (me.result === 'ok') {
      location.href = 'index.html';
      return;
    }
  } catch (e) {
    // ski-auth-api 연결 불가 → 로그인 페이지에 그대로 두고 사용자가 시도하게 함
  }

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  document.getElementById('to-register').addEventListener('click', () => showForm('register'));
  document.getElementById('to-login').addEventListener('click', () => showForm('login'));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // 페이지 새로고침 대신 fetch로 전송
    const msg = document.getElementById('login-msg');

    const data = await postJson('/auth/login', {
      email: loginForm.email.value.trim(),
      password: loginForm.password.value,
    });

    if (data.result === 'ok') {
      location.href = 'index.html';   // 로그인 응답에서 이미 쿠키 설정
    } else {
      showMsg(msg, data.msg);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('register-msg');

    if (registerForm.password.value !== registerForm.password2.value) {
      showMsg(msg, '비밀번호가 일치하지 않습니다.');
      return;
    }

    const email = registerForm.email.value.trim();
    const data = await postJson('/auth/register', {
      name: registerForm.name.value.trim(),
      email,
      password: registerForm.password.value,
    });

    if (data.result === 'ok') {
      registerForm.reset();
      showForm('login');
      loginForm.email.value = email;
      showMsg(document.getElementById('login-msg'), '회원가입 완료! 로그인해 주세요.', true);
    } else {
      showMsg(msg, data.msg);
    }
  });
});
