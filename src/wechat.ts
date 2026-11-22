// 个人主体使用公众号后台可见的页面和专用 Chrome 中的扫码会话。
import { createHash } from 'node:crypto';
import { db, getMeta, setMeta } from './db.mjs';
import { click, closeTab, evaluate, mode, openedTab, openTab, screenshot, sleep, withTab } from './driver.mjs';

const ORIGIN = 'https://mp.weixin.qq.com';
export const WECHAT_HOME = ORIGIN + '/';
const ownPage = 'location.origin === "https://mp.weixin.qq.com"';
const visible = 'e => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"';
const clean = 'e => e.innerText?.trim().replace(/\\s+/g, "")';
const byText = (selector: string, label: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => (${visible})(e) && (${clean})(e) === ${JSON.stringify(label)})`;
const homeText = `${ownPage} ? document.body?.innerText || '' : ''`;
const loggedIn = (text: string) => /新的创作|总用户数/.test(text) && /内容管理|数据分析|昨日阅读/.test(text);
const loggedOut = (text: string) => /扫码登录|登录超时|登录已过期|账号密码登录|微信扫一扫/.test(text);

db.exec(`CREATE TABLE IF NOT EXISTS wechat_reading (
  day TEXT PRIMARY KEY, readers INTEGER NOT NULL, collected_at TEXT NOT NULL
)`);

export function wechatReadingHistory() {
  return db.prepare('SELECT day, readers FROM wechat_reading ORDER BY day DESC LIMIT 30').all() as { day: string; readers: number }[];
}

function directChrome() {
  if (mode !== 'direct') throw new Error('微信公众号需要使用专用 Chrome');
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, attempts = 16): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (value != null) return value;
    if (i + 1 < attempts) await sleep(750);
  }
  return null;
}

async function textOn(tab: number) {
  return await evaluate(tab, homeText).catch(() => '') as string || '';
}

function count(text: string, label: RegExp) {
  const match = text.match(label);
  if (!match) return null;
  const tail = text.slice((match.index ?? 0) + match[0].length);
  const value = tail.match(/^[\s：:]*([\d,]+(?:\.\d+)?[万亿]?)(?=\s|$)/)?.[1];
  if (!value) return null;
  const number = Number(value.replace(/[,万亿]/g, '')) * (value.endsWith('亿') ? 1e8 : value.endsWith('万') ? 1e4 : 1);
  return Number.isSafeInteger(number) ? number : null;
}

export async function checkWechatLogin() {
  if (mode !== 'direct') return { ok: false, reason: '微信公众号需要使用专用 Chrome' };
  return withTab(WECHAT_HOME, async tab => {
    const status = await waitFor(async () => {
      const text = await textOn(tab);
      return loggedIn(text) ? 'in' : loggedOut(text) ? 'out' : null;
    });
    return { ok: status === 'in', reason: status === 'in' ? '' : status === 'out' ? '公众号未登录，请扫码登录' : '没有识别到公众号后台首页' };
  }, { wait: 2000 });
}

export async function collectWechatOverview() {
  directChrome();
  const data = await withTab(WECHAT_HOME, async tab => {
    const snapshot = await waitFor(async () => {
      const text = await textOn(tab);
      if (!loggedIn(text)) return null;
      const total = count(text, /总用户数[（(]?人?[）)]?/);
      const readers = count(text, /昨日阅读\s*[（(]\s*人\s*[）)]/);
      return total != null && readers != null ? { total, readers } : null;
    });
    if (!snapshot) {
      if (loggedOut(await textOn(tab))) {
        setMeta('login:wechat', 'out');
        setMeta('loginCheckedAt:wechat', new Date().toISOString());
        setMeta('loginReason:wechat', '公众号未登录，请扫码登录');
        throw new Error('公众号未登录，请扫码登录');
      }
      throw new Error('没有读到公众号首页的总用户数和昨日阅读人数');
    }
    return snapshot;
  }, { wait: 2500 });
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const day = new Date(Date.parse(today + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO wechat_reading (day, readers, collected_at) VALUES (?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET readers=excluded.readers, collected_at=excluded.collected_at`)
    .run(day, data.readers, new Date().toISOString());
  setMeta('login:wechat', 'ok');
  setMeta('loginCheckedAt:wechat', new Date().toISOString());
  setMeta('loginReason:wechat', '');
  return { total: data.total, history: [] };
}

