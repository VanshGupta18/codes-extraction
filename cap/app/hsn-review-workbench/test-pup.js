import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  await page.goto('http://localhost:5173/hsn-review-workbench/', { waitUntil: 'networkidle2' });
  
  // Click on "Add Material" link in sidebar if it exists to navigate to IngestionPage
  try {
    await page.evaluate(() => {
      const addLink = document.querySelector('a[href="/hsn-review-workbench/add"]');
      if (addLink) addLink.click();
    });
    await new Promise(r => setTimeout(r, 2000));
  } catch(e) {}
  
  await browser.close();
})();
