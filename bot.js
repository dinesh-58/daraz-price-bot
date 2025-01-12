import { Bot } from "grammy";
import { Database } from "@sqlitecloud/drivers";
import puppeteer from "puppeteer-core";
import express from "express";

const app = express();
const bot = new Bot(process.env.BOT_API_TOKEN);
const db = new Database(process.env.SQLITE_CLOUD_URL);

const PORT = process.env.PORT || 3000;
// Serve static files from the "public" directory
app.use(express.static("public"));
// accept json data sent to server
app.use(express.json());

await bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show help text" },
  { command: "list", description: "View products tracked by you" },
  { command: "demo", description: "Run demo" },
  // { command: "force", description: "Force check prices" },
  { command: "forcedemo", description: "Force check prices for demo" },
  { command: "remove", description: "Remove specified product from tracking" },
]);

bot.command("list", async (ctx) => {
  try {
    const sql = `
      SELECT w.idSku, p.name 
      FROM wishlist w
      JOIN products p ON w.idSku = p.idSku
      WHERE w.user_id = ${ctx.chat.id}`;
    db.all(sql, (err, rows) => {
      if (err) {
        console.error(err);
        ctx.reply("An error occurred while fetching your list.");
        return;
      }
      if (rows.length === 0) {
        ctx.reply("Your list is empty.");
        return;
      }
      let message = "<b>Your List</b>\n";
      message += "<pre>";
      message += "| idSku             | Product Name                             |\n";
      message += "|-------------------|------------------------------------------|\n";

      rows.forEach((row) => {
        const idSku = row.idSku.toString();
        let productName = row.name;

        const words = productName.split(" ");
        const first4Words = words.slice(0, 4).join(" ");

        message += `| ${idSku.padEnd(18)} | ${first4Words.padEnd(40)} |\n`;
      });

      message += "</pre>";

      ctx.reply(message, { parse_mode: "HTML" });
    });
  } catch (error) {
    console.error(error);
    ctx.reply("An error occurred while processing your request.");
  }
});

bot.command("start", async (ctx) => {
  ctx.reply("Welcome! Send any daraz product link to track when its price decreases. If the bot is offline, it will respond to your messages when it is back online");

  const { id, first_name, username } = ctx.chat;
  await insertUser(id, first_name, username);
});

async function insertUser(id, first_name, username) {
  try {
    await db.sql(`INSERT INTO users (id, first_name, username) 
    values('${id}', '${first_name}', '${username}')
    ON CONFLICT(id) DO UPDATE SET
      first_name = '${first_name}',
      username = '${username}'
      `);
  } catch (err) {
    console.error(err);
  }
}

