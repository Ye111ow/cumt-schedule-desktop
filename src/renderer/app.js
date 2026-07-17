'use strict';

const api = window.cumtSchedule;
const $ = (selector) => document.querySelector(selector);
const systemColorPreference = window.matchMedia('(prefers-color-scheme: dark)');
const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const periods = [
  ['08:00', '08:50'], ['08:55', '09:45'], ['10:15', '11:05'], ['11:10', '12:00'],
  ['14:00', '14:50'], ['14:55', '15:45'], ['16:15', '17:05'], ['17:10', '18:00'],
  ['19:00', '19:50'], ['19:55', '20:45'], ['20:55', '21:45'], ['21:50', '22:40']
];
const palette = ['#62d6ad', '#8f83ef', '#6495ed', '#ee9364', '#d875a3', '#52bfd2', '#a8c86a', '#dfb25b'];

const state = {
  settings: null,
  schedule: null,
  grades: null,
  activePage: 'schedule',
  importTarget: 'schedule',
  selectedWeek: 1,
  currentWeek: 1,
  captchaToken: null,
  captchaAutoMode: false,
  preparingCaptcha: false,
  hasSavedPassword: false,
  syncing: false,
  gradesLoading: false,
  gradeSortDirection: 'desc',
  authenticated: false,
  background: null,
  hasUserSelectedWeek: false,
  version: ''
};

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function semesterSuggestion(academicYear, term) {
  const date = Number(term) === 1
    ? new Date(Number(academicYear), 8, 1)
    : new Date(Number(academicYear) + 1, 1, 20);
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7));
  return dateInput(date);
}

function weekForToday() {
  const start = parseLocalDate(state.settings?.semesterStart);
  if (!start) return 1;
  const today = new Date();
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(1, Math.floor((localToday - start) / 604_800_000) + 1);
}

function relevantTeachingWeek() {
  const current = weekForToday();
  const arranged = new Set((state.schedule?.courses || []).flatMap((course) => course.weeks || []));
  return arranged.has(current) ? current : 1;
}

function weekDates(week) {
  const start = parseLocalDate(state.settings?.semesterStart);
  if (!start) return Array(7).fill(null);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + (week - 1) * 7 + index);
    return date;
  });
}

function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function shortDate(date) {
  return date ? `${date.getMonth() + 1}/${date.getDate()}` : '—';
}

function rangeLabel(dates) {
  if (!dates[0] || !dates[6]) return '请设置第一周日期';
  const start = dates[0];
  const end = dates[6];
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getFullYear()}/${shortDate(start)} – ${end.getFullYear()}/${shortDate(end)}`;
  }
  return `${start.getFullYear()} · ${shortDate(start)} – ${shortDate(end)}`;
}

function hashColor(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(value) {
  const text = String(value || '课').trim();
  return text.slice(-2);
}

function formatSyncedAt(value) {
  if (!value) return '等待同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '已读取本地课表';
  return `更新于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function toast(message, type = 'success', duration = 3200) {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toastRegion').append(item);
  window.setTimeout(() => item.remove(), duration);
}

function setSyncStatus(kind, message) {
  const meta = $('#syncMeta');
  meta.classList.toggle('online', kind === 'online');
  meta.classList.toggle('error', kind === 'error');
  $('#syncText').textContent = message;
  $('#networkStatus').textContent = kind === 'error'
    ? '连接异常'
    : (state.activePage === 'grades' ? '校园网成绩' : '校园网课表');
}

function loginTargetText() {
  return state.importTarget === 'grades' ? '成绩' : '课表';
}

function setBusy(busy, label = '正在登录…') {
  const button = $('#loginButton');
  button.disabled = busy;
  button.querySelector('span').textContent = busy ? label : `登录并读取${loginTargetText()}`;
}

function showLoginError(message = '') {
  const error = $('#loginError');
  error.textContent = message;
  error.classList.toggle('hidden', !message);
}

function showLogin() {
  const overlay = $('#loginOverlay');
  const firstShow = overlay.classList.contains('hidden');
  overlay.classList.remove('hidden');
  if (firstShow) {
    if (!$('#username').value) $('#username').value = state.settings?.username || '';
    $('#rememberPassword').checked = state.settings?.rememberPassword !== false;
  }
  $('#loginDescription').textContent = `请连接校园网，使用正方教务账号登录。成功后将自动读取${loginTargetText()}。`;
  setBusy(false);
  window.setTimeout(() => (state.settings?.username ? $('#password') : $('#username')).focus(), 40);
}

function hideLogin() {
  $('#loginOverlay').classList.add('hidden');
  $('#captchaField').classList.add('hidden');
  $('#captcha').value = '';
  $('#captcha').required = false;
  state.captchaToken = null;
  showLoginError('');
}

function showCaptcha(result, autoMode = false) {
  state.captchaToken = result.token;
  state.captchaAutoMode = autoMode;
  $('#captchaImage').src = result.image;
  $('#captchaImage').classList.remove('hidden');
  $('#captchaLoading').classList.add('hidden');
  $('#captchaImageButton').classList.remove('loading');
  $('#captchaField').classList.remove('hidden');
  $('#captcha').required = true;
  $('#captcha').value = '';
  if (result.message) showLoginError(result.message);
  if (($('#username').value && $('#password').value) || autoMode) {
    window.setTimeout(() => $('#captcha').focus(), 40);
  }
}

async function prepareCaptcha() {
  if (state.preparingCaptcha) return;
  state.preparingCaptcha = true;
  state.captchaToken = null;
  $('#captchaField').classList.remove('hidden');
  $('#captcha').required = true;
  $('#captchaImage').classList.add('hidden');
  $('#captchaLoading').textContent = '正在加载验证码…';
  $('#captchaLoading').classList.remove('hidden');
  $('#captchaImageButton').classList.add('loading');
  const result = await api.prepareLogin();
  state.preparingCaptcha = false;
  if (result.status === 'captcha') {
    showCaptcha(result, false);
    return;
  }
  if (result.status === 'prepared') {
    state.captchaToken = result.token;
    $('#captchaField').classList.add('hidden');
    $('#captcha').required = false;
    return;
  }
  $('#captchaLoading').textContent = '加载失败，点击重试';
  $('#captchaImageButton').classList.remove('loading');
  $('#captcha').required = false;
  showLoginError(result.message || '验证码加载失败，请点击图片区域重试。');
}

