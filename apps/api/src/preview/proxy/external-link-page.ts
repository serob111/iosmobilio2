function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Served in place of following a redirect that lands outside the project's host
 * allowlist — the proxy can't safely fetch a third-party site through this slug, so
 * instead of silently failing (or, worse, fetching it anyway) this hands the visitor a
 * real link they can choose to follow themselves, in a new tab.
 */
export function renderExternalLinkPage(location: string): string {
  const escaped = escapeHtml(location);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Внешняя ссылка</title>
<style>
body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;color:#111;text-align:center;padding:24px;box-sizing:border-box;}
.card{max-width:420px;}
a{color:#0a66c2;word-break:break-all;}
</style>
</head>
<body>
<div class="card">
<p>Эта ссылка ведёт на внешний сайт, который превью не может открыть внутри приложения.</p>
<p><a href="${escaped}" target="_blank" rel="noopener noreferrer">Открыть ${escaped}</a></p>
</div>
</body>
</html>`;
}
