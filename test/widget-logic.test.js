'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, coursePhase, courseTiming, formatDuration } = require('../src/renderer/widget-logic');

const periods = [['08:00', '08:50'], ['08:55', '09:45']];
const course = { startSession: 1, endSession: 2 };

test('desktop widget classifies past, current and upcoming courses', () => {
  const date = new Date(2026, 6, 17);
  assert.equal(coursePhase(course, new Date(2026, 6, 17, 7, 30), date, periods), 'upcoming');
  assert.equal(coursePhase(course, new Date(2026, 6, 17, 9, 0), date, periods), 'current');
  assert.equal(coursePhase(course, new Date(2026, 6, 17, 10, 0), date, periods), 'past');
  assert.deepEqual(courseTiming(course, periods), { start: 480, end: 585 });
});

test('desktop widget date navigation and countdown formatting are stable', () => {
  const start = new Date(2026, 6, 17, 23, 50);
  assert.equal(addDays(start, 1).getDate(), 18);
  assert.equal(formatDuration(45), '45 分钟');
  assert.equal(formatDuration(125), '2 小时 5 分');
});
