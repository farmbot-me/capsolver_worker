let puppeteer = require("rebrowser-puppeteer-core");
const { pageController } = require("./module/pageController.js");
let Xvfb;
try {
  Xvfb = require("xvfb");
} catch {
  // ignore
}

async function connect({
  args = [],
  headless = false,
  customConfig = {},
  proxy = {},
  turnstile = false,
  connectOption = {},
  disableXvfb = false,
  plugins = [],
  ignoreAllFlags = false,
  offScreen = false, // New parameter to control window position
  ignoreHTTPSErrors = true,
} = {}) {
  const { launch, Launcher } = await import("chrome-launcher");

  let xvfbsession = null;
  if (headless == "auto") headless = false;

  if (process.platform === "linux" && disableXvfb === false) {
    try {
      xvfbsession = new Xvfb({
        silent: true,
        xvfb_args: ["-screen", "0", "1920x1080x24", "-ac"],
      });
      xvfbsession.startSync();
    } catch (err) {
      console.log(
        "You are running on a Linux platform but do not have xvfb installed. The browser can be captured. Please install it with the following command\n\nsudo apt-get install xvfb\n\n" +
          err.message
      );
    }
  }

  let chromeFlags;
  if (ignoreAllFlags === true) {
    chromeFlags = [
      ...args,
      ...(headless !== false ? [`--headless=${headless}`] : []),
      ...(proxy && proxy.host && proxy.port
        ? [`--proxy-server=${proxy.host}:${proxy.port}`]
        : []),
      ...(offScreen ? ["--window-position=-10000,-10000"] : []), // Add flag for off-screen
    ];
  } else {
    // Default flags: https://github.com/GoogleChrome/chrome-launcher/blob/main/src/flags.ts
    const flags = Launcher.defaultFlags();
    // Add AutomationControlled to "disable-features" flag
    const indexDisableFeatures = flags.findIndex((flag) =>
      flag.startsWith("--disable-features")
    );
    flags[
      indexDisableFeatures
    ] = `${flags[indexDisableFeatures]},AutomationControlled`;
    // Remove "disable-component-update" flag
    const indexComponentUpdateFlag = flags.findIndex((flag) =>
      flag.startsWith("--disable-component-update")
    );
    flags.splice(indexComponentUpdateFlag, 1);
    chromeFlags = [
      ...flags,
      ...args,
      ...(headless !== false ? [`--headless=${headless}`] : []),
      ...(proxy && proxy.host && proxy.port
        ? [`--proxy-server=${proxy.host}:${proxy.port}`]
        : []),
      "--no-sandbox",
      "--disable-dev-shm-usage",
      ...(offScreen ? ["--window-position=-10000,-10000"] : []), // Add flag for off-screen
    ];
  }

  const chrome = await launch({
    ignoreDefaultFlags: true,
    ignoreHTTPSErrors: ignoreHTTPSErrors,
    chromeFlags,
    ...customConfig,
  });

  if (plugins.length > 0) {
    const { addExtra } = await import("puppeteer-extra");

    puppeteer = addExtra(puppeteer);

    for (const item of plugins) {
      puppeteer.use(item);
    }
  }

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${chrome.port}`,
    ...connectOption,
  });

  let page = await browser.newPage();

  // 如果需要将窗口移到屏幕外
  if (offScreen) {
    try {
      const session = await page.target().createCDPSession();
      const targetId = page.target()._targetId;
      const { windowId } = await session.send("Browser.getWindowForTarget", {
        targetId,
      });
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          left: -10000,
          top: -10000,
        },
      });
    } catch (err) {
      console.warn("Failed to move window off-screen:", err);
      // 如果移动窗口失败，继续执行而不中断程序
    }
  }

  // 使用 `authenticate` 方法输入用户名和密码
  if (proxy.username && proxy.password) {
    await page.authenticate({
      username: proxy.username,
      password: proxy.password,
    });
  }

  let pageControllerConfig = {
    browser,
    page,
    proxy,
    turnstile,
    xvfbsession,
    pid: chrome.pid,
    plugins,
  };

  page = await pageController({
    ...pageControllerConfig,
    killProcess: true,
    chrome,
  });

  browser.on("targetcreated", async (target) => {
    if (target.type() === "page") {
      let newPage = await target.page();
      pageControllerConfig.page = newPage;
      newPage = await pageController(pageControllerConfig);
    }
  });

  return {
    browser,
    page,
  };
}

module.exports = { connect };
