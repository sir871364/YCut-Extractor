# 產生上架用的 zip（YCut-Extractor）。
#
# 從 manifest 出發追依賴，不寫死清單：
#   manifest → service_worker / default_popup / icons / content_scripts(js, css)
#   JS       → import ... from '...'、chrome.runtime.getURL('...')
#   HTML     → src=、href=
# 遞迴到收斂。測試、產生器、說明文件、截圖、README、src/（esbuild 的來源）都不會被收進去——
# content.js 是打包後的成品，manifest 指向它；src/ 只有 popup 用 module 直接 import 的檔案才會被追進來。
#
# 用法（在專案根目錄）：python tools/package.py
# 記得先 npm run build，讓 content.js 與 src/ 同步。

import json
import os
import re
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IMPORT_RE = re.compile(r"""from\s+['"]([^'"]+)['"]""")
GETURL_RE = re.compile(r"""getURL\(\s*['"]([^'"]+)['"]""")
ASSET_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""")


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def norm(rel):
    return os.path.normpath(rel).replace('\\', '/')


def refs_of(rel):
    if rel.endswith(('.png', '.json', '.css')):
        return []
    text = read(rel)
    base = os.path.dirname(rel)
    out = []
    patterns = [ASSET_RE] if rel.endswith('.html') else [IMPORT_RE, GETURL_RE]
    for pattern in patterns:
        for m in pattern.finditer(text):
            target = m.group(1)
            if target.startswith(('http://', 'https://', 'data:', '#')):
                continue
            out.append(norm(os.path.join(base, target)))
    return out


def main():
    manifest = json.loads(read('manifest.json'))

    seeds = ['manifest.json', manifest['background']['service_worker'],
             manifest['action']['default_popup']]
    seeds += list(manifest.get('icons', {}).values())
    seeds += list(manifest.get('action', {}).get('default_icon', {}).values())
    for cs in manifest.get('content_scripts', []):
        seeds += cs.get('js', []) + cs.get('css', [])

    included, queue, missing = set(), [norm(s) for s in seeds], []
    while queue:
        rel = queue.pop()
        if rel in included:
            continue
        if not os.path.isfile(os.path.join(ROOT, rel)):
            missing.append(rel)
            continue
        included.add(rel)
        queue.extend(refs_of(rel))

    if missing:
        print('以下被引用的檔案不存在：')
        for m in sorted(missing):
            print('  -', m)
        sys.exit(1)

    banned = [f for f in included
              if f.startswith(('tests/', 'tools/', 'node_modules/')) or f.endswith(('.md', '.py'))]
    if banned:
        print('上架包混入了開發用檔案：', banned)
        sys.exit(1)

    # content.js 必須是 src/ 的最新產物，否則上架的是舊邏輯
    src_mtime = max(os.path.getmtime(os.path.join(ROOT, 'src', f)) for f in os.listdir(os.path.join(ROOT, 'src')))
    if os.path.getmtime(os.path.join(ROOT, 'content.js')) < src_mtime:
        print('content.js 比 src/ 舊，請先 npm run build')
        sys.exit(1)

    out = os.path.join(ROOT, f"YCut-Extractor-{manifest['version']}-store.zip")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in sorted(included):
            z.write(os.path.join(ROOT, rel), rel)

    total = os.path.getsize(out)
    print(f"版本   {manifest['version']}")
    print(f"檔案   {len(included)} 個")
    print(f"輸出   {os.path.basename(out)}  ({total / 1024:.0f} KB)")
    print()
    for rel in sorted(included):
        size = os.path.getsize(os.path.join(ROOT, rel))
        print(f"  {rel:<32} {size / 1024:7.1f} KB")


if __name__ == '__main__':
    main()
