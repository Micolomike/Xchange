/**
 * Génère le guide administrateur en PDF à partir de docs/admin/guide.html.
 *   cd e2e && npm run guide
 * Le PDF est écrit dans backend/docs/guide-administrateur.pdf (servi aux administrateurs).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, 'docs', 'admin', 'guide.html');
const output = path.join(root, 'backend', 'docs', 'guide-administrateur.pdf');
const version = require(path.join(root, 'backend', 'package.json')).version;
const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

(async () => {
  const html = fs.readFileSync(source, 'utf8').replaceAll('{{VERSION}}', version).replaceAll('{{DATE}}', date);
  const tmp = path.join(path.dirname(source), '.guide-rendu.html');
  fs.writeFileSync(tmp, html);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.pdf({
      path: output,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#6b7685;padding:0 18mm;display:flex;justify-content:space-between;font-family:Arial">
        <span>Xchange, guide de l'administrateur, version ${version}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '20mm', bottom: '22mm', left: '18mm', right: '18mm' },
    });
    console.log(`Guide généré : ${path.relative(root, output)}`);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
})();
