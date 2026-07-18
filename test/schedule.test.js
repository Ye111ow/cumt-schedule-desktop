'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  academicPeriodForDate, calculateWeek, coursesForDay, normalizeSchedule, parseSessions,
  parseWeeks, resolveDisplayWeek, teachingWeeks
} = require('../src/schedule');

test('parses normal, odd and even week expressions', () => {
  assert.deepEqual(parseWeeks('1-8周,10周'), [1, 2, 3, 4, 5, 6, 7, 8, 10]);
  assert.deepEqual(parseWeeks('1-8周(单)'), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeks('2-10周(双)'), [2, 4, 6, 8, 10]);
  assert.deepEqual(parseWeeks('第3周、5-6周'), [3, 5, 6]);
});

test('parses session ranges without duplicates', () => {
  assert.deepEqual(parseSessions('1-2节'), [1, 2]);
  assert.deepEqual(parseSessions('3-4节,3-4节'), [3, 4]);
  assert.deepEqual(parseSessions('9~10'), [9, 10]);
});

test('normalizes a Zhengfang timetable payload', () => {
  const result = normalizeSchedule({
    xsxx: { XH: '012345', XM: '同学' },
    kbList: [{
      kch_id: 'A01', kcmc: '算法设计与分析', xm: '张老师', xqj: '3',
      jc: '3-4节', zcd: '1-16周(单)', xqmc: '南湖校区', cdmc: '博3-B102'
    }]
  }, 2025, 2);
  assert.equal(result.student.name, '同学');
  assert.equal(result.courses[0].weekday, 3);
  assert.equal(result.courses[0].startSession, 3);
  assert.equal(result.courses[0].endSession, 4);
  assert.ok(result.courses[0].weeks.includes(15));
  assert.ok(!result.courses[0].weeks.includes(16));
});

test('calculates academic period and current teaching week', () => {
  assert.deepEqual(academicPeriodForDate(new Date(2026, 8, 2)), { academicYear: 2026, term: 1 });
  assert.deepEqual(academicPeriodForDate(new Date(2026, 3, 2)), { academicYear: 2025, term: 2 });
  assert.equal(calculateWeek('2026-02-23', new Date(2026, 2, 9)), 3);
});

test('desktop display falls back to week one outside arranged teaching weeks', () => {
  const schedule = {
    courses: [
      { title: '周一课程', weekday: 1, startSession: 1, endSession: 2, weeks: [1, 2, 3] },
      { title: '周三课程', weekday: 3, startSession: 3, endSession: 4, weeks: [1, 2, 3] }
    ]
  };
  assert.deepEqual(teachingWeeks(schedule), [1, 2, 3]);
  assert.equal(resolveDisplayWeek(schedule, '2026-02-23', new Date(2026, 2, 2)), 2);
  assert.equal(resolveDisplayWeek(schedule, '2026-02-23', new Date(2026, 4, 18)), 1);
});

test('desktop display selects courses for today and the resolved week', () => {
  const schedule = {
    courses: [
      { title: '今日课程', weekday: 1, startSession: 3, endSession: 4, weeks: [1] },
      { title: '其他日期', weekday: 2, startSession: 1, endSession: 2, weeks: [1] },
      { title: '其他周', weekday: 1, startSession: 7, endSession: 8, weeks: [2] }
    ]
  };
  const monday = new Date(2026, 1, 23);
  assert.deepEqual(coursesForDay(schedule, 1, monday).map((course) => course.title), ['今日课程']);
});
