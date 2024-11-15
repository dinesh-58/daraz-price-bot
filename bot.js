import { Bot } from "grammy";
import { Database } from '@sqlitecloud/drivers';
import puppeteer from 'puppeteer-core';
import express from 'express';

const app = express();
const bot = new Bot(process.env.BOT_API_TOKEN);
const db = new Database(process.env.SQLITE_CLOUD_URL);

const PORT = process.env.PORT || 3000;
// Serve static files from the "public" directory
app.use(express.static('public'));
// accept json data sent to server
app.use(express.json());

bot.command("start", async (ctx) => {
  ctx.reply("Welcome! Send any daraz product link to track when its price decreases. If the bot is offline, it will respond to your messages when it is back online")

  const { id, first_name, username } = ctx.chat;

  try {
    await db.sql(`INSERT INTO users (id, first_name, username) 
    values('${id}', '${first_name}', '${username}')
    ON CONFLICT(id) DO UPDATE SET
      first_name = ${fName},
      username = ${username}
      `);
  } catch (err) {
    console.error(err);
  }
});

bot.hears(/https:\/\/www\.daraz\.com\.np\/products\/[^\s]+/, async (ctx) => {
  const url = ctx.match[0];
  console.log(`\nReceived: ${url}`);
  
  const productData = await scrapeDaraz(url);
  ctx.reply(`Noted. You will be notified about future price drops for ${productData.name}.`);
  await insertProduct(productData);
  await insertWishlist(productData.idSku, ctx.chat.id);

  // todo: move this logic belowto some other function. not needed here
  //  get data from db for current product then compare
  // if pData.finalPrice < prevPrice, notify user, then store new price
  // if finalPrice > prevPrice, don't notify but store
})

async function insertProduct(productData) {
  const { idSku, name, url, finalPrice } = productData;
  try {
    await db.sql(`
 insert into products(idSku, name, url, prevPrice)
  values('${idSku}', '${name}', '${url}', ${finalPrice})
    ON CONFLICT(idSku) DO UPDATE SET
      scrapePriority = scrapePriority + 1
 `);
  } catch (err) {
    console.error(err);
  }
}

async function insertWishlist(idSku, user_id) {
  try {
    // todo: handle duplicate entries by same user?
    await db.sql(`
      insert into wishlist(idSku, user_id)
      values('${idSku}', '${user_id}')
      `);
  } catch (err) {
    console.error(err);
  }
}

const DEMO_CRON_INTERVAL_MS = 30 * 1000;
// no. of times to run cron job
const DEMO_CRON_RUN_LIMIT = 5;
const DEMO_URL = `http://localhost:${PORT}/demo.html`

bot.command("demo", async ctx => {
  // todo: call scraper loop with this user's id
  ctx.reply(`Started demo.
    The bot will check ${DEMO_URL} for price drops every ${DEMO_CRON_INTERVAL_MS / 1000} seconds for ${DEMO_CRON_RUN_LIMIT} times.
    `);
  try {
    // add to demo watchlist
    await addUserToWishlist(ctx.chat, DEMO_URL, true);
    // todo: need productData here to specify which product's watchlist to add to
    scrapeCronJob(DEMO_URL);
  } catch (err) {
    console.error(err);
  }
})

async function addUserToWishlist(chatDetails, url, isDemo = false) {
  try {

    const { id, first_name, username } = chatDetails;

    // todo: insert into wishlist table. if demo, concat do update
    // need idSku for this

    const { idSku } = scrapeDaraz(url);
    db.get('select pdt_sku, pdt_simplesku', (err, row) => {
      const demoIdSku = `i${row.pdt_sku}-s${row.pdt_simplesku}`;
      // for demo, oly current user should be in wishlist
      stmt = isDemo ? `INSERT INTO wishlist(idSku, user_id) values(${idSku}, ${id})`
        : `update wishlist set user_id=${id} 
  where idSku=${demoIdSku}`;
      db.exec(stmt);
    })
  } catch (err) {
    console.error(err);
  }
}

// TODO: hmm don't pass url here since its supposed to loop for all products during 1 cron job? 
async function scrapeCronJob(url, cronIntervalMs, cronRunLimit) {
  // run every cronIntervalMs uptil cronRunLimit (set limit to -1 for infinite)
  // setTimeout(scrapeDaraz(), CRON_INTERVAL_MS);
  comparePrevPrice(await scrapeDaraz(url));
}

function comparePrevPrice(productData) {
  db.get(`SELECT * FROM products where idSku='${productData.idSku}' LIMIT 1`, (err, row) => {
    if (err) {
      res.status(404).json({ error: 'No data found' });
      return console.error(err);
    }
    const final = getNumericPrice(productData.finalPrice);
    const prev = getNumericPrice(row.prevPrice);
    if (final < prev) {
      // notify users
      // in db, update prevPrice 
      // & incrementscrapePriority
    } else if (final > prev) {
      // only update prevPrice
    }
  });
}

bot.start();
console.log("Bot server is running. \n");

app.listen(PORT, () => {
  console.log(`Express web server is running on http://localhost:${PORT}`);
});

app.get('/api/getDemoData', async (req, res) => {
  try {
    db.get('SELECT * FROM demo_product LIMIT 1', (err, row) => {
      if (err) {
        res.status(404).json({ error: 'No data found' });
        return console.error(err);
      }
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

const CRON_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function getNumericPrice(str) {
  // todo: just remove any alphabets and symbols
  return Number(str.replace(/Rs\.?\s?|,|\s/g, ""));
}

async function scrapeDaraz(url) {
  const productData = {
    idSku: '',
    name: '',
    url: '',
    finalPrice: 0,
    // properties starting with _ shouldn't be stored in db
    _undiscountedPrice: 0,
    _discountPercent: 0
  };

  const browser = await puppeteer.launch({
    browser: process.env.PUPPETEER_BROWSER,
    ...(process.env.PUPPETEER_BROWSER_PATH && { executablePath: process.env.PUPPETEER_BROWSER_PATH }),
    headless: true,
  });
  const page = await browser.newPage();

  await page.goto(url, {
    timeout: 2 * 60 * 1000,
    waitUntil: "networkidle0"
  });

  await page.setViewport({ width: 1080, height: 1024 });

  // INFO: each product page in daraz has a globally-scoped obj pdpTrackingData 
  // that has data about the product
  const loggedData = await page.evaluate(() => {
    return typeof pdpTrackingData !== 'undefined' ? pdpTrackingData : null;
  });


  productData.url = url;
  productData.idSku = `i${loggedData.pdt_sku}-s${loggedData.pdt_simplesku}`;
  productData.name = loggedData.pdt_name;
  productData._undiscountedPrice = getNumericPrice(loggedData.pdt_price);
  productData.finalPrice = getNumericPrice(await page.$eval('.pdp-price_type_normal', el => el.textContent));

  // maybe notify user about discount %
  if (productData.finalPrice < productData._undiscountedPrice) {
    const discountText = await page.$eval('.pdp-product-price__discount',
      el => el.textContent
    ).catch(() => null);
    if (discountText !== null) {
      productData.discountPercent = Number(discountText.replace(/-|%/g, ''));
    } else {
      productData._discountPercent = null;
    }
  }


  // don't close if scraping multiple pages? maybe create separate fn to close browser & call when last product reached
  await browser.close();
  return productData;
}
