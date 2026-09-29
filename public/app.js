const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const BASE_PATH = String(window.__BASE_PATH__ || '').replace(/\/$/, '');

const state = {
  user: null,
  csrfToken: null,
  view: 'collect',
  stats: null,
  sources: [],
  contributions: [],
  documents: [],
  aggregates: [],
  users: [],
  invites: [],
  importRuns: [],
  sourceDashboard: [],
  policies: [],
  facets: { provinces: [], cities: [], districts: [], categories: [] },
  filters: { province: '', city: '', district: '', category: '', q: '' },
  preview: null,
  policyQuery: '',
  selected: null,
  filter: '',
  loading: false,
};

const STATUS_LABELS = {
  draft: '草稿',
  submitted: '待审核',
  in_review: '审核中',
  changes_requested: '需修改',
  approved: '已发布',
  rejected: '已驳回',
};

const ROLE_LABELS = { admin: '管理员', reviewer: '审核员', contributor: '贡献者', viewer: '只读' };
const LEVEL_LABELS = { national: '国家级', province: '省级', city: '市级', district: '区县级', other: '其他' };
const AMOUNT_LABELS = { percent: '按比例', fixed: '固定金额', tiered: '分档金额', other: '其他', unknown: '待确认' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function badge(value) {
  return `<span class="badge ${esc(value)}">${esc(STATUS_LABELS[value] || value)}</span>`;
}

function toast(message, type = '') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => { toastEl.className = 'toast'; }, 4200);
}

async function api(path, options = {}) {
  const config = { credentials: 'same-origin', ...options };
  const method = String(config.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method) && state.csrfToken) {
    config.headers = { 'X-CSRF-Token': state.csrfToken, ...(config.headers || {}) };
  }
  if (config.body && !(config.body instanceof FormData) && typeof config.body !== 'string') {
    config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
    config.body = JSON.stringify(config.body);
  }
  const requestPath = /^https?:\/\//i.test(path)
    ? path
    : `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(requestPath, config);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? `：${payload.details.join('；')}` : '';
    throw new Error(`${payload.error || `请求失败 (${response.status})`}${details}`);
  }
  return payload;
}

async function refresh() {
  const tasks = [
    api('/api/stats'),
    api('/api/sources'),
    api('/api/contributions'),
    api('/api/documents'),
    api('/api/aggregates'),
    api('/api/source-dashboard'),
    api('/api/policies'),
  ];
  if (state.user && state.user.role === 'admin') tasks.push(api('/api/users'), api('/api/import-runs'), api('/api/invites'));
  const [stats, sources, contributions, documents, aggregates, sourceDashboard, policies, users, importRuns, invites] = await Promise.all(tasks);
  state.stats = stats;
  state.sources = sources.sources || [];
  state.contributions = contributions.contributions || [];
  state.documents = documents.documents || [];
  state.aggregates = aggregates.aggregates || [];
  if (users) state.users = users.users || [];
  if (importRuns) state.importRuns = importRuns.importRuns || [];
  if (invites) state.invites = invites.invites || [];
  state.sourceDashboard = sourceDashboard.sources || [];
  state.policies = sourceDashboard.policies || policies.policies || [];
  state.facets = sourceDashboard.facets || state.facets;
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-wrap">
      <section class="auth-card">
        <div class="brand-mark">补</div>
        <h1>国补协作库</h1>
        <p class="subtitle">搜索国补页面、解析政策内容、导入数据库。</p>
        <form id="login-form" class="grid">
          <div class="field"><label>用户名</label><input name="username" autocomplete="username" required></div>
          <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary" type="submit">登录</button>
        </form>
        <div class="auth-switch"><span>第一次使用？</span><button type="button" data-action="show-register">注册协作账号</button></div>
        <form id="register-form" class="grid hidden" style="margin-top:18px">
          <div class="field"><label>用户名</label><input name="username" autocomplete="username" required placeholder="3-40 位字母数字"></div>
          <div class="field"><label>显示名称</label><input name="displayName" required placeholder="例如：政策组小李"></div>
          <div class="field"><label>密码</label><input name="password" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="hint">当前为统一用户模式，注册后即可使用全部功能。</div>
          <button class="btn primary" type="submit">注册</button>
        </form>
      </section>
    </div>`;
}

function navItems() {
  return [
    ['sources', '数据源', state.sources.length],
    ['collect', '网页采集', ''],
    ['source-dashboard', '已有数据源看板', state.policies.length],
  ];
}

function shell(content, title, subtitle) {
  const nav = navItems().map(([key, label, count]) => `
    <button data-action="nav" data-view="${key}" class="${state.view === key ? 'active' : ''}">
      <span>${esc(label)}</span>${count ? `<span class="nav-count">${esc(count)}</span>` : ''}
    </button>`).join('');
  return `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">补</div><div><strong>国补协作库</strong><small>证据优先 · 多人审核</small></div></div>
        <nav class="nav">${nav}</nav>
        <div class="sidebar-footer">
          <div class="user-chip"><div class="avatar">${esc((state.user?.displayName || '?').slice(0, 1))}</div><div><strong>${esc(state.user?.displayName)}</strong><small>统一用户</small></div></div>
          <div class="sidebar-actions"><button class="btn small" data-action="refresh">刷新</button><button class="btn small" data-action="change-password">密码</button><button class="btn small ghost" data-action="logout">退出</button></div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="topbar-actions"><button class="btn primary" data-action="nav" data-view="collect">＋ 新增采集</button></div></header>
        ${content}
      </main>
    </div>`;
}

