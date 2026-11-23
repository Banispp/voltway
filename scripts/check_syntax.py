import re

def check_js(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        text = f.read()

    # Simple strip of comments and strings
    clean = []
    i = 0
    n = len(text)
    while i < n:
        if text[i:i+2] == '//':
            i = text.find('\n', i)
            if i == -1: break
        elif text[i:i+2] == '/*':
            i = text.find('*/', i)
            if i == -1: break
            i += 2
        elif text[i] == "'":
            i += 1
            while i < n and text[i] != "'":
                if text[i] == '\\': i += 1
                i += 1
            i += 1
        elif text[i] == '"':
            i += 1
            while i < n and text[i] != '"':
                if text[i] == '\\': i += 1
                i += 1
            i += 1
        elif text[i] == '`':
            i += 1
            while i < n and text[i] != '`':
                if text[i] == '\\': i += 1
                i += 1
            i += 1
        elif text[i] == '/' and i + 1 < n and text[i+1] not in ('/', '*'):
            prev = ''.join(clean).rstrip()
            if prev and prev[-1] in '=(:[{,;!&|?':
                i += 1
                while i < n and text[i] != '/':
                    if text[i] == '\\': i += 1
                    elif text[i] == '[':
                        while i < n and text[i] != ']':
                            if text[i] == '\\': i += 1
                            i += 1
                    i += 1
                i += 1
            else:
                clean.append(text[i])
                i += 1
        else:
            clean.append(text[i])
            i += 1

    cleaned = ''.join(clean)
    brackets = {'(': ')', '{': '}', '[': ']'}
    stack = []
    for idx, ch in enumerate(cleaned):
        if ch in brackets:
            stack.append((ch, idx))
        elif ch in brackets.values():
            if not stack:
                return f'Error: Unmatched {ch} at {idx}'
            last, last_idx = stack.pop()
            if brackets[last] != ch:
                return f'Error: Mismatched {last} (at {last_idx}) with {ch} (at {idx})'
    if stack:
        return f'Error: Unclosed brackets: {stack[-3:]}'
    return 'OK: All brackets balanced!'

print('js/utilities.js:', check_js('js/utilities.js'))
print('js/map.js:', check_js('js/map.js'))
print('js/sync.js:', check_js('js/sync.js'))
print('js/app.js:', check_js('js/app.js'))
print('sw.js:', check_js('sw.js'))
