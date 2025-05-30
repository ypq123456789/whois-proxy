const express = require('express');
const whois = require('whois'); // 请确保你已安装此模块，通常是 'node-whois'
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
  whois.lookup(domain, { timeout: WHOIS_LOOKUP_TIMEOUT }, (err, data) => {
    const lookupEndTime = new Date().toISOString();
    if (err) {
      console.error(`[${lookupEndTime}] WHOIS lookup for ${domain} FAILED. Error:`, err);
      
      let errorDetails = 'WHOIS lookup failed';
      let statusCode = 500;

      if (err.message) {
        errorDetails = err.message;
      }
      if (err.code) {
        errorDetails += ` (Code: ${err.code})`;
      }
      
      // 检查是否是超时错误
      if (err.message && (err.message.toLowerCase().includes('timeout') || err.code === 'ETIMEDOUT')) {
        errorDetails = `WHOIS lookup timed out after ${WHOIS_LOOKUP_TIMEOUT}ms: ${errorDetails}`;
        statusCode = 504; // Gateway Timeout
        console.error(`[${lookupEndTime}] Specific timeout error for ${domain}: ${errorDetails}`);
        return res.status(statusCode).json({ error: 'WHOIS lookup timed out from application', details: errorDetails });
      }
      
      console.error(`[${lookupEndTime}] Non-timeout error for ${domain}: ${errorDetails}`);
      return res.status(statusCode).json({ error: 'WHOIS lookup failed', details: errorDetails });
    } else {
      console.log(`[${lookupEndTime}] WHOIS data received for ${domain}. Data length: ${data ? data.length : 'N/A'}`);
      // console.log(`[${lookupEndTime}] Raw data sample for ${domain}: ${data ? data.substring(0, 200) : 'No data'}`); // 用于调试，可以取消注释查看原始数据片段

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
          rawData: data // 保留原始数据字段，与你之前的脚本一致
        };
        
        // 将结果存入缓存
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
  // 增强的正则表达式以匹配更多常见的创建日期标签
  const creationDateRegex = /(?:Creation Date|Registered on|Registration Date|Registration Time|Created On|create-date): (.+)/i;
  const match = whoisData.match(creationDateRegex);
  return match && match[1] ? match[1].trim() : "Unknown";
}

function extractExpirationDate(whoisData) {
  if (typeof whoisData !== 'string') return "Invalid data";
  // 增强的正则表达式以匹配 ".org" 等域名可能使用的 "Registry Expiry Date" 及其他常见标签
  const expirationDateRegex = /(?:Registry Expiry Date|Expiration Date|Expiry Date|Registrar Registration Expiration Date|Expiration Time|paid-till|valid-until): (.+)/i;
  const match = whoisData.match(expirationDateRegex);
  return match && match[1] ? match[1].trim() : "Unknown";
}

function extractRegistrar(whoisData) {
  if (typeof whoisData !== 'string') return "Invalid data";
  let match;

  // 尝试匹配 "Registrar:"
  const registrarRegex = /Registrar: (.+)/i;
  match = whoisData.match(registrarRegex);
  if (match && match[1]) return match[1].trim();

  // 尝试匹配 "Sponsoring Registrar:"
  const sponsoringRegistrarRegex = /Sponsoring Registrar: (.+)/i;
  match = whoisData.match(sponsoringRegistrarRegex);
  if (match && match[1]) return match[1].trim();
  
  // 尝试匹配 "Registrar Name:"
  const registrarNameRegex = /Registrar Name: (.+)/i;
  match = whoisData.match(registrarNameRegex);
  if (match && match[1]) return match[1].trim();

  // 可以根据需要添加更多常见的注册商标注方式
  // console.warn('Could not extract registrar using known patterns.'); // 如果需要，可以取消注释此警告
  return 'Unknown';
}

app.listen(port, () => {
  console.log(`WHOIS proxy server listening at http://localhost:${port}`);
});
