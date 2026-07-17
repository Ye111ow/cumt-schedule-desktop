'use strict';

const api = window.cumtSchedule;
const $ = (selector) => document.querySelector(selector);
const logic = window.WidgetLogic;
const systemColorPreference = window.matchMedia('(prefers-color-scheme: dark)');
const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const periods = [
  ['08:00', '08:50'], ['08:55', '09:45'], ['10:15', '11:05'], ['11:10', '12:00'],
  ['14:00', '14:50'], ['14:55', '15:45'], ['16:15', '17:05'], ['17:10', '18:00'],
  ['19:00', '19:50'], ['19:55', '20:45'], ['20:55', '21:45'], ['21:50', '22:40']
];
const palette = ['#62d6ad', '#8f83ef', '#6495ed', '#ee9364', '#d875a3', '#52bfd2', '#a8c86a', '#dfb25b'];
const locationIcon = '<svg viewBox="0 0 16 16"><path d="M13 6c0 3.5-5 8-5 8S3 9.5 3 6a5 5 0 0 1 10 0Z"/><circle cx="8" cy="6" r="1.5"/></svg>';
const personIcon = '<svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c.6-3 2.5-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/></svg>';

const state = { settings: null, schedule: null, background: null, selectedDayOffset: 0 };

function hashColor(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year, month - 1, day);
  return Number.isNaN(result.getTime()) ? null : result;
}

function calculatedWeek(date = new Date()) {
  const start = parseDate(state.settings?.semesterStart);
  if (!start) return 1;
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((today - start) / 604_800_000) + 1;
}

function resolvedWeek(date = new Date()) {
  const current = calculatedWeek(date);
  const arranged = new Set((state.schedule?.courses || []).flatMap((course) => course.weeks || []));
  const inTeachingWeek = current >= 1 && (arranged.size === 0 || arranged.has(current));
  return { week: current, inTeachingWeek };
}

function applyAppearance() {
  if (!state.settings) return;
  const root = document.documentElement;
  const configuredMode = state.settings.colorMode || 'dark';
  const colorMode = configuredMode === 'system' ? (systemColorPreference.matches ? 'dark' : 'light') : configuredMode;
  root.dataset.colorMode = colorMode;
  root.style.setProperty('--accent', state.settings.themeColor || '#62d6ad');
  root.style.setProperty('--background-opacity', String(state.settings.backgroundOpacity ?? .72));
  root.style.setProperty('--background-blur', `${state.settings.backgroundBlur ?? 8}px`);
  root.style.setProperty('--card-alpha', String(state.settings.widgetCardOpacity ?? state.settings.cardOpacity ?? .92));
  root.style.setProperty('--panel-bg', `rgba(15, 25, 43, ${state.settings.widgetPanelOpacity ?? state.settings.panelOpacity ?? .9})`);
  root.dataset.density = state.settings.widgetDensity || 'comfortable';
  root.dataset.sizePreset = state.settings.widgetSizePreset || 'standard';
  root.dataset.desktopPinned = state.settings.widgetDesktopPinned ? 'true' : 'false';
  $('#widgetBackground').style.backgroundImage = state.background ? `url("${state.background}")` : 'linear-gradient(145deg,#24496f,#276a60)';
  $('#widgetColorMode').title = colorMode === 'dark' ? '切换到明亮模式' : '切换到深色模式';
  $('#desktopPin').classList.toggle('active', Boolean(state.settings.widgetDesktopPinned));
  $('#desktopPin').title = state.settings.widgetDesktopPinned ? '取消固定到 Windows 桌面' : '固定到 Windows 桌面';
}

async function toggleColorMode() {
  const current = document.documentElement.dataset.colorMode || 'dark';
  const result = await api.saveSettings({ colorMode: current === 'dark' ? 'light' : 'dark' });
  state.settings = result.settings;
  applyAppearance();
}

async function toggleDesktopPin() {
  const pinned = !state.settings.widgetDesktopPinned;
  const result = await api.saveSettings({ widgetDesktopPinned: pinned });
  state.settings = result.settings;
  applyAppearance();
  widgetToast(pinned ? '已固定到桌面，普通窗口会覆盖课表' : '已取消桌面固定');
}

