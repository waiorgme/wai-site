import { Component } from "react";
import type { ReactNode } from "react";

// Convex useQuery throws server-side query errors into render; without a
// boundary React unmounts the whole island to a silent blank page. React
// still requires a class for getDerivedStateFromError. Each surface passes
// its own fallback so the wording stays in that surface's voice; key the
// boundary by view where navigating away should clear the failure.
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
