"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  /** Short label shown in the error card so the user knows which panel broke. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wrap each results panel so a broken upstream response (e.g. a third-party
 * API returning an unexpected shape) only blanks that single card instead of
 * killing the entire dashboard.
 *
 * The fallback intentionally does NOT show the raw stack — that's noise for
 * end users.  The console still gets the full error for debugging.
 */
export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[PanelErrorBoundary] "${this.props.label}" crashed:`, error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          aria-live="polite"
          className="terminal-card p-4 border border-[#ff3e3e]/30 bg-[#ff3e3e]/[0.04] space-y-2"
        >
          <div className="flex items-center gap-2 text-[12px] uppercase tracking-widest text-[#ff3e3e]/92 font-mono">
            <AlertTriangle className="w-3.5 h-3.5" />
            PANEL ERROR: {this.props.label}
          </div>
          <p className="text-[13px] font-mono text-[#ff3e3e]/92 leading-snug">
            This panel failed to render. The rest of the dashboard is fine. The
            full error has been logged to the browser console.
          </p>
          <button
            onClick={this.reset}
            className="text-[12px] font-mono font-bold uppercase tracking-widest border border-[#ff3e3e]/50 text-[#ff3e3e] px-2.5 py-1 hover:bg-[#ff3e3e]/10 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