function renderDashboard() {
  const statuses = state.stats?.byStatus || {};
  const recent = state.stats?.recent || [];
  return shell(`
    <div class="grid four">
      <div class="stat accent"><div class="label">已发布政策</div><div class="value">${esc(state.stats?.policies || 0)}</div></div>
      <div class="stat"><div class="label">贡献记录</div><div class="value">${esc(state.stats?.contributions || 0)}</div></div>
      <div class="stat"><div class="label">待处理</div><div class="value">${esc((statuses.submitted || 0) + (statuses.in_review || 0))}</div></div>
      <div class="stat"><div class="label">原始文档</div><div class="value">${esc(state.stats?.documents || 0)}</div></div>
    </div>
    <section class="card" style="margin-top:18px">
      <div class="card-title"><div><h2>官方公开执行数据</h2><p>只展示政府公开披露的总额、销售额和受益人数，不与单条政策上限混算。</p></div></div>
      <div class="grid three">${state.aggregates.length ? state.aggregates.map((item) => {
        const value = item.metricType === 'beneficiary_count'
          ? `${Number(item.countValue / 100000000).toFixed(2)} 亿人次`
          : item.amountYuan >= 100000000
            ? `${Number(item.amountYuan / 100000000).toFixed(2)} 亿元`
            : `${Number(item.amountYuan).toLocaleString('zh-CN')} 元`;
        const label = { allocated_funds: '已下达资金', disbursed_funds: '已发放金额', driven_sales: '带动销售额', beneficiary_count: '惠及人数', other: '其他统计' }[item.metricType] || item.metricType;
        return `<div class="stat"><div class="label">${esc(label)} · ${esc(item.asOfDate)}</div><div class="value">${esc(value)}</div><div class="small muted">${esc(item.jurisdictionName)} · ${esc(item.program || '')}</div><div class="small" style="margin-top:8px"><a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">官方来源</a></div></div>`;
      }).join('') : '<div class="empty">暂无官方汇总统计。</div>'}</div>
    </section>
    <section class="card" style="margin-top:18px">
      <div class="card-title"><div><h2>最近协作动态</h2><p>所有新增和修改都保留审核事件。</p></div><button class="btn small" data-action="nav" data-view="review">进入审核队列</button></div>
      <div class="list">${recent.length ? recent.map((item) => `
        <div class="list-item"><div><h3>${esc(item.title)}</h3><p>${esc(item.jurisdictionName || '地区待补充')} · ${esc(item.category || '品类待补充')} · ${esc(item.userName)} · ${formatTime(item.updatedAt)}</p></div><div class="list-actions">${badge(item.status)}<button class="btn small" data-action="view-contribution" data-id="${esc(item.id)}">查看</button></div></div>
      `).join('') : '<div class="empty">还没有贡献记录，从“采集录入”开始。</div>'}</div>
    </section>`, '协作概览', '采集、校验、补充、审核集中在一个工作台。');
}

function sourceOptions() {
  return state.sources.map((source) => `<option value="${esc(source.id)}">${esc(source.name)}</option>`).join('');
}

function renderSources() {
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>登记官方数据源</h2><p>先登记来源、栏目、频率和合规说明，再发起低频采集。</p></div></div>
      <form id="source-form" class="form-grid">
        <div class="field"><label>来源名称</label><input name="name" required placeholder="例如：广东省商务厅政策公告"></div>
        <div class="field"><label>层级</label><select name="level"><option value="national">国家级</option><option value="province">省级</option><option value="city">市级</option><option value="district">区县级</option><option value="other">其他</option></select></div>
        <div class="field"><label>地区名称</label><input name="jurisdictionName" placeholder="广东省 / 广州市"></div>
        <div class="field"><label>地区编码</label><input name="jurisdictionCode" placeholder="可选，如 440000"></div>
        <div class="field"><label>来源类型</label><select name="sourceType"><option value="html_listing">HTML 栏目</option><option value="policy_page">政策详情页</option><option value="open_api">开放 API</option><option value="manual_upload">人工上传</option><option value="other">其他</option></select></div>
        <div class="field"><label>采集方式</label><select name="accessMethod"><option value="manual">手动触发</option><option value="scheduled">定时低频</option><option value="api">API 拉取</option></select></div>
        <div class="field"><label>频率</label><select name="frequency"><option value="weekly">每周</option><option value="daily">每天</option><option value="monthly">每月</option><option value="manual">仅手动</option></select></div>
        <div class="field"><label>站点首页</label><input name="baseUrl" type="url" placeholder="https://..."></div>
        <div class="field full"><label>栏目 / API 地址</label><input name="listingUrl" type="url" placeholder="要低频监测的公告栏目或开放数据接口"></div>
        <div class="field full"><label>合规说明</label><textarea name="complianceNote" placeholder="例如：仅采集公开政策公告，不抓取个人申领信息；频率每周一次。"></textarea></div>
        <div class="full actions"><button class="btn primary" type="submit">保存数据源</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>数据源台账</h2><p>${state.sources.length} 个来源</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>来源</th><th>类型</th><th>频率</th><th>最近采集</th><th>操作</th></tr></thead><tbody>
      ${state.sources.length ? state.sources.map((source) => `<tr><td><div class="title">${esc(source.name)}</div><div class="meta">${esc(LEVEL_LABELS[source.level] || source.level)} · ${esc(source.jurisdictionName || '未知地区')}</div></td><td>${esc(source.sourceType)}<div class="meta">${source.listingUrl ? `<a href="${esc(source.listingUrl)}" target="_blank" rel="noreferrer">打开栏目</a>` : '未配置地址'}</div></td><td>${esc(source.frequency)}</td><td>${formatTime(source.lastFetchedAt)}</td><td><div class="list-actions"><button class="btn small" data-action="poll-source" data-id="${esc(source.id)}">立即采集</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty">尚未登记数据源。</td></tr>'}
      </tbody></table></div>
    </section>`, '数据源台账', '把“去哪里找、多久找一次、是否允许采集”变成可执行配置。');
}

function renderSourcesV2() {
  const intervalLabel = (source) => source.intervalMinutes
    ? `${source.intervalMinutes} 分钟`
    : { daily: '每天', weekly: '每周', monthly: '每月', manual: '手动' }[source.frequency] || source.frequency;
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>定时抓取任务</h2><p>配置网站栏目、抓取间隔、地区和关键词，系统会自动抓取并解析。</p></div></div>
      <form id="source-form" class="form-grid">
        <div class="field"><label>任务名称</label><input name="name" required placeholder="例如：广东省商务厅政策公告"></div>
        <div class="field"><label>网站栏目 URL</label><input name="listingUrl" type="url" required placeholder="https://..."></div>
        <div class="field"><label>行政层级</label><select name="level"><option value="national">国家级</option><option value="province">省级</option><option value="city">市级</option><option value="district">区县级</option><option value="other">其他</option></select></div>
        <div class="field"><label>地区</label><input name="jurisdictionName" placeholder="广东省 / 广州市"></div>
        <div class="field"><label>品类</label><input name="category" placeholder="家电、汽车、数码、农机"></div>
        <div class="field"><label>关注关键词</label><input name="keywords" placeholder="以旧换新, 补贴, 国补"></div>
        <div class="field"><label>抓取间隔</label><select name="intervalMinutes"><option value="30">30 分钟</option><option value="60">1 小时</option><option value="360">6 小时</option><option value="720">12 小时</option><option value="1440" selected>每天</option><option value="10080">每周</option></select></div>
        <div class="field"><label>启用状态</label><select name="enabled"><option value="1">启用</option><option value="0">停用</option></select></div>
        <input type="hidden" name="accessMethod" value="scheduled">
        <input type="hidden" name="frequency" value="daily">
        <input type="hidden" name="sourceType" value="html_listing">
        <div class="field full"><label>站点首页（可选）</label><input name="baseUrl" type="url" placeholder="https://..."></div>
        <div class="field full"><label>备注</label><textarea name="complianceNote" placeholder="记录来源说明、访问频率限制和负责人。"></textarea></div>
        <div class="full actions"><button class="btn primary" type="submit">保存定时任务</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>定时任务列表</h2><p>${state.sources.length} 个任务</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>任务 / 地址</th><th>地区 / 品类</th><th>间隔</th><th>下次执行</th><th>最近状态</th><th>操作</th></tr></thead><tbody>
      ${state.sources.length ? state.sources.map((source) => `<tr><td><div class="title">${esc(source.name)}</div><div class="meta truncate">${esc(source.listingUrl || '未配置 URL')}</div></td><td>${esc(source.jurisdictionName || '—')}<div class="meta">${esc(source.category || '—')}</div></td><td>${esc(intervalLabel(source))}</td><td>${formatTime(source.nextFetchAt)}</td><td>${source.enabled ? '<span class="badge approved">启用</span>' : '<span class="badge rejected">停用</span>'}${source.lastRunStatus ? `<div class="meta">${esc(source.lastRunStatus === 'success' ? '成功' : '失败')} · ${formatTime(source.lastFetchedAt)}</div>` : ''}${source.lastError ? `<div class="meta">${esc(source.lastError)}</div>` : ''}</td><td><div class="list-actions"><select data-action="set-source-interval" data-id="${esc(source.id)}" title="设置抓取间隔"><option value="">设置间隔</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="360">6 小时</option><option value="720">12 小时</option><option value="1440">每天</option><option value="10080">每周</option></select><button class="btn small primary" data-action="poll-source" data-id="${esc(source.id)}">立即运行</button><button class="btn small" data-action="toggle-source" data-id="${esc(source.id)}" data-enabled="${source.enabled ? '1' : '0'}">${source.enabled ? '停用' : '启用'}</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">还没有定时任务。</td></tr>'}
      </tbody></table></div>
    </section>`, '定时抓取任务', '设置网站抓取周期，自动解析国补相关内容');
}

function renderCollect() {
  return shell(`
    <div class="grid two">
      <section class="card">
        <div class="card-title"><div><h2>从公开 URL 采集</h2><p>只允许公开 http/https 地址，系统会阻挡内网和保留地址。</p></div></div>
        <form id="collect-form" class="grid">
          <div class="field"><label>官方公告或开放接口 URL</label><input name="url" type="url" required placeholder="https://..."></div>
          <div class="field"><label>关联数据源（可选）</label><select name="sourceId"><option value="">不关联</option>${sourceOptions()}</select></div>
          <div class="notice">系统会保存原始快照、计算哈希、阻止重复文件，并自动解析 HTML / PDF / Word / CSV / JSON。</div>
          <button class="btn primary" type="submit">低频采集并解析</button>
        </form>
      </section>
      <section class="card">
        <div class="card-title"><div><h2>人工上传原始文件</h2><p>适合政务站点不便自动访问，或文件来自内部共享。</p></div></div>
        <form id="upload-form" class="grid">
          <div class="field"><label>选择 PDF / Word / HTML / TXT</label><input name="file" type="file" accept=".pdf,.doc,.docx,.html,.htm,.txt,.csv,.json" required></div>
          <div class="field"><label>文件标题（可选）</label><input name="title" placeholder="会用于创建贡献草稿"></div>
          <button class="btn primary" type="submit">上传并自动解析</button>
        </form>
      </section>
    </div>
    <section class="card">
      <div class="card-title"><div><h2>最近采集文档</h2><p>解析状态、哈希和原文路径均可追溯。</p></div><button class="btn small" data-action="nav" data-view="documents">查看全部文档</button></div>
      <div class="table-wrap"><table><thead><tr><th>标题</th><th>状态</th><th>类型</th><th>采集时间</th></tr></thead><tbody>
      ${state.documents.slice(0, 10).map((doc) => `<tr><td><div class="title">${esc(doc.title || doc.url || '未命名文档')}</div><div class="meta truncate">${esc(doc.url || doc.rawPath || '')}</div></td><td>${badge(doc.status)}</td><td>${esc(doc.mimeType || '—')}</td><td>${formatTime(doc.createdAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无文档。</td></tr>'}
      </tbody></table></div>
    </section>`, '采集录入', '公开链接、人工文件、开放接口统一进入快照和解析队列。');
}

