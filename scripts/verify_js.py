import re
import sys

def check_js(path):
    with open(path, encoding='utf-8') as f:
        code = f.read()
    # strip comments
    code = re.sub(r'//.*', '', code)
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
    
    # Simple state machine to parse strings and verify braces
    stack = []
    pairs = {')': '(', '}': '{', ']': '['}
    in_single = False
    in_double = False
    in_backtick = False
    escape = False

    for idx, ch in enumerate(code):
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if in_single:
            if ch == "'":
                in_single = False
            continue
        if in_double:
            if ch == '"':
                in_double = False
            continue
        if in_backtick:
            if ch == '`':
                in_backtick = False
            continue

        if ch == "'":
            in_single = True
        elif ch == '"':
            in_double = True
        elif ch == '`':
            in_backtick = True
        elif ch in '({[':
            stack.append((ch, idx))
        elif ch in ')}]':
            if not stack:
                print(f"Error: unmatched '{ch}' at char {idx} in {path}")
                return False
            top, top_idx = stack.pop()
            if top != pairs[ch]:
                print(f"Error: mismatched '{top}' (at {top_idx}) with '{ch}' at char {idx} in {path}")
                return False

    if stack:
        top, top_idx = stack[-1]
        print(f"Error: unclosed '{top}' at char {top_idx} in {path}")
        return False
    print(f"OK: {path} structure is well-formed!")
    return True

all_ok = True
for f in ['js/app.js', 'sw.js', 'chargers_db.js', 'js/map.js', 'js/router.js', 'js/navigator.js', 'js/battery.js']:
    if not check_js(f):
        all_ok = False

sys.exit(0 if all_ok else 1)
