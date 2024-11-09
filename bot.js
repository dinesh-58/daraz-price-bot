import { Bot } from "grammy";
import { Database } from '@sqlitecloud/drivers';
import puppeteer from 'puppeteer-core';

const bot = new Bot(process.env.BOT_API_TOKEN); 
const db = new Database(process.env.SQLITE_CLOUD_URL);


bot.command("start", (ctx) => ctx.reply("Welcome! Send any daraz product link to track when its price decreases. If the bot is offline, it will respond to your messages when it is back online"));
// bot.on("message", (ctx) => ctx.reply("Got another message!"));
bot.hears(/https:\/\/www\.daraz\.com\.np\/products\/[^\s]+/, async (ctx) => {
    const url = ctx.match[0];
    console.log(`\nReceived: ${url}`);
    

    const pData = await scrapeDaraz(url);
    console.log({pData});
    // todo: get data from db for current product then compare
    // if pData.finalPrice < prevPrice, notify user, then store new price
    // if finalPrice > prevPrice, don't notify but store
})


bot.start();

function clearObjectValues(obj) {
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string") {
            obj[key] = "";
        } else if (typeof value === "number") {
            obj[key] = 0;
        } else if (typeof value === "boolean") {
            obj[key] = false;
        } else if (Array.isArray(value)) {
            obj[key] = [];
        } else if (typeof value === "object" && value !== null) {
            obj[key] = {};
        } else {
            obj[key] = null; // Set to null for unhandled types
        }
    }
    return obj;
}


const CRON_INTERVAL_MS = 4 * 60 * 60 * 1000;

function firstScrape() {}
function scrapeLoop() {
// setTimeout(scrapeDaraz(), CRON_INTERVAL_MS);
}

function getNumericPrice(str) {
  return Number(str.replace(/Rs\.?\s?|,|\s/g, ""));
}

console.log(getNumericPrice("Rs. 9,000"));

async function scrapeDaraz(url) {
    const productData = {
        id: '',
        sku: '',
        name: '',
        url: '',
        finalPrice: 0,
        // properties starting with _ shouldn't be stored in db
        _undiscountedPrice: 0,
        _discountPercent: 0
    };

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage();

  // const url="https://www.daraz.com.np/products/m160-led-mouse-with-rgb-led-light-i128305627-s1035567228.html";
  await page.goto(url, {timeout: 2*60*1000});
  
  await page.setViewport({width: 1080, height: 1024});

  // TODO: make dummy site have form for changing product data. 
//   this will then be saved to pdpTrackingData globally-scoped obj 

  // INFO: each product page in daraz has a globally-scoped obj pdpTrackingData 
  // that has data about the product
  const loggedData = await page.evaluate(() => {
    return typeof pdpTrackingData !== 'undefined' ? pdpTrackingData : null;
  });

  
  productData.url = url;
  productData.id = loggedData.pdt_sku;
  productData.sku = loggedData.pdt_simplesku;
  productData.name = loggedData.pdt_name;
  productData._undiscountedPrice = getNumericPrice(loggedData.pdt_price);
  productData.finalPrice = getNumericPrice(await page.$eval('.pdp-price_type_normal', el => el.textContent));

  // maybe notify user about discount %
  if(productData.finalPrice < productData._undiscountedPrice) {
    console.log("discount");
    
      // todo: prob add condiion to check if element w/ this discount class exists or not
      productData.discountPercent = Number(await page.$eval('.pdp-product-price__discount', el => el.textContent.replace(/-|%/g, '')));
  }
  
  
  // don't close if scraping multiple pages? maybe create separate fn to close browser & call when last product reached
  await browser.close();
  return productData;
}
