'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const packagedExecutable = process.env.PACKAGED_EXE;
const executablePath = packagedExecutable || path.join(root, 'node_modules', '.pnpm', 'electron@37.10.3', 'node_modules', 'electron', 'dist', 'electron.exe');
const output = path.join(root, 'artifacts');

const mockSchedule = {
  student: { id: '012345', name: '矿大同学' },
  academicYear: 2026,
  term: 1,
  syncedAt: new Date().toISOString(),
  courses: [
    { id: '1', title: '文献检索与学术写作', teacher: '李老师', weekday: 2, startSession: 1, endSession: 2, time: '08:00–09:45', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博4-C306', className: '教学班01' },
    { id: '2', title: '文献检索与学术写作', teacher: '李老师', weekday: 4, startSession: 1, endSession: 2, time: '08:00–09:45', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博4-C306', className: '教学班01' },
    { id: '3', title: '算法设计与分析', teacher: '张老师', weekday: 1, startSession: 3, endSession: 4, time: '10:15–12:00', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博3-B102', className: '计算机01' },
    { id: '4', title: '算法设计与分析', teacher: '张老师', weekday: 3, startSession: 3, endSession: 4, time: '10:15–12:00', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博3-B102', className: '计算机01' },
    { id: '5', title: '网球（5）', teacher: '王老师', weekday: 4, startSession: 3, endSession: 4, time: '10:15–12:00', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '北区网球场', className: '体育05' },
    { id: '6', title: 'Java语言及网络编程', teacher: '赵老师', weekday: 1, startSession: 7, endSession: 8, time: '16:15–18:00', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博3-A101', className: '软件02' },
    { id: '7', title: 'Java语言及网络编程', teacher: '赵老师', weekday: 5, startSession: 7, endSession: 8, time: '16:15–18:00', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博3-A101', className: '软件02' },
    { id: '8', title: '电子商务导论', teacher: '周老师', weekday: 1, startSession: 9, endSession: 10, time: '19:00–20:45', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博4-C104', className: '公选01' },
    { id: '9', title: '电子商务导论', teacher: '周老师', weekday: 3, startSession: 9, endSession: 10, time: '19:00–20:45', weeksText: '1-16周', weeks: [1], campus: '南湖校区', place: '博4-C104', className: '公选01' }
  ],
  extraCourses: []
};

const mockGrades = {
  student: { id: '012345', name: '矿大同学' },
  query: { academicYear: 0, term: 0 },
  syncedAt: new Date().toISOString(),
  detailStatus: { available: true, rowCount: 14, courseCount: 5 },
  courses: [
    { id: 'g1', title: '高级学术英语', teacher: '李老师', academicYear: 2025, term: 2, credit: 2, rawGrade: '85', percentageGrade: '85', numericScore: 85, qualitativeConverted: false, gradePoint: 4, examNature: '正常考试', courseNature: '必修', usualScore: '88', examScore: '83', scoreDetails: [{ label: '平时成绩（40%）', score: '88' }, { label: '期末卷面（60%）', score: '83' }] },
    { id: 'g2', title: '跆拳道（4）', teacher: '王老师', academicYear: 2025, term: 2, credit: .5, rawGrade: '75', percentageGrade: '75', numericScore: 75, qualitativeConverted: false, gradePoint: 2.8, examNature: '正常考试', courseNature: '选修', usualScore: '80', examScore: '72', scoreDetails: [{ label: '技能考核', score: '72' }, { label: '出勤与课堂表现', score: '80' }] },
    { id: 'g3', title: '矿产资源及其加工利用', teacher: '周老师', academicYear: 2025, term: 2, credit: 2, rawGrade: '94', percentageGrade: '94', numericScore: 94, qualitativeConverted: false, gradePoint: 4.5, examNature: '正常考试', courseNature: '必修', usualScore: '96', examScore: '93', midtermScore: '92', scoreDetails: [{ label: '平时成绩', score: '96' }, { label: '期中成绩', score: '92' }, { label: '期末成绩', score: '93' }] },
    { id: 'g4', title: '智能采矿导论', teacher: '赵老师', academicYear: 2025, term: 2, credit: 2, rawGrade: '优秀', percentageGrade: '', numericScore: 92, qualitativeConverted: true, gradePoint: 4.5, examNature: '考查', courseNature: '必修', usualScore: '优秀', examScore: null, midtermScore: null, experimentScore: null, makeupScore: null, retakeScore: null },
    { id: 'g5', title: '数据库原理', teacher: '陈老师', academicYear: 2025, term: 1, credit: 3, rawGrade: '89', percentageGrade: '89', numericScore: 89, qualitativeConverted: false, gradePoint: 4, examNature: '正常考试', courseNature: '必修', usualScore: '92', examScore: '87', midtermScore: null, experimentScore: '95', makeupScore: null, retakeScore: null },
    { id: 'g6', title: '概率论与数理统计', teacher: '孙老师', academicYear: 2025, term: 1, credit: 3, rawGrade: '82', percentageGrade: '82', numericScore: 82, qualitativeConverted: false, gradePoint: 3.5, examNature: '正常考试', courseNature: '必修', usualScore: null, examScore: null, midtermScore: null, experimentScore: null, makeupScore: null, retakeScore: null }
  ]
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cumt-schedule-visual-'));
  const args = packagedExecutable ? [`--user-data-dir=${userData}`] : ['.', `--user-data-dir=${userData}`];
  const app = await electron.launch({ executablePath, args, cwd: root });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1380, height: 880 });
    await page.waitForSelector('#emptySchedule:not(.hidden)', { timeout: 20_000 });
    if (!await page.locator('#loginOverlay').evaluate((element) => element.classList.contains('hidden'))) {
      throw new Error('Login opened during startup instead of waiting for an import action.');
    }
    if (await page.textContent('#syncButtonText') !== '导入课表') {
      throw new Error('Schedule action is not labelled as import.');
    }
    await page.screenshot({ path: path.join(output, 'empty-startup.png') });
    await page.click('.page-tab[data-page="grades"]');
    await page.waitForTimeout(120);
    if (!await page.locator('#loginOverlay').evaluate((element) => element.classList.contains('hidden'))) {
      throw new Error('Login opened merely by switching to the grades page.');
    }
    if (await page.textContent('#syncButtonText') !== '导入成绩') {
      throw new Error('Grade action is not labelled as import.');
    }
    await page.click('.page-tab[data-page="schedule"]');
    await page.click('#syncButton');
    await page.waitForSelector('#loginOverlay:not(.hidden)', { timeout: 20_000 });
    await page.waitForSelector('#captchaImage:not(.hidden)', { timeout: 20_000 });
    await page.fill('#username', 'visual-check-only');
    await page.fill('#password', 'preserve-this-password');
    const originalCaptcha = await page.getAttribute('#captchaImage', 'src');
    await page.click('#captchaImageButton');
    await page.waitForFunction((previous) => {
      const image = document.querySelector('#captchaImage');
      return image && !image.classList.contains('hidden') && image.getAttribute('src') !== previous;
    }, originalCaptcha);
    const preservedUsername = await page.inputValue('#username');
    const preservedPassword = await page.inputValue('#password');
    if (preservedUsername !== 'visual-check-only' || preservedPassword !== 'preserve-this-password') {
      throw new Error(`Refreshing captcha changed credentials: ${JSON.stringify({ preservedUsername, preservedPassword })}`);
    }
    await page.fill('#username', '');
    await page.fill('#password', '');
    await page.screenshot({ path: path.join(output, 'login.png') });
    await page.evaluate(() => { state.settings.colorMode = 'light'; applyAppearance(); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(output, 'light-login.png') });
    await page.evaluate(() => { state.settings.colorMode = 'dark'; applyAppearance(); });
    process.stdout.write('CUMT captcha preloaded and credential fields survived refresh.\n');
    await page.evaluate((schedule) => {
      state.settings.academicYear = 2026;
      state.settings.term = 1;
      state.settings.semesterStart = '2026-09-07';
      state.settings.themeColor = '#70a5ff';
      state.settings.panelOpacity = .72;
      state.settings.cardOpacity = .76;
      state.settings.backgroundOpacity = .82;
      state.settings.backgroundBlur = 3;
      state.background = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#294e86"/><stop offset=".45" stop-color="#5371a5"/><stop offset="1" stop-color="#a8796f"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="35"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="1030" cy="190" r="230" fill="#62c0b0" opacity=".34" filter="url(#b)"/><circle cx="320" cy="710" r="270" fill="#c4a08a" opacity=".32" filter="url(#b)"/></svg>');
      state.schedule = schedule;
      state.selectedWeek = 1;
      state.currentWeek = 1;
      hideLogin();
      applyAppearance();
      renderSchedule();
    }, mockSchedule);
    await page.waitForTimeout(400);
    if (await page.textContent('#syncButtonText') !== '导入课表') {
      throw new Error('Cached schedule changed the import action back to refresh.');
    }
    await page.evaluate(() => { state.authenticated = true; });
    await page.click('#syncButton');
    await page.waitForSelector('#loginOverlay:not(.hidden)', { timeout: 20_000 });
    await page.waitForSelector('#captchaImage:not(.hidden)', { timeout: 20_000 });
    if (await page.evaluate(() => state.authenticated)) {
      throw new Error('Import reused the previous authenticated state instead of starting a fresh login.');
    }
    await page.evaluate(() => hideLogin());
    await page.screenshot({ path: path.join(output, 'schedule.png') });
    await page.evaluate(() => { state.settings.colorMode = 'light'; applyAppearance(); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, 'light-schedule.png') });
    await page.click('#settingsButton');
    await page.waitForTimeout(250);
    if (await page.locator('#autoSync, #widgetLookAhead').count()) {
      throw new Error('Obsolete automatic-sync or look-ahead setting is still visible.');
    }
    await page.screenshot({ path: path.join(output, 'personalization.png') });
    await page.click('#cancelSettings');

    await page.evaluate(async (grades) => {
      state.grades = grades;
      await switchPage('grades');
      renderGrades({ rebuildTerms: true });
    }, mockGrades);
    await page.waitForSelector('.grade-card');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, 'light-grades.png') });
    await page.fill('#gradeSearch', '数据库');
    await page.waitForFunction(() => document.querySelectorAll('.grade-card').length === 1);
    await page.fill('#gradeSearch', '');
    await page.evaluate(() => { state.settings.colorMode = 'dark'; applyAppearance(); });
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(output, 'grades.png') });
    await page.click('.page-tab[data-page="schedule"]');

    const widgetPromise = app.waitForEvent('window');
    await page.click('#desktopButton');
    const widget = await widgetPromise;
    await widget.waitForSelector('.widget-shell');
    await widget.evaluate((schedule) => {
      const today = new Date();
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      state.settings.semesterStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      state.settings.themeColor = '#9b8bf4';
      state.settings.colorMode = 'dark';
      state.settings.panelOpacity = .76;
      state.settings.cardOpacity = .8;
      state.settings.widgetDesktopPinned = false;
      schedule.courses[0].weekday = today.getDay() || 7;
      state.schedule = schedule;
      state.background = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="800"><defs><linearGradient id="g" x2=".3" y2="1"><stop stop-color="#466da5"/><stop offset=".48" stop-color="#65789d"/><stop offset="1" stop-color="#aa827e"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="350" cy="170" r="180" fill="#76d1b6" opacity=".28"/></svg>');
      applyAppearance();
      render();
    }, mockSchedule);
    await widget.waitForTimeout(300);
    await widget.screenshot({ path: path.join(output, 'widget.png') });
    await widget.click('#desktopPin');
    await widget.waitForFunction(() => document.querySelector('#desktopPin').classList.contains('active'));
    await widget.waitForTimeout(900);
    const pinnedWindow = await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find((window) => window.getTitle() === '今日课表');
      return {
        handle: target.getNativeWindowHandle().readBigUInt64LE(0).toString(),
        alwaysOnTop: target.isAlwaysOnTop(),
        focusable: target.isFocusable(),
        minimizable: target.isMinimizable(),
        movable: target.isMovable()
      };
    });
    if (pinnedWindow.alwaysOnTop || !pinnedWindow.focusable || pinnedWindow.minimizable || pinnedWindow.movable) {
      throw new Error(`Desktop pin did not apply desktop-window behavior: ${JSON.stringify(pinnedWindow)}`);
    }
    const monitorCount = Number(execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*widget-desktop-monitor.ps1*' }).Count"
    ], { encoding: 'utf8', windowsHide: true }).trim());
    if (!monitorCount) throw new Error('Desktop foreground monitor did not start.');
    await widget.screenshot({ path: path.join(output, 'pinned-widget.png') });
    await widget.evaluate(() => toggleDesktopPin());
    await widget.waitForFunction(() => !document.querySelector('#desktopPin').classList.contains('active'));
    await widget.setViewportSize({ width: 540, height: 620 });
    await widget.evaluate(() => {
      state.settings.widgetSizePreset = 'wide';
      state.settings.widgetDensity = 'compact';
      state.settings.widgetShowCompleted = false;
      applyAppearance();
      render();
    });
    const dateBeforeNavigation = await widget.textContent('#todayDate');
    await widget.click('#nextDay');
    await widget.waitForFunction((previous) => document.querySelector('#todayDate').textContent !== previous, dateBeforeNavigation);
    await widget.click('#backToday');
    await widget.waitForTimeout(180);
    await widget.screenshot({ path: path.join(output, 'wide-widget.png') });
    await widget.evaluate(() => { state.settings.colorMode = 'light'; applyAppearance(); });
    await widget.waitForTimeout(180);
    await widget.screenshot({ path: path.join(output, 'light-widget.png') });
    if ((await widget.textContent('#widgetSync')).trim() !== '导入') {
      throw new Error('Widget action is not labelled as import.');
    }
    await widget.evaluate(() => {
      const today = new Date();
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      state.settings.semesterStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      const todayWeekday = today.getDay() || 7;
      const anotherWeekday = todayWeekday === 7 ? 1 : todayWeekday + 1;
      state.schedule.courses.forEach((course) => { course.weekday = anotherWeekday; });
      state.selectedDayOffset = 0;
      render();
    });
    if (await widget.locator('.today-course').count() || await widget.locator('#emptyToday').evaluate((element) => element.classList.contains('hidden'))) {
      throw new Error('Today widget previewed another date while today had no course.');
    }
    if ((await widget.textContent('#emptyTitle')).trim() !== '今天没有课程') {
      throw new Error('Today widget did not show the correct no-course state.');
    }
    await widget.screenshot({ path: path.join(output, 'empty-widget.png') });
    await widget.evaluate(() => {
      state.settings.semesterStart = '2000-01-03';
      render();
    });
    if (await widget.locator('.today-course').count()) {
      throw new Error('Today widget fell back to another week outside the teaching period.');
    }
    await widget.click('#widgetSync');
    await page.waitForSelector('#loginOverlay:not(.hidden)', { timeout: 20_000 });
    await page.waitForSelector('#captchaImage:not(.hidden)', { timeout: 20_000 });
  } finally {
    await app.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
