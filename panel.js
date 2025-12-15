document.addEventListener('DOMContentLoaded', async () => {
  // --- ELEMENTOS ---
  const sections = document.querySelectorAll('.section');
  const sidebarItems = document.querySelectorAll('.sidebar li');
  const serverSubContent = document.getElementById('serverSubContent');
  const mosaicsList = document.getElementById('mosaicsList');
  const playersGrid = document.getElementById('playersGrid');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  const closeModal = document.getElementById('closeModal');
  const btnLogout = document.getElementById('btnLogout');
  const btnInfo = document.getElementById('btnInfo');
  const mosaicForm = document.getElementById('mosaicForm');
  const fileBrowser = document.getElementById('fileBrowser');

  let userRole = 'user';
  let serverInterval;

  // --- HELPERS ---
  function showSection(id) {
    sections.forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }

  function openModal(content) {
    modalBody.innerHTML = '';
    modalBody.appendChild(content);
    modal.classList.remove('hidden');
  }
  closeModal.addEventListener('click', () => modal.classList.add('hidden'));

  async function apiGet(url) { const res = await fetch(url); return res.json(); }
  async function apiPost(url, data) { const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); return res.json(); }
  async function apiPut(url, data) { const res = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); return res.json(); }
  async function apiDelete(url) { const res = await fetch(url, { method:'DELETE' }); return res.json(); }

  async function fetchUserRole() {
    try {
      const res = await apiGet('/api/user/role');
      userRole = res.role || 'user';
    } catch(e) { console.error('Error al obtener rol', e); }
  }

  // --- SERVER ---
  const serverSubtabs = document.querySelectorAll('#server .subtabs button');

  async function initServerTab() {
    serverSubtabs.forEach(btn => {
      btn.addEventListener('click', async () => {
        serverSubtabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await showServerSubtab(btn.dataset.sub);
      });
    });
    serverSubtabs[0].click(); // abre "inicio" por defecto
  }

  async function showServerSubtab(sub) {
    serverSubContent.innerHTML = 'Cargando...';
    try {
      if (sub === 'inicio') {
        await updateServerInicio();
      }

      if (sub === 'consola') {
        serverSubContent.innerHTML = `
          <h3>Consola</h3>
          <div id="consoleOutput" class="console-box"></div>
          <form id="commandForm">
            <input id="commandInput" placeholder="Escribe un comando..." autocomplete="off">
          </form>
        `;
        const ws = new WebSocket("ws://localhost:8081");
        const output = document.getElementById("consoleOutput");
        ws.onmessage = (msg) => {
          output.textContent += "\n" + msg.data;
          output.scrollTop = output.scrollHeight;
        };
        document.getElementById('commandForm').addEventListener('submit', async e => {
          e.preventDefault();
          const cmd = document.getElementById('commandInput').value;
          if (!cmd.trim()) return;
          await apiPost('/api/rcon/command', { command: cmd });
          document.getElementById('commandInput').value = '';
        });
      }

      if (sub === 'archivos') await loadFiles('');
      if (sub === 'mundos') await loadWorlds();
      if (sub === 'backups') await loadBackups();

    } catch (e) {
      console.error(e);
      serverSubContent.innerHTML = 'Error cargando datos.';
    }
  }

  async function updateServerInicio() {
    try {
      const status = await apiGet('/api/server/status');
      const players = await apiGet('/api/players/list');
      const cpuRam = await apiGet('/api/server/cpu_ram');
      const tps = await apiGet('/api/server/tps');

      serverSubContent.innerHTML = `
        <div class="server-stats">
          <p><strong>Estado:</strong> ${status.online ? '🟢 Online' : '🔴 Offline'}</p>
          <p><strong>Jugadores conectados:</strong> ${players.length}</p>
          <ul>${players.map(p => `<li>${p.name}</li>`).join('')}</ul>
          <p><strong>CPU:</strong> ${cpuRam.cpu}% | <strong>RAM:</strong> ${cpuRam.ram}%</p>
          <p><strong>TPS:</strong> ${tps.tps}</p>
          <div class="server-buttons">
            <button id="saveBtn" ${userRole !== 'admin' ? 'disabled' : ''}>Guardar</button>
            <button id="stopBtn" ${userRole !== 'admin' ? 'disabled' : ''}>Apagar</button>
          </div>
        </div>
      `;

      const saveBtn = document.getElementById('saveBtn');
      const stopBtn = document.getElementById('stopBtn');

      saveBtn.addEventListener('click', async () => {
        await apiPost('/api/server/save-all', {});
        alert('Servidor guardado.');
      });

      stopBtn.addEventListener('click', async () => {
        if (confirm('¿Seguro que quieres apagar el servidor?')) {
          await apiPost('/api/server/shutdown', {});
          alert('Servidor apagado.');
        }
      });

    } catch (e) {
      console.error(e);
      serverSubContent.innerHTML = 'Error al obtener datos del servidor.';
    }
  }

  // --- PLAYERS ---
  async function loadPlayers() {
    playersGrid.innerHTML = 'Cargando jugadores...';
    try {
      const players = await apiGet('/api/players/list');
      playersGrid.innerHTML = '';
      players.forEach(p => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.innerHTML = `
          ${p.skin ? `<img src="${p.skin}" alt="${p.name}">` : ''}
          <h4>${p.name}</h4>
          <button class="details">Detalles</button>
        `;
        card.querySelector('.details').addEventListener('click', async () => {
          const details = await apiGet(`/api/players/${p.name}/details`);
          const div = document.createElement('div');
          div.innerHTML = `<pre>${JSON.stringify(details, null, 2)}</pre>`;
          openModal(div);
        });
        playersGrid.appendChild(card);
      });
    } catch (e) {
      playersGrid.innerHTML = 'Error cargando jugadores.';
    }
  }

  // --- MOSAICOS ---
  if (mosaicForm) {
    mosaicForm.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(mosaicForm).entries());
      data.public = data.public === 'on';
      await apiPost('/api/mosaics', data);
      mosaicForm.reset();
      loadMosaics();
    });
  }

  async function loadMosaics() {
    mosaicsList.innerHTML = 'Cargando mosaicos...';
    try {
      const mosaics = await apiGet('/api/mosaics');
      mosaicsList.innerHTML = '';
      mosaics.forEach(m => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <h4>${m.title}</h4>
          ${m.img_url ? `<img src="${m.img_url}" alt="${m.title}">` : ''}
          <p>${m.content}</p>
          <div>
            <button class="edit">Editar</button>
            <button class="delete">Eliminar</button>
          </div>
        `;
        card.querySelector('.edit').addEventListener('click', () => editMosaic(m));
        card.querySelector('.delete').addEventListener('click', async () => {
          if (confirm('¿Eliminar mosaico?')) {
            await apiDelete(`/api/mosaics/${m.id}`);
            loadMosaics();
          }
        });
        mosaicsList.appendChild(card);
      });
    } catch (e) {
      mosaicsList.innerHTML = 'Error cargando mosaicos.';
    }
  }

  function editMosaic(m) {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="title" value="${m.title}" required>
      <input name="img_url" value="${m.img_url || ''}">
      <textarea name="content">${m.content}</textarea>
      <label><input type="checkbox" name="public" ${m.public ? 'checked' : ''}> Público</label>
      <button type="submit">Guardar</button>
    `;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.public = data.public === 'on';
      await apiPut(`/api/mosaics/${m.id}`, data);
      modal.classList.add('hidden');
      loadMosaics();
    });
    openModal(form);
  }

  // --- ARCHIVOS ---
  async function loadFiles(dir) {
    fileBrowser.innerHTML = 'Cargando archivos...';
    try {
      const list = await apiGet(`/api/files/list?dir=${encodeURIComponent(dir)}`);
      fileBrowser.innerHTML = '';
      list.forEach(f => {
        const div = document.createElement('div');
        div.textContent = `${f.isDir ? '[DIR]' : '[FILE]'} ${f.name}`;
        if (f.isDir) {
          div.addEventListener('click', () => loadFiles(`${dir}/${f.name}`));
        }
        fileBrowser.appendChild(div);
      });
    } catch (e) {
      fileBrowser.innerHTML = 'Error cargando archivos.';
    }
  }

  // --- MUNDOS ---
  async function loadWorlds() {
    serverSubContent.innerHTML = 'Cargando mundos...';
    try {
      const worlds = await apiGet('/api/worlds/list');
      serverSubContent.innerHTML = worlds.map(w => `<div>${w.name}</div>`).join('');
    } catch (e) {
      serverSubContent.innerHTML = 'Error cargando mundos.';
    }
  }

  // --- BACKUPS ---
  async function loadBackups() {
    const backupsSection = document.getElementById('backups');
    backupsSection.innerHTML = `<h2>Backups</h2><button id="createBackupBtn">Crear Backup</button><div id="backupList"></div>`;
    const createBtn = document.getElementById('createBackupBtn');
    const listDiv = document.getElementById('backupList');

    createBtn.addEventListener('click', async () => {
      const res = await apiPost('/api/backups/create', {});
      alert('Backup creado: ' + res.file);
      loadBackups();
    });

    try {
      const list = await apiGet('/api/backups/list');
      listDiv.innerHTML = list.map(b => `<div><a href="${b.url}" target="_blank">${b.name}</a></div>`).join('');
    } catch (e) {
      listDiv.innerHTML = 'Error cargando backups.';
    }
  }

  // --- LOGOUT / INFO ---
  btnLogout.addEventListener('click', async () => {
    await apiPost('/api/logout', {});
    location.href = '/';
  });
  btnInfo.addEventListener('click', async () => {
    const info = await apiGet('/api/info');
    const div = document.createElement('div');
    div.innerHTML = `<pre>${JSON.stringify(info, null, 2)}</pre>`;
    openModal(div);
  });

  // --- INICIALIZAR ---
  await fetchUserRole();
  sidebarItems[0].click(); // abre el primer apartado (Servidor)
  modal.classList.add('hidden');
  clearInterval(serverInterval);
  serverInterval = setInterval(updateServerInicio, 10000);
});