function populateYearSelect() {
  const select = $('#academicYear');
  select.replaceChildren();
  const current = new Date().getFullYear();
  for (let year = current + 1; year >= current - 8; year -= 1) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = `${year}–${year + 1}`;
    select.append(option);
  }
}

function populateSettingsForm() {
  const settings = state.settings;
  $('#academicYear').value = String(settings.academicYear);
  $('#term').value = String(settings.term);
  $('#semesterStart').value = settings.semesterStart || '';
  $('#dailyWidget').checked = Boolean(settings.dailyWidget);
  $('#widgetDesktopPinned').checked = Boolean(settings.widgetDesktopPinned);
  $('#widgetAlwaysOnTop').checked = Boolean(settings.widgetAlwaysOnTop);
  $('#widgetSizePreset').value = settings.widgetSizePreset || 'standard';
  $('#widgetDensity').value = settings.widgetDensity || 'comfortable';
  $('#widgetHideCompleted').checked = settings.widgetShowCompleted === false;
  $('#widgetLocked').checked = Boolean(settings.widgetLocked);
  $('#widgetClickThrough').checked = Boolean(settings.widgetClickThrough);
  $('#widgetPanelOpacity').value = String(Math.round((settings.widgetPanelOpacity ?? .9) * 100));
  $('#widgetCardOpacity').value = String(Math.round((settings.widgetCardOpacity ?? .92) * 100));
  $('#classReminder').checked = Boolean(settings.classReminder);
  $('#reminderMinutes').value = String(settings.reminderMinutes || 10);
  $('#alwaysOnTop').checked = Boolean(settings.alwaysOnTop);
  $('#autoStart').checked = Boolean(settings.autoStart);
  $('#closeToTray').checked = Boolean(settings.closeToTray);
  $('#opacity').value = String(Math.round((settings.opacity || 1) * 100));
  $('#opacityValue').textContent = `${$('#opacity').value}%`;
  $('#themeColor').value = settings.themeColor || '#62d6ad';
  $('#colorMode').value = settings.colorMode || 'dark';
  $('#backgroundOpacity').value = String(Math.round((settings.backgroundOpacity ?? .72) * 100));
  $('#backgroundBlur').value = String(settings.backgroundBlur ?? 8);
  $('#panelOpacity').value = String(Math.round((settings.panelOpacity ?? .9) * 100));
  $('#cardOpacity').value = String(Math.round((settings.cardOpacity ?? .92) * 100));
  updateAppearanceOutputs();
  updateThemeSelection();
  updateModeSelection();
  updateWidgetSettingSelections();
  $('#widgetPanelOpacityValue').textContent = `${$('#widgetPanelOpacity').value}%`;
  $('#widgetCardOpacityValue').textContent = `${$('#widgetCardOpacity').value}%`;
  updateBackgroundPreview();
  $('#accountText').textContent = settings.username ? `学号 ${settings.username}` : '尚未登录';
}

function openSettings() {
  populateSettingsForm();
  $('#backdrop').classList.remove('hidden');
  $('#settingsDrawer').classList.add('open');
  $('#settingsDrawer').setAttribute('aria-hidden', 'false');
}

function closeSettings(revertAppearance = true) {
  if (revertAppearance) applyAppearance(state.settings);
  $('#backdrop').classList.add('hidden');
  $('#settingsDrawer').classList.remove('open');
  $('#settingsDrawer').setAttribute('aria-hidden', 'true');
}

function updateAppearanceOutputs() {
  $('#backgroundOpacityValue').textContent = `${$('#backgroundOpacity').value}%`;
  $('#backgroundBlurValue').textContent = `${$('#backgroundBlur').value}px`;
  $('#panelOpacityValue').textContent = `${$('#panelOpacity').value}%`;
  $('#cardOpacityValue').textContent = `${$('#cardOpacity').value}%`;
}

function updateThemeSelection(selectedColor = state.settings?.themeColor || $('#themeColor').value) {
  const color = String(selectedColor || '').toLowerCase();
  document.querySelectorAll('.theme-swatch').forEach((button) => {
    button.classList.toggle('active', button.dataset.color.toLowerCase() === color);
  });
}

function resolvedColorMode(mode = state.settings?.colorMode || 'dark') {
  return mode === 'system' ? (systemColorPreference.matches ? 'dark' : 'light') : mode;
}

function updateModeSelection(mode = $('#colorMode')?.value || state.settings?.colorMode || 'dark') {
  document.querySelectorAll('#colorModeSwitch button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
}

function updateWidgetSettingSelections() {
  document.querySelectorAll('#widgetSizeSwitch button').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === $('#widgetSizePreset').value);
  });
  document.querySelectorAll('#widgetDensitySwitch button').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === $('#widgetDensity').value);
  });
}

function updateBackgroundPreview() {
  const preview = $('#backgroundPreview');
  preview.style.backgroundImage = state.background ? `url("${state.background}")` : 'linear-gradient(145deg,#203759,#1c5a51)';
  preview.querySelector('span').textContent = state.background ? '自定义背景' : '默认背景';
}

