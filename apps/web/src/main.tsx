import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { List } from "./List.tsx";
import { Viewer } from "./Viewer.tsx";

const docId = location.pathname.match(/^\/docs\/([^/]+)$/)?.[1];

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>{docId ? <Viewer docId={docId} /> : <List />}</StrictMode>,
);
