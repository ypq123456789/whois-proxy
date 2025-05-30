const express = require('express');
// 请在你的 package.json 中确认你使用的 'whois' 模块的具体名称和版本。
// 大多数情况下，`npm install whois` 会安装 'node-whois' by Furqan Software (qruto)。
const whois = require('whois');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const app = express();
const port = 8080;

// 创建缓存实例, 默认缓存时间为1小时 (3600秒)
const cache = new NodeCache({ stdTTL: 3600 });

// WHOIS 查询的超时时间 (毫秒)
const WHOIS_LOOKUP_TIMEOUT = 20000; // 20秒

// 创建速率限制器
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制每个IP 15分钟内最多100个请求
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// 应用速率限制中间件到所有请求
app.use(limiter);

app.get('/whois/:domain', (req, res) => {
  const domain = req.params.domain;
  const requestTime = new Date().toISOString();
  console.log(`[${requestTime}] Received WHOIS request for domain: ${domain}`);

  // 检查缓存中是否有数据
  const cachedData = cache.get(domain);
  if (cachedData) {
    console.log(`[${requestTime}] Returning cached data for ${domain}`);
    return res.json(cachedData);
  }

  console.log(`[${requestTime}] No cache for ${domain}, performing live lookup with timeout ${WHOIS_LOOKUP_TIMEOUT}ms.`);

  // 针对 .org 域名，尝试直接查询 'whois.pir.org' 并设置 follow: 0
  // 这是为了解决特定域名 (如 heisi.org) 可能出现的超时问题。
  // 你可以根据实际情况调整这些选项，或者针对不同的 TLD 设置不同的选项。
  const whoisOptions = {
    timeout: WHOIS_LOOKUP_TIMEOUT,
    server: 'whois.pir.org', // 直接指定 .org 的权威 WHOIS 服务器
    follow: 0                // 禁止进一步的查询引用 (因为 .org 是 Thick WHOIS)
    // 备选尝试:
    // server: 'whois.pir.org', follow: 1
    // follow: 1 (不指定 server，让库自动判断但限制 follow 层级)
    // (不传递 server 和 follow，使用库的默认行为，即我们之前的版本)
  };

  console.log(`[${requestTime}] Using WHOIS options for ${domain}: ${JSON.stringify(whoisOptions)}`);

  whois.lookup(domain, whoisOptions, (err, data) => {
    const lookupEndTime = new Date().toISOString();
    if (err) {
      console.error(`[${lookupEndTime}] WHOIS lookup for ${domain} FAILED with options ${JSON.stringify(whoisOptions)}. Error:`, err);
      
      let errorDetails = 'WHOIS lookup failed';
      let statusCode = 500;

      if (err.message) {
        errorDetails = err.message;
      }
      if (err.code) {
        errorDetails += ` (Code: ${err.code})`;
      }
      
      if (err.message && (err.message.toLowerCase().includes('timeout') || err.code === 'ETIMEDOUT')) {
        errorDetails = `WHOIS lookup timed out after ${WHOIS_LOOKUP_TIMEOUT}ms using options ${JSON.stringify(whoisOptions)}: ${errorDetails}`;
        statusCode = 504; // Gateway Timeout
        console.error(`[${lookupEndTime}] Specific timeout error for ${domain}: ${errorDetails}`);
        return res.status(statusCode).json({ error: 'WHOIS lookup timed out from application', details: errorDetails });
      }
      
      console.error(`[${lookupEndTime}] Non-timeout error for ${domain}: ${errorDetails}`);
      return res.status(statusCode).json({ error: 'WHOIS lookup failed', details: errorDetails });
    } else {
      console.log(`[${lookupEndTime}] WHOIS data received for ${domain}. Data length: ${data ? data.length : 'N/A'}`);
      
      try {
        const creationDate = extractCreationDate(data);
        const expirationDate = extractExpirationDate(data);
        const registrar = extractRegistrar(data);
        
        console.log(`[${lookupEndTime}] Extracted info for ${domain}: Creation: ${creationDate}, Expiration: ${expirationDate}, Registrar: ${registrar}`);
        
        const result = { 
          domain, 
          creationDate, 
          expirationDate, 
          registrar, 
          rawData: data
        };
        
        cache.set(domain, result);
        console.log(`[${lookupEndTime}] Data for ${domain} stored in cache.`);
        
        res.json(result);
      } catch (processingError) {
        const processingErrorTime = new Date().toISOString();
        console.error(`[${processingErrorTime}] Error processing WHOIS data for ${domain}:`, processingError);
        res.status(500).json({ error: 'Error processing WHOIS data', details: processingError.message });
      }
    }
  });
});

function extractCreationDate(whoisData) {
  if (typeof whoisData !== 'string') return "Invalid data";
  const creationDateRegex = /(?:Creation Date|Registered on|Registration Date|Registration Time|Created On|create-date): (.+)/i;
  const match = whoisData.match(creationDateRegex);
  return match && match[1] ? match[1].trim() : "Unknown";
}

function extractExpirationDate(whoisData) {
  if (typeof whoisData !== 'string') return "Invalid data";
  const expirationDateRegex = /(?:Registry Expiry Date|Expiration Date|Expiry Date|Registrar Registration Expiration Date|Expiration Time|paid-till|valid-until): (.+)/i;
  const match = whoisData.match(expirationDateRegex);
  return match && match[1] ? match[1].trim() : "Unknown";
}

function extractRegistrar(whoisData) {
  if (typeof whoisData !== 'string') return "Invalid data";
  let match;

  const registrarRegex = /Registrar: (.+)/i;
  match = whoisData.match(registrarRegex);
  if (match && match[1]) return match[1].trim();

  const sponsoringRegistrarRegex = /Sponsoring Registrar: (.+)/i;
  match = whoisData.match(sponsoringRegistrarRegex);
  if (match && match[1]) return match[1].trim();
  
  const registrarNameRegex = /Registrar Name: (.+)/i;
  match = whoisData.match(registrarNameRegex);
  if (match && match[1]) return match[1].trim();

  return 'Unknown';
}

app.listen(port, () => {
  console.log(`WHOIS proxy server listening at http://localhost:${port}`);
});
