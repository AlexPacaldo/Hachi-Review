export function toStudyDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// A day the learner reported, as "YYYY-MM-DD" in their own calendar. Exported so
// callers can reject a malformed value before storing it.
export function normalizeDayKey(value) {
  const day = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function normalizeRecentDays(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeDayKey).filter(Boolean))].sort();
}

// The record is counters rather than a day per row, so it needs to start
// somewhere sensible for a learner who has never recorded anything.
export function emptyStudyStreak() {
  return { currentStreak: 0, longestStreak: 0, totalDays: 0, lastStudyDay: null, recentDays: [] };
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function normalizeStudyStreak(value) {
  const raw = value || {};
  return {
    currentStreak: toCount(raw.currentStreak),
    longestStreak: toCount(raw.longestStreak),
    totalDays: toCount(raw.totalDays),
    lastStudyDay: normalizeDayKey(raw.lastStudyDay),
    recentDays: normalizeRecentDays(raw.recentDays)
  };
}

const RECENT_DAY_WINDOW = 14;

function trimRecentDays(days, latestDay) {
  const bound = latestDay ? new Date(`${latestDay}T12:00:00`) : new Date();
  bound.setDate(bound.getDate() - RECENT_DAY_WINDOW);
  const floor = toStudyDayKey(bound);
  return days.filter((day) => !floor || day > floor);
}

// Applied when a day is recorded locally, mirroring mark_study_day in the schema
// so the interface is correct before the upload has happened. Only ever moves a
// counter forwards, which is what makes it safe to merge two devices afterwards.
export function applyStudyDay(streak, dayInput) {
  const streakState = normalizeStudyStreak(streak);
  const day = normalizeDayKey(dayInput);
  if (!day) return streakState;

  const { lastStudyDay } = streakState;

  // Already counted. Every answer reports the same day, so this is the common path.
  if (lastStudyDay === day) return streakState;

  // An older day arriving late, or a device whose clock is behind. It cannot
  // extend the run but it still belongs in the week strip.
  if (lastStudyDay && day < lastStudyDay) {
    const recentDays = trimRecentDays(normalizeRecentDays([...streakState.recentDays, day]), lastStudyDay);
    return { ...streakState, recentDays };
  }

  // The run only continues when this day is the one straight after the last one.
  const currentStreak = lastStudyDay === addDays(day, -1) ? streakState.currentStreak + 1 : 1;
  const nextLastStudyDay = lastStudyDay && lastStudyDay > day ? lastStudyDay : day;
  const recentDays = trimRecentDays(normalizeRecentDays([...streakState.recentDays, day]), nextLastStudyDay);

  return {
    currentStreak,
    longestStreak: Math.max(streakState.longestStreak, currentStreak),
    totalDays: streakState.totalDays + 1,
    lastStudyDay: nextLastStudyDay,
    recentDays
  };
}

function addDays(dayKey, amount) {
  const date = new Date(`${dayKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return toStudyDayKey(date);
}

// Two devices can each hold a partially advanced record. Taking the later day,
// the highest counters and the union of the recent window is enough to land on
// the same answer as the server would, without either side being able to lower a
// number the other has already seen.
export function mergeStudyStreaks(localValue, cloudValue) {
  const local = normalizeStudyStreak(localValue);
  const cloud = normalizeStudyStreak(cloudValue);
  if (!cloud.currentStreak && !cloud.lastStudyDay && !cloud.recentDays.length) return local;
  if (!local.currentStreak && !local.lastStudyDay && !local.recentDays.length) return cloud;

  const lastStudyDay = [local.lastStudyDay, cloud.lastStudyDay].filter(Boolean).sort().pop() || null;
  const recentDays = trimRecentDays(
    normalizeRecentDays([...local.recentDays, ...cloud.recentDays]),
    lastStudyDay
  );

  // The run length that belongs to the later day. A record for an earlier day can
  // still be the longer run, so it is only used when it reaches past the other.
  const currentStreak = lastStudyDay === cloud.lastStudyDay
    ? Math.max(local.currentStreak, cloud.currentStreak)
    : cloud.lastStudyDay === lastStudyDay
      ? cloud.currentStreak
      : local.currentStreak;

  return {
    currentStreak,
    longestStreak: Math.max(local.longestStreak, cloud.longestStreak, currentStreak),
    totalDays: Math.max(local.totalDays, cloud.totalDays),
    lastStudyDay,
    recentDays
  };
}

const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MS_PER_DAY = 86400000;

// Built at local midday so a day is never shortened by a daylight saving shift and
// two adjacent keys never land on the same instant.
function fromStudyDayKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dayGap(fromKey, toKey) {
  return Math.round((fromStudyDayKey(toKey) - fromStudyDayKey(fromKey)) / MS_PER_DAY);
}

export function getStudySnapshot(streakValue, todayInput) {
  const streak = normalizeStudyStreak(streakValue);
  const today = todayInput ? new Date(todayInput) : new Date();
  const todayKey = toStudyDayKey(today);
  const yesterdayKey = addDays(todayKey, -1);

  // The counters already hold the answer: a run only counts while it still reaches
  // today or yesterday. Keeping it alive until the day is over is the usual
  // behaviour and stops the number dropping at midnight before the day has begun.
  const runIsLive = streak.lastStudyDay === todayKey || streak.lastStudyDay === yesterdayKey;
  const currentStreak = runIsLive ? streak.currentStreak : 0;

  // Days ahead of the learner are ignored, so a device with a wrong clock cannot
  // inflate anything, and only the bounded window is considered.
  const studied = new Set(streak.recentDays.filter((day) => day <= todayKey));

  let longestStreak = 0;
  let run = 0;
  let previousKey = null;
  studied.forEach((day) => {
    run = previousKey && dayGap(previousKey, day) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    previousKey = day;
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
      isFuture: key > todayKey
    };
  });

  const longest = Math.max(longestStreak, streak.longestStreak, currentStreak);
  const totalDays = Math.max(streak.totalDays, studied.size);
  const studiedThisWeek = week.filter((day) => day.studied).length;

  return {
    currentStreak,
    longestStreak: longest,
    totalDays,
    week,
    studiedThisWeek,
    note: getStreakNote({ currentStreak, longestStreak: longest, studiedThisWeek, totalDays })
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