function applyAppearance(settings = state.settings) {
  if (!settings) return;
  const root = document.documentElement;
  const colorMode = resolvedColorMode(settings.colorMode);
  root.dataset.colorMode = colorMode;
  root.style.setProperty('--mint', settings.themeColor || '#62d6ad');
  root.style.setProperty('--background-opacity', String(settings.backgroundOpacity ?? .72));
  root.style.setProperty('--background-blur', `${settings.backgroundBlur ?? 8}px`);
  const panelOpacity = settings.panelOpacity ?? .9;
  root.style.setProperty('--schedule-panel-bg', colorMode === 'light'
    ? `rgba(247, 250, 255, ${panelOpacity})`
    : `rgba(20, 31, 52, ${panelOpacity})`);
  root.style.setProperty('--card-alpha', String(settings.cardOpacity ?? .92));
  $('#customBackground').style.backgroundImage = state.background ? `url("${state.background}")` : '';
  document.body.classList.toggle('has-custom-background', Boolean(state.background));
  $('#desktopButton').classList.toggle('active', Boolean(settings.dailyWidget));
  $('#colorModeButton').title = colorMode === 'dark' ? '切换到明亮模式' : '切换到深色模式';
  updateThemeSelection(settings.themeColor);
}

function renderWeekPills() {
  const root = $('#weekPills');
  if (!root) return;
  root.replaceChildren();
  const maxCourseWeek = Math.max(20, ...(state.schedule?.courses || []).flatMap((course) => course.weeks || [1]));
  const count = Math.min(25, maxCourseWeek);
  for (let week = 1; week <= count; week += 1) {
    const button = document.createElement('button');
    button.className = 'week-pill';
    button.textContent = String(week);
    button.title = `第 ${week} 周`;
    button.classList.toggle('active', week === state.selectedWeek);
    button.classList.toggle('current', week === state.currentWeek);
    button.addEventListener('click', () => {
      state.selectedWeek = week;
      state.hasUserSelectedWeek = true;
      renderSchedule();
    });
    root.append(button);
  }
  root.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function renderHeaders(dates) {
  const root = $('#dayHeaders');
  root.replaceChildren();
  const today = new Date();
  for (let index = 0; index < 7; index += 1) {
    const header = document.createElement('div');
    header.className = 'day-header';
    if (sameDay(dates[index], today)) header.classList.add('today');
    const weekday = document.createElement('span');
    weekday.className = 'weekday';
    weekday.textContent = dayNames[index];
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = shortDate(dates[index]);
    header.append(weekday, date);
    root.append(header);
  }
}

function renderTimeRail() {
  const root = $('#timeRail');
  root.replaceChildren();
  periods.forEach((period, index) => {
    const slot = document.createElement('div');
    slot.className = 'time-slot';
    slot.style.top = `calc(${index} * var(--row-height))`;
    const number = document.createElement('b');
    number.textContent = String(index + 1);
    const start = document.createElement('span');
    start.textContent = period[0];
    const end = document.createElement('span');
    end.textContent = period[1];
    slot.append(number, start, end);
    root.append(slot);
  });
}

function metaLine(icon, text, className = '') {
  const line = document.createElement('div');
  line.className = `course-meta ${className}`;
  line.innerHTML = icon;
  const content = document.createElement('span');
  content.textContent = text || '—';
  line.append(content);
  return line;
}

const locationIcon = '<svg viewBox="0 0 16 16"><path d="M13 6c0 3.5-5 8-5 8S3 9.5 3 6a5 5 0 0 1 10 0Z"/><circle cx="8" cy="6" r="1.5"/></svg>';
const personIcon = '<svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c.6-3 2.5-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/></svg>';

function courseButton(course) {
  const card = document.createElement('button');
  const span = Math.max(1, course.endSession - course.startSession + 1);
  card.className = `course-card${span === 1 ? ' compact' : ''}`;
  card.style.setProperty('--start', String(course.startSession));
  card.style.setProperty('--span', String(span));
  card.style.setProperty('--course-bg', hashColor(course.title));
  card.title = `${course.title}\n${course.place || '地点未公布'}\n${course.teacher || ''}`;
  const title = document.createElement('h3');
  title.textContent = course.title;
  card.append(title);
  card.append(metaLine(locationIcon, course.place || course.campus || '地点未公布'));
  card.append(metaLine(personIcon, course.teacher || '教师未公布', 'teacher-meta'));
  card.addEventListener('click', () => openCourse(course));
  return card;
}

function currentTimePosition() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (let index = 0; index < periods.length; index += 1) {
    const [startHour, startMinute] = periods[index][0].split(':').map(Number);
    const [endHour, endMinute] = periods[index][1].split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    if (minutes >= start && minutes <= end) return index + (minutes - start) / Math.max(1, end - start);
  }
  return null;
}

function renderDays(dates, activeCourses) {
  const root = $('#daysArea');
  root.replaceChildren();
  const today = new Date();
  const nowPosition = currentTimePosition();
  for (let day = 1; day <= 7; day += 1) {
    const column = document.createElement('div');
    column.className = 'day-column';
    if (day >= 6) column.classList.add('weekend');
    if (sameDay(dates[day - 1], today)) column.classList.add('today');
    activeCourses
      .filter((course) => course.weekday === day)
      .sort((a, b) => a.startSession - b.startSession)
      .forEach((course) => column.append(courseButton(course)));
    if (sameDay(dates[day - 1], today) && nowPosition !== null) {
      const line = document.createElement('div');
      line.className = 'now-line';
      line.style.top = `calc(${nowPosition} * var(--row-height))`;
      column.append(line);
    }
    root.append(column);
  }
}

function renderSummary(activeCourses) {
  const schedule = state.schedule;
  const student = schedule?.student || {};
  $('#studentName').textContent = student.name || (state.settings.username ? `学号 ${state.settings.username}` : '尚未登录');
  $('#studentAvatar').textContent = initials(student.name || '课');
  $('#termLabel').textContent = `${state.settings.academicYear}–${Number(state.settings.academicYear) + 1} 学年 · 第${state.settings.term === 1 ? '一' : '二'}学期`;
  const unique = new Set(activeCourses.map((course) => course.title)).size;
  $('#courseCount').textContent = `${unique} 门课程`;
  $('#accountText').textContent = state.settings.username ? `学号 ${state.settings.username}` : '尚未登录';
}

