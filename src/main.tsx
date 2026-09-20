import { t } from "./lib/i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./components/compact-pages.css";
import "./components/unified-pages.css";

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal-error">
          <h1>{t("界面暂时无法显示")}</h1>
          <p>{t(this.state.error)}</p>
          <button onClick={() => location.reload()}>{t("重新加载")}</button>
        </main>
      );
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
