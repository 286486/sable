import { assert, type Check } from "./mcp.ts";

const check: Check = async (call, docId, tools) => {
  const { changes } = (await call("zibel_doc_changes", { docId, sinceRev: 1 }))
    .structuredContent as {
    changes: { createdIds: string[] }[];
  };
  assert(changes.length === 1, `${changes.length} changes after rev 1, want 1`);
  const created = changes[0]?.createdIds.length ?? 0;
  assert(created >= 5, `the change creates ${created} Nodes, want at least 5`);

  const count = (name: string) => tools.filter((t) => t === name).length;
  assert(
    count("zibel_tx_begin") === 1 && count("zibel_tx_commit") === 1,
    `${count("zibel_tx_begin")} tx_begin and ${count("zibel_tx_commit")} tx_commit, want 1 and 1`,
  );
  const begin = tools.indexOf("zibel_tx_begin");
  const commit = tools.indexOf("zibel_tx_commit");
  const inside = tools.slice(begin, commit).filter((t) => t === "zibel_node_create").length;
  assert(inside >= 2, `${inside} node_create calls inside the Transaction, want at least 2`);
  assert(tools.lastIndexOf("zibel_render") > commit, "no zibel_render after zibel_tx_commit");
};

export default check;