function renderSchedule() {
  if (!state.settings) return;
  const dates = weekDates(state.selectedWeek);
  const courses = state.schedule?.courses || [];
  const active = courses.filter((course) => !course.weeks?.length || course.weeks.includes(state.selectedWeek));
  $('#weekNumber').textContent = `第 ${state.selectedWeek} 周`;
  $('#weekRange').textContent = rangeLabel(dates);
  renderWeekPills();
  renderHeaders(dates);
  renderDays(dates, active);
  renderSummary(active);
  const hasSchedule = Boolean(state.schedule);
  $('#emptySchedule').classList.toggle('hidden', active.length > 0);
  $('#emptyScheduleTitle').textContent = hasSchedule ? '这一周没有课程' : '尚未导入课表';
  $('#emptyScheduleText').textContent = hasSchedule
    ? '可以切换周次，或重新登录教务系统导入最新课表。'
    : '点击导入后再登录教务系统，软件启动时不会主动要求登录。';
  $('#emptyScheduleAction').textContent = '导入课表';
  if (state.activePage === 'schedule') $('#syncButtonText').textContent = '导入课表';
  $('#syncText').textContent = formatSyncedAt(state.schedule?.syncedAt);
  $('#syncMeta').classList.toggle('online', Boolean(state.schedule));
}

function gradeTermKey(course) {
  return course.academicYear && course.term ? `${course.academicYear}-${course.term}` : 'unknown';
}

function gradeTermLabel(course) {
  if (!course.academicYear || !course.term) return '学期未标注';
  return `${course.academicYear}–${course.academicYear + 1} · 第${course.term === 1 ? '一' : '二'}学期`;
}

function gradeSummary(courses) {
  const scoreCourses = courses.filter((course) => Number(course.credit) > 0 && Number.isFinite(course.numericScore));
  const pointCourses = courses.filter((course) => Number(course.credit) > 0 && Number.isFinite(course.gradePoint));
  const scoreCredits = scoreCourses.reduce((sum, course) => sum + course.credit, 0);
  const pointCredits = pointCourses.reduce((sum, course) => sum + course.credit, 0);
  const weightedScore = scoreCredits
    ? scoreCourses.reduce((sum, course) => sum + course.credit * course.numericScore, 0) / scoreCredits
    : null;
  const weightedGradePoint = pointCredits
    ? pointCourses.reduce((sum, course) => sum + course.credit * course.gradePoint, 0) / pointCredits
    : null;
  return {
    weightedScore,
    weightedGradePoint,
    totalCredits: courses.reduce((sum, course) => sum + (Number(course.credit) || 0), 0),
    courseCount: courses.length,
    scoreCourseCount: scoreCourses.length,
    gradePointCourseCount: pointCourses.length
  };
}

function formatMetric(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/\.00$/, '') : '—';
}

function populateGradeTermFilter() {
  const select = $('#gradeTermFilter');
  const selected = select.value || 'all';
  const terms = new Map();
  for (const course of state.grades?.courses || []) {
    const key = gradeTermKey(course);
    if (key !== 'unknown') terms.set(key, gradeTermLabel(course));
  }
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = '全部学期';
  select.append(all);
  [...terms.entries()]
    .sort(([left], [right]) => right.localeCompare(left, 'zh-CN', { numeric: true }))
    .forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
  select.value = [...select.options].some((option) => option.value === selected) ? selected : 'all';
}

function filteredGrades() {
  const search = $('#gradeSearch').value.trim().toLocaleLowerCase('zh-CN');
  const term = $('#gradeTermFilter').value;
  const sort = $('#gradeSort').value;
  const direction = state.gradeSortDirection === 'asc' ? 1 : -1;
  const courses = (state.grades?.courses || []).filter((course) => {
    if (term !== 'all' && gradeTermKey(course) !== term) return false;
    if (!search) return true;
    return [course.title, course.teacher, course.courseNature, course.courseCategory, course.examNature]
      .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(search));
  });
  const numberFor = (course) => {
    if (sort === 'score') return Number.isFinite(course.numericScore) ? course.numericScore : -Infinity;
    if (sort === 'credit') return Number.isFinite(course.credit) ? course.credit : -Infinity;
    if (sort === 'gpa') return Number.isFinite(course.gradePoint) ? course.gradePoint : -Infinity;
    return (Number(course.academicYear) || 0) * 10 + (Number(course.term) || 0);
  };
  courses.sort((left, right) => {
    if (sort === 'name') return direction * left.title.localeCompare(right.title, 'zh-CN');
    const leftNumber = numberFor(left);
    const rightNumber = numberFor(right);
    if (leftNumber !== rightNumber) return direction * (leftNumber - rightNumber);
    return left.title.localeCompare(right.title, 'zh-CN');
  });
  return courses;
}

function gradeTone(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'medium';
  if (score >= 60) return 'pass';
  return 'fail';
}

function gradeComponent(label, value, emphasized = false) {
  const item = document.createElement('div');
  item.className = `grade-component${value === null || value === '' ? ' unavailable' : ''}${emphasized ? ' emphasized' : ''}`;
  const name = document.createElement('span');
  name.textContent = label;
  const score = document.createElement('b');
  score.textContent = value === null || value === '' ? '未公布' : String(value);
  item.append(name, score);
  return item;
}

function gradeDisplayValue(course) {
  const candidates = [course.rawGrade, course.percentageGrade];
  const clean = candidates.find((value) => value !== null
    && value !== undefined
    && String(value).trim()
    && !/[<>]/.test(String(value))
    && String(value).trim().length <= 12);
  return clean || (Number.isFinite(course.numericScore) ? formatMetric(course.numericScore, 1) : '—');
}

