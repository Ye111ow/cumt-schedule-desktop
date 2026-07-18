'use strict';

const QUALITATIVE_SCORES = Object.freeze({
  '优秀': 92,
  '优': 92,
  '良好': 82,
  '良': 82,
  '中等': 72,
  '中': 72,
  '及格': 62,
  '合格': 62,
  '通过': 62,
  '不及格': 52,
  '不合格': 52,
  '未通过': 52
});

function firstValue(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function numericValue(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim().replace(/分$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function qualitativeScore(value) {
  const text = String(value ?? '').trim().replace(/（.*?）|\(.*?\)/g, '');
  return Object.prototype.hasOwnProperty.call(QUALITATIVE_SCORES, text)
    ? QUALITATIVE_SCORES[text]
    : null;
}

function scoreValue(primary, percentage) {
  const percentageNumber = numericValue(percentage);
  if (percentageNumber !== null) return { value: percentageNumber, converted: false };
  const primaryNumber = numericValue(primary);
  if (primaryNumber !== null) return { value: primaryNumber, converted: false };
  const converted = qualitativeScore(primary) ?? qualitativeScore(percentage);
  return { value: converted, converted: converted !== null };
}

function normalizeTerm(value) {
  const text = String(value ?? '').trim();
  if (['1', '3', '第一学期', '1学期', '一'].includes(text)) return 1;
  if (['2', '12', '第二学期', '2学期', '二'].includes(text)) return 2;
  const match = text.match(/第?([一二12])学期/);
  if (match) return ['一', '1'].includes(match[1]) ? 1 : 2;
  return 0;
}

function normalizeAcademicYear(value, fallback = 0) {
  const text = String(value ?? '').trim();
  const match = text.match(/(20\d{2})/);
  if (match) return Number(match[1]);
  const number = Number(text);
  return Number.isInteger(number) && number > 1900 ? number : Number(fallback) || 0;
}

function cleanDetailCell(value) {
  return String(value ?? '')
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalCourseText(value) {
  return cleanDetailCell(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•・()（）\[\]【】《》<>_—–-]+/g, '');
}

function findDetailColumn(headers, patterns, excluded = new Set()) {
  return headers.findIndex((header, index) => !excluded.has(index) && patterns.some((pattern) => pattern.test(header)));
}

function parseGradeDetailMatrix(matrix = []) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const headerIndex = rows.findIndex((row) => {
    const cells = Array.isArray(row) ? row.map(cleanDetailCell) : [];
    return cells.some((cell) => /成绩分项|分项名称|考核项目/.test(cell))
      && cells.some((cell) => /课程名称|课程名/.test(cell));
  });
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map(cleanDetailCell);
  const used = new Set();
  const take = (patterns) => {
    const index = findDetailColumn(headers, patterns, used);
    if (index >= 0) used.add(index);
    return index;
  };
  const columns = {
    academicYear: take([/^学年$/, /学年名称/, /^xnmmc$/i]),
    term: take([/^学期$/, /学期名称/, /^xqmmc$/i]),
    classId: take([/教学班.*id/i, /^jxb_id$/i, /^教学班$/]),
    credit: take([/^学分$/, /^xf$/i]),
    title: take([/课程名称/, /^课程名$/, /^kcmc$/i]),
    score: take([/^成绩$/, /分项成绩/, /^xmcj$/i]),
    label: take([/成绩分项/, /分项名称/, /考核项目/, /^xmblmc$/i])
  };

  if (columns.title < 0 || columns.label < 0 || columns.score < 0) return [];
  return rows.slice(headerIndex + 1).map((row) => {
    const cells = Array.isArray(row) ? row.map(cleanDetailCell) : [];
    return {
      academicYear: columns.academicYear >= 0 ? cleanDetailCell(cells[columns.academicYear]) : '',
      term: columns.term >= 0 ? cleanDetailCell(cells[columns.term]) : '',
      classId: columns.classId >= 0 ? cleanDetailCell(cells[columns.classId]) : '',
      credit: columns.credit >= 0 ? cleanDetailCell(cells[columns.credit]) : '',
      title: cleanDetailCell(cells[columns.title]),
      label: cleanDetailCell(cells[columns.label]),
      score: cleanDetailCell(cells[columns.score])
    };
  }).filter((row) => row.title && row.label && row.score !== '');
}

function normalizeGradeDetailItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    academicYear: cleanDetailCell(firstValue(item, ['xnmmc', 'xnmc', 'xnm', 'course_year'])),
    term: cleanDetailCell(firstValue(item, ['xqmmc', 'xqmc', 'xqm', 'course_semester'])),
    classId: cleanDetailCell(firstValue(item, ['jxb_id', 'jxbid', 'class_id'])),
    credit: cleanDetailCell(firstValue(item, ['xf', 'credit'])),
    title: cleanDetailCell(firstValue(item, ['kcmc', 'course_name', 'title'])),
    label: cleanDetailCell(firstValue(item, ['xmblmc', 'xmmc', 'component_name', 'label'])),
    score: cleanDetailCell(firstValue(item, ['xmcj', 'component_score', 'score']))
  })).filter((row) => row.title && row.label && row.score !== '');
}