bot.hears(/https:\/\/www\.daraz\.com\.np\/products\/[^\s]+/, async (ctx) => {
  const url = ctx.match[0];
  console.log(`\nReceived: ${url}`);

  const productData = await scrapeDaraz(url);
  ctx.reply(`Noted. You will be notified about future price drops for ${productData.name}.`);
  await insertProduct(productData);
  await insertWishlist(productData.idSku, ctx.chat.id);
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
    // maybe send message saying prod already being tracked
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
const DEMO_URL = `http://localhost:${PORT}/demo.html`;

bot.command("demo", async (ctx) => {
  // todo: call scraper loop with this user's id
  ctx.reply(`Started demo.
    The bot will check ${DEMO_URL} for price drops every ${DEMO_CRON_INTERVAL_MS / 1000} seconds for ${DEMO_CRON_RUN_LIMIT} times.
    `);
  try {
    // set user as current watcher for demo. this is because we don't want to notify many users when demo is running
    db.get('select pdt_sku, pdt_simplesku from demo_product', (err, row) => {
      if(err) {
        return console.error(err);
      }
      const demoIdSku = getIdSku(row.pdt_sku, row.pdt_simplesku);
      const stmt = `update wishlist set user_id='${ctx.chat.id}' where idSku='${demoIdSku}'`;
      db.exec(stmt);
      // todo: start cron job for limited runs
    })
  } catch (err) {
    console.error(err);
  }
});

bot.command("forcedemo", async ctx => {
  try {
    comparePrevPrice(DEMO_URL, ctx.chat.id);
  } catch (err) {
    console.error(err);
  }
})
function getIdSku(pdt_sku, pdt_simplesku) {
  return `i${pdt_sku}-s${pdt_simplesku}`;
}

async function scrapeCronJob(url, cronIntervalMs, cronRunLimit) {
  // ? hmm don't pass url here since its supposed to loop for all products during 1 cron job? 
  db.each('select * from products sort by scrapePriority desc', (err, row => {
    const url = row.url;
    // run every cronIntervalMs uptil cronRunLimit (set limit to -1 for infinite)
    // setTimeout(scrapeDaraz(), CRON_INTERVAL_MS);
    comparePrevPrice(url);
  }))
}

async function comparePrevPrice(url, senderId) {
  // NOTE: senderId is used to send message to whover ran /force if price hasn't changed
  const productData = await scrapeDaraz(url);

  // get previously stored data for this product
  db.get(`SELECT * FROM products where idSku='${productData.idSku}' LIMIT 1`, (err, row) => {
    if (err) {
      return console.error(err);
    }
    const final = productData.finalPrice;
    const prev = row.prevPrice;
    if (final < prev) {
      // notify all users watching that product
      db.each(`select user_id from wishlist where idSku='${productData.idSku}'`, (err, row) => {
        if (err) {
          return console.error(err);
        }
    console.log(row);
        bot.api.sendMessage(row.user_id, `Hey! ${productData.name} has dropped in price from ${getStringPrice(prev)} to ${getStringPrice(final)}.\n${productData.url}`)
        db.exec(`update products set prevPrice=${final},
           scrapePriority = scrapePriority + 1
           where idSku='${productData.idSku}'`,
          err => console.error(err));
      })
    } else {
      // todo: do this only for /force commands?
      if (typeof senderId !== 'undefined') {
        bot.api.sendMessage(senderId, `${productData.name} hasn't dropped in price.`);
      }
      if (final > prev) {
        db.exec(`update products set prevPrice=${final}
           where idSku='${productData.idSku}'`,
          err => console.error(err));
      }
    }
  });
}

bot.command('remove', async ctx => {
  // todo: handle conditions with no. of args > 1 or =0, if idSku not found?  
  const idSku = ctx.match;
  console.log(idSku);
  db.exec(`delete from wishlist where idSku='${idSku}'`, err => {
    if(err) console.error(err);
  });
})

bot.command('test', async ctx => {
  db.each(`select user_id from wishlist where idSku='i1-s1'`, (err, row) => {
    console.log(row);
  });
})

bot.command('help', ctx => {
  ctx.reply(`  
/start: Start bot. Run this if you've changed your username or name
{Daraz product URL}: Track this product for you
/demo: Launch demo page with editable prices, to check bot functionality
/force: Forcefully run scraper for current user
/forcedemo: run /force on demo page
/list: View products being tracked by you
/remove: Stop tracking specified product
/help: View help messages
  `);
})

bot.start();
console.log("Bot server is running. \n");

app.listen(PORT, () => {
  console.log(`Express web server is running on http://localhost:${PORT}`);
});

app.get("/api/getDemoData", async (req, res) => {
  try {
    db.get("SELECT * FROM demo_product LIMIT 1", (err, row) => {
      if (err) {
        res.status(404).json({ error: "No data found" });
        return console.error(err);
      }
      res.json(row);
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve data" });
    console.error(error);
  }
});

app.post("/api/postDemoData", async (req, res) => {
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
      `);
    res.status(200).send("Demo data updated");
  } catch (error) {
    res.status(500).json({ error: "Failed to add data" });
    console.error(error);
  }
});

const CRON_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function getNumericPrice(str) {
  // todo: just remove any alphabets and symbols
  return Number(str.replace(/Rs\.?\s?|,|\s/g, ""));
}

function getStringPrice(num) {
  return Number(num).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'NPR',
    currencyDisplay: 'narrowSymbol'
  })
}
async function scrapeDaraz(url) {
  const productData = {
    idSku: "",
    name: "",
    url: "",
    finalPrice: 0,
    // properties starting with _ shouldn't be stored in db
    _undiscountedPrice: 0,
    _discountPercent: 0,
  };

  const browser = await puppeteer.launch({
    browser: process.env.PUPPETEER_BROWSER,
    ...(process.env.PUPPETEER_BROWSER_PATH && {
      executablePath: process.env.PUPPETEER_BROWSER_PATH,
    }),
    headless: true,
  });
  const page = await browser.newPage();

  await page.goto(url, {
    timeout: 2 * 60 * 1000,
    waitUntil: "networkidle0",
  });

  await page.setViewport({ width: 1080, height: 1024 });

  // INFO: each product page in daraz has a globally-scoped obj pdpTrackingData
  // that has data about the product
  const loggedData = await page.evaluate(() => {
    return typeof pdpTrackingData !== "undefined" ? pdpTrackingData : null;
  });

  productData.url = url;
  productData.idSku = getIdSku(loggedData.pdt_sku, loggedData.pdt_simplesku);
  productData.name = loggedData.pdt_name;
  productData._undiscountedPrice = getNumericPrice(loggedData.pdt_price);
  productData.finalPrice = getNumericPrice(
    await page.$eval(".pdp-price_type_normal", (el) => el.textContent),
  );

  // maybe notify user about discount %
  if (productData.finalPrice < productData._undiscountedPrice) {
    const discountText = await page
      .$eval(".pdp-product-price__discount", (el) => el.textContent)
      .catch(() => null);
    if (discountText !== null) {
      productData.discountPercent = Number(discountText.replace(/-|%/g, ""));
    } else {
      productData._discountPercent = null;
    }
  }

  // ? don't close if scraping multiple pages? maybe create separate fn to close browser & call when last product reached
  // maybe create a function singleScrape, separate from scrapeCronJob
  await browser.close();
  return productData;
}
