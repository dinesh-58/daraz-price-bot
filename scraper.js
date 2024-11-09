import puppeteer from 'puppeteer-core';

const CRON_INTERVAL_MS = 4 * 60 * 60 * 1000;
setInterval(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage();

  const url="https://www.daraz.com.np/products/m160-led-mouse-with-rgb-led-light-i128305627-s1035567228.html";
  await page.goto(url);
  
  await page.setViewport({width: 1080, height: 1024});
//   const [_, productId, productSKU] = url.match(/i(\d+)-s(\d+)\.html/);
//   const finalPrice = await page.$eval('.pdp-price_type_normal', el => el.textContent);
// pdp-product-price__discount // remove '-' from this
//   console.log(price, productId, productSKU);

  // TODO: make dummy site have form for changing product data. 
//   this will then be saved to pdpTrackingData globally-scoped obj 
  const productData = await page.evaluate(() => {
    return typeof pdpTrackingData !== 'undefined' ? pdpTrackingData : null;
  });
  // NOTE: pdt_sku is unique product id. pdt_simplesku is id for variant of that product 
  // price in this obj is undiscounted price
  console.log(productData);

  await browser.close();
}, CRON_INTERVAL_MS);