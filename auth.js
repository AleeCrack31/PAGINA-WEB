const loginForm = document.getElementById('loginForm');
const regForm = document.getElementById('regForm');
const btnLogin = document.getElementById('showLogin');
const btnRegister = document.getElementById('showRegister');

// Mostrar login por defecto
window.addEventListener("DOMContentLoaded", () => {
  loginForm.classList.add("active");
});

// Alternar formularios
btnLogin.addEventListener('click', () => {
  loginForm.classList.add('active');
  regForm.classList.remove('active');
});

btnRegister.addEventListener('click', () => {
  regForm.classList.add('active');
  loginForm.classList.remove('active');
});

// LOGIN
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(loginForm);
  const body = { email: fd.get('email'), password: fd.get('password') };
  const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) return alert(j.error);
  window.location.href = '/panel';
});

// REGISTRO
regForm.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(regForm);
  const body = {
    game_name: fd.get('game_name'),
    email: fd.get('email'),
    password: fd.get('password')
  };
  const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) return alert(j.error);
  alert('Cuenta creada! Ahora accede con tus datos.');
  regForm.reset();
  regForm.classList.remove('active');
  loginForm.classList.add('active');
});

