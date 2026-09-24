import { useEffect, useState } from "react";

interface Listed {
  docId: string;
  name: string;
  createdAt: string;
}

interface Opened {
  docId: string;
  warnings: { code: string; message: string }[];
}

/** Every Document, newest first, and Open file for an .svg or .zibel.json. */
export function List() {
  const [docs, setDocs] = useState<Listed[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // Sent over HTTP and parsed in the Worker, like zibel_doc_open (ADR-0017).
  const open = async (file: File) => {
    setOpenError(null);
    const res = await fetch(`/api/docs?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: await file.text(),
    });
    const body = (await res.json()) as Opened & { message?: string; hint?: string };
    if (!res.ok) setOpenError(`${body.message} ${body.hint ?? ""}`);
    else if (body.warnings.length === 0) location.assign(`/docs/${body.docId}`);
    else setOpened(body);
  };
  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json() as Promise<{ documents: Listed[] }>)
      .then((r) => setDocs(r.documents))
      .catch((e: unknown) => setError(String(e)));
  }, []);
  return (
    <main style={{ padding: 24 }}>
      <h1>Documents</h1>
      <label>
        Open file{" "}
        <input
          type="file"
          accept=".svg,.json,image/svg+xml,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) open(file).catch((err: unknown) => setOpenError(String(err)));
          }}
        />
      </label>
      {openError && <p role="alert">Could not open the file: {openError}</p>}
      {opened && (
        <div role="status">
          <p>Opened, with what did not come across:</p>
          <ul>
            {opened.warnings.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
          </ul>
          <a href={`/docs/${opened.docId}`}>Open the Document</a>
        </div>
      )}
      {error ? (
        <p>Could not load Documents: {error}</p>
      ) : docs === null ? (
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
