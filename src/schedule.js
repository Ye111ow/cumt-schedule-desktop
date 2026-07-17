'use strict';

const PERIODS = [
  ['08:00', '08:50'],
  ['08:55', '09:45'],
  ['10:15', '11:05'],
  ['11:10', '12:00'],
  ['14:00', '14:50'],
  ['14:55', '15:45'],
  ['16:15', '17:05'],
  ['17:10', '18:00'],
  ['19:00', '19:50'],
  ['19:55', '20:45'],
  ['20:55', '21:45'],
  ['21:50', '22:40']
];

function asInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseWeeks(input) {
  if (!input) return [];
  const weeks = [];
  const segments = String(input).replace(/\s+/g, '').split(/[，,、;]/);

  for (const segment of segments) {
    const range = segment.match(/(\d+)\s*(?:[-~～至]\s*(\d+))?/);
    if (!range) continue;
    const start = Number(range[1]);
    const end = Number(range[2] || range[1]);
    const oddOnly = /单/.test(segment);
    const evenOnly = /双/.test(segment);
    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      if (oddOnly && week % 2 === 0) continue;
      if (evenOnly && week % 2 !== 0) continue;
      weeks.push(week);
    }
  }
  return uniqueSorted(weeks);
}

function parseSessions(input) {
  if (!input) return [];
  const sessions = [];
  const ranges = String(input).matchAll(/(\d+)\s*(?:[-~～至]\s*(\d+))?/g);
  for (const match of ranges) {
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let session = Math.min(start, end); session <= Math.max(start, end); session += 1) {
      if (session >= 1 && session <= PERIODS.length) sessions.push(session);
    }
  }
  return uniqueSorted(sessions);
}

function academicPeriodForDate(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 8) return { academicYear: year, term: 1 };
  if (month <= 2) return { academicYear: year - 1, term: 1 };
  return { academicYear: year - 1, term: 2 };
}

function firstMondayOnOrAfter(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = (8 - result.getDay()) % 7;
  result.setDate(result.getDate() + days);
  return result;
}

function toDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function suggestedSemesterStart(academicYear, term) {
  const date = term === 1
    ? new Date(academicYear, 8, 1)
    : new Date(academicYear + 1, 1, 20);
  return toDateInput(firstMondayOnOrAfter(date));
}

function calculateWeek(semesterStart, date = new Date()) {
  if (!semesterStart) return 1;
  const start = new Date(`${semesterStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(1, Math.floor((today - start) / 604_800_000) + 1);
}

function teachingWeeks(schedule) {
  const courses = Array.isArray(schedule?.courses) ? schedule.courses : [];
  return uniqueSorted(courses.flatMap((course) => Array.isArray(course.weeks) ? course.weeks : []));
}

function resolveDisplayWeek(schedule, semesterStart, date = new Date()) {
  const current = calculateWeek(semesterStart, date);
  const arranged = teachingWeeks(schedule);
  return arranged.includes(current) ? current : 1;
}

function mondayBasedWeekday(date = new Date()) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function coursesForDay(schedule, week, date = new Date()) {
  const weekday = mondayBasedWeekday(date);
  return (Array.isArray(schedule?.courses) ? schedule.courses : [])
    .filter((course) => course.weekday === weekday && (!course.weeks?.length || course.weeks.includes(week)))
    .sort((a, b) => a.startSession - b.startSession || a.endSession - b.endSession);
}

function normalizeCourse(item) {
  const sessions = parseSessions(item.jc);
  const weeks = parseWeeks(item.zcd);
  const startSession = sessions[0] ?? 1;
  const endSession = sessions.at(-1) ?? startSession;
  const weekday = asInteger(item.xqj);
  return {
    id: [item.kch_id, item.kcmc, item.xqj, item.jc, item.zcd, item.cdmc].join('|'),
    courseId: item.kch_id || '',
    title: item.kcmc || '未命名课程',
    teacher: item.xm || '',
    className: item.jxbmc || '',
    credit: item.xf || '',
    weekday: weekday && weekday >= 1 && weekday <= 7 ? weekday : 1,
    sessions,
    startSession,
    endSession,
    time: `${PERIODS[startSession - 1]?.[0] || ''}–${PERIODS[endSession - 1]?.[1] || ''}`,
    weeksText: item.zcd || '',
    weeks,
    campus: item.xqmc || '',
    place: String(item.cdmc || '').replace(/<br\s*\/?>.*/is, '').trim(),
    evaluation: item.khfsmc || '',
    raw: item
  };
}

function normalizeSchedule(payload, academicYear, term) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const student = source.xsxx || {};
  const courses = Array.isArray(source.kbList) ? source.kbList.map(normalizeCourse) : [];
  return {
    student: {
      id: student.XH || student.xh || '',
      name: student.XM || student.xm || ''
    },
    academicYear: Number(academicYear),
    term: Number(term),
    syncedAt: new Date().toISOString(),
    courses,
    extraCourses: Array.isArray(source.sjkList)
      ? source.sjkList.map((item) => item?.qtkcgs).filter(Boolean)
      : []
  };
}

module.exports = {
  PERIODS,
  academicPeriodForDate,
  calculateWeek,
  coursesForDay,
  mondayBasedWeekday,
  normalizeCourse,
  normalizeSchedule,
  parseSessions,
  parseWeeks,
  resolveDisplayWeek,
  suggestedSemesterStart,
  teachingWeeks,
  toDateInput
};
