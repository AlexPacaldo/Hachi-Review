// The streak is worked out from a list of "YYYY-MM-DD" day keys rather than from
// attempt timestamps. Two reasons: a learner cares about their own calendar day,
// not a UTC instant, so a session finished late at night should not slide into
// the next day because a device sat in another timezone; and the record survives
// the 14 day attempt pruning, which is what makes the longest run reportable.
const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MS_PER_DAY = 86400000;

export function toStudyDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function normalizeStudyDays(value) {
  const list = Array.isArray(value) ? value : [];
  const keys = new Set();
  list.forEach((entry) => {
    const day = typeof entry === "string" ? entry : entry?.day;
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) keys.add(day);
  });
  return [...keys].sort();
}

// Built at local midday so a day is never shortened by a daylight saving shift
// and two adjacent keys never land on the same instant.
function fromStudyDayKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dayGap(fromKey, toKey) {
  return Math.round((fromStudyDayKey(toKey) - fromStudyDayKey(fromKey)) / MS_PER_DAY);
}

export function getStudySnapshot(studyDays, todayInput) {
  const today = todayInput ? new Date(todayInput) : new Date();
  const todayKey = toStudyDayKey(today);
  // Days ahead of the learner are dropped rather than counted. Nothing writes one
  // on purpose, but a device with a wrong clock can, and a future day would
  // otherwise sit in the record inflating the total and never joining the streak.
  const keys = normalizeStudyDays(studyDays).filter((key) => key <= todayKey);
  const studied = new Set(keys);

  // A streak is only alive if it reaches today or yesterday. Studying yesterday
  // keeps it alive until the day is over, which is the usual behaviour and stops
  // the number dropping to zero at midnight before the day is even finished.
  let currentStreak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!studied.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  while (studied.has(toStudyDayKey(cursor))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // The longest run in the whole record. Reported because a broken streak showing
  // only zero hides the fact that there was a run at all.
  let longestStreak = 0;
  let run = 0;
  let previousKey = null;
  keys.forEach((key) => {
    run = previousKey && dayGap(previousKey, key) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    previousKey = key;
  });

  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
  const week = WEEK_LABELS.map((label, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const key = toStudyDayKey(date);
    return {
      label,
      key,
      studied: studied.has(key),
      isToday: key === todayKey,
      // Marked so a future day reads as "not yet" rather than as a miss.
      isFuture: key > todayKey
    };
  });

  const studiedThisWeek = week.filter((day) => day.studied).length;

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    totalDays: keys.length,
    week,
    studiedThisWeek,
    note: getStreakNote({ currentStreak, longestStreak, studiedThisWeek, totalDays: keys.length })
  };
}

// The old copy said "Start a streak today!" whenever the streak was zero, which
// read as never having studied at all even with two green days in the week.
function getStreakNote({ currentStreak, longestStreak, studiedThisWeek, totalDays }) {
  if (currentStreak >= 3) return "You're on a roll!";
  if (currentStreak > 0) return "Keep it going!";

  const best = `${longestStreak} ${longestStreak === 1 ? "day" : "days"}`;

  if (studiedThisWeek > 0) {
    return longestStreak > 0
      ? `Longest run so far: ${best}. Study today to start a new one.`
      : "Study today to start a new streak.";
  }

  if (totalDays > 0) {
    return longestStreak > 0
      ? `Best run: ${best}. Study today to pick it back up.`
      : "Study today to pick it back up.";
  }

  return "Start a streak today!";
}
