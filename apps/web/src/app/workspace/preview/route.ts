const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; text-align: center; padding: 24px; box-sizing: border-box; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0; opacity: 0.7; font-size: 14px; }
</style>
</head>
<body>
  <main>
    <h1>Your app preview appears here</h1>
    <p>Placeholder page. The running app replaces it once a project is connected.</p>
  </main>
</body>
</html>`;

export function GET() {
  return new Response(HTML, {headers: {'content-type': 'text/html; charset=utf-8'}});
}