function visibleGradeDetails(course) {
  if (Array.isArray(course.scoreDetails) && course.scoreDetails.length) {
    return course.scoreDetails.map((detail) => ({
      label: detail.label || '成绩分项',
      score: detail.score
    }));
  }
  return [
    { label: '平时分', score: course.usualScore },
    { label: '卷面分', score: course.examScore },
    { label: '期中分', score: course.midtermScore },
    { label: '实验分', score: course.experimentScore },
    { label: '补考分', score: course.makeupScore },
    { label: '重修分', score: course.retakeScore }
  ].filter((detail) => detail.score !== null && detail.score !== undefined && detail.score !== '');
}

function gradeCard(course) {
  const card = document.createElement('article');
  card.className = `grade-card ${gradeTone(course.numericScore)}`;

  const badge = document.createElement('div');
  badge.className = 'grade-score-badge';
  const badgeLabel = document.createElement('span');
  badgeLabel.textContent = '总评';
  const mainScore = document.createElement('strong');
  mainScore.textContent = gradeDisplayValue(course);
  badge.append(badgeLabel, mainScore);
  if (course.qualitativeConverted && Number.isFinite(course.numericScore)) {
    const converted = document.createElement('small');
    converted.textContent = `折算 ${formatMetric(course.numericScore, 0)}`;
    badge.append(converted);
  }

  const content = document.createElement('div');
  content.className = 'grade-card-content';
  const heading = document.createElement('div');
  heading.className = 'grade-card-heading';
  const titleBlock = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = course.title;
  const subtitle = document.createElement('p');
  subtitle.textContent = [gradeTermLabel(course), course.teacher].filter(Boolean).join(' · ');
  titleBlock.append(title, subtitle);
  const nature = document.createElement('span');
  nature.className = 'grade-nature';
  nature.textContent = course.examNature || course.courseNature || '课程成绩';
  heading.append(titleBlock, nature);

  const facts = document.createElement('div');
  facts.className = 'grade-facts';
  for (const [label, value] of [
    ['学分', Number.isFinite(course.credit) ? formatMetric(course.credit, 1) : '—'],
    ['绩点', Number.isFinite(course.gradePoint) ? formatMetric(course.gradePoint, 2) : '—'],
    ['课程性质', course.courseNature || course.courseCategory || '未标注']
  ]) {
    const fact = document.createElement('span');
    fact.textContent = `${label}：${value}`;
    facts.append(fact);
  }

  const detailPanel = document.createElement('section');
  detailPanel.className = 'grade-detail-panel';
  const details = visibleGradeDetails(course);
  card.style.setProperty('--detail-rows', String(Math.max(1, Math.ceil(details.length / 2))));
  const detailHeading = document.createElement('div');
  detailHeading.className = 'grade-detail-heading';
  const detailTitle = document.createElement('strong');
  detailTitle.textContent = '成绩构成';
  const detailCount = document.createElement('span');
  detailCount.textContent = details.length ? `${details.length} 项` : '暂无分项';
  detailHeading.append(detailTitle, detailCount);
  const components = document.createElement('div');
  components.className = 'grade-components';
  if (details.length) {
    details.forEach((detail, index) => components.append(gradeComponent(detail.label, detail.score, index < 2)));
  } else {
    const empty = document.createElement('p');
    empty.className = 'grade-detail-empty';
    empty.textContent = '本门课程暂未返回平时、卷面等成绩分项';
    components.append(empty);
  }
  detailPanel.append(detailHeading, components);
  content.append(heading, facts);
  card.append(badge, content, detailPanel);
  return card;
}

function renderGrades({ rebuildTerms = false } = {}) {
  if (rebuildTerms) populateGradeTermFilter();
  const courses = filteredGrades();
  const summary = gradeSummary(courses);
  $('#weightedGradePoint').textContent = formatMetric(summary.weightedGradePoint);
  $('#weightedScore').textContent = formatMetric(summary.weightedScore);
  $('#totalCredits').textContent = formatMetric(summary.totalCredits, 1);
  $('#gradeCourseCount').textContent = `${summary.courseCount} 门课程`;
  $('#scoreCourseCount').textContent = `${summary.scoreCourseCount} 门参与`;
  $('#gradePointCourseCount').textContent = `${summary.gradePointCourseCount} 门参与`;
  $('#gradeResultCount').textContent = `${courses.length} 门`;
  $('#gradeUpdatedAt').textContent = state.grades?.syncedAt ? formatSyncedAt(state.grades.syncedAt) : '尚未读取';
  $('#gradeLoading').classList.toggle('hidden', !state.gradesLoading);
  const list = $('#gradeList');
  list.replaceChildren(...courses.map(gradeCard));
  $('#emptyGrades').classList.toggle('hidden', state.gradesLoading || courses.length > 0);
  const hasGrades = Boolean(state.grades);
  const filteredEmpty = hasGrades && (state.grades.courses || []).length > 0;
  $('#emptyGradesTitle').textContent = filteredEmpty ? '没有符合条件的成绩' : '尚未导入成绩';
  $('#emptyGradesText').textContent = filteredEmpty
    ? '可以清除搜索或更换学期筛选条件。'
    : '点击导入后再登录教务系统，已有成绩会缓存在本机。';
  $('#emptyGradesAction').textContent = '导入成绩';
  $('#emptyGradesAction').classList.toggle('hidden', filteredEmpty);
  if (state.activePage === 'grades') $('#syncButtonText').textContent = '导入成绩';
}

async function switchPage(page) {
  state.activePage = page === 'grades' ? 'grades' : 'schedule';
  const gradesPage = state.activePage === 'grades';
  $('#scheduleView').classList.toggle('hidden', gradesPage);
  $('#gradesView').classList.toggle('hidden', !gradesPage);
  $('#pageTitle').textContent = gradesPage ? '我的成绩' : '我的课表';
  $('#syncButtonText').textContent = gradesPage ? '导入成绩' : '导入课表';
  $('#desktopButton').classList.toggle('hidden', gradesPage);
  document.querySelectorAll('.page-tab').forEach((button) => button.classList.toggle('active', button.dataset.page === state.activePage));
  if (gradesPage) {
    renderGrades({ rebuildTerms: true });
    setSyncStatus(state.grades ? 'online' : '', formatSyncedAt(state.grades?.syncedAt));
  } else {
    renderSchedule();
    setSyncStatus(state.schedule ? 'online' : '', formatSyncedAt(state.schedule?.syncedAt));
  }
}

