import markdown, os
d = os.path.dirname(__file__)
src = open(os.path.join(d, "one-pager-lambda-web-functions.md")).read()
body = markdown.markdown(src, extensions=["tables", "fenced_code", "sane_lists"])
html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>One-pager preview</title>
<style>
 body{{background:#f6f7f9;color:#1b2130;font:16px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;margin:0}}
 .page{{max-width:860px;margin:32px auto;background:#fff;padding:56px 64px;box-shadow:0 2px 24px rgba(0,0,0,.08);border-radius:8px}}
 h1{{font-size:28px;margin:0 0 4px;line-height:1.2}} h2{{font-size:20px;margin:30px 0 10px;border-bottom:1px solid #e5e8ec;padding-bottom:6px}}
 h3{{font-size:16px;margin:22px 0 8px;color:#30455e}}
 img{{max-width:100%;border-radius:10px;margin:14px 0;display:block}}
 table{{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}} th,td{{border:1px solid #e1e5ea;padding:7px 10px;text-align:left}} th{{background:#f0f2f5}}
 code{{background:#f0f2f5;padding:1px 5px;border-radius:4px;font-size:13px}}
 strong{{color:#0b1b2b}} em{{color:#5a6b80}}
 blockquote{{border-left:3px solid #a371f7;margin:0;padding:4px 16px;color:#5a6b80;background:#faf8ff}}
</style></head><body><div class="page">{body}</div></body></html>"""
out = os.path.join(d, "one-pager-preview.html")
open(out, "w").write(html)
print(out)
