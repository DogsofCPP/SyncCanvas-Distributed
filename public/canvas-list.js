(function () {
  // 检测当前环境，自动选择 API 地址
  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.startsWith('192.168.') ||
                      window.location.hostname.startsWith('10.') ||
                      window.location.hostname.startsWith('198.18.');
  
  const API_BASE = isLocalhost ? 'http://localhost:3000/api/v1' : window.location.origin + '/api/v1';
  const WS_BASE = isLocalhost ? 'ws://localhost:3000/ws' : 'ws://' + window.location.host + '/ws';
  const STORAGE_TOKEN = 'synccanvas.token';
  const STORAGE_USER = 'synccanvas.user';

  // ==================== DOM 元素 ====================

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

  // ==================== 状态 ====================

  let token = localStorage.getItem(STORAGE_TOKEN) || null;
  let currentUser = null;

  // ==================== API 工具函数 ====================

  function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  }

  async function apiRequest(method, path, body) {
    const options = {
      method,
      headers: getHeaders()
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(API_BASE + path, options);
    const data = await response.json();

    if (!response.ok) {
      const message = data.error?.message || '请求失败';
      throw new Error(message);
    }

    return data;
  }

  // ==================== 视图切换 ====================

  function showOnly(view) {
    loginView.classList.toggle('is-hidden', view !== 'login');
    canvasListView.classList.toggle('is-hidden', view !== 'list');
    drawView.classList.toggle('is-hidden', view !== 'draw');
  }

  function showLoginError(message) {
    const el = document.getElementById('loginError');
    if (el) {
      el.textContent = message;
      el.style.display = 'block';
    } else {
      alert(message);
    }
  }

  function clearLoginError() {
    const el = document.getElementById('loginError');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function updateLoginDesc(text) {
    const el = document.getElementById('loginDesc');
    if (el) el.textContent = text;
  }

  // ==================== 认证 ====================

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
    if (savedToken && savedUser) {
      try {
        token = savedToken;
        currentUser = JSON.parse(savedUser);
        return true;
      } catch {
        localStorage.removeItem(STORAGE_TOKEN);
        localStorage.removeItem(STORAGE_USER);
      }
    }
    return false;
  }

  function logout() {
    setAuth(null, null);
    window.SyncCanvasDraw.disconnectCanvas();
    showOnly('login');
    loginName.value = '';
    loginPassword.value = '';
    clearLoginError();
  }

  // ==================== 登录/注册表单切换 ====================

  let isRegisterMode = false;

  function toggleLoginMode() {
    isRegisterMode = !isRegisterMode;
    const form = document.getElementById('loginForm');
    if (!form) return;

    const title = form.querySelector('h1');
    const submitBtn = form.querySelector('button[type="submit"]');
    const toggleBtn = document.getElementById('loginToggle');
    const passwordLabel = form.querySelector('label[for="loginPassword"]');
    const passwordInput = document.getElementById('loginPassword');

    if (title) {
      title.textContent = isRegisterMode ? '注册 SyncCanvas' : 'SyncCanvas';
    }
    if (submitBtn) {
      submitBtn.textContent = isRegisterMode ? '注册' : '登录';
    }
    if (toggleBtn) {
      toggleBtn.textContent = isRegisterMode ? '已有账号？登录' : '没有账号？注册';
    }
    if (passwordLabel) {
      passwordLabel.style.display = 'block';
    }
    if (passwordInput) {
      passwordInput.style.display = 'block';
      if (isRegisterMode) {
        passwordInput.required = true;
        passwordInput.placeholder = '输入密码（6位以上）';
      } else {
        passwordInput.required = true;
        passwordInput.placeholder = '输入密码';
      }
    }
    updateLoginDesc(isRegisterMode
      ? '注册后可以创建和管理自己的画布。'
      : '登录后选择或创建一个协作画布。');
    clearLoginError();
  }

  // ==================== 认证请求 ====================

  async function handleAuth(event) {
    event.preventDefault();
    clearLoginError();

    const username = loginName.value.trim();
    const password = loginPassword ? loginPassword.value : '';

    if (!username) {
      showLoginError('请输入用户名');
      return;
    }

    if (isRegisterMode && (!password || password.length < 6)) {
      showLoginError('密码至少需要 6 个字符');
      return;
    }

    if (!isRegisterMode && !password) {
      showLoginError('请输入密码');
      return;
    }

    try {
      if (isRegisterMode) {
        const data = await apiRequest('POST', '/auth/register', { username, password });
        // 注册后自动登录获取 token
        const loginData = await apiRequest('POST', '/auth/login', { username, password });
        setAuth(loginData.data.token, {
          user_id: loginData.data.user_id,
          username: loginData.data.username
        });
        showCanvasList();
      } else {
        const data = await apiRequest('POST', '/auth/login', { username, password });
        setAuth(data.data.token, {
          user_id: data.data.user_id,
          username: data.data.username
        });
        showCanvasList();
      }
    } catch (err) {
      showLoginError(err.message);
    }
  }

  // ==================== 画布列表 ====================

  async function showCanvasList() {
    if (!token) {
      showOnly('login');
      return;
    }

    showOnly('list');
    currentUserName.textContent = currentUser?.username || '-';
    canvasItems.innerHTML = '';
    canvasListError.style.display = 'none';
    canvasListLoading.style.display = 'block';

    try {
      const data = await apiRequest('GET', '/canvases');
      renderCanvasList(data.data.canvases || []);
    } catch (err) {
      canvasListError.textContent = '加载画布列表失败: ' + err.message;
      canvasListError.style.display = 'block';
      if (err.message.includes('令牌') || err.message.includes('认证')) {
        logout();
      }
    } finally {
      canvasListLoading.style.display = 'none';
    }
  }

  function renderCanvasList(canvases) {
    canvasItems.innerHTML = '';

    if (canvases.length === 0) {
      canvasItems.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">还没有画布，创建一个开始吧！</p>';
      return;
    }

    canvases.forEach(function (canvas) {
      const item = document.createElement('div');
      item.className = 'canvas-item';

      const dateStr = new Date(canvas.created_at).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });

      const isOwner = currentUser && canvas.owner_id === currentUser.user_id;

      item.innerHTML =
        '<div class="canvas-info">' +
          '<strong class="canvas-name"></strong>' +
          '<span class="canvas-meta"></span>' +
        '</div>' +
        '<div class="canvas-actions">' +
          '<button class="canvas-enter-btn" type="button">进入</button>' +
          (isOwner ? '<button class="canvas-delete-btn danger" type="button" title="删除画布">删除</button>' : '') +
        '</div>';

      item.querySelector('.canvas-name').textContent = canvas.name;
      item.querySelector('.canvas-meta').textContent =
        'ID: ' + canvas.canvas_id + ' · ' + dateStr +
        (isOwner ? ' · 我创建的' : '');

      const enterBtn = item.querySelector('.canvas-enter-btn');
      enterBtn.addEventListener('click', function () {
        enterCanvas(canvas);
      });

      const deleteBtn = item.querySelector('.canvas-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          handleDeleteCanvas(canvas, item);
        });
      }

      canvasItems.appendChild(item);
    });
  }

  async function handleDeleteCanvas(canvas, itemElement) {
    if (!confirm('确定要删除画布 "' + canvas.name + '" 吗？此操作不可恢复。')) {
      return;
    }

    itemElement.style.opacity = '0.5';
    itemElement.style.pointerEvents = 'none';

    try {
      await apiRequest('DELETE', '/canvases/' + encodeURIComponent(canvas.canvas_id));
      itemElement.remove();

      if (canvasItems.children.length === 0) {
        canvasItems.innerHTML = '<p style="color:#64748b;text-align:center;padding:20px;">还没有画布，创建一个开始吧！</p>';
      }
    } catch (err) {
      itemElement.style.opacity = '1';
      itemElement.style.pointerEvents = 'auto';
      alert('删除失败: ' + err.message);
    }
  }

  // ==================== 创建画布 ====================

  async function handleCreateCanvas() {
    const name = newCanvasName.value.trim();
    createCanvasBtn.disabled = true;
    createCanvasBtn.textContent = '创建中...';

    try {
      const data = await apiRequest('POST', '/canvases', { name: name || undefined });
      const canvas = data.data;
      newCanvasName.value = '';
      showCanvasList();
    } catch (err) {
      alert('创建画布失败: ' + err.message);
    } finally {
      createCanvasBtn.disabled = false;
      createCanvasBtn.textContent = '创建新画布';
    }
  }

  // ==================== 进入画布 ====================

  function enterCanvas(canvas) {
    showOnly('draw');
    window.SyncCanvasDraw.openCanvas(canvas.canvas_id, canvas.name);
  }

  // ==================== 事件绑定 ====================

  if (loginForm) {
    loginForm.addEventListener('submit', handleAuth);
  }

  if (loginToggle) {
    loginToggle.addEventListener('click', toggleLoginMode);
  }

  if (createCanvasBtn) {
    createCanvasBtn.addEventListener('click', handleCreateCanvas);
  }

  if (newCanvasName) {
    newCanvasName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        handleCreateCanvas();
      }
    });
  }

  if (backToListBtn) {
    backToListBtn.addEventListener('click', function () {
      window.SyncCanvasDraw.disconnectCanvas();
      showCanvasList();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }

  // ==================== 初始化 ====================

  // 如果有保存的 token，显示画布列表
  if (loadAuth() && token) {
    showCanvasList();
  } else {
    showOnly('login');
  }

  // 暴露给全局
  window.SyncCanvasApp = {
    logout: logout,
    showCanvasList: showCanvasList,
    refreshCanvases: showCanvasList,
    getToken: function () { return token; },
    getCurrentUser: function () { return currentUser; },
    isLoggedIn: function () { return !!token; }
  };
}());
