import { Component, type ReactNode } from 'react';

/** Last-resort safety net: shows a recovery screen instead of a blank page if rendering throws. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Unexpected UI error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loading" role="alert">
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p className="muted">Your data is safe — every change is already saved. Reload to continue.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