function openCourse(course) {
  const color = hashColor(course.title);
  $('.course-dialog').style.setProperty('--course-color', color);
  $('#courseWeeks').textContent = course.weeksText || '周次未注明';
  $('#courseTitle').textContent = course.title;
  $('#courseTime').textContent = `${dayNames[course.weekday - 1]} · 第 ${course.startSession}${course.endSession > course.startSession ? `–${course.endSession}` : ''} 节 · ${course.time}`;
  $('#coursePlace').textContent = course.place || course.campus || '未公布';
  $('#courseTeacher').textContent = course.teacher || '未公布';
  $('#courseClass').textContent = course.className || course.courseId || '未公布';
  $('#courseModal').classList.remove('hidden');
}

async function syncSchedule({ quiet = false, authRetry = true } = {}) {
  if (state.syncing) return false;
  state.syncing = true;
  $('#syncButton').disabled = true;
  setSyncStatus('', '正在连接教务系统…');
  const result = await api.syncSchedule({ academicYear: state.settings.academicYear, term: state.settings.term });
  state.syncing = false;
  $('#syncButton').disabled = false;
  if (result.status === 'success') {
    state.schedule = result.schedule;
    state.authenticated = true;
    if (!state.hasUserSelectedWeek) state.selectedWeek = relevantTeachingWeek();
    setSyncStatus('online', formatSyncedAt(result.schedule.syncedAt));
    renderSchedule();
    if (!quiet) toast(`已同步 ${new Set(result.schedule.courses.map((item) => item.title)).size} 门课程`);
    return true;
  }
  if (result.code === 'AUTH_EXPIRED' && authRetry) {
    setSyncStatus('error', '需要登录');
    if (state.hasSavedPassword) {
      showLogin();
      setBusy(true, '正在恢复登录…');
      const authResult = await api.autoLogin();
      setBusy(false);
      await handleAuthResult(authResult, true);
    } else {
      showLogin();
      showLoginError('登录已过期，请重新登录。');
      prepareCaptcha();
    }
    return false;
  }
  setSyncStatus('error', result.message);
  if (!quiet) toast(result.message, 'error', 4800);
  return false;
}

async function syncGrades({ quiet = false, authRetry = true } = {}) {
  if (state.gradesLoading) return false;
  state.gradesLoading = true;
  $('#syncButton').disabled = true;
  setSyncStatus('', '正在读取成绩…');
  renderGrades();
  const result = await api.syncGrades({ academicYear: 0, term: 0 });
  state.gradesLoading = false;
  $('#syncButton').disabled = false;
  if (result.status === 'success') {
    state.grades = result.grades;
    state.authenticated = true;
    setSyncStatus('online', formatSyncedAt(result.grades.syncedAt));
    renderGrades({ rebuildTerms: true });
    if (!quiet) {
      const detailCount = Number(result.grades.detailStatus?.courseCount) || 0;
      const suffix = detailCount
        ? `，${detailCount} 门含成绩分项`
        : (result.grades.detailStatus?.message ? '；成绩分项暂未返回' : '');
      toast(`已读取 ${result.grades.courses.length} 门课程成绩${suffix}`);
    }
    return true;
  }
  renderGrades();
  if (result.code === 'AUTH_EXPIRED' && authRetry) {
    setSyncStatus('error', '需要登录');
    if (state.hasSavedPassword) {
      showLogin();
      setBusy(true, '正在恢复登录…');
      const authResult = await api.autoLogin();
      setBusy(false);
      await handleAuthResult(authResult, true);
    } else {
      showLogin();
      showLoginError('登录已过期，请重新登录。');
      prepareCaptcha();
    }
    return false;
  }
  setSyncStatus('error', result.message);
  if (!quiet) toast(result.message, 'error', 4800);
  return false;
}

async function syncImportData(options = {}) {
  return state.importTarget === 'grades' ? syncGrades(options) : syncSchedule(options);
}

async function importOrRefresh(target = state.activePage) {
  state.importTarget = target === 'grades' ? 'grades' : 'schedule';
  state.authenticated = false;
  showLogin();
  showLoginError('');
  setBusy(true, '正在准备登录…');
  const reset = await api.resetSession();
  setBusy(false);
  if (reset.status !== 'success') {
    showLoginError(reset.message || '无法重置登录会话，请重试。');
    return false;
  }
  if (state.hasSavedPassword) {
    setBusy(true, '正在重新登录…');
    const result = await api.autoLogin();
    setBusy(false);
    await handleAuthResult(result, true);
  } else {
    await prepareCaptcha();
  }
  return false;
}

async function handleAuthResult(result, autoMode = false) {
  if (result.status === 'success') {
    state.authenticated = true;
    state.hasSavedPassword = autoMode || $('#rememberPassword').checked;
    state.settings.username = $('#username').value.trim() || state.settings.username;
    hideLogin();
    toast(`登录成功，正在读取${loginTargetText()}`);
    await syncImportData({ quiet: false, authRetry: false });
    return;
  }
  if (result.status === 'captcha') {
    showLogin();
    showCaptcha(result, autoMode);
    return;
  }
  showLogin();
  showLoginError(result.message || '登录失败，请重试');
}

async function submitLogin(event) {
  event.preventDefault();
  showLoginError('');
  setBusy(true);
  let result;
  if (state.captchaToken) {
    result = await api.submitCaptcha({
      token: state.captchaToken,
      code: $('#captcha').value.trim(),
      username: $('#username').value.trim(),
      password: $('#password').value,
      remember: $('#rememberPassword').checked
    });
  } else {
    result = await api.login({
      username: $('#username').value.trim(),
      password: $('#password').value,
      remember: $('#rememberPassword').checked
    });
  }
  setBusy(false);
  await handleAuthResult(result, state.captchaAutoMode);
}

