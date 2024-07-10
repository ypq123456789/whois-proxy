## 项目描述

这是一个简单的 WHOIS 代理服务器,使用 Node.js 和 Express 框架构建。它提供了一个 API 端点来查询域名的 WHOIS 信息,并包含以下特性:

- 使用 node-cache 实现数据缓存
- 使用 express-rate-limit 实现请求速率限制
- 提取并返回关键 WHOIS 信息（创建日期、过期日期、注册商）

## 前置要求

- Node.js (建议版本 12.x 或更高)
- npm (通常随Node.js一起安装)

## 安装

1. 安装 npm (如果尚未安装):

以下是在不同操作系统上安装Node.js (包含npm) 的命令:

对于 Ubuntu/Debian 系统:

```bash
# 更新包列表
sudo apt update

# 安装Node.js和npm
sudo apt install nodejs npm

# 验证安装
node --version
npm --version
```

对于 CentOS/Fedora 系统:

```bash
# 安装Node.js和npm
sudo dnf install nodejs npm

# 或者如果使用较旧的CentOS版本:
# sudo yum install nodejs npm

# 验证安装
node --version
npm --version
```

对于 macOS (使用Homebrew):

```bash
# 安装Homebrew (如果尚未安装)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装Node.js (会自动包含npm)
brew install node

# 验证安装
node --version
npm --version
```

对于 Windows:

Windows用户通常直接从Node.js官网下载安装程序。但如果您使用包管理器如Chocolatey,可以使用以下命令:

```bash
# 使用Chocolatey安装
choco install nodejs

# 验证安装
node --version
npm --version
```

2. 下载并设置 whois-proxy.js:
   ```
   mkdir -p /root/whois && curl -o /root/whois/whois-proxy.js https://raw.githubusercontent.com/ypq123456789/whois-proxy.js/main/whois-proxy.js && cd /root/whois
   ```
   
3. 安装依赖:
   ```
   npm install express whois node-cache express-rate-limit
   ```

这将安装以下包:
- express: Web 应用框架
- whois: WHOIS 查询功能
- node-cache: 用于实现缓存
- express-rate-limit: 用于实现速率限制


## 使用 PM2 运行服务器

1. 全局安装 PM2:
   ```
   npm install -g pm2
   ```

2. 使用 PM2 启动服务器:
   ```
   pm2 start whois-proxy.js --name "whois-proxy"
   ```

3. 查看运行状态:
   ```
   pm2 status
   ```

4. 查看日志:
   ```
   pm2 logs whois-proxy
   ```

5. 停止服务器:
   ```
   pm2 stop whois-proxy
   ```

6. 重启服务器:
   ```
   pm2 restart whois-proxy
   ```

## API 使用

发送GET请求到 `/whois/:domain` 端点,其中 `:domain` 是您想查询的域名。

例如:
```
http://x.x.x.x/whois/example.com
```

其中x.x.x.x是你vps的ip。

如果有需要，你也可以绑定自己的域名，并且套上CF的CDN，让自己的服务更加安全。

## 注意事项

- 服务器默认在80端口运行。如需更改,请修改代码中的 `port` 变量。
- 速率限制设置为每个IP每15分钟100个请求。
- WHOIS数据默认缓存1小时。