function classIdAliases(value) {
  const normalized = cleanDetailCell(value).normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
  if (!normalized) return new Set();
  const aliases = new Set([normalized]);
  const suffixMatch = normalized.match(/^([a-z0-9]{16,})-([a-z0-9_.]+)$/i);
  if (suffixMatch) aliases.add(suffixMatch[1]);
  return aliases;
}

function idsOverlap(left, right) {
  const leftAliases = classIdAliases(left);
  const rightAliases = classIdAliases(right);
  return [...leftAliases].some((alias) => rightAliases.has(alias));
}

function sameCredit(left, right) {
  const leftCredit = numericValue(left);
  const rightCredit = numericValue(right);
  return leftCredit === null || rightCredit === null || Math.abs(leftCredit - rightCredit) < 0.001;
}

function detailsForCourse(course, rows) {
  const exactClassId = cleanDetailCell(course.classId);
  let matches = exactClassId ? rows.filter((row) => cleanDetailCell(row.classId) === exactClassId) : [];
  if (!matches.length && exactClassId) {
    matches = rows.filter((row) => idsOverlap(row.classId, exactClassId));
  }
  if (!matches.length) {
    matches = rows.filter((row) => {
      if (canonicalCourseText(row.title) !== canonicalCourseText(course.title)) return false;
      const rowYear = normalizeAcademicYear(row.academicYear);
      const rowTerm = normalizeTerm(row.term);
      return (!rowYear || !course.academicYear || rowYear === course.academicYear)
        && (!rowTerm || !course.term || rowTerm === course.term)
        && sameCredit(row.credit, course.credit);
    });
  }
  const seen = new Set();
  return matches.map((row) => ({ label: row.label, score: row.score })).filter((detail) => {
    const key = `${detail.label}\u0000${detail.score}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreFromDetails(details, patterns) {
  return details.find((detail) => patterns.some((pattern) => pattern.test(detail.label)))?.score ?? null;
}

function mergeGradeDetails(grades, detailRows = []) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  let matchedCourseCount = 0;
  const courses = (grades?.courses || []).map((course) => {
    const scoreDetails = detailsForCourse(course, rows);
    if (scoreDetails.length) matchedCourseCount += 1;
    return {
      ...course,
      scoreDetails,
      usualScore: course.usualScore ?? scoreFromDetails(scoreDetails, [/平时/, /过程/, /日常/]),
      examScore: course.examScore ?? scoreFromDetails(scoreDetails, [/卷面/, /期末/, /考试成绩/]),
      midtermScore: course.midtermScore ?? scoreFromDetails(scoreDetails, [/期中/]),
      experimentScore: course.experimentScore ?? scoreFromDetails(scoreDetails, [/实验/, /实践/])
    };
  });
  return {
    ...grades,
    courses,
    detailStatus: {
      available: rows.length > 0,
      rowCount: rows.length,
      courseCount: matchedCourseCount,
      missingCourseCount: Math.max(0, courses.length - matchedCourseCount),
      totalCourseCount: courses.length
    }
  };
}

function normalizeGradeItem(item, index, academicYear = 0, term = 0) {
  const rawGrade = firstValue(item, ['cj', 'zcj', 'zpcj', 'grade']);
  const percentageGrade = firstValue(item, ['bfzcj', 'bfb_cj', 'percentageGrade']);
  const normalizedScore = scoreValue(rawGrade, percentageGrade);
  const year = normalizeAcademicYear(
    firstValue(item, ['xnmmc', 'xnmc', 'xnm', 'course_year']),
    academicYear
  );
  const normalizedTerm = normalizeTerm(
    firstValue(item, ['xqmmc', 'xqmc', 'xqm', 'course_semester']) ?? term
  );
  const title = String(firstValue(item, ['kcmc', 'course_name', 'title']) || '未命名课程').trim();
  const classId = String(firstValue(item, ['jxb_id', 'jxbid', 'class_id', 'kch_id', 'kch']) || '').trim();

  return {
    id: classId || `${year}-${normalizedTerm}-${title}-${index}`,
    title,
    teacher: String(firstValue(item, ['jsxm', 'rkjs', 'teacher']) || '').trim(),
    className: String(firstValue(item, ['jxbmc', 'class_name']) || '').trim(),
    classId,
    courseId: String(firstValue(item, ['kch_id', 'kch', 'course_id']) || '').trim(),
    academicYear: year,
    term: normalizedTerm,
    credit: numericValue(firstValue(item, ['xf', 'credit'])),
    rawGrade: rawGrade === null ? '' : String(rawGrade).trim(),
    percentageGrade: percentageGrade === null ? '' : String(percentageGrade).trim(),
    numericScore: normalizedScore.value,
    qualitativeConverted: normalizedScore.converted,
    gradePoint: numericValue(firstValue(item, ['jd', 'grade_point'])),
    creditGradePoint: numericValue(firstValue(item, ['xfjd', 'credit_grade_point'])),
    examNature: String(firstValue(item, ['ksxz', 'ksxzmc', 'exam_nature']) || '').trim(),
    courseNature: String(firstValue(item, ['kcxzmc', 'kcxz', 'course_nature']) || '').trim(),
    courseCategory: String(firstValue(item, ['kclbmc', 'kclb', 'course_category']) || '').trim(),
    gradingMethod: String(firstValue(item, ['cjfsmc', 'khfsmc', 'cjlxmc', 'grading_method']) || '').trim(),
    usualScore: firstValue(item, ['pscj', 'pscjmc', 'pccj', 'xscj']),
    examScore: firstValue(item, ['qmcj', 'qmcjmc', 'jmcj', 'jmcjmc', 'kscj']),
    midtermScore: firstValue(item, ['qzcj', 'qzcjmc']),
    experimentScore: firstValue(item, ['sycj', 'sycjmc']),
    makeupScore: firstValue(item, ['bkcj', 'bkcjmc']),
    retakeScore: firstValue(item, ['cxcj', 'cxcjmc']),
    submittedAt: String(firstValue(item, ['tjsj', 'submission_time']) || '').trim()
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function calculateGradeSummary(courses = []) {
  const weightedScores = courses.filter((course) => Number(course.credit) > 0 && Number.isFinite(course.numericScore));
  const weightedPoints = courses.filter((course) => Number(course.credit) > 0 && Number.isFinite(course.gradePoint));
  const scoreCredits = weightedScores.reduce((sum, course) => sum + Number(course.credit), 0);
  const pointCredits = weightedPoints.reduce((sum, course) => sum + Number(course.credit), 0);
  const totalCredits = courses.reduce((sum, course) => sum + (Number(course.credit) || 0), 0);
  return {
    weightedScore: scoreCredits
      ? round(weightedScores.reduce((sum, course) => sum + course.credit * course.numericScore, 0) / scoreCredits)
      : null,
    weightedGradePoint: pointCredits
      ? round(weightedPoints.reduce((sum, course) => sum + course.credit * course.gradePoint, 0) / pointCredits)
      : null,
    totalCredits: round(totalCredits, 1) || 0,
    courseCount: courses.length,
    scoreCourseCount: weightedScores.length,
    gradePointCourseCount: weightedPoints.length
  };
}

function normalizeGrades(payload, academicYear = 0, term = 0) {
  const rawItems = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
  const courses = rawItems.map((item, index) => normalizeGradeItem(item, index, academicYear, term));
  const first = rawItems[0] || {};
  return {
    student: {
      id: String(firstValue(first, ['xh', 'xh_id', 'sid']) || '').trim(),
      name: String(firstValue(first, ['xm', 'name']) || '').trim()
    },
    query: { academicYear: Number(academicYear) || 0, term: Number(term) || 0 },
    courses,
    summary: calculateGradeSummary(courses),
    syncedAt: new Date().toISOString()
  };
}

module.exports = {
  QUALITATIVE_SCORES,
  calculateGradeSummary,
  mergeGradeDetails,
  normalizeGradeDetailItems,
  normalizeGradeItem,
  normalizeGrades,
  numericValue,
  parseGradeDetailMatrix,
  qualitativeScore
};
