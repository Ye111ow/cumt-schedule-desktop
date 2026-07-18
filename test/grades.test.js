'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUALITATIVE_SCORES,
  calculateGradeSummary,
  mergeGradeDetails,
  normalizeGradeDetailItems,
  normalizeGrades,
  parseGradeDetailMatrix,
  qualitativeScore
} = require('../src/grades');

test('five-level grades use the requested 92/82 descending conversion', () => {
  assert.deepEqual(QUALITATIVE_SCORES, {
    '优秀': 92, '优': 92,
    '良好': 82, '良': 82,
    '中等': 72, '中': 72,
    '及格': 62, '合格': 62, '通过': 62,
    '不及格': 52, '不合格': 52, '未通过': 52
  });
  assert.equal(qualitativeScore('优秀'), 92);
  assert.equal(qualitativeScore('不及格'), 52);
  assert.equal(qualitativeScore('缓考'), null);
});

test('normalizes Zhengfang grade fields and component scores', () => {
  const grades = normalizeGrades({ items: [{
    xh: '012345', xm: '矿大同学', kcmc: '高级学术英语', jxb_id: 'A01',
    xnmmc: '2025-2026', xqmmc: '第二学期', xf: '2.0', cj: '优秀', jd: '4.5',
    pscj: '90', qmcj: '93', ksxz: '正常考试', kcxzmc: '必修'
  }] });
  assert.equal(grades.student.name, '矿大同学');
  assert.equal(grades.courses[0].numericScore, 92);
  assert.equal(grades.courses[0].qualitativeConverted, true);
  assert.equal(grades.courses[0].usualScore, '90');
  assert.equal(grades.courses[0].examScore, '93');
  assert.equal(grades.courses[0].academicYear, 2025);
  assert.equal(grades.courses[0].term, 2);
});

test('calculates credit-weighted score and grade point independently', () => {
  const summary = calculateGradeSummary([
    { credit: 2, numericScore: 92, gradePoint: 4.5 },
    { credit: 1, numericScore: 62, gradePoint: 1.5 },
    { credit: 1, numericScore: null, gradePoint: null }
  ]);
  assert.equal(summary.weightedScore, 82);
  assert.equal(summary.weightedGradePoint, 3.5);
  assert.equal(summary.totalCredits, 4);
  assert.equal(summary.scoreCourseCount, 2);
});

test('parses dynamic grade-detail columns and merges every returned component', () => {
  const rows = parseGradeDetailMatrix([
    ['学生成绩分项'],
    ['学年', '学期', '教学班ID', '学分', '课程名称', '成绩', '成绩分项'],
    ['2025-2026', '第二学期', 'CLASS-01', '3', '数据库原理', '93', '平时成绩（30%）'],
    ['2025-2026', '第二学期', 'CLASS-01', '3', '数据库原理', '88', '期中测试（20%）'],
    ['2025-2026', '第二学期', 'CLASS-01', '3', '数据库原理', '96', '期末卷面（50%）']
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].label, '期中测试（20%）');

  const grades = normalizeGrades({ items: [{
    kcmc: '数据库原理', jxb_id: 'CLASS-01', xnmmc: '2025-2026', xqmmc: '第二学期', cj: '92'
  }] });
  const merged = mergeGradeDetails(grades, rows);
  assert.deepEqual(merged.courses[0].scoreDetails, [
    { label: '平时成绩（30%）', score: '93' },
    { label: '期中测试（20%）', score: '88' },
    { label: '期末卷面（50%）', score: '96' }
  ]);
  assert.equal(merged.courses[0].usualScore, '93');
  assert.equal(merged.courses[0].midtermScore, '88');
  assert.equal(merged.courses[0].examScore, '96');
  assert.equal(merged.detailStatus.courseCount, 1);
});

test('normalizes JSON component rows and tolerates course-name typography differences', () => {
  const rows = normalizeGradeDetailItems([{
    xnmc: '2025-2026', xqmc: '12', jxb_id: 'A'.repeat(32), xf: '3',
    kcmc: '程序设计综合实践 (CSP)', xmblmc: '期末卷面（70%）', xmcj: '89'
  }]);
  const grades = normalizeGrades({ items: [{
    xnmmc: '2025-2026', xqmmc: '第二学期', jxb_id: `${'A'.repeat(32)}-08242694`, xf: '3.0',
    kcmc: '程序设计综合实践（CSP）', cj: '89'
  }] });
  const merged = mergeGradeDetails(grades, rows);
  assert.deepEqual(merged.courses[0].scoreDetails, [{ label: '期末卷面（70%）', score: '89' }]);
  assert.equal(merged.courses[0].examScore, '89');
  assert.equal(merged.detailStatus.missingCourseCount, 0);
});
