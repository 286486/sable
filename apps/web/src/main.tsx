import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { List } from "./List.tsx";
import { Tabs } from "./Tabs.tsx";
import { Viewer } from "./Viewer.tsx";

/** The Document list at `/`; the active Document Tab at `/docs/<id>`, switched in place by `go`. */
function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const follow = () => setPath(location.pathname);
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, []);
  const docId = path.match(/^\/docs\/([^/]+)$/)?.[1];
  if (!docId) return <List />;
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <Tabs docId={docId} />
      <div style={{ flex: 1, position: "relative" }}>
        <Viewer key={docId} docId={docId} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
