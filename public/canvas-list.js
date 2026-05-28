(function () {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('198.18.');

  const API_BASE = isLocalhost ? 'http://localhost:3000/api/v1' : `${window.location.origin}/api/v1`;
  const STORAGE_TOKEN = 'synccanvas.token';
  const STORAGE_USER = 'synccanvas.user';
  const STORAGE_META = 'synccanvas.canvasMeta';

  const authModal = document.getElementById('authModal');
  const authOverlay = document.getElementById('authOverlay');
  const authCloseBtn = document.getElementById('authCloseBtn');
  const loginForm = document.getElementById('loginForm');
  const loginName = document.getElementById('loginName');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginToggle = document.getElementById('loginToggle');
  const loginTitle = document.getElementById('loginTitle');
  const loginDesc = document.getElementById('loginDesc');
  const currentUserName = document.getElementById('currentUserName');
  const topLoginBtn = document.getElementById('topLoginBtn');
  const rightLoginBtn = document.getElementById('rightLoginBtn');
  const topUserInfo = document.getElementById('topUserInfo');
  const topUserName = document.getElementById('topUserName');
  const logoutBtn = document.getElementById('logoutBtn');
  const sidebarUserHint = document.getElementById('sidebarUserHint');
  const canvasControls = document.getElementById('canvasControls');
  const newCanvasName = document.getElementById('newCanvasName');
  const createCanvasBtn = document.getElementById('createCanvasBtn');
  const canvasItems = document.getElementById('canvasItems');
  const canvasListLoading = document.getElementById('canvasListLoading');
  const canvasListError = document.getElementById('canvasListError');
  const drawCanvasItems = document.getElementById('drawCanvasItems');
  const refreshDrawCanvasesBtn = document.getElementById('refreshDrawCanvasesBtn');
  const welcomePanel = document.getElementById('welcomePanel');
  const drawView = document.getElementById('drawView');
  const introPanel = document.getElementById('introPanel');
  const onlineUsersPanel = document.getElementById('onlineUsersPanel');
  const toolbar = document.getElementById('toolbar');
  const workspaceEyebrow = document.getElementById('workspaceEyebrow');
  const currentCanvasLabel = document.getElementById('currentCanvasLabel');
  const welcomeStartBtn = document.getElementById('welcomeStartBtn');
  const loginUnlockCard = document.getElementById('loginUnlockCard');
  const loggedInHintCard = document.getElementById('loggedInHintCard');
  const rightCurrentUsername = document.getElementById('rightCurrentUsername');

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

  function isLoggedIn() {
    return Boolean(token && currentUser);
  }

  function showWorkspace() {
    document.getElementById('app').classList.remove('is-hidden');
  }

  function showWelcomeState() {
    currentCanvasId = null;
    welcomePanel.classList.remove('is-hidden');
    drawView.classList.add('is-hidden');
    introPanel.classList.remove('is-hidden');
    onlineUsersPanel.classList.add('is-hidden');
    toolbar.classList.add('toolbar-disabled');
    currentCanvasLabel.textContent = '未选择画布';
    workspaceEyebrow.textContent = '选择左侧画布开始协作';
    updateRightPanelAuthState();
    renderCanvasList(latestCanvases);
  }

  function showCanvasState(canvas) {
    const canvasId = getCanvasId(canvas);
    currentCanvasId = canvasId;
    welcomePanel.classList.add('is-hidden');
    drawView.classList.remove('is-hidden');
    introPanel.classList.add('is-hidden');
    onlineUsersPanel.classList.remove('is-hidden');
    toolbar.classList.remove('toolbar-disabled');
    currentCanvasLabel.textContent = canvas.name || canvasId;
    workspaceEyebrow.textContent = '当前画布';
    updateRightPanelAuthState();
    renderCanvasList(latestCanvases);
  }

  function updateRightPanelAuthState() {
    const hasCanvasSelected = Boolean(currentCanvasId);

    introPanel.classList.toggle('is-hidden', hasCanvasSelected);
    onlineUsersPanel.classList.toggle('is-hidden', !hasCanvasSelected);

    if (hasCanvasSelected) return;

    const loggedIn = isLoggedIn();
    loginUnlockCard.classList.toggle('is-hidden', loggedIn);
    loggedInHintCard.classList.toggle('is-hidden', !loggedIn);
    rightCurrentUsername.textContent = loggedIn ? currentUser.username : '-';
  }

  function setAuthMode(mode) {
    isRegisterMode = mode === 'register';
    loginTitle.textContent = isRegisterMode ? '注册 SyncCanvas' : 'SyncCanvas';
    loginForm.querySelector('button[type="submit"]').textContent = isRegisterMode ? '注册' : '登录';
    loginToggle.textContent = isRegisterMode ? '已有账号？登录' : '没有账号？注册';
    loginDesc.textContent = isRegisterMode
      ? '注册后可以创建和管理自己的协作画布。'
      : '登录后选择或创建一个协作画布。';
    loginPassword.placeholder = isRegisterMode ? '输入密码（6 位以上）' : '输入密码';
  }

  function openAuthModal(mode = 'login') {
    setAuthMode(mode);
    clearLoginError();
    authModal.classList.remove('is-hidden');
    window.setTimeout(() => loginName.focus(), 0);
  }

  function closeAuthModal() {
    authModal.classList.add('is-hidden');
    clearLoginError();
  }

  function updateAuthUI() {
    const loggedIn = isLoggedIn();
    topLoginBtn.classList.toggle('is-hidden', loggedIn);
    topUserInfo.classList.toggle('is-hidden', !loggedIn);
    canvasControls.classList.remove('is-hidden');
    currentUserName.textContent = loggedIn ? currentUser.username : '访客';
    topUserName.textContent = loggedIn ? currentUser.username : '-';
    sidebarUserHint.textContent = loggedIn
      ? `欢迎回来，${currentUser.username}`
      : '登录后查看和管理你的协作画布';
    updateRightPanelAuthState();
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

    updateAuthUI();
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
    latestCanvases = [];
    loginName.value = '';
    loginPassword.value = '';
    clearLoginError();
    renderCanvasList([]);
    renderDrawCanvasList();
    showWelcomeState();
  }

  function toggleLoginMode() {
    setAuthMode(isRegisterMode ? 'login' : 'register');
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
      closeAuthModal();
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
    showWelcomeState();
    updateAuthUI();
    clearListError();

    if (!isLoggedIn()) {
      canvasItems.innerHTML = '';
      renderDrawCanvasList();
      return;
    }

    canvasItems.innerHTML = '';
    canvasListLoading.hidden = false;

    try {
      renderCanvasList(await fetchCanvases());
    } catch (error) {
      showListError(`加载画布列表失败: ${error.message}`);
      if (/401|认证|令牌|token/i.test(error.message)) {
        logout();
        openAuthModal('login');
      }
    } finally {
      canvasListLoading.hidden = true;
    }
  }

  async function refreshDrawCanvases() {
    if (!isLoggedIn()) {
      openAuthModal('login');
      return;
    }

    try {
      renderCanvasList(await fetchCanvases());
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
    if (!value) return '暂无修改';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '暂无修改';
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

    if (!isLoggedIn()) {
      return;
    }

    const visibleCanvases = sortedCanvases(canvases);

    if (visibleCanvases.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '还没有画布，创建一个开始协作吧。';
      canvasItems.appendChild(empty);
      return;
    }

    visibleCanvases.forEach((canvas, index) => {
      const canvasId = getCanvasId(canvas);
      const isOwner = currentUser && canvas.owner_id === currentUser.user_id;
      const localMeta = canvasMeta[canvasId] || {};
      const operationCount = canvas.total_operations ?? canvas.operation_count ?? localMeta.operationCount;
      const latestSeq = canvas.latest_sequence_id ?? canvas.latestSequenceId ?? localMeta.latestSequenceId;
      const collaboratorCount = Math.max(1, Number(canvas.collaborator_count || canvas.member_count || 1));

      const item = document.createElement('article');
      item.className = 'canvas-item';
      item.classList.toggle('active', canvasId === currentCanvasId);
      item.innerHTML = `
        <div class="canvas-thumb" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="canvas-info">
          <div class="canvas-card-header">
            <strong class="canvas-name"></strong>
            <span class="canvas-status">协作中</span>
          </div>
          <span class="canvas-updated"></span>
          <div class="canvas-card-footer">
            <span class="canvas-avatar-group" aria-hidden="true">
              <i>${initialFor(canvas.name || canvasId)}</i>
              <i>${initialFor(currentUser?.username || 'U')}</i>
            </span>
            <span class="canvas-extra"></span>
          </div>
        </div>
        <div class="canvas-actions">
          <button class="canvas-enter-btn" type="button">进入</button>
          ${isOwner ? '<button class="canvas-delete-btn" type="button">删除</button>' : ''}
        </div>
      `;

      item.querySelector('.canvas-name').textContent = canvas.name || canvasId;
      item.querySelector('.canvas-updated').textContent = `最后修改 ${formatDate(getUpdatedAt(canvas))}`;
      item.querySelector('.canvas-extra').textContent = [
        `${collaboratorCount} 人协作`,
        operationCount != null ? `${operationCount} 次操作` : null,
        latestSeq != null ? `序列 ${latestSeq}` : null,
        isOwner ? '我创建的' : null
      ].filter(Boolean).join(' · ');

      item.style.setProperty('--thumb-hue', String((index * 46) % 360));
      item.querySelector('.canvas-enter-btn').addEventListener('click', () => enterCanvas(canvas));
      item.addEventListener('dblclick', () => enterCanvas(canvas));

      const deleteBtn = item.querySelector('.canvas-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          handleDeleteCanvas(canvas, item);
        });
      }

      canvasItems.appendChild(item);
    });
  }

  function initialFor(value) {
    return String(value || 'S').trim().slice(0, 1).toUpperCase();
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

    if (!isLoggedIn()) {
      canvasItems.innerHTML = '';
      return;
    }

    renderCanvasList(latestCanvases);
  }

  async function handleDeleteCanvas(canvas, itemElement) {
    const canvasId = getCanvasId(canvas);
    if (!isLoggedIn()) {
      openAuthModal('login');
      return;
    }

    if (!window.confirm(`确定要删除画布 "${canvas.name || canvasId}" 吗？此操作不可恢复。`)) return;

    itemElement.style.opacity = '0.5';
    itemElement.style.pointerEvents = 'none';

    try {
      await apiRequest('DELETE', `/canvases/${encodeURIComponent(canvasId)}`);
      delete canvasMeta[canvasId];
      saveCanvasMeta();
      latestCanvases = latestCanvases.filter((item) => getCanvasId(item) !== canvasId);
      renderCanvasList(latestCanvases);
      if (currentCanvasId === canvasId) {
        window.SyncCanvasDraw.disconnectCanvas();
        showWelcomeState();
      }
    } catch (error) {
      itemElement.style.opacity = '1';
      itemElement.style.pointerEvents = 'auto';
      window.alert(`删除失败: ${error.message}`);
    }
  }

  async function handleCreateCanvas() {
    if (!isLoggedIn()) {
      openAuthModal('login');
      return;
    }

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
      if (/401|认证|令牌|token/i.test(error.message)) {
        logout();
        openAuthModal('login');
      }
    } finally {
      createCanvasBtn.disabled = false;
      createCanvasBtn.textContent = '创建';
    }
  }

  function enterCanvas(canvas) {
    if (!isLoggedIn()) {
      openAuthModal('login');
      return;
    }

    showCanvasState(canvas);
    window.SyncCanvasDraw.openCanvas(getCanvasId(canvas), canvas.name || getCanvasId(canvas));
  }

  function enterCanvasById(canvasId) {
    const canvas = latestCanvases.find((item) => getCanvasId(item) === canvasId);
    if (canvas) {
      enterCanvas(canvas);
    } else if (!isLoggedIn()) {
      openAuthModal('login');
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
    renderCanvasList(latestCanvases);
  }

  loginForm.addEventListener('submit', handleAuth);
  loginToggle.addEventListener('click', toggleLoginMode);
  createCanvasBtn.addEventListener('click', handleCreateCanvas);
  topLoginBtn.addEventListener('click', () => openAuthModal('login'));
  rightLoginBtn.addEventListener('click', () => openAuthModal('login'));
  welcomeStartBtn.addEventListener('click', () => {
    if (!isLoggedIn()) {
      openAuthModal('login');
      return;
    }
    newCanvasName.focus();
  });
  authCloseBtn.addEventListener('click', closeAuthModal);
  authOverlay.addEventListener('click', closeAuthModal);
  newCanvasName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handleCreateCanvas();
    }
  });
  logoutBtn.addEventListener('click', logout);
  refreshDrawCanvasesBtn.addEventListener('click', refreshDrawCanvases);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !authModal.classList.contains('is-hidden')) {
      closeAuthModal();
    }
  });

  window.addEventListener('synccanvas:canvas-opened', (event) => {
    currentCanvasId = event.detail.canvasId;
    renderCanvasList(latestCanvases);
  });

  loadAuth();
  showWorkspace();
  updateAuthUI();
  showWelcomeState();
  if (isLoggedIn()) {
    showCanvasList();
  } else {
    renderDrawCanvasList();
  }

  window.SyncCanvasApp = {
    logout,
    showWorkspace,
    showWelcomeState,
    showCanvasState,
    openAuthModal,
    closeAuthModal,
    updateAuthUI,
    updateRightPanelAuthState,
    showCanvasList,
    refreshCanvases: showCanvasList,
    refreshDrawCanvases,
    apiRequest,
    markCanvasModified,
    enterCanvasById,
    getCanvases: () => latestCanvases.slice(),
    getToken: () => token,
    getCurrentUser: () => currentUser,
    isLoggedIn
  };
}());
