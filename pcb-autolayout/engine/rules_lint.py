"""T36 rules_lint — chặn rule thiếu thành phần bắt buộc (ROLES.md §5.2).

    python3 rules_lint.py            # exit 1 nếu có lỗi

Mỗi rule phải có: id duy nhất, severity ∈ {C, M, m}, title, threshold.max là số,
checker có thật trong pcbkit.checks.Checker, và ít nhất một test trong
tests/test_checks.py nhắc tới id của nó.
"""
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pcbkit.checks import Checker  # noqa: E402


def lint(rules_path, tests_path):
    rules = yaml.safe_load(open(rules_path))
    tests = open(tests_path).read() if os.path.exists(tests_path) else ""
    errs = []
    seen = set()
    for i, r in enumerate(rules):
        rid = r.get("id", "<thiếu id #%d>" % i)
        if rid in seen:
            errs.append("%s: trùng id" % rid)
        seen.add(rid)
        if r.get("severity") not in ("C", "M", "m"):
            errs.append("%s: severity phải là C/M/m" % rid)
        if not r.get("title"):
            errs.append("%s: thiếu title" % rid)
        th = (r.get("threshold") or {}).get("max")
        if not isinstance(th, (int, float)):
            errs.append("%s: threshold.max phải là một số (không phải khoảng)" % rid)
        if not hasattr(Checker, r.get("checker", "")):
            errs.append("%s: checker '%s' không tồn tại" % (rid, r.get("checker")))
        if '"%s"' % rid not in tests and "'%s'" % rid not in tests:
            errs.append("%s: chưa có test trong %s" % (rid, os.path.basename(tests_path)))
    return rules, errs


if __name__ == "__main__":
    rules, errs = lint(os.path.join(HERE, "rules", "core.yaml"), os.path.join(HERE, "tests", "test_checks.py"))
    for e in errs:
        print("LỖI  " + e)
    print("%d rule, %d lỗi" % (len(rules), len(errs)))
    sys.exit(1 if errs else 0)