function addDetail(root, icon, value) {
  const detail = document.createElement('span');
  detail.innerHTML = icon;
  const text = document.createElement('span');
  text.textContent = value;
  detail.append(text);
  root.append(detail);
}

function renderCourse(course, now, displayDate) {
  const item = document.createElement('article');
  const phase = logic.coursePhase(course, now, displayDate, periods);
  item.className = `today-course ${phase}`;
  item.style.setProperty('--course-color', hashColor(course.title));
  const time = document.createElement('div');
  time.className = 'course-time';
  const start = document.createElement('b');
  start.textContent = periods[course.startSession - 1]?.[0] || `第${course.startSession}节`;
  const end = document.createElement('span');
  end.textContent = periods[course.endSession - 1]?.[1] || '';
  time.append(start, end);
  const panel = document.createElement('div');
  panel.className = 'course-panel';
  const title = document.createElement('h2');
  title.textContent = course.title;
  const phaseLabel = document.createElement('span');
  phaseLabel.className = 'course-phase';
  phaseLabel.textContent = phase === 'current' ? '进行中' : (phase === 'past' ? '已结束' : '待上课');
  const details = document.createElement('div');
  details.className = 'course-details';
  addDetail(details, locationIcon, course.place || course.campus || '地点未公布');
  addDetail(details, personIcon, course.teacher || '教师未公布');
  panel.append(title, phaseLabel, details);
  if (phase === 'current') {
    const timing = logic.courseTiming(course, periods);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const progress = timing.end > timing.start ? Math.max(0, Math.min(1, (minutes - timing.start) / (timing.end - timing.start))) : 0;
    const bar = document.createElement('i');
    bar.className = 'course-progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.round(progress * 100)}%`;
    bar.append(fill);
    panel.append(bar);
  }
  item.append(time, panel);
  return item;
}

function updateClock(now = new Date(), displayDate = now) {
  $('#liveTime').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#todayDate').textContent = `${displayDate.getFullYear()}年${displayDate.getMonth() + 1}月${displayDate.getDate()}日 · ${weekdayNames[displayDate.getDay()]}`;
}

function coursesForDate(date) {
  const display = resolvedWeek(date);
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  const courses = display.inTeachingWeek
    ? (state.schedule?.courses || [])
      .filter((course) => course.weekday === weekday && (!course.weeks?.length || course.weeks.includes(display.week)))
      .sort((a, b) => a.startSession - b.startSession)
    : [];
  return { courses, display, weekday };
}

function visibleCoursesForDate(date, now) {
  const result = coursesForDate(date);
  const shouldHideCompleted = state.settings.widgetShowCompleted === false && logic.sameDay(date, now);
  return {
    ...result,
    scheduledCount: result.courses.length,
    courses: shouldHideCompleted
      ? result.courses.filter((course) => logic.coursePhase(course, now, date, periods) !== 'past')
      : result.courses
  };
}

function updateCourseStatus(courses, now, displayDate) {
  const current = courses.find((course) => logic.coursePhase(course, now, displayDate, periods) === 'current');
  const upcoming = courses.find((course) => logic.coursePhase(course, now, displayDate, periods) === 'upcoming');
  const target = current || upcoming;
  const panel = $('#courseStatus');
  panel.classList.toggle('hidden', !target);
  if (!target) return;
  const timing = logic.courseTiming(target, periods);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  $('#courseStatusTitle').textContent = target.title;
  if (current) {
    const remaining = Math.max(0, timing.end - nowMinutes);
    const progress = timing.end > timing.start ? (nowMinutes - timing.start) / (timing.end - timing.start) : 0;
    $('#courseStatusLabel').textContent = '正在上课';
    $('#courseStatusTime').textContent = `还剩 ${logic.formatDuration(remaining)}`;
    $('#courseStatusProgress').style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    panel.classList.remove('preview');
  } else {
    $('#courseStatusLabel').textContent = logic.sameDay(displayDate, now) ? '下一节课' : '课程预览';
    $('#courseStatusTime').textContent = logic.sameDay(displayDate, now)
      ? `还有 ${logic.formatDuration(timing.start - nowMinutes)}`
      : `${periods[target.startSession - 1]?.[0] || ''} 开始`;
    $('#courseStatusProgress').style.width = '0%';
    panel.classList.add('preview');
  }
}

