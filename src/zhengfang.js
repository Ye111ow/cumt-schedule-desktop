'use strict';

const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { normalizeSchedule } = require('./schedule');
const {
  mergeGradeDetails,
  normalizeGradeDetailItems,
  normalizeGrades,
  parseGradeDetailMatrix
} = require('./grades');

const DEFAULT_BASE_URL = 'http://jwxt.cumt.edu.cn/jwglxt/';
const DEFAULT_HEADERS = {
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36'
};
const GRADE_PAGE_SIZE = 5000;
const MAX_GRADE_PAGES = 50;

class ZhengfangError extends Error {
  constructor(message, code = 'SERVER_ERROR') {
    super(message);
    this.name = 'ZhengfangError';
    this.code = code;
  }
}

function decodeHtml(value = '') {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function stripHtml(value = '') {
  return decodeHtml(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseAttributes(tag) {
  const attributes = {};
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  for (const match of tag.matchAll(expression)) {
    const name = match[1].toLowerCase();
    if (name === 'input' || name === 'form') continue;
    attributes[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseInputs(html) {
  return [...String(html).matchAll(/<input\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
}

function extractTip(html) {
  const byId = String(html).match(/<(?:p|div)[^>]*id=["']tips["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i);
  if (byId) return stripHtml(byId[1]);
  const alert = String(html).match(/<[^>]*class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  return alert ? stripHtml(alert[1]) : '';
}

function isLoginPage(html) {
  return /<input\b[^>]*(?:id|name)=["']yhm["']/i.test(String(html))
    || /<h5[^>]*>\s*用户登录\s*<\/h5>/i.test(String(html));
}

function gradePayloadItems(payload) {
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
}

function gradePayloadPageCount(payload, pageSize = GRADE_PAGE_SIZE) {
  if (Array.isArray(payload)) return 1;
  const explicitPages = Number(payload?.totalPage ?? payload?.totalPages);
  if (Number.isFinite(explicitPages) && explicitPages > 0) return Math.min(MAX_GRADE_PAGES, Math.ceil(explicitPages));
  const totalRows = Number(payload?.totalResult ?? payload?.records ?? payload?.total);
  if (Number.isFinite(totalRows) && totalRows > 0) {
    return Math.min(MAX_GRADE_PAGES, Math.max(1, Math.ceil(totalRows / pageSize)));
  }
  return 1;
}

function uniqueGradeDetailRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.academicYear, row.term, row.classId, row.credit, row.title, row.label, row.score]
      .map((value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('zh-CN'))
      .join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function base64Url(value) {
  return String(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encryptPassword(password, modulus, exponent) {
  if (!modulus || !exponent) throw new ZhengfangError('教务系统未返回登录公钥', 'LOGIN_CHANGED');
  const key = crypto.createPublicKey({
    key: { kty: 'RSA', n: base64Url(modulus), e: base64Url(exponent) },
    format: 'jwk'
  });
  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(password)).toString('base64');
}

class ZhengfangClient {
  constructor(electronSession, options = {}) {
    this.session = electronSession;
    this.baseURL = new URL(options.baseURL || DEFAULT_BASE_URL).toString();
    this.timeout = options.timeout || 15_000;
  }

  url(relative) {
    return new URL(relative, this.baseURL).toString();
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await this.session.fetch(url, {
        redirect: 'follow',
        ...options,
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new ZhengfangError('连接教务系统超时，请检查校园网连接', 'NETWORK');
      throw new ZhengfangError(`无法连接教务系统：${error.message}`, 'NETWORK');
    } finally {
      clearTimeout(timeout);
    }
  }

  async getPublicKey() {
    const response = await this.request(this.url(`xtgl/login_getPublicKey.html?time=${Date.now()}`), {
      headers: { Referer: this.url('xtgl/login_slogin.html') }
    });
    if (!response.ok) throw new ZhengfangError('获取登录公钥失败', 'SERVER_ERROR');
    try {
      return await response.json();
    } catch {
      throw new ZhengfangError('教务系统登录接口格式已变化', 'LOGIN_CHANGED');
    }
  }

  async prepareLogin() {
    const loginURL = this.url('xtgl/login_slogin.html');
    const response = await this.request(loginURL, { headers: { Referer: loginURL } });
    if (!response.ok) throw new ZhengfangError('教务系统暂时不可用', 'SERVER_ERROR');
    const html = await response.text();
    const inputs = parseInputs(html);
    const hidden = Object.fromEntries(
      inputs
        .filter((input) => input.name && !['yhm', 'mm', 'yzm'].includes(input.name))
        .map((input) => [input.name, input.value || ''])
    );
    const csrfToken = inputs.find((input) => input.id === 'csrftoken' || input.name === 'csrftoken')?.value;
    const captchaRequired = inputs.some((input) => input.id === 'yzm' || input.name === 'yzm');
    const passwordEncrypted = hidden.mmsfjm === '1';
    let publicKey = null;
    if (passwordEncrypted) publicKey = await this.getPublicKey();

    const pending = {
      username: '', password: '', hidden, csrfToken,
      publicKey, passwordEncrypted, captchaRequired
    };

    if (captchaRequired) {
      const captcha = await this.request(this.url(`kaptcha?time=${Date.now()}`), {
        headers: { Referer: loginURL }
      });
      if (!captcha.ok) throw new ZhengfangError('获取验证码失败，请重试', 'SERVER_ERROR');
      const mime = captcha.headers.get('content-type') || 'image/jpeg';
      const bytes = Buffer.from(await captcha.arrayBuffer());
      return {
        status: 'captcha',
        captchaDataURL: `data:${mime};base64,${bytes.toString('base64')}`,
        pending
      };
    }

    return { status: 'prepared', pending };
  }

  async beginLogin(username, password) {
    if (!String(username).trim() || !password) {
      throw new ZhengfangError('请输入学号和密码', 'INVALID_INPUT');
    }
    const prepared = await this.prepareLogin();
    prepared.pending.username = String(username).trim();
    prepared.pending.password = password;
    if (prepared.status === 'captcha') return prepared;
    return this.submitLogin(prepared.pending, '');
  }

  async submitLogin(pending, captchaCode) {
    const code = String(captchaCode || '').trim();
    if (code === '' && pending.captchaRequired) {
      throw new ZhengfangError('请输入验证码', 'INVALID_INPUT');
    }
    let submittedPassword = pending.password;
    if (pending.passwordEncrypted) {
      submittedPassword = encryptPassword(pending.password, pending.publicKey?.modulus, pending.publicKey?.exponent);
    }

    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(pending.hidden || {})) {
      if (!['yhm', 'mm', 'yzm'].includes(name)) form.append(name, value ?? '');
    }
    if (pending.csrfToken && !form.has('csrftoken')) form.append('csrftoken', pending.csrfToken);
    form.append('yhm', pending.username);
    // CUMT's current form contains hidMm and mm with the same field name.
    form.append('mm', submittedPassword);
    form.append('mm', submittedPassword);
    if (code) form.append('yzm', code);

    const loginURL = this.url(`xtgl/login_slogin.html?time=${Date.now()}`);
    const response = await this.request(loginURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: new URL(this.baseURL).origin,
        Referer: this.url('xtgl/login_slogin.html')
      },
      body: form.toString()
    });
    if (!response.ok) throw new ZhengfangError('登录请求失败，请稍后重试', 'SERVER_ERROR');
    const html = await response.text();
    const tip = extractTip(html);
    if (tip) {
      const codeName = /验证码/.test(tip) ? 'CAPTCHA_ERROR' : (/用户名|密码/.test(tip) ? 'CREDENTIALS' : 'LOGIN_FAILED');
      throw new ZhengfangError(tip, codeName);
    }
    if (isLoginPage(html)) throw new ZhengfangError('登录未成功，请检查账号、密码和验证码', 'LOGIN_FAILED');
    return { status: 'success' };
  }

  async getSchedule(academicYear, term) {
    const xqm = Number(term) === 1 ? 3 : 12;
    const form = new URLSearchParams({ xnm: String(academicYear), xqm: String(xqm) });
    const endpoint = this.url('kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151');
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: new URL(this.baseURL).origin,
        Referer: this.url('kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default')
      },
      body: form.toString()
    });
    const text = await response.text();
    const redirectLocation = response.headers.get('location') || '';
    if ([401, 403].includes(response.status)
      || /login_slogin\.html/i.test(redirectLocation)
      || isLoginPage(text)
      || /login_slogin\.html/i.test(response.url)) {
      throw new ZhengfangError('登录已过期，请重新登录', 'AUTH_EXPIRED');
    }
    if (!response.ok) {
      throw new ZhengfangError(`教务系统返回异常状态（HTTP ${response.status}），请稍后重试`, 'SERVER_ERROR');
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ZhengfangError('教务系统返回了无法识别的课表数据', 'RESPONSE_CHANGED');
    }
    return normalizeSchedule(payload, academicYear, term);
  }

  async postGradeJSON(relative, form, invalidMessage = '教务系统返回了无法识别的成绩数据') {
    const endpoint = this.url(relative);
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: new URL(this.baseURL).origin,
        Referer: this.url('cjcx/cjcx_cxXsgrcj.html?gnmkdm=N305005&layout=default')
      },
      body: form.toString()
    });
    const text = await response.text();
    const redirectLocation = response.headers.get('location') || '';
    if ([401, 403].includes(response.status)
      || /login_slogin\.html/i.test(redirectLocation)
      || isLoginPage(text)
      || /login_slogin\.html/i.test(response.url)) {
      throw new ZhengfangError('登录已过期，请重新登录', 'AUTH_EXPIRED');
    }
    if (!response.ok) {
      throw new ZhengfangError(`教务系统返回异常状态（HTTP ${response.status}），请稍后重试`, 'SERVER_ERROR');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ZhengfangError(invalidMessage, 'RESPONSE_CHANGED');
    }
  }

  async getPersonalGradePage(academicYear = 0, term = 0, currentPage = 1) {
    const normalizedTerm = Number(term);
    const xqm = normalizedTerm === 1 ? '3' : (normalizedTerm === 2 ? '12' : '');
    const form = new URLSearchParams({
      xnm: Number(academicYear) > 0 ? String(Number(academicYear)) : '',
      xqm,
      _search: 'false',
      nd: String(Date.now()),
      'queryModel.showCount': String(GRADE_PAGE_SIZE),
      'queryModel.currentPage': String(currentPage),
      'queryModel.sortName': '',
      'queryModel.sortOrder': 'asc',
      time: '0'
    });
    return this.postGradeJSON(
      'cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005',
      form
    );
  }

  async getGrades(academicYear = 0, term = 0) {
    const firstPayload = await this.getPersonalGradePage(academicYear, term, 1);
    const pageCount = gradePayloadPageCount(firstPayload);
    const allItems = [...gradePayloadItems(firstPayload)];
    for (let page = 2; page <= pageCount; page += 3) {
      const pageNumbers = Array.from({ length: Math.min(3, pageCount - page + 1) }, (_, offset) => page + offset);
      const payloads = await Promise.all(pageNumbers.map((pageNumber) => (
        this.getPersonalGradePage(academicYear, term, pageNumber)
      )));
      for (const payload of payloads) allItems.push(...gradePayloadItems(payload));
    }
    const payload = Array.isArray(firstPayload)
      ? allItems
      : { ...firstPayload, items: allItems, currentPage: pageCount, totalPage: pageCount };
    const grades = normalizeGrades(payload, academicYear, term);
    const requestedYear = Number(academicYear) || 0;
    const requestedTerm = Number(term) || 0;
    const termQueries = requestedYear || requestedTerm
      ? [[requestedYear, requestedTerm]]
      : [...new Set(grades.courses
        .filter((course) => course.academicYear && course.term)
        .map((course) => `${course.academicYear}:${course.term}`))]
        .map((key) => key.split(':').map(Number));
    if (!termQueries.length) termQueries.push([0, 0]);

    const exportedRows = [];
    const exportErrors = [];
    // Zhengfang's XLS export is stateful on some deployments. Concurrent exports in the
    // same login session can return another term's temporary workbook, so keep these
    // requests strictly sequential even though the JSON queries below are safe to batch.
    for (const [year, semester] of termQueries) {
      try {
        exportedRows.push(...await this.getGradeDetailRows(year, semester));
      } catch (error) {
        exportErrors.push(error);
      }
    }
    const initiallyMerged = mergeGradeDetails(grades, uniqueGradeDetailRows(exportedRows));
    const fallbackTermQueries = [...new Set(initiallyMerged.courses
      .filter((course) => !course.scoreDetails?.length && course.academicYear && course.term)
      .map((course) => `${course.academicYear}:${course.term}`))]
      .map((key) => key.split(':').map(Number));

    const componentRows = [];
    const componentErrors = [];
    for (let index = 0; index < fallbackTermQueries.length; index += 3) {
      const batch = fallbackTermQueries.slice(index, index + 3);
      const results = await Promise.allSettled(batch.map(([year, semester]) => this.getGradeComponentRows(year, semester)));
      for (const result of results) {
        if (result.status === 'fulfilled') componentRows.push(...result.value);
        else componentErrors.push(result.reason);
      }
    }

    const detailRows = uniqueGradeDetailRows([...exportedRows, ...componentRows]);
    const merged = mergeGradeDetails(grades, detailRows);
    const detailComplete = exportErrors.length === 0 || merged.detailStatus.missingCourseCount === 0;
    let detailMessage = '';
    if (exportErrors.length && !detailRows.length) {
      detailMessage = exportErrors[0]?.message || '成绩分项暂时无法读取';
    } else if (exportErrors.length) {
      detailMessage = '部分学期的成绩分项暂时无法读取';
    } else if (!detailRows.length) {
      detailMessage = '教务系统未返回已发布的成绩分项';
    } else if (merged.detailStatus.missingCourseCount > 0) {
      detailMessage = `${merged.detailStatus.courseCount}/${merged.detailStatus.totalCourseCount} 门课程返回了成绩分项`;
    }
    return {
      ...merged,
      detailStatus: {
        ...merged.detailStatus,
        complete: detailComplete,
        message: detailMessage,
        totalGradePages: pageCount,
        exportRowCount: exportedRows.length,
        componentRowCount: componentRows.length,
        exportErrorCount: exportErrors.length,
        componentErrorCount: componentErrors.length
      }
    };
  }

  async getGradeComponentPage(academicYear = 0, term = 0, currentPage = 1) {
    const normalizedTerm = Number(term);
    const xqm = normalizedTerm === 1 ? '3' : (normalizedTerm === 2 ? '12' : '');
    const form = new URLSearchParams({
      xnm: Number(academicYear) > 0 ? String(Number(academicYear)) : '',
      xqm,
      xh: '',
      _search: 'false',
      nd: String(Date.now()),
      'queryModel.showCount': String(GRADE_PAGE_SIZE),
      'queryModel.currentPage': String(currentPage),
      'queryModel.sortName': 'kch',
      'queryModel.sortOrder': 'asc',
      time: '0'
    });
    return this.postGradeJSON(
      'cjcx/cjjdcx_cxXsjdxmcjIndex.html?doType=query&gnmkdm=N305099',
      form,
      '教务系统返回了无法识别的成绩构成数据'
    );
  }

  async getGradeComponentRows(academicYear = 0, term = 0) {
    const firstPayload = await this.getGradeComponentPage(academicYear, term, 1);
    const pageCount = gradePayloadPageCount(firstPayload);
    const items = [...gradePayloadItems(firstPayload)];
    for (let page = 2; page <= pageCount; page += 3) {
      const pageNumbers = Array.from({ length: Math.min(3, pageCount - page + 1) }, (_, offset) => page + offset);
      const payloads = await Promise.all(pageNumbers.map((pageNumber) => (
        this.getGradeComponentPage(academicYear, term, pageNumber)
      )));
      for (const payload of payloads) items.push(...gradePayloadItems(payload));
    }
    return normalizeGradeDetailItems(items);
  }

  async getGradeDetailRows(academicYear = 0, term = 0) {
    const normalizedTerm = Number(term);
    const xqm = normalizedTerm === 1 ? '3' : (normalizedTerm === 2 ? '12' : '');
    const form = new URLSearchParams();
    form.append('gnmkdmKey', 'N305005');
    form.append('xnm', Number(academicYear) > 0 ? String(Number(academicYear)) : '');
    form.append('xqm', xqm);
    form.append('dcclbh', 'JW_N305005_GLY');
    for (const column of [
      'xnmmc@学年',
      'xqmmc@学期',
      'jxb_id@教学班ID',
      'xf@学分',
      'kcmc@课程名称',
      'xmcj@成绩',
      'xmblmc@成绩分项'
    ]) {
      form.append('exportModel.selectCol', column);
    }
    form.append('exportModel.exportWjgs', 'xls');
    const termLabel = normalizedTerm || 'all';
    form.append('fileName', `成绩分项-${Number(academicYear) || 'all'}-${termLabel}`);

    const endpoint = this.url('cjcx/cjcx_dcXsKccjList.html');
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.ms-excel, application/octet-stream, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: new URL(this.baseURL).origin,
        Referer: this.url('cjcx/cjcx_cxXsgrcj.html?gnmkdm=N305005&layout=default')
      },
      body: form.toString()
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHTML = /html|text\//i.test(contentType) || /^\s*</.test(bytes.toString('utf8', 0, Math.min(bytes.length, 256)));
    const text = looksLikeHTML ? bytes.toString('utf8') : '';
    const redirectLocation = response.headers.get('location') || '';
    if ([401, 403].includes(response.status)
      || /login_slogin\.html/i.test(redirectLocation)
      || (looksLikeHTML && isLoginPage(text))
      || /login_slogin\.html/i.test(response.url)) {
      throw new ZhengfangError('登录已过期，成绩分项未读取', 'AUTH_EXPIRED');
    }
    if (!response.ok) {
      throw new ZhengfangError(`成绩分项接口返回异常（HTTP ${response.status}）`, 'SERVER_ERROR');
    }
    if (looksLikeHTML) {
      const message = extractTip(text) || stripHtml(text).slice(0, 80);
      throw new ZhengfangError(message || '成绩分项接口未返回表格', 'DETAIL_UNAVAILABLE');
    }

    try {
      const workbook = XLSX.read(bytes, { type: 'buffer', cellText: true, cellDates: false });
      return workbook.SheetNames.flatMap((sheetName) => {
        const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          header: 1,
          defval: '',
          raw: false,
          blankrows: false
        });
        return parseGradeDetailMatrix(matrix);
      });
    } catch {
      throw new ZhengfangError('教务系统返回的成绩分项表格无法识别', 'RESPONSE_CHANGED');
    }
  }

  async logout() {
    try {
      await this.request(this.url('xtgl/login_logoutAccount.html'), {
        method: 'POST',
        headers: { Referer: this.baseURL }
      });
    } catch {
      // Local cookie removal still completes logout when the endpoint is unavailable.
    }
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  ZhengfangClient,
  ZhengfangError,
  decodeHtml,
  encryptPassword,
  extractTip,
  isLoginPage,
  parseAttributes,
  parseInputs
};
