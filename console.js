// public/js/console.js
const socket = io();

function appendLog(msg) {
  const el = document.getElementById('serverSubContent');
  const p = document.createElement('pre');
  p.innerText = msg;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}

// listen for rcon output
socket.on('rcon:output', d => appendLog(`[OUT] ${d.cmd}\n${d.out}`));
socket.on('rcon:error', d => appendLog(`[ERR] ${d.error}`));

// Example: in console subtab, add a simple input
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-sub="consola"]') || e.target.matches('button[data-sub="consola"]')) {
    const container = document.getElementById('serverSubContent');
    container.innerHTML = `<div><input id="rconCmd" placeholder="Comando RCON" style="width:70%"><button id="sendCmd">Enviar</button></div><div id="log"></div>`;
    document.getElementById('sendCmd').addEventListener('click', () => {
      const cmd = document.getElementById('rconCmd').value;
      socket.emit('rcon:command', cmd);
    });
  }
});
