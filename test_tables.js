const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.edutecnica.it', { waitUntil: 'networkidle' });
  
  const data = await page.evaluate(() => {
    const ts = Array.from(document.querySelectorAll('table'));
    const styles = Array.from(document.styleSheets).map(s => {
      try {
        return s.href;
      } catch(e) {
        return 'error';
      }
    });
    return {
      tables: ts.map(t => ({
        width: t.getAttribute('width'),
        style: t.getAttribute('style'),
        cellpadding: t.getAttribute('cellpadding'),
        outerHTML: t.outerHTML.substring(0, 150)
      })),
      styles
    };
  });
  
  console.log(JSON.stringify(data, null, 2));
  
  await browser.close();
}

main().catch(console.error);
