const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.edutecnica.it', { waitUntil: 'networkidle' });
  
  const data = await page.evaluate(() => {
    const layoutCandidates = Array.from(
      document.querySelectorAll(
        'header, nav, main, footer, section, article, aside, [class*="container"], [class*="wrapper"], [class*="row"], [class*="grid"], [class*="flex"], body > div'
      )
    );
    
    const flexEls = [];
    for (const el of layoutCandidates) {
      const disp = window.getComputedStyle(el).display;
      if (disp === 'flex' || disp === 'inline-flex' || disp === 'grid' || disp === 'inline-grid') {
         flexEls.push({
           tag: el.tagName,
           id: el.id,
           className: el.className,
           disp,
           outerHTML: el.outerHTML.substring(0, 100)
         });
      }
    }
    return flexEls;
  });
  
  console.log(JSON.stringify(data, null, 2));
  
  await browser.close();
}

main().catch(console.error);
