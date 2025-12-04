require('dotenv').config();
const Web3 = require('web3');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const CONTRACT = (process.env.CONTRACT || '0x3aebd0f979c5c20ea8de568105e91c17f2fa4444').toLowerCase();
const POOL = (process.env.POOL || '0x35502f66ff7edb2be43b96d5931a8d340eaddf27').toLowerCase();
const BSC_WSS = process.env.BSC_WSS || 'wss://bsc-ws-node.nariox.org:443';

// ⛔ 固定筛选买单 ≥ 10 USDT（不会读取 .env）
const MIN_USD = 10;

if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
  console.error('Missing TG_BOT_TOKEN or TG_CHAT_ID in environment. Aborting.');
  process.exit(1);
}

const bot = new TelegramBot(TG_BOT_TOKEN, { polling: false });

let web3;
function createWeb3() {
  try {
    const provider = new Web3.providers.WebsocketProvider(BSC_WSS, {
      clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000
      },
      reconnect: {
        auto: true,
        delay: 5005,
        maxAttempts: 5,
        onTimeout: false
      }
    });
    const w3 = new Web3(provider);
    provider.on && provider.on('error', err => {
      console.error('WSS provider error', err && err.message ? err.message : err);
    });
    provider.on && provider.on('end', e => {
      console.error('WSS provider ended', e);
    });
    return w3;
  } catch (e) {
    console.error('createWeb3 fallback to http provider', e && e.message ? e.message : e);
    return new Web3('https://bsc-dataseed.binance.org/');
  }
}

web3 = createWeb3();

const ERC20_ABI = [
  { "constant":true, "inputs":[], "name":"decimals", "outputs":[{"name":"","type":"uint8"}], "type":"function" },
  { "constant":true, "inputs":[], "name":"symbol", "outputs":[{"name":"","type":"string"}], "type":"function" },
  { "constant":true, "inputs":[{"name":"_owner","type":"address"}], "name":"balanceOf", "outputs":[{"name":"balance","type":"uint256"}], "type":"function" },
  { "constant":true, "inputs":[], "name":"totalSupply", "outputs":[{"name":"","type":"uint256"}], "type":"function" },
  { "anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"}
];

const tokenContract = new web3.eth.Contract(ERC20_ABI, CONTRACT);
let TOKEN_DECIMALS = 18;
let TOKEN_SYMBOL = '布鲁斯';

async function initTokenInfo() {
  try {
    const d = await tokenContract.methods.decimals().call();
    TOKEN_DECIMALS = Number(d);
  } catch (e) {
    console.warn('Failed to fetch decimals, defaulting to 18', e && e.message ? e.message : e);
  }
  try {
    const s = await tokenContract.methods.symbol().call();
    TOKEN_SYMBOL = s || TOKEN_SYMBOL;
  } catch (e) {}
  console.log('Token decimals', TOKEN_DECIMALS, 'symbol', TOKEN_SYMBOL);
}

async function fetchTokenData() {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${CONTRACT}`;
    const r = await axios.get(url, { timeout: 10000 });
    const attr = r.data && r.data.data && r.data.data.attributes;
    if (!attr) return null;
    return {
      price_usd: Number(attr.price_usd) || 0,
      market_cap_usd: attr.market_cap_usd || attr.fdv_usd || null
    };
  } catch (e) { return null; }
}

async function getBnbPrice() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
    return Number(res.data.price);
  } catch (e) { return 0; }
}

let subscription;

async function startListening() {
  try {
    await initTokenInfo();
    subscription = tokenContract.events.Transfer({ fromBlock: 'latest' })
      .on('data', async (event) => {
        try {
          const { from, to, value } = event.returnValues;
          const txHash = event.transactionHash;
          const blockNumber = event.blockNumber;

          if (from === '0x0000000000000000000000000000000000000000') return;
          if (from.toLowerCase() !== POOL.toLowerCase()) return;

          const rawAmount = BigInt(value.toString());
          const amountToken = Number(rawAmount) / Math.pow(10, TOKEN_DECIMALS);

          const tokenData = await fetchTokenData();
          const priceUsd = tokenData && tokenData.price_usd ? Number(tokenData.price_usd) : 0;
          const marketCap = tokenData && tokenData.market_cap_usd ? tokenData.market_cap_usd : null;
          const totalUsd = amountToken * priceUsd;

          if (totalUsd < MIN_USD) return;

          const bnbPrice = await getBnbPrice();
          const bnbAmount = bnbPrice > 0 ? (totalUsd / bnbPrice) : 0;

          let prevBal = '0';
          try {
            prevBal = await tokenContract.methods.balanceOf(to).call({}, blockNumber - 1);
          } catch (e) { prevBal = '0'; }
          const isNew = BigInt(prevBal.toString()) === BigInt(0);

          let totalSupply = null;
          try {
            const ts = await tokenContract.methods.totalSupply().call();
            totalSupply = Number(BigInt(ts.toString()) / BigInt(Math.pow(10, TOKEN_DECIMALS)));
          } catch (e) { totalSupply = null; }
          const marketCapComputed = (totalSupply && priceUsd) ? ('$' + (totalSupply * priceUsd).toLocaleString()) : (marketCap ? ('$' + Number(marketCap).toLocaleString()) : 'N/A');

          const walletShort = to.slice(0,6) + '…' + to.slice(-4);
          const addressLink = `https://bscscan.com/address/${to}`;
          const txLink = `https://bscscan.com/tx/${txHash}`;

          const title = `🔥 ${TOKEN_SYMBOL} 买入`;
          const CHART_LINK = 'https://www.geckoterminal.com/bsc/pools/0x35502f66ff7edb2be43b96d5931a8d340eaddf27';
          const TRADE_LINK = 'https://pancakeswap.finance/swap?outputCurrency=0x3aEBD0f979c5C20Ea8De568105E91c17f2FA4444&chainId=56&inputCurrency=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&chain=bsc';

          const msg = `${title}\n` +
            `🐝`.repeat(30) + `\n\n` +
            `💵 ${bnbAmount.toFixed(6)} BNB ($${totalUsd.toFixed(2)})\n` +
            `🪙 ${Number(amountToken).toLocaleString()} ${TOKEN_SYMBOL}\n` +
            `🔶 <a href="${addressLink}">${walletShort}</a> | <a href="${txLink}">Txn</a>\n` +
            `${isNew ? '✅ <b>New Holder</b>\n' : ''}` +
            `🔼 Market Cap ${marketCapComputed}\n\n` +
            `📊 <a href="${CHART_LINK}">Chart</a>   🐰 <a href="${TRADE_LINK}">Trade</a>   🔸 Trending https://t.me/BSCTRENDING/`;

          await bot.sendMessage(TG_CHAT_ID, msg, { parse_mode: 'HTML', disable_web_page_preview: true });

        } catch (e) {}
      })
      .on('error', () => {
        setTimeout(() => {
          try { subscription && subscription.unsubscribe(); } catch(e){}
          web3 = createWeb3();
          startListening();
        }, 5000);
      });

  } catch (e) {
    setTimeout(startListening, 5000);
  }
}

startListening();

setInterval(() => {
  console.log(new Date().toISOString(), 'heartbeat');
}, 1000 * 60);

process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection', reason));
