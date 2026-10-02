import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  DATABASE_CRITICAL_PERCENT,
  DATABASE_WARN_PERCENT,
  formatDatabaseSize,
  getAdminDatabaseUsage
} from "../services/adminUsage.js";

// Owner only. The database refuses to report the size to any other account, so
// this returns null for everyone else and renders nothing.
export default function AdminUsageBanner() {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let active = true;

    getAdminDatabaseUsage().then((result) => {
      if (active) setUsage(result);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!usage || usage.percentUsed < DATABASE_WARN_PERCENT) return null;

  const critical = usage.percentUsed >= DATABASE_CRITICAL_PERCENT;
  const tone = critical ? "danger" : "warning";

  return (
    <div className={`usage-banner ${tone}`} role="status">
      <span className="banner-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
      <span>
        {critical ? "Database nearly full." : "Database filling up."}{" "}
        {formatDatabaseSize(usage.usedBytes)} of {formatDatabaseSize(usage.limitBytes)} used ({usage.percentUsed}%).
      </span>
      <span className="banner-note">
        Saving reviewers and quiz history stops working once this is full.
      </span>
    </div>
  );
}