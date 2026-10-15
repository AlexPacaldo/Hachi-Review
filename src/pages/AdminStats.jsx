import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, RefreshCw, Users } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { formatDelta, formatPercent, getAdminTrafficStats, getAdminUserStats } from "../services/adminStats.js";
import { routeName } from "../utils/analyticsRoutes.js";
import { logClientError } from "../utils/errorLogger.js";

// The statistics themselves are gated in the database, not here: both functions
// this page calls return null to anyone who is not the owner. Checking the flag
// in the client as well is only so a signed-in non-owner gets a plain screen
// instead of an empty one that looks broken.
function isAdminUser(user) {
  return user?.app_metadata?.admin === true;
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <strong className="stat-tile-value">{value}</strong>
      {hint ? <span className="stat-tile-hint">{hint}</span> : null}
    </div>
  );
}

// Traffic is counted by the app itself, into this same database, one route name
// and one random per-tab key per view. Nothing identifies the person behind a
// number here: there is no account on a page view, so nothing on this section can
// be joined back to anybody even by the owner.
//
// The route is stored as a name rather than as the URL, so these figures can say
// which pages people use without the table ever holding a reviewer id, a group
// id or an invite code. That is the reason there is no "top reviewers" list
// anywhere, and the reason there never should be one.
//
// presence_pings is a different thing and is not folded in: it is how many
// landing page tabs are open right now, it cannot be trended because its rows
// delete themselves after ten minutes, and it counts tabs rather than people. It
// stays on the Audience section under its own name.
function TrafficNotice({ status, error }) {
  // A refusal and a missing function need different sentences. "Run the
  // migration" sent to an account whose flag is missing is the wrong
  // instruction, and this page is the one place that can tell them apart.
  if (status === "forbidden") {
    return (
      <div className="admin-visits">
        <div className="admin-visits-icon" aria-hidden="true">
          <BarChart3 size={20} />
        </div>
        <div className="admin-visits-copy">
          <strong>The database would not hand over the traffic counts</strong>
          <p className="muted">
            The function exists and refused the read, so supabase-migration-2026-10-page-views.sql is in place and
            this account is missing <code>app_metadata.admin = true</code>. Every other section on this page comes
            from a different function, which is why they are still readable.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-visits">
      <div className="admin-visits-icon" aria-hidden="true">
        <BarChart3 size={20} />
      </div>
      <div className="admin-visits-copy">
        <strong>Page views are not being recorded yet</strong>
        <p className="muted">
          {error ? `${error}. ` : null}
          Run supabase-migration-2026-10-page-views.sql in the Supabase SQL editor to switch this on. Until it has
          run, the app sends the count and the database throws it away, so this page has nothing to show. Views start
          from zero on the day it is applied; there is no backfill.
        </p>
      </div>
    </div>
  );
}

// One bar per day, scaled to the tallest. A quiet week still reads as a shape
// rather than as a flat line along the bottom.
function BarSeries({ series, valueKey, label }) {
  if (!series.length) return null;

  const peak = Math.max(...series.map((point) => point[valueKey]), 1);

  return (
    <div className="admin-chart">
      <div className="admin-chart-bars" role="img" aria-label={label}>
        {series.map((point) => {
          const value = Number(point[valueKey]) || 0;
          const height = Math.max(Math.round((value / peak) * 100), value > 0 ? 8 : 2);
          return (
            <div className="admin-chart-col" key={point.day}>
              <div
                className={`admin-chart-bar ${value > 0 ? "has-value" : ""}`}
                style={{ height: `${height}%` }}
                title={`${point.day}: ${value}`}
              />
            </div>
          );
        })}
      </div>
      <div className="admin-chart-axis">
        <span>{series[0]?.day}</span>
        <span>peak {peak} a day</span>
        <span>{series[series.length - 1]?.day}</span>
      </div>
    </div>
  );
}

// The routes people actually use. Ordered by views rather than alphabetical,
// because the question being asked is which parts of the app get opened.
function RouteList({ routes }) {
  if (!routes.length) {
    return <p className="muted admin-route-empty">No page views recorded in this period yet.</p>;
  }

  const peak = Math.max(...routes.map((route) => route.views), 1);

  return (
    <ul className="admin-route-list">
      {routes.map((route) => (
        <li className="admin-route-row" key={route.path}>
          <span className="admin-route-name">{routeName(route.path)}</span>
          <span className="admin-route-bar" aria-hidden="true">
            <span className="admin-route-fill" style={{ width: `${Math.round((route.views / peak) * 100)}%` }} />
          </span>
          <span className="admin-route-count">{route.views}</span>
        </li>
      ))}
    </ul>
  );
}

// Compared with a window of the same length. A rise from nothing is not a
// percentage, because the denominator is zero, so it is said in words rather than
// rendered as an infinity.
function trendHint(current, previous, comparison) {
  const on = comparison ? ` on ${comparison}` : "";

  if (!previous) return current > 0 ? `Up from nothing${on}` : null;

  const delta = formatDelta(current, previous);
  if (delta === null) return null;
  if (delta === 0) return `Level with ${comparison || "the previous period"}`;
  if (delta > 0) return `Up ${delta}%${on}`;
  return `Down ${Math.abs(delta)}%${on}`;
}

export default function AdminStats() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ status: "loading", stats: null, series: [], error: null });
  // Traffic is loaded and stored apart from the account totals, because it is
  // allowed to fail on its own without taking the rest of the page with it.
  const [traffic, setTraffic] = useState({ status: "loading", data: null, error: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: null }));

    try {
      const result = await getAdminUserStats();

      if (result.status === "forbidden") {
        setState({ status: "forbidden", stats: null, series: [], error: null });
        return;
      }

      if (result.status === "error") {
        setState({ status: "error", stats: null, series: [], error: result.error });
        return;
      }

      setState({ status: "ready", stats: result.stats, series: result.series, error: null });
    } catch (error) {
      logClientError("admin-stats", error);
      setState({ status: "error", stats: null, series: [], error });
    }
  }, []);

  // Deliberately not awaited into load(). A database without the page view
  // migration, a signed-in account without the admin flag and a slow network are
  // three different problems, and only the first two belong to this page.
  const loadTraffic = useCallback(async () => {
    setTraffic({ status: "loading", data: null, error: null });

    try {
      const result = await getAdminTrafficStats(30);

      if (result.status === "ready") {
        setTraffic({ status: "ready", data: result.traffic, error: null });
        return;
      }

      setTraffic({
        status: result.status,
        data: null,
        error: result.status === "error" ? result.error : null
      });
    } catch (error) {
      logClientError("admin-traffic", error);
      setTraffic({ status: "error", data: null, error: error?.message || "Could not read traffic." });
    }
  }, []);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) {
      setState({ status: "signed-out", stats: null, series: [], error: null });
      return undefined;
    }
    load();
    loadTraffic();
    return undefined;
  }, [authLoading, user, load, loadTraffic]);

  if (authLoading || state.status === "loading") {
    return (
      <div className="page">
        <p className="muted">Loading statistics...</p>
      </div>
    );
  }

  if (state.status === "signed-out") {
    return (
      <div className="page">
        <div className="account-card">
          <p className="eyebrow">Statistics</p>
          <h1>Sign in to continue</h1>
          <p className="muted">This page is only available to the account that runs Hachi.</p>
          <div className="button-row">
            <Link className="button" to="/account">Go to account</Link>
            <Link className="button subtle" to="/home">Back to Hachi</Link>
          </div>
        </div>
      </div>
    );
  }

  // The database has already refused the numbers, so nothing sensitive is on
  // screen here. This branch just avoids showing a broken-looking page.
  if (state.status === "forbidden" || (state.status === "ready" && !isAdminUser(user))) {
    return (
      <div className="page">
        <div className="account-card">
          <p className="eyebrow">Statistics</p>
          <h1>Not available</h1>
          <p className="muted">
            These statistics are only available to the account that runs Hachi.
          </p>
          <div className="button-row">
            <Link className="button subtle" to="/home">Back to Hachi</Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    // The message from the database is shown rather than a guess, because the
    // cause is not always the same one. A missing function and a signed-in
    // account without the admin flag need completely different fixes, and an
    // earlier version of this page assumed the first and sent the owner looking
    // in the wrong place.
    const detail = state.error?.message || state.error;

    return (
      <div className="page">
        <div className="account-card">
          <p className="eyebrow">Statistics</p>
          <h1>Could not load statistics</h1>
          {detail ? <p className="account-inline-notice">{detail}</p> : null}
          <p className="muted">
            The two usual causes are that supabase-migration-2026-10-admin-stats.sql has not been applied yet, or that
            this account is missing <code>app_metadata.admin = true</code>. A function that is missing is reported as
            &ldquo;could not find the function&rdquo;; a function that exists but refuses the read is reported as
            &ldquo;permission denied&rdquo;, which means the migration is in place and the account needs the flag.
            Traffic has its own migration,
            supabase-migration-2026-10-page-views.sql, and is never the cause of this page failing: it fails on its
            own and leaves the Visits section explaining itself.
          </p>
          <div className="button-row">
            <button className="button" type="button" onClick={load}>
              <RefreshCw size={15} />
              Try again
            </button>
            <Link className="button subtle" to="/home">Back to Hachi</Link>
          </div>
        </div>
      </div>
    );
  }

  const { stats } = state;
  const activeRate = formatPercent(stats.activeUsers30d, stats.totalUsers);
  const signupRate = formatPercent(stats.confirmedUsers, stats.totalUsers);

  return (
    <div className="page">
      <header className="admin-head">
        <div>
          <p className="eyebrow">Statistics</p>
          <h1>How the site is doing</h1>
          <p className="muted">
            Who is here, what they open, and whether they are still arriving. Counts only: no email address, display
            name, IP address, or per-account record is ever sent to this page. Visits are counted by the app itself
            and read from the same database as everything else on it.
          </p>
        </div>
        <button className="button subtle" type="button" onClick={() => { load(); loadTraffic(); }}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>

      <section className="admin-section">
        <h2 className="section-heading">Visits</h2>
        {traffic.status === "loading" ? (
          <p className="muted admin-section-note">Loading traffic...</p>
        ) : traffic.status !== "ready" || !traffic.data ? (
          <TrafficNotice status={traffic.status} error={traffic.error} />
        ) : (
          <>
            <p className="muted admin-section-note">
              Counted by this app. One page view is one tab looking at one page, counted once every thirty minutes, so
              a reload is not a visit. A visitor is a random per-tab value held for that tab only: there is no account,
              no IP address and no device on a page view, which is why these are counts and nothing that could be
              traced to a person.
            </p>
            <div className="admin-tile-grid">
              <MetricCard
                label="Views today"
                value={traffic.data.viewsToday}
                hint={trendHint(traffic.data.viewsToday, traffic.data.viewsYesterday, "yesterday")}
              />
              <MetricCard
                label="Visitors today"
                value={traffic.data.visitorsToday}
                hint={trendHint(traffic.data.visitorsToday, traffic.data.visitorsYesterday, "yesterday")}
              />
              <MetricCard
                label={`Views in the last ${traffic.data.days} days`}
                value={traffic.data.viewsPeriod}
                hint={trendHint(traffic.data.viewsPeriod, traffic.data.viewsPrevious, `the previous ${traffic.data.days} days`)}
              />
              <MetricCard
                label={`Visitors in the last ${traffic.data.days} days`}
                value={traffic.data.visitorsPeriod}
                hint={trendHint(traffic.data.visitorsPeriod, traffic.data.visitorsPrevious, `the previous ${traffic.data.days} days`)}
              />
            </div>
          </>
        )}
      </section>

      {traffic.status === "ready" && traffic.data ? (
        <>
          <section className="admin-section">
            <h2 className="section-heading">Views over the last {traffic.data.days} days</h2>
            <BarSeries
              series={traffic.data.series}
              valueKey="views"
              label={`Page views per day over the last ${traffic.data.days} days`}
            />
          </section>

          <section className="admin-section">
            <h2 className="section-heading">What people open</h2>
            <RouteList routes={traffic.data.topRoutes} />
            <p className="muted admin-route-note">
              Page names rather than addresses. A reviewer, a group or a guide is counted as its own page, so the
              figure says which parts of Hachi get used and never records whose.
            </p>
          </section>
        </>
      ) : null}

      <section className="admin-section">
        <h2 className="section-heading">Audience</h2>
        <div className="admin-tile-grid">
          <MetricCard label="Total accounts" value={stats.totalUsers} hint="Everyone who has ever signed in" />
          <MetricCard
            label="On the landing page now"
            value={stats.onlineNow}
            hint="Live tabs, not visits. Counted on the public page only"
          />
          <MetricCard label="New this week" value={stats.newUsers7d} />
          <MetricCard label="New this month" value={stats.newUsers30d} />
          <MetricCard
            label="Confirmed email"
            value={stats.confirmedUsers}
            hint={signupRate === null ? null : `${signupRate}% of all accounts`}
          />
          <MetricCard
            label="Studied this week"
            value={stats.activeUsers7d}
            hint={`${formatPercent(stats.activeUsers7d, stats.totalUsers) ?? 0}% of all accounts`}
          />
          <MetricCard
            label="Studied this month"
            value={stats.activeUsers30d}
            hint={activeRate === null ? null : `${activeRate}% of all accounts`}
          />
          <MetricCard
            label="Avg attempts per account"
            value={stats.avgAttemptsPerUser}
            hint="How deeply returning people use it"
          />
        </div>
      </section>

      <section className="admin-section">
        <h2 className="section-heading">Signups over the last 30 days</h2>
        <BarSeries
          series={state.series}
          valueKey="signups"
          label={`Signups per day over the last ${state.series.length} days`}
        />
      </section>

      <footer className="admin-foot">
        <Link className="back-link" to="/home">
          <BarChart3 size={15} />
          Back to Hachi
        </Link>
        <span className="muted">
          <Users size={15} />
          Visible only to the owner account
        </span>
      </footer>
    </div>
  );
}
