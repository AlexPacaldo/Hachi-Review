import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Activity, ExternalLink, RefreshCw, Users } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { formatPercent, getAdminUserStats } from "../services/adminStats.js";
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

// Visits and speed are not counted here, and this card says so plainly rather than
// letting their absence read as zero traffic.
//
// Nothing in the app records a page view, so there is nothing for these numbers to be
// computed from. The one traffic-shaped thing the database holds is presence_pings,
// which is a live count of landing page tabs inside a 150 second window whose rows
// delete themselves after ten minutes. It cannot be trended, and it overcounts anyone
// with two tabs open, so it is on the Accounts card as "On the landing page now" and
// deliberately not presented as visits.
//
// Vercel Web Analytics does the counting, from the script in index.html, and keeps the
// result on the Vercel dashboard rather than in this database. That is a deliberate
// trade: the data stays out of the project's database entirely, which is why nothing
// here about it is per-account or per-device.
function VisitsCard() {
  return (
    <div className="admin-visits">
      <div className="admin-visits-icon" aria-hidden="true">
        <Activity size={20} />
      </div>
      <div className="admin-visits-copy">
        <strong>Visits and speed live in the Vercel dashboard</strong>
        <p className="muted">
          Page views, unique visitors, the routes people actually use, and Core Web Vitals such as load time and
          layout shift are collected by Vercel Analytics and shown on the Vercel project dashboard. They are not
          stored in this app&rsquo;s database, so there is nothing per-account or per-device to read here, and this
          page deliberately does not estimate them.
        </p>
        <p className="muted">
          In the Vercel dashboard, open this project and choose the <strong>Analytics</strong> tab for traffic, or
          <strong> Speed Insights</strong> for performance.
        </p>
        <div className="button-row">
          <a className="button" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer noopener">
            <ExternalLink size={15} aria-hidden="true" />
            Open Vercel dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

function SignupChart({ series }) {
  if (!series.length) return null;

  // The tallest bar sets the scale, so a quiet week still reads as a shape
  // rather than a flat line along the bottom.
  const peak = Math.max(...series.map((point) => point.signups), 1);

  return (
    <div className="admin-chart">
      <div className="admin-chart-bars" role="img" aria-label={`Signups per day over the last ${series.length} days`}>
        {series.map((point) => {
          const height = Math.max(Math.round((point.signups / peak) * 100), point.signups > 0 ? 8 : 2);
          return (
            <div className="admin-chart-col" key={point.day}>
              <div
                className={`admin-chart-bar ${point.signups > 0 ? "has-signups" : ""}`}
                style={{ height: `${height}%` }}
                title={`${point.day}: ${point.signups}`}
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

export default function AdminStats() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ status: "loading", stats: null, series: [], error: null });

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

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) {
      setState({ status: "signed-out", stats: null, series: [], error: null });
      return undefined;
    }
    load();
    return undefined;
  }, [authLoading, user, load]);

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
            Who is here and whether they are still arriving. Counts only: no email address, display name, or
            per-account record is ever sent to this page. Visits and speed are measured by Vercel Analytics and live
            in the Vercel dashboard, not here.
          </p>
        </div>
        <button className="button subtle" type="button" onClick={load}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>

      <section className="admin-section">
        <h2 className="section-heading">Visits</h2>
        <VisitsCard />
      </section>

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
        <SignupChart series={state.series} />
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