function render() {
  if (!state.settings) return;
  const now = new Date();
  const displayDate = logic.addDays(now, state.selectedDayOffset);
  const { courses, display, scheduledCount } = visibleCoursesForDate(displayDate, now);
  updateClock(now, displayDate);
  $('#displayWeek').textContent = display.inTeachingWeek ? `第 ${display.week} 周` : '非教学周';
  $('#weekday').textContent = weekdayNames[displayDate.getDay()];
  $('#backToday').classList.toggle('inactive', state.selectedDayOffset === 0);
  const root = $('#courseList');
  root.replaceChildren(...courses.map((course) => renderCourse(course, now, displayDate)));
  root.classList.toggle('hidden', courses.length === 0);
  $('#emptyToday').classList.toggle('hidden', courses.length > 0);
  if (!state.schedule) {
    $('#emptyTitle').textContent = '尚未导入课表';
    $('#emptyHint').textContent = '请先从主窗口导入课表。';
  } else if (!display.inTeachingWeek) {
    $('#emptyTitle').textContent = '当前不在教学周';
    $('#emptyHint').textContent = '不会展示其他周次的课程。';
  } else if (scheduledCount > 0) {
    $('#emptyTitle').textContent = state.selectedDayOffset === 0 ? '今天的课程已结束' : '这一天的课程已结束';
    $('#emptyHint').textContent = '已按设置隐藏结束的课程。';
  } else {
    $('#emptyTitle').textContent = state.selectedDayOffset === 0 ? '今天没有课程' : '这一天没有课程';
    $('#emptyHint').textContent = state.selectedDayOffset === 0 ? '今天保持空白，不预览其他日期。' : '可以继续切换日期查看。';
  }
  updateCourseStatus(courses, now, displayDate);
  $('#syncState').textContent = state.schedule?.syncedAt
    ? `更新 ${new Date(state.schedule.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '尚未同步';
}

function widgetToast(message) {
  const item = $('#widgetToast');
  item.textContent = message;
  item.classList.remove('hidden');
  window.setTimeout(() => item.classList.add('hidden'), 3000);
}

async function importSchedule() {
  await api.requestScheduleImport();
  widgetToast('请在主窗口登录后导入课表');
}

async function initialize() {
  const bootstrap = await api.bootstrap();
  state.settings = bootstrap.settings;
  state.schedule = bootstrap.schedule;
  state.background = bootstrap.backgroundDataURL;
  applyAppearance();
  render();
  $('#closeWidget').addEventListener('click', () => api.closeWidget());
  $('#widgetColorMode').addEventListener('click', toggleColorMode);
  $('#desktopPin').addEventListener('click', toggleDesktopPin);
  $('#openMain').addEventListener('click', () => api.openMain(false));
  $('#widgetSettings').addEventListener('click', () => api.openMain(true));
  $('#widgetSync').addEventListener('click', importSchedule);
  $('#previousDay').addEventListener('click', () => { state.selectedDayOffset -= 1; render(); });
  $('#nextDay').addEventListener('click', () => { state.selectedDayOffset += 1; render(); });
  $('#backToday').addEventListener('click', () => { state.selectedDayOffset = 0; render(); });
  api.onScheduleUpdated((schedule) => { state.schedule = schedule; render(); });
  api.onSettingsChanged((settings) => { state.settings = settings; applyAppearance(); render(); });
  api.onBackgroundChanged((background) => { state.background = background; applyAppearance(); });
  systemColorPreference.addEventListener('change', () => {
    if (state.settings?.colorMode === 'system') applyAppearance();
  });
  window.setInterval(render, 60_000);
}

initialize().catch((error) => widgetToast(`加载失败：${error.message}`));
