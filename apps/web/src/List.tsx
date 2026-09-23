import { useEffect, useState } from "react";

interface Listed {
  docId: string;
  name: string;
  createdAt: string;
}

/** Every Document, newest first. */
export function List() {
  const [docs, setDocs] = useState<Listed[] | null>(null);
  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json() as Promise<{ documents: Listed[] }>)
      .then((r) => setDocs(r.documents));
  }, []);
  return (
    <main style={{ padding: 24 }}>
      <h1>Documents</h1>
      {docs === null ? (
        <p>Loading…</p>
      ) : docs.length === 0 ? (
        <p>No Documents yet. Ask an Agent to call zibel_doc_create.</p>
      ) : (
        <ul>
          {docs.map((d) => (
            <li key={d.docId}>
              <a href={`/docs/${d.docId}`}>{d.name}</a>{" "}
              <small>{new Date(d.createdAt).toLocaleString()}</small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
