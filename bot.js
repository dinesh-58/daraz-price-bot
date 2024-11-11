import { Bot } from "grammy";
import { Database } from '@sqlitecloud/drivers';
import puppeteer from 'puppeteer-core';
import express from 'express';

const app = express();
const bot = new Bot(process.env.BOT_API_TOKEN);
const db = new Database(process.env.SQLITE_CLOUD_URL);

// Serve static files from the "public" directory
app.use(express.static('public'));
// accept json data sent to server
app.use(express.json());

bot.command("start", (ctx) => ctx.reply("Welcome! Send any daraz product link to track when its price decreases. If the bot is offline, it will respond to your messages when it is back online"));
bot.hears(/https:\/\/www\.daraz\.com\.np\/products\/[^\s]+/, async (ctx) => {
  const url = ctx.match[0];
  console.log(`\nReceived: ${url}`);


  const pData = await scrapeDaraz(url);
  console.log({ pData });
  // todo: get data from db for current product then compare
  // if pData.finalPrice < prevPrice, notify user, then store new price
  // if finalPrice > prevPrice, don't notify but store
  ctx.reply(`Noted. You will be notified about future price drops for ${pData.name}.`);
})

const DEMO_CRON_INTERVAL_MS = 30 * 1000;
// no. of times to run cron job
const DEMO_CRON_RUN_LIMIT = 5;
bot.command("demo", ctx => {
  // reply with link to served demo html file 
  // call scraper loop with this user's id
  ctx.reply(`Started demo.
    The bot will check http://localhost:${PORT}/demo.html for price drops every ${DEMO_CRON_INTERVAL_MS / 1000} seconds for ${DEMO_CRON_RUN_LIMIT} times.
    `);

    
})

bot.start();
console.log("Bot server is running. \n");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express web server is running on http://localhost:${PORT}`);
});

app.get('/api/getDemoData', async (req, res) => {
  try {
    db.get('SELECT * FROM demo_product LIMIT 1', (err, row) => {
      if (err) return res.status(404).json({ error: 'No data found' });
      res.json(row);
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve data' });
    console.error(error);
  }
});

app.post('/api/postDemoData', async (req, res) => {
  try {
    const { pdpTrackingData } = req.body;

    // todo: perform input sanitization later
    await db.sql(`
      update demo_product
        set 
          pdt_price = '${pdpTrackingData.pdt_price}',
          misc_isDiscounted = ${pdpTrackingData.misc_isDiscounted},
          misc_discountedPrice = '${pdpTrackingData.misc_discountedPrice}'

        where pdt_sku = ${pdpTrackingData.pdt_sku}
        and pdt_simplesku = ${pdpTrackingData.pdt_simplesku}
      `)
    res.status(200).send('Demo data updated');
  } catch (error) {
    res.status(500).json({ error: 'Failed to add data' });
    console.error(error);
  }
});

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

function firstScrape() { }
function scrapeLoop() {
  // setTimeout(scrapeDaraz(), CRON_INTERVAL_MS);
}

export function getNumericPrice(str) {
  return Number(str.replace(/Rs\.?\s?|,|\s/g, ""));
}

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
  await page.goto(url, { timeout: 2 * 60 * 1000 });

  await page.setViewport({ width: 1080, height: 1024 });

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
  if (productData.finalPrice < productData._undiscountedPrice) {
    console.log("discount");

    // todo: prob add condiion to check if element w/ this discount class exists or not
    productData.discountPercent = Number(await page.$eval('.pdp-product-price__discount', el => el.textContent.replace(/-|%/g, '')));
  }


  // don't close if scraping multiple pages? maybe create separate fn to close browser & call when last product reached
  await browser.close();
  return productData;
}
