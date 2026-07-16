/**
 * ErrorBoundary.tsx
 *
 * A crash in any single calculator was taking down the entire page (React
 * unmounts the whole tree on an uncaught render error with no boundary in
 * place — this is exactly how the Monte Carlo horizon bug went from "one
 * bad index" to a blank page). Wrap each top-level calculator component
 * with this so a future bug degrades to an inline message instead.
 *
 * Must be a class component — componentDidCatch/getDerivedStateFromError
 * have no hook equivalent.
 */

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; name: string };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`${this.props.name} crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: "980px", margin: "0 auto", padding: "1.5rem" }}>
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: "0.75rem",
              padding: "1.25rem",
              color: "#dc2626",
            }}
          >
            <strong>Something went wrong loading {this.props.name}.</strong>
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
              Try{" "}
              <a href="" style={{ color: "#dc2626", textDecoration: "underline" }}>
                reloading the page
              </a>
              . If it keeps happening, the tool itself needs a fix.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