let loginTab: number | undefined;
export async function wechatLoginQr(): Promise<{ loggedIn: boolean; image?: string }> {
  directChrome();
  if (loginTab !== undefined) await closeTab(loginTab).catch(() => {});
  const tab = await openTab(WECHAT_HOME);
  loginTab = tab;
  // 二维码需要对应的登录页继续轮询，后续请求会回收上一个登录页。
  const state = await waitFor(async () => {
    const text = await textOn(tab);
    return loggedIn(text) ? 'in' : loggedOut(text) ? 'out' : null;
  }, 12);
  if (state === 'in') {
    loginTab = undefined;
    await closeTab(tab).catch(() => {});
    return { loggedIn: true };
  }
  await evaluate(tab, `(() => {
      if (!(${ownPage})) return;
      const link = ${byText('.login__type__container__link_text,button,a,span', '扫码登录')};
      if (link?.innerText?.trim() === '扫码登录') link.click();
  })()`).catch(() => {});
  const qr = await waitFor(async () => {
    return await evaluate(tab, `(() => {
        if (!(${ownPage})) return null;
        const selector = '.login__type__container__scan__qrcode img, img.login__type__container__scan__qrcode, .qrcode img, img.qrcode, img[src*="loginqrcode"]';
        const img = [...document.querySelectorAll(selector)].find(e => (${visible})(e) && e.complete && e.naturalWidth > 100);
        if (!img) return null;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        try {
          canvas.getContext('2d').drawImage(img, 0, 0);
          return { image: canvas.toDataURL('image/png') };
        } catch {
          const { x, y, width, height } = img.getBoundingClientRect();
          if (x < 0 || y < 0 || width < 100 || height < 100 || width > 500 || height > 500) return null;
          return { clip: { x: x + scrollX, y: y + scrollY, width, height, scale: 1 } };
        }
    })()`).catch(() => null) as { image?: string; clip?: Parameters<typeof screenshot>[1] } | null;
  }, 10);
  if (qr?.image?.startsWith('data:image/png;base64,')) return { loggedIn: false, image: qr.image };
  if (qr?.clip) return { loggedIn: false, image: 'data:image/png;base64,' + (await screenshot(tab, qr.clip)).toString('base64') };
  throw new Error('未读到登录二维码，请在专用 Chrome 打开的公众号登录页扫码');
}

export function wechatDraftInput(value: unknown) {
  if (!value || typeof value !== 'object' || !('title' in value) || !('body' in value) ||
      typeof value.title !== 'string' || typeof value.body !== 'string') return null;
  const title = value.title.trim(), body = value.body.replace(/\r\n?/g, '\n').trim();
  if (!title || title.length > 64 || /[\r\n]/.test(title) || !body || body.length > 12000) return null;
  return { title, body };
}

const titleSelector = '.title-editor__input .ProseMirror, #js_title_main .ProseMirror, .title-editor__main .ProseMirror, .title_area .ProseMirror, textarea#title, textarea[placeholder*="标题"]';
const bodySelector = '#ueditor_0 .ProseMirror, .rich_media_content.ProseMirror, .mock-iframe-body .ProseMirror, #edui1_iframeholder .ProseMirror, #js_ueditor .ProseMirror';
const editors = `
  const title = [...document.querySelectorAll(${JSON.stringify(titleSelector)})].find(${visible});
  const body = [...document.querySelectorAll(${JSON.stringify(bodySelector)})].find(${visible}) ||
    document.querySelector('iframe#ueditor_0, iframe[id^="ueditor"]')?.contentDocument?.body;
`;
const editorReady = `(() => { if (!(${ownPage}) || !location.search.includes('appmsg_edit')) return false; ${editors} return !!(title && body); })()`;
const saveButton = [byText('button', '保存为草稿'), byText('button', '保存')].join(' || ');