async function refreshCaptcha() {
  showLoginError('');
  $('#captcha').value = '';
  await prepareCaptcha();
}

async function saveSettings() {
  const oldYear = state.settings.academicYear;
  const oldTerm = state.settings.term;
  const next = {
    academicYear: Number($('#academicYear').value),
    term: Number($('#term').value),
    semesterStart: $('#semesterStart').value,
    dailyWidget: $('#dailyWidget').checked,
    widgetDesktopPinned: $('#widgetDesktopPinned').checked,
    widgetAlwaysOnTop: $('#widgetAlwaysOnTop').checked,
    widgetSizePreset: $('#widgetSizePreset').value,
    widgetDensity: $('#widgetDensity').value,
    widgetShowCompleted: !$('#widgetHideCompleted').checked,
    widgetLocked: $('#widgetLocked').checked,
    widgetClickThrough: $('#widgetClickThrough').checked,
    widgetPanelOpacity: Number($('#widgetPanelOpacity').value) / 100,
    widgetCardOpacity: Number($('#widgetCardOpacity').value) / 100,
    classReminder: $('#classReminder').checked,
    reminderMinutes: Number($('#reminderMinutes').value),
    alwaysOnTop: $('#alwaysOnTop').checked,
    autoStart: $('#autoStart').checked,
    closeToTray: $('#closeToTray').checked,
    opacity: Number($('#opacity').value) / 100,
    themeColor: $('#themeColor').value,
    backgroundOpacity: Number($('#backgroundOpacity').value) / 100,
    backgroundBlur: Number($('#backgroundBlur').value),
    panelOpacity: Number($('#panelOpacity').value) / 100,
    cardOpacity: Number($('#cardOpacity').value) / 100,
    colorMode: $('#colorMode').value
  };
  const result = await api.saveSettings(next);
  state.settings = result.settings;
  state.currentWeek = weekForToday();
  state.hasUserSelectedWeek = false;
  state.selectedWeek = relevantTeachingWeek();
  applyAppearance();
  closeSettings(false);
  renderSchedule();
  toast('设置已保存');
  if (oldYear !== next.academicYear || oldTerm !== next.term) await importOrRefresh('schedule');
}

async function quickDesktopToggle() {
  const result = await api.toggleWidget();
  state.settings = result.settings;
  applyAppearance();
  toast(result.open ? '今日课表已显示在桌面' : '已关闭今日桌面课表');
}

async function quickColorModeToggle() {
  const nextMode = resolvedColorMode() === 'dark' ? 'light' : 'dark';
  const result = await api.saveSettings({ colorMode: nextMode });
  state.settings = result.settings;
  applyAppearance();
  toast(nextMode === 'light' ? '已切换到明亮模式' : '已切换到深色模式');
}