function previewField(document, name) {
  return document?.extracted?.fields?.[name]?.value;
}

function splitGeoName(name) {
  const text = String(name || '').replace(/\s+/g, '').replace(/／/g, '/');
  const province = text.match(/([^/]+?(?:省|自治区|特别行政区|北京市|上海市|天津市|重庆市))/)?.[1] || (text.includes('全国') ? '全国' : '');
  const city = text.match(/([^/]+?市)/)?.[1] || '';
  const district = text.match(/([^/]+?(?:区|县|旗))/)?.[1] || '';
  return { province, city, district };
}

function renderPreview(document) {
  if (!document) return '';
  const relevance = document.extracted?.relevance || {};
  const levelLabel = { high: '高度相关', medium: '可能相关', low: '弱相关', none: '未匹配' }[relevance.level] || '未匹配';
  const fields = document.extracted?.fields || {};
  const evidence = document.extracted?.evidence || [];
  const warnings = document.extracted?.warnings || [];
  return `
    <section class="card">
      <div class="card-title"><div><h2>国补识别预展</h2><p>确认解析结果后导入数据库。</p></div><div class="list-actions"><span class="badge ${relevance.isRelated ? 'approved' : 'rejected'}">${esc(levelLabel)} · ${esc(relevance.score || 0)} 分</span><span class="badge processed">${esc(STATUS_LABELS[document.status] || document.status)}</span></div></div>
      <div class="detail-grid">
        <div>
          <dl class="kv">
            <dt>页面标题</dt><dd>${esc(document.title || fields.title?.value || '—')}</dd>
            <dt>发布机关</dt><dd>${esc(fields.issuer?.value || '—')}</dd>
            <dt>适用地区</dt><dd>${esc(fields.jurisdiction_name?.value || '—')}</dd>
            <dt>适用品类</dt><dd>${esc(fields.category?.value || '—')}</dd>
            <dt>金额规则</dt><dd>${fields.rate?.value != null ? `按比例 ${esc(fields.rate.value)}%` : ''}${fields.amount_value?.value != null ? `固定 ${esc(fields.amount_value.value)} 元` : ''}${fields.cap_amount?.value != null ? ` · 上限 ${esc(fields.cap_amount.value)} 元` : ''}${fields.rate?.value == null && fields.amount_value?.value == null && fields.cap_amount?.value == null ? '—' : ''}</dd>
            <dt>有效期</dt><dd>${esc(fields.effective_from?.value || '—')} → ${esc(fields.effective_to?.value || '—')}</dd>
            <dt>原文链接</dt><dd>${document.url ? `<a href="${esc(document.url)}" target="_blank" rel="noreferrer">${esc(document.url)}</a>` : '—'}</dd>
          </dl>
          ${relevance.summary ? `<div class="notice ${relevance.isRelated ? 'success' : 'warn'}">${esc(relevance.summary)}</div>` : ''}
          ${warnings.length ? `<div class="notice warn" style="margin-top:10px">${warnings.map(esc).join('；')}</div>` : ''}
          <div class="actions"><button class="btn primary" data-action="import-preview" data-id="${esc(document.id)}" ${relevance.isRelated ? '' : 'disabled'}>导入数据库</button><button class="btn" data-action="parse-document" data-id="${esc(document.id)}">重新解析</button><button class="btn ghost" data-action="discard-preview">取消预展</button></div>
        </div>
        <div>
          <h3 style="margin-top:0">原文证据</h3>
          ${evidence.length ? evidence.slice(0, 8).map((item) => `<div class="evidence">${esc(item.quote || '')}<small>${esc(item.field_name)} · 第 ${esc(item.page_number || '?')} 页 · 置信度 ${esc(item.confidence ?? '—')}</small></div>`).join('') : '<div class="notice">未抽取到字段级引文。</div>'}
          <p class="muted small">解析字符数：${esc(document.extracted?.text_chars || 0)}</p>
        </div>
      </div>
    </section>`;
}

