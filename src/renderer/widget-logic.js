'use strict';

(function exposeWidgetLogic(globalObject) {
  function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, count) {
    const result = dateOnly(date);
    result.setDate(result.getDate() + count);
    return result;
  }

  function sameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  function timeMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function courseTiming(course, periods) {
    const start = timeMinutes(periods[Number(course.startSession) - 1]?.[0]);
    const end = timeMinutes(periods[Number(course.endSession) - 1]?.[1]);
    return { start, end };
  }

  function coursePhase(course, now, date, periods) {
    if (!sameDay(now, date)) return date < dateOnly(now) ? 'past' : 'upcoming';
    const timing = courseTiming(course, periods);
    const current = now.getHours() * 60 + now.getMinutes();
    if (timing.start === null || timing.end === null) return 'upcoming';
    if (current > timing.end) return 'past';
    if (current >= timing.start) return 'current';
    return 'upcoming';
  }

  function formatDuration(totalMinutes) {
    const minutes = Math.max(0, Math.round(totalMinutes));
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  const api = { addDays, coursePhase, courseTiming, dateOnly, formatDuration, sameDay, timeMinutes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalObject.WidgetLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