function bindEvents() {
  $('#minimizeButton').addEventListener('click', () => api.windowAction('minimize'));
  $('#maximizeButton').addEventListener('click', () => api.windowAction('maximize'));
  $('#closeButton').addEventListener('click', () => api.windowAction('close'));
  $('#syncButton').addEventListener('click', () => importOrRefresh());
  $('#emptyScheduleAction').addEventListener('click', () => importOrRefresh('schedule'));
  $('#emptyGradesAction').addEventListener('click', () => importOrRefresh('grades'));
  document.querySelectorAll('.page-tab').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
  $('#gradeSearch').addEventListener('input', () => renderGrades());
  $('#gradeTermFilter').addEventListener('change', () => renderGrades());
  $('#gradeSort').addEventListener('change', () => renderGrades());
  $('#gradeSortDirection').addEventListener('click', () => {
    state.gradeSortDirection = state.gradeSortDirection === 'desc' ? 'asc' : 'desc';
    const ascending = state.gradeSortDirection === 'asc';
    $('#gradeSortDirection').dataset.direction = state.gradeSortDirection;
    $('#gradeSortDirection span').textContent = ascending ? '升序' : '降序';
    renderGrades();
  });
  $('#desktopButton').addEventListener('click', quickDesktopToggle);
  $('#colorModeButton').addEventListener('click', quickColorModeToggle);
  $('#settingsButton').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#cancelSettings').addEventListener('click', closeSettings);
  $('#backdrop').addEventListener('click', closeSettings);
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#opacity').addEventListener('input', () => { $('#opacityValue').textContent = `${$('#opacity').value}%`; });
  $('#widgetPanelOpacity').addEventListener('input', () => { $('#widgetPanelOpacityValue').textContent = `${$('#widgetPanelOpacity').value}%`; });
  $('#widgetCardOpacity').addEventListener('input', () => { $('#widgetCardOpacityValue').textContent = `${$('#widgetCardOpacity').value}%`; });
  $('#widgetDesktopPinned').addEventListener('change', () => {
    if ($('#widgetDesktopPinned').checked) $('#widgetAlwaysOnTop').checked = false;
  });
  $('#widgetAlwaysOnTop').addEventListener('change', () => {
    if ($('#widgetAlwaysOnTop').checked) $('#widgetDesktopPinned').checked = false;
  });
  document.querySelectorAll('#widgetSizeSwitch button').forEach((button) => button.addEventListener('click', () => {
    $('#widgetSizePreset').value = button.dataset.value;
    updateWidgetSettingSelections();
  }));
  document.querySelectorAll('#widgetDensitySwitch button').forEach((button) => button.addEventListener('click', () => {
    $('#widgetDensity').value = button.dataset.value;
    updateWidgetSettingSelections();
  }));
  $('#academicYear').addEventListener('change', () => { $('#semesterStart').value = semesterSuggestion($('#academicYear').value, $('#term').value); });
  $('#term').addEventListener('change', () => { $('#semesterStart').value = semesterSuggestion($('#academicYear').value, $('#term').value); });
  $('#previousWeek').addEventListener('click', () => { state.hasUserSelectedWeek = true; state.selectedWeek = Math.max(1, state.selectedWeek - 1); renderSchedule(); });
  $('#nextWeek').addEventListener('click', () => { state.hasUserSelectedWeek = true; state.selectedWeek = Math.min(25, state.selectedWeek + 1); renderSchedule(); });
  $('#weekTitle').addEventListener('click', () => { state.hasUserSelectedWeek = false; state.selectedWeek = relevantTeachingWeek(); renderSchedule(); });
  $('#loginForm').addEventListener('submit', submitLogin);
  $('#closeLogin').addEventListener('click', hideLogin);
  $('#captchaImageButton').addEventListener('click', refreshCaptcha);
  $('#officialLoginButton').addEventListener('click', async () => {
    await api.openOfficialLogin();
    showLoginError('请在打开的矿大官方页面中完成登录，成功后会自动返回。');
  });
  $('#closeCourseModal').addEventListener('click', () => $('#courseModal').classList.add('hidden'));
  $('#courseModal').addEventListener('click', (event) => {
    if (event.target === $('#courseModal')) $('#courseModal').classList.add('hidden');
  });
  $('#logoutButton').addEventListener('click', async () => {
    await api.logout(true);
    state.hasSavedPassword = false;
    state.authenticated = false;
    state.settings.username = '';
    await api.saveSettings({ username: '', rememberPassword: false });
    closeSettings();
    toast('已退出登录并清除本机账号凭据；下次导入时再登录。');
  });
  document.querySelectorAll('.theme-swatch').forEach((button) => button.addEventListener('click', () => {
    $('#themeColor').value = button.dataset.color;
    applyAppearance({ ...state.settings, colorMode: $('#colorMode').value, themeColor: button.dataset.color });
  }));
  $('#themeColor').addEventListener('input', () => {
    applyAppearance({ ...state.settings, colorMode: $('#colorMode').value, themeColor: $('#themeColor').value });
  });
  document.querySelectorAll('#colorModeSwitch button').forEach((button) => button.addEventListener('click', () => {
    $('#colorMode').value = button.dataset.mode;
    updateModeSelection(button.dataset.mode);
    applyAppearance({ ...state.settings, colorMode: button.dataset.mode, themeColor: $('#themeColor').value });
  }));
  for (const id of ['backgroundOpacity', 'backgroundBlur', 'panelOpacity', 'cardOpacity']) {
    $(`#${id}`).addEventListener('input', () => {
      updateAppearanceOutputs();
      const preview = {
        ...state.settings,
        colorMode: $('#colorMode').value,
        themeColor: $('#themeColor').value,
        backgroundOpacity: Number($('#backgroundOpacity').value) / 100,
        backgroundBlur: Number($('#backgroundBlur').value),
        panelOpacity: Number($('#panelOpacity').value) / 100,
        cardOpacity: Number($('#cardOpacity').value) / 100
      };
      applyAppearance(preview);
    });
  }
  $('#chooseBackground').addEventListener('click', async () => {
    const result = await api.chooseBackground();
    if (result.status === 'success') {
      state.background = result.dataURL;
      applyAppearance();
      updateBackgroundPreview();
      toast(`已导入背景：${result.sourceName}`);
    } else if (result.status === 'error') toast(result.message, 'error');
  });
  $('#clearBackground').addEventListener('click', async () => {
    await api.clearBackground();
    state.background = null;
    applyAppearance();
    updateBackgroundPreview();
    toast('已恢复默认背景');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#courseModal').classList.contains('hidden')) $('#courseModal').classList.add('hidden');
    else if ($('#settingsDrawer').classList.contains('open')) closeSettings();
    else if (!$('#loginOverlay').classList.contains('hidden')) hideLogin();
  });

  api.onWebLoginSuccess(async () => {
    state.authenticated = true;
    hideLogin();
    toast(`官方网页登录成功，正在读取${loginTargetText()}`);
    await syncImportData({ authRetry: false });
  });
  api.onSyncRequested(() => importOrRefresh('schedule'));
  api.onScheduleUpdated((schedule) => {
    state.schedule = schedule;
    if (!state.hasUserSelectedWeek) state.selectedWeek = relevantTeachingWeek();
    renderSchedule();
  });
  api.onGradesUpdated((grades) => {
    state.grades = grades;
    renderGrades({ rebuildTerms: true });
  });
  api.onSettingsChanged((settings) => {
    state.settings = settings;
    applyAppearance();
  });
  api.onBackgroundChanged((background) => {
    state.background = background;
    applyAppearance();
    updateBackgroundPreview();
  });
  api.onOpenSettings(openSettings);
  systemColorPreference.addEventListener('change', () => {
    if (state.settings?.colorMode === 'system') applyAppearance();
  });
  api.onMaximized((maximized) => $('#maximizeButton').classList.toggle('active', maximized));
}

async function initialize() {
  populateYearSelect();
  renderTimeRail();
  bindEvents();
  const bootstrap = await api.bootstrap();
  state.settings = bootstrap.settings;
  state.schedule = bootstrap.schedule;
  state.grades = bootstrap.grades;
  state.background = bootstrap.backgroundDataURL;
  state.hasSavedPassword = bootstrap.hasSavedPassword;
  state.version = bootstrap.version;
  state.currentWeek = weekForToday();
  state.selectedWeek = relevantTeachingWeek();
  applyAppearance();
  populateSettingsForm();
  renderSchedule();
  renderGrades({ rebuildTerms: true });

  // 启动只展示本地缓存。仅在用户主动导入课表或成绩时访问教务系统并登录。
}

initialize().catch((error) => {
  setSyncStatus('error', '应用初始化失败');
  toast(`应用初始化失败：${error.message}`, 'error', 8000);
});