export async function saveWechatDraft(draft: { title: string; body: string }) {
  directChrome();
  const key = 'wechat:draft:' + createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  const state = getMeta(key);
  if (state === 'saved') return '相同内容已保存为公众号草稿，请到草稿箱确认';
  if (state === 'pending') throw new Error('相同内容已尝试保存，请先到公众号草稿箱核实');

  return withTab(WECHAT_HOME, async home => {
    if (!await waitFor(async () => loggedIn(await textOn(home)) || null)) throw new Error('没有进入公众号后台，请检查扫码登录状态');
    await click(home, `(${ownPage}) && (${byText('.new-creation__btn,button,a,span', '新的创作')})`);
    const article = `(${ownPage}) && (${byText('.new-creation__menu-item,.new-creation__menu-content,.new-creation__menu-content span,a,button', '文章')})`;
    if (!await waitFor(async () => await evaluate(home, `Boolean(${article})`).catch(() => false) || null)) throw new Error('没有找到公众号的「文章」入口');
    await click(home, article);

    let editor: number | null = null;
    try {
      editor = await waitFor(async () => (await openedTab(home, ORIGIN)) ??
        (await evaluate(home, editorReady).catch(() => false) ? home : null));
      if (editor == null) throw new Error('公众号没有打开文章编辑器');
      const tab = editor;
      if (!await waitFor(async () => await evaluate(tab, editorReady).catch(() => false) || null)) throw new Error('公众号文章编辑器未就绪');

      // 编辑器可能自动暂存。任何写入前记录尝试，避免中断后自动重复新建。
      setMeta(key, 'pending');
      const filled = await evaluate(tab, `(() => {
        if (!(${ownPage})) return false;
        ${editors}
        if (!title || !body || (title.value || title.innerText || '').trim() || (body.innerText || '').trim()) return false;
        const { title: heading, body: content } = ${JSON.stringify(draft)};
        function paste(el, text) {
          el.focus();
          const win = el.ownerDocument.defaultView;
          if (el instanceof win.HTMLTextAreaElement) {
            Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set.call(el, text);
            el.dispatchEvent(new win.Event('input', { bubbles: true }));
            return;
          }
          const data = new win.DataTransfer();
          data.setData('text/plain', text);
          if (el.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))) {
            el.ownerDocument.execCommand('insertText', false, text);
          }
        }
        paste(title, heading);
        paste(body, content);
        const normalize = s => s.replace(/\\s+/g, ' ').trim();
        return (title.value || title.innerText).trim() === heading && normalize(body.innerText) === normalize(content);
      })()`);
      if (!filled) throw new Error('无法确认公众号编辑器里的正文和标题，请到草稿箱核实');
      const result = await evaluate(tab, `(() => {
        if (!(${ownPage})) return 'missing';
        const button = ${saveButton};
        if (!button || button.disabled) return 'missing';
        return new Promise(resolve => {
          const saved = /^(?:草稿保存成功|保存草稿成功|已保存为草稿|已保存至草稿箱|保存成功)[！!。]?$/;
          const selector = '[role="alert"],[role="status"],.weui-desktop-toast,.weui-desktop-toast__content,.weui-desktop-tips,.toast';
          const before = new Set([...document.querySelectorAll(selector)].filter(e => (${visible})(e) && saved.test(e.innerText?.trim())));
          const previousId = new URL(location.href).searchParams.get('appmsgid');
          const observer = new MutationObserver(check);
          const timer = setInterval(check, 200);
          const timeout = setTimeout(() => done('unknown'), 10000);
          function done(value) { observer.disconnect(); clearInterval(timer); clearTimeout(timeout); resolve(value); }
          function check() {
            const id = new URL(location.href).searchParams.get('appmsgid');
            if ((/^\\d+$/.test(id || '') && Number(id) > 0 && id !== previousId) ||
                [...document.querySelectorAll(selector)].some(e => !before.has(e) && (${visible})(e) && saved.test(e.innerText?.trim()))) done('saved');
          }
          observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
          button.click();
        });
      })()`).catch(() => 'unknown');
      if (result !== 'saved') throw new Error('微信没有返回草稿保存确认，请到草稿箱核实');
      setMeta(key, 'saved');
      return '已保存到公众号草稿箱，请在微信公众平台确认发表';
    } finally {
      if (editor != null && editor !== home) await closeTab(editor).catch(() => {});
    }
  }, { wait: 2500 });
}
