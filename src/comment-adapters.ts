export interface CommentAdapter {
  containers: string[]; content: string[]; author: string[]; likes: string[];
  time: string[]; idAttributes: string[]; scrollContainers: string[]; empty: string[];
}
export const commentAdapters: Record<string, CommentAdapter> = {
  bilibili: {
    containers: ['bili-comment-thread-renderer', '.reply-list .reply-item'],
    content: ['bili-rich-text#content', '#content bili-rich-text', '.root-reply-container .reply-content', '.reply-content'],
    author: ['bili-comment-user-info a', '#user-name', '.user-name'], likes: ['#like #count', '.reply-like .reply-like-count', '.reply-like'],
    time: ['time', '#pubdate', '.reply-time'], idAttributes: ['rpid', 'data-rpid', 'data-id'],
    scrollContainers: [], empty: ['#no-comments', '.no-reply'],
  },
  douyin: {
    containers: ['[data-e2e="comment-item"]'], content: ['[data-e2e="comment-content"]'],
    author: ['[data-e2e="comment-user-name"]', 'a[href*="/user/"]'], likes: ['[data-e2e="comment-like-count"]'],
    time: ['time', '[data-e2e="comment-time"]'], idAttributes: ['data-comment-id', 'data-id'],
    scrollContainers: ['[data-e2e="comment-list"]'], empty: ['[data-e2e="comment-empty"]'],
  },
  xhs: {
    containers: ['.comments-container .comment-item', '.comment-list .comment-item'], content: ['.content .note-text', '.content .comment-content', '.content'],
    author: ['.author .name', '.author a.name', '.user-name'], likes: ['.like .count', '.like-wrapper .count'],
    time: ['time', '.date'], idAttributes: ['data-comment-id', 'data-id', 'id'],
    scrollContainers: ['.note-scroller', '.comments-container'], empty: ['.comments-container .empty-comments', '.comment-list .empty'],
  },
  youtube: {
    containers: ['ytd-comment-thread-renderer'], content: ['#content-text'], author: ['#author-text'],
    likes: ['#vote-count-middle'], time: ['time', '#published-time-text a'], idAttributes: ['data-comment-id'],
    scrollContainers: [], empty: ['ytd-comments #message'],
  },
};
export function commentUrl(platform: string, value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('作品链接不正确');
  const host = url.hostname.toLowerCase();
  const on = (domain: string) => host === domain || host === `www.${domain}`;
  if (platform === 'bilibili' && on('bilibili.com') && /^\/video\/BV\w+/.test(url.pathname)) return url.href;
  if (platform === 'douyin' && on('douyin.com') && /^\/video\/\d+/.test(url.pathname)) return url.href;
  if (platform === 'xhs' && on('xiaohongshu.com') && /^\/(explore|discovery\/item)\/[a-zA-Z0-9]+/.test(url.pathname)) return url.href;
  if (platform === 'youtube') {
    const id = on('youtu.be') ? url.pathname.slice(1) : on('youtube.com') ? url.searchParams.get('v') || url.pathname.match(/^\/shorts\/([\w-]+)/)?.[1] : null;
    if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  }
  throw new Error('作品链接与平台不匹配，请先取链接核实');
}
export function commentScript(adapter: CommentAdapter, scroll: boolean, limit: number): string {
  return `(() => {
    const cfg = ${JSON.stringify(adapter)};
    const roots = [document];
    for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    const query = (root, selectors) => {
      for (const selector of selectors) { const found = root.querySelector(selector); if (found) return found; }
      return null;
    };
    const nested = root => { const found = [root]; for (let i = 0; i < found.length; i++) { if (found[i].shadowRoot) found.push(found[i].shadowRoot); for (const el of found[i].querySelectorAll('*')) if (el.shadowRoot && !found.includes(el.shadowRoot)) found.push(el.shadowRoot); } return found; };
    const text = el => { if (!el) return ''; const visible = (el.innerText || '').trim(); if (visible) return visible; const nodes = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) if (!node.parentElement?.closest('style,script')) nodes.push(node.textContent); const shadows = [...el.querySelectorAll('*')].filter(child => child.shadowRoot).map(child => text(child.shadowRoot)); if (el.shadowRoot) shadows.push(text(el.shadowRoot)); return [...nodes, ...shadows].join(' ').trim(); };
    const pick = (root, selectors) => { for (const scope of nested(root)) { const el = query(scope, selectors); if (el) return el; } return null; };
    const containers = [...new Set(roots.flatMap(root => cfg.containers.flatMap(selector => [...root.querySelectorAll(selector)])))];
    const comments = containers.slice(0, ${limit}).map(el => {
      const content = text(pick(el, cfg.content)), author = text(pick(el, cfg.author));
      const date = pick(el, cfg.time), like = text(pick(el, cfg.likes));
      let id = cfg.idAttributes.map(key => el.getAttribute(key)).find(Boolean) || '';
      const link = pick(el, ['a[href*="lc="]']);
      if (!id && link) { try { id = new URL(link.href).searchParams.get('lc') || ''; } catch {} }
      const n = like.replace(/,/g, '').match(/([\\d.]+)\\s*(万|K|M)?/i);
      return { id, content, author, likes: n ? Math.round(Number(n[1]) * ({'万':10000,k:1000,m:1000000}[(n[2] || '').toLowerCase()] || 1)) : 0, publishedAt: date ? date.getAttribute('datetime') || text(date) : '' };
    }).filter(row => row.content && row.content.length <= 10000);
    const body = document.body.innerText || '';
    const login = /\\/(login|passport|signin)(?:[/?]|$)/i.test(location.pathname) || /accounts\\.google\\.com/.test(location.hostname) || (!comments.length && /扫码登录/.test(body) && /验证码登录|密码登录/.test(body));
    const empty = roots.some(root => cfg.empty.some(selector => { const el = root.querySelector(selector); return el && /暂无评论|还没有评论|快来抢沙发|评论已关闭|Comments are turned off|No comments yet/i.test(text(el)); }));
    const anchor = roots.map(root => query(root, ['#comments', '.comments-container', '[data-e2e="comment-list"]'])).find(Boolean);
    if (${scroll}) {
      const scroller = roots.map(root => query(root, cfg.scrollContainers)).find(el => el && el.scrollHeight > el.clientHeight + 20);
      if (scroller) scroller.scrollBy(0, Math.max(500, scroller.clientHeight * .8));
      else if (containers.length) containers[containers.length - 1].scrollIntoView({block:'end'});
      else if (anchor) anchor.scrollIntoView({block:'start'});
      else window.scrollBy(0, 650);
    }
    return { comments, login, empty, matched: containers.length, url: location.href };
  })()`;
}
