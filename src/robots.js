const robotsCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const USER_AGENT = 'GuobuHub/0.1 (+public-policy-collection; low-frequency)';

function matchRule(rulePath, requestPath) {
  if (!rulePath) return 0;
  const normalized = rulePath.replace(/\*+/g, '*');
  if (normalized === '/') return requestPath.startsWith('/') ? 1 : 0;
  const anchor = normalized.endsWith('$');
  const value = anchor ? normalized.slice(0, -1) : normalized;
  const escaped = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const pattern = new RegExp(`^${escaped}${anchor ? '$' : ''}`);
  return pattern.test(requestPath) ? value.length : 0;
}

function parseRobots(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length && rules.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === 'user-agent') {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (!agents.length) agents = ['*'];
      rules.push({ allow: key === 'allow', path: value });
    }
  }
  flush();
  return groups;
}

function selectRules(groups) {
  const exact = groups.filter((group) => group.agents.some((agent) => agent.includes('guobuhub')));
  const wildcard = groups.filter((group) => group.agents.includes('*'));
  return [...exact, ...wildcard].flatMap((group) => group.rules);
}

export async function isAllowedByRobots(rawUrl, { timeoutMs = 10000 } = {}) {
  if (process.env.ROBOTS_ENFORCEMENT === '0') return { allowed: true, reason: 'robots enforcement disabled' };
  const url = new URL(rawUrl);
  const origin = url.origin;
  const now = Date.now();
  const cached = robotsCache.get(origin);
  let rules;
  if (cached && cached.expiresAt > now) {
    rules = cached.rules;
  } else {
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ([404, 410].includes(response.status)) {
        rules = [];
      } else if (!response.ok) {
        return { allowed: false, reason: `robots.txt HTTP ${response.status}` };
      } else {
        rules = selectRules(parseRobots(await response.text()));
      }
      robotsCache.set(origin, { rules, expiresAt: now + CACHE_TTL_MS });
    } catch (error) {
      return { allowed: false, reason: `robots.txt 获取失败：${error.message}` };
    }
  }

  const path = `${url.pathname}${url.search}`;
  let winner = { allow: true, score: 0 };
  for (const rule of rules) {
    const score = matchRule(rule.path, path);
    if (score > winner.score || (score === winner.score && rule.allow)) winner = { allow: rule.allow, score };
  }
  return { allowed: winner.allow, reason: winner.allow ? 'allowed' : 'disallowed by robots.txt' };
}
