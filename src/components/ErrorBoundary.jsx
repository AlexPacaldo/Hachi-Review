import { Component } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { logClientError } from "../utils/errorLogger.js";

// A throw during render unmounts the whole React tree, which reached the user as
// a completely blank page with nothing to read and nothing to click. This keeps
// the app shell alive instead, records the failure where the Library can list
// it, and always leaves a way out of the page.
//
// The boundary is deliberately reset whenever the route changes, so moving away
// from a page that failed gives a clean render rather than the same error again.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logClientError("render", error, {
      route: window.location?.pathname || "",
      componentStack: String(info?.componentStack || "").slice(0, 800)
    });
  }

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="page narrow">
        <section className="setup-panel">
          <span className="setup-section-icon">
            <AlertTriangle size={23} aria-hidden="true" />
          </span>
          <div>
            <h2>This page ran into a problem</h2>
            <p className="muted">{error.message || "Something went wrong while drawing this page."}</p>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem" }}>{error.stack}</pre>
            <p className="muted">
              Your reviewers, saved quizzes, and history are unaffected. Reloading usually clears it, and the details
              are recorded under Library if it happens again.
            </p>
            <div className="button-row">
              <button className="button primary" type="button" onClick={() => window.location.reload()}>
                <RefreshCw size={16} aria-hidden="true" />
                Reload the page
              </button>
              <Link className="button subtle" to="/home">Back to Reviewers</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }
}
