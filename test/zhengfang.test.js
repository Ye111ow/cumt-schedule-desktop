'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { ZhengfangClient } = require('../src/zhengfang');

const loginHTML = `
  <html><body>
    <form action="/jwglxt/xtgl/login_slogin.html" method="post">
      <input type="hidden" name="mmsfjm" id="mmsfjm" value= 0>
      <input type="hidden" name="xxdm" value= 10290>
      <input type="hidden" id="csrftoken" name="csrftoken" value="csrf-token">
      <input type="text" name="yhm" id="yhm">
      <input type="password" name="mm" id="hidMm">
      <input type="text" name="mm" id="mm">
      <input name="yzm" type="text" id="yzm">
    </form>
  </body></html>`;

class LoginSession {
  constructor() { this.requests = []; }

  async fetch(url, options = {}) {
    this.requests.push({ url, options });
    if (url.includes('login_slogin.html') && options.method === 'POST') {
      return new Response('<html><body>ok</body></html>', { status: 200 });
    }
    if (url.includes('login_slogin.html')) return new Response(loginHTML, { status: 200 });
    if (url.includes('kaptcha')) return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    throw new Error(`Unexpected URL: ${url}`);
  }
}

test('CUMT captcha login keeps plain password and duplicate mm fields', async () => {
  const session = new LoginSession();
  const client = new ZhengfangClient(session, { baseURL: 'http://jwxt.cumt.edu.cn/jwglxt/' });
  const begin = await client.beginLogin('012345', 'secret');
  assert.equal(begin.status, 'captcha');
  assert.equal(begin.pending.passwordEncrypted, false);
  assert.match(begin.captchaDataURL, /^data:image\/jpeg;base64,/);

  const result = await client.submitLogin(begin.pending, 'AB12');
  assert.equal(result.status, 'success');
  const submission = session.requests.find((item) => item.options.method === 'POST');
  const fields = new URLSearchParams(submission.options.body);
  assert.deepEqual(fields.getAll('mm'), ['secret', 'secret']);
  assert.equal(fields.get('yzm'), 'AB12');
  assert.equal(fields.get('csrftoken'), 'csrf-token');
  assert.equal(fields.get('xxdm'), '10290');
});

test('captcha can be prepared before the user enters credentials', async () => {
  const session = new LoginSession();
  const client = new ZhengfangClient(session, { baseURL: 'http://jwxt.cumt.edu.cn/jwglxt/' });
  const prepared = await client.prepareLogin();
  assert.equal(prepared.status, 'captcha');
  assert.equal(prepared.pending.username, '');
  assert.equal(prepared.pending.password, '');
  assert.equal(session.requests.some((item) => item.options.method === 'POST'), false);
});

test('schedule query maps second term to Zhengfang xqm=12', async () => {
  const payload = { xsxx: { XH: '01', XM: '同学' }, kbList: [] };
  const session = {
    async fetch(_url, options) {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('xnm'), '2025');
      assert.equal(form.get('xqm'), '12');
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = new ZhengfangClient(session);
  const schedule = await client.getSchedule(2025, 2);
  assert.equal(schedule.student.name, '同学');
  assert.deepEqual(schedule.courses, []);
});

test('schedule query reports an expired login page', async () => {
  const session = { async fetch() { return new Response(loginHTML, { status: 200 }); } };
  const client = new ZhengfangClient(session);
  await assert.rejects(() => client.getSchedule(2025, 2), (error) => error.code === 'AUTH_EXPIRED');
});

test('schedule query treats a non-200 redirect to login as expired authentication', async () => {
  const session = {
    async fetch() {
      return new Response('', {
        status: 302,
        headers: { location: '/jwglxt/xtgl/login_slogin.html' }
      });
    }
  };
  const client = new ZhengfangClient(session);
  await assert.rejects(() => client.getSchedule(2025, 2), (error) => error.code === 'AUTH_EXPIRED');
});

test('grade query follows Zhengfang personal-grade endpoint and keeps component fields', async () => {
  const session = {
    async fetch(url, options) {
      if (url.includes('cjcx_dcXsKccjList.html')) {
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('dcclbh'), 'JW_N305005_GLY');
        assert.deepEqual(form.getAll('exportModel.selectCol').slice(-2), ['xmcj@成绩', 'xmblmc@成绩分项']);
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([
          ['学年', '学期', '教学班ID', '学分', '课程名称', '成绩', '成绩分项'],
          ['2025-2026', '第一学期', 'A01', '3', '算法设计', '91', '平时成绩'],
          ['2025-2026', '第一学期', 'A01', '3', '算法设计', '86', '期末卷面']
        ]);
        XLSX.utils.book_append_sheet(workbook, sheet, '成绩分项');
        const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' });
        return new Response(bytes, { status: 200, headers: { 'content-type': 'application/vnd.ms-excel' } });
      }
      assert.match(url, /cjcx_cxXsgrcj\.html\?doType=query&gnmkdm=N305005/);
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('xnm'), '2025');
      assert.equal(form.get('xqm'), '3');
      assert.equal(form.get('queryModel.showCount'), '500');
      return new Response(JSON.stringify({ items: [{
        xh: '01', xm: '同学', kcmc: '算法设计', jxb_id: 'A01', xf: '3', cj: '88', jd: '4',
        pscj: '90', qmcj: '87', xnmmc: '2025-2026', xqmmc: '第一学期'
      }] }), { status: 200 });
    }
  };
  const client = new ZhengfangClient(session);
  const grades = await client.getGrades(2025, 1);
  assert.equal(grades.courses[0].title, '算法设计');
  assert.equal(grades.courses[0].usualScore, '90');
  assert.deepEqual(grades.courses[0].scoreDetails, [
    { label: '平时成绩', score: '91' },
    { label: '期末卷面', score: '86' }
  ]);
  assert.equal(grades.detailStatus.courseCount, 1);
  assert.equal(grades.summary.weightedScore, 88);
});

test('grade query reports an expired login page', async () => {
  const session = { async fetch() { return new Response(loginHTML, { status: 200 }); } };
  const client = new ZhengfangClient(session);
  await assert.rejects(() => client.getGrades(), (error) => error.code === 'AUTH_EXPIRED');
});