function renderInterpretationPreview(document) {
  if (!document) return '';
  const relevance = document.extracted?.relevance || {};
  const fields = document.extracted?.fields || {};
  const evidence = document.extracted?.evidence || [];
  const warnings = document.extracted?.warnings || [];
  const geo = splitGeoName(fields.jurisdiction_name?.value);
  const levelLabel = { high: '高度相关', medium: '可能相关', low: '弱相关', none: '未匹配' }[relevance.level] || '未匹配';
  return `
    <section class="card">
      <div class="card-title"><div><h2>网站解读展览</h2><p>确认以下字段后导入数据库。</p></div><div class="list-actions"><span class="badge ${relevance.isRelated ? 'approved' : 'rejected'}">${esc(levelLabel)} · ${esc(relevance.score || 0)} 分</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>补贴名称</th><th>资金来源</th><th>补贴品类</th><th>补贴省</th><th>补贴市</th><th>补贴比例</th><th>补贴上限金额</th><th>开始时间</th><th>结束时间</th><th>官方文件</th></tr></thead><tbody><tr>
        <td class="mono">${esc(String(document.id || '').slice(0, 8))}</td>
        <td><div class="title">${esc(fields.title?.value || document.title || '—')}</div></td>
        <td>${esc(fields.funding_source?.value || '未在原文中明确')}</td>
        <td>${esc(fields.category?.value || '—')}</td>
        <td>${esc(geo.province || '—')}</td>
        <td>${esc(geo.city || '—')}</td>
        <td>${fields.rate?.value != null ? `${esc(fields.rate.value)}%` : '—'}</td>
        <td>${fields.cap_amount?.value != null ? `${esc(fields.cap_amount.value)} 元` : '—'}</td>
        <td>${esc(fields.effective_from?.value || '—')}</td>
        <td>${esc(fields.effective_to?.value || '—')}</td>
        <td>${document.url ? `<a href="${esc(document.url)}" target="_blank" rel="noreferrer">查看原文</a>` : '—'}</td>
      </tr></tbody></table></div>
      ${relevance.summary ? `<div class="notice ${relevance.isRelated ? 'success' : 'warn'}" style="margin-top:12px">${esc(relevance.summary)}</div>` : ''}
      ${warnings.length ? `<div class="notice warn" style="margin-top:10px">${warnings.map(esc).join('；')}</div>` : ''}
      <div class="grid two" style="margin-top:16px">
        <div><h3>原文证据</h3>${evidence.length ? evidence.slice(0, 8).map((item) => `<div class="evidence">${esc(item.quote || '')}<small>${esc(item.field_name)} · 第 ${esc(item.page_number || '?')} 页</small></div>`).join('') : '<div class="notice">未抽取到字段级引文。</div>'}</div>
        <div><h3>操作</h3><div class="actions"><button class="btn primary" data-action="import-preview" data-id="${esc(document.id)}" ${relevance.isRelated ? '' : 'disabled'}>导入数据库</button><button class="btn" data-action="parse-document" data-id="${esc(document.id)}">重新解析</button><button class="btn ghost" data-action="discard-preview">取消展览</button></div><p class="muted small">解析字符数：${esc(document.extracted?.text_chars || 0)}</p></div>
      </div>
    </section>`;
}

