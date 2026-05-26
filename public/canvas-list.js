(function () {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('198.18.');

  const API_BASE = isLocalhost ? 'http://localhost:3000/api/v1' : `${window.location.origin}/api/v1`;
  const STORAGE_TOKEN = 'synccanvas.token';
  const STORAGE_USER = 'synccanvas.user';
  const STORAGE_META = 'synccanvas.canvasMeta';

  const loginView = document.getElementById('loginView');
  const canvasListView = document.getElementById('canvasListView');
  const drawView = document.getElementById('drawView');
  const loginForm = document.getElementById('loginForm');
  const loginName = document.getElementById('loginName');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginToggle = document.getElementById('loginToggle');
  const currentUserName = document.getElementById('currentUserName');
  const logoutBtn = document.getElementById('logoutBtn');
  const newCanvasName = document.getElementById('newCanvasName');
  const createCanvasBtn = document.getElementById('createCanvasBtn');
  const canvasItems = document.getElementById('canvasItems');
  const canvasListLoading = document.getElementById('canvasListLoading');
  const canvasListError = document.getElementById('canvasListError');
  const backToListBtn = document.getElementById('backToListBtn');
  const drawCanvasItems = document.getElementById('drawCanvasItems');
  const refreshDrawCanvasesBtn = document.getElementById('refreshDrawCanvasesBtn');

  let token = localStorage.getItem(STORAGE_TOKEN) || null;
  let currentUser = null;
  let isRegisterMode = false;
  let latestCanvases = [];
  let currentCanvasId = null;
  let canvasMeta = loadCanvasMeta();

  function loadCanvasMeta() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_META)) || {};
    } catch {
      return {};
    }
  }

  function saveCanvasMeta() {
    localStorage.setItem(STORAGE_META, JSON.stringify(canvasMeta));
  }

  function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function apiRequest(method, path, body) {
    const options = {
      method,
      headers: getHeaders()
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(API_BASE + path, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || `HTTP ${response.status}`);
    }

    return data;
  }

  function showOnly(view) {
    loginView.classList.toggle('is-hidden', view !== 'login');
    canvasListView.classList.toggle('is-hidden', view !== 'list');
    drawView.classList.toggle('is-hidden', view !== 'draw');
  }

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
  }

  function clearLoginError() {
    loginError.textContent = '';
    loginError.hidden = true;
  }

  function showListError(message) {
    canvasListError.textContent = message;
    canvasListError.hidden = false;
  }

  function clearListError() {
    canvasListError.textContent = '';
    canvasListError.hidden = true;
  }

  function setAuth(tokenValue, user) {
    token = tokenValue;
    currentUser = user;

    if (tokenValue && user) {
      localStorage.setItem(STORAGE_TOKEN, tokenValue);
      localStorage.setItem(STORAGE_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
    }
  }

  function loadAuth() {
    const savedToken = localStorage.getItem(STORAGE_TOKEN);
    const savedUser = localStorage.getItem(STORAGE_USER);

    if (!savedToken || !savedUser) return false;

    try {
      token = savedToken;
      currentUser = JSON.parse(savedUser);
      return true;
    } catch {
      setAuth(null, null);
      return false;
    }
  }

  function logout() {
    setAuth(null, null);
    window.SyncCanvasDraw.disconnectCanvas();
    currentCanvasId = null;
    loginName.value = '';
    loginPassword.value = '';
    clearLoginError();
    renderDrawCanvasList();
    showOnly('login');
  }

  function toggleLoginMode() {
    isRegisterMode = !isRegisterMode;
    loginForm.querySelector('h1').textContent = isRegisterMode ? '注册 SyncCanvas' : 'SyncCanvas';
    loginForm.querySelector('button[type="submit"]').textContent = isRegisterMode ? '注册' : '登录';
    loginToggle.textContent = isRegisterMode ? '已有账号？登录' : '没有账号？注册';
    document.getElementById('loginDesc').textContent = isRegisterMode
      ? '注册后可以创建和管理自己的画布。'
      : '登录后选择或创建一个协作画布。';
    loginPassword.placeholder = isRegisterMode ? '输入密码（6 位以上）' : '输入密码';
    clearLoginError();
  }

  async function handleAuth(event) {
    event.preventDefault();
    clearLoginError();

    const username = loginName.value.trim();
    const password = loginPassword.value;

    if (!username) {
      showLoginError('请输入用户名');
      return;
    }

    if (!password || password.length < (isRegisterMode ? 6 : 1)) {
      showLoginError(isRegisterMode ? '密码至少需要 6 个字符' : '请输入密码');
      return;
    }

    try {
      if (isRegisterMode) {
        await apiRequest('POST', '/auth/register', { username, password });
      }

      const data = await apiRequest('POST', '/auth/login', { username, password });
      setAuth(data.data.token, {
        user_id: data.data.user_id,
        username: data.data.username
      });
      await showCanvasList();
    } catch (error) {
      showLoginError(error.message);
    }
  }

  async function fetchCanvases() {
    const data = await apiRequest('GET', '/canvases');
    latestCanvases = data.data?.canvases || [];
    renderDrawCanvasList();
    return latestCanvases;
  }

  async function showCanvasList() {
    if (!token) {
      showOnly('login');
      return;
    }

    showOnly('list');
    currentUserName.textContent = currentUser?.username || '-';
    canvasItems.innerHTML = '';
    clearListError();
    canvasListLoading.hidden = false;

    try {
      renderCanvasList(await fetchCanvases());
    } catch (error) {
      showListError(`加载画布列表失败: ${error.message}`);
      if (/401|认证|令牌|token/i.test(error.message)) {
        logout();
      }
    } finally {
      canvasListLoading.hidden = true;
    }
  }

  async function refreshDrawCanvases() {
    if (!token) return;
    try {
      await fetchCanvases();
    } catch (error) {
      renderDrawCanvasList(`加载失败: ${error.message}`);
    }
  }

  function getCanvasId(canvas) {
    return canvas.canvas_id || canvas.id;
  }

  function getCreatedAt(canvas) {
    return canvas.created_at || canvas.createdAt || canvas.created_time;
  }

  function getUpdatedAt(canvas) {
    const id = getCanvasId(canvas);
    const localMeta = canvasMeta[id] || {};
    return canvas.updated_at ||
      canvas.updatedAt ||
      canvas.last_modified_at ||
      canvas.lastModifiedAt ||
      canvas.last_operation_at ||
      localMeta.lastModifiedAt ||
      getCreatedAt(canvas);
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function sortedCanvases(canvases) {
    return canvases
      .slice()
      .sort((a, b) => new Date(getUpdatedAt(b)).getTime() - new Date(getUpdatedAt(a)).getTime());
  }

  function renderCanvasList(canvases) {
    canvasItems.innerHTML = '';

    if (canvases.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '还没有画布，创建一个开始吧。';
      canvasItems.appendChild(empty);
      return;
    }

    sortedCanvases(canvases).forEach((canvas) => {
      const canvasId = getCanvasId(canvas);
      const isOwner = currentUser && canvas.owner_id === currentUser.user_id;
      const localMeta = canvasMeta[canvasId] || {};
      const operationCount = canvas.total_operations ?? canvas.operation_count ?? localMeta.operationCount;
      const latestSeq = canvas.latest_sequence_id ?? canvas.latestSequenceId ?? localMeta.latestSequenceId;

      const item = document.createElement('div');
      item.className = 'canvas-item';
      item.innerHTML = `
        <div class="canvas-info">
          <strong class="canvas-name"></strong>
          <div class="canvas-meta-grid">
            <span class="canvas-meta canvas-id"></span>
            <span class="canvas-meta canvas-created"></span>
            <span class="canvas-meta canvas-updated"></span>
            <span class="canvas-meta canvas-extra"></span>
          </div>
        </div>
        <div class="canvas-actions">
          <button class="canvas-enter-btn" type="button">进入</button>
          ${isOwner ? '<button class="canvas-delete-btn" type="button">删除</button>' : ''}
        </div>
      `;

      item.querySelector('.canvas-name').textContent = canvas.name || canvasId;
      item.querySelector('.canvas-id').textContent = `ID: ${canvasId}`;
      item.querySelector('.canvas-created').textContent = `创建: ${formatDate(getCreatedAt(canvas))}`;
      item.querySelector('.canvas-updated').textContent = `最后修改: ${formatDate(getUpdatedAt(canvas))}`;
      item.querySelector('.canvas-extra').textContent = [
        isOwner ? '我创建的' : '协作画布',
        operationCount != null ? `${operationCount} 次操作` : null,
        latestSeq != null ? `序列 ${latestSeq}` : null
      ].filter(Boolean).join(' · ');

      item.querySelector('.canvas-enter-btn').addEventListener('click', () => enterCanvas(canvas));

      const deleteBtn = item.querySelector('.canvas-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => handleDeleteCanvas(canvas, item));
      }

      canvasItems.appendChild(item);
    });
  }

  function renderDrawCanvasList(errorMessage) {
    drawCanvasItems.innerHTML = '';

    if (errorMessage) {
      const error = document.createElement('div');
      error.className = 'sidebar-empty';
      error.textContent = errorMessage;
      drawCanvasItems.appendChild(error);
      return;
    }

    if (!latestCanvases.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = token ? '暂无画板' : '登录后显示画板';
      drawCanvasItems.appendChild(empty);
      return;
    }

    sortedCanvases(latestCanvases).forEach((canvas) => {
      const canvasId = getCanvasId(canvas);
      const item = document.createElement('button');
      item.className = 'draw-canvas-card';
      item.type = 'button';
      item.classList.toggle('active', canvasId === currentCanvasId);
      item.innerHTML = `
        <strong></strong>
        <span></span>
      `;
      item.querySelector('strong').textContent = canvas.name || canvasId;
      item.querySelector('span').textContent = `最后修改 ${formatDate(getUpdatedAt(canvas))}`;
      item.addEventListener('click', () => enterCanvas(canvas));
      drawCanvasItems.appendChild(item);
    });
  }

  async function handleDeleteCanvas(canvas, itemElement) {
    const canvasId = getCanvasId(canvas);
    if (!window.confirm(`确定要删除画布 "${canvas.name}" 吗？此操作不可恢复。`)) return;

    itemElement.style.opacity = '0.5';
    itemElement.style.pointerEvents = 'none';

    try {
      await apiRequest('DELETE', `/canvases/${encodeURIComponent(canvasId)}`);
      delete canvasMeta[canvasId];
      saveCanvasMeta();
      latestCanvases = latestCanvases.filter((item) => getCanvasId(item) !== canvasId);
      renderCanvasList(latestCanvases);
      renderDrawCanvasList();
    } catch (error) {
      itemElement.style.opacity = '1';
      itemElement.style.pointerEvents = 'auto';
      window.alert(`删除失败: ${error.message}`);
    }
  }

  async function handleCreateCanvas() {
    const name = newCanvasName.value.trim();
    createCanvasBtn.disabled = true;
    createCanvasBtn.textContent = '创建中...';

    try {
      const data = await apiRequest('POST', '/canvases', { name: name || undefined });
      const canvas = data.data;
      if (canvas?.canvas_id) {
        canvasMeta[canvas.canvas_id] = {
          lastModifiedAt: canvas.created_at || new Date().toISOString(),
          latestSequenceId: 0,
          operationCount: 0
        };
        saveCanvasMeta();
      }
      newCanvasName.value = '';
      await showCanvasList();
    } catch (error) {
      window.alert(`创建画布失败: ${error.message}`);
    } finally {
      createCanvasBtn.disabled = false;
      createCanvasBtn.textContent = '创建新画布';
    }
  }

  function enterCanvas(canvas) {
    const canvasId = getCanvasId(canvas);
    currentCanvasId = canvasId;
    showOnly('draw');
    renderDrawCanvasList();
    window.SyncCanvasDraw.openCanvas(canvasId, canvas.name || canvasId);
  }

  function enterCanvasById(canvasId) {
    const canvas = latestCanvases.find((item) => getCanvasId(item) === canvasId);
    if (canvas) {
      enterCanvas(canvas);
    }
  }

  function markCanvasModified(canvasId, timestamp, latestSequenceId) {
    if (!canvasId) return;
    const current = canvasMeta[canvasId] || {};
    canvasMeta[canvasId] = {
      lastModifiedAt: timestamp || Date.now(),
      latestSequenceId: latestSequenceId ?? current.latestSequenceId,
      operationCount: Number(current.operationCount || 0) + 1
    };
    saveCanvasMeta();
    renderDrawCanvasList();
  }

  loginForm.addEventListener('submit', handleAuth);
  loginToggle.addEventListener('click', toggleLoginMode);
  createCanvasBtn.addEventListener('click', handleCreateCanvas);
  newCanvasName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handleCreateCanvas();
    }
  });
  backToListBtn.addEventListener('click', () => {
    window.SyncCanvasDraw.disconnectCanvas();
    currentCanvasId = null;
    showCanvasList();
  });
  logoutBtn.addEventListener('click', logout);
  refreshDrawCanvasesBtn.addEventListener('click', refreshDrawCanvases);

  window.addEventListener('synccanvas:canvas-opened', (event) => {
    currentCanvasId = event.detail.canvasId;
    renderDrawCanvasList();
  });

  if (loadAuth() && token) {
    showCanvasList();
  } else {
    renderDrawCanvasList();
    showOnly('login');
  }

  window.SyncCanvasApp = {
    logout,
    showCanvasList,
    refreshCanvases: showCanvasList,
    refreshDrawCanvases,
    apiRequest,
    markCanvasModified,
    enterCanvasById,
    getCanvases: () => latestCanvases.slice(),
    getToken: () => token,
    getCurrentUser: () => currentUser,
    isLoggedIn: () => Boolean(token)
  };
}());
