const express = require('express');
const whois = require('whois'); // Node.js whois 库
const { execFile } = require('child_process'); // 用于执行系统命令
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const app = express();
const port = 8080;

// 创建缓存实例, 默认缓存时间为1小时 (3600秒)
const cache = new NodeCache({ stdTTL: 3600 });

// WHOIS 查询的超时时间 (毫秒) - 同时用于node-whois库和系统命令
const WHOIS_LOOKUP_TIMEOUT = 20000; // 20秒

// 创建速率限制器
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制每个IP 15分钟内最多100个请求
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// 应用速率限制中间件到所有请求
app.use(limiter);

// 辅助函数：处理WHOIS数据并发送响应
function processWhoisData(rawData, domainName, responseObj, requestTimestamp, source) {
  const processingTime = new Date().toISOString();
  console.log(`[${processingTime}] WHOIS data received for ${domainName} via ${source}. Data length: ${rawData ? rawData.length : 'N/A'}`);
  
  try {
    const creationDate = extractCreationDate(rawData);
    const expirationDate = extractExpirationDate(rawData);
    const registrar = extractRegistrar(rawData);
    
    console.log(`[${processingTime}] Extracted info for ${domainName} via ${source}: Creation: ${creationDate}, Expiration: ${expirationDate}, Registrar: ${registrar}`);
    
    const result = { 
      domain: domainName, 
      creationDate, 
      expirationDate, 
      registrar, 
      rawData // 保留原始数据
    };
    
    cache.set(domainName, result);
    console.log(`[${processingTime}] Data for ${domainName} (from ${source}) stored in cache.`);
    responseObj.json(result);
  } catch (processingError) {
    console.error(`[${processingTime}] Error processing WHOIS data for ${domainName} (from ${source}):`, processingError);
    responseObj.status(500).json({ error: 'Error processing WHOIS data', details: processingError.message });
  }
}


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

  console.log(`[${requestTime}] No cache for ${domain}. Attempting lookup via node-whois library with timeout ${WHOIS_LOOKUP_TIMEOUT}ms.`);

  // 步骤1: 尝试使用 Node.js whois 库
  whois.lookup(domain, { timeout: WHOIS_LOOKUP_TIMEOUT }, (err, data) => {
    const nodeWhoisLookupTime = new Date().toISOString();
    if (err) {
      let nodeWhoisErrorDetails = err.message || 'Unknown error during node-whois lookup';
      if (err.code) nodeWhoisErrorDetails += ` (Code: ${err.code})`;
      console.warn(`[${nodeWhoisLookupTime}] node-whois lookup for ${domain} FAILED. Error: ${nodeWhoisErrorDetails}. Attempting fallback to system WHOIS command.`);

      if (err.message && (err.message.toLowerCase().includes('timeout') || err.code === 'ETIMEDOUT')) {
        console.warn(`[${nodeWhoisLookupTime}] The failure in node-whois for ${domain} was specifically a timeout.`);
      }

      // 步骤2: node-whois 失败，尝试使用系统 whois 命令
      // 简单的域名有效性检查，防止命令注入。注意：对于国际化域名(IDN)，这可能不够。
      // 一个更安全的做法是确保域名参数只包含允许的字符。
      if (!/^[a-zA-Z0-9.-]+$/.test(domain) || domain.includes(' ') || domain.length > 255) {
        const invalidDomainTime = new Date().toISOString();
        console.error(`[${invalidDomainTime}] Invalid domain format for system WHOIS: ${domain}`);
        // 如果node-whois也失败了，这里返回一个综合的错误可能更好，
        // 但由于这是在node-whois失败后的路径，先返回400表明域名问题。
        return res.status(400).json({ error: 'Invalid domain format for system command' });
      }
      
      console.log(`[${nodeWhoisLookupTime}] Executing system WHOIS command for ${domain} with timeout ${WHOIS_LOOKUP_TIMEOUT}ms.`);
      execFile('whois', [domain], { timeout: WHOIS_LOOKUP_TIMEOUT }, (systemCmdError, stdout, stderr) => {
        const systemWhoisLookupTime = new Date().toISOString();
        if (systemCmdError) {
          console.error(`[${systemWhoisLookupTime}] System WHOIS command for ${domain} FAILED. Error: ${systemCmdError.message}`);
          if (stderr) {
            console.error(`[${systemWhoisLookupTime}] System WHOIS stderr for ${domain}: ${stderr.trim()}`);
          }
          // node-whois 和系统命令都失败了
          return res.status(500).json({ 
            error: 'WHOIS lookup failed using both library and system command', 
            library_error: nodeWhoisErrorDetails,
            system_command_error: systemCmdError.message,
            system_command_stderr: stderr ? stderr.trim() : null
          });
        }
        
        // 系统命令成功获取数据
        console.log(`[${systemWhoisLookupTime}] System WHOIS lookup for ${domain} successful.`);
        processWhoisData(stdout, domain, res, requestTime, "SystemCommand");
      });

    } else {
      // Node.js whois 库成功获取数据
      console.log(`[${nodeWhoisLookupTime}] node-whois lookup for ${domain} successful.`);
      processWhoisData(data, domain, res, requestTime, "NodeWhoisLib");
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
