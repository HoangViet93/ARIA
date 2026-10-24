"""Đọc S-expression của KiCad (netlist, board) thành list lồng nhau. Chuỗi trong
ngoặc kép giữ nguyên (đã bỏ ngoặc), nguyên tử khác giữ dạng chuỗi."""


def parse(text):
    stack, cur, i, n = [], [], 0, len(text)
    while i < n:
        c = text[i]
        if c == "(":
            stack.append(cur)
            cur = []
            i += 1
        elif c == ")":
            done = cur
            cur = stack.pop()
            cur.append(done)
            i += 1
        elif c == '"':
            j = i + 1
            buf = []
            while text[j] != '"':
                if text[j] == "\\":
                    j += 1
                buf.append(text[j])
                j += 1
            cur.append("".join(buf))
            i = j + 1
        elif c.isspace():
            i += 1
        else:
            j = i
            while j < n and not text[j].isspace() and text[j] not in '()"':
                j += 1
            cur.append(text[i:j])
            i = j
    return cur[0] if len(cur) == 1 else cur


def find(node, key):
    """Các con trực tiếp có tên `key`."""
    return [x for x in node[1:] if isinstance(x, list) and x and x[0] == key]


def first(node, key, default=None):
    r = find(node, key)
    return r[0] if r else default


def value(node, key, default=None):
    r = first(node, key)
    return r[1] if r is not None and len(r) > 1 else default
