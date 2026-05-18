(function () {
  const STORAGE_KEY = 'synccanvas.canvasList';
  const USER_KEY = 'synccanvas.userName';
  const defaultCanvases = [
    { id: 'default', name: '默认画布', createdAt: Date.now() }
  ];

  const loginView = document.getElementById('loginView');
  const canvasListView = document.getElementById('canvasListView');
  const drawView = document.getElementById('drawView');
  const loginForm = document.getElementById('loginForm');
  const loginName = document.getElementById('loginName');
  const currentUserName = document.getElementById('currentUserName');
  const logoutBtn = document.getElementById('logoutBtn');
  const newCanvasName = document.getElementById('newCanvasName');
  const createCanvasBtn = document.getElementById('createCanvasBtn');
  const canvasItems = document.getElementById('canvasItems');
  const backToListBtn = document.getElementById('backToListBtn');

  let canvases = loadCanvases();
  let userName = localStorage.getItem(USER_KEY) || '';

  function loadCanvases() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(saved) && saved.length > 0) {
        return saved;
      }
    } catch (error) {
      console.warn('[SyncCanvas] 画布列表读取失败', error);
    }

    return defaultCanvases;
  }

  function saveCanvases() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canvases));
  }

  function showOnly(view) {
    loginView.classList.toggle('is-hidden', view !== 'login');
    canvasListView.classList.toggle('is-hidden', view !== 'list');
    drawView.classList.toggle('is-hidden', view !== 'draw');
  }

  function createCanvasId(name) {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = Date.now().toString(36);

    return `${slug || 'canvas'}-${suffix}`;
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderCanvasList() {
    canvasItems.innerHTML = '';

    canvases.forEach((canvasInfo) => {
      const item = document.createElement('button');
      item.className = 'canvas-item';
      item.type = 'button';
      item.dataset.canvasId = canvasInfo.id;
      item.innerHTML = `
        <span>
          <strong></strong>
          <span></span>
        </span>
        <span class="canvas-arrow">进入</span>
      `;
      item.querySelector('strong').textContent = canvasInfo.name;
      item.querySelector('span span').textContent = `ID: ${canvasInfo.id} · 创建于 ${formatDate(canvasInfo.createdAt)}`;
      item.addEventListener('click', () => enterCanvas(canvasInfo));
      canvasItems.appendChild(item);
    });
  }

  function showCanvasList() {
    currentUserName.textContent = userName || '-';
    renderCanvasList();
    showOnly('list');
  }

  function enterCanvas(canvasInfo) {
    showOnly('draw');
    window.SyncCanvasDraw.openCanvas(canvasInfo.id, canvasInfo.name);
  }

  function createCanvas() {
    const name = newCanvasName.value.trim() || `新画布 ${canvases.length + 1}`;
    const canvasInfo = {
      id: createCanvasId(name),
      name,
      createdAt: Date.now()
    };

    canvases = [canvasInfo].concat(canvases);
    saveCanvases();
    newCanvasName.value = '';
    renderCanvasList();
  }

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    userName = loginName.value.trim();
    if (!userName) return;

    localStorage.setItem(USER_KEY, userName);
    showCanvasList();
  });

  createCanvasBtn.addEventListener('click', createCanvas);

  newCanvasName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      createCanvas();
    }
  });

  backToListBtn.addEventListener('click', () => {
    window.SyncCanvasDraw.disconnectCanvas();
    showCanvasList();
  });

  logoutBtn.addEventListener('click', () => {
    userName = '';
    localStorage.removeItem(USER_KEY);
    loginName.value = '';
    window.SyncCanvasDraw.disconnectCanvas();
    showOnly('login');
  });

  saveCanvases();
  renderCanvasList();

  if (userName) {
    loginName.value = userName;
    showCanvasList();
  } else {
    showOnly('login');
  }
}());
