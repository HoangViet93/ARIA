// Gộp kết quả chạy nhiều kịch bản thành ma trận truy vết yêu cầu.
//
// Trạng thái một yêu cầu:
//   verified       có monitor đạt (đã kích hoạt) và không monitor nào trượt
//   failed         có monitor trượt ở ít nhất một kịch bản danh định
//   not-exercised  có monitor nhưng chưa kịch bản nào kích hoạt được
//   no-monitor     chưa có monitor nào kiểm yêu cầu này
// Kết quả của kịch bản tiêm lỗi (scenario.expect) KHÔNG tính vào trạng thái
// yêu cầu: chúng chứng minh hệ phát hiện được mối nguy, không phải yêu cầu
// danh định đã đạt. Chúng hiện riêng trong cột kịch bản.

export function requirementMatrix(requirements, monitors, runs) {
  const monByReq = new Map();
  for (const m of monitors) {
    for (const r of m.req || []) {
      if (!monByReq.has(r)) monByReq.set(r, []);
      monByReq.get(r).push(m.id);
    }
  }
  const blocksByReq = new Map();
  for (const run of runs) {
    for (const [blk, reqs] of Object.entries(run.implementsMap || {})) {
      for (const r of reqs) {
        if (!blocksByReq.has(r)) blocksByReq.set(r, new Set());
        blocksByReq.get(r).add(blk);
      }
    }
  }
  const rows = requirements.map((req) => {
    const mons = monByReq.get(req.code) || [];
    const cells = {};
    let anyPass = false;
    let anyFail = false;
    for (const run of runs) {
      const vs = (run.verdicts || []).filter((v) => mons.includes(v.id));
      if (!vs.length) continue;
      const nominal = vs.filter((v) => !v.expected);
      if (nominal.some((v) => v.status === 'fail' || v.status === 'error')) anyFail = true;
      if (nominal.some((v) => v.status === 'pass')) anyPass = true;
      const worst = ['error', 'fail', 'inconclusive', 'pass', 'not-triggered']
        .find((s) => vs.some((v) => v.status === s));
      cells[run.scenario] = { status: worst, expected: vs.some((v) => v.expected), asExpected: vs.every((v) => !v.expected || v.asExpected), ids: vs.map((v) => v.id) };
    }
    let status;
    if (!mons.length) status = 'no-monitor';
    else if (anyFail) status = 'failed';
    else if (anyPass) status = 'verified';
    else status = 'not-exercised';
    return { ...req, monitors: mons, blocks: [...(blocksByReq.get(req.code) || [])], cells, status };
  });
  const orphanMonitors = monitors.filter((m) => !(m.req || []).length).map((m) => m.id);
  const unknownReqs = [...monByReq.keys()].filter((r) => !requirements.some((q) => q.code === r));
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    summary: { total: rows.length, verified: count('verified'), failed: count('failed'), notExercised: count('not-exercised'), noMonitor: count('no-monitor') },
    orphanMonitors,
    unknownReqs,
  };
}

// Độ phủ transition của Chart qua mọi lần chạy.
export function transitionCoverage(runs) {
  const acc = {};
  for (const run of runs) {
    for (const [blk, list] of Object.entries(run.coverage || {})) {
      if (!acc[blk]) acc[blk] = list.map((c) => ({ ...c, count: 0, scenarios: [] }));
      list.forEach((c, k) => {
        acc[blk][k].count += c.count;
        if (c.count) acc[blk][k].scenarios.push(run.scenario);
      });
    }
  }
  return Object.entries(acc).map(([block, list]) => ({
    block,
    transitions: list,
    covered: list.filter((c) => c.count > 0).length,
    total: list.length,
  }));
}