function renderCollectV2() {
  const recent = state.documents.slice(0, 8);
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>输入网址，自动识别国补页面</h2><p>系统会抓取公开页面、识别国补相关度、解析政策字段并生成预展。</p></div></div>
      <form id="collect-form" class="grid">
        <div class="field"><label>官方公告或政策页面 URL</label><input name="url" type="url" required placeholder="https://www.gov.cn/..."></div>
        <div class="field"><label>关联已有数据源（可选）</label><select name="sourceId"><option value="">不关联</option>${sourceOptions()}</select></div>
        <div class="notice">只抓取公开页面；不会绕过登录、验证码或访问控制。识别和解析结果先进入预展，不会直接写入数据库。</div>
        <button class="btn primary" type="submit">识别并生成预展</button>
      </form>
    </section>
    ${renderInterpretationPreview(state.preview)}
    <section class="card">
      <div class="card-title"><div><h2>最近采集页面</h2><p>${recent.length} 条最近快照</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>标题</th><th>识别结果</th><th>解析状态</th><th>采集时间</th><th>操作</th></tr></thead><tbody>
      ${recent.length ? recent.map((doc) => `<tr><td><div class="title">${esc(doc.title || doc.url || '未命名页面')}</div><div class="meta truncate">${esc(doc.url || '')}</div></td><td>${doc.extracted?.relevance ? `<span class="badge ${doc.extracted.relevance.isRelated ? 'approved' : 'rejected'}">${esc(doc.extracted.relevance.score || 0)} 分</span>` : '—'}</td><td>${badge(doc.status)}</td><td>${formatTime(doc.createdAt)}</td><td><button class="btn small" data-action="preview-document" data-id="${esc(doc.id)}">查看预展</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">还没有采集页面。</td></tr>'}
      </tbody></table></div>
    </section>`, '网页采集', 'URL → 国补识别 → 内容解析 → 预展确认 → 导入数据库');
}

function renderSourceDashboard() {
  const filters = state.filters || { province: '', city: '', district: '', category: '', q: '' };
  const list = state.policies || [];
  const option = (values, selected) => `<option value="">全部</option>${values.map((value) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>已有数据源看板</h2><p>查看数据源采集情况、最近更新和已入库政策。</p></div></div>
      <div class="grid four">
        <div class="stat accent"><div class="label">数据源</div><div class="value">${esc(state.sourceDashboard.length)}</div></div>
        <div class="stat"><div class="label">政策记录</div><div class="value">${esc(state.policies.length)}</div></div>
        <div class="stat"><div class="label">原始文档</div><div class="value">${esc(state.documents.length)}</div></div>
        <div class="stat"><div class="label">采集数据源</div><div class="value">${esc(state.sourceDashboard.filter((item) => item.documentCount > 0).length)}</div></div>
      </div>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>筛选已有数据</h2><p>按省、市、区县、品类和相关性内容筛选。</p></div></div>
      <form id="source-dashboard-filter-form" class="form-grid">
        <div class="field"><label>省 / 直辖市</label><select name="province">${option(state.facets.provinces || [], filters.province)}</select></div>
        <div class="field"><label>市</label><select name="city">${option(state.facets.cities || [], filters.city)}</select></div>
        <div class="field"><label>区县</label><select name="district">${option(state.facets.districts || [], filters.district)}</select></div>
        <div class="field"><label>品类</label><select name="category">${option(state.facets.categories || [], filters.category)}</select></div>
        <div class="field full"><label>相关内容关键词</label><input name="q" value="${esc(filters.q || '')}" placeholder="例如：以旧换新、汽车、补贴、家电"></div>
        <div class="full actions"><button class="btn primary" type="submit">筛选看板</button><button class="btn" type="button" data-action="clear-dashboard-filter">清空筛选</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>数据源状态</h2><p>来源、采集频率、文档数和已入库政策数。</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>来源</th><th>层级 / 地区</th><th>类型</th><th>采集</th><th>文档</th><th>已入库</th><th>最近更新</th></tr></thead><tbody>
      ${state.sourceDashboard.length ? state.sourceDashboard.map((item) => `<tr><td><div class="title">${esc(item.name)}</div><div class="meta truncate">${esc(item.listingUrl || item.baseUrl || '')}</div></td><td>${esc(LEVEL_LABELS[item.level] || item.level)}<div class="meta">${esc(item.jurisdictionName || '—')}</div></td><td>${esc(item.sourceType)}</td><td>${esc(item.intervalMinutes ? `${item.intervalMinutes} 分钟` : item.frequency)}<div class="meta">${formatTime(item.lastFetchedAt)}</div></td><td>${esc(item.documentCount || 0)}</td><td>${esc(item.importedCount || 0)}</td><td>${formatTime(item.lastDocumentAt)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">还没有数据源。</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>已入库相关内容</h2><p>按省市区、品类和相关内容筛选后的政策列表。</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>补贴名称</th><th>资金来源</th><th>补贴品类</th><th>补贴省</th><th>补贴市</th><th>补贴比例</th><th>补贴上限金额</th><th>开始时间</th><th>结束时间</th><th>官方文件</th></tr></thead><tbody>
      ${list.length ? list.map((item) => `<tr><td class="mono">${esc(String(item.id || '').slice(0, 8))}</td><td><div class="title">${esc(item.title)}</div><div class="meta truncate">${esc(item.contentSnippet || '')}</div></td><td>${esc(item.fundingSource || '未在原文中明确')}</td><td>${esc(item.category || '—')}</td><td>${esc(item.geo?.province || '—')}</td><td>${esc(item.geo?.city || '—')}</td><td>${item.rate != null ? `${esc(item.rate)}%` : '—'}</td><td>${item.capAmount != null ? `${esc(item.capAmount)} 元` : '—'}</td><td>${esc(item.effectiveFrom || '—')}</td><td>${esc(item.effectiveTo || '—')}</td><td>${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">查看原文</a>` : '—'}</td></tr>`).join('') : '<tr><td colspan="11" class="empty">没有匹配内容。</td></tr>'}
      </tbody></table></div>
    </section>`, '已有数据源看板', '数据源、采集文档和已入库政策的统一视图。');
}

function renderContributions() {
  const list = state.contributions.filter((item) => !state.filter || item.status === state.filter || item.title.includes(state.filter));
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>补充一条政策</h2><p>可先存草稿；提交后进入审核队列，金额和日期会被规则校验。</p></div></div>
      <form id="contribution-form" class="form-grid">
        <div class="field full"><label>政策标题</label><input name="title" required placeholder="例如：广东省2026年家电以旧换新实施细则"></div>
        <div class="field"><label>政策主题</label><input name="program" placeholder="消费品以旧换新"></div>
        <div class="field"><label>政策层级</label><select name="policyLevel"><option value="">待确认</option><option value="national">国家级</option><option value="province">省级</option><option value="city">市级</option><option value="district">区县级</option><option value="other">其他</option></select></div>
        <div class="field"><label>发布机关</label><input name="issuer" placeholder="广东省商务厅"></div>
        <div class="field"><label>适用地区</label><input name="jurisdictionName" placeholder="广东省 / 广州市"></div>
        <div class="field"><label>地区编码</label><input name="jurisdictionCode" placeholder="可选"></div>
        <div class="field"><label>适用品类</label><input name="category" placeholder="家电、汽车、数码"></div>
        <div class="field"><label>金额类型</label><select name="amountType"><option value="unknown">待确认</option><option value="percent">按比例</option><option value="fixed">固定金额</option><option value="tiered">分档金额</option><option value="other">其他</option></select></div>
        <div class="field"><label>补贴比例（%）</label><input name="rate" type="number" min="0" max="100" step="0.01"></div>
        <div class="field"><label>固定金额（元）</label><input name="amountValue" type="number" min="0" step="0.01"></div>
        <div class="field"><label>最高补贴金额（元）</label><input name="capAmount" type="number" min="0" step="0.01"></div>
        <div class="field"><label>生效日期</label><input name="effectiveFrom" type="date"></div>
        <div class="field"><label>截止日期</label><input name="effectiveTo" type="date"></div>
        <div class="field full"><label>官方来源链接</label><input name="sourceUrl" type="url" placeholder="https://..."></div>
        <div class="field full"><label>原始文件（可选）</label><input name="file" type="file" accept=".pdf,.doc,.docx,.html,.htm,.txt,.csv,.json"><div class="hint">上传后会自动解析候选字段，原文和哈希会保留。</div></div>
        <div class="field full"><label>补充说明</label><textarea name="notes" placeholder="记录叠加上限、申领条件、适用门店/平台、口径差异等。"></textarea></div>
        <div class="full"><label class="checkline"><input type="checkbox" name="autoFetch" value="1" checked> 没有上传文件时，尝试从来源链接抓取快照并自动解析</label></div>
        <div class="full actions"><button class="btn" type="submit" name="mode" value="draft">保存草稿</button><button class="btn primary" type="submit" name="mode" value="submit">保存并提交审核</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>贡献记录</h2><p>${list.length} 条</p></div><div class="topbar-actions"><input id="contribution-filter" value="${esc(state.filter)}" placeholder="筛选标题 / 状态" style="width:220px"><button class="btn small" data-action="clear-filter">清空</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>政策</th><th>地区 / 品类</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
      ${list.length ? list.map((item) => `<tr><td><div class="title">${esc(item.title)}</div><div class="meta">${esc(item.sourceUrl || '暂无来源链接')}</div></td><td>${esc(item.jurisdictionName || '—')}<div class="meta">${esc(item.category || '—')}</div></td><td>${badge(item.status)}</td><td>${formatTime(item.updatedAt)}</td><td><button class="btn small" data-action="view-contribution" data-id="${esc(item.id)}">查看 / 补充</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">还没有贡献记录。</td></tr>'}
      </tbody></table></div>
    </section>`, '我的贡献', '多人补充同一政策时，系统会提示潜在重复项并保留各自证据。');
}

function pendingContributions() {
  return state.contributions.filter((item) => ['submitted', 'in_review'].includes(item.status));
}

function renderReview() {
  const rows = pendingContributions();
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>审核队列</h2><p>${rows.length} 条待处理。只有审核员和管理员可以处理。</p></div></div>
      <div class="list">${rows.length ? rows.map((item) => `
        <div class="list-item"><div><h3>${esc(item.title)}</h3><p>${esc(item.jurisdictionName || '地区待补充')} · ${esc(item.category || '品类待补充')} · ${esc(item.issuer || '发布机关待补充')}</p><p class="small">来源：${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">${esc(item.sourceUrl)}</a>` : '未填写'}</p></div><div class="list-actions">${badge(item.status)}<button class="btn small primary" data-action="view-contribution" data-id="${esc(item.id)}">进入审核</button></div></div>
      `).join('') : '<div class="empty">当前没有待审核记录。</div>'}</div>
    </section>
    <section class="card"><div class="card-title"><div><h2>已发布政策</h2><p>审核通过后会进入这里，并按生效/失效展示。</p></div><button class="btn small" data-action="nav" data-view="dashboard">返回概览</button></div><div id="published-list" class="list"><div class="empty">加载中…</div></div></section>`, '审核队列', '审核动作会写入事件时间线，并保留原始证据。');
}

function renderDocuments() {
  return shell(`
    <section class="card">
      <div class="card-title"><div><h2>原始文档与解析状态</h2><p>${state.documents.length} 个快照。发现重复内容时不会重复保存文件。</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>文档</th><th>状态</th><th>解析结果</th><th>时间</th><th>操作</th></tr></thead><tbody>
      ${state.documents.length ? state.documents.map((doc) => `<tr><td><div class="title">${esc(doc.title || '未命名文档')}</div><div class="meta truncate">${esc(doc.url || doc.rawPath || '')}</div><div class="meta mono">${esc(doc.contentHash || '')}</div></td><td>${badge(doc.status)}<div class="meta">${doc.error ? esc(String(doc.error).slice(0, 100)) : ''}</div></td><td>${esc(doc.extracted?.text_chars || 0)} 字<div class="meta">${esc(doc.extracted?.warnings?.[0] || '')}</div></td><td>${formatTime(doc.createdAt)}</td><td><div class="list-actions">${doc.status === 'discovered' ? `<button class="btn small primary" data-action="fetch-document" data-id="${esc(doc.id)}">抓取</button>` : ''}<button class="btn small" data-action="parse-document" data-id="${esc(doc.id)}">重新解析</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty">还没有文档。</td></tr>'}
      </tbody></table></div>
    </section>`, '原始文档', '网页、PDF、Word 和人工上传文件统一进入证据库。');
}

function renderAdmin() {
  return shell(`
    <div class="grid two">
      <section class="card">
        <div class="card-title"><div><h2>成员与角色</h2><p>新注册用户默认为贡献者，由管理员分配审核权限。</p></div></div>
        <div class="list">${state.users.map((user) => `<div class="list-item"><div><h3>${esc(user.displayName)}</h3><p>${esc(user.username)} · ${esc(ROLE_LABELS[user.role] || user.role)} · ${user.status === 'active' ? '正常' : '已停用'}</p></div><div class="list-actions"><select data-action="change-role" data-id="${esc(user.id)}"><option value="contributor" ${user.role === 'contributor' ? 'selected' : ''}>贡献者</option><option value="reviewer" ${user.role === 'reviewer' ? 'selected' : ''}>审核员</option><option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>只读</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option></select><button class="btn small" data-action="reset-password" data-id="${esc(user.id)}">重置密码</button><button class="btn small ${user.status === 'active' ? 'danger' : ''}" data-action="toggle-user" data-id="${esc(user.id)}" data-status="${user.status}">${user.status === 'active' ? '停用' : '启用'}</button></div></div>`).join('')}</div>
      </section>
      <section class="card">
        <div class="card-title"><div><h2>批量导入</h2><p>适合从开放平台导出 JSON / CSV 后协作补充。</p></div></div>
        <form id="import-form" class="grid"><div class="field"><label>选择 JSON 或 CSV</label><input name="file" type="file" accept=".json,.csv" required></div><div class="notice">每行至少包含 title；支持 program、issuer、jurisdictionName、category、amountType、rate、amountValue、capAmount、sourceUrl 等字段。</div><button class="btn primary" type="submit">导入为贡献草稿</button></form>
      </section>
      <section class="card">
        <div class="card-title"><div><h2>生成邀请码</h2><p>正式上线建议关闭自由注册，仅允许邀请加入。</p></div></div>
        <form id="invite-form" class="grid">
          <div class="field"><label>邀请角色</label><select name="role"><option value="contributor">贡献者</option><option value="reviewer">审核员</option><option value="viewer">只读</option><option value="admin">管理员</option></select></div>
          <div class="field"><label>有效期</label><input name="expiresAt" type="date"></div>
          <div class="field"><label>备注</label><input name="note" placeholder="例如：广东省政策组"></div>
          <button class="btn primary" type="submit">生成邀请码</button>
        </form>
      </section>
    </div>
    <section class="card">
      <div class="card-title"><div><h2>邀请码</h2><p>邀请码只在创建时显示，请及时发送给对应成员。</p></div></div>
      <div class="list">${state.invites.length ? state.invites.map((invite) => `<div class="list-item"><div><h3 class="mono">${esc(invite.code)}</h3><p>${esc(ROLE_LABELS[invite.role] || invite.role)} · ${esc(invite.note || '无备注')} · ${invite.expiresAt ? `有效期至 ${esc(invite.expiresAt)}` : '长期有效'}</p></div><div class="list-actions">${invite.usedBy ? `<span class="badge approved">已由 ${esc(invite.usedBy)} 使用</span>` : '<span class="badge submitted">未使用</span>'}<small class="muted">${formatTime(invite.createdAt)}</small></div></div>`).join('') : '<div class="empty">还没有邀请码。</div>'}</div>
    </section>
    <section class="card">
      <div class="card-title"><div><h2>数据包导入记录</h2><p>只记录经过校验并正式导入的数据包。</p></div></div>
      <div class="list">${state.importRuns.length ? state.importRuns.map((run) => `<div class="list-item"><div><h3>${esc(run.packId)} · v${esc(run.version)}</h3><p class="truncate">${esc(run.packPath)}</p></div><div class="list-actions"><span class="badge approved">${esc(run.summary?.policies || 0)} 政策 / ${esc(run.summary?.aggregates || 0)} 统计</span><small class="muted">${formatTime(run.createdAt)}</small></div></div>`).join('') : '<div class="empty">还没有导入记录。</div>'}</div>
    </section>`, '用户与导入', '联邦式补充数据：每个人负责来源，审核员统一口径。');
}

function reviewActions(item) {
  if (!['admin', 'reviewer'].includes(state.user?.role)) return '';
  if (!['submitted', 'in_review'].includes(item.status)) return '';
  return `<div class="actions">
    ${item.status === 'submitted' ? '<button class="btn" data-action="review" data-review="start_review" data-id="' + esc(item.id) + '">开始审核</button>' : ''}
    <button class="btn warn" data-action="review" data-review="request_changes" data-id="${esc(item.id)}">要求修改</button>
    <button class="btn danger" data-action="review" data-review="reject" data-id="${esc(item.id)}">驳回</button>
    <button class="btn primary" data-action="review" data-review="approve" data-id="${esc(item.id)}">通过并发布</button>
  </div>`;
}

function renderDetail() {
  const item = state.selected;
  if (!item) return shell('<div class="empty">记录不存在。</div>', '贡献详情', '');
  const validation = item.validation || {};
  const evidence = item.extracted?.evidence || [];
  return shell(`
    <div class="actions" style="margin-bottom:16px"><button class="btn small" data-action="nav" data-view="contributions">← 返回贡献列表</button>${badge(item.status)}</div>
    <div class="detail-grid">
      <section class="card">
        <div class="card-title"><div><h2>${esc(item.title)}</h2><p>${esc(item.program || '政策主题待补充')}</p></div></div>
        <dl class="kv">
          <dt>适用地区</dt><dd>${esc(item.jurisdictionName || '—')} ${item.jurisdictionCode ? `(${esc(item.jurisdictionCode)})` : ''}</dd>
          <dt>发布机关</dt><dd>${esc(item.issuer || '—')}</dd>
          <dt>政策层级</dt><dd>${esc(LEVEL_LABELS[item.policyLevel] || item.policyLevel || '—')}</dd>
          <dt>适用品类</dt><dd>${esc(item.category || '—')}</dd>
          <dt>金额规则</dt><dd>${esc(AMOUNT_LABELS[item.amountType] || item.amountType || '—')}${item.rate != null ? ` · ${esc(item.rate)}%` : ''}${item.amountValue != null ? ` · ${esc(item.amountValue)} 元` : ''}${item.capAmount != null ? ` · 上限 ${esc(item.capAmount)} 元` : ''}</dd>
          <dt>有效期</dt><dd>${esc(item.effectiveFrom || '—')} → ${esc(item.effectiveTo || '—')}</dd>
          <dt>来源链接</dt><dd>${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">${esc(item.sourceUrl)}</a>` : '<span class="muted">未填写</span>'}</dd>
          <dt>文档状态</dt><dd>${item.document ? `${badge(item.document.status)} <span class="muted small">${esc(item.document.rawPath || '')}</span>` : '<span class="muted">未关联文档</span>'}</dd>
          <dt>补充说明</dt><dd>${esc(item.notes || '—')}</dd>
        </dl>
        ${(validation.errors?.length || validation.warnings?.length) ? `<div style="margin-top:16px" class="grid">${validation.errors?.length ? `<div class="notice error"><strong>错误：</strong>${validation.errors.map(esc).join('；')}</div>` : ''}${validation.warnings?.length ? `<div class="notice warn"><strong>提醒：</strong>${validation.warnings.map(esc).join('；')}</div>` : ''}</div>` : ''}
        <div class="actions">
          ${['draft', 'changes_requested'].includes(item.status) && (item.userId === state.user.id || ['admin', 'reviewer'].includes(state.user.role)) ? `<button class="btn primary" data-action="submit-contribution" data-id="${esc(item.id)}">提交审核</button>` : ''}
          ${item.documentId ? `<button class="btn" data-action="parse-contribution" data-id="${esc(item.id)}">重新解析并补充字段</button>` : ''}
        </div>
        ${reviewActions(item)}
      </section>
      <section class="card">
        <div class="card-title"><div><h2>原文证据</h2><p>${evidence.length} 条字段证据</p></div></div>
        ${evidence.length ? evidence.map((itemEvidence) => `<div class="evidence">${esc(itemEvidence.quote || '')}<small>${esc(itemEvidence.field_name)} · 第 ${esc(itemEvidence.page_number || '?')} 页 · 置信度 ${esc(itemEvidence.confidence ?? '—')}</small></div>`).join('') : '<div class="notice">尚未从文档中抽取出带引文的字段。可以上传原文后重新解析。</div>'}
      </section>
    </div>
    <section class="card">
      <div class="card-title"><div><h2>协作讨论</h2><p>贡献者、审核员和后续维护者共享上下文。</p></div></div>
      <form id="comment-form" class="grid"><textarea name="body" placeholder="补充口径、指出疑点或说明修改原因"></textarea><div><button class="btn primary" type="submit">发表评论</button></div></form>
      <div class="list" style="margin-top:16px">${(item.comments || []).length ? item.comments.map((comment) => `<div class="list-item"><div><strong>${esc(comment.userName)}</strong><p>${esc(comment.body)}</p></div><small class="muted">${formatTime(comment.createdAt)}</small></div>`).join('') : '<div class="empty">还没有评论。</div>'}</div>
    </section>
    <section class="card"><div class="card-title"><div><h2>事件时间线</h2><p>谁在什么时候做了什么。</p></div></div><div class="timeline">${(item.events || []).map((event) => `<div class="timeline-item"><span class="timeline-dot"></span><div><strong>${esc(event.action)}</strong> <span class="muted">${esc(event.userName || '系统')} · ${formatTime(event.createdAt)}</span>${event.detail?.comment ? `<p>${esc(event.detail.comment)}</p>` : ''}</div></div>`).join('') || '<div class="empty">暂无事件。</div>'}</div></section>`, '贡献详情', '查看字段、证据、讨论与审核状态。');
}

function render() {
  if (!state.user) return renderAuth();
  if (state.view === 'sources') app.innerHTML = renderSourcesV2();
  else if (state.view === 'source-dashboard') app.innerHTML = renderSourceDashboard();
  else app.innerHTML = renderCollectV2();
}

async function loadPublished() {
  const target = document.getElementById('published-list');
  if (!target) return;
  try {
    const data = await api('/api/policies');
    target.innerHTML = data.policies.length ? data.policies.map((item) => `<div class="list-item"><div><h3>${esc(item.title)}</h3><p>${esc(item.jurisdictionName || '全国/未标注')} · ${esc(item.category || '品类待补充')} · ${esc(item.amountType || '金额待补充')}${item.rate != null ? ` · ${esc(item.rate)}%` : ''}${item.capAmount != null ? ` · 上限 ${esc(item.capAmount)} 元` : ''}</p></div><div class="list-actions"><span class="badge ${item.status === 'active' ? 'approved' : 'draft'}">${item.status === 'active' ? '生效中' : esc(item.status)}</span>${item.sourceUrl ? `<a class="btn small" href="${esc(item.sourceUrl)}" target="_blank" rel="noreferrer">官方原文</a>` : ''}</div></div>`).join('') : '<div class="empty">尚未发布政策。</div>';
  } catch (error) {
    target.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}

async function openContribution(id) {
  try {
    const data = await api(`/api/contributions/${id}`);
    state.selected = data.contribution;
    state.view = 'detail';
    render();
  } catch (error) { toast(error.message, 'error'); }
}

async function handleAction(action, target) {
  if (action === 'nav') {
    state.view = target.dataset.view;
    state.selected = null;
    render();
    return;
  }
  if (action === 'preview-document') {
    try {
      const result = await api(`/api/documents/${target.dataset.id}`);
      state.preview = result.document;
      state.view = 'collect';
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (action === 'discard-preview') {
    state.preview = null;
    render();
    return;
  }
  if (action === 'clear-dashboard-filter') {
    state.filters = { province: '', city: '', district: '', category: '', q: '' };
    state.policyQuery = '';
    const data = await api('/api/source-dashboard');
    state.sourceDashboard = data.sources || [];
    state.policies = data.policies || [];
    state.facets = data.facets || state.facets;
    state.view = 'source-dashboard';
    render();
    return;
  }
  if (action === 'import-preview') {
    target.disabled = true;
    try {
      const result = await api(`/api/documents/${target.dataset.id}/import`, { method: 'POST', body: {} });
      toast(result.duplicate ? '数据库中已存在相同政策' : '已导入数据库', 'success');
      state.preview = null;
      await refresh();
      state.view = 'source-dashboard';
      render();
    } catch (error) {
      toast(error.message, 'error');
      target.disabled = false;
    }
    return;
  }
  if (action === 'show-register') {
    document.getElementById('login-form')?.classList.add('hidden');
    document.getElementById('register-form')?.classList.remove('hidden');
    return;
  }
  if (action === 'refresh') {
    await refresh();
    render();
    toast('数据已刷新', 'success');
    return;
  }
  if (action === 'change-password') {
    const currentPassword = window.prompt('请输入当前密码');
    if (!currentPassword) return;
    const newPassword = window.prompt('请输入新密码（至少 8 位）');
    if (!newPassword) return;
    const confirmation = window.prompt('请再次输入新密码');
    if (confirmation !== newPassword) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      state.user = null;
      state.csrfToken = null;
      render();
      toast('密码已修改，请重新登录', 'success');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (action === 'reset-password') {
    if (state.user?.role !== 'admin') return;
    const newPassword = window.prompt('输入为该用户设置的新密码；留空则自动生成临时密码');
    try {
      const result = await api(`/api/users/${target.dataset.id}/reset-password`, { method: 'POST', body: { newPassword: newPassword || '' } });
      window.alert(`密码已重置。\n用户名：${result.user.username}\n临时密码：${result.temporaryPassword}\n请让用户登录后立即修改。`);
      await refresh(); render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (action === 'toggle-user') {
    if (state.user?.role !== 'admin') return;
    const nextStatus = target.dataset.status === 'active' ? 'disabled' : 'active';
    try {
      await api(`/api/users/${target.dataset.id}`, { method: 'PATCH', body: { status: nextStatus } });
      toast(nextStatus === 'disabled' ? '用户已停用' : '用户已启用', 'success');
      await refresh(); render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (action === 'logout') {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    state.csrfToken = null;
    render();
    return;
  }
  if (action === 'view-contribution') return openContribution(target.dataset.id);
  if (action === 'clear-filter') { state.filter = ''; render(); return; }
  if (action === 'poll-source') {
    target.disabled = true;
    target.textContent = '采集中…';
    try {
      const result = await api(`/api/sources/${target.dataset.id}/poll`, { method: 'POST' });
      toast(`采集完成，新发现 ${result.discovered} 条候选链接`, 'success');
      await refresh(); render();
    } catch (error) { toast(error.message, 'error'); target.disabled = false; target.textContent = '立即采集'; }
    return;
  }
  if (action === 'toggle-source') {
    const nextEnabled = target.dataset.enabled === '1' ? '0' : '1';
    try {
      await api(`/api/sources/${target.dataset.id}`, { method: 'PATCH', body: { enabled: nextEnabled } });
      toast(nextEnabled === '1' ? '任务已启用' : '任务已停用', 'success');
      await refresh();
      render();
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  if (action === 'fetch-document') {
    target.disabled = true; target.textContent = '抓取中…';
    try { await api(`/api/documents/${target.dataset.id}/fetch`, { method: 'POST' }); toast('抓取并解析完成', 'success'); await refresh(); render(); }
    catch (error) { toast(error.message, 'error'); target.disabled = false; target.textContent = '抓取'; }
    return;
  }
  if (action === 'parse-document' || action === 'parse-contribution') {
    target.disabled = true; target.textContent = '解析中…';
    try {
      const path = action === 'parse-document' ? `/api/documents/${target.dataset.id}/parse` : `/api/contributions/${target.dataset.id}/parse`;
      const result = await api(path, { method: 'POST' });
      if (result.contribution) state.selected = result.contribution;
      if (result.document && state.preview?.id === result.document.id) state.preview = result.document;
      toast('解析完成', 'success'); await refresh(); render();
    } catch (error) { toast(error.message, 'error'); target.disabled = false; }
    return;
  }
  if (action === 'submit-contribution') {
    target.disabled = true;
    try { const result = await api(`/api/contributions/${target.dataset.id}/submit`, { method: 'POST' }); state.selected = result.contribution; toast('已提交审核', 'success'); await refresh(); render(); }
    catch (error) { toast(error.message, 'error'); target.disabled = false; }
    return;
  }
  if (action === 'review') {
    const review = target.dataset.review;
    const comment = ['request_changes', 'reject'].includes(review) ? window.prompt(review === 'reject' ? '填写驳回原因' : '填写需要修改的内容') : '';
    if (['request_changes', 'reject'].includes(review) && !comment) return;
    target.disabled = true;
    try { const result = await api(`/api/contributions/${target.dataset.id}/review`, { method: 'POST', body: { action: review, comment } }); state.selected = result.contribution; toast(review === 'approve' ? '已通过并发布' : '审核状态已更新', 'success'); await refresh(); render(); }
    catch (error) { toast(error.message, 'error'); target.disabled = false; }
  }
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  handleAction(target.dataset.action, target).catch((error) => toast(error.message, 'error'));
});

app.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();
  try {
    if (form.id === 'login-form') {
      const data = await api('/api/auth/login', { method: 'POST', body: new FormData(form) });
      state.user = data.user; state.csrfToken = data.csrfToken; await refresh(); state.view = 'dashboard'; render(); toast('已登录', 'success'); return;
    }
    if (form.id === 'register-form') {
      const data = await api('/api/auth/register', { method: 'POST', body: new FormData(form) });
      state.user = data.user; state.csrfToken = data.csrfToken; await refresh(); state.view = 'dashboard'; render(); toast('注册成功', 'success'); return;
    }
    if (form.id === 'source-form') {
      const data = await api('/api/sources', { method: 'POST', body: new FormData(form) });
      toast(`已登记：${data.source.name}`, 'success'); await refresh(); render(); return;
    }
    if (form.id === 'collect-form') {
      const data = await api('/api/collect', { method: 'POST', body: new FormData(form) });
      state.preview = data.document;
      toast(data.duplicate ? '该文件已采集，已加载原预展' : '已识别并生成国补预展', 'success');
      await refresh();
      state.view = 'collect';
      render();
      return;
    }
    if (form.id === 'upload-form') {
      const formData = new FormData(form);
      const file = formData.get('file');
      const title = formData.get('title') || file?.name || '人工上传文档';
      const created = await api('/api/contributions', { method: 'POST', body: (() => { const body = new FormData(); body.set('title', title); body.set('notes', '人工上传'); body.set('file', file); return body; })() });
      toast('文件已上传并创建贡献草稿', 'success'); state.selected = created.contribution; state.view = 'detail'; await refresh(); render(); return;
    }
    if (form.id === 'contribution-form') {
      const formData = new FormData(form);
      const mode = event.submitter?.value || 'draft';
      if (mode === 'submit') formData.set('submit', '1');
      const data = await api('/api/contributions', { method: 'POST', body: formData });
      toast(mode === 'submit' ? '已保存并提交审核' : '草稿已保存', 'success'); state.selected = data.contribution; state.view = 'detail'; await refresh(); render(); return;
    }
    if (form.id === 'comment-form') {
      if (!state.selected) return;
      const data = await api(`/api/contributions/${state.selected.id}/comments`, { method: 'POST', body: new FormData(form) });
      state.selected = data.contribution; render(); return;
    }
    if (form.id === 'import-form') {
      const data = await api('/api/import', { method: 'POST', body: new FormData(form) });
      toast(`已导入 ${data.imported} 条贡献草稿`, 'success'); await refresh(); state.view = 'contributions'; render(); return;
    }
    if (form.id === 'invite-form') {
      const data = await api('/api/invites', { method: 'POST', body: new FormData(form) });
      window.alert(`邀请码：${data.invite.code}\n角色：${data.invite.role}\n请发送给对应成员。`);
      await refresh(); render(); return;
    }
    if (form.id === 'source-dashboard-filter-form') {
      const formData = new FormData(form);
      const filters = Object.fromEntries(['province', 'city', 'district', 'category', 'q'].map((key) => [key, String(formData.get(key) || '')]));
      state.filters = filters;
      state.policyQuery = filters.q;
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const data = await api(`/api/source-dashboard${params.size ? `?${params}` : ''}`);
      state.sourceDashboard = data.sources || [];
      state.policies = data.policies || [];
      state.facets = data.facets || state.facets;
      state.view = 'source-dashboard';
      render();
      return;
    }
  } catch (error) { toast(error.message, 'error'); }
});

app.addEventListener('change', async (event) => {
  const roleTarget = event.target.closest('[data-action="change-role"]');
  if (roleTarget) {
    try { await api(`/api/users/${roleTarget.dataset.id}`, { method: 'PATCH', body: { role: roleTarget.value } }); toast('角色已更新', 'success'); await refresh(); render(); }
    catch (error) { toast(error.message, 'error'); }
    return;
  }
  const intervalTarget = event.target.closest('[data-action="set-source-interval"]');
  if (intervalTarget && intervalTarget.value) {
    try {
      await api(`/api/sources/${intervalTarget.dataset.id}`, {
        method: 'PATCH',
        body: { intervalMinutes: Number(intervalTarget.value), accessMethod: 'scheduled', frequency: 'daily', enabled: '1' },
      });
      toast('抓取间隔已更新', 'success');
      await refresh();
      render();
    } catch (error) { toast(error.message, 'error'); }
  }
});

app.addEventListener('input', (event) => {
  if (event.target.id !== 'contribution-filter') return;
  state.filter = event.target.value;
  clearTimeout(state.filterTimer);
  state.filterTimer = setTimeout(() => render(), 220);
});

async function boot() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    state.csrfToken = data.csrfToken || null;
    if (state.user) { await refresh(); render(); } else render();
  } catch (error) {
    toast(error.message, 'error');
    render();
  }
}

boot();
