import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_API_TOKEN); 
const productData = {
    url: '',
    idSku: '',
    prevUndiscountedPrice: 0,
    name: ''
};

bot.command("start", (ctx) => ctx.reply("Welcome! Send any daraz product link to track when its price decreases. If the bot is offline, it will respond to your messages when it is back online"));
// bot.on("message", (ctx) => ctx.reply("Got another message!"));
bot.hears(/https:\/\/www\.daraz\.com\.np\/products\/[^\s]+/, ctx => {
    clearObjectValues(productData);
    productData.url = ctx.match[0];
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