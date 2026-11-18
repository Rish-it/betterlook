export const CHECKER_DIR = '/tmp/betterlook';
export const CHECKER_SCRIPT = `${CHECKER_DIR}/check.mjs`;
export const CHECKER_PLAYWRIGHT = 'playwright@1.58.0';
export const CHECKER_ENV = {PLAYWRIGHT_BROWSERS_PATH: `${CHECKER_DIR}/browsers`};

// Loads the preview in headless Chromium; prints console and page errors as JSON. Optional 2nd arg saves a screenshot;
// optional 3rd arg is a module whose default export gets the same loaded page (the eval collector).
export const CHECKER_SOURCE = `import {chromium} from 'playwright';
const [url, screenshot, hook] = process.argv.slice(2);
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));
await page.goto(url, {waitUntil: 'networkidle', timeout: 30000});
await page.waitForTimeout(1000);
if (screenshot) await page.screenshot({path: screenshot});
if (hook) await (await import(hook)).default(page);
await browser.close();
console.log(JSON.stringify(errors));
`;
